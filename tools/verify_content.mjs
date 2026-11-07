#!/usr/bin/env node
/* Plays every mission through the real engines, the way a player would, then clears its rewind.
   Python solutions run under real python3 and Go snippets under real `go run`, so the expected
   answers are checked against the actual languages (sections 13.2 and 18). Exits 1 on any problem. */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import * as g from '../frontend/src/api/localGame.js';
import { fs as vfs } from '../engines/fs/index.js';
import { buildProgram, configureSkulpt, judge } from '../frontend/src/features/play/workspaces/python/program.js';

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

/* The same program the browser builds, under python3 and under Skulpt, which is what players really run. */
function realPython(t) {
  const d = mkdtempSync(join(tmpdir(), 'uptime-py-'));
  for (const [name, c] of Object.entries(t.files || {})) writeFileSync(join(d, name), c);
  return execSync('python3 -', { cwd: d, input: buildProgram(t, t.sol).text, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
}
const require = createRequire(import.meta.url);
function loadSkulpt() {
  if (globalThis.Sk) return globalThis.Sk;
  const dist = dirname(require.resolve('skulpt/package.json', { paths: [new URL('../frontend/', import.meta.url).pathname] }));
  // Look like a browser while it loads, because Skulpt decides how open() works at that moment.
  globalThis.window = globalThis;
  globalThis.document = { getElementById: () => null };
  for (const f of ['skulpt.min.js', 'skulpt-stdlib.js']) vm.runInThisContext(readFileSync(join(dist, 'dist', f), 'utf8'));
  return globalThis.Sk;
}
async function skulpt(t) {
  const Sk = loadSkulpt();
  const o = [];
  configureSkulpt(Sk, t, (x) => o.push(x));
  const { text, offset } = buildProgram(t, t.sol);
  try {
    await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, text, true));
    return judge({ out: o.join(''), ok: true }, offset);
  } catch (e) {
    return judge({ out: `${o.join('')}\n${e}`, ok: false }, offset);
  }
}

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
      try {
        const out = realPython(t);
        if (!/ALL_PASSED/.test(out)) fail(id, 'real python: ' + out.slice(-200));
      } catch (e) {
        fail(id, 'real python: ' + e.stderr.toString().slice(-200));
      }
    }
    const sk = await skulpt(t);
    if (!sk.passed) fail(id, 'skulpt: ' + sk.out.slice(-240));
    g.notePyAttempt(t);
    g.complete(t);
  } else if (t.track === 'VI') {
    g.runCommand('vi ' + t.file);
    for (const k of t.sol.match(/<CR>|<Esc>|<C-.>|[\s\S]/g)) {
      if (k.startsWith('<C-')) g.viPress(k[3], true);
      else g.viPress(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
    }
    if (!S.done[id]) fail(id, `vi not done: ${JSON.stringify(vfs.get(t.file)?.c)}`);
    else if (S.viKeys[t.file] > t.par) fail(id, `par ${t.par} took ${S.viKeys[t.file]}`);
  } else {
    if (t.track === 'GO' && hasGo) {
      // Fix missions run with the blank filled in, and must print what they promise.
      const out = goRun(t.program.replace('____', t.answer[0]));
      const want = t.prints ?? t.answer[0];
      if (out !== want) fail(id, `go printed [${out}], wanted [${want}]`);
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
      if (cmds.length && !t.reasoned && !t.answer.some((x) => a.toLowerCase().includes(x.toLowerCase()))) fail(id, `output lacks ${t.answer}: ${a.slice(-160)}`);
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
