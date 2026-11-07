/* What the screens talk to. The server holds the rules, the time, the XP and the answers, and this
   module holds what it last said, plus the player's virtual machine: terminal history and files, which
   stay on this device. Nothing here decides who earned what.
   No React and no DOM beyond storage, so it can be tested in Node. */
import { S, host } from '../../../engines/host.js';
import { cleanMachine, placeFixtures } from '../../../engines/replay.js';
import { F, fs, HOME, HOST, norm, pad } from '../../../engines/fs/index.js';
import { sh, runLine } from '../../../engines/shell/index.js';
import { COMMANDS, MAN } from '../../../engines/shell/commands.js';
import { VI, viKey, viSelection } from '../../../engines/vi/index.js';
import { createLab, injectFaults, reachabilityGoals } from '../../../engines/netsim/index.js';
import { ensureAudio, playCheckIn, playLevelUp, playNetworkUp, playTimerEnd, playUnlock, setMuted } from '../sound/cues.js';
import { ApiError, del, get, patch, post, put, refreshAccess, setAccess, setSignedOutHandler } from './client.js';

export { S, VI, viSelection };

/* ---------- what the server told us ---------- */
export const TK = {};
export const TRACKS = [];
export const COMING = []; // tracks on the way, like NetLab, with what will open them
export const TRACK_LOCKS = {};
export let BEYOND = ['BX', 'Beyond', ''];
export const CHAPTERS = {};
export const TICKETS = [];
export const DIFFICULTIES = [];
export const LEVELS = [];
export const STREAKS = [];
export const BADGES = [];
export let BANK_CAP = 1800;
export let GOAL_BONUS = 2;
export let HINT_COST = 15;
export const EARN = {};
const ALL = new Map();

/* ---------- things the screens watch ---------- */
export const ui = {
  auth: 'checking', // checking, in or out
  account: null,
  level: { index: 1, title: 'Noob', cleared: 0, next_title: null, next_at: null },
  term: [],
  termVersion: 0,
  toast: null,
  toastBadge: null,
  debrief: null,
  overlay: null, // {kind:'level', i} or {kind:'finale'}
  flash: null, // mission id that just unlocked
  rw: { id: null, task: null, correct: 0, total: 5, xpOnClear: 0, fb: null, pick: [], busy: false, answers: 0, lockUntil: 0 },
  py: { state: 'idle' },
  current: null, // the mission being played, with its workspace
  openTrack: null, // the category open on the Missions screen
  plan: null, // the study plan, today against it, and the weekly and monthly goals
  lab: null, // the NetLab being played: its simulator, consoles and last check
  briefings: {},
};

let version = 0;
let skew = 0; // server clock minus this device's clock
const listeners = new Set();
let navigate = () => {};
let toastTimer = null;
let flashTimer = null;
const toastQueue = [];

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getVersion = () => version;
export const bump = () => {
  version++;
  listeners.forEach((fn) => fn());
};
export const setNavigator = (fn) => {
  navigate = fn;
};
export const go = (path) => navigate(path);

function showNextToast() {
  const next = toastQueue.shift();
  ui.toast = next ? next.text : null;
  ui.toastBadge = next ? next.badge : null;
  clearTimeout(toastTimer);
  if (next) toastTimer = setTimeout(showNextToast, 3200);
  bump();
}
/** Several things can happen at once, like XP, an unlock and a badge, so they wait their turn. */
export function toast(text, badge = null) {
  toastQueue.push({ text, badge });
  if (!ui.toast) showNextToast();
}
/** What was waiting to be said is no longer news once someone has signed out. */
export function clearToasts() {
  toastQueue.length = 0;
  showNextToast();
}
const complain = (e) => toast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/* ---------- small helpers ---------- */
export const mmss = (s) => {
  s = Math.max(0, Math.ceil(s));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
};
const local = (iso) => Date.parse(iso) - skew; // a server time, on this device's clock

/* ---------- selectors ---------- */
export const byId = (id) => ALL.get(String(id).toLowerCase());
export const T = () => ui.current;
export const trackName = (k) => (k === BEYOND[0] ? BEYOND[1] : TRACKS.find((t) => t[0] === k)?.[1] ?? k);
const isCleared = (m) => m.state === 'cleared';
export const clearedIn = (k) => (TK[k] || []).filter(isCleared).length;
export const cleared = () => TICKETS.filter(isCleared).length;
export const beyondCleared = () => clearedIn(BEYOND[0]);
export const beyondOpen = () => (S.peak || 0) >= TICKETS.length && TICKETS.length > 0;
export const levelIdx = () => ui.level.index - 1;
export const level = () => ui.level.title;
export const sessionOn = () => !!S.sessionEndsAt && Date.now() < S.sessionEndsAt;
/* A replay costs nothing, so it needs no session. It only waits for a focus block to end. */
export const canPlay = () => sessionOn() || ((!!ui.current?.revisit || !!ui.lab?.sandbox) && !S.focus && !S.claim);
export const mult = () => 1 + Math.min(S.streak || 0, 10) * 0.05;
/* The screens speak in open, locked, rewind and clear. */
export const stateOf = (m) => ({ solved: 'rewind', cleared: 'clear' }[m.state] || m.state);
export const nextUp = () => {
  let best = null;
  for (const k of [...TRACKS.map((t) => t[0]), BEYOND[0]]) {
    const list = TK[k] || [];
    const m = list.find((x) => stateOf(x) === 'rewind') || list.find((x) => stateOf(x) === 'open');
    if (m && (!best || (stateOf(m) === 'rewind' && stateOf(best) !== 'rewind') || (stateOf(m) === stateOf(best) && m.pos < best.pos))) best = m;
  }
  return best;
};
export const parText = (b) => (b.par_kind === 'keys' ? `${b.par_value} keys` : b.par_kind === 'commands' ? `${b.par_value} command${b.par_value > 1 ? 's' : ''}` : 'first try');
export const difficultyLabel = (code) => DIFFICULTIES.find((d) => d.code === code)?.label ?? code;
export const missionPath = (m) => (stateOf(m) === 'rewind' ? `/missions/${m.id}/rewind` : `/missions/${m.id}`);
/* Generated incidents need a server that keeps their answers. They arrive in M11 (ADR 0007). */
export const oncallUnlocked = () => false;

/* ---------- this device's virtual machine ---------- */
const MACHINE = { ...cleanMachine(), hist: [], code: {}, cmds: {}, len: 25, log: [], logFor: null };
const machineKey = () => `uptime-machine-${ui.account?.username}`;
let practiceSaved = null; // while revisiting a mission, the real machine waits here
function saveMachine() {
  if (practiceSaved) return;
  const m = {};
  for (const k of Object.keys(MACHINE)) m[k] = S[k];
  try {
    localStorage.setItem(machineKey(), JSON.stringify(m));
  } catch { /* private window or blocked storage: it still works until you leave */ }
}
function loadMachine() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(machineKey())) || {};
  } catch { /* see saveMachine */ }
  Object.assign(S, structuredClone(MACHINE), saved);
}

/* A goal you've already met would pass the moment you typed anything, so revisiting one starts on a clean
   machine. Your real one comes back untouched when you leave. */
const PRACTICE_KEYS = ['overlay', 'cwd', 'net', 'viKeys', 'viUsed', 'ranScript', 'cmds', 'log', 'logFor'];
function beginPractice() {
  if (practiceSaved) return;
  practiceSaved = Object.fromEntries(PRACTICE_KEYS.map((k) => [k, S[k]]));
  Object.assign(S, cleanMachine(), { cmds: {}, log: [], logFor: null });
  fs.reset(S.overlay);
}
export function endPractice() {
  if (!practiceSaved) return;
  Object.assign(S, practiceSaved);
  practiceSaved = null;
  fs.reset(S.overlay);
}

/* ---------- loading from the server ---------- */
const checkIn = (b) => ({ presence: b.presence, checkEndsAt: b.check_expires_at ? local(b.check_expires_at) : null });
function applyPlayer(p) {
  skew = Date.parse(p.server_time) - Date.now();
  ui.level = p.level;
  S.xp = p.xp;
  S.bank = p.bank_seconds;
  S.streak = p.streak;
  S.bestStreak = p.best_streak;
  S.shields = p.shields;
  S.season = p.season;
  if (ui.account) ui.account.avatar = p.avatar;
  S.peak = p.level.cleared;
  S.todayMin = p.today_minutes;
  S.todayDrifts = p.today_drifts;
  S.focusMin = p.focus_minutes;
  S.blocks = p.blocks_finished;
  S.muted = !p.sound_on;
  setMuted(S.muted);
  S.sessionEndsAt = p.session ? local(p.session.expires_at) : null;
  S.focus = null;
  S.claim = null;
  if (p.block) {
    const block = { id: p.block.id, goal: p.block.goal, len: p.block.minutes, kind: p.block.kind, startedAt: local(p.block.started_at), endsAt: local(p.block.ends_at), claimBy: local(p.block.claim_by), drifts: p.block.drifts, ...checkIn(p.block) };
    if (Date.now() >= block.endsAt) S.claim = block;
    else S.focus = block;
  }
}
function applyTracks(data) {
  DIFFICULTIES.length = 0;
  DIFFICULTIES.push(...data.difficulties);
  TRACKS.length = 0;
  TICKETS.length = 0;
  COMING.length = 0;
  ALL.clear();
  S.season = data.season;
  for (const t of data.tracks) {
    TRACK_LOCKS[t.code] = t.locked_because;
    if (!t.missions.length) {
      COMING.push({ code: t.code, name: t.name, subtitle: t.subtitle, lockedBecause: t.locked_because, requires: t.requires });
      continue;
    }
    if (t.after_archmage) BEYOND = [t.code, t.name, t.subtitle];
    else TRACKS.push([t.code, t.name, t.subtitle]);
    const chapters = [];
    TK[t.code] = t.missions.map((m, pos) => {
      if (chapters.at(-1)?.[0] !== m.chapter) chapters.push([m.chapter, pos]);
      const card = { id: m.code, track: t.code, pos, title: m.title, chapter: m.chapter, difficulty: m.difficulty, xp: m.xp, state: m.state, answered: m.answered, lockedBecause: m.locked_because };
      ALL.set(m.code, card);
      if (!t.after_archmage && !t.side) TICKETS.push(card);
      return card;
    });
    CHAPTERS[t.code] = chapters;
  }
}
function applyRewards(r) {
  EARN[15] = r.config.earn_seconds[15] / 60;
  EARN[25] = r.config.earn_seconds[25] / 60;
  EARN[45] = r.config.earn_seconds[45] / 60;
  GOAL_BONUS = r.config.goal_bonus_seconds / 60;
  BANK_CAP = r.config.bank_cap;
  HINT_COST = r.config.hint_cost;
  LEVELS.length = 0;
  LEVELS.push(...r.levels.map((l) => [l.cleared, l.title]));
  STREAKS.length = 0;
  STREAKS.push(...r.streak.map((s) => [s.days, s.seconds / 60, s.xp, s.shields]));
  BADGES.length = 0;
  BADGES.push(...r.badges.map((b) => [b.code, b.name, b.description]));
  S.badges = Object.fromEntries(r.badges.filter((b) => b.earned_at).map((b) => [b.code, true]));
  S.claimed = Object.fromEntries(r.streak.filter((s) => s.claimed).map((s) => [s.days, true]));
}
export const refreshPlayer = async () => {
  applyPlayer(await get('/player/'));
  bump();
};
const refreshTracks = async () => {
  applyTracks(await get('/tracks/'));
  bump();
};
const refreshRewards = async () => {
  applyRewards(await get('/rewards/'));
  bump();
};
export const refreshPlan = async () => {
  ui.plan = await get('/focus/plan/');
  bump();
};
const refreshAll = () => Promise.all([refreshPlayer(), refreshTracks(), refreshRewards(), refreshPlan()]);

async function enterGame(account) {
  ui.account = account;
  loadMachine();
  const [fixtures] = await Promise.all([get('/fixtures/'), refreshAll()]);
  for (const f of fixtures.files) F(f.path, f.content, f.mode);
  fs.reset(S.overlay);
  ui.term = [];
  pr("Whiteraven operator console. Your account is 'ops'.\nRun 'help' for the tools on this box.\n", 'd');
  ui.auth = 'in';
  bump();
}

/* ---------- accounts ---------- */
function signedOut() {
  setAccess(null);
  ui.auth = 'out';
  ui.account = null;
  ui.current = null;
  ui.debrief = null;
  ui.overlay = null;
  overlayQueue = [];
  ui.plan = null;
  clearToasts();
}
setSignedOutHandler(signedOut);

export async function boot() {
  try {
    await refreshAccess();
    const me = await get('/auth/me/');
    await enterGame(me.account);
  } catch {
    signedOut();
  }
}
export const usernameStatus = (name) => get(`/auth/username/?name=${encodeURIComponent(name)}`);
export async function login(username, password) {
  const d = await post('/auth/login/', { username, password });
  setAccess(d.access);
  await enterGame(d.account);
}
/* Registering sends a code to the email. The game only opens once that code comes back. */
export async function register(username, email, password, confirm_password) {
  const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return post('/auth/register/', { username, email, password, confirm_password, time_zone });
}
export async function verifyEmail(username, code) {
  const d = await post('/auth/verify/', { username, code });
  setAccess(d.access);
  await enterGame(d.account);
}
export const resendCode = (username) => post('/auth/verify/resend/', { username });
export const forgotPassword = (identifier) => post('/auth/password/forgot/', { identifier });
export const resetPassword = (username, code, password, confirm_password) => post('/auth/password/reset/', { username, code, password, confirm_password });
export async function logout() {
  try {
    await post('/auth/logout/');
  } catch { /* the token is dropped below either way */ }
  signedOut();
  go('/login');
}
export async function deleteAccount(password) {
  const key = machineKey();
  await del('/auth/me/', { password });
  try {
    localStorage.removeItem(key);
  } catch { /* see saveMachine */ }
  signedOut();
  go('/register');
}
/* ---------- your picture ---------- */
export async function chooseAvatar(index) {
  const d = await patch('/auth/me/', { avatar_index: index });
  ui.account = d.account;
  bump();
}
export async function uploadAvatar(file) {
  const form = new FormData();
  form.append('picture', file);
  const d = await post('/auth/avatar/', form);
  ui.account = { ...ui.account, avatar: d.avatar };
  bump();
}
export async function removeAvatar() {
  const d = await del('/auth/avatar/');
  ui.account = { ...ui.account, avatar: d.avatar };
  bump();
}

export async function setTimeZone(time_zone) {
  try {
    const d = await patch('/auth/me/', { time_zone });
    ui.account = d.account;
    await Promise.all([refreshPlayer(), refreshPlan()]);
  } catch (e) {
    complain(e);
  }
}

/* ---------- terminal output ---------- */
let spanId = 0;
function pushSpan(t, c) {
  ui.term.push({ id: ++spanId, t, c });
  if (ui.term.length > 1500) ui.term.splice(0, ui.term.length - 1500);
  ui.termVersion++;
}
export function pr(t, c) {
  if (t === '') return;
  pushSpan(t.endsWith('\n') ? t : t + '\n', c);
}
const termErr = (t) => pr(t, 'e');
export const promptText = () => {
  const p = S.cwd === HOME ? '~' : S.cwd?.startsWith(HOME + '/') ? '~' + S.cwd.slice(HOME.length) : S.cwd;
  return `ops@${HOST} ${p}`;
};
export function echoCmd(l) {
  pushSpan(promptText(), 'pr');
  pushSpan(l + '\n', 'cmd');
}
export function clearTerm() {
  ui.term = [];
  ui.termVersion++;
  bump();
}

/* ---------- playing a mission ---------- */
const META = new Set(['help', 'man', 'clear', 'brief', 'hint', 'submit', 'status', 'exit']);
const HELP = () => `Tools: ls cd pwd cat head tail wc grep sort uniq cut tr sed awk find
       mv cp rm mkdir touch chmod tee seq xargs echo paste diff tac rev nl
       for and while loops, if, pipes, >, >>, bash scripts
       vi ip ping dig netplan ss curl
Game:  brief        show the mission again
       hint         reveal a hint (costs ${HINT_COST} XP)
       submit X     answer the mission
       man <tool>   short reference for a tool
       status       your level and session time
Keys:  Tab completes, Up and Down recall history, Ctrl+L clears.`;

const GOAL_CHECKS = new Set(['fs', 'vi']);
const isGoalMission = (t) => GOAL_CHECKS.has(t?.check);

/** The lesson and brief. Works without a session, and caches because it doesn't change. */
export async function loadBriefing(id) {
  if (ui.briefings[id]) return ui.briefings[id];
  const b = await get(`/missions/${id}/`);
  ui.briefings[id] = b;
  bump();
  return b;
}
/** Why it works and the solution. The server only answers once the mission has been solved. */
export const loadDebrief = (id) => get(`/missions/${id}/debrief/`);
/* Every mission starts on the same clean machine, and what you do from there is logged. The server plays that log back
   on its own clean machine, so what a mission achieved is what really happened (ADR 0015). Coming back to the mission
   you're in carries on where you were. */
function startCleanMachine(t, files) {
  Object.assign(S, cleanMachine(), { log: [], logFor: t.id });
  S.cmds[t.id] = 0;
  fs.reset(S.overlay);
  placeFixtures(files);
}
/* A mission's files come back if an earlier attempt deleted them. */
function restoreFixtures(files) {
  for (const [rel, content] of Object.entries(files || {})) {
    const p = `${HOME}/${rel}`;
    if (fs.get(p)) continue;
    const parts = p.split('/');
    for (let i = 2; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!fs.get(dir)) fs.put(dir, { t: 'd', m: 0o755, mt: 'Nov  6 09:00' });
    }
    fs.put(p, { t: 'f', c: content, m: 0o644, mt: 'Nov  6 09:00' });
  }
}
/* An Operation's machine carries across its stages, so finishing one just moves the workspace on. */
const replayStages = {};
async function nextStage(t, res) {
  playUnlock();
  toast(`Stage ${res.stage} of ${res.total} done.`);
  await enterMission(t.id);
}
const stageField = (t) => (t.stage ? { stage: t.stage.index } : {});
/** Gets a mission ready to play. It needs an open session, so it runs again when one opens. */
export async function enterMission(id) {
  const brief = await loadBriefing(id);
  const replay = byId(id)?.state === 'cleared';
  // A running session's clock would spend play time on a replay that's meant to be free.
  if (replay && sessionOn()) {
    await closeSession(true);
    toast('Replays are free. Your session is paused and its time is back in the bank.');
  }
  if (replay ? (S.focus || S.claim) : !sessionOn()) {
    ui.current = { ...toPlayable(brief), revisit: replay, ready: false };
    bump();
    return;
  }
  // A replay of an Operation keeps its place in the browser, since it's only practice.
  const asked = replay && replayStages[id] ? `?stage=${replayStages[id]}` : '';
  const play = await get(`/missions/${id}/play/${asked}`);
  const t = { ...toPlayable(brief), ...toWorkspace(play), ready: true, revisit: play.state === 'cleared' };
  if (play.stage) Object.assign(t, { check: play.check_type, kind: kindOf(play.check_type), brief: play.stage.brief, goal: play.stage.goal, stage: play.stage });
  if (ui.current?.id !== id || !ui.current.ready || ui.current.stage?.index !== t.stage?.index) {
    if (t.revisit && GOAL_CHECKS.has(t.check)) beginPractice();
    else endPractice();
    if (t.revisit) {
      S.cwd = HOME;
      restoreFixtures(play.workspace.fixtures);
    } else if (S.logFor !== id) {
      startCleanMachine(t, play.workspace.fixtures);
    }
    if (t.kind === 'net') await startLab(t);
    else ui.lab = null;
  }
  ui.current = t;
  saveMachine();
  bump();
}
export const leaveCurrent = () => {
  flushLab();
  ui.current = null;
  ui.lab = null;
  endPractice();
};
const kindOf = (check) => (check === 'py' || check === 'go-code' || check === 'net' ? check : GOAL_CHECKS.has(check) ? 'auto' : 'answer');
const toPlayable = (b) => ({
  id: b.code, track: b.track, skill: b.skill, title: b.title, from: b.from_dept, difficulty: b.difficulty, xp: b.xp, check: b.check_type,
  kind: kindOf(b.check_type),
  par_kind: b.par_kind, par_value: b.par_value, learn: [b.lesson.text, b.lesson.example], brief: b.brief, goal: b.goal, hintsShown: [], hintsTotal: 0,
});
const toWorkspace = (p) => {
  const w = p.workspace;
  const out = { hintsShown: p.hints, hintsTotal: p.hints_total };
  if (w.file) out.file = w.file.replace(/^~/, HOME);
  if (w.go?.program) out.program = w.go.program;
  if (w.go?.starter) out.starter = w.go.starter;
  if (w.lab) {
    out.labSpec = w.lab;
    out.goals = w.goals;
  }
  if (w.python) {
    out.starter = w.python.starter;
    out.tests = w.python.tests.map((x) => [x.expr, x.want, x.label]);
    out.prelude = w.python.prelude;
    out.wrap = w.python.wrap;
    out.captureOutput = w.python.capture_output;
    out.files = w.python.files;
  }
  return out;
};

function meta(a) {
  const c = a[0];
  const t = T();
  if (c === 'help') return pr(HELP());
  if (c === 'man') {
    const m = MAN[a[1]];
    return m ? pr(m) : termErr(`No entry for ${a[1] || 'that'}. Try: ${Object.keys(MAN).join(' ')}`);
  }
  if (c === 'clear') {
    ui.term = [];
    ui.termVersion++;
    return undefined;
  }
  if (!t) return pr('Pick a mission from the Missions screen.', 'd');
  if (c === 'brief') return pr(`${t.title}\n${t.brief}\nGoal: ${t.goal}`, 's');
  if (c === 'hint') return showHint();
  if (c === 'status') return pr(`${level()}, XP ${S.xp}. Cleared ${cleared()}/${TICKETS.length}. ${sessionOn() ? `Session left ${mmss((S.sessionEndsAt - Date.now()) / 1000)}.` : 'This replay is free.'}`);
  if (c === 'exit') return pr('Use the Leave button, or close the session in System.', 'd');
  return submitAnswer(a.slice(1).join(' '));
}

const commandsOn = (t) => S.cmds[t.id] || 0;
function revisited(t, res) {
  if (res.result !== 'pass') return false;
  if (t.stage && t.stage.index + 1 < t.stage.total) {
    replayStages[t.id] = t.stage.index + 1;
    enterMission(t.id).catch(complain);
    return true;
  }
  if (t.stage) delete replayStages[t.id];
  ui.current = { ...t, solved: true };
  pr('Right again. Revisits pay no XP, so this one was just for you.', 'k');
  toast('Solved again. No XP on a revisit.');
  return true;
}
async function afterSolved(t, res) {
  ui.current = { ...t, solved: true };
  const d = await get(`/missions/${t.id}/debrief/`);
  const note = t.par_kind === 'keys' ? `${S.viKeys[t.file] || 0} keys, par ${t.par_value}` : t.par_kind === 'commands' ? `${commandsOn(t)} command${commandsOn(t) === 1 ? '' : 's'}, par ${t.par_value}` : res.tries <= 1 ? 'first try' : `${res.tries} tries`;
  ui.debrief = { id: t.id, title: t.title, why: d.why, solution: d.solution, job: d.job, worth: d.xp_on_clear, bonus: res.par_bonus, note };
  saveMachine();
  await Promise.all([refreshTracks(), refreshPlayer()]);
}
async function submitAnswer(value) {
  const t = T();
  if (!t || t.solved) return pr('Already solved.', 'd');
  if (t.kind === 'py' || t.kind === 'go-code') return pr('This mission is graded by Run tests.', 'd');
  if (t.kind === 'auto') return pr('This mission completes itself when the goal is met.', 'd');
  if (!value) return termErr('Usage: submit <answer>');
  try {
    const res = await post(`/missions/${t.id}/submit/`, { answer: value, commands: commandsOn(t), ...stageField(t) });
    if (res.revisit && revisited(t, res)) return bump();
    if (res.result === 'stage') {
      pr(`Accepted: ${value}`, 'k');
      await nextStage(t, res);
    } else if (res.result === 'pass') {
      pr(`Accepted: ${value}`, 'k');
      await afterSolved(t, res);
    } else pr('Not that one. Check your work and try again.', 'w');
  } catch (e) {
    termErr(e.message);
    if (e.code === 'no_active_session') await refreshPlayer();
  }
  bump();
  return undefined;
}
export async function showHint() {
  const t = T();
  if (!t || t.solved) return;
  try {
    const d = await post(`/missions/${t.id}/hint/`);
    t.hintsShown = [...t.hintsShown, d.hint];
    pr(`Hint ${d.hints_used}: ${d.hint}`, 's');
  } catch (e) {
    pr(e.message, 'd');
  }
  bump();
}
export const closeDebrief = () => {
  ui.debrief = null;
  bump();
};
export function leaveMission() {
  leaveCurrent();
  go('/missions');
}

/* The goal lives on the server, so after each command the browser reports where things stand. Only one
   check runs at a time, and whatever happened meanwhile is covered by one more check afterwards. */
const machineState = () => ({
  files: S.overlay,
  cwd: S.cwd,
  gateway: S.net?.gw,
  ran_script: S.ranScript || null,
  vi_keys: S.viKeys,
  vi_used: S.viUsed,
});
let checking = false;
let checkAgain = false;
export async function checkGoal() {
  const t = T();
  if (!isGoalMission(t) || t.solved || !canPlay()) return;
  if (checking) {
    checkAgain = true;
    return;
  }
  checking = true;
  try {
    const keys = t.file ? S.viKeys[t.file] || 0 : 0;
    const res = await post(`/missions/${t.id}/check/`, { state: machineState(), log: S.log, commands: commandsOn(t), keys, ...stageField(t) });
    if (res.revisit) revisited(t, res);
    else if (res.result === 'stage') await nextStage(t, res);
    else if (res.result === 'pass') await afterSolved(t, res);
  } catch (e) {
    if (e.code === 'no_active_session') await refreshPlayer();
    // Anything else, like a rate limit, just means the next command checks again.
  } finally {
    checking = false;
  }
  bump();
  if (checkAgain) {
    checkAgain = false;
    await checkGoal();
  }
}
export function runCommand(line) {
  const src = line.trim();
  if (!src) return;
  echoCmd(line);
  S.hist.push(src);
  if (S.hist.length > 100) S.hist.shift();
  const toks = src.split(/\s+/);
  if (META.has(toks[0])) {
    meta(toks);
    saveMachine();
    bump();
    return;
  }
  const t = T();
  if (t && !t.solved) {
    S.cmds[t.id] = commandsOn(t) + 1;
    S.log.push(`l${src}`);
  }
  const buf = [];
  const errorsBefore = ui.term.filter((s) => s.c === 'e').length;
  sh.sink = buf;
  sh.errSink = null;
  sh.code = 0;
  try {
    runLine(src);
  } catch (x) {
    termErr('sh: ' + x.message);
    sh.code = 1;
  }
  sh.sink = null;
  pr(buf.join(''));
  if (!VI.on) {
    // A failed command should say how to find out more, not just that it failed.
    const failed = ui.term.filter((s) => s.c === 'e').length > errorsBefore;
    const code = failed && sh.code === 0 ? 1 : sh.code;
    if (failed && MAN[toks[0]]) pr(`Need a reminder? Run: man ${toks[0]}`, 'd');
    // grep finding nothing isn't a failure: it answered the question. So it's told apart from an error.
    const nothingFound = !failed && code === 1 && !buf.join('');
    pushSpan(nothingFound ? 'quiet' : String(code), 'st');
    ui.termVersion++;
  }
  saveMachine();
  bump();
  if (!VI.on) checkGoal();
}

function completions(v, cur) {
  const before = v.slice(0, cur);
  const m = /(?:^|[\s|;&])((?:\\ |[^\s|;&])*)$/.exec(before);
  const word = (m ? m[1] : '').replace(/\\ /g, ' ');
  const first = !before.slice(0, before.length - word.length).trim();
  let c = [];
  if (first && !word.includes('/')) {
    c = [...Object.keys(COMMANDS), ...META].filter((x) => x.startsWith(word)).sort();
  } else {
    const sl = word.lastIndexOf('/');
    const dirS = sl >= 0 ? word.slice(0, sl + 1) : '';
    const part = word.slice(sl + 1);
    const dir = norm((dirS.startsWith('~') ? HOME + dirS.slice(1) : dirS) || '.');
    const k = fs.kids(dir).filter((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1);
      return name.startsWith(part) && (part.startsWith('.') || !name.startsWith('.'));
    });
    c = k.map((p) => dirS + p.slice(p.lastIndexOf('/') + 1) + (fs.get(p).t === 'd' ? '/' : ''));
  }
  return { before, m, word, c };
}
/** The grey text after what you've typed: what Tab would add, when there's only one choice. */
export function suggestion(v) {
  if (!v || /\s$/.test(v) && !v.trim()) return '';
  const { word, c } = completions(v, v.length);
  return c.length === 1 && word && c[0].startsWith(word) ? c[0].slice(word.length) : '';
}
const GAME_HELP = {
  help: 'Lists the tools on this box.',
  man: 'Shows a short reference for a tool, as in: man grep',
  clear: 'Clears the screen.',
  brief: 'Shows the mission again.',
  hint: 'Reveals a hint, which lowers what the mission pays.',
  submit: 'Sends your answer to be checked.',
  status: 'Shows your level and the session time left.',
  exit: 'Use the Leave button instead.',
};
/** The line under the prompt: what the command you're typing does, or the keys when it's empty. */
export function commandHelp(v) {
  const word = v.trim().split(/\s+/)[0];
  if (!word) return { kind: 'idle', text: 'Enter runs. Tab completes. Up and Down recall history. Ctrl+L clears.' };
  if (GAME_HELP[word]) return { kind: 'known', text: GAME_HELP[word] };
  if (MAN[word]) return { kind: 'known', text: MAN[word].split('\n')[0] };
  if (COMMANDS[word] || word.includes('/') || word.includes('=')) return { kind: 'known', text: 'Enter runs it.' };
  const close = [...Object.keys(COMMANDS), ...META].filter((x) => x.startsWith(word));
  if (close.length) return { kind: 'typing', text: `Keep typing, or press Tab: ${close.slice(0, 5).join('  ')}` };
  if (['for', 'while', 'if'].includes(word)) return { kind: 'known', text: MAN[word] ? MAN[word].split('\n')[0] : 'Enter runs it.' };
  return { kind: 'unknown', text: `This box has no command called ${word}. Run help to see what it has.` };
}

/** Tab completion for the terminal. Returns the new value and caret, or null if nothing changed. */
export function tabComplete(v, cur) {
  const { before, m, word, c } = completions(v, cur);
  if (!c.length) return null;
  const esc = (s) => s.replace(/ /g, '\\ ');
  const rep = (x) => {
    const raw = before.slice(0, before.length - (m ? m[1].length : 0)) + x;
    return { value: raw + v.slice(cur), caret: raw.length };
  };
  if (c.length === 1) return rep(esc(c[0]) + (c[0].endsWith('/') ? '' : ' '));
  let p = c[0];
  for (const x of c) while (!x.startsWith(p)) p = p.slice(0, -1);
  if (p.length > word.length) return rep(esc(p));
  echoCmd(v);
  pr(c.map((x) => x.slice(x.lastIndexOf('/', x.length - 2) + 1)).join('  '), 'd');
  bump();
  return null;
}

/* ---------- vi hooks ---------- */
host.err = termErr;
host.viShow = () => bump();
host.afterVi = () => {
  saveMachine();
  bump();
  checkGoal();
};
export function viPress(key, ctrl) {
  if (!VI.on) return;
  if (!T()?.solved) S.log.push(`${ctrl ? 'c' : 'k'}${key}`);
  viKey(key, ctrl);
  bump();
}

/* ---------- NetLab ---------- */
/* The simulator runs here so every keystroke answers at once. Only the configs go to the server, which re-runs the
   same engine on them to decide a pass (ADR 0011). */
const SAVE_LAB_AFTER = 1200;
const WIN_MOMENT = 1100; // the network lights up before the debrief covers it
let labSaveTimer = null;
function freshLabUi(t, saved) {
  const lab = createLab(t.labSpec, saved);
  const names = [...lab.devices.values()].filter((d) => !d.locked).map((d) => d.name);
  return {
    drill: null, won: false, checks: 0, lab, id: t.id, device: names[0] ?? null, goals: t.goals, results: null, checking: false, trace: null, version: 0, save: !t.revisit, cabling: !!t.labSpec.cabling,
    consoles: Object.fromEntries(names.map((n) => [n, []])), histories: Object.fromEntries(names.map((n) => [n, []])),
  };
}
async function startLab(t) {
  // A revisit is practice: it starts clean, and leaves your finished lab as it was.
  let saved = null;
  if (!t.revisit) {
    try {
      saved = (await get(`/netlab/${t.id}/state/`)).state;
    } catch { /* start from the beginning: nothing is lost, and the next save writes it again */ }
  }
  ui.lab = freshLabUi(t, saved);
}
function saveLabNow() {
  clearTimeout(labSaveTimer);
  labSaveTimer = null;
  const lab = ui.lab;
  if (lab?.sandbox) {
    const devices = lab.lab.topology.devices.map(({ name, kind, x, y, ports }) => ({ name, kind, x, y, ports }));
    put('/netlab/sandbox/', { topology: { devices }, state: lab.lab.serialize() }).catch(() => { /* the next change saves it again */ });
    return;
  }
  if (!lab?.save || !sessionOn()) return;
  put(`/netlab/${lab.id}/state/`, { state: lab.lab.serialize() }).catch(() => { /* the next change saves it again */ });
}
const flushLab = () => {
  if (labSaveTimer) saveLabNow();
};
function queueLabSave() {
  clearTimeout(labSaveTimer);
  labSaveTimer = setTimeout(saveLabNow, SAVE_LAB_AFTER);
}
function labPrint(device, text, cls) {
  const lab = ui.lab;
  lab.consoles[device].push({ id: ++spanId, t: text.endsWith('\n') ? text : `${text}\n`, c: cls });
  lab.version++;
}
const outputClass = (out) => (/^\s*\^|^%|Why:|command not found/m.test(out) ? 'e' : '');
export const labView = () => ui.lab.lab.view();
export function labSelect(device) {
  ui.lab.device = device;
  ui.lab.version++;
  bump();
}
export function labRun(line) {
  const lab = ui.lab;
  if (!lab || !canPlay()) return;
  const { device } = lab;
  const src = line.trim();
  labPrint(device, lab.lab.promptOf(device), 'pr');
  // A password isn't echoed or kept in history, the same as on a real device.
  const secret = lab.lab.devices.get(device).pending === 'enable';
  labPrint(device, secret ? '' : line, 'cmd');
  if (src) {
    if (!secret) lab.histories[device].push(src);
    const t = T();
    if (t && !t.solved && !secret) S.cmds[t.id] = (S.cmds[t.id] || 0) + 1;
    const before = lab.lab.trace;
    const out = lab.lab.run(device, src);
    if (lab.lab.trace !== before) lab.trace = lab.lab.trace;
    if (out) labPrint(device, out, outputClass(out));
  }
  if (lab.save) queueLabSave();
  saveMachine();
  bump();
}
export function labComplete(value, caret) {
  const lab = ui.lab;
  if (caret !== value.length) return null;
  const line = lab.lab.complete(lab.device, value);
  return line ? { value: line, caret: line.length } : null;
}
export function labClear() {
  const lab = ui.lab;
  lab.consoles[lab.device] = [];
  lab.version++;
  bump();
}
export function labPlug(a, pa, b, pb) {
  const err = ui.lab.lab.plug(a, pa, b, pb);
  if (err) toast(err);
  if (!err) ui.lab.won = false;
  if (!err && ui.lab.save) queueLabSave();
  bump();
  return err;
}
export function labUnplug(device, port) {
  ui.lab.lab.unplug(device, port);
  ui.lab.won = false;
  if (ui.lab.save) queueLabSave();
  bump();
}
export async function labCheck() {
  const t = T();
  const lab = ui.lab;
  if (!t || !lab || lab.checking || t.solved) return;
  lab.checking = true;
  bump();
  try {
    const res = await post(`/missions/${t.id}/submit/`, { state: lab.lab.serialize(), commands: commandsOn(t), ...stageField(t) });
    lab.results = res.goals;
    lab.checks++;
    if (res.result === 'pass' || res.result === 'stage') {
      lab.won = true;
      playNetworkUp();
    }
    if (res.revisit) {
      // A replay stays open, so it can be broken and fixed again.
      if (res.result === 'pass') {
        if (lab.drill) lab.drill.fixed = true;
        toast(lab.drill ? 'Fixed. A replay earns nothing and costs nothing.' : 'Every goal passes. A replay earns nothing and costs nothing.');
        if (t.stage) revisited(t, res);
      }
    } else if (res.result === 'stage') {
      clearTimeout(labSaveTimer);
      labSaveTimer = null;
      bump();
      await new Promise((resolve) => { setTimeout(resolve, WIN_MOMENT); });
      await nextStage(t, res);
    } else if (res.result === 'pass') {
      clearTimeout(labSaveTimer);
      labSaveTimer = null;
      bump();
      await new Promise((resolve) => { setTimeout(resolve, WIN_MOMENT); });
      await afterSolved(t, res);
    }
  } catch (e) {
    complain(e);
    if (e.code === 'no_active_session') await refreshPlayer();
  }
  lab.checking = false;
  bump();
}
export async function labReset() {
  const t = T();
  if (!t) return;
  clearTimeout(labSaveTimer);
  labSaveTimer = null;
  ui.lab = freshLabUi(t, null);
  if (!t.revisit) del(`/netlab/${t.id}/state/`).catch(() => {});
  bump();
}

/* A fault drill: the finished lab, broken by the server, which keeps what it broke until you ask. */
export async function labStartDrill(count) {
  const t = T();
  if (!t) return;
  try {
    const d = await post(`/netlab/${t.id}/drill/`, { faults: count });
    ui.lab = freshLabUi(t, d.state);
    ui.lab.drill = { count: d.count, faults: null, fixed: false };
  } catch (e) {
    complain(e);
  }
  bump();
}
export async function labRevealDrill() {
  const t = T();
  if (!t || !ui.lab?.drill) return;
  try {
    ui.lab.drill.faults = (await get(`/netlab/${t.id}/drill/`)).faults;
  } catch (e) {
    complain(e);
  }
  bump();
}

/* ---------- the sandbox: your own network, free, with no goals ---------- */
const NAME_FOR = { pc: 'PC', laptop: 'LAP', server: 'SRV', switch: 'SW', l3switch: 'L3', router: 'R', firewall: 'FW', ap: 'AP' };
const MAX_SANDBOX_DEVICES = 24;
export async function enterSandbox() {
  const d = await get('/netlab/sandbox/');
  const topology = d.topology ? { ...d.topology, cabling: true } : { devices: [], cables: [], cabling: true };
  ui.lab = { ...freshLabUi({ id: 'sandbox', labSpec: topology, goals: [], revisit: true }, d.state), sandbox: true, save: true, tests: null, faults: [], showFaults: false, message: '' };
  bump();
}
function touchSandbox() {
  const lab = ui.lab;
  lab.tests = null;
  queueLabSave();
  bump();
}
export function sandboxAdd(kind) {
  const lab = ui.lab;
  if (lab.lab.devices.size >= MAX_SANDBOX_DEVICES) {
    lab.message = `A sandbox holds up to ${MAX_SANDBOX_DEVICES} devices.`;
    bump();
    return;
  }
  let n = 1;
  while (lab.lab.devices.has(`${NAME_FOR[kind]}-${n}`)) n++;
  const name = `${NAME_FOR[kind]}-${n}`;
  // New devices fill the map in rows, so none lands on top of another.
  const count = lab.lab.devices.size;
  // Eight ports is plenty for practice, and they stay big enough to grab.
  const ports = kind === 'switch' || kind === 'l3switch' ? { ports: 8 } : {};
  lab.lab.addDevice({ name, kind, x: 8 + ((count * 21) % 90), y: 12 + (Math.floor(count / 5) * 26) % 80, ...ports });
  lab.consoles[name] = [];
  lab.histories[name] = [];
  lab.device = name;
  touchSandbox();
}
export function sandboxRemove(name) {
  const lab = ui.lab;
  lab.lab.removeDevice(name);
  delete lab.consoles[name];
  delete lab.histories[name];
  lab.device = [...lab.lab.devices.keys()][0] ?? null;
  touchSandbox();
}
export function sandboxMove(name, x, y) {
  ui.lab.lab.moveDevice(name, x, y);
  touchSandbox();
}
export async function sandboxReset() {
  clearTimeout(labSaveTimer);
  labSaveTimer = null;
  await del('/netlab/sandbox/').catch(() => {});
  await enterSandbox();
}
export function sandboxTest() {
  const lab = ui.lab;
  // Every machine with an address, tried against every other one.
  lab.tests = lab.lab.check(reachabilityGoals(lab.lab));
  lab.message = lab.tests.length ? '' : 'Give two machines addresses first, so there is something to test.';
  bump();
}
export function sandboxBreak() {
  const lab = ui.lab;
  const working = reachabilityGoals(lab.lab).filter((g) => lab.lab.check([g])[0].ok);
  if (!working.length) {
    lab.message = 'Get two machines talking first, so there is something to break.';
    bump();
    return;
  }
  const done = injectFaults(lab.lab, working, Math.floor(Math.random() * 2 ** 31), 1);
  lab.faults = [...lab.faults, ...done];
  lab.showFaults = false;
  lab.message = done.length ? 'Something just broke. Test every ping, then find it.' : 'Nothing here could be broken just now.';
  touchSandbox();
}
export function sandboxRevealFaults() {
  ui.lab.showFaults = true;
  bump();
}

/* ---------- Python ---------- */
export function saveCode(t, src) {
  S.code[t.id] = src;
  saveMachine();
}
/* Code runs in a sandbox on the server, through a queue. So a run gets a ticket, and this waits for its answer. */
const JOB_WAIT = 90_000;
const JOB_POLL = 700;
async function waitForJob(job) {
  const giveUp = Date.now() + JOB_WAIT;
  for (;;) {
    const d = await get(`/missions/jobs/${job}/`);
    if (d.state === 'done') return d.result;
    if (d.state === 'failed' || Date.now() > giveUp) throw Object.assign(new Error("Your code couldn't be checked just now. Try again in a moment."), { code: 'grader_unavailable' });
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL));
  }
}
/** Sends a run to the server, which decides whether it passed. Returns what to show. */
export async function reportCode(t, body) {
  try {
    const sent = await post(`/missions/${t.id}/submit/`, { ...body, ...stageField(t) });
    const res = sent.result === 'grading' ? await waitForJob(sent.job) : sent;
    if (res.revisit) revisited(t, res);
    else if (res.result === 'stage') await nextStage(t, res);
    else if (res.result === 'pass') await afterSolved(t, res);
    return { passed: res.result === 'pass' || res.result === 'stage', output: res.output ?? '' };
  } catch (e) {
    complain(e);
    if (e.code === 'no_active_session') await refreshPlayer();
    return { passed: false, output: e.message };
  } finally {
    bump();
  }
}

/* ---------- rewind ---------- */
const freshRewind = () => ({ id: null, task: null, correct: 0, total: 5, xpOnClear: 0, fb: null, pick: [], busy: false, answers: 0, lockUntil: 0 });
export async function startRewind(id) {
  if (ui.rw.id === id && ui.rw.task) return;
  ui.rw = { ...freshRewind(), id, loading: true };
  bump();
  try {
    const d = await get(`/missions/${id}/rewind/`);
    ui.rw = { ...ui.rw, task: d.task, correct: d.correct, total: d.total, xpOnClear: d.xp_on_clear, loading: false };
  } catch (e) {
    ui.rw = { ...ui.rw, loading: false };
    complain(e);
  }
  bump();
}
/** The server adds these to a task only once they've been earned (section 6.5). */
export function rewindHelp() {
  const t = ui.rw.task;
  if (!t) return { hint: null, answer: null };
  return { hint: t.hint || null, answer: t.reveal === undefined ? null : Array.isArray(t.reveal) ? t.reveal.join('\n') : t.reveal };
}
/* The next question comes straight away, with how the last one went shown above it. A short pause before
   answers count again stops a double click landing on a question you haven't read. */
const READ_PAUSE = 350;
export async function answerRewind(value) {
  const rw = ui.rw;
  if (rw.busy || Date.now() < rw.lockUntil) return;
  rw.busy = true;
  const asked = rw.task?.q;
  try {
    const d = await post(`/missions/${rw.id}/rewind/answer/`, { value });
    rw.correct = d.done;
    rw.answers += 1;
    if (d.state === 'cleared') {
      const finished = byId(rw.id);
      ui.rw = freshRewind();
      ui.openTrack = finished?.track ?? ui.openTrack;
      await refreshAll();
      go('/missions');
      applyEvents(d.events);
      return;
    }
    rw.fb = { ok: d.correct, again: d.task?.q === asked, hint: !!d.task?.hint };
    rw.task = d.task;
    rw.lockUntil = Date.now() + READ_PAUSE;
  } catch (e) {
    complain(e);
    if (e.code === 'no_active_session') await refreshPlayer();
  }
  rw.pick = [];
  rw.busy = false;
  bump();
}
export function pickOrder(o) {
  const rw = ui.rw;
  rw.pick.push(o);
  if (rw.pick.length === rw.task.scrambled.length) answerRewind([...rw.pick]);
  else bump();
}
export function unpickOrder(i) {
  ui.rw.pick.splice(i, 1);
  bump();
}

/* Big moments take turns: a level-up first, and then the lab it opened. */
let overlayQueue = [];
function showOverlay(o) {
  if (ui.overlay) overlayQueue.push(o);
  else ui.overlay = o;
}
function flash(mission) {
  ui.flash = mission;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    ui.flash = null;
    bump();
  }, 1600);
}
/* The server says what happened, and this plays it (section 16). */
function applyEvents(events) {
  let earned = 0;
  for (const e of events || []) {
    if (e.type === 'cleared') {
      earned = e.xp;
      toast(`+${e.xp} XP`);
    } else if (e.type === 'unlocked') {
      const next = byId(e.mission);
      flash(e.mission);
      playUnlock();
      if (e.preview) showOverlay({ kind: 'unlock', mission: e.mission, preview: e.preview, xp: earned });
      else if (next) toast(`Unlocked: ${next.title}`);
    } else if (e.type === 'session_closed') {
      toast(`Mission done, so the session stopped. ${mmss(e.returned)} went back to your bank.`);
    } else if (e.type === 'lab_waiting') {
      toast(`The next lab opens after ${e.needs_title} (${e.needs.toUpperCase()}) in Networking.`);
    } else if (e.type === 'level_up') {
      playLevelUp();
      showOverlay(e.level === LEVELS.length ? { kind: 'finale' } : { kind: 'level', i: e.level - 1 });
    } else if (e.type === 'badge') {
      toast(`Badge earned: ${e.name}`, e.code);
    } else if (e.type === 'shield_used') {
      toast(`Streak shield used. ${e.days} missed day${e.days > 1 ? 's' : ''} covered.`);
    } else if (e.type === 'streak_reward') {
      toast(`${e.days} day streak reward: +${mmss(e.seconds)} play, +${e.xp} XP${e.shields ? ', +1 shield' : ''}`);
    } else if (e.type === 'target_reached') {
      toast(`${e.period === 'week' ? 'Weekly' : 'Monthly'} goal met: +${mmss(e.seconds)} play, +${e.xp} XP`);
    }
  }
  bump();
}
export const closeOverlay = () => {
  ui.overlay = overlayQueue.shift() ?? null;
  bump();
};
/* Back to the Missions screen with the NetLab card open, so the new lab is seen popping into its place. */
export function leaveReveal(mission) {
  ui.openTrack = byId(mission)?.track ?? ui.openTrack;
  flash(mission);
  closeOverlay();
}

/* ---------- focus and sessions ---------- */
export function setLen(n) {
  S.len = n;
  saveMachine();
  bump();
}
export async function startBlock(goal) {
  const g = goal.trim();
  if (!g) return;
  ensureAudio();
  try {
    await post('/focus/blocks/', { goal: g, minutes: S.len });
    VI.on = false;
    await refreshPlayer();
  } catch (e) {
    complain(e);
    if (e.code === 'plan_required') await refreshPlan();
  }
}
/** Errors go back to the form, because it's the form that has to change. */
export async function savePlan(plan) {
  ui.plan = await put('/focus/plan/', plan);
  S.len = plan.block_minutes;
  saveMachine();
  bump();
}
/** The server says when each block's check comes up, and only once it has. */
async function pollCheckIn() {
  const f = S.focus;
  try {
    const { block } = await get(`/focus/blocks/${f.id}/`);
    if (S.focus?.id !== f.id) return;
    const was = f.presence;
    Object.assign(f, checkIn(block));
    if (f.presence === 'due' && was !== 'due') {
      playCheckIn();
      go('/focus');
    }
    bump();
  } catch { /* the next poll tries again, and the server still decides at the claim */ }
}
export async function confirmCheckIn() {
  const f = S.focus;
  if (!f) return;
  try {
    const { block } = await post(`/focus/blocks/${f.id}/presence/`);
    Object.assign(f, checkIn(block));
    bump();
  } catch (e) {
    complain(e);
    await refreshPlayer();
  }
}
export async function logDrift() {
  if (!S.focus) return;
  try {
    const d = await post(`/focus/blocks/${S.focus.id}/drift/`);
    S.focus.drifts = d.block.drifts;
    S.todayDrifts = (S.todayDrifts || 0) + 1;
    bump();
  } catch (e) {
    complain(e);
  }
}
export async function abandonBlock() {
  if (!S.focus) return;
  try {
    await post(`/focus/blocks/${S.focus.id}/abandon/`);
    toast('Block ended early. Nothing earned.');
    await refreshPlayer();
  } catch (e) {
    complain(e);
  }
}
export async function closeSession(quiet) {
  try {
    await post('/sessions/close/');
    VI.on = false;
    if (!quiet) toast('Session closed. Time banked.');
  } catch (e) {
    if (e.code !== 'no_active_session') complain(e);
  }
  await refreshPlayer();
}
export async function openSession() {
  ensureAudio();
  try {
    await post('/sessions/open/');
    await refreshPlayer();
    if (ui.current) await enterMission(ui.current.id);
  } catch (e) {
    complain(e);
  }
}
const UNPAID = {
  free: 'On your map. It was outside your plan, so no play time.',
  missed: 'No check-in, so this block earned nothing.',
  expired: 'Claimed too late, so this block earned nothing.',
};
export async function claimBlock(done, note = '') {
  const c = S.claim;
  if (!c) return;
  try {
    const d = await post(`/focus/blocks/${c.id}/claim/`, { done, note });
    toast(UNPAID[d.result] || `+${mmss(d.seconds_earned)} play time`);
    await Promise.all([refreshPlayer(), refreshRewards(), refreshPlan()]);
    applyEvents(d.events);
  } catch (e) {
    // This device's clock can run a moment ahead of the server's. Waiting is all it takes.
    if (e.code === 'block_not_finished') toast('Almost. The server says a few more seconds.');
    else complain(e);
    await refreshPlayer();
  }
}
export const loadHistory = () => get('/focus/history/');
let refreshingAfterExpiry = false;
const CHECK_IN_POLL = 15000; // often enough to leave most of the window, even in a throttled background tab
let lastPoll = 0;
export function tick() {
  if (ui.auth !== 'in') return;
  const now = Date.now();
  let changed = false;
  if (S.focus) {
    changed = true;
    if (now >= S.focus.endsAt) {
      S.claim = S.focus;
      S.focus = null;
      playTimerEnd();
      go('/focus');
    } else if (S.focus.presence !== 'ok' && now - lastPoll >= CHECK_IN_POLL) {
      lastPoll = now;
      pollCheckIn();
    }
  }
  if (S.claim) {
    changed = true;
    if (now >= S.claim.claimBy && !refreshingAfterExpiry) {
      refreshingAfterExpiry = true;
      toast('Too late to claim that block, so it earned nothing.');
      refreshPlayer().catch(() => {}).finally(() => {
        refreshingAfterExpiry = false;
      });
    }
  }
  if (S.sessionEndsAt) {
    changed = true;
    if (now >= S.sessionEndsAt && !refreshingAfterExpiry) {
      refreshingAfterExpiry = true;
      VI.on = false;
      toast('Session over. Finish a focus block to earn more.');
      refreshPlayer().catch(() => {}).finally(() => {
        refreshingAfterExpiry = false;
      });
    }
  }
  if (changed) bump();
}

/* ---------- system ---------- */
export async function toggleMute() {
  try {
    const d = await patch('/auth/me/', { sound_on: !!S.muted });
    ui.account = d.account;
    S.muted = !d.account.sound_on;
    setMuted(S.muted);
    bump();
  } catch (e) {
    complain(e);
  }
}
