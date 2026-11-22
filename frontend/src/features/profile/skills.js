/* The skill map on Profile: each core skill rated 1 to 10 by the share of its missions you've cleared. */
export const MAX_RATING = 10;

/** Any cleared mission makes a skill 1 and every one makes it 10, with even steps between, so 10 always means
 * the whole track. A skill with nothing cleared is 0: not started yet. */
export function rating(cleared, total) {
  if (!total || cleared <= 0) return 0;
  if (cleared >= total) return MAX_RATING;
  return 1 + Math.floor((cleared / total) * (MAX_RATING - 1));
}

/** One row per core track, in the catalogue's order. Side tracks like Operations aren't skills of their own. */
export function skillsOf(tracks, missionsOf, side) {
  return tracks
    .filter(([code]) => !side.has(code))
    .map(([code, name]) => {
      const missions = missionsOf[code] || [];
      const cleared = missions.filter((m) => m.state === 'cleared').length;
      const total = missions.length;
      return { code, name, cleared, total, percent: total ? Math.round((cleared / total) * 100) : 0, rating: rating(cleared, total) };
    });
}

/** Where a value sits on spoke `i` of `count`, the first straight up and the rest clockwise. */
export function spoke(i, count, radius, cx, cy) {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}
