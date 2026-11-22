import { describe, expect, it } from 'vitest';
import { rating, skillsOf, spoke } from './skills.js';

const cards = (cleared, total) => Array.from({ length: total }, (_, i) => ({ state: i < cleared ? 'cleared' : 'open' }));

describe('a skill rating', () => {
  it('is 0 before anything is cleared', () => {
    expect(rating(0, 30)).toBe(0);
    expect(rating(0, 0)).toBe(0);
  });
  it('is 1 from the first cleared mission', () => {
    expect(rating(1, 30)).toBe(1);
  });
  it('is 10 only for the whole track', () => {
    expect(rating(29, 30)).toBe(9);
    expect(rating(30, 30)).toBe(10);
  });
  it('climbs in even steps between', () => {
    expect(rating(15, 30)).toBe(5);
    expect(rating(22, 44)).toBe(5);
    const steps = Array.from({ length: 31 }, (_, n) => rating(n, 30));
    expect(steps.every((r, n) => n === 0 || r >= steps[n - 1])).toBe(true);
  });
});

describe('the skills', () => {
  it('are the core tracks, in order, without side tracks', () => {
    const tracks = [['SH', 'Shell'], ['NET', 'Networking'], ['OPS', 'Operations']];
    const rows = skillsOf(tracks, { SH: cards(3, 30), NET: cards(49, 49), OPS: cards(1, 20) }, new Set(['OPS']));
    expect(rows).toEqual([
      { code: 'SH', name: 'Shell', cleared: 3, total: 30, percent: 10, rating: 1 },
      { code: 'NET', name: 'Networking', cleared: 49, total: 49, percent: 100, rating: 10 },
    ]);
  });
});

describe('a spoke', () => {
  it('starts straight up and goes clockwise', () => {
    const [x0, y0] = spoke(0, 6, 100, 0, 0);
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(-100);
    const [x1] = spoke(1, 6, 100, 0, 0);
    expect(x1).toBeGreaterThan(0);
  });
});
