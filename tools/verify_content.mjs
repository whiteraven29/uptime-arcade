#!/usr/bin/env node
/* Plays every mission through the real engines, the way a player would. Python solutions run under real
   python3 and under Skulpt, and Go programs under real `go run`, so answers are checked against the
   actual languages (sections 13.2 and 18). It also saves the state each goal mission ends in, so the
   backend tests can prove the server's grader agrees with the engines. Exits 1 on any problem. */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { ALL_MISSIONS, BEYOND, TK, TRACKS } from '../content/index.mjs';
import { S } from '../engines/host.js';
import { evalExpect } from '../engines/fs/expect.js';
import { buildProgram, configureSkulpt, judge } from '../frontend/src/features/play/workspaces/python/program.js';
import { createLab, gradeLab } from '../engines/netsim/index.js';
import { machineState, pressKeys, resetMachine, run, startMission } from './machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const require = createRequire(join(ROOT, 'frontend/'));
function loadSkulpt() {
  if (globalThis.Sk) return globalThis.Sk;
  const dist = dirname(require.resolve('skulpt/package.json'));
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

function checkRewind(t) {
  t.rewind.forEach((x, i) => {
    if (!x.hint) fail(t.id, `rewind task ${i} has no hint`);
    if (x.type === 'mc' && !x.options.includes(x.answer)) fail(t.id, `rewind task ${i}: the answer isn't one of the options`);
  });
}

resetMachine();
const solved = {};

/* A lab is proven three ways: it isn't already solved, its solution solves it with no errors from any device,
   and the server's grader, working only from the saved configs, agrees. */
function playLab(t) {
  const id = t.id;
  const failing = gradeLab(t.lab, null, t.expect).filter((g) => !g.ok);
  if (!failing.length) fail(id, 'every goal already passes before any work is done');
  const lab = createLab(t.lab);
  let device = null;
  let commands = 0;
  for (const line of t.sol.split('\n')) {
    const cable = /^\[cable\] (\S+) (\S+) (\S+) (\S+)$/.exec(line);
    const switched = /^\[(\S+)\]$/.exec(line);
    if (cable) {
      const err = lab.plug(cable[1], cable[2], cable[3], cable[4]);
      if (err) fail(id, `${line}: ${err}`);
    } else if (switched) {
      device = switched[1];
      if (!lab.devices.has(device)) fail(id, `no device ${device}`);
    } else if (line) {
      commands++;
      const out = lab.run(device, line);
      if (/^\s*\^|^% |command not found|Usage:/m.test(out)) fail(id, `${device}: ${line}: ${out.slice(0, 160)}`);
    }
  }
  if (commands > t.par) fail(id, `par ${t.par} took ${commands}`);
  for (const g of lab.check(t.expect)) if (!g.ok) fail(id, `after the solution, "${g.label}" fails: ${g.why}`);
  const state = lab.serialize();
  // The MAC table comes from traffic, so the server's check sends traffic first, the same as this one.
  for (const g of gradeLab(t.lab, state, t.expect)) if (!g.ok) fail(id, `from saved configs, "${g.label}" fails: ${g.why}`);
  const again = createLab(t.lab, state).serialize();
  if (JSON.stringify(again) !== JSON.stringify(state)) fail(id, 'saving and loading the configs changed them');
  solved[id] = { kind: 'net', state };
}

async function play(t) {
  const id = t.id;
  checkRewind(t);
  if (t.kind === 'net') return playLab(t);
  startMission(t);
  if (t.kind === 'py') {
    if (hasPython) {
      try {
        const out = realPython(t);
        if (!/ALL_PASSED/.test(out)) fail(id, `real python: ${out.slice(-200)}`);
      } catch (e) {
        fail(id, `real python: ${e.stderr.toString().slice(-200)}`);
      }
    }
    const sk = await skulpt(t);
    if (!sk.passed) fail(id, `skulpt: ${sk.out.slice(-240)}`);
    return;
  }
  if (t.skill === 'VI') {
    if (!pressKeys(t.file, t.sol)) fail(id, 'vi was left open');
    if (!evalExpect(t.expect)) fail(id, 'the goal is not met after the solution');
    if (S.viKeys[t.file] > t.par) fail(id, `par ${t.par} took ${S.viKeys[t.file]}`);
    solved[id] = machineState();
    return;
  }
  if (t.skill === 'GO' && hasGo) {
    // Fix missions run with the blank filled in, and must print what they promise.
    const out = goRun(t.program.replace('____', t.answer[0]));
    const want = t.prints ?? t.answer[0];
    if (out !== want) fail(id, `go printed [${out}], wanted [${want}]`);
  }
  if (t.v && hasPython) {
    const out = pyValue(t.v);
    if (!t.answer.includes(out)) fail(id, `python [${out}] vs [${t.answer}]`);
  }
  let output = '';
  const cmds = t.sol.split('\n').filter((l) => !l.startsWith('submit'));
  for (const c of cmds) {
    const r = run(c);
    output += r.out;
    if (r.errors.length) fail(id, `${c}: ${r.errors.join(' ')}`);
  }
  if (t.expect) {
    if (!evalExpect(t.expect)) fail(id, 'the goal is not met after the solution');
    solved[id] = machineState();
  } else if (cmds.length && !t.reasoned && !t.answer.some((x) => output.toLowerCase().includes(x.toLowerCase()))) {
    fail(id, `output lacks ${t.answer}: ${output.slice(-160)}`);
  }
}

// Round-robin across tracks, the way someone moving between them would play.
const maxLen = Math.max(...TRACKS.map(([k]) => TK[k].length));
for (let i = 0; i < maxLen; i++) for (const [k] of TRACKS) if (TK[k][i]) await play(TK[k][i]);
for (const t of TK[BEYOND[0]]) await play(t);

writeFileSync(join(ROOT, 'content/build/solved_states.json'), JSON.stringify(solved));
console.log(`missions: ${ALL_MISSIONS.length}, goal states saved: ${Object.keys(solved).length}`);
if (!hasGo) console.log('note: go not found, Go outputs not checked');
if (!hasPython) console.log('note: python3 not found, Python solutions not checked');
console.log('PROBLEMS:', problems.length);
problems.slice(0, 40).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
