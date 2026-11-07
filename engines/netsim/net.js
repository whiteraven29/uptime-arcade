/* From configuration to a working network: which links are up, how switches forward, who is OSPF neighbours
   with whom, and what each routing table holds. It's all recomputed from config, so it's deterministic. */
import { broadcastOf, eui64, in6, inNet, ip2n, lenToMaskN, macOf, mask6, n2ip, n2ip6, net6, netOf, wildMatch, ip6n } from './addr.js';
import { hostPort, isBridge, isHost, isSwitchKind } from './device.js';
import { evaluate } from './acl.js';

export const AD = { connected: 0, static: 1, ospf: 110 };

export function peerOf(lab, dev, port) {
  const key = `${dev}|${port}`;
  return lab.cableMap.get(key) || null;
}

/* ---------- ports ---------- */
const parentName = (name) => name.split('.')[0];

/* A secured port shuts itself if the wrong machine, or too many machines, appear behind it. */
function macsBehind(lab, dev, port) {
  const macs = [];
  const seen = new Set([dev]);
  const stack = [peerOf(lab, dev, port)].filter(Boolean);
  while (stack.length) {
    const at = stack.pop();
    if (seen.has(at.dev)) continue;
    seen.add(at.dev);
    const d = lab.devices.get(at.dev);
    if (isHost(d)) macs.push(macOf(d.name, hostPort(d)));
    else if (d.kind === 'switch') for (const p of d.ifaces.keys()) { const next = peerOf(lab, d.name, p); if (next) stack.push(next); }
    else macs.push(macOf(d.name, at.port));
  }
  return macs;
}
function securityViolated(lab, dev, iface) {
  const ps = iface.portsec;
  if (!ps || !ps.on || iface.swMode !== 'access') return false;
  const macs = macsBehind(lab, dev.name, iface.name);
  if (macs.length > ps.max) return true;
  if (ps.macs.length && !ps.sticky) return macs.some((m) => !ps.macs.includes(m));
  return false;
}

export function computePorts(net) {
  const { lab } = net;
  net.errDisabled = new Set();
  for (const dev of lab.devices.values()) {
    if (!isSwitchKind(dev)) continue;
    for (const iface of dev.ifaces.values()) {
      if (iface.routed || iface.shut || !peerOf(lab, dev.name, iface.name)) continue;
      const peer = lab.devices.get(peerOf(lab, dev.name, iface.name).dev);
      if (securityViolated(lab, dev, iface) || (iface.bpduguard && isBridge(peer))) net.errDisabled.add(`${dev.name}|${iface.name}`);
    }
  }
}

function physicalUp(net, dev, name) {
  const iface = dev.ifaces.get(name);
  if (!iface || iface.shut || net.errDisabled.has(`${dev.name}|${name}`)) return false;
  if (isHost(dev) && dev.linkDown) return false;
  const peer = peerOf(net.lab, dev.name, name);
  if (!peer) return false;
  const far = net.lab.devices.get(peer.dev);
  const farIface = far.ifaces.get(peer.port);
  if (!farIface || farIface.shut || net.errDisabled.has(`${peer.dev}|${peer.port}`)) return false;
  return !(isHost(far) && far.linkDown);
}

export function ifaceUp(net, dev, name) {
  const iface = dev.ifaces.get(name);
  if (!iface || iface.shut) return false;
  if (name.startsWith('Lo') || name.startsWith('Do')) return true;
  if (name.startsWith('Tu')) return net.tunnelsUp.has(`${dev.name}|${name}`);
  if (name.startsWith('Vl')) {
    const vlan = +name.slice(2);
    if (!dev.vlans.has(vlan)) return false;
    return [...dev.ifaces.values()].some((p) => p.name.startsWith('Gi') && !p.routed && physicalUp(net, dev, p.name) && (p.swMode === 'trunk' ? trunkAllows(p, vlan) : p.accessVlan === vlan));
  }
  return physicalUp(net, dev, parentName(name)) && !dev.ifaces.get(parentName(name)).shut;
}
const trunkAllows = (p, vlan) => p.allowed === null || p.allowed.has(vlan);

/* ---------- spanning tree: one tree for all VLANs, chosen by priority then MAC ---------- */
export function computeStp(net) {
  const { lab } = net;
  const switches = [...lab.devices.values()].filter(isBridge);
  const id = (d) => [d.stp.priority, macOf(d.name)];
  const lower = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
  net.blocked = new Set();
  net.stpRoot = null;
  if (!switches.length) return;
  const edges = new Map(switches.map((d) => [d.name, []]));
  for (const d of switches) {
    for (const p of d.ifaces.values()) {
      if (p.routed || !p.name.startsWith('Gi') || !physicalUp(net, d, p.name)) continue;
      const peer = peerOf(lab, d.name, p.name);
      const far = lab.devices.get(peer.dev);
      const farPort = far.ifaces.get(peer.port);
      if (isBridge(far) && !farPort.routed) edges.get(d.name).push({ port: p.name, to: far.name, toPort: peer.port });
    }
  }
  // Each connected group of switches elects its own root.
  const groupOf = new Map();
  for (const start of switches) {
    if (groupOf.has(start.name)) continue;
    const group = [];
    const stack = [start.name];
    while (stack.length) {
      const name = stack.pop();
      if (groupOf.has(name)) continue;
      groupOf.set(name, group);
      group.push(name);
      for (const e of edges.get(name)) stack.push(e.to);
    }
    const root = group.map((n) => lab.devices.get(n)).sort((a, b) => lower(id(a), id(b)))[0];
    if (group.length > 1 || !net.stpRoot) net.stpRoot = net.stpRoot && net.stpRoot.size > group.length ? net.stpRoot : { name: root.name, size: group.length };
    const cost = new Map([[root.name, 0]]);
    const via = new Map();
    const queue = [root.name];
    while (queue.length) {
      queue.sort((a, b) => cost.get(a) - cost.get(b) || lower(id(lab.devices.get(a)), id(lab.devices.get(b))));
      const here = queue.shift();
      for (const e of edges.get(here)) {
        const c = cost.get(here) + 4;
        const best = cost.get(e.to);
        const better = best === undefined || c < best
          || (c === best && lower(id(lab.devices.get(here)), id(lab.devices.get(via.get(e.to).from))) < 0)
          || (c === best && here === via.get(e.to).from && e.port < via.get(e.to).farPort);
        if (better) {
          if (best === undefined) queue.push(e.to);
          cost.set(e.to, c);
          via.set(e.to, { from: here, port: e.toPort, farPort: e.port });
        }
      }
    }
    // A port stays forwarding if it's on the tree: the root port on this side or the other.
    for (const name of group) {
      for (const e of edges.get(name)) {
        const mine = via.get(name);
        const theirs = via.get(e.to);
        const onTree = (mine && mine.port === e.port) || (theirs && theirs.from === name && theirs.farPort === e.port);
        if (onTree) continue;
        // Off the tree: the end further from the root, or the higher bridge ID, is the one that blocks.
        const worse = cost.get(name) - cost.get(e.to) || lower(id(lab.devices.get(name)), id(lab.devices.get(e.to)));
        if (worse > 0) net.blocked.add(`${name}|${e.port}`);
      }
    }
  }
}

/* ---------- layer 2: who hears a frame sent out of this interface ---------- */
function tagFor(iface) {
  if (iface.dot1q === null) return null;
  return iface.nativeTag ? null : iface.dot1q;
}

export function domainOf(net, dev, ifName) {
  const key = `${dev.name}|${ifName}`;
  if (net.domains.has(key)) return net.domains.get(key);
  const result = { endpoints: [], notes: [], path: new Map(), flood: [] };
  const iface = dev.ifaces.get(ifName);
  const seen = new Set();
  const frames = []; // {dev, port, tag|vlan, from}
  const note = (t) => { if (!result.notes.includes(t)) result.notes.push(t); };
  const leave = (d, portName, tag, from) => {
    if (net.blocked.has(`${d.name}|${portName}`)) return;
    if (!physicalUp(net, d, portName)) {
      const p = d.ifaces.get(portName);
      if (net.errDisabled.has(`${d.name}|${portName}`)) note(`${d.name} ${portName} is err-disabled by port security`);
      else if (p.shut) note(`${d.name} ${portName} is shut down`);
      else if (peerOf(net.lab, d.name, portName)) note(`The far end of ${d.name} ${portName} is shut down`);
      return;
    }
    const peer = peerOf(net.lab, d.name, portName);
    frames.push({ dev: peer.dev, port: peer.port, tag, from: { dev: d.name, port: portName, prev: from } });
  };
  const enterFabric = (sw, vlan, skipPort, from) => {
    if (!sw.vlans.has(vlan)) {
      note(`VLAN ${vlan} doesn't exist on ${sw.name}`);
      return;
    }
    const stamp = `${sw.name}|v${vlan}`;
    if (seen.has(stamp)) return;
    seen.add(stamp);
    result.flood.push({ dev: sw.name, vlan, inPort: skipPort });
    const here = { dev: sw.name, port: skipPort, vlan, prev: from };
    const svi = sw.ifaces.get(`Vl${vlan}`);
    if (svi && !(sw === dev && ifName === `Vl${vlan}`) && ifaceUp(net, sw, svi.name)) result.endpoints.push({ dev: sw, iface: svi, trail: here });
    for (const p of sw.ifaces.values()) {
      if (!/^(Gi|Ws)/.test(p.name) || p.routed || p.name === skipPort) continue;
      // Client isolation: two clients on one access point can't hear each other.
      if (p.isolated && skipPort?.startsWith('Ws')) continue;
      if (p.swMode === 'trunk') {
        if (!trunkAllows(p, vlan)) { if (peerOf(net.lab, sw.name, p.name)) note(`VLAN ${vlan} isn't allowed on the trunk ${sw.name} ${p.name}`); continue; }
        leave(sw, p.name, vlan === p.native ? null : vlan, here);
      } else if (p.accessVlan === vlan) {
        leave(sw, p.name, null, here);
      }
    }
  };
  // Where the frame starts.
  if (ifName.startsWith('Vl') && isSwitchKind(dev)) {
    enterFabric(dev, +ifName.slice(2), null, null);
  } else if (/^(Gi|eth|wlan)/.test(ifName)) {
    const base = dev.ifaces.get(parentName(ifName));
    if (base) leave(dev, base.name, tagFor(iface), null);
  }
  let guard = 0;
  while (frames.length && guard++ < 2000) {
    const f = frames.shift();
    const d = net.lab.devices.get(f.dev);
    const p = d.ifaces.get(f.port);
    if (!p) continue;
    if (isSwitchKind(d) && !p.routed) {
      if (net.blocked.has(`${d.name}|${p.name}`)) continue;
      let vlan;
      if (p.swMode === 'trunk') {
        vlan = f.tag === null ? p.native : f.tag;
        if (!trunkAllows(p, vlan)) { note(`VLAN ${vlan} isn't allowed on the trunk ${d.name} ${p.name}`); continue; }
      } else {
        if (f.tag !== null) { note(`${d.name} ${p.name} is an access port, so it drops frames tagged for VLAN ${f.tag}`); continue; }
        vlan = p.accessVlan;
      }
      enterFabric(d, vlan, p.name, f.from);
      continue;
    }
    // Something with an address: find which of its interfaces this frame is for.
    const stamp = `${d.name}|${p.name}|${f.tag}`;
    if (seen.has(stamp)) continue;
    seen.add(stamp);
    if (f.tag === null) {
      const native = [...d.ifaces.values()].find((x) => x.name.startsWith(`${p.name}.`) && x.nativeTag);
      const target = native || p;
      if (!target.shut) result.endpoints.push({ dev: d, iface: target, trail: f.from });
    } else {
      const sub = [...d.ifaces.values()].find((x) => x.name.startsWith(`${p.name}.`) && x.dot1q === f.tag && !x.nativeTag);
      if (sub && !sub.shut) result.endpoints.push({ dev: d, iface: sub, trail: f.from });
      else note(`${d.name} ${p.name} has no sub-interface for VLAN ${f.tag}`);
    }
  }
  net.domains.set(key, result);
  return result;
}

/* The ordered list of devices a frame crossed, for traces and animation. */
export function trailDevices(trail) {
  const out = [];
  for (let t = trail; t; t = t.prev) out.unshift({ dev: t.dev, port: t.port, vlan: t.vlan ?? null });
  return out;
}

export const ifacesWithIp = (dev) => [...dev.ifaces.values()].filter((i) => i.ip);
export const hasAddr = (iface, ip) => iface.ip === ip || iface.ip6.some((a) => a.addr === ip);
export const ownsIp = (dev, ip) => [...dev.ifaces.values()].some((i) => !i.shut && hasAddr(i, ip));

/* ---------- routing tables ---------- */
function connectedRoutes(net, dev) {
  const out = [];
  for (const i of dev.ifaces.values()) {
    if (i.ip && ifaceUp(net, dev, i.name)) {
      out.push({ net: netOf(i.ip, i.len), len: i.len, type: 'C', ad: 0, iface: i.name, via: null, metric: 0 });
    }
  }
  return out;
}

function staticRoutes(dev, connected) {
  const out = [];
  for (const r of dev.routes) {
    const exit = r.via ? connected.filter((c) => inNet(r.via, c.net, c.len)).sort((a, b) => b.len - a.len)[0] : connected.find((c) => c.iface === r.iface);
    if (exit) out.push({ net: r.net, len: r.len, type: r.len === 0 ? 'S*' : 'S', ad: r.ad ?? 1, iface: exit.iface, via: r.via, metric: 0 });
    else if (r.via) out.push({ net: r.net, len: r.len, type: r.len === 0 ? 'S*' : 'S', ad: r.ad ?? 1, iface: null, via: r.via, metric: 0, recursive: true });
  }
  return out;
}

function ospfRouterId(dev) {
  if (dev.ospf.rid) return dev.ospf.rid;
  const loops = ifacesWithIp(dev).filter((i) => i.name.startsWith('Lo'));
  const pool = loops.length ? loops : ifacesWithIp(dev);
  return pool.length ? n2ip(Math.max(...pool.map((i) => ip2n(i.ip)))) : '0.0.0.0';
}

function ospfIfaces(net, dev) {
  if (!dev.ospf) return [];
  const out = [];
  for (const i of dev.ifaces.values()) {
    if (!i.ip || !ifaceUp(net, dev, i.name)) continue;
    const st = dev.ospf.networks.find((n) => wildMatch(i.ip, n.ip, n.wild));
    if (st) out.push({ iface: i, area: st.area, passive: dev.ospf.passive.has(i.name) || i.name.startsWith('Lo'), cost: i.ospfCost ?? 1 });
  }
  return out;
}

export function computeOspf(net) {
  const { lab } = net;
  net.ospfNeighbors = new Map();
  net.ospfWhy = new Map();
  const routers = [...lab.devices.values()].filter((d) => d.ospf && d.kind !== 'firewall' && (d.kind !== 'l3switch' || d.ipRouting));
  const info = new Map(routers.map((d) => [d.name, { rid: ospfRouterId(d), ifs: ospfIfaces(net, d) }]));
  const edges = new Map(routers.map((d) => [d.name, []]));
  for (const d of routers) {
    const mine = info.get(d.name);
    const neighbors = [];
    for (const oi of mine.ifs) {
      if (oi.passive) continue;
      const heard = oi.iface.name.startsWith('Tu') ? tunnelPeer(net, d, oi.iface) : domainOf(net, d, oi.iface.name).endpoints;
      for (const ep of heard) {
        if (ep.dev === d || !ep.dev.ospf || !info.has(ep.dev.name)) continue;
        const theirs = info.get(ep.dev.name).ifs.find((x) => x.iface === ep.iface);
        const key = `${d.name}|${oi.iface.name}`;
        const why = (t) => net.ospfWhy.set(key, t);
        if (!theirs) { why(`${ep.dev.name} ${ep.iface.name} isn't in OSPF, or its network line doesn't match`); continue; }
        if (theirs.passive) { why(`${ep.dev.name} ${ep.iface.name} is passive`); continue; }
        if (oi.iface.len !== ep.iface.len || netOf(oi.iface.ip, oi.iface.len) !== netOf(ep.iface.ip, ep.iface.len)) { why(`The subnet masks on ${d.name} ${oi.iface.name} and ${ep.dev.name} ${ep.iface.name} don't match`); continue; }
        if (theirs.area !== oi.area) { why(`${d.name} ${oi.iface.name} is in area ${oi.area}, and ${ep.dev.name} ${ep.iface.name} is in area ${theirs.area}`); continue; }
        if (oi.iface.ospfHello !== ep.iface.ospfHello) { why(`The hello timers on ${d.name} ${oi.iface.name} and ${ep.dev.name} ${ep.iface.name} don't match`); continue; }
        if (info.get(ep.dev.name).rid === mine.rid) { why(`${d.name} and ${ep.dev.name} have the same router ID`); continue; }
        neighbors.push({ rid: info.get(ep.dev.name).rid, dev: ep.dev.name, ip: ep.iface.ip, iface: oi.iface.name, area: oi.area });
        edges.get(d.name).push({ to: ep.dev.name, cost: oi.cost, via: ep.iface.ip, iface: oi.iface.name });
      }
    }
    net.ospfNeighbors.set(d.name, neighbors);
  }
  // Dijkstra from each router, then every network the others advertise.
  const learned = new Map();
  for (const d of routers) {
    const dist = new Map([[d.name, { cost: 0, first: null }]]);
    const open = [d.name];
    const done = new Set();
    while (open.length) {
      open.sort((a, b) => dist.get(a).cost - dist.get(b).cost || (a < b ? -1 : 1));
      const here = open.shift();
      if (done.has(here)) continue;
      done.add(here);
      for (const e of edges.get(here)) {
        const cost = dist.get(here).cost + e.cost;
        const known = dist.get(e.to);
        if (!known || cost < known.cost) {
          dist.set(e.to, { cost, first: here === d.name ? e : dist.get(here).first });
          open.push(e.to);
        }
      }
    }
    const routes = [];
    const myAreas = new Set(info.get(d.name).ifs.map((x) => x.area));
    for (const [name, where] of dist) {
      if (name === d.name) continue;
      for (const oi of info.get(name).ifs) {
        routes.push({ net: netOf(oi.iface.ip, oi.iface.len), len: oi.iface.len, type: myAreas.has(oi.area) ? 'O' : 'O IA', ad: 110, iface: where.first.iface, via: where.first.via, metric: where.cost + oi.cost });
      }
      const other = lab.devices.get(name);
      if (other.ospf.defaultOriginate && other.routes.some((r) => r.len === 0)) {
        routes.push({ net: 0, len: 0, type: 'O*E2', ad: 110, iface: where.first.iface, via: where.first.via, metric: 1 });
      }
    }
    learned.set(d.name, routes);
  }
  net.ospfRoutes = learned;
}

function tunnelPeer(net, dev, tun) {
  const peerDev = tunnelFar(net, dev, tun);
  if (!peerDev) return [];
  return [peerDev];
}

export function tunnelFar(net, dev, tun) {
  const src = resolveTunnelSource(dev, tun);
  if (!src || !tun.tunnelDst) return null;
  for (const d of net.lab.devices.values()) {
    for (const i of d.ifaces.values()) {
      if (!i.name.startsWith('Tu') || !i.ip || i.shut) continue;
      const farSrc = resolveTunnelSource(d, i);
      if (farSrc === tun.tunnelDst && i.tunnelDst === src) return { dev: d, iface: i };
    }
  }
  return null;
}
export function resolveTunnelSource(dev, tun) {
  if (!tun.tunnelSrc) return null;
  if (tun.tunnelSrc.includes('.') && !tun.tunnelSrc.startsWith('Gi')) return tun.tunnelSrc;
  return dev.ifaces.get(tun.tunnelSrc)?.ip ?? null;
}

function rib(net, dev) {
  const connected = connectedRoutes(net, dev);
  const statics = staticRoutes(dev, connected);
  const ospf = net.ospfRoutes.get(dev.name) || [];
  const all = [...connected, ...statics, ...ospf];
  // A route through an address only counts if something else says how to reach that address.
  const resolved = all.map((r) => {
    if (!r.recursive) return r;
    // Never through a default route: otherwise a route over a dead link would quietly "resolve" through the backup.
    const hop = [...connected, ...ospf, ...statics.filter((s) => !s.recursive)].filter((c) => c.len > 0 && inNet(r.via, c.net, c.len)).sort((a, b) => b.len - a.len)[0];
    return hop ? { ...r, iface: hop.iface, recursive: false, nextVia: hop.via } : null;
  }).filter(Boolean);
  const best = new Map();
  for (const r of resolved) {
    const key = `${r.net}/${r.len}`;
    const have = best.get(key);
    if (!have || r.ad < have.ad || (r.ad === have.ad && r.metric < have.metric)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => b.len - a.len || a.net - b.net);
}

export function lookup(net, dev, ip) {
  const n = ip2n(ip);
  for (const r of net.tables.get(dev.name) || []) {
    if ((r.len === 0 ? 0 : Math.floor(n / 2 ** (32 - r.len)) * 2 ** (32 - r.len)) === r.net) return r;
  }
  return null;
}

/* Hosts have a simple table: their subnet, plus the gateway. */
function hostTable(net, dev) {
  const port = hostPort(dev);
  const iface = dev.ifaces.get(port);
  const table = [];
  if (iface.ip && ifaceUp(net, dev, port)) {
    table.push({ net: netOf(iface.ip, iface.len), len: iface.len, type: 'C', ad: 0, iface: port, via: null, metric: 0 });
    for (const r of dev.extraRoutes) if (inNet(r.via, iface.ip, iface.len)) table.push({ net: r.net, len: r.len, type: 'S', ad: 1, iface: port, via: r.via, metric: 0 });
    if (dev.gateway && inNet(dev.gateway, iface.ip, iface.len)) table.push({ net: 0, len: 0, type: 'S*', ad: 1, iface: port, via: dev.gateway, metric: 0 });
  }
  return table.sort((a, b) => b.len - a.len);
}

function computeTables(net) {
  computeOspf(net);
  for (const dev of net.lab.devices.values()) {
    if (isHost(dev)) continue;
    if (dev.kind === 'switch' || (dev.kind === 'l3switch' && !dev.ipRouting)) {
      // A plain switch only has a management address and a default gateway.
      const table = connectedRoutes(net, dev);
      if (dev.defaultGw && table.some((c) => inNet(dev.defaultGw, c.net, c.len))) {
        table.push({ net: 0, len: 0, type: 'S*', ad: 1, iface: table.find((c) => inNet(dev.defaultGw, c.net, c.len)).iface, via: dev.defaultGw, metric: 0 });
      }
      net.tables.set(dev.name, table.sort((a, b) => b.len - a.len));
      continue;
    }
    net.tables.set(dev.name, rib(net, dev));
  }
  for (const dev of net.lab.devices.values()) if (isHost(dev)) net.tables.set(dev.name, hostTable(net, dev));
}

export function computeRouting(net) {
  net.tunnelsUp = new Set();
  net.domains = new Map();
  computeTables(net);
  // A tunnel comes up once its far end can be routed to, and running over it can teach new routes.
  for (let pass = 0; pass < 3; pass++) {
    const up = new Set();
    for (const dev of net.lab.devices.values()) {
      for (const i of dev.ifaces.values()) {
        if (!i.name.startsWith('Tu') || i.shut || !i.tunnelDst || !resolveTunnelSource(dev, i)) continue;
        const route = lookup(net, dev, i.tunnelDst);
        if (route && route.iface !== i.name) up.add(`${dev.name}|${i.name}`);
      }
    }
    const same = up.size === net.tunnelsUp.size && [...up].every((x) => net.tunnelsUp.has(x));
    net.tunnelsUp = up;
    if (same) break;
    net.domains = new Map();
    computeTables(net);
  }
}

/* ---------- DHCP: first free address in the pool, handed out in device-name order ---------- */
function poolFor(dev, ip) {
  return [...dev.dhcp.pools.values()].find((p) => p.net !== null && inNet(ip, p.net, p.len));
}
function allocate(net, server, pool, host) {
  const used = net.leases.get(server.name) || new Map();
  net.leases.set(server.name, used);
  for (const [addr, name] of used) if (name === host.name) return addr;
  const first = pool.net + 1;
  const last = broadcastOf(n2ip(pool.net), pool.len) - 1;
  const excluded = (n) => server.dhcp.excluded.some(([a, b]) => n >= ip2n(a) && n <= ip2n(b));
  const taken = (n) => [...net.lab.devices.values()].some((d) => [...d.ifaces.values()].some((i) => i.ip && ip2n(i.ip) === n));
  for (let n = first; n <= last; n++) {
    const addr = n2ip(n);
    if (!excluded(n) && !taken(n) && !used.has(addr)) {
      used.set(addr, host.name);
      return addr;
    }
  }
  return null;
}
export function computeDhcp(net, relayReachable) {
  net.leases = new Map();
  net.dhcpWhy = new Map();
  const hosts = [...net.lab.devices.values()].filter((d) => isHost(d) && d.dhcpOn).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const host of hosts) {
    host.ifaces.get(hostPort(host)).ip = null;
    host.ifaces.get(hostPort(host)).len = null;
    host.gateway = null;
    host.dhcpDns = null;
  }
  net.domains = new Map();
  for (const host of hosts) {
    const heard = domainOf(net, host, hostPort(host));
    let got = null;
    for (const ep of heard.endpoints) {
      if (!ep.iface.ip || isHost(ep.dev)) continue;
      const here = poolFor(ep.dev, ep.iface.ip);
      if (here && ifaceUp(net, ep.dev, ep.iface.name)) { got = { server: ep.dev, pool: here }; break; }
      for (const helper of ep.iface.helper) {
        const server = [...net.lab.devices.values()].find((d) => d.ifaces && [...d.ifaces.values()].some((i) => i.ip === helper));
        if (server && poolFor(server, ep.iface.ip) && relayReachable(ep.dev, ep.iface, helper)) { got = { server, pool: poolFor(server, ep.iface.ip) }; break; }
        if (server && !poolFor(server, ep.iface.ip)) net.dhcpWhy.set(host.name, `${server.name} has no DHCP pool for ${ep.iface.ip}'s subnet`);
      }
      if (got) break;
    }
    if (!got) {
      if (!net.dhcpWhy.has(host.name)) net.dhcpWhy.set(host.name, heard.notes[0] || 'No DHCP server or relay answered on this network');
      continue;
    }
    const addr = allocate(net, got.server, got.pool, host);
    if (!addr) { net.dhcpWhy.set(host.name, `The ${got.pool.name} pool on ${got.server.name} has no free addresses`); continue; }
    const iface = host.ifaces.get(hostPort(host));
    iface.ip = addr;
    iface.len = got.pool.len;
    host.gateway = got.pool.gw;
    host.dhcpDns = got.pool.dns;
  }
}

/* ---------- IPsec: is the tunnel up, and if not, which phase failed ---------- */
function policiesMatch(a, b) {
  for (const x of a.crypto.policies.values()) {
    for (const y of b.crypto.policies.values()) {
      if (x.encryption === y.encryption && x.hash === y.hash && x.group === y.group && x.auth === y.auth) return true;
    }
  }
  return false;
}
const firstPermit = (dev, name) => dev.acls.get(name)?.entries.find((e) => e.action === 'permit') || null;
const mirrored = (a, b) => !!a && !!b && a.src.ip === b.dst.ip && a.src.wild === b.dst.wild && a.dst.ip === b.src.ip && a.dst.wild === b.src.wild;

export function cryptoEntries(dev) {
  const out = [];
  for (const iface of dev.ifaces.values()) {
    if (!iface.cryptoMap || !iface.ip) continue;
    const map = dev.crypto.maps.get(iface.cryptoMap);
    if (map) for (const entry of map.values()) out.push({ iface, entry });
  }
  return out;
}

export function computeIpsec(net, underlayReachable) {
  net.ipsec = new Map();
  for (const dev of net.lab.devices.values()) {
    for (const { iface, entry } of cryptoEntries(dev)) {
      const key = `${dev.name}|${entry.peer}`;
      const state = { dev: dev.name, peer: entry.peer, up: false, why: '', local: iface.ip };
      net.ipsec.set(key, state);
      if (!entry.peer) { state.why = 'The crypto map has no set peer'; continue; }
      const far = [...net.lab.devices.values()].find((d) => cryptoEntries(d).some((c) => c.iface.ip === entry.peer));
      if (!far) { state.why = `Nothing at ${entry.peer} is running this VPN`; continue; }
      const back = cryptoEntries(far).find((c) => c.entry.peer === iface.ip);
      if (!back) { state.why = `${far.name} doesn't list ${iface.ip} as its peer`; continue; }
      if (!underlayReachable(dev, iface.ip, entry.peer)) { state.why = `${dev.name} can't reach ${entry.peer} on UDP 500`; continue; }
      if (!policiesMatch(dev, far)) { state.why = 'Phase 1 failed: the ISAKMP policies have no match'; continue; }
      const key1 = dev.crypto.keys.get(entry.peer);
      const key2 = far.crypto.keys.get(iface.ip);
      if (!key1 || key1 !== key2) { state.why = 'Phase 1 failed: the pre-shared keys differ'; continue; }
      const t1 = dev.crypto.tsets.get(entry.tset);
      const t2 = far.crypto.tsets.get(back.entry.tset);
      if (!t1 || !t2 || t1 !== t2) { state.why = 'Phase 2 failed: the transform sets differ'; continue; }
      if (!mirrored(firstPermit(dev, entry.acl), firstPermit(far, back.entry.acl))) { state.why = "Phase 2 failed: the two sides' crypto ACLs aren't mirror images"; continue; }
      state.up = true;
    }
  }
}

export function cryptoFor(net, dev, outIface, pkt) {
  if (!outIface.cryptoMap) return null;
  const map = dev.crypto.maps.get(outIface.cryptoMap);
  if (!map) return null;
  for (const entry of map.values()) {
    const acl = dev.acls.get(entry.acl);
    if (acl && evaluate(acl, pkt, false).permit) return { entry, state: net.ipsec.get(`${dev.name}|${entry.peer}`) };
  }
  return null;
}

/* ---------- Wi-Fi: who can hear whom, and who is let on ---------- */
export const RADIO_RANGE = 45; // in the map's percentage units, so it's the same at any zoom
const NEIGHBOUR_RANGE = 70;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const accessPoints = (lab) => [...lab.devices.values()].filter((d) => d.kind === 'ap');
const liveRadios = (ap) => ['Do0', 'Do1'].map((n) => ap.ifaces.get(n)).filter((r) => r && !r.shut && r.channel !== null);

/** What a laptop can see from where it stands, strongest first. */
export function scan(lab, host) {
  const found = [];
  for (const ap of accessPoints(lab)) {
    const d = distance(ap, host);
    if (d > RADIO_RANGE) continue;
    for (const radio of liveRadios(ap)) {
      for (const name of radio.ssids) {
        const ssid = ap.ssidTable.get(name);
        if (ssid) found.push({ ap, radio, ssid, signal: Math.round(-35 - d) });
      }
    }
  }
  return found.sort((a, b) => b.signal - a.signal);
}

function joinAir(net, host, offer, why) {
  const { lab } = net;
  const name = `Ws${net.air.next++}`;
  const port = { ...newWirelessPort(offer.ap, name), accessVlan: offer.ssid.vlan, isolated: offer.ssid.isolation };
  offer.ap.ifaces.set(name, port);
  lab.cableMap.set(`${host.name}|${hostPort(host)}`, { dev: offer.ap.name, port: name, wifi: true });
  lab.cableMap.set(`${offer.ap.name}|${name}`, { dev: host.name, port: hostPort(host), wifi: true });
  net.air.assoc.set(host.name, { ap: offer.ap.name, ssid: offer.ssid.name, channel: offer.radio.channel, signal: offer.signal, port: name });
  net.air.why.delete(host.name);
  void why;
}
function newWirelessPort(ap, name) {
  // Only the fields switching reads. It's rebuilt each time, and never printed in a config.
  return { name, desc: '', shut: false, ip: null, len: null, ip6: [], mac: macOf(ap.name, name), routed: false, swMode: 'access', accessVlan: 1, allowed: null, native: 1, portsec: null, portfast: false, bpduguard: false, dot1q: null, nativeTag: false, helper: [], wifi: true, isolated: false };
}
export function clearAir(lab) {
  for (const key of [...lab.cableMap.keys()]) if (lab.cableMap.get(key).wifi) lab.cableMap.delete(key);
  for (const ap of accessPoints(lab)) for (const name of [...ap.ifaces.keys()]) if (name.startsWith('Ws')) ap.ifaces.delete(name);
}
export function computeWifi(net) {
  const { lab } = net;
  clearAir(lab);
  net.air = { assoc: new Map(), why: new Map(), next: 1, overlaps: [] };
  for (const host of [...lab.devices.values()].filter((d) => d.kind === 'laptop' && d.wifi)) {
    const offers = scan(lab, host).filter((o) => o.ssid.name === host.wifi.ssid);
    if (!offers.length) {
      net.air.why.set(host.name, `Nothing in range of ${host.name} is offering ${host.wifi.ssid}`);
      continue;
    }
    let joined = false;
    for (const offer of offers) {
      const { auth, key } = offer.ssid;
      if ((auth === 'wpa2' || auth === 'wpa3') && host.wifi.key !== key) {
        net.air.why.set(host.name, `${offer.ap.name} refused ${host.name}: wrong password for ${host.wifi.ssid}`);
        continue;
      }
      if (auth === 'enterprise' && !host.wifi.user) {
        net.air.why.set(host.name, `${host.wifi.ssid} wants a username and password: wifi connect ${host.wifi.ssid} <user> <password>`);
        continue;
      }
      joinAir(net, host, offer);
      joined = true;
      break;
    }
    if (!joined && !net.air.why.has(host.name)) net.air.why.set(host.name, `${host.name} couldn't join ${host.wifi.ssid}`);
  }
  // Neighbouring access points on overlapping channels talk over each other.
  const aps = accessPoints(lab);
  for (let i = 0; i < aps.length; i++) {
    for (let j = i + 1; j < aps.length; j++) {
      if (distance(aps[i], aps[j]) > NEIGHBOUR_RANGE) continue;
      const [a, b] = [aps[i].ifaces.get('Do0'), aps[j].ifaces.get('Do0')];
      if (a && b && !a.shut && !b.shut && a.channel !== null && b.channel !== null && Math.abs(a.channel - b.channel) < 5) {
        net.air.overlaps.push({ a: aps[i].name, b: aps[j].name, channels: [a.channel, b.channel] });
      }
      const [c, d] = [aps[i].ifaces.get('Do1'), aps[j].ifaces.get('Do1')];
      if (c && d && !c.shut && !d.shut && c.channel !== null && c.channel === d.channel) net.air.overlaps.push({ a: aps[i].name, b: aps[j].name, channels: [c.channel, d.channel] });
    }
  }
}
/* An access point learns who may join by asking RADIUS over the network, so routing has to be up first. */
export function verifyEnterprise(net, reachable) {
  let changed = false;
  for (const [hostName, assoc] of [...net.air.assoc]) {
    const host = net.lab.devices.get(hostName);
    const ap = net.lab.devices.get(assoc.ap);
    if (ap.ssidTable.get(assoc.ssid)?.auth !== 'enterprise') continue;
    let why = '';
    const server = ap.radius && [...net.lab.devices.values()].find((d) => isHost(d) && ownsIp(d, ap.radius.host));
    if (!ap.radius) why = `${ap.name} has no radius-server set`;
    else if (!server || !server.services.has('radius')) why = `Nothing at ${ap.radius.host} is running RADIUS`;
    else {
      const svi = [...ap.ifaces.values()].find((i) => i.ip);
      if (!svi) why = `${ap.name} has no management address, so it can't talk to RADIUS`;
      else if (server.radiusClients.get(svi.ip) !== ap.radius.key) why = `The RADIUS server doesn't trust ${ap.name}: the shared key or address doesn't match`;
      else if (!reachable(ap, svi.ip, ap.radius.host)) why = `${ap.name} can't reach RADIUS at ${ap.radius.host}`;
      else if (server.radiusUsers.get(host.wifi.user) !== host.wifi.pass) why = `RADIUS refused ${host.wifi.user}: wrong username or password`;
    }
    if (why) {
      ap.ifaces.delete(assoc.port);
      net.lab.cableMap.delete(`${hostName}|${hostPort(host)}`);
      net.lab.cableMap.delete(`${assoc.ap}|${assoc.port}`);
      net.air.assoc.delete(hostName);
      net.air.why.set(hostName, why);
      changed = true;
    }
  }
  return changed;
}

/* ---------- IPv6: SLAAC, and a table of its own ---------- */
export function computeSlaac(net) {
  net.slaacWhy = new Map();
  for (const host of [...net.lab.devices.values()].filter(isHost)) {
    const iface = host.ifaces.get(hostPort(host));
    iface.ip6 = iface.ip6.filter((a) => !a.auto);
    if (!host.slaac) continue;
    if (host.gatewayAuto) host.gateway6 = null;
    if (!ifaceUp(net, host, hostPort(host))) { net.slaacWhy.set(host.name, `${host.name}'s link is down`); continue; }
    const router = domainOf(net, host, hostPort(host)).endpoints.find((ep) => !isHost(ep.dev) && ep.dev.v6Routing && ep.iface.ip6.some((a) => a.len === 64));
    if (!router) { net.slaacWhy.set(host.name, 'No router sent an advertisement. It needs an IPv6 /64 and ipv6 unicast-routing'); continue; }
    const prefix = router.iface.ip6.find((a) => a.len === 64);
    iface.ip6.push({ addr: eui64(prefix.addr, iface.mac), len: 64, auto: true });
    host.gateway6 = prefix.addr;
    host.gatewayAuto = true;
  }
}
export function computeTables6(net) {
  net.tables6 = new Map();
  for (const dev of net.lab.devices.values()) {
    const table = [];
    for (const i of dev.ifaces.values()) {
      if (i.ip6?.length && ifaceUp(net, dev, i.name)) for (const a of i.ip6) table.push({ prefix: n2ip6(net6(a.addr, a.len)), len: a.len, type: 'C', iface: i.name, via: null });
    }
    const connected = [...table];
    const findExit = (hop) => connected.find((c) => in6(hop, c.prefix, c.len));
    if (isHost(dev)) {
      if (dev.gateway6 && findExit(dev.gateway6)) table.push({ prefix: '::', len: 0, type: 'S', iface: findExit(dev.gateway6).iface, via: dev.gateway6 });
    } else {
      for (const r of dev.routes6) {
        const exit = findExit(r.via);
        if (exit) table.push({ prefix: r.prefix, len: r.len, type: 'S', iface: exit.iface, via: r.via });
      }
    }
    net.tables6.set(dev.name, table.sort((a, b) => b.len - a.len));
  }
}
export function lookup6(net, dev, ip) {
  return (net.tables6.get(dev.name) || []).find((r) => in6(ip, r.prefix, r.len)) || null;
}

export { lenToMaskN, ip6n, mask6 };
