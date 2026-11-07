#!/usr/bin/env node
/* Plays every mission through the real engines, the way a player would, then clears its rewind.
   Python solutions run under real python3 and Go snippets under real `go run`, so the expected
   answers are checked against the actual languages (sections 13.2 and 18). Exits 1 on any problem. */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as g from '../frontend/src/api/localGame.js';
import { fs as vfs } from '../engines/fs/index.js';

const { S, TK, TRACKS, TICKETS, ui } = g;
const problems = [];
const fail = (id, why) => problems.push(`${id}: ${String(why).slice(0, 300)}`);
const has = (cmd) => {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
};
const hasGo = has('go');
const hasPython = has('python3');
const GOENV = { ...process.env, GO111MODULE: 'off', GOCACHE: join(tmpdir(), 'uptime-gocache') };

const termText = () => ui.term.map((s) => s.t).join('');
const python = (input) => execSync('python3 -', { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
function goRun(src) {
  const d = mkdtempSync(join(tmpdir(), 'uptime-go-'));
  writeFileSync(join(d, 'main.go'), src);
  return execSync('go run main.go 2>&1', { cwd: d, env: GOENV }).toString().trim();
}
const pyValue = (expr) => python(`import ipaddress\nprint(${expr})`);

g.boot(null);
g.setNavigator(() => {});
g.openSession();
S.sessionEndsAt = Date.now() + 36000e3; // a ten hour session, so the clock can't end the run

function clearRewind(id) {
  g.startRewind(id);
  for (let i = 0; i < 8; i++) {
    const st = S.rew[id];
    if (!st || !st.q.length) break;
    const t = ui.rw.tasks[st.q[0]];
    if (t.type === 'mc') g.answerRewind(t.answer);
    else if (t.type === 'order') t.answer.forEach((a) => g.pickOrder(a));
    else g.answerRewind(t.answer[0]);
    g.afterRewindStep();
  }
  if (!S.rewDone[id]) fail(id, 'rewind not finished');
  g.closeOverlay();
}

// Round-robin across tracks, the same order the legacy Playwright run used.
const order = [];
const maxLen = Math.max(...TRACKS.map(([k]) => TK[k].length));
for (let i = 0; i < maxLen; i++) for (const [k] of TRACKS) if (TK[k][i]) order.push(TK[k][i]);

for (const t of order) {
  const id = t.id;
  if (g.stateOf(t) !== 'open') fail(id, 'should be open but is ' + g.stateOf(t));
  g.setCurrent(id);
  if (t.kind === 'py') {
    if (hasPython) {
      const src = t.sol + '\n' + t.tests.map((x) => `assert (${x[0]}) == (${x[1]}), ${JSON.stringify(x[0])}`).join('\n') + '\n';
      try {
        python(src);
      } catch (e) {
        fail(id, 'real python: ' + e.stderr.toString().slice(-160));
      }
    }
    g.notePyAttempt(t);
    g.complete(t);
  } else if (t.track === 'VI') {
    g.runCommand('vi ' + t.file);
    for (const k of t.sol.match(/<CR>|<Esc>|[\s\S]/g)) g.viPress(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
    if (!S.done[id]) fail(id, `vi not done: ${JSON.stringify(vfs.get(t.file)?.c)}`);
    else if (S.viKeys[t.file] > t.par) fail(id, `par ${t.par} took ${S.viKeys[t.file]}`);
  } else {
    if (t.track === 'GO' && hasGo) {
      const out = goRun(`package main\nimport (\n"fmt"\n${t.imports || ''}\n)\n${t.decl || ''}\nfunc main() {\n${t.code}\n}\n`);
      if (out !== t.answer[0]) fail(id, `go printed [${out}], answer [${t.answer[0]}]`);
    }
    if (t.v && hasPython) {
      const out = pyValue(t.v);
      if (!t.answer.includes(out)) fail(id, `python [${out}] vs [${t.answer}]`);
    }
    const before = termText().length;
    const cmds = t.sol.split('\n').filter((l) => !l.startsWith('submit'));
    cmds.forEach((c) => g.runCommand(c));
    if (t.kind === 'answer') {
      const a = termText().slice(before);
      if (cmds.length && !t.answer.some((x) => a.includes(x))) fail(id, `output lacks ${t.answer}: ${a.slice(-160)}`);
      g.runCommand('submit ' + t.answer[0]);
    }
    if (!S.done[id]) fail(id, 'not done: ' + termText().slice(-200));
  }
  if (ui.debrief !== id) fail(id, 'no debrief');
  g.closeDebrief();
  clearRewind(id);
}

if (g.level() !== 'Archmage' || !S.ended) fail('ending', JSON.stringify({ level: g.level(), ended: S.ended, cleared: g.cleared() }));

// On-call: every generated incident's answer must be right, by real language where possible.
if (g.cleared() === TICKETS.length) {
  g.startOncall();
  const seen = {};
  for (let i = 0; i < 40; i++) {
    if (!S.oc) g.startOncall();
    const t = { ...S.oc };
    seen[t.track] = (seen[t.track] || 0) + 1;
    if (t.v && hasPython && pyValue(t.v) !== t.answer[0]) fail(t.id, `on-call value vs ${t.answer}`);
    if (t.pyv && hasPython && python(t.pyv) !== t.answer[0]) fail(t.id, 'on-call python');
    if (t.track === 'GO' && hasGo && goRun(`package main\nimport "fmt"\nfunc main() {\n${t.code}\n}\n`) !== t.answer[0]) fail(t.id, 'on-call go');
    if (t.track === 'SH') {
      const b4 = termText().length;
      g.runCommand(t.sol);
      if (!termText().slice(b4).includes(t.answer[0])) fail(t.id, 'on-call shell');
    }
    g.runCommand('submit ' + t.answer[0]);
  }
  console.log('on-call incidents by track:', JSON.stringify(seen));
}

console.log(`missions: ${TICKETS.length}, cleared: ${g.cleared()}, level: ${g.level()}, xp: ${S.xp}, badges: ${Object.keys(S.badges).length}`);
if (!hasGo) console.log('note: go not found, Go outputs not checked');
if (!hasPython) console.log('note: python3 not found, Python solutions not checked');
console.log('PROBLEMS:', problems.length);
problems.slice(0, 40).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
