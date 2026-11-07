#!/usr/bin/env node
/* Section 14: answers never reach the browser. This reads the production build and fails if any mission's
   solution, explanation or rewind question is inside it. Run it after `vite build`. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(ROOT, 'frontend/dist/assets');
const { missions, fixtures } = JSON.parse(readFileSync(join(ROOT, 'content/build/catalogue.json'), 'utf8'));
const bundle = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

const problems = [];
const secret = (id, what, text) => {
  // Short strings like "pwd" appear in any program, so only distinctive ones can prove a leak.
  if (typeof text === 'string' && text.length >= 24 && bundle.includes(text)) problems.push(`${id}: ${what} is in the bundle: ${text.slice(0, 60)}`);
};
for (const m of missions) {
  secret(m.id, 'explanation', m.why);
  secret(m.id, 'solution', m.sol);
  secret(m.id, 'job note', m.job);
  secret(m.id, 'brief', m.brief);
  m.hints.forEach((h) => secret(m.id, 'hint', h));
  m.rewind.forEach((t) => {
    secret(m.id, 'rewind question', t.q);
    secret(m.id, 'rewind hint', t.hint);
  });
}
secret('fixtures', 'a fixture file', fixtures.find((f) => f.path.endsWith('api-access.log')).content.slice(0, 200));
for (const word of ['answer_spec', 'catalogue.json', 'file_equals']) if (bundle.includes(word)) problems.push(`the bundle mentions ${word}`);

console.log(`bundle check: ${missions.length} missions scanned, problems: ${problems.length}`);
problems.slice(0, 30).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
