/* The maths behind the map and the charts. Dates stay as the server's YYYY-MM-DD strings, worked on in UTC, so
   this device's clock and daylight saving can't move a day. */
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const toMs = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const toText = (ms) => new Date(ms).toISOString().slice(0, 10);
export const shiftDay = (date, days) => toText(toMs(date) + days * DAY);
const mondayIndex = (date) => (new Date(toMs(date)).getUTCDay() + 6) % 7;

export const shortDay = (date) => `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]}`;
export const longDay = (date) => `${WEEKDAYS[mondayIndex(date)]} ${shortDay(date)} ${date.slice(0, 4)}`;
export const weekdayName = (date) => WEEKDAYS[mondayIndex(date)];
export const hoursAndMinutes = (minutes) => (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`);

/* Fixed steps, so a colour means the same amount on every account and every day. */
export const HEAT_STEPS = [
  { level: 1, label: 'Under 30 min' },
  { level: 2, label: '30 to 59 min' },
  { level: 3, label: '1 to 2 hours' },
  { level: 4, label: '2 hours or more' },
];
export function heatLevel(minutes) {
  if (!minutes) return 0;
  if (minutes < 30) return 1;
  if (minutes < 60) return 2;
  return minutes < 120 ? 3 : 4;
}

/** Whole weeks from Monday, ending today, so the columns line up with a calendar. */
export function buildMap(today, days, weeks = 53) {
  const seen = new Map(days.map((d) => [d.date, d]));
  const first = shiftDay(today, -mondayIndex(today) - (weeks - 1) * 7);
  const total = (toMs(today) - toMs(first)) / DAY + 1;
  const cells = Array.from({ length: total }, (_, i) => {
    const date = shiftDay(first, i);
    const day = seen.get(date);
    const minutes = day?.minutes ?? 0;
    return { date, minutes, blocks: day?.blocks ?? 0, level: heatLevel(minutes) };
  });
  const months = [];
  for (let column = 0; column < weeks; column++) {
    const month = cells[column * 7].date.slice(5, 7);
    if (column === 0 || month !== cells[(column - 1) * 7].date.slice(5, 7)) months.push({ column, label: MONTHS[+month - 1] });
  }
  // A month that only just shows at the start would have its name run into the next one's.
  if (months.length > 1 && months[1].column - months[0].column < 3) months.shift();
  return { cells, months, weeks };
}

/** Every day in the range, with nothing missing, oldest first. */
export function lastDays(today, days, count) {
  const seen = new Map(days.map((d) => [d.date, d]));
  return Array.from({ length: count }, (_, i) => {
    const date = shiftDay(today, i - count + 1);
    return { date, minutes: seen.get(date)?.minutes ?? 0, blocks: seen.get(date)?.blocks ?? 0 };
  });
}

/** A clean top for the axis and the ticks up to it, with at most four steps. */
export function axis(max, fallback, unit = 10) {
  const top = Math.max(max, fallback);
  let step = unit;
  for (const scale of [1, 2, 5]) {
    step = unit * scale;
    if (top / step <= 4) break;
  }
  while (top / step > 4) step *= 2;
  const ceiling = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= ceiling; v += step) ticks.push(v);
  return { top: ceiling, ticks };
}
