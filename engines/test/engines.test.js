import { beforeEach, describe, expect, it } from 'vitest';
import { host, replaceState, S } from '../host.js';
import { F, fs, HOME, norm } from '../fs/index.js';
import { runLine, sh } from '../shell/index.js';
import { VI, viKey } from '../vi/index.js';
import { evalExpect } from '../fs/expect.js';
import { ALL_MISSIONS, TK, TICKETS } from '../../content/index.mjs';
import { createLab, faultCandidates, playSolution } from '../netsim/index.js';

const run = (line) => {
  const out = [];
  const errs = [];
  sh.sink = out;
  sh.errSink = errs;
  runLine(line);
  sh.sink = null;
  sh.errSink = null;
  return { out: out.join(''), err: errs.join('') };
};

beforeEach(() => {
  replaceState({ cwd: HOME, overlay: {}, hist: [], viKeys: {}, viUsed: {}, net: { gw: '10.40.3.1' }, ranScript: false });
  fs.reset({});
  VI.on = false;
});

describe('file system', () => {
  it('resolves relative paths against the working directory', () => {
    expect(norm('logs/../vi')).toBe(`${HOME}/vi`);
  });
  it('records writes and deletes in the overlay, so a save can restore them', () => {
    run('echo hi > note.txt');
    expect(S.overlay[`${HOME}/note.txt`].c).toBe('hi\n');
    run('rm note.txt');
    expect(fs.get(`${HOME}/note.txt`)).toBeUndefined();
    expect(S.overlay[`${HOME}/note.txt`]).toBeNull();
  });
  it('rebuilds the same tree from an overlay', () => {
    run('echo hi > note.txt');
    const saved = JSON.parse(JSON.stringify(S.overlay));
    fs.reset({});
    expect(fs.get(`${HOME}/note.txt`)).toBeUndefined();
    fs.reset(saved);
    expect(fs.get(`${HOME}/note.txt`).c).toBe('hi\n');
  });
});

describe('shell', () => {
  it('runs pipelines', () => {
    expect(run('seq 5 | tail -2 | wc -l').out.trim()).toBe('2');
  });
  it('runs the sort | uniq -c | sort -rn idiom', () => {
    run('printf "a\\nb\\na\\n" > t.txt');
    const top = run('sort t.txt | uniq -c | sort -rn | head -1').out;
    expect(top).toMatch(/2 a/);
  });
  it('runs awk with arrays', () => {
    run('printf "x 1\\ny 2\\nx 3\\n" > t.txt');
    expect(run("awk '{s[$1]+=$2} END{print s[\"x\"]}' t.txt").out.trim()).toBe('4');
  });
  it('runs sed substitutions', () => {
    run('echo old > t.txt');
    expect(run("sed 's/old/new/' t.txt").out.trim()).toBe('new');
  });
  it('handles && and exit codes', () => {
    expect(run('cat /nope && echo no').out).not.toContain('no\n');
    expect(run('cat /nope || echo fallback').out).toContain('fallback');
  });
  it('reports a missing file on the error stream', () => {
    expect(run('cat /nope').err).toContain('No such file');
  });
});

describe('vi', () => {
  const type = (keys) => {
    for (const k of keys.match(/<CR>|<Esc>|[\s\S]/g)) viKey(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
  };

  it('edits and saves through the host hooks', () => {
    const events = [];
    host.viShow = (on) => events.push(`show:${on}`);
    host.afterVi = () => events.push('after');
    run('echo one > v.txt');
    run('vi v.txt');
    expect(VI.on).toBe(true);
    type('otwo<Esc>:wq<CR>');
    expect(fs.get(`${HOME}/v.txt`).c).toBe('one\ntwo\n');
    expect(S.viKeys[`${HOME}/v.txt`]).toBeGreaterThan(0);
    expect(events).toEqual(['show:true', 'show:false', 'after']);
  });
  it('discards changes on :q!', () => {
    run('echo one > v.txt');
    run('vi v.txt');
    type('dd:q!<CR>');
    expect(fs.get(`${HOME}/v.txt`).c).toBe('one\n');
  });
  it('supports counts, undo and dot-repeat', () => {
    run('printf "a\\nb\\nc\\nd\\n" > v.txt');
    run('vi v.txt');
    type('2dd');
    expect(VI.L).toEqual(['c', 'd']);
    type('u');
    expect(VI.L).toEqual(['a', 'b', 'c', 'd']);
    type('dd.');
    expect(VI.L).toEqual(['c', 'd']);
    type(':q!<CR>');
  });
});

describe('every mission', () => {
  const LEVELS = ['easy', 'medium', 'hard'];
  it('has a lesson and five clear rewind tasks, easiest first', () => {
    expect(TICKETS).toHaveLength(213);
    expect(ALL_MISSIONS).toHaveLength(263);
    for (const t of ALL_MISSIONS) {
      expect(t.learn[0], t.id).toBeTruthy();
      expect(t.rewind, t.id).toHaveLength(5);
      const order = t.rewind.map((x) => LEVELS.indexOf(x.level));
      expect([...order].sort(), t.id).toEqual(order);
      for (const x of t.rewind) {
        expect(x.q, t.id).toBeTruthy();
        expect(x.hint, t.id).toBeTruthy();
        expect(x.label, t.id).toBeTruthy();
        if (x.type === 'mc') {
          expect(x.options.length, t.id).toBeGreaterThanOrEqual(3);
          expect(new Set(x.options).size, t.id).toBe(x.options.length);
          expect(x.options, t.id).toContain(x.answer);
        }
        if (x.type === 'order') expect([...x.scrambled].sort(), t.id).toEqual([...x.answer].sort());
        if (x.type === 'text') expect(x.answer.length, t.id).toBeGreaterThan(0);
      }
    }
  });
  it('keeps vi questions honest: every key is really part of the solution', () => {
    for (const t of ALL_MISSIONS.filter((m) => m.skill === 'VI')) {
      const gap = t.rewind[3];
      expect(gap.show.replace('____', gap.answer[0]), t.id).toBe(t.sol);
      const order = t.rewind[2];
      if (order.type === 'order') expect(order.answer.join(''), t.id).toBe(t.sol);
    }
  });
  it('gets harder as a track goes on', () => {
    const rank = ['easy', 'medium', 'hard', 'expert', 'brainfuck'];
    for (const list of Object.values(TK)) {
      const levels = list.map((m) => rank.indexOf(m.difficulty));
      expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    }
    expect(TK.BX.at(-1).difficulty).toBe('brainfuck');
  });
});

describe('expect rules', () => {
  it('checks files, modes and the working directory', () => {
    F(`${HOME}/e.txt`, 'hello world\n', 0o755);
    fs.reset({});
    expect(evalExpect([{ file_exists: '~/e.txt' }, { file_missing: '~/nope' }])).toBe(true);
    expect(evalExpect([{ file_equals: { path: '~/e.txt', content: 'hello world\n' } }])).toBe(true);
    expect(evalExpect([{ file_contains: { path: '~/e.txt', text: 'world' } }])).toBe(true);
    expect(evalExpect([{ mode_has: { path: '~/e.txt', bit: 'x' } }])).toBe(true);
    expect(evalExpect([{ cwd_is: '~' }])).toBe(true);
    expect(evalExpect([{ file_exists: '~/nope' }])).toBe(false);
    expect(evalExpect([{ cwd_is: '/etc' }])).toBe(false);
  });
});

describe('vi: the full track', () => {
  const edit = (start, keys) => {
    F(`${HOME}/t.txt`, start);
    fs.reset({});
    runLine(`vi ${HOME}/t.txt`);
    for (const k of keys.match(/<CR>|<Esc>|<C-.>|[\s\S]/g)) {
      if (k.startsWith('<C-')) viKey(k[3], true);
      else viKey(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
    }
    viKey(':', false);
    for (const k of 'wq') viKey(k, false);
    viKey('Enter', false);
    return fs.get(`${HOME}/t.txt`).c;
  };
  it('redoes what undo took back', () => {
    expect(edit('abc\n', 'xxuu<C-r>')).toBe('bc\n');
  });
  it('changes inside quotes and deletes inside brackets', () => {
    expect(edit('a = "old" + f(1, 2)\n', 'ci"new<Esc>')).toBe('a = "new" + f(1, 2)\n');
    expect(edit('f(1, 2)\n', 'ldi(')).toBe('f()\n');
    expect(edit('f(1, 2) z\n', 'lda(')).toBe('f z\n');
    expect(edit('one two\n', 'wciwTHREE<Esc>')).toBe('one THREE\n');
  });
  it('stops short with t and goes back with ,', () => {
    expect(edit('a,b,c\n', 'dt,')).toBe(',b,c\n');
    expect(edit('a,b,c\n', 'f,;,x')).toBe('ab,c\n');
  });
  it('deletes a visual selection, by character and by line', () => {
    expect(edit('abcdef\n', 'lvld')).toBe('adef\n');
    expect(edit('a\nb\nc\n', 'Vjd')).toBe('c\n');
    expect(edit('ab\ncd\nef\n', 'lvjd')).toBe('a\nef\n');
  });
  it('inserts on every row of a block', () => {
    expect(edit('a\nb\nc\n', '<C-v>2jI# <Esc>')).toBe('# a\n# b\n# c\n');
  });
  it('keeps named registers apart', () => {
    expect(edit('one\ntwo\n', '"ayyj"byyG"ap"bp')).toBe('one\ntwo\none\ntwo\n');
  });
  it('jumps to and deletes to a mark', () => {
    expect(edit('a\nb\nc\nd\n', "jmaGd'a")).toBe('a\n');
  });
  it('records a macro and replays it with a count', () => {
    expect(edit('a\nb\nc\n', 'qaI- <Esc>jq2@a')).toBe('- a\n- b\n- c\n');
  });
  it('runs ex commands over ranges', () => {
    expect(edit('a\nb\nc\nd\n', ':2,3d<CR>')).toBe('a\nd\n');
    expect(edit('x\nx\nx\n', ':2,$s/x/y/<CR>')).toBe('x\ny\ny\n');
    expect(edit('#c\na=1\nnope\n', ':g/^#/d<CR>:v/=/d<CR>')).toBe('a=1\n');
  });
  it('reads in another file and writes a copy', () => {
    F(`${HOME}/foot.txt`, 'end\n');
    expect(edit('top\n', `:r ${HOME}/foot.txt<CR>:w ${HOME}/copy.txt<CR>`)).toBe('top\nend\n');
    expect(fs.get(`${HOME}/copy.txt`).c).toBe('top\nend\n');
  });
  it("doesn't double count keys when you save twice", () => {
    edit('a\n', ':w<CR>');
    expect(S.viKeys[`${HOME}/t.txt`]).toBe(7);
  });
});

describe('shell: scripts take arguments', () => {
  it('passes words to $1 when a script runs by path', () => {
    F(`${HOME}/s.sh`, 'echo "hi $1"\n', 0o755);
    fs.reset({});
    const buf = [];
    sh.sink = buf;
    runLine(`${HOME}/s.sh amina`);
    sh.sink = null;
    expect(buf.join('')).toContain('hi amina');
    expect(S.ranScript).toBe(`${HOME}/s.sh`);
  });
});

describe('every lab', () => {
  it('a laptop points router commands at the right device, and leaves other typos alone', () => {
    const t = labs.find((x) => x.id === 'lab-36');
    const lab = createLab(t.lab);
    const run = (line) => [lab.run('GUEST-1', line)].flat().map((o) => o.text ?? o).join(' ');
    expect(run('enable')).toMatch(/GUEST-1 is a laptop.*on the map/);
    expect(run('pingg 10.0.0.1')).toMatch(/command not found/);
  });
  const labs = ALL_MISSIONS.filter((m) => m.track === 'LAB');
  const solved = (t) => {
    const lab = createLab(t.lab);
    playSolution(lab, t.sol);
    return lab;
  };
  it('has only addresses and devices its own solution uses', () => {
    expect(labs).toHaveLength(44);
    for (const t of labs) for (const said of playSolution(createLab(t.lab), t.sol)) expect(said.said, `${t.id} ${said.line}`).not.toMatch(/no device/);
  });
  it('saves and loads every fault a drill could inject, with nothing lost', () => {
    for (const t of labs) {
      for (const fault of faultCandidates(solved(t))) {
        const lab = solved(t);
        lab.applyLines(fault.device, fault.lines);
        const saved = lab.serialize();
        expect(createLab(t.lab, saved).serialize(), `${t.id}: ${fault.explain}`).toEqual(saved);
      }
    }
  });
});
