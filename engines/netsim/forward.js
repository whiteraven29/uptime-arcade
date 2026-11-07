/* A packet's journey, hop by hop, with every decision written down. A drop always says why, so a lab can teach. */
import { ip2n, inNet, isIp6, macOf, n2ip, netOf, norm6, wildMatch } from './addr.js';
import { evaluate } from './acl.js';
import { hostPort, isHost, isSwitchKind } from './device.js';
import { computeDhcp, computeIpsec, computePorts, computeRouting, computeSlaac, computeStp, computeTables6, computeWifi, cryptoFor, domainOf, hasAddr, ifaceUp, lookup, lookup6, ownsIp, resolveTunnelSource, trailDevices, verifyEnterprise } from './net.js';

const PORTS = { http: [['tcp', 80]], https: [['tcp', 443]], dns: [['udp', 53], ['tcp', 53]], ssh: [['tcp', 22]], smb: [['tcp', 445]], ntp: [['udp', 123]], mysql: [['tcp', 3306]], smtp: [['tcp', 25]], radius: [['udp', 1812]] };
export const SERVICES = Object.keys(PORTS);
export const servicePorts = (name) => PORTS[name] || [];

export function buildNet(lab) {
  const net = { lab, tables: new Map(), tables6: new Map(), domains: new Map(), tunnelsUp: new Set(), errDisabled: new Set(), blocked: new Set(), ospfRoutes: new Map(), ospfNeighbors: new Map(), ospfWhy: new Map(), leases: new Map(), dhcpWhy: new Map(), ipsec: new Map(), air: { assoc: new Map(), why: new Map(), overlaps: [] }, slaacWhy: new Map() };
  const settle = () => {
    computePorts(net);
    computeStp(net);
    computeRouting(net);
    computeDhcp(net, (dev, iface, helper) => send(lab, net, dev, pktOf(iface.ip, helper, 'udp', 67, 67)).ok);
    computeRouting(net);
    computeSlaac(net);
    computeTables6(net);
  };
  computeWifi(net);
  settle();
  learnAccessPoints(net);
  // Enterprise Wi-Fi asks RADIUS over the network, so it can only be judged once the network is up.
  if (verifyEnterprise(net, (ap, local, server) => send(lab, net, ap, pktOf(local, server, 'udp', 1812, 1812)).ok)) settle();
  computeIpsec(net, (dev, local, peer) => send(lab, net, dev, pktOf(local, peer, 'udp', 500, 500)).ok);
  return net;
}

const pktOf = (src, dst, proto, sport, dport) => ({ src, dst, proto, sport, dport, ttl: 64, ack: false, reply: false });
const v6 = (ip) => ip.includes(':');
const lookupAny = (net, dev, ip) => (v6(ip) ? lookup6(net, dev, ip) : lookup(net, dev, ip));
/* A switch hears an access point's own frames, which is how a rogue one can be traced to a port. */
function learnAccessPoints(net) {
  const { lab } = net;
  for (const ap of lab.devices.values()) {
    if (ap.kind !== 'ap') continue;
    const peer = lab.cableMap.get(`${ap.name}|Gi0/1`);
    const sw = peer && lab.devices.get(peer.dev);
    if (!sw || !isSwitchKind(sw)) continue;
    if (!lab.runtime.macs.has(sw.name)) lab.runtime.macs.set(sw.name, new Map());
    const vlan = sw.ifaces.get(peer.port)?.accessVlan ?? 1;
    lab.runtime.macs.get(sw.name).set(`${vlan}|${macOf(ap.name)}`, { vlan, mac: macOf(ap.name), port: peer.port });
  }
}
/* Every step of the journey, with the packet as it looked right then. It's what stepping through a packet shows. */
const header = (p) => ({ src: p.src, dst: p.dst, proto: p.proto, sport: p.sport, dport: p.dport, ttl: p.ttl, inner: p.inner ? { src: p.inner.src, dst: p.inner.dst, proto: p.inner.proto } : null });
function step(ctx, dev, action, detail, pkt, extra = {}) {
  ctx.hops.push({ dev: dev.name, action, detail, pkt: pkt ? header(pkt) : null, ...extra });
}

function fail(ctx, dev, why, status = 'timeout') {
  ctx.hops.push({ dev: dev.name, action: 'drop', why, detail: why });
  return { ok: false, status, at: dev.name, why };
}

/* ---------- NAT ---------- */
function natTable(lab, dev) {
  if (!lab.runtime.nat.has(dev.name)) lab.runtime.nat.set(dev.name, []);
  return lab.runtime.nat.get(dev.name);
}
function allocPort(lab) {
  lab.runtime.nextPort = lab.runtime.nextPort >= 65000 ? 20000 : lab.runtime.nextPort + 1;
  return lab.runtime.nextPort;
}
function dynamicOut(lab, dev, pkt, globalIp, outsideNote) {
  const table = natTable(lab, dev);
  let row = table.find((t) => t.proto === pkt.proto && t.insideIp === pkt.src && t.insidePort === pkt.sport);
  if (!row) {
    row = { proto: pkt.proto, insideIp: pkt.src, insidePort: pkt.sport, globalIp, globalPort: allocPort(lab), outsideIp: pkt.dst, outsidePort: pkt.dport, note: outsideNote };
    table.push(row);
  }
  return { ...pkt, src: row.globalIp, sport: row.globalPort };
}
function staticMatchesOut(rule, pkt) {
  return rule.kind === 'static' && rule.local === pkt.src && (!rule.proto || (rule.proto === pkt.proto && rule.lport === pkt.sport));
}
function natOut(lab, dev, inIf, outIf, pkt) {
  if (dev.kind === 'firewall') {
    for (const rule of dev.natRules) {
      if (rule.from !== inIf?.nameif || rule.to !== outIf.nameif) continue;
      const obj = dev.objects.get(rule.object);
      if (!obj || !inNet(pkt.src, obj.ip, obj.len)) continue;
      if (rule.kind === 'static') return { ...pkt, src: rule.global };
      return dynamicOut(lab, dev, pkt, outIf.ip);
    }
    return pkt;
  }
  if (outIf.nat !== 'outside' || inIf?.nat !== 'inside') return pkt;
  for (const rule of dev.natRules) if (staticMatchesOut(rule, pkt)) return { ...pkt, src: rule.global, sport: rule.proto ? rule.gport : pkt.sport };
  for (const rule of dev.natRules) {
    if (rule.kind !== 'dynamic') continue;
    const acl = dev.acls.get(rule.acl);
    if (!acl || !evaluate(acl, pkt, false).permit) continue;
    const globalIp = rule.iface ? dev.ifaces.get(rule.iface)?.ip : dev.natPools.get(rule.pool)?.start;
    if (globalIp) return dynamicOut(lab, dev, pkt, globalIp);
  }
  return pkt;
}
function natIn(lab, dev, inIf, pkt) {
  const fromOutside = dev.kind === 'firewall' ? dev.natRules.some((r) => r.to === inIf.nameif) : inIf.nat === 'outside';
  if (!fromOutside) return pkt;
  for (const rule of dev.natRules) {
    if (rule.kind !== 'static') continue;
    if (dev.kind === 'firewall') {
      if (rule.to === inIf.nameif && rule.global === pkt.dst) return { ...pkt, dst: dev.objects.get(rule.object)?.ip ?? pkt.dst };
    } else if (rule.global === pkt.dst && (!rule.proto || (rule.proto === pkt.proto && rule.gport === pkt.dport))) {
      return { ...pkt, dst: rule.local, dport: rule.proto ? rule.lport : pkt.dport };
    }
  }
  const row = natTable(lab, dev).find((t) => t.proto === pkt.proto && t.globalIp === pkt.dst && t.globalPort === pkt.dport);
  return row ? { ...pkt, dst: row.insideIp, dport: row.insidePort } : pkt;
}

/* ---------- the stateful firewall ---------- */
const connKey = (p) => `${p.proto}|${p.src}|${p.sport}|${p.dst}|${p.dport}`;
const backKey = (p) => `${p.proto}|${p.dst}|${p.dport}|${p.src}|${p.sport}`;
function firewallAllows(lab, dev, inIf, outIf, pkt, ctx) {
  if (!outIf.nameif) return fail(ctx, dev, `${dev.name} ${outIf.name} has no nameif, so it passes no traffic`);
  if (!lab.runtime.conns.has(dev.name)) lab.runtime.conns.set(dev.name, new Map());
  const conns = lab.runtime.conns.get(dev.name);
  if (pkt.reply && conns.has(backKey(pkt))) { // the state table lets the answer back in
    step(ctx, dev, 'firewall', 'Matches the state table, so the answer comes back in', pkt);
    return null;
  }
  const group = dev.accessGroups.get(inIf.nameif);
  if (group && dev.acls.has(group)) {
    const verdict = evaluate(dev.acls.get(group), pkt);
    if (!verdict.permit) return fail(ctx, dev, `${dev.name} access list ${group} drops it (${verdict.text})`);
  } else if (inIf.level <= outIf.level) {
    return fail(ctx, dev, `${dev.name}: ${inIf.nameif} (level ${inIf.level}) can't start traffic to ${outIf.nameif} (level ${outIf.level}) without an access list`);
  }
  step(ctx, dev, 'firewall', group && dev.acls.has(group) ? `Access list ${group} permits it, and it goes in the state table` : `${inIf.nameif} is more trusted than ${outIf.nameif}, so it's allowed and goes in the state table`, pkt);
  conns.set(connKey(pkt), { proto: pkt.proto, from: `${inIf.nameif} ${pkt.src}:${pkt.sport}`, to: `${outIf.nameif} ${pkt.dst}:${pkt.dport}` });
  return null;
}

/* A device answers ARP for the public addresses it publishes through NAT, as if they were its own. */
function publishes(dev, iface, ip) {
  return dev.natRules.some((r) => r.kind === 'static' && r.global === ip && (dev.kind === 'firewall' ? r.to === iface.nameif : iface.nat === 'outside'));
}

/* ---------- layer 2 hop ---------- */
function learn(lab, dom, srcMac) {
  for (const f of dom.flood) {
    if (!f.inPort) continue;
    if (!lab.runtime.macs.has(f.dev)) lab.runtime.macs.set(f.dev, new Map());
    lab.runtime.macs.get(f.dev).set(`${f.vlan}|${srcMac}`, { vlan: f.vlan, mac: srcMac, port: f.inPort });
  }
}
function layer2(net, dev, outIf, nextHop, ctx) {
  const dom = domainOf(net, dev, outIf.name);
  learn(net.lab, dom, outIf.mac);
  const ep = dom.endpoints.find((e) => hasAddr(e.iface, nextHop)) || dom.endpoints.find((e) => publishes(e.dev, e.iface, nextHop));
  if (!ep) {
    const why = dom.notes[0] ? `${dom.notes[0]}, so ${nextHop} never answers ${dev.name}'s ARP` : `Nothing on ${dev.name} ${outIf.name}'s network answers ARP for ${nextHop}`;
    return { fail: fail(ctx, dev, why) };
  }
  for (const hop of trailDevices(ep.trail)) {
    const through = net.lab.devices.get(hop.dev);
    if (through && isSwitchKind(through) && hop.dev !== dev.name) ctx.hops.push({ dev: hop.dev, action: 'switch', vlan: hop.vlan, detail: `${through.kind === 'ap' ? 'Bridges' : 'Switches'} it in VLAN ${hop.vlan ?? '?'}`, pkt: null });
  }
  if (!net.lab.runtime.arp.has(dev.name)) net.lab.runtime.arp.set(dev.name, new Map());
  net.lab.runtime.arp.get(dev.name).set(nextHop, { mac: ep.iface.mac, iface: outIf.name });
  // The answer to ARP teaches the switches the way back to this machine too.
  const back = domainOf(net, ep.dev, ep.iface.name);
  learn(net.lab, back, ep.iface.mac);
  return { ep };
}

/* ---------- layer 3 ---------- */
function egress(net, dev, inIf, route, pkt0, ctx) {
  const { lab } = net;
  let pkt = pkt0;
  const family6 = v6(pkt.dst);
  const outIf = dev.ifaces.get(route.iface);
  if (dev.kind === 'firewall' && inIf) {
    const stopped = firewallAllows(lab, dev, inIf, outIf, pkt, ctx);
    if (stopped) return stopped;
  }
  if (inIf) step(ctx, dev, 'forward', `Sends it out ${outIf.name}${route.via ? ` to ${route.nextVia || route.via}` : ', directly connected'}`, pkt);
  if (!family6) {
    const before = pkt;
    pkt = natOut(lab, dev, inIf, outIf, pkt);
    if (pkt.src !== before.src) step(ctx, dev, 'nat', `NAT changes the source from ${before.src} to ${pkt.src}`, pkt);
  }
  if (outIf.name.startsWith('Tu')) {
    const src = resolveTunnelSource(dev, outIf);
    const outer = { ...pktOf(src, outIf.tunnelDst, 'gre', 0, 0), inner: pkt, reply: pkt.reply, ack: pkt.ack };
    const under = lookup(net, dev, outIf.tunnelDst);
    if (!under || under.iface === outIf.name) return fail(ctx, dev, `${dev.name} has no route to the tunnel's far end ${outIf.tunnelDst}`);
    step(ctx, dev, 'encap', `Wraps it in GRE, addressed to ${outIf.tunnelDst}`, outer);
    return egress(net, dev, null, under, outer, ctx);
  }
  if (!pkt.inner && !family6) {
    const crypto = cryptoFor(net, dev, outIf, pkt);
    if (crypto) {
      if (!crypto.state?.up) return fail(ctx, dev, `The VPN from ${dev.name} to ${crypto.entry.peer} is down. ${crypto.state?.why ?? ''}`.trim());
      ctx.encrypted = true;
      pkt = { ...pktOf(outIf.ip, crypto.entry.peer, 'esp', 0, 0), inner: pkt, reply: pkt.reply, ack: pkt.ack };
      step(ctx, dev, 'encrypt', `Encrypts it with ESP, addressed to ${crypto.entry.peer}`, pkt);
    }
  }
  const outList = family6 ? outIf.v6Out : outIf.aclOut;
  if (outList && inIf !== null) {
    const acl = dev.acls.get(outList);
    if (acl) {
      const verdict = evaluate(acl, pkt);
      if (!verdict.permit) return fail(ctx, dev, `${dev.name} ${outIf.name} access list ${outList} going out drops it (${verdict.seq ? `line ${verdict.seq}: ` : ''}${verdict.text})`);
      step(ctx, dev, 'acl', `Access list ${outList} going out permits it (line ${verdict.seq}: ${verdict.text})`, pkt);
    }
  }
  const nextHop = route.nextVia || route.via || pkt.dst;
  const { ep, fail: stopped } = layer2(net, dev, outIf, nextHop, ctx);
  if (stopped) return stopped;
  return arrive(net, ep.dev, ep.iface, pkt, ctx);
}

function arrive(net, dev, inIf, pkt0, ctx) {
  const { lab } = net;
  let pkt = pkt0;
  if (ctx.hops.length > 96) return fail(ctx, dev, 'The packet went round in a loop until it died');
  if (isHost(dev)) {
    if (!ownsIp(dev, pkt.dst)) return fail(ctx, dev, `${dev.name} got a packet for ${pkt.dst} and it isn't that address`);
    step(ctx, dev, 'deliver', `It's for ${dev.name}, so it's delivered`, pkt, { iface: inIf.name });
    return { ok: true, dev, iface: inIf, pkt };
  }
  step(ctx, dev, 'route', `Arrives on ${inIf.name}`, pkt, { iface: inIf.name, ip: inIf.ip || inIf.ip6?.[0]?.addr });
  const family6 = v6(pkt.dst);
  if (dev.kind === 'firewall' && family6) return fail(ctx, dev, `${dev.name} is only set up to pass IPv4`);
  if (dev.kind === 'firewall' && !inIf.nameif) return fail(ctx, dev, `${dev.name} ${inIf.name} has no nameif, so it passes no traffic`);
  if (dev.kind === 'firewall') {
    pkt = natIn(lab, dev, inIf, pkt);
  } else {
    const inList = family6 ? inIf.v6In : inIf.aclIn;
    if (inList && dev.acls.has(inList) && !ctx.skipAclOnce) {
      const verdict = evaluate(dev.acls.get(inList), pkt);
      if (!verdict.permit) return fail(ctx, dev, `${dev.name} ${inIf.name} access list ${inList} coming in drops it (${verdict.seq ? `line ${verdict.seq}: ` : ''}${verdict.text})`);
      step(ctx, dev, 'acl', `Access list ${inList} coming in permits it (line ${verdict.seq}: ${verdict.text})`, pkt);
    }
    ctx.skipAclOnce = false;
    if (!family6) {
      const before = pkt;
      pkt = natIn(lab, dev, inIf, pkt);
      if (pkt.dst !== before.dst) step(ctx, dev, 'nat', `NAT changes the destination from ${before.dst} to ${pkt.dst}`, pkt);
    }
  }
  if (ownsIp(dev, pkt.dst)) {
    if (pkt.proto === 'esp' && pkt.inner) {
      step(ctx, dev, 'decrypt', 'Decrypts it, and the original packet carries on', pkt.inner);
      ctx.skipAclOnce = true;
      return arrive(net, dev, inIf, pkt.inner, ctx);
    }
    if (pkt.proto === 'gre' && pkt.inner) {
      const tun = [...dev.ifaces.values()].find((i) => i.name.startsWith('Tu') && i.tunnelDst === pkt.src && resolveTunnelSource(dev, i) === pkt.dst);
      if (!tun || !ifaceUp(net, dev, tun.name)) return fail(ctx, dev, `${dev.name} has no tunnel coming from ${pkt.src}`);
      step(ctx, dev, 'decap', 'Unwraps the GRE, and the original packet carries on', pkt.inner);
      return arrive(net, dev, tun, pkt.inner, ctx);
    }
    step(ctx, dev, 'deliver', `It's addressed to ${dev.name} itself, so it's delivered`, pkt, { iface: inIf.name });
    return { ok: true, dev, iface: inIf, pkt };
  }
  if (family6 && !dev.v6Routing) return fail(ctx, dev, `${dev.name} won't forward IPv6, because ipv6 unicast-routing is off`);
  if (isSwitchKind(dev) && !dev.ipRouting) return fail(ctx, dev, `${dev.name} isn't routing, because ip routing is off`);
  const route = lookupAny(net, dev, pkt.dst);
  if (!route || !route.iface) return fail(ctx, dev, `${dev.name} has no route to ${pkt.dst}`);
  pkt = { ...pkt, ttl: pkt.ttl - 1 };
  if (pkt.ttl <= 0) return fail(ctx, dev, `The packet's TTL ran out at ${dev.name}, which usually means a routing loop`);
  return egress(net, dev, inIf, route, pkt, ctx);
}

export function send(lab, net, dev, pkt) {
  const ctx = { hops: [{ dev: dev.name, action: 'send', detail: `Sends ${pkt.reply ? 'the answer' : `${pkt.proto} ${pkt.proto === 'icmp' ? 'echo' : `to port ${pkt.dport}`}`} to ${pkt.dst}`, pkt: header(pkt) }], encrypted: false, skipAclOnce: false };
  const result = originate(net, dev, pkt, ctx);
  return { ...result, hops: ctx.hops, encrypted: ctx.encrypted };
}

function originate(net, dev, pkt, ctx) {
  if (ownsIp(dev, pkt.dst)) {
    step(ctx, dev, 'deliver', 'It\'s addressed to this device', pkt);
    return { ok: true, dev, iface: [...dev.ifaces.values()].find((i) => hasAddr(i, pkt.dst)), pkt: { ...pkt, src: pkt.src || pkt.dst } };
  }
  const route = lookupAny(net, dev, pkt.dst);
  if (!route || !route.iface) {
    if (isHost(dev)) {
      const port = hostPort(dev);
      const iface = dev.ifaces.get(port);
      const family6 = v6(pkt.dst);
      if (dev.kind === 'laptop' && !net.air.assoc.has(dev.name)) return fail(ctx, dev, net.air.why.get(dev.name) || `${dev.name} isn't connected to any Wi-Fi`);
      if (family6 ? !iface.ip6.length : !iface.ip) return fail(ctx, dev, `${dev.name} has no ${family6 ? 'IPv6 ' : 'IP '}address yet`);
      if (!ifaceUp(net, dev, port)) return fail(ctx, dev, `${dev.name} ${port} is down. Check its cable`);
      if (family6) return fail(ctx, dev, `${dev.name} has no IPv6 default gateway`);
      return fail(ctx, dev, dev.gateway ? `${dev.name}'s gateway ${dev.gateway} isn't on its own subnet` : `${dev.name} has no default gateway, so it can only reach its own subnet`);
    }
    return fail(ctx, dev, `${dev.name} has no route to ${pkt.dst}`);
  }
  const outIf = dev.ifaces.get(route.iface);
  const src = pkt.src || (v6(pkt.dst) ? outIf.ip6[0]?.addr : outIf.ip) || null;
  return egress(net, dev, null, route, { ...pkt, src }, ctx);
}

/* ---------- a full round trip ---------- */
function listens(dev, proto, port, srcIp) {
  if (proto === 'icmp') return { open: true };
  if (isHost(dev)) {
    const open = [...dev.services].some((s) => servicePorts(s).some(([p, n]) => p === proto && n === port));
    return { open, why: `Nothing on ${dev.name} is listening on ${proto} ${port}` };
  }
  if (proto === 'tcp' && (port === 22 || port === 23)) {
    const ssh = port === 22;
    const t = dev.vty.transport;
    const allowed = ssh ? (t === 'ssh' || t === 'all') && dev.rsa : t === 'telnet' || t === 'all' || t === null;
    if (!allowed) return { open: false, why: `${dev.name} doesn't accept ${ssh ? 'SSH' : 'Telnet'} on its vty lines` };
    if (!dev.vty.login) return { open: false, why: `${dev.name}'s vty lines have no login set, so it refuses the connection` };
    if (dev.vty.accessClass) {
      const acl = dev.acls.get(dev.vty.accessClass);
      if (acl && (v6(srcIp) || !evaluate(acl, { src: srcIp, dst: '0.0.0.0', proto: 'tcp', sport: 0, dport: port, ack: false }, true).permit)) {
        return { open: false, why: `${dev.name}'s access-class ${dev.vty.accessClass} refuses ${srcIp}` };
      }
    }
    return { open: true };
  }
  if (proto === 'tcp' && port === 80) return { open: dev.httpServer, why: `${dev.name} isn't running an HTTP server` };
  if (proto === 'udp' && port === 1812) return { open: false, why: `${dev.name} isn't a RADIUS server` };
  if (proto === 'udp' && port === 500) return { open: dev.crypto.keys.size > 0, why: `${dev.name} isn't running IKE` };
  return { open: false, why: `Nothing on ${dev.name} is listening on ${proto} ${port}` };
}

/** There and back. Status is ok, refused (it got there and nothing listens) or timeout (it was dropped). */
export function probe(lab, net, dev, dst0, proto = 'icmp', port = 0) {
  const dst = isIp6(dst0) ? norm6(dst0) : dst0;
  const id = allocPort(lab);
  const out = send(lab, net, dev, pktOf(null, dst, proto, id, proto === 'icmp' ? id : port));
  const base = { dst, proto, port, from: dev.name, there: out.hops, encrypted: out.encrypted };
  if (!out.ok) return { ...base, status: 'timeout', ok: false, why: out.why, at: out.at };
  const listener = listens(out.dev, proto, proto === 'icmp' ? 0 : out.pkt.dport, out.pkt.src);
  const reached = out.dev;
  const back = send(lab, net, reached, { ...pktOf(out.pkt.dst, out.pkt.src, proto, out.pkt.dport, out.pkt.sport), ack: proto === 'tcp', reply: true });
  const result = { ...base, back: back.hops, reached: reached.name, encrypted: out.encrypted || back.encrypted };
  if (!back.ok) return { ...result, status: 'timeout', ok: false, why: `It got to ${reached.name}, but the answer never came back. ${back.why}`, at: back.at };
  if (!listener.open) return { ...result, status: 'refused', ok: false, why: listener.why, at: reached.name };
  return { ...result, status: 'ok', ok: true, why: '' };
}

/* DNS, using the same round trips as everything else. */
export function resolve(lab, net, dev, name, serverIp = null, family = null) {
  const server = serverIp || dev.nameserver || dev.dhcpDns;
  if (!server) return { ok: false, why: `${dev.name} has no DNS server set` };
  const trip = probe(lab, net, dev, server, 'udp', 53);
  if (!trip.ok) return { ok: false, why: `Can't ask ${server}: ${trip.why}`, trip };
  const target = lab.devices.get(trip.reached);
  let at = name.toLowerCase();
  const chain = [];
  for (let i = 0; i < 8; i++) {
    const rec = target.records.get(at);
    const aaaa = target.records6.get(at);
    if (!rec && !aaaa) return { ok: false, why: `${server} has no record for ${at}`, status: 'NXDOMAIN', chain, server };
    if (rec?.type === 'CNAME') {
      chain.push({ name: at, type: 'CNAME', value: rec.value });
      at = rec.value.toLowerCase();
      continue;
    }
    if (rec) chain.push({ name: at, type: 'A', value: rec.value });
    if (aaaa) chain.push({ name: at, type: 'AAAA', value: aaaa });
    // A machine with IPv6 prefers it, the same as a real one, unless a family was asked for.
    const has6 = dev.ifaces.get(isHost(dev) ? hostPort(dev) : '')?.ip6?.length > 0;
    const wants6 = family === 6 || (family === null && has6);
    const ip = wants6 && aaaa ? aaaa : rec?.value;
    if (!ip) return { ok: false, why: `${at} has no ${family === 6 ? 'AAAA' : 'A'} record`, status: 'NOERROR', chain, server };
    return { ok: true, ip, a: rec?.value ?? null, aaaa: aaaa ?? null, chain, server };
  }
  return { ok: false, why: 'Those CNAME records go round in a circle', status: 'SERVFAIL', chain, server };
}

export const hostMac = (dev) => macOf(dev.name, hostPort(dev));
export { netOf, ip2n, n2ip, wildMatch, ifaceUp };
