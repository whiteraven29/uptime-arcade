/* The mission registry. The order missions are added is the order they're played, and each one
   carries its own lesson, so a track reads top to bottom like the course it is (section 8).
   Interim: M1 converts the catalogue to content/missions. */
const TK = { SH: [], VI: [], PY: [], GO: [], NET: [] };
const CHAPTERS = { SH: [], VI: [], PY: [], GO: [], NET: [] };

/* Starts a new chapter: the next mission added to this track is its first. */
const chapter = (track, name) => CHAPTERS[track].push([name, TK[track].length]);

const addMission = (track, o) => {
  const n = TK[track].length + 1;
  TK[track].push({ track, id: `${track.toLowerCase()}-${String(n).padStart(2, '0')}`, ...o });
};

const ans = (v) => [String(v)];

export { TK, CHAPTERS, chapter, addMission, ans };
