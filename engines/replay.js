/* Plays back what a player actually did, on a clean machine, so the result is what happened and not what a browser
   says happened (ADR 0015). The browser starts each mission on this same clean machine and logs every line and key,
   so an honest player always gets the same result here. Nothing in the log is evaluated as code: it only reaches the
   shell and vi engines, the same as typing does. */
import { S, host, replaceState } from './host.js';
import { F, HOME, fs } from './fs/index.js';
import { runLine, sh } from './shell/index.js';
import { VI, viKey } from './vi/index.js';

/** A clean machine: the base files, plus a mission's own. The browser and the replay must both start from this. */
export function cleanMachine() {
  return { cwd: HOME, overlay: {}, viKeys: {}, viUsed: {}, net: { gw: '10.40.3.1' }, ranScript: false };
}

export function placeFixtures(files) {
  for (const [rel, content] of Object.entries(files || {})) {
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

/** Log entries: "l<line>" is a shell line, "k<key>" a key pressed in vi, and "c<key>" the same with Ctrl held. */
export function replay({ base, fixtures, log }) {
  for (const f of base) F(f.path, f.content, f.mode);
  replaceState({ ...cleanMachine(), hist: [] });
  fs.reset(S.overlay);
  placeFixtures(fixtures);
  host.err = () => {};
  host.viShow = () => {};
  host.afterVi = () => {};
  let commands = 0;
  for (const entry of log) {
    const kind = entry[0];
    const value = entry.slice(1);
    if (kind === 'l' && !VI.on) {
      commands += 1;
      sh.sink = [];
      sh.errSink = null;
      sh.code = 0;
      try {
        runLine(value);
      } catch { /* a failing command fails here as it did there */ }
      sh.sink = null;
    } else if ((kind === 'k' || kind === 'c') && VI.on) {
      viKey(value, kind === 'c');
    }
  }
  return { state: { files: S.overlay, cwd: S.cwd, gateway: S.net?.gw, ran_script: S.ranScript || null, vi_keys: S.viKeys, vi_used: S.viUsed }, commands };
}
