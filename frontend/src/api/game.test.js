import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as g from './game.js';

const { S, ui } = g;
const json = (status, body) => ({ status, ok: status < 400, json: async () => body });

const PLAYER = (over = {}) => ({
  avatar: { kind: 'system', index: 3 },
  server_time: new Date().toISOString(), username: 'amina', display_name: 'Amina', sound_on: true, time_zone: 'Africa/Nairobi',
  today_minutes: 0, today_drifts: 0, focus_minutes: 0, blocks_finished: 0, xp: 0,
  level: { index: 1, title: 'Noob', cleared: 0, next_title: 'Initiate', next_at: 8 },
  bank_seconds: 300, session: null, block: null, streak: 0, best_streak: 0, shields: 0, multiplier: 1, season: 1, badges: 0, ...over,
});
const card = (code, order, state, extra = {}) => ({ code, chapter: 'Basics', order, title: `Mission ${code}`, difficulty: 'easy', xp: 100, state, answered: 0, ...extra });
const TRACKS = (first = 'open') => ({
  season: 1,
  difficulties: [{ code: 'easy', label: 'Easy' }, { code: 'brainfuck', label: 'Brainfuck' }],
  tracks: [
    { code: 'NET', name: 'Networking', subtitle: 's', after_archmage: false, missions: [card('net-01', 1, first), card('net-02', 2, first === 'cleared' ? 'open' : 'locked')] },
    { code: 'BX', name: 'Beyond', subtitle: 'b', after_archmage: true, missions: [card('bx-01', 1, 'locked')] },
  ],
});
const PLAN_STATUS = { plan: { days: [0], blocks_per_day: 2, block_minutes: 25, daily_minutes: 50, windows: [{ start: '08:00', end: '10:00' }], time_zone: 'Africa/Nairobi', effective_from: '2026-11-02' }, pending: null, changes_open_on: null, today: {}, outlook: { 15: 'plan', 25: 'plan', 45: 'free' }, targets: {}, limits: {} };
const REWARDS = { config: { earn_seconds: { 15: 300, 25: 480, 45: 900 }, goal_bonus_seconds: 120, bank_cap: 1800, hint_cost: 15, rewind_reveal_after: 3 }, streak: [{ days: 3, seconds: 300, xp: 50, shields: 0, claimed: false }], levels: [{ index: 1, title: 'Noob', cleared: 0, reached: true }, { index: 2, title: 'Initiate', cleared: 8, reached: false }, { index: 3, title: 'Apprentice', cleared: 19, reached: false }], badges: [{ code: 'first', name: 'First Clear', description: 'x', earned_at: null }] };
const BRIEF = (code, check = 'answer') => ({ state: 'open', code, track: 'NET', skill: 'networking', title: 'T', from_dept: 'N', difficulty: 'easy', xp: 100, check_type: check, par_kind: check === 'fs' ? 'commands' : 'first-try', par_value: 1, lesson: { text: 'l', example: 'e' }, brief: 'b', goal: 'g' });
const PLAY = (extra = {}) => ({ code: 'net-01', state: 'open', check_type: 'answer', workspace: {}, hints: [], hints_total: 2, ...extra });

let routes;
let calls;
function server(extra = {}) {
  calls = [];
  routes = {
    'POST /auth/refresh/': () => json(200, { access: 'tok' }),
    'POST /auth/login/': () => json(200, { access: 'tok', account: { username: 'amina', email: 'a@x.test', time_zone: 'Africa/Nairobi', sound_on: true } }),
    'GET /auth/me/': () => json(200, { account: { username: 'amina', email: 'a@x.test', time_zone: 'Africa/Nairobi', sound_on: true } }),
    'GET /player/': () => json(200, PLAYER()),
    'GET /tracks/': () => json(200, TRACKS()),
    'GET /rewards/': () => json(200, REWARDS),
    'GET /focus/plan/': () => json(200, PLAN_STATUS),
    'GET /fixtures/': () => json(200, { version: 1, files: [{ path: '/home/ops/README', content: 'hi\n', mode: 420 }] }),
    'GET /missions/net-01/': () => json(200, BRIEF('net-01')),
    'GET /missions/net-01/play/': () => json(200, PLAY()),
    'GET /missions/net-01/debrief/': () => json(200, { why: 'because', solution: 'submit 32', job: 'j', xp_on_clear: 120, par_bonus: 20, xp_awarded: 0 }),
    ...extra,
  };
  vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
    const path = url.replace('/api/v1', '');
    const key = `${opts.method || 'GET'} ${path}`;
    calls.push({ key, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (!routes[key]) throw new Error(`no route for ${key}`);
    return routes[key](opts.body ? JSON.parse(opts.body) : undefined);
  }));
}
const openSessionPlayer = () => PLAYER({ session: { expires_at: new Date(Date.now() + 300000).toISOString(), seconds_left: 300 }, bank_seconds: 0 });

beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  g.setNavigator(() => {});
  g.clearToasts();
  g.closeDebrief();
  g.closeOverlay();
  g.leaveCurrent();
  server();
  await g.boot();
});

describe('signing in', () => {
  it('asks for a login when there is no valid refresh cookie', async () => {
    server({ 'POST /auth/refresh/': () => json(401, { error: { code: 'not_logged_in', message: 'x' } }) });
    await g.boot();
    expect(ui.auth).toBe('out');
  });
  it('goes straight in with a valid cookie', () => {
    expect(ui.auth).toBe('in');
    expect(ui.account.username).toBe('amina');
  });
  it('signs out when the session dies mid-game', async () => {
    server({
      'GET /player/': () => json(401, { error: { code: 'not_authenticated', message: 'x' } }),
      'POST /auth/refresh/': () => json(401, { error: { code: 'not_logged_in', message: 'x' } }),
    });
    await g.refreshPlayer().catch(() => {});
    expect(ui.auth).toBe('out');
  });
});

describe('the server is the source of truth', () => {
  it('shows what the server says about XP, bank and level', async () => {
    server({ 'GET /player/': () => json(200, PLAYER({ xp: 777, bank_seconds: 90, level: { index: 3, title: 'Apprentice', cleared: 20, next_title: 'Operator', next_at: 34 } })) });
    await g.refreshPlayer();
    expect(S.xp).toBe(777);
    expect(S.bank).toBe(90);
    expect(g.level()).toBe('Apprentice');
  });
  it('runs countdowns on the server clock, even if this device is wrong', async () => {
    const serverNow = Date.now() + 3600000; // this device's clock is an hour slow
    server({ 'GET /player/': () => json(200, PLAYER({ server_time: new Date(serverNow).toISOString(), session: { expires_at: new Date(serverNow + 60000).toISOString(), seconds_left: 60 } })) });
    await g.refreshPlayer();
    const left = (S.sessionEndsAt - Date.now()) / 1000;
    expect(left).toBeGreaterThan(58);
    expect(left).toBeLessThanOrEqual(60.5);
  });
  it('treats a block the server says has ended as ready to claim', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    server({ 'GET /player/': () => json(200, PLAYER({ block: { id: 7, goal: 'x', minutes: 25, started_at: past, ends_at: past, drifts: 0 } })) });
    await g.refreshPlayer();
    expect(S.claim.id).toBe(7);
    expect(S.focus).toBeNull();
  });
  it('maps server states onto the screens', () => {
    expect(g.stateOf({ state: 'solved' })).toBe('rewind');
    expect(g.stateOf({ state: 'cleared' })).toBe('clear');
    expect(g.stateOf({ state: 'locked' })).toBe('locked');
  });
  it('keeps Beyond out of the level count', () => {
    expect(g.TICKETS.map((m) => m.id)).toEqual(['net-01', 'net-02']);
    expect(g.BEYOND[0]).toBe('BX');
  });
  it('holds no mission answers in its source', () => {
    const src = readFileSync(new URL('./game.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/content\/index|catalogue/);
  });
});

describe('answering a mission', () => {
  const play = async () => {
    server({ 'GET /player/': () => json(200, openSessionPlayer()), 'POST /missions/net-01/submit/': (b) => json(200, b.answer === '32' ? { result: 'pass', tries: 1, par_bonus: 20, xp_on_clear: 120, events: [] } : { result: 'fail', tries: 1, events: [] }) });
    await g.refreshPlayer();
    await g.enterMission('net-01');
  };
  it('asks the server, and shows only what it says', async () => {
    await play();
    g.runCommand('submit 31');
    await vi.waitFor(() => expect(calls.some((c) => c.key === 'POST /missions/net-01/submit/')).toBe(true));
    await vi.waitFor(() => expect(ui.term.map((s) => s.t).join('')).toContain('Not that one'));
    expect(ui.debrief).toBeNull();
  });
  it('only learns the solution after solving', async () => {
    await play();
    expect(calls.some((c) => c.key.includes('debrief'))).toBe(false);
    g.runCommand('submit 32');
    await vi.waitFor(() => expect(ui.debrief?.solution).toBe('submit 32'));
    expect(ui.debrief.worth).toBe(120);
  });
});

describe('terminal goals', () => {
  const play = async () => {
    server({
      'GET /player/': () => json(200, openSessionPlayer()),
      'GET /missions/net-01/': () => json(200, BRIEF('net-01', 'fs')),
      'GET /missions/net-01/play/': () => json(200, PLAY({ check_type: 'fs' })),
      'POST /missions/net-01/check/': (b) => json(200, b.state.cwd === '/home/ops/logs' ? { result: 'pass', tries: 1, par_bonus: 0, xp_on_clear: 100, events: [] } : { result: 'fail', tries: 0, events: [] }),
    });
    g.leaveCurrent();
    delete ui.briefings['net-01'];
    await g.refreshPlayer();
    await g.enterMission('net-01');
  };
  it('reports the machine to the server after each command', async () => {
    await play();
    g.runCommand('pwd');
    await vi.waitFor(() => expect(calls.filter((c) => c.key.endsWith('/check/')).length).toBe(1));
    const { body } = calls.find((c) => c.key.endsWith('/check/'));
    expect(body.state.cwd).toBe('/home/ops');
    expect(body.commands).toBe(1);
  });
  it('sends nothing for answer missions', async () => {
    g.leaveCurrent();
    delete ui.briefings['net-01'];
    server({ 'GET /player/': () => json(200, openSessionPlayer()) });
    await g.refreshPlayer();
    await g.enterMission('net-01');
    g.runCommand('pwd');
    await new Promise((r) => { setTimeout(r, 10); });
    expect(calls.some((c) => c.key.endsWith('/check/'))).toBe(false);
  });
});

describe('the rewind', () => {
  const task = (extra = {}) => ({ type: 'mc', level: 'easy', label: 'L', q: 'Q1', options: ['a', 'b'], ...extra });
  const begin = async (answers) => {
    server({
      'GET /missions/net-01/rewind/': () => json(200, { state: 'solved', correct: 0, total: 5, task: task(), xp_on_clear: 120 }),
      'POST /missions/net-01/rewind/answer/': answers,
    });
    ui.rw = { id: null };
    await g.startRewind('net-01');
  };
  it('never receives an answer with a task', async () => {
    await begin(() => json(200, { correct: false, state: 'solved', done: 0, total: 5, task: task({ q: 'Q2' }), events: [] }));
    expect(ui.rw.task.answer).toBeUndefined();
    expect(g.rewindHelp()).toEqual({ hint: null, answer: null });
  });
  it('shows the next question straight away, with no extra step', async () => {
    await begin(() => json(200, { correct: true, state: 'solved', done: 1, total: 5, task: task({ q: 'Q2' }), events: [] }));
    await g.answerRewind('a');
    expect(ui.rw.task.q).toBe('Q2');
    expect(ui.rw.fb.ok).toBe(true);
    expect(ui.rw.correct).toBe(1);
  });
  it('says when the same question has come straight back', async () => {
    await begin(() => json(200, { correct: false, state: 'solved', done: 4, total: 5, task: task({ hint: 'h' }), events: [] }));
    await g.answerRewind('b');
    expect(ui.rw.fb).toEqual({ ok: false, again: true, hint: true });
  });
  it("doesn't let a double click answer the next question unread", async () => {
    let n = 0;
    await begin(() => {
      n += 1;
      return json(200, { correct: true, state: 'solved', done: n, total: 5, task: task({ q: `Q${n + 1}` }), events: [] });
    });
    await g.answerRewind('a');
    await g.answerRewind('a');
    expect(n).toBe(1);
  });
  it('shows no XP or answer on a wrong attempt', async () => {
    await begin(() => json(200, { correct: false, state: 'solved', done: 0, total: 5, task: task({ q: 'Q2' }), events: [] }));
    await g.answerRewind('a');
    expect(ui.rw.fb.ok).toBe(false);
    expect(S.xp).toBe(0);
  });
  describe('a new lab opening', () => {
    const preview = { devices: [{ name: 'PC-1', kind: 'pc', x: 10, y: 10 }], cables: [] };
    const finish = (events) => begin(() => json(200, { correct: true, state: 'cleared', done: 5, total: 5, task: null, xp: 120, events })).then(() => g.answerRewind('a'));
    it('gets its own moment, with what was just earned', async () => {
      await finish([{ type: 'cleared', mission: 'net-01', xp: 120 }, { type: 'unlocked', mission: 'net-02', preview }]);
      expect(ui.overlay).toEqual({ kind: 'unlock', mission: 'net-02', preview, xp: 120 });
      g.closeOverlay();
      expect(ui.overlay).toBeNull();
    });
    it('waits its turn behind a level-up', async () => {
      await finish([{ type: 'cleared', mission: 'net-01', xp: 120 }, { type: 'level_up', level: 2, title: 'Initiate' }, { type: 'unlocked', mission: 'net-02', preview }]);
      expect(ui.overlay.kind).toBe('level');
      g.closeOverlay();
      expect(ui.overlay.kind).toBe('unlock');
    });
    it('a mission with no preview stays a quiet toast', async () => {
      await finish([{ type: 'unlocked', mission: 'net-02' }]);
      expect(ui.overlay).toBeNull();
      expect(ui.flash).toBe('net-02');
    });
    it('says what a lab is still waiting for', async () => {
      ui.flash = null;
      await finish([{ type: 'lab_waiting', mission: 'net-02', needs: 'net-31', needs_title: 'How a switch learns' }]);
      expect(ui.flash).not.toBe('net-02');
      expect(ui.toast).toContain('How a switch learns (NET-31)');
    });
    it('later goes back to that track, with the new one popping in', async () => {
      await finish([{ type: 'unlocked', mission: 'net-02', preview }]);
      g.leaveReveal('net-02');
      expect(ui.overlay).toBeNull();
      expect(ui.openTrack).toBe('NET');
      expect(ui.flash).toBe('net-02');
    });
  });
  it('shows the hint and answer only when the server sends them', async () => {
    await begin(() => json(200, { correct: false, state: 'solved', done: 0, total: 5, task: task({ hint: 'look here', reveal: 'a' }), events: [] }));
    await g.answerRewind('b');
    expect(ui.rw.fb.hint).toBe(true);
    expect(g.rewindHelp()).toEqual({ hint: 'look here', answer: 'a' });
  });
  it('finishes by itself, plays the events and reopens the category', async () => {
    const navigate = vi.fn();
    g.setNavigator(navigate);
    await begin(() => json(200, { correct: true, state: 'cleared', done: 5, total: 5, task: null, xp: 120, events: [{ type: 'cleared', mission: 'net-01', xp: 120 }, { type: 'level_up', level: 2, title: 'Initiate' }, { type: 'unlocked', mission: 'net-02' }] }));
    await g.answerRewind('a');
    expect(navigate).toHaveBeenCalledWith('/missions');
    expect(ui.overlay).toEqual({ kind: 'level', i: 1 });
    expect(ui.flash).toBe('net-02');
    expect(ui.toast).toContain('XP');
    expect(ui.openTrack).toBe('NET');
  });
});

describe('tracks that are on the way', () => {
  it('keeps them out of the paths, and says what opens them', async () => {
    const data = TRACKS();
    data.season = 1;
    data.tracks.push({ code: 'LAB', name: 'NetLab', subtitle: 'x', after_archmage: false, requires: 'net-11', locked_because: 'Clear net-11 first.', missions: [] });
    server({ 'GET /tracks/': () => json(200, data) });
    await g.boot();
    expect(g.TRACKS.map((t) => t[0])).toEqual(['NET']);
    expect(g.COMING[0]).toMatchObject({ code: 'LAB', lockedBecause: 'Clear net-11 first.' });
    expect(g.TK.LAB).toBeUndefined();
  });
});

describe('revisiting', () => {
  const again = async (body) => {
    server({
      'GET /player/': () => json(200, openSessionPlayer()),
      'GET /missions/net-01/': () => json(200, { ...BRIEF('net-01', 'fs'), state: 'cleared' }),
      'GET /missions/net-01/play/': () => json(200, PLAY({ state: 'cleared', check_type: 'fs', hints: ['a', 'b'] })),
      'POST /missions/net-01/check/': () => json(200, body),
    });
    g.leaveCurrent();
    delete ui.briefings['net-01'];
    await g.refreshPlayer();
    S.overlay['/home/ops/mine.txt'] = { t: 'f', c: 'keep me', m: 420 };
    await g.enterMission('net-01');
  };
  it('plays on a clean machine and gives yours back after', async () => {
    await again({ result: 'fail', revisit: true, tries: 0, events: [] });
    expect(ui.current.revisit).toBe(true);
    expect(S.overlay['/home/ops/mine.txt']).toBeUndefined();
    g.leaveCurrent();
    expect(S.overlay['/home/ops/mine.txt'].c).toBe('keep me');
  });
  it('shows no debrief and pays nothing when solved again', async () => {
    await again({ result: 'pass', revisit: true, tries: 0, events: [] });
    g.runCommand('pwd');
    await vi.waitFor(() => expect(ui.term.map((s) => s.t).join('')).toContain('Right again'));
    expect(ui.debrief).toBeNull();
    g.leaveCurrent();
  });
  it('has all its hints free', async () => {
    await again({ result: 'fail', revisit: true, tries: 0, events: [] });
    expect(ui.current.hintsShown).toEqual(['a', 'b']);
    g.leaveCurrent();
  });
});

describe('your picture', () => {
  it('sends an upload as a file, with no JSON header', async () => {
    server({ 'POST /auth/avatar/': () => json(201, { avatar: { kind: 'upload', url: '/api/v1/avatars/x.webp', index: 1 } }) });
    let sent;
    const inner = fetch;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      sent = opts;
      return json(201, { avatar: { kind: 'upload', url: '/api/v1/avatars/x.webp', index: 1 } });
    }));
    await g.uploadAvatar(new File(['x'], 'me.png', { type: 'image/png' }));
    expect(sent.body).toBeInstanceOf(FormData);
    expect(sent.headers['Content-Type']).toBeUndefined();
    expect(ui.account.avatar.kind).toBe('upload');
    vi.stubGlobal('fetch', inner);
  });
});

describe('NetLab', () => {
  const LAB = { devices: [{ name: 'PC-1', kind: 'pc', x: 20, y: 50 }, { name: 'PC-2', kind: 'pc', x: 80, y: 50 }, { name: 'ISP', kind: 'router', x: 50, y: 10, locked: true }], cables: [['PC-1', 'eth0', 'PC-2', 'eth0']] };
  const BRIEF_LAB = { ...BRIEF('lab-01', 'net'), track: 'LAB' };
  const labServer = (extra = {}) => {
    server({
      'GET /player/': () => json(200, openSessionPlayer()),
      'GET /missions/lab-01/': () => json(200, BRIEF_LAB),
      'GET /missions/lab-01/play/': () => json(200, { code: 'lab-01', state: 'open', check_type: 'net', workspace: { lab: LAB, goals: ['They can ping'] }, hints: [], hints_total: 2 }),
      'GET /netlab/lab-01/state/': () => json(200, { state: null }),
      ...extra,
    });
    return g.refreshPlayer().then(() => g.enterMission('lab-01'));
  };
  it('opens consoles for your devices only', async () => {
    await labServer();
    expect(ui.lab.device).toBe('PC-1');
    expect(Object.keys(ui.lab.consoles)).toEqual(['PC-1', 'PC-2']);
    g.leaveCurrent();
  });
  it('runs commands here, straight away, with nothing sent', async () => {
    await labServer();
    const before = calls.length;
    g.labRun('ip addr add 10.0.0.1/24 dev eth0');
    expect(ui.lab.lab.configOf('PC-1')).toContain('10.0.0.1/24');
    expect(calls.length).toBe(before);
    expect(S.cmds['lab-01']).toBeGreaterThan(0);
    g.leaveCurrent();
  });
  it('sends only the configs and a command count to be checked', async () => {
    await labServer({ 'POST /missions/lab-01/submit/': () => json(200, { result: 'fail', tries: 0, events: [], goals: [{ label: 'They can ping', ok: false, why: 'No' }] }) });
    g.labRun('ip addr add 10.0.0.1/24 dev eth0');
    await g.labCheck();
    const body = calls.find((c) => c.key === 'POST /missions/lab-01/submit/').body;
    expect(Object.keys(body).sort()).toEqual(['commands', 'state']);
    expect(Object.keys(body.state.devices).sort()).toEqual(['PC-1', 'PC-2']); // not the ISP
    expect(ui.lab.results[0].why).toBe('No');
    g.leaveCurrent();
  });
  it('picks up where you left off', async () => {
    await labServer({ 'GET /netlab/lab-01/state/': () => json(200, { state: { devices: { 'PC-1': { running: 'ip addr add 10.9.9.9/24 dev eth0', startup: '' } } } }) });
    expect(ui.lab.lab.configOf('PC-1')).toContain('10.9.9.9/24');
    g.leaveCurrent();
  });
  it('saves shortly after a change, and at once on leaving', async () => {
    await labServer({ 'PUT /netlab/lab-01/state/': () => json(200, { saved: true }) });
    g.labRun('ip addr add 10.0.0.1/24 dev eth0');
    expect(calls.some((c) => c.key === 'PUT /netlab/lab-01/state/')).toBe(false);
    g.leaveCurrent();
    expect(calls.some((c) => c.key === 'PUT /netlab/lab-01/state/')).toBe(true);
  });
  it('resets to the start and forgets the save', async () => {
    await labServer({ 'DELETE /netlab/lab-01/state/': () => json(204, {}) });
    g.labRun('ip addr add 10.0.0.1/24 dev eth0');
    await g.labReset();
    expect(ui.lab.lab.configOf('PC-1')).not.toContain('10.0.0.1');
    expect(calls.some((c) => c.key === 'DELETE /netlab/lab-01/state/')).toBe(true);
    g.leaveCurrent();
  });
  it('a replay needs no session, and pauses a running one', async () => {
    let player = openSessionPlayer();
    const data = TRACKS('cleared');
    server({
      'GET /player/': () => json(200, player),
      'GET /tracks/': () => json(200, data),
      'POST /sessions/close/': () => { player = PLAYER({ session: null, bank_seconds: 280 }); return json(200, { returned_seconds: 280, bank_seconds: 280, events: [] }); },
      'GET /missions/net-01/play/': () => json(200, { ...PLAY(), state: 'cleared' }),
    });
    await g.boot();
    await g.refreshPlayer();
    expect(g.sessionOn()).toBe(true);
    await g.enterMission('net-01');
    expect(calls.some((c) => c.key === 'POST /sessions/close/')).toBe(true);
    expect(g.sessionOn()).toBe(false);
    expect(ui.current.revisit).toBe(true);
    expect(g.canPlay()).toBe(true);
    g.leaveCurrent();
  });
  it('a replay still waits for a focus block', async () => {
    const data = TRACKS('cleared');
    const future = new Date(Date.now() + 600000).toISOString();
    server({ 'GET /player/': () => json(200, PLAYER({ block: { id: 7, goal: 'x', minutes: 25, kind: 'plan', started_at: future, ends_at: future, claim_by: future, drifts: 0, presence: 'waiting', check_expires_at: null } })), 'GET /tracks/': () => json(200, data) });
    await g.boot();
    await g.refreshPlayer();
    await g.enterMission('net-01');
    expect(ui.current.ready).toBe(false);
    expect(g.canPlay()).toBe(false);
    expect(calls.some((c) => c.key === 'GET /missions/net-01/play/')).toBe(false);
    g.leaveCurrent();
  });
  it('a drill loads what the server broke, and only says what when asked', async () => {
    await labServer({ 'POST /netlab/lab-01/drill/': () => json(201, { state: { devices: { 'PC-1': { running: 'ip addr add 10.1.1.1/24 dev eth0', startup: '' } } }, count: 2 }), 'GET /netlab/lab-01/drill/': () => json(200, { faults: [{ device: 'PC-1', explain: 'PC-1: its address changed' }] }) });
    await g.labStartDrill(2);
    expect(ui.lab.lab.configOf('PC-1')).toContain('10.1.1.1/24');
    expect(ui.lab.drill).toMatchObject({ count: 2, faults: null });
    await g.labRevealDrill();
    expect(ui.lab.drill.faults[0].explain).toMatch(/address/);
    g.leaveCurrent();
  });
  it('a replay can pass and still be played again', async () => {
    await labServer({ 'POST /missions/lab-01/submit/': () => json(200, { result: 'pass', revisit: true, tries: 0, events: [], goals: [{ label: 'They can ping', ok: true, why: '' }] }) });
    await g.labCheck();
    expect(ui.current.solved).toBeFalsy();
    expect(ui.debrief).toBeNull();
    g.leaveCurrent();
  });
  describe('the sandbox', () => {
    const open = (extra = {}) => {
      server({ 'GET /netlab/sandbox/': () => json(200, { topology: null, state: null }), 'PUT /netlab/sandbox/': () => json(200, { saved: true }), 'DELETE /netlab/sandbox/': () => json(204, {}), ...extra });
      return g.enterSandbox();
    };
    it('starts empty and adds devices with their own names', async () => {
      await open();
      g.sandboxAdd('pc');
      g.sandboxAdd('pc');
      g.sandboxAdd('ap');
      expect([...ui.lab.lab.devices.keys()]).toEqual(['PC-1', 'PC-2', 'AP-1']);
      expect(ui.lab.device).toBe('AP-1');
      g.leaveCurrent();
    });
    it('needs no session to use a console', async () => {
      await open();
      g.sandboxAdd('pc');
      g.labRun('ip addr add 10.0.0.1/24 dev eth0');
      expect(ui.lab.lab.configOf('PC-1')).toContain('10.0.0.1/24');
      g.leaveCurrent();
    });
    it('saves only what each device is made of', async () => {
      await open();
      g.sandboxAdd('router');
      g.leaveCurrent();
      const body = calls.find((c) => c.key === 'PUT /netlab/sandbox/').body;
      expect(Object.keys(body.topology.devices[0]).sort()).toEqual(['kind', 'name', 'x', 'y']);
    });
    it('breaks something once two machines are talking, and tells you what if you ask', async () => {
      await open();
      g.sandboxAdd('pc');
      g.sandboxBreak();
      expect(ui.lab.message).toMatch(/talking/);
      g.sandboxAdd('pc');
      ui.lab.lab.plug('PC-1', 'eth0', 'PC-2', 'eth0');
      ui.lab.lab.run('PC-1', 'ip addr add 10.0.0.1/24 dev eth0');
      ui.lab.lab.run('PC-2', 'ip addr add 10.0.0.2/24 dev eth0');
      g.sandboxBreak();
      expect(ui.lab.faults).toHaveLength(1);
      g.sandboxTest();
      expect(ui.lab.tests.some((r) => !r.ok)).toBe(true);
      expect(ui.lab.showFaults).toBe(false);
      g.leaveCurrent();
    });
  });
  it('keeps a track card\'s reason for being shut', async () => {
    const data = TRACKS();
    data.tracks[0].missions[1].locked_because = 'Clear VLANs (NET-33) in Networking first.';
    server({ 'GET /tracks/': () => json(200, data) });
    await g.boot();
    expect(g.byId('net-02').lockedBecause).toContain('NET-33');
  });
});

describe('focus', () => {
  it('claims through the server and waits if this clock runs ahead', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    server({
      'GET /player/': () => json(200, PLAYER({ block: { id: 7, goal: 'x', minutes: 25, started_at: past, ends_at: past, drifts: 0 } })),
      'POST /focus/blocks/7/claim/': () => json(409, { error: { code: 'block_not_finished', message: 'x' } }),
    });
    await g.refreshPlayer();
    await g.claimBlock(true);
    expect(ui.toast || '').not.toBe('');
    expect(S.claim.id).toBe(7);
  });
  it('sends only the goal and the length', async () => {
    server({ 'POST /focus/blocks/': () => json(201, { block: {}, events: [] }) });
    S.len = 45;
    await g.startBlock(' Ship it ');
    expect(calls.find((c) => c.key === 'POST /focus/blocks/').body).toEqual({ goal: 'Ship it', minutes: 45 });
  });
  const BLOCK = (over = {}) => ({ id: 7, goal: 'x', minutes: 25, kind: 'plan', started_at: new Date(Date.now() - 60000).toISOString(), ends_at: new Date(Date.now() + 600000).toISOString(), claim_by: new Date(Date.now() + 1500000).toISOString(), drifts: 0, presence: 'waiting', check_expires_at: null, ...over });
  it('asks the server when the check comes up, and takes you to it', async () => {
    const seen = [];
    g.setNavigator((path) => seen.push(path));
    server({
      'GET /player/': () => json(200, PLAYER({ block: BLOCK() })),
      'GET /focus/blocks/7/': () => json(200, { block: BLOCK({ presence: 'due', check_expires_at: new Date(Date.now() + 180000).toISOString() }) }),
    });
    ui.auth = 'in';
    await g.refreshPlayer();
    expect(S.focus.presence).toBe('waiting');
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20000);
    g.tick();
    await vi.waitFor(() => expect(S.focus.presence).toBe('due'));
    vi.restoreAllMocks();
    expect(S.focus.checkEndsAt).toBeGreaterThan(Date.now());
    expect(seen).toContain('/focus');
  });
  it('stops asking once you have answered', async () => {
    server({
      'GET /player/': () => json(200, PLAYER({ block: BLOCK({ presence: 'due', check_expires_at: new Date(Date.now() + 180000).toISOString() }) })),
      'POST /focus/blocks/7/presence/': () => json(200, { block: BLOCK({ presence: 'ok' }), events: [] }),
    });
    ui.auth = 'in';
    await g.refreshPlayer();
    await g.confirmCheckIn();
    expect(S.focus.presence).toBe('ok');
    const before = calls.length;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 40000);
    g.tick();
    vi.restoreAllMocks();
    expect(calls.length).toBe(before);
  });
  it('sends the note with the claim and says when a block earned nothing', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    server({
      'GET /player/': () => json(200, PLAYER({ block: BLOCK({ started_at: past, ends_at: past, presence: 'ok' }) })),
      'POST /focus/blocks/7/claim/': () => json(200, { result: 'free', seconds_earned: 0, xp: 0, streak: 0, bank_seconds: 300, events: [] }),
    });
    await g.refreshPlayer();
    await g.claimBlock(true, 'Fixed the redirect');
    expect(calls.find((c) => c.key === 'POST /focus/blocks/7/claim/').body).toEqual({ done: true, note: 'Fixed the redirect' });
    expect(ui.toast).toContain('no play time');
  });
  it('lets go of a block once it is too late to claim', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    let player = PLAYER({ block: BLOCK({ started_at: past, ends_at: past, claim_by: past, presence: 'ok' }) });
    server({ 'GET /player/': () => json(200, player) });
    ui.auth = 'in';
    await g.refreshPlayer();
    expect(S.claim.id).toBe(7);
    player = PLAYER();
    g.tick();
    await vi.waitFor(() => expect(S.claim).toBeNull());
  });
  it('saves a plan and uses its block length', async () => {
    server({ 'PUT /focus/plan/': () => json(200, PLAN_STATUS) });
    await g.savePlan({ days: [0], blocks_per_day: 2, block_minutes: 15, windows: [{ start: '08:00', end: '10:00' }] });
    expect(ui.plan.plan.daily_minutes).toBe(50);
    expect(S.len).toBe(15);
  });
  it('announces a goal being met', { timeout: 8000 }, async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    server({
      'GET /player/': () => json(200, PLAYER({ block: BLOCK({ started_at: past, ends_at: past, presence: 'ok' }) })),
      'POST /focus/blocks/7/claim/': () => json(200, { result: 'plan', seconds_earned: 600, xp: 10, streak: 1, bank_seconds: 900, events: [{ type: 'target_reached', period: 'week', minutes: 200, seconds: 1200, xp: 200 }] }),
    });
    await g.refreshPlayer();
    await g.claimBlock(true, 'Fixed the redirect');
    await vi.waitFor(() => expect(ui.toast).toContain('Weekly goal met'), { timeout: 5000 });
  });
});
