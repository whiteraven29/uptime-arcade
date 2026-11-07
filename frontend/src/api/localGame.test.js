import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as g from './localGame.js';

const { S, TK, ui } = g;
const DAY = 864e5;
const START = new Date('2026-11-06T08:00:00');

function finishBlock(goal = 'Ship it', { done = true, minutes = 25 } = {}) {
  g.setLen(minutes);
  g.startBlock(goal);
  vi.advanceTimersByTime(minutes * 60000 + 1000);
  g.tick();
  g.claimBlock(done);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  g.boot(null);
  g.setNavigator(() => {});
});
afterEach(() => vi.useRealTimers());

describe('focus economy', () => {
  it('starts a new player with 5:00 banked', () => {
    expect(S.bank).toBe(300);
  });
  it('pays play time plus the goal bonus when the block is claimed', () => {
    finishBlock();
    expect(S.bank).toBe(300 + 8 * 60 + 120);
    expect(S.focusMin).toBe(25);
    expect(S.blocks).toBe(1);
  });
  it('skips the goal bonus when the goal is not finished', () => {
    finishBlock('x', { done: false });
    expect(S.bank).toBe(300 + 8 * 60);
  });
  it('pays nothing for ending early', () => {
    g.startBlock('x');
    vi.advanceTimersByTime(60000);
    g.abandonBlock();
    expect(S.bank).toBe(300);
    expect(S.blocks).toBe(0);
  });
  it('only asks for a claim once the timer has run out', () => {
    g.startBlock('x');
    vi.advanceTimersByTime(24 * 60000);
    g.tick();
    expect(S.claim).toBeNull();
    vi.advanceTimersByTime(60000 + 1000);
    g.tick();
    expect(S.claim).not.toBeNull();
  });
  it('caps focus earnings at 30:00', () => {
    S.bank = 29 * 60;
    finishBlock();
    expect(S.bank).toBe(30 * 60);
  });
  it('counts a block with no drifts as clean, and one with drifts as not', () => {
    finishBlock();
    expect(S.cleanBlocks).toBe(1);
    g.startBlock('x');
    g.logDrift();
    vi.advanceTimersByTime(25 * 60000 + 1000);
    g.tick();
    g.claimBlock(true);
    expect(S.cleanBlocks).toBe(1);
    expect(S.blocks).toBe(2);
  });
});

describe('sessions', () => {
  it('moves the whole bank into a session, and returns unused time on close', () => {
    g.openSession();
    expect(S.bank).toBe(0);
    expect(g.sessionOn()).toBe(true);
    vi.advanceTimersByTime(60000);
    g.closeSession();
    expect(S.bank).toBe(240);
    expect(g.sessionOn()).toBe(false);
  });
  it('ends when the time runs out, with nothing returned', () => {
    g.openSession();
    vi.advanceTimersByTime(301000);
    g.tick();
    expect(g.sessionOn()).toBe(false);
    expect(S.bank).toBe(0);
  });
  it("can't open during a focus block or with an empty bank", () => {
    g.startBlock('x');
    g.openSession();
    expect(S.sessionEndsAt).toBeNull();
    g.abandonBlock();
    S.bank = 0;
    g.openSession();
    expect(S.sessionEndsAt).toBeNull();
  });
  it('banks a running session when a focus block starts', () => {
    g.openSession();
    vi.advanceTimersByTime(60000);
    g.startBlock('x');
    expect(S.sessionEndsAt).toBeNull();
    expect(S.bank).toBe(240);
  });
});

describe('streaks', () => {
  const nextDay = (n = 1) => vi.advanceTimersByTime(n * DAY);

  it('pays each milestone once, with a shield at seven days', () => {
    finishBlock();
    for (let i = 0; i < 6; i++) {
      nextDay();
      finishBlock();
    }
    expect(S.streak).toBe(7);
    expect(S.shields).toBe(1);
    expect(Object.keys(S.claimed)).toEqual(['3', '7']);
  });
  it('only grows once a day', () => {
    finishBlock();
    finishBlock();
    expect(S.streak).toBe(1);
  });
  it('spends a shield on a missed day, and resets when there are too few', () => {
    finishBlock();
    for (let i = 0; i < 6; i++) {
      nextDay();
      finishBlock();
    }
    nextDay(2);
    finishBlock();
    expect(S.streak).toBe(8);
    expect(S.shields).toBe(0);
    nextDay(3);
    finishBlock();
    expect(S.streak).toBe(1);
  });
  it('raises the XP multiplier 5% a day, up to +50%', () => {
    S.streak = 4;
    expect(g.mult()).toBeCloseTo(1.2);
    S.streak = 40;
    expect(g.mult()).toBeCloseTo(1.5);
  });
});

describe('missions and rewinds', () => {
  const first = () => TK.NET[0];
  const solve = (m) => {
    g.openSession();
    g.setCurrent(m.id);
    g.runCommand(`submit ${m.answer[0]}`);
  };
  const clearRewind = (m) => {
    g.startRewind(m.id);
    while (S.rew[m.id]?.q.length) {
      const t = ui.rw.tasks[S.rew[m.id].q[0]];
      if (t.type === 'mc') g.answerRewind(t.answer);
      else if (t.type === 'order') t.answer.forEach((a) => g.pickOrder(a));
      else g.answerRewind(t.answer[0]);
      g.afterRewindStep();
    }
  };

  it('opens each track at its first mission and locks the rest', () => {
    expect(g.stateOf(first())).toBe('open');
    expect(g.stateOf(TK.NET[1])).toBe('locked');
  });
  it('rejects a wrong answer and shows the debrief for the right one', () => {
    g.openSession();
    g.setCurrent(first().id);
    g.runCommand('submit definitely-wrong');
    expect(S.done[first().id]).toBeUndefined();
    g.runCommand(`submit ${first().answer[0]}`);
    expect(S.done[first().id]).toBeDefined();
    expect(ui.debrief).toBe(first().id);
  });
  it('charges 15 XP a hint and never pays less than 10', () => {
    g.openSession();
    g.setCurrent(first().id);
    g.showHint();
    g.showHint();
    g.runCommand(`submit ${first().answer[0]}`);
    expect(S.done[first().id].hints).toBe(2);
    expect(S.xp).toBe(0);
    g.closeDebrief();
    clearRewind(first());
    expect(S.xp).toBe(100 + 20 - 30);
  });
  it('only unlocks the next mission once the rewind is finished', () => {
    const m = first();
    solve(m);
    g.closeDebrief();
    expect(g.stateOf(m)).toBe('rewind');
    expect(g.stateOf(TK.NET[1])).toBe('locked');
    clearRewind(m);
    expect(g.stateOf(m)).toBe('clear');
    expect(g.stateOf(TK.NET[1])).toBe('open');
    expect(ui.flash).toBe(TK.NET[1].id);
  });
  it('moves a wrong rewind answer to the back of the queue and shows the right one', () => {
    const m = first();
    solve(m);
    g.startRewind(m.id);
    g.answerRewind('definitely wrong');
    expect(ui.rw.fb.ok).toBe(false);
    expect(S.rew[m.id].ok).toBe(0);
    expect(S.rew[m.id].q).toEqual([1, 2, 3, 4, 0]);
  });
  it('raises a level-up when the clear count crosses a threshold', () => {
    S.peak = 0;
    const clearTrack = TK.NET.slice(0, 8);
    clearTrack.forEach((m) => {
      solve(m);
      g.closeDebrief();
      clearRewind(m);
      if (S.sessionEndsAt) g.closeSession(true);
      S.bank = 3600;
    });
    expect(g.level()).toBe('Initiate');
    expect(ui.overlay).toEqual({ kind: 'level', i: 1 });
  });
  it('keeps level, XP and streak through a new season, and resets progress', () => {
    const m = first();
    solve(m);
    g.closeDebrief();
    clearRewind(m);
    const xp = S.xp;
    g.newSeason();
    expect(S.season).toBe(2);
    expect(S.xp).toBe(xp);
    expect(g.cleared()).toBe(0);
    expect(S.peak).toBe(1);
    expect(g.stateOf(TK.NET[1])).toBe('locked');
  });
});

describe('saves', () => {
  it('round-trips through export and import, with no session left running', () => {
    finishBlock();
    g.openSession();
    const { data } = g.exportSave();
    const xp = S.xp;
    S.xp = 1;
    g.importSave(data);
    expect(S.xp).toBe(xp);
    expect(S.sessionEndsAt).toBeNull();
  });
  it('refuses a file that is not a save', () => {
    expect(() => g.importSave('{"hello":1}')).toThrow();
    expect(() => g.importSave('not json')).toThrow();
  });
});

describe('the catalogue', () => {
  it('has 30 missions in every track, starting from zero', () => {
    for (const [k] of g.TRACKS) expect(TK[k]).toHaveLength(30);
    expect(TK.SH[0].title).toBe('Where am I?');
    expect(TK.PY[0].sol).toBe('print("Hello, operator")');
    expect(TK.PY.slice(0, 3).some((m) => m.sol.includes('def '))).toBe(false);
  });
  it('gives every mission a permanent id in play order', () => {
    expect(TK.SH[0].id).toBe('sh-01');
    expect(TK.NET[29].id).toBe('net-30');
    expect(new Set(g.TICKETS.map((m) => m.id)).size).toBe(150);
  });
  it('tops out the ladder exactly at the last mission', () => {
    expect(g.LEVELS[g.LEVELS.length - 1][0]).toBe(g.TICKETS.length);
  });
});

describe('older saves', () => {
  it('moves progress to the new ids and drops retired missions', () => {
    const old = { v: 3, xp: 500, done: { 'sh-1': { xp: 100, hints: 0 }, 'sh-3': { xp: 100, hints: 0 } }, rewDone: { 'sh-1': true, 'sh-3': true }, hints: {}, rew: {}, cmds: {}, tries: {}, code: {}, peak: 2 };
    g.importSave(JSON.stringify(old));
    expect(S.v).toBe(5);
    expect(S.xp).toBe(500);
    expect(S.rewDone).toEqual({ 'sh-04': true });
    expect(S.done['sh-04']).toBeDefined();
    expect(S.peak).toBe(2);
  });
});

describe('badges', () => {
  const earned = (id) => {
    const b = g.BADGES.find((x) => x[0] === id);
    return b[3]();
  };
  it('has an emblem family for every badge in the set', () => {
    expect(g.BADGES.map((b) => b[0])).toEqual(expect.arrayContaining(['firstblock', 'hours10', 'centurion', 'par50', 'nohints', 'night', 'arch']));
  });
  it('awards Par Hunter at 50 missions under par', () => {
    S.done = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`x${i}`, { bonus: 20, hints: 0 }]));
    expect(earned('par50')).toBe(true);
    delete S.done.x0;
    expect(earned('par50')).toBe(false);
  });
  it('awards No Hints Needed only for a whole chapter with no hints', () => {
    const [first, second] = g.CHAPTERS.SH;
    const chapter = TK.SH.slice(first[1], second[1]);
    chapter.forEach((m) => { S.done[m.id] = { hints: 0, bonus: 0 }; });
    expect(earned('nohints')).toBe(true);
    S.done[chapter[0].id].hints = 1;
    expect(earned('nohints')).toBe(false);
  });
});

describe('XP comes from finishing the whole task', () => {
  const m = () => TK.NET[0];
  const solve = () => {
    g.openSession();
    g.setCurrent(m().id);
    g.runCommand(`submit ${m().answer[0]}`);
    g.closeDebrief();
    g.startRewind(m().id);
  };
  const right = () => {
    const t = ui.rw.tasks[S.rew[m().id].q[0]];
    if (t.type === 'mc') g.answerRewind(t.answer);
    else if (t.type === 'order') t.answer.forEach((a) => g.pickOrder(a));
    else g.answerRewind(t.answer[0]);
    g.afterRewindStep();
  };
  it('pays nothing for solving or for each right answer', () => {
    solve();
    expect(S.xp).toBe(0);
    for (let i = 0; i < 4; i++) right();
    expect(S.xp).toBe(0);
  });
  it('pays once, when the last question is answered', () => {
    solve();
    for (let i = 0; i < 5; i++) right();
    expect(S.xp).toBe(100 + 20);
    expect(S.done[m().id].paid).toBe(true);
  });
  it('never pays twice for a mission paid under the old rules', () => {
    g.importSave(JSON.stringify({ v: 4, xp: 500, done: { [m().id]: { xp: 120, hints: 0, bonus: 20 } }, rewDone: {}, rew: {}, hints: {}, cmds: {}, tries: {}, code: {}, peak: 0 }));
    g.openSession();
    g.startRewind(m().id);
    for (let i = 0; i < 5; i++) right();
    expect(S.xp).toBe(500);
  });
});

describe('rewind help', () => {
  const m = () => TK.NET[0];
  const start = () => {
    g.openSession();
    g.setCurrent(m().id);
    g.runCommand(`submit ${m().answer[0]}`);
    g.closeDebrief();
    g.startRewind(m().id);
  };
  const wrong = () => {
    g.answerRewind(ui.rw.tasks[S.rew[m().id].q[0]].type === 'order' ? ['wrong'] : 'definitely wrong');
    g.afterRewindStep();
  };
  it('shows no hint and no answer until every question has been failed', () => {
    start();
    for (let i = 0; i < 4; i++) {
      wrong();
      expect(g.rewindHelp(m().id).hint).toBeNull();
    }
    wrong();
    expect(g.rewindHelp(m().id).hint).toBeTruthy();
    expect(g.rewindHelp(m().id).answer).toBeNull();
  });
  it('never reveals the answer on a wrong attempt', () => {
    start();
    g.answerRewind('definitely wrong');
    expect(ui.rw.fb).toEqual({ ok: false });
  });
  it('gives a hint when the only question left has been failed', () => {
    start();
    wrong();
    for (let i = 0; i < 4; i++) {
      const t = ui.rw.tasks[S.rew[m().id].q[0]];
      if (t.type === 'mc') g.answerRewind(t.answer);
      else if (t.type === 'order') t.answer.forEach((a) => g.pickOrder(a));
      else g.answerRewind(t.answer[0]);
      g.afterRewindStep();
    }
    expect(S.rew[m().id].q).toHaveLength(1);
    expect(g.rewindHelp(m().id).hint).toBeTruthy();
  });
  it('shows the answer after three misses, so nobody gets stuck', () => {
    start();
    for (let i = 0; i < 15; i++) wrong();
    expect(g.rewindHelp(m().id).answer).toBeTruthy();
  });
});

describe('Beyond', () => {
  it('stays locked until Archmage, then opens in order', () => {
    expect(g.stateOf(TK.BX[0])).toBe('locked');
    S.peak = g.TICKETS.length;
    expect(g.stateOf(TK.BX[0])).toBe('open');
    expect(g.stateOf(TK.BX[1])).toBe('locked');
  });
  it('runs from Easy to Brainfuck, worth more each tier', () => {
    expect(g.CHAPTERS.BX.map((c) => c[0])).toEqual(['Easy', 'Medium', 'Hard', 'Expert', 'Brainfuck']);
    expect(TK.BX.map((m) => m.xp).every((x, i, a) => i === 0 || x >= a[i - 1])).toBe(true);
  });
  it("doesn't count towards levels", () => {
    S.rewDone = { [TK.BX[0].id]: true };
    expect(g.cleared()).toBe(0);
    expect(g.beyondCleared()).toBe(1);
  });
});

describe('badges for levels and tiers', () => {
  const has = (id) => g.BADGES.find((b) => b[0] === id)[3]();
  it('has one for every level climbed', () => {
    for (let i = 2; i <= 9; i++) expect(g.BADGES.some((b) => b[0] === `lv${i}`)).toBe(true);
    S.peak = g.LEVELS[2][0];
    expect(has('lv2')).toBe(true);
    expect(has('lv3')).toBe(true);
    expect(has('lv4')).toBe(false);
  });
  it('has one for each Beyond tier', () => {
    const [start, next] = [g.CHAPTERS.BX[0][1], g.CHAPTERS.BX[1][1]];
    TK.BX.slice(start, next).forEach((m) => { S.rewDone[m.id] = true; });
    expect(has('bx1')).toBe(true);
    expect(has('bx2')).toBe(false);
  });
});
