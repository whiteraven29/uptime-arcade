#!/usr/bin/env node
/* Builds content/build/catalogue.json from the YAML, which is the only place missions are written.
   The browser game and the Node tools read this until M3 moves the game onto the API. It still holds
   the answers, so it must never be served once the API is in use (ADR 0005). */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML = createRequire(join(ROOT, 'frontend/'))('yaml');
const read = (rel) => YAML.parse(readFileSync(join(ROOT, rel), 'utf8'), { version: '1.1' });

const { tracks, difficulties } = read('content/tracks.yaml');
const CODE = Object.fromEntries(tracks.map((t) => [t.dir, t.code]));
const worth = (m) => {
  const d = difficulties.find((x) => x.code === m.difficulty);
  return m.track === 'BX' ? d.beyond_xp : d.xp;
};
const KIND = { ops: 'ops', answer: 'answer', 'go-out': 'answer', 'go-code': 'go-code', fs: 'auto', vi: 'auto', py: 'py', net: 'net' };

/* A stage has the fields a mission has, so the content tools can play it the same way. */
function flattenStage(s, m) {
  return flatten({ ...m, ...s, stages: undefined, requires: undefined, requires_all: undefined, skill: { vi: 'vi', 'go-out': 'go', 'go-code': 'go', py: 'python', net: 'networking' }[s.check] || 'shell', debrief: { ...m.debrief, solution: s.solution }, par: { kind: 'first-try', value: 1000 }, file: s.file, teaches: [] });
}

function flatten(m) {
  const o = {
    id: m.id, track: m.track, skill: CODE[m.skill], chapter: m.chapter, pos: m.order - 1, title: m.title, from: m.from,
    difficulty: m.difficulty, xp: worth(m), check: m.check, kind: KIND[m.check], par: m.par.value,
    learn: [m.lesson.text, m.lesson.example], brief: m.brief, goal: m.goal, hints: m.hints,
    why: m.debrief.why, sol: m.debrief.solution, job: m.debrief.job, teaches: m.teaches, rewind: m.rewind,
  };
  if (m.par.kind === 'keys') o.parKind = 'keys';
  if (m.answer) o.answer = m.answer.accept;
  for (const k of ['expect', 'fixtures', 'file', 'reasoned', 'lab', 'requires']) if (m[k] !== undefined) o[k] = m[k];
  if (m.verify) o.v = m.verify;
  if (o.file) o.file = o.file.replace(/^~/, '/home/ops');
  if (m.python) {
    o.starter = m.python.starter;
    o.tests = m.python.tests.map((t) => (t.label ? [t.expr, t.want, t.label] : [t.expr, t.want]));
    if (m.python.prelude) o.prelude = m.python.prelude;
    if (m.python.wrap) o.wrap = m.python.wrap;
    if (m.python.capture_output) o.captureOutput = true;
    if (m.python.files) o.files = m.python.files;
  }
  if (m.go?.program) {
    o.program = m.go.program;
    if (m.go.prints) o.prints = m.go.prints;
  }
  if (m.check === 'ops') {
    o.stages = m.stages.map((st) => flattenStage(st, m));
    o.requiresAll = m.requires_all;
  }
  if (m.check === 'go-code') {
    o.starter = m.go.starter;
    o.goTest = m.go.test;
    o.program = m.debrief.solution; // what the content tools read for which words it uses
  }
  return o;
}

const missions = [];
const chapters = {};
for (const t of tracks) {
  const dir = join('content/missions', t.dir);
  const list = (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)) : []).filter((f) => f.endsWith('.yaml')).map((f) => read(join(dir, f))).sort((a, b) => a.order - b.order);
  chapters[t.code] = [];
  list.forEach((m, i) => {
    if (chapters[t.code].at(-1)?.[0] !== m.chapter) chapters[t.code].push([m.chapter, i]);
    missions.push(flatten(m));
  });
}

mkdirSync(join(ROOT, 'content/build'), { recursive: true });
writeFileSync(join(ROOT, 'content/build/catalogue.json'), JSON.stringify({
  difficulties, tracks: tracks.map(({ code, name, subtitle, after_archmage: after, side }) => ({ code, name, subtitle, after: !!after, side: !!side })),
  chapters, missions, fixtures: read('content/fixtures/fs/base.yaml').files,
}));
console.log(`catalogue: ${missions.length} missions`);
