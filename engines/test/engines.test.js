import { beforeEach, describe, expect, it } from 'vitest';
import { host, replaceState, S } from '../host.js';
import { fs, HOME, norm } from '../fs/index.js';
import { runLine, sh } from '../shell/index.js';
import { VI, viKey } from '../vi/index.js';
import { rewindTasks } from '../rewind-preview/index.js';
import { TICKETS, TK } from '../../content/legacy/index.mjs';

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
  replaceState({ cwd: HOME, overlay: {}, hist: [], viKeys: {}, net: { gw: '10.40.3.1' }, ranScript: false });
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

describe('rewind generation, for every mission', () => {
  it('has a lesson and five well-formed tasks', () => {
    expect(TICKETS).toHaveLength(100);
    for (const t of TICKETS) {
      expect(t.learn?.[0], `${t.id} lesson`).toBeTruthy();
      const tasks = rewindTasks(t, TK);
      expect(tasks, t.id).toHaveLength(5);
      for (const x of tasks) {
        if (x.type === 'mc') {
          expect(x.options, t.id).toContain(x.answer);
          expect(x.options.length, t.id).toBeGreaterThanOrEqual(3);
          expect(new Set(x.options).size, t.id).toBe(x.options.length);
        }
        if (x.type === 'fill') expect(x.show, t.id).toContain('____');
        if (x.type === 'order') expect(x.scrambled, t.id).toHaveLength(x.items.length);
        if (x.type === 'memory') expect(x.answer[0], t.id).toBeTruthy();
      }
    }
  });
  it('is deterministic per mission', () => {
    const t = TICKETS[10];
    expect(rewindTasks(t, TK)).toEqual(rewindTasks(t, TK));
  });
});
