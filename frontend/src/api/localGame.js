/* The game as it runs today: rules and state held in the browser.
   This is the offline stand-in for the /api/v1 endpoints in section 16. M2 and M5 move
   these rules to the server; screens only talk to this module, so they won't need to change much.
   No React and no DOM, so tools/verify_content.mjs and the tests can run it in Node. */
import { S, host, replaceState } from '../../../engines/host.js';
import { fs, HOME, HOST, norm, pad } from '../../../engines/fs/index.js';
import { sh, runLine } from '../../../engines/shell/index.js';
import { COMMANDS, MAN } from '../../../engines/shell/commands.js';
import { VI, viKey } from '../../../engines/vi/index.js';
import { rewindTasks, normA } from '../../../engines/rewind-preview/index.js';
import { TK, TRACKS, CHAPTERS, TICKETS } from '../../../content/legacy/index.mjs';
import { genOncall } from './oncallGen.js';
import { ensureAudio, playLevelUp, playTimerEnd, playUnlock, setMuted } from '../sound/cues.js';

export { S, VI, TK, TRACKS, CHAPTERS, TICKETS };

/* ---------- rules (section 6; thresholds stay on the 100-mission ladder until M7) ---------- */
const KEY = 'uptime-arcade-v3';
export const BANK_CAP = 30 * 60;
const BONUS_CAP = 60 * 60;
const STARTER = 5 * 60;
export const GOAL_BONUS = 2;
export const HINT_COST = 15;
const PAR_BONUS = 20;
const REW_XP = 15;
const REW_FIRST = 5;
export const EARN = { 15: 5, 25: 8, 45: 15 };
export const LEVELS = [[0, 'Noob'], [5, 'Initiate'], [12, 'Apprentice'], [22, 'Operator'], [34, 'Adept'], [46, 'Specialist'], [58, 'Technomancer'], [70, 'Sorcerer'], [85, 'Sage'], [100, 'Archmage']];
export const STREAKS = [[3, 5, 50, 0], [7, 10, 150, 1], [14, 15, 300, 0], [21, 15, 500, 1], [30, 20, 1000, 0], [60, 30, 2000, 1], [100, 30, 5000, 1]];
export const BADGES = [
  ['firstblock', 'First Block', 'Finish a focus block', () => S.blocks >= 1],
  ['clean10', 'Clean Ten', '10 blocks with no drifts', () => S.cleanBlocks >= 10],
  ['hours10', 'Ten Hours', '10 hours of focus', () => S.focusMin >= 600],
  ['hours100', 'Hundred Hours', '100 hours of focus', () => S.focusMin >= 6000],
  ['week', 'Full Week', '7 day streak', () => S.bestStreak >= 7],
  ['month', 'Iron Month', '30 day streak', () => S.bestStreak >= 30],
  ['first', 'First Clear', 'Clear one mission', () => cleared() >= 1],
  ...TRACKS.map(([k, l]) => ['t' + k, l + ' Master', 'Clear the ' + l + ' path', () => TK[k].every((m) => S.rewDone[m.id])]),
  ['arch', 'Archmage', `Clear all ${TICKETS.length} missions`, () => S.peak >= TICKETS.length],
];

/* ---------- small helpers ---------- */
export const mmss = (s) => {
  s = Math.max(0, Math.ceil(s));
  return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
};
const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dayGap = (a, b) => {
  const d = (s) => {
    const [y, m, dd] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, dd);
  };
  return Math.round((d(b) - d(a)) / 864e5);
};

const fresh = () => ({
  v: 3, updatedAt: 0, xp: 0, focusMin: 0, blocks: 0, cleanBlocks: 0, streak: 0, bestStreak: 0, shields: 0, lastDay: null,
  day: dayKey(), todayMin: 0, todayDrifts: 0, bank: STARTER, sessionEndsAt: null, focus: null, claim: null, len: 25,
  cur: null, done: {}, rew: {}, rewDone: {}, hints: {}, cmds: {}, tries: {}, code: {}, viKeys: {}, overlay: {}, cwd: HOME, hist: [],
  net: { gw: '10.40.3.1' }, season: 1, peak: 0, ended: false, claimed: {}, badges: {}, oc: null, ocShift: 0, ocStreak: 0, ocBest: 0, ocTotal: 0,
  ranScript: false, muted: false,
});

/* ---------- transient UI state and change notification ---------- */
export const ui = {
  term: [],
  termVersion: 0,
  toast: null,
  debrief: null,
  overlay: null, // {kind:'level', i} or {kind:'finale'}
  flash: null, // mission id that just unlocked
  rw: { id: null, tasks: null, fb: null, pick: [] },
  py: { state: 'idle' },
};

let version = 0;
const listeners = new Set();
let navigate = () => {};
let toastTimer = null;
let flashTimer = null;

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

export function toast(text) {
  ui.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = null;
    bump();
  }, 3500);
  bump();
}

/* ---------- selectors ---------- */
export const byId = (id) => TICKETS.find((t) => t.id === id);
export const T = () => S.oc || byId(S.cur);
export const trackName = (k) => TRACKS.find((t) => t[0] === k)[1];
export const cleared = () => Object.keys(S.rewDone).length;
export const levelIdx = () => {
  const c = Math.max(cleared(), S.peak);
  let i = 0;
  LEVELS.forEach((l, k) => {
    if (c >= l[0]) i = k;
  });
  return i;
};
export const level = () => LEVELS[levelIdx()][1];
export const sessionOn = () => !!S.sessionEndsAt && Date.now() < S.sessionEndsAt;
export const mult = () => 1 + Math.min(S.streak, 10) * 0.05;
const gain = (x) => {
  const v = Math.round(x * mult());
  S.xp += v;
  return v;
};
export const stateOf = (m) => {
  if (S.rewDone[m.id]) return 'clear';
  if (S.done[m.id]) return 'rewind';
  const p = TK[m.track][m.pos - 1];
  return !p || S.rewDone[p.id] ? 'open' : 'locked';
};
export const nextUp = () => {
  let best = null;
  for (const [k] of TRACKS) {
    const m = TK[k].find((x) => stateOf(x) === 'rewind') || TK[k].find((x) => stateOf(x) === 'open');
    if (m && (!best || (stateOf(m) === 'rewind' && stateOf(best) !== 'rewind') || (stateOf(m) === stateOf(best) && m.pos < best.pos))) best = m;
  }
  return best;
};
export const parText = (t) => (t.parKind === 'keys' ? `${t.par} keys` : t.track === 'SH' || t.kind === 'auto' ? `${t.par} command${t.par > 1 ? 's' : ''}` : 'first try');
export const missionPath = (m) => {
  const st = stateOf(m);
  return st === 'rewind' ? `/missions/${m.id}/rewind` : `/missions/${m.id}`;
};
export const oncallUnlocked = () => cleared() >= TICKETS.length;

/* ---------- saving ---------- */
function migrate(o) {
  if (o && o.v === 3) return o;
  if (!o) return null;
  const n = fresh();
  for (const k of ['xp', 'focusMin', 'blocks', 'streak', 'lastDay', 'bank']) if (o[k] !== undefined) n[k] = o[k];
  n.bestStreak = n.streak;
  return n;
}
function loadLocal() {
  try {
    for (const k of [KEY, 'uptime-arcade-v2']) {
      const r = localStorage.getItem(k);
      if (r) return migrate(JSON.parse(r));
    }
  } catch { /* private window or blocked storage: play without a save */ }
  return null;
}
function save() {
  S.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch { /* see loadLocal */ }
}
function rollDay() {
  const d = dayKey();
  if (S.day !== d) {
    S.day = d;
    S.todayMin = 0;
    S.todayDrifts = 0;
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
  const p = S.cwd === HOME ? '~' : S.cwd.startsWith(HOME + '/') ? '~' + S.cwd.slice(HOME.length) : S.cwd;
  return `ops@${HOST}:${p}$`;
};
export function echoCmd(l) {
  pushSpan(promptText() + ' ', 'pr');
  pushSpan(l + '\n', 'cmd');
}
export function clearTerm() {
  ui.term = [];
  ui.termVersion++;
  bump();
}

/* ---------- commands and missions ---------- */
export const META = new Set(['help', 'man', 'clear', 'brief', 'hint', 'submit', 'status', 'exit']);
const HELP = `Tools: ls cd pwd cat head tail wc grep sort uniq cut tr sed awk find
       mv cp rm mkdir touch tee seq xargs echo paste diff tac rev nl
       for and while loops, if, pipes, >, >>, bash scripts
       vi ip ping dig netplan
Game:  brief        show the mission again
       hint         reveal a hint (costs ${HINT_COST} XP)
       submit X     answer the mission
       man <tool>   short reference for a tool
       status       your level and session time
Keys:  Tab completes, Up and Down recall history, Ctrl+L clears.`;

function meta(a) {
  const c = a[0];
  const t = T();
  if (c === 'help') return pr(HELP);
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
  if (c === 'status') return pr(`${level()}, XP ${S.xp}. Cleared ${cleared()}/${TICKETS.length}. Session left ${mmss((S.sessionEndsAt - Date.now()) / 1000)}.`);
  if (c === 'exit') return pr('Use the Leave button, or close the session in System.', 'd');
  return submit(a.slice(1).join(' '));
}
function answersFor(t) {
  if (t.kind === 'py') return ui.py.state === 'failed' ? [t.tests[0][1]] : null;
  return t.answer || null;
}
export function submit(v) {
  const t = T();
  if (S.done[t.id]) return pr('Already solved.', 'd');
  const ans = answersFor(t);
  if (!ans) return pr(t.kind === 'py' ? 'This mission is graded by Run tests.' : 'This mission completes itself when the goal is met.', 'd');
  if (!v) return termErr('Usage: submit <answer>');
  S.tries[t.id] = (S.tries[t.id] || 0) + 1;
  const n = (s) => s.trim().replace(/\s+/g, ' ').replace(/'/g, '"').replace(/, /g, ',').toLowerCase();
  if (ans.some((a) => n(a) === n(v))) return complete(t);
  pr('Not that one. Check your work and try again.', 'e');
  save();
  return undefined;
}
export function showHint() {
  const t = T();
  if (!t || S.done[t.id]) return;
  const n = S.hints[t.id] || 0;
  if (n >= t.hints.length) {
    pr('No more hints here. Read the lesson again or run man <tool>.', 'd');
    bump();
    return;
  }
  S.hints[t.id] = n + 1;
  pr(`Hint ${n + 1}: ${t.hints[n]}`, 's');
  save();
  bump();
}
export function complete(t) {
  if (t.oc) return completeOc(t);
  if (S.done[t.id]) return undefined;
  const used = S.hints[t.id] || 0;
  let bonus = 0;
  let note = '';
  if (t.kind === 'py' || (t.kind === 'answer' && t.track !== 'SH')) {
    const n = S.tries[t.id] || 1;
    note = n <= 1 ? 'first try' : `${n} tries`;
    if (n <= 1) bonus = PAR_BONUS;
  } else if (t.parKind === 'keys') {
    const k = S.viKeys[t.file] || 0;
    note = `${k} keys, par ${t.par}`;
    if (k <= t.par) bonus = PAR_BONUS;
  } else {
    const c = S.cmds[t.id] || 0;
    note = `${c} command${c === 1 ? '' : 's'}, par ${t.par}`;
    if (c <= t.par) bonus = PAR_BONUS;
  }
  const xp = gain(Math.max(10, t.xp + bonus - used * HINT_COST));
  S.done[t.id] = { xp, note, bonus, hints: used };
  checkBadges();
  save();
  ui.debrief = t.id;
  bump();
  return undefined;
}
export const closeDebrief = () => {
  ui.debrief = null;
  bump();
};
export function leaveMission() {
  S.cur = null;
  save();
  go('/missions');
}
function autoCheck() {
  const t = T();
  if (t && !S.done[t.id] && t.check && t.check()) complete(t);
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
    save();
    bump();
    return;
  }
  const t = T();
  if (t && !S.done[t.id]) S.cmds[t.id] = (S.cmds[t.id] || 0) + 1;
  const buf = [];
  sh.sink = buf;
  sh.errSink = null;
  try {
    runLine(src);
  } catch (x) {
    termErr('sh: ' + x.message);
  }
  sh.sink = null;
  pr(buf.join(''));
  if (VI.on) {
    bump();
    return;
  }
  autoCheck();
  save();
  bump();
}

/** Tab completion for the terminal. Returns the new value and caret, or null if nothing changed. */
export function tabComplete(v, cur) {
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
  autoCheck();
  save();
  bump();
};
export function viPress(key, ctrl) {
  if (!VI.on) return;
  viKey(key, ctrl);
  bump();
}

/* ---------- on-call ---------- */
export function startOncall() {
  if (!oncallUnlocked()) return;
  S.ocShift = 0;
  S.oc = genOncall();
  S.cur = null;
  pr('Pager: shift started. Five incidents, 60 XP each, plus 100 XP when you clear the shift.', 's');
  save();
  bump();
}
function completeOc(t) {
  const first = (S.tries[t.id] || 1) <= 1;
  S.ocStreak = first ? S.ocStreak + 1 : 0;
  S.ocBest = Math.max(S.ocBest, S.ocStreak);
  S.ocTotal++;
  S.ocShift++;
  gain(t.xp);
  delete S.tries[t.id];
  delete S.hints[t.id];
  delete S.cmds[t.id];
  pr(`[ok] Incident resolved. First-try streak ${S.ocStreak}, best ${S.ocBest}.\nHow it works: ${t.why}`, 'k');
  if (S.ocShift >= 5) {
    gain(100);
    S.oc = null;
    pr('Shift complete: +100 XP.', 's');
    toast('Shift complete');
    go('/missions');
  } else {
    S.oc = genOncall();
  }
  save();
  bump();
}

/* ---------- rewind ---------- */
export function startRewind(id) {
  const rw = ui.rw;
  if (rw.id !== id || !rw.tasks) {
    rw.id = id;
    rw.tasks = rewindTasks(byId(id), TK);
    rw.fb = null;
    rw.pick = [];
  }
  S.rew[id] = S.rew[id] || { q: [0, 1, 2, 3, 4], ok: 0, miss: {} };
}
export function answerRewind(val) {
  const rw = ui.rw;
  const st = S.rew[rw.id];
  const i = st.q[0];
  const t = rw.tasks[i];
  let ok;
  if (t.type === 'mc') ok = val === t.answer;
  else if (t.type === 'order') ok = val.join('\n') === t.answer.join('\n');
  else ok = t.answer.some((a) => normA(a) === normA(val));
  if (ok) {
    const x = gain(REW_XP + (st.miss[i] ? 0 : REW_FIRST));
    st.q.shift();
    st.ok++;
    rw.fb = { ok: true, x };
  } else {
    st.miss[i] = 1;
    st.q.push(st.q.shift());
    rw.fb = { ok: false, answer: t.type === 'order' ? t.answer.join('\n') : Array.isArray(t.answer) ? t.answer[0] : t.answer };
  }
  rw.pick = [];
  save();
  bump();
}
export function afterRewindStep() {
  const rw = ui.rw;
  rw.fb = null;
  if (!S.rew[rw.id].q.length) return finishRewind();
  bump();
  return undefined;
}
export function pickOrder(o) {
  const rw = ui.rw;
  rw.pick.push(o);
  const t = rw.tasks[S.rew[rw.id].q[0]];
  if (rw.pick.length === t.scrambled.length) answerRewind([...rw.pick]);
  else bump();
}
export function unpickOrder(i) {
  ui.rw.pick.splice(i, 1);
  bump();
}
function finishRewind() {
  const id = ui.rw.id;
  const m = byId(id);
  const before = levelIdx();
  S.rewDone[id] = true;
  delete S.rew[id];
  S.peak = Math.max(S.peak, cleared());
  S.cur = null;
  ui.rw = { id: null, tasks: null, fb: null, pick: [] };
  checkBadges();
  save();
  const nx = TK[m.track][m.pos + 1];
  go('/missions');
  if (nx) {
    ui.flash = nx.id;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      ui.flash = null;
      bump();
    }, 1600);
    playUnlock();
  }
  toast(nx ? `Unlocked: ${nx.title}` : `${trackName(m.track)} path complete`);
  if (levelIdx() !== before) {
    ui.overlay = { kind: 'level', i: levelIdx() };
    playLevelUp();
  }
  if (cleared() === TICKETS.length && !S.ended) {
    S.ended = true;
    save();
    ui.overlay = { kind: 'finale' };
  }
  bump();
}
export const closeOverlay = () => {
  ui.overlay = null;
  bump();
};

/* ---------- focus and sessions ---------- */
export function setLen(n) {
  S.len = n;
  save();
  bump();
}
export function startBlock(goal) {
  const g = goal.trim();
  if (!g) return;
  ensureAudio();
  if (S.sessionEndsAt) closeSession(true);
  const now = Date.now();
  S.focus = { goal: g, len: S.len, startedAt: now, endsAt: now + S.len * 60000, drifts: 0 };
  save();
  bump();
}
export function logDrift() {
  if (!S.focus) return;
  S.focus.drifts++;
  S.todayDrifts++;
  save();
  bump();
}
export function abandonBlock() {
  S.focus = null;
  toast('Block ended early. Nothing earned.');
  save();
  bump();
}
export function closeSession(quiet) {
  if (!S.sessionEndsAt) return;
  S.bank = Math.min(BONUS_CAP, Math.round(Math.max(0, (S.sessionEndsAt - Date.now()) / 1000)));
  S.sessionEndsAt = null;
  VI.on = false;
  if (!quiet) toast('Session closed. Time banked.');
  save();
  bump();
}
export function openSession() {
  if (S.focus || S.claim || S.bank <= 0) return;
  ensureAudio();
  S.sessionEndsAt = Date.now() + S.bank * 1000;
  S.bank = 0;
  save();
  bump();
}
function bumpStreak() {
  const d = dayKey();
  if (S.lastDay === d) return;
  const gap = S.lastDay ? dayGap(S.lastDay, d) : 1;
  if (gap === 1) S.streak++;
  else if (gap > 1 && S.shields >= gap - 1) {
    S.shields -= gap - 1;
    S.streak++;
    toast(`Streak shield used. ${gap - 1} missed day${gap > 2 ? 's' : ''} covered.`);
  } else S.streak = 1;
  S.lastDay = d;
  S.bestStreak = Math.max(S.bestStreak, S.streak);
  for (const [n, mins, xp, sh2] of STREAKS) {
    if (S.streak >= n && !S.claimed[n]) {
      S.claimed[n] = true;
      S.bank = Math.min(BONUS_CAP, S.bank + mins * 60);
      S.xp += xp;
      S.shields += sh2;
      toast(`${n} day streak reward: +${mins} min, +${xp} XP${sh2 ? ', +1 shield' : ''}`);
    }
  }
}
export function claimBlock(done) {
  const c = S.claim;
  if (!c) return;
  const earn = EARN[c.len] * 60 + (done ? GOAL_BONUS * 60 : 0);
  S.bank = Math.max(S.bank, Math.min(BANK_CAP, S.bank + earn));
  toast(`+${mmss(earn)} play time`);
  S.focusMin += c.len;
  S.blocks++;
  S.todayMin += c.len;
  if (!c.drifts) S.cleanBlocks++;
  bumpStreak();
  gain(c.len + (done ? 10 : 0));
  S.claim = null;
  checkBadges();
  save();
  bump();
}
function checkBadges() {
  for (const [id, name, , test] of BADGES) {
    if (!S.badges[id] && test()) {
      S.badges[id] = true;
      toast('Badge earned: ' + name);
    }
  }
}
export function tick() {
  const now = Date.now();
  rollDay();
  let changed = false;
  if (S.focus) {
    changed = true;
    if (now >= S.focus.endsAt) {
      S.claim = { goal: S.focus.goal, len: S.focus.len, drifts: S.focus.drifts };
      S.focus = null;
      playTimerEnd();
      save();
      go('/focus');
    }
  }
  if (S.sessionEndsAt) {
    changed = true;
    if (now >= S.sessionEndsAt) {
      S.sessionEndsAt = null;
      S.bank = 0;
      VI.on = false;
      toast('Session over. Finish a focus block to earn more.');
      save();
    }
  }
  if (changed) bump();
}

/* ---------- system ---------- */
export function newSeason() {
  Object.assign(S, {
    cur: null, done: {}, rew: {}, rewDone: {}, hints: {}, cmds: {}, tries: {}, code: {}, viKeys: {}, overlay: {}, cwd: HOME,
    net: { gw: '10.40.3.1' }, oc: null, ended: false, ranScript: false, season: S.season + 1,
  });
  fs.reset({});
  ui.rw = { id: null, tasks: null, fb: null, pick: [] };
  toast(`Season ${S.season} started`);
  save();
  go('/missions');
}
export function exportSave() {
  return { filename: `uptime-arcade-save-${dayKey()}.json`, data: JSON.stringify(S) };
}
export function importSave(text) {
  // Check the raw file: migrate() fills in defaults, so any JSON would pass afterwards and wipe the save.
  const raw = JSON.parse(text);
  if (!raw || typeof raw.xp !== 'number') throw new Error('not a save');
  const o = migrate(raw);
  o.sessionEndsAt = null;
  adopt(o);
  save();
}
function adopt(o) {
  replaceState({ ...fresh(), ...o });
  rollDay();
  fs.reset(S.overlay);
  setMuted(S.muted);
  bump();
}
export function toggleMute() {
  S.muted = !S.muted;
  setMuted(S.muted);
  save();
  bump();
}
export function setCurrent(id) {
  if (S.cur !== id) {
    S.cur = id;
    S.oc = null;
  }
}
export function saveCode(t, src) {
  S.code[t.id] = src;
  save();
}
export function notePyAttempt(t) {
  if (!S.done[t.id]) S.tries[t.id] = (S.tries[t.id] || 0) + 1;
  save();
}

/* ---------- boot ---------- */
export function boot(saved = loadLocal()) {
  replaceState(saved ? { ...fresh(), ...saved } : fresh());
  rollDay();
  fs.reset(S.overlay);
  setMuted(S.muted);
  ui.term = [];
  pr("Whiteraven operator console. Your account is 'ops'.\nRun 'help' for the tools on this box.\n", 'd');
}
