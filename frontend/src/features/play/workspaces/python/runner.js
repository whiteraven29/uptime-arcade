/* Skulpt, self-hosted and loaded on first use. The tests are visible by design (section 14). */
import skulptUrl from 'skulpt/dist/skulpt.min.js?url';
import stdlibUrl from 'skulpt/dist/skulpt-stdlib.js?url';
import { bump, ui } from '../../../../api/game.js';
import { buildProgram, configureSkulpt, judge } from './program.js';

const addScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = reject;
  document.head.appendChild(s);
});

export function exec(src, mission) {
  const Sk = window.Sk;
  const o = [];
  configureSkulpt(Sk, mission, (t) => o.push(t));
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

export async function runTests(mission, src) {
  const { text, offset } = buildProgram(mission, src);
  return judge(await exec(text, mission), offset);
}
