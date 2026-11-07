import { describe, expect, it } from 'vitest';
import { axis, buildMap, heatLevel, hoursAndMinutes, lastDays, longDay, shiftDay, shortDay } from './history.js';

describe('the focus map', () => {
  it('runs in whole weeks from a Monday and ends today', () => {
    const { cells } = buildMap('2026-11-07', []); // a Saturday
    expect(cells[0].date).toBe('2025-11-03');
    expect(new Date(`${cells[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(cells.at(-1).date).toBe('2026-11-07');
    expect(cells.length).toBe(52 * 7 + 6);
  });
  it('has no day twice or missing, across a daylight saving change', () => {
    const { cells } = buildMap('2026-11-07', []);
    const dates = cells.map((c) => c.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain('2026-03-29');
    expect(dates).toContain('2026-10-25');
  });
  it('colours days by their focus', () => {
    const { cells } = buildMap('2026-11-07', [{ date: '2026-11-02', minutes: 75, blocks: 3 }]);
    expect(cells.find((c) => c.date === '2026-11-02')).toEqual({ date: '2026-11-02', minutes: 75, blocks: 3, level: 3 });
    expect(cells.find((c) => c.date === '2026-11-03').level).toBe(0);
  });
  it('ignores days it has no column for', () => {
    expect(buildMap('2026-11-07', [{ date: '2020-01-01', minutes: 75, blocks: 3 }]).cells.some((c) => c.minutes)).toBe(false);
  });
  it('names each month once, where it starts', () => {
    const { months } = buildMap('2026-11-07', []);
    expect(months.map((m) => m.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
    expect(months.every((m, i) => i === 0 || m.column > months[i - 1].column)).toBe(true);
  });
  it.each([[0, 0], [1, 1], [29, 1], [30, 2], [59, 2], [60, 3], [119, 3], [120, 4], [900, 4]])('%i minutes is step %i', (minutes, level) => {
    expect(heatLevel(minutes)).toBe(level);
  });
});

describe('the charts', () => {
  it('fills in the empty days', () => {
    const days = lastDays('2026-11-07', [{ date: '2026-11-05', minutes: 25, blocks: 1 }], 3);
    expect(days).toEqual([
      { date: '2026-11-05', minutes: 25, blocks: 1 },
      { date: '2026-11-06', minutes: 0, blocks: 0 },
      { date: '2026-11-07', minutes: 0, blocks: 0 },
    ]);
  });
  it.each([
    [0, 60, 10, 60, [0, 20, 40, 60]],
    [75, 60, 10, 80, [0, 20, 40, 60, 80]],
    [130, 60, 10, 150, [0, 50, 100, 150]],
    [270, 60, 10, 300, [0, 100, 200, 300]],
    [1234, 60, 10, 1600, [0, 400, 800, 1200, 1600]],
  ])('picks clean ticks for a highest value of %i', (max, fallback, unit, top, ticks) => {
    expect(axis(max, fallback, unit)).toEqual({ top, ticks });
  });
  it('never has more than five ticks', () => {
    for (let max = 0; max < 5000; max += 37) expect(axis(max, 60).ticks.length).toBeLessThanOrEqual(5);
  });
});

describe('dates and durations', () => {
  it('moves across months and years', () => {
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('reads well', () => {
    expect(shortDay('2026-11-07')).toBe('7 Nov');
    expect(longDay('2026-11-07')).toBe('Sat 7 Nov 2026');
    expect(hoursAndMinutes(45)).toBe('45 min');
    expect(hoursAndMinutes(125)).toBe('2h 05m');
  });
});
