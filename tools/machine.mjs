/* A player's virtual machine without a browser: the real engines, driven directly. The content tools
   use it to play missions the way a person would. */
import { S, host, replaceState } from '../engines/host.js';
import { fs, HOME } from '../engines/fs/index.js';
import { sh, runLine } from '../engines/shell/index.js';
import { VI, viKey } from '../engines/vi/index.js';

let errors = [];
host.err = (t) => errors.push(t);
host.viShow = () => {};
host.afterVi = () => {};

export function resetMachine() {
  replaceState({ cwd: HOME, overlay: {}, hist: [], viKeys: {}, viUsed: {}, net: { gw: '10.40.3.1' }, ranScript: false });
  fs.reset(S.overlay);
}

export function startMission(t) {
  S.cwd = HOME;
  for (const [rel, content] of Object.entries(t.fixtures || {})) {
    const p = `${HOME}/${rel}`;
    if (fs.get(p)) continue;
    const parts = p.split('/');
    for (let i = 2; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!fs.get(dir)) fs.put(dir, { t: 'd', m: 0o755, mt: 'Nov  6 09:00' });
    }
    fs.put(p, { t: 'f', c: content, m: 0o644, mt: 'Nov  6 09:00' });
  }
}

export function run(line) {
  const buf = [];
  errors = [];
  sh.sink = buf;
  sh.errSink = null;
  try {
    runLine(line);
  } catch (e) {
    errors.push(e.message);
  }
  sh.sink = null;
  return { out: buf.join(''), errors };
}

export function pressKeys(file, keys) {
  run(`vi ${file}`);
  for (const k of keys.match(/<CR>|<Esc>|<C-.>|[\s\S]/g)) {
    if (k.startsWith('<C-')) viKey(k[3], true);
    else viKey(k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k, false);
  }
  return !VI.on;
}

/** What the browser reports to the server after a command. */
export const machineState = () => structuredClone({ files: S.overlay, cwd: S.cwd, gateway: S.net?.gw, ran_script: S.ranScript || null, vi_keys: S.viKeys, vi_used: S.viUsed });
