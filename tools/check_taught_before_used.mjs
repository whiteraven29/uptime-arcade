#!/usr/bin/env node
/* Section 7, principle 2: nothing may appear in a solution before a lesson has taught it. Each mission
   lists what its lesson teaches, the lesson text has to mention it, and every command, flag, keyword or
   key its solution uses must be listed by this mission or an earlier one in the same track. */
import { execFileSync } from 'node:child_process';
import * as g from '../frontend/src/api/localGame.js';
import { VI } from '../engines/vi/index.js';

const { TK, TRACKS } = g;
const problems = [];

const SHELL_SKIP = new Set(['submit', 'in', 'then', 'else', 'fi']);
function shellTokens(sol) {
  const out = new Set();
  for (const line of sol.split('\n')) {
    if (line.startsWith('submit')) continue;
    const bare = line.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, (q) => (q.includes('$') ? ' "$ ' : ' '));
    if (/\$\(/.test(bare)) out.add('$(');
    if (/\$\{/.test(bare)) out.add('${');
    for (const op of ['>>', '|', '<', '&&', '||']) if (bare.includes(op)) out.add(op);
    if (/(^|[^>])>([^>]|$)/.test(bare)) out.add('>');
    const segments = bare.replace(/\$\(/g, ' ').replace(/^\s*\w+=/, ' ').split(/\||;|&&|\|\||>>?|</);
    for (const seg of segments) {
      const w = seg.trim().split(/\s+/).filter(Boolean);
      if (!w.length) continue;
      if (/^[a-z][a-z0-9]*$/.test(w[0]) && !SHELL_SKIP.has(w[0])) out.add(w[0]);
      for (const x of w.slice(1)) {
        if (x === '-exec') out.add('-exec');
        else if (x === '-name') out.add('-name');
        else if (/^-[a-zA-Z]+$/.test(x)) for (const c of x.slice(1)) out.add(`-${c}`);
      }
    }
  }
  return out;
}

const PY_FIND = `
import ast, json, sys
tree = ast.parse(sys.stdin.read())
found = set()
BUILTINS = {'print','len','range','int','float','str','bool','min','max','sum','sorted','list','set','dict','round','abs','open'}
for n in ast.walk(tree):
    t = type(n).__name__
    if t == 'FunctionDef': found.add('def')
    elif t == 'ClassDef': found.add('class')
    elif t == 'If': found.add('if')
    elif t == 'For': found.add('for')
    elif t == 'While': found.add('while')
    elif t == 'Break': found.add('break')
    elif t == 'Return': found.add('return')
    elif t == 'Try': found.add('try')
    elif t == 'Raise': found.add('raise')
    elif t == 'With': found.add('with')
    elif t == 'Yield': found.add('yield')
    elif t == 'Assert': found.add('assert')
    elif t in ('Import', 'ImportFrom'): found.add('import')
    elif t == 'ListComp': found.add('comprehension')
    elif t == 'JoinedStr': found.add('f-string')
    elif t == 'Call':
        f = n.func
        if isinstance(f, ast.Name) and f.id in BUILTINS: found.add(f.id)
        if isinstance(f, ast.Attribute): found.add(f.attr)
    elif t == 'BinOp' and isinstance(n.op, ast.Pow): found.add('**')
    elif t == 'BinOp' and isinstance(n.op, ast.RShift): found.add('>>')
    elif t == 'Subscript' and isinstance(n.slice, ast.Slice): found.add('[a:b]')
print(json.dumps(sorted(found)))
`;
function pyTokens(sol) {
  return new Set(JSON.parse(execFileSync('python3', ['-c', PY_FIND], { input: sol }).toString()));
}

const GO_WORDS = ['package', 'import', 'func', 'var', 'const', 'iota', 'if', 'switch', 'for', 'range', 'return', 'type', 'struct', 'interface', 'defer', 'go', 'select', 'chan', 'make', 'append', 'copy', 'len', 'cap', 'close', 'panic', 'recover', 'nil', 'map'];
function goTokens(t) {
  const code = t.program.replace(/^package main[\s\S]*?\n\)\n/, '').replace(/"[^"]*"/g, '""').replace(/\/\/.*$/gm, '');
  const out = new Set();
  for (const w of GO_WORDS) if (new RegExp(`\\b${w}\\b`).test(code)) out.add(w);
  for (const m of code.matchAll(/\b(fmt|strconv|strings|errors|time|sync|context)\.([A-Z]\w*)/g)) { out.add(m[1]); out.add(m[2]); }
  if (/\bsync\.\w+/.test(code)) for (const m of code.matchAll(/\.(Add|Done|Wait|Lock|Unlock)\(/g)) out.add(m[1]);
  if (code.includes('<-')) out.add('<-');
  return out;
}

g.boot(null);
g.setNavigator(() => {});
const VI_ALWAYS = new Set(['Escape', 'Enter', ':']);
function viTokens(t) {
  g.setCurrent(t.id);
  g.runCommand(`vi ${t.file}`);
  for (const k of t.sol.match(/<CR>|<Esc>|<C-.>|[\s\S]/g)) {
    if (k.startsWith('<C-')) g.viPress(k[3], true);
    else g.viPress(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
  }
  const used = new Set((g.S.viUsed && g.S.viUsed[t.file]) || VI.used);
  for (const k of [...used]) if (VI_ALWAYS.has(k)) used.delete(k);
  return used;
}

const tokensFor = {
  SH: (t) => shellTokens(t.sol),
  NET: (t) => shellTokens(t.sol),
  VI: viTokens,
  PY: (t) => pyTokens(t.sol),
  GO: goTokens,
};
/* A few things are the same skill under another name, so teaching one covers the other. */
const SAME = { VI: { dd: 'd', yy: 'y', cc: 'c', cw: 'c', dw: 'd', '3dd': 'd', ddp: 'd', ':%s': ':s', ':N': 'N', gg: 'g', 'i"': 'i', 'i(': 'i', 'a(': 'a', iw: 'i', '"a': '"', "'": "'", '>': '>', '<': '<', ':d': ':d', '.,$': ':s' } };

for (const [k] of TRACKS) {
  const taught = new Set();
  for (const t of TK[k]) {
    if (!t.teaches?.length) problems.push(`${t.id}: lists nothing under teaches`);
    const lesson = `${t.learn[0]} ${t.learn[1]}`;
    for (const x of t.teaches || []) {
      taught.add(x);
      if (SAME[k]?.[x]) taught.add(SAME[k][x]);
      const claims = x === 'capstone' || x === 'state' || x === 'unpack' || x === 'comprehension' || x === 'f-string' || x === 'default' || x === 'keyword' || x === 'receiver' || x === 'slice' || x === 'table' || x === 'size' || x === 'hosts' || x === 'block';
      if (!claims && k !== 'VI' && !lesson.includes(x.replace(/^\[i\]$/, '[0]').replace(/^\[\]$/, '['))) problems.push(`${t.id}: claims to teach ${x}, but the lesson never mentions it`);
    }
    for (const tok of tokensFor[k](t)) if (!taught.has(tok)) problems.push(`${t.id} "${t.title}": uses ${tok} before any lesson teaches it`);
  }
}

console.log('taught-before-used problems:', problems.length);
problems.slice(0, 80).forEach((p) => console.log(' -', p));
process.exit(problems.length ? 1 : 0);
