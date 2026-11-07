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
import { keyLog, machineState, pressKeys, resetMachine, run, startMission } from './machine.mjs';
import { replay } from '../engines/replay.js';

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

/* The server decides shell and vi missions by replaying the player's log, so a log of the solution has to end on the
   exact machine that playing it did. What's saved here lets the backend tests prove the same through the real runner. */
let carried = null; // an Operation's log runs across its stages, because so does its machine
function proveReplay(t, stepLog) {
  const log = carried ? [...carried, ...stepLog] : stepLog;
  if (carried) carried = log;
  const played = machineState();
  const replayed = replay({ base: [], fixtures: t.fixtures, log });
  if (JSON.stringify(replayed.state.files) !== JSON.stringify(played.files)) fail(t.id, 'replaying the log gave different files');
  if (replayed.state.cwd !== played.cwd) fail(t.id, 'replaying the log ended in a different folder');
  solved[t.id] = { ...played, log };
}

/* Real code, under real `go test`: the solution has to pass, and the starter has to fail. */
function goTest(t, code) {
  const d = mkdtempSync(join(tmpdir(), 'uptime-gotest-'));
  writeFileSync(join(d, 'go.mod'), 'module mission\n\ngo 1.22\n');
  writeFileSync(join(d, 'main.go'), code);
  writeFileSync(join(d, 'main_test.go'), t.goTest);
  try {
    execSync('go test -vet=off -timeout 10s ./... 2>&1', { cwd: d, env: { ...GOENV, CGO_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

async function playOperation(t) {
  checkRewind(t);
  resetMachine();
  startMission(t);
  carried = [];
  for (const [i, stage] of t.stages.entries()) await play({ ...stage, id: `${t.id}:${i}`, fixtures: t.fixtures, rewind: [] }, true);
  carried = null;
}

async function play(t, inOperation = false) {
  const id = t.id;
  if (t.kind === 'ops') return playOperation(t);
  checkRewind(t);
  if (t.kind === 'net') return playLab(t);
  if (!inOperation) {
    // Every mission starts on a clean machine, the same one the server replays a player's work on (ADR 0015).
    resetMachine();
    startMission(t);
  }
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
    proveReplay(t, [`lvi ${t.file}`, ...keyLog(t.sol)]);
    return;
  }
  if (t.check === 'go-code') {
    if (hasGo) {
      if (!goTest(t, t.sol)) fail(id, 'the solution fails go test');
      if (goTest(t, t.starter)) fail(id, 'the starter already passes go test');
    }
    return;
  }
  if (t.skill === 'GO' && hasGo) {
    const out = goRun(t.program);
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
  if (carried && !t.expect) carried = [...carried, ...cmds.map((c) => `l${c}`)];
  if (t.expect) {
    if (!evalExpect(t.expect)) fail(id, 'the goal is not met after the solution');
    proveReplay(t, cmds.map((c) => `l${c}`));
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
