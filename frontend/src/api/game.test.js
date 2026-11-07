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
});
