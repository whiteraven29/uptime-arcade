/* NetLab's simulator. Pure JavaScript, so the browser, the tests and the server's grader run the same code. */
import { macOf } from './addr.js';
import { isHost, newDevice } from './device.js';
import { buildNet } from './forward.js';
import { hostConfig, hostRun, HOST_WORDS } from './host.js';
import { iosApply, iosComplete, iosHelp, iosLoad, iosRun, prompt, running } from './ios.js';
import { checkGoals } from './check.js';
import { clearAir } from './net.js';
import { faultCandidates, injectFaults, reachabilityGoals } from './faults.js';

const MAX_CABLES = 64;

export class Lab {
  constructor(topology, state = null) {
    this.topology = topology;
    this.devices = new Map();
    this.cables = [];
    this.cableMap = new Map();
    this.startups = new Map();
    this.cached = null;
    this.trace = null;
    this.runtime = { nat: new Map(), conns: new Map(), macs: new Map(), arp: new Map(), nextPort: 20000 };
    for (const spec of topology.devices) {
      const dev = newDevice(spec);
      this.devices.set(spec.name, dev);
      const saved = state?.devices?.[spec.name];
      // A locked device is someone else's, like the ISP. What a client says about it is never read.
      const usable = saved && !spec.locked;
      this.load(dev, usable && typeof saved.running === 'string' ? saved.running : spec.config || '');
      this.startups.set(spec.name, usable && typeof saved.startup === 'string' ? saved.startup : this.configOf(spec.name));
    }
    const cables = Array.isArray(state?.cables) && topology.cabling ? state.cables : topology.cables || [];
    for (const c of cables.slice(0, MAX_CABLES)) this.plug(c[0], c[1], c[2], c[3]);
  }

  load(dev, text) {
    if (isHost(dev)) for (const line of String(text).split('\n').slice(0, 300)) hostRun(this, dev, line, true);
    else iosLoad(this, dev, text);
  }

  touch() {
    this.cached = null;
  }

  net() {
    if (!this.cached) this.cached = buildNet(this);
    return this.cached;
  }

  setTrace(result) {
    this.trace = result;
  }

  configOf(name) {
    const dev = this.devices.get(name);
    return isHost(dev) ? hostConfig(dev) : running(dev);
  }

  startupOf(name) {
    return this.startups.get(name) ?? '';
  }

  save(name) {
    this.startups.set(name, this.configOf(name));
  }

  eraseStartup(name) {
    this.startups.set(name, '');
  }

  reload(name) {
    const spec = this.devices.get(name).spec;
    const fresh = newDevice(spec);
    this.devices.set(name, fresh);
    this.load(fresh, this.startupOf(name));
    this.runtime.nat.delete(name);
    this.runtime.conns.delete(name);
    this.runtime.macs.delete(name);
    this.runtime.arp.delete(name);
    fresh.mode = 'priv';
    this.touch();
  }

  /** A few lines of config on top of what's there, without touching a device's console. */
  applyLines(name, lines) {
    const dev = this.devices.get(name);
    if (isHost(dev)) for (const line of lines) hostRun(this, dev, line, true);
    else iosApply(this, dev, lines);
    this.touch();
  }

  /* ---------- the sandbox: devices that come and go ---------- */
  addDevice(spec) {
    if (this.devices.has(spec.name)) return false;
    this.topology.devices.push(spec);
    const dev = newDevice(spec);
    this.devices.set(spec.name, dev);
    this.load(dev, spec.config || '');
    this.startups.set(spec.name, this.configOf(spec.name));
    this.touch();
    return true;
  }

  removeDevice(name) {
    const dev = this.devices.get(name);
    if (!dev) return;
    clearAir(this);
    for (const port of dev.ifaces.keys()) this.unplug(name, port);
    this.devices.delete(name);
    this.startups.delete(name);
    this.topology.devices = this.topology.devices.filter((d) => d.name !== name);
    this.touch();
  }

  moveDevice(name, x, y) {
    const dev = this.devices.get(name);
    if (!dev) return;
    dev.x = x;
    dev.y = y;
    dev.spec.x = x;
    dev.spec.y = y;
    this.touch();
  }

  /* ---------- cables ---------- */
  portFree(dev, port) {
    return !this.cableMap.has(`${dev}|${port}`);
  }

  plug(a, pa, b, pb) {
    const [da, db] = [this.devices.get(a), this.devices.get(b)];
    if (!da || !db || a === b) return 'Those two ends need to be two different devices.';
    if (!da.ifaces.has(pa) || !db.ifaces.has(pb)) return 'One of those ports doesn\'t exist.';
    if (pa.includes('.') || pb.includes('.') || !/^(Gi|eth)/.test(pa) || !/^(Gi|eth)/.test(pb)) return 'Cables go into physical ports.';
    if (!this.portFree(a, pa) || !this.portFree(b, pb)) return 'One of those ports already has a cable in it.';
    if (this.cables.length >= MAX_CABLES) return 'That\'s enough cables for one lab.';
    this.cables.push([a, pa, b, pb]);
    this.cableMap.set(`${a}|${pa}`, { dev: b, port: pb });
    this.cableMap.set(`${b}|${pb}`, { dev: a, port: pa });
    this.touch();
    return '';
  }

  unplug(dev, port) {
    const peer = this.cableMap.get(`${dev}|${port}`);
    if (!peer) return;
    this.cableMap.delete(`${dev}|${port}`);
    this.cableMap.delete(`${peer.dev}|${peer.port}`);
    this.cables = this.cables.filter((c) => !((c[0] === dev && c[1] === port) || (c[2] === dev && c[3] === port)));
    this.touch();
  }

  cutCable(dev, port) {
    this.unplug(dev, port);
  }

  /* ---------- talking to a device ---------- */
  run(name, line) {
    const dev = this.devices.get(name);
    if (!dev || dev.locked) return '';
    return isHost(dev) ? hostRun(this, dev, line) : iosRun(this, dev, line);
  }

  promptOf(name) {
    const dev = this.devices.get(name);
    if (isHost(dev)) return `ops@${name}:~$`;
    return dev.pending === 'enable' ? 'Password:' : prompt(dev);
  }

  /** Tab. Returns the longer line, or null when nothing can be added. */
  complete(name, partial) {
    const dev = this.devices.get(name);
    if (isHost(dev)) {
      if (/\s/.test(partial)) return null;
      const hits = HOST_WORDS.filter((w) => w.startsWith(partial));
      return hits.length === 1 && partial ? `${hits[0]} ` : null;
    }
    return iosComplete(dev, partial);
  }

  helpFor(name, partial) {
    const dev = this.devices.get(name);
    return isHost(dev) ? HOST_WORDS.join(' ') : iosHelp(dev, partial);
  }

  /* ---------- saving and judging ---------- */
  serialize() {
    const devices = {};
    for (const [name, dev] of this.devices) {
      if (dev.locked) continue;
      devices[name] = { running: this.configOf(name), startup: this.startupOf(name) };
    }
    const state = { devices };
    if (this.topology.cabling) state.cables = this.cables.map((c) => [...c]);
    return state;
  }

  clone() {
    const copy = new Lab({ ...this.topology, cabling: true }, this.serialize());
    if (!this.topology.cabling) {
      for (const c of [...copy.cables]) copy.unplug(c[0], c[1]);
      for (const c of this.cables) copy.plug(c[0], c[1], c[2], c[3]);
    }
    return copy;
  }

  check(goals) {
    return checkGoals(this, goals);
  }

  /* What the canvas draws. */
  view() {
    const net = this.net();
    const air = [...net.air.assoc].map(([host, a]) => ({ a: host, pa: 'wlan0', b: a.ap, pb: a.ssid, up: true, blocked: false, wifi: true }));
    return {
      devices: [...this.devices.values()].map((d) => ({ name: d.name, kind: d.kind, x: d.x, y: d.y, locked: d.locked, hostname: d.hostname, ports: [...d.ifaces.keys()].filter((p) => /^(Gi\d+\/\d+|eth\d+)$/.test(p)), mac: isHost(d) ? macOf(d.name, 'eth0') : null })),
      cables: this.cables.map(([a, pa, b, pb]) => ({ a, pa, b, pb, up: !net.blocked.has(`${a}|${pa}`) && !net.blocked.has(`${b}|${pb}`) && linkUp(net, this, a, pa) && linkUp(net, this, b, pb), blocked: net.blocked.has(`${a}|${pa}`) || net.blocked.has(`${b}|${pb}`) })).concat(air),
    };
  }
}
function linkUp(net, lab, dev, port) {
  const d = lab.devices.get(dev);
  const p = d.ifaces.get(port);
  return !!p && !p.shut && !net.errDisabled.has(`${dev}|${port}`) && !(isHost(d) && d.linkDown);
}

/** Plays a written solution: [DEVICE] switches console and [cable] plugs in. Returns each command and what it said. */
export function playSolution(lab, text) {
  let device = null;
  const out = [];
  for (const line of text.split('\n')) {
    const cable = /^\[cable\] (\S+) (\S+) (\S+) (\S+)$/.exec(line);
    const switched = /^\[(\S+)\]$/.exec(line);
    if (cable) out.push({ device: 'cable', line, said: lab.plug(cable[1], cable[2], cable[3], cable[4]), cable: true });
    else if (switched) device = switched[1];
    else if (line) out.push({ device, line, said: lab.devices.has(device) ? lab.run(device, line) : `no device ${device}` });
  }
  return out;
}

export const createLab = (topology, state = null) => new Lab(topology, state);
export { faultCandidates, injectFaults, reachabilityGoals };
/** What the server calls: the goals against whatever config was submitted. */
export const gradeLab = (topology, state, goals) => {
  const lab = new Lab(topology, state);
  // Dynamic state from the browser is never read, so the answer depends only on the config.
  return lab.check(goals);
};
