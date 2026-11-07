/* A player's virtual machine without a browser: the real engines, driven directly. The content tools
   use it to play missions the way a person would. */
import { S, host, replaceState } from '../engines/host.js';
import { fs, HOME } from '../engines/fs/index.js';
import { sh, runLine } from '../engines/shell/index.js';
import { VI, viKey } from '../engines/vi/index.js';
import { placeFixtures } from '../engines/replay.js';

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
  placeFixtures(t.fixtures);
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

/** The keys a solution presses, as the log entries the browser would send. */
export const keyLog = (keys) => keys.match(/<CR>|<Esc>|<C-.>|[\s\S]/g).map((k) => (k.startsWith('<C-') ? `c${k[3]}` : `k${k === '<CR>' ? 'Enter' : k === '<Esc>' ? 'Escape' : k}`));

export function pressKeys(file, keys) {
  run(`vi ${file}`);
  for (const entry of keyLog(keys)) viKey(entry.slice(1), entry[0] === 'c');
  return !VI.on;
}

/** What the browser reports to the server after a command. */
export const machineState = () => structuredClone({ files: S.overlay, cwd: S.cwd, gateway: S.net?.gw, ran_script: S.ranScript || null, vi_keys: S.viKeys, vi_used: S.viUsed });
