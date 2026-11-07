/* Skulpt, self-hosted and loaded on first use, so the game stays offline-capable. */
import skulptUrl from 'skulpt/dist/skulpt.min.js?url';
import stdlibUrl from 'skulpt/dist/skulpt-stdlib.js?url';
import { bump, ui } from '../../../../api/localGame.js';

const addScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = reject;
  document.head.appendChild(s);
});

export function exec(src) {
  const Sk = window.Sk;
  const o = [];
  Sk.configure({
    output: (t) => o.push(t),
    read: (f) => {
      if (Sk.builtinFiles === undefined || Sk.builtinFiles.files[f] === undefined) throw new Error('File not found: ' + f);
      return Sk.builtinFiles.files[f];
    },
    __future__: Sk.python3,
    execLimit: 4000,
  });
  return Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, src, true)).then(
    () => ({ out: o.join(''), ok: true }),
    (e) => ({ out: o.join('') + '\n' + e.toString(), ok: false }),
  );
}

let loading = null;
export function loadPython() {
  if (loading) return loading;
  ui.py.state = 'loading';
  const go = addScript(skulptUrl)
    .then(() => addScript(stdlibUrl))
    .then(() => exec('print(6*7)'))
    .then((r) => {
      if (r.out.trim() !== '42') throw new Error('smoke test failed');
      ui.py.state = 'ready';
    });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000));
  loading = Promise.race([go, timeout])
    .catch(() => {
      ui.py.state = 'failed';
    })
    .then(bump);
  return loading;
}

const HARNESS = `
_fails = 0
def _t(name, got, want):
    global _fails
    if got == want and type(got) == type(want):
        print("ok   " + name)
    else:
        _fails = _fails + 1
        print("FAIL " + name + ": got " + repr(got) + ", wanted " + repr(want))
`;

export async function runTests(mission, src) {
  const tests = mission.tests.map((x) => `_t(${JSON.stringify(x[0])}, ${x[0]}, ${x[1]})`).join('\n');
  const r = await exec(`${src}\n${HARNESS}${tests}\nprint("ALL_PASSED" if _fails == 0 else "SOME_FAILED")\n`);
  return { passed: r.ok && /ALL_PASSED/.test(r.out), out: r.out.replace(/ALL_PASSED|SOME_FAILED/, '').trim() };
}
