/* Section 9.6: goals are questions asked of the running network. Each answer says why, so the lab itself teaches. */
import { in6, inNet, ip2n, isIp, isIp6, netOf, norm6 } from './addr.js';
import { probe, resolve } from './forward.js';
import { ifaceUp, lookup, lookup6 } from './net.js';
import { running } from './ios.js';
import { hostConfig } from './host.js';
import { hostPort, ifaceName, isHost } from './device.js';

function addressOf(lab, net, from, to, family = null) {
  if (isIp(to)) return { ip: to };
  if (isIp6(to)) return { ip: norm6(to) };
  const named = lab.devices.get(to);
  if (named && family === 6) {
    const iface = [...named.ifaces.values()].find((i) => i.ip6?.length);
    return iface ? { ip: iface.ip6[0].addr } : { error: `${to} has no IPv6 address` };
  }
  if (named) {
    const iface = [...named.ifaces.values()].find((i) => i.ip && !i.shut && !i.name.startsWith('Lo')) || [...named.ifaces.values()].find((i) => i.ip);
    return iface ? { ip: iface.ip } : { error: `${to} has no address` };
  }
  const r = resolve(lab, net, from, to, null, family);
  return r.ok ? { ip: r.ip } : { error: r.why };
}
const configText = (dev) => (isHost(dev) ? hostConfig(dev) : running(dev));

const CHECKS = {
  reach(lab, net, g) {
    const from = lab.devices.get(g.from);
    const to = addressOf(lab, net, from, g.to, g.family ?? null);
    const expect = g.expect || 'ok';
    const what = g.proto && g.proto !== 'icmp' ? `${g.proto} ${g.port}` : 'ping';
    if (to.error) return expect === 'blocked' ? { ok: true } : { ok: false, why: `${g.from} can't find ${g.to}: ${to.error}` };
    const r = probe(lab, net, from, to.ip, g.proto || 'icmp', g.port || 0);
    if (expect === 'blocked') return r.ok ? { ok: false, why: `${g.from} can still reach ${g.to} (${what}), and it shouldn't` } : { ok: true };
    return r.ok ? { ok: true } : { ok: false, why: `${g.from} can't reach ${g.to} (${what}): ${r.why}` };
  },
  config(lab, net, g) {
    const dev = lab.devices.get(g.device);
    let text = configText(dev);
    if (g.interface) {
      const lines = text.split('\n');
      const at = lines.indexOf(`interface ${ifaceName(g.interface)}`);
      if (at < 0) return g.absent !== undefined ? { ok: true } : { ok: false, why: `${g.device} has no config for ${g.interface}` };
      let end = at + 1;
      while (end < lines.length && lines[end].startsWith(' ')) end++;
      text = lines.slice(at, end).join('\n');
    }
    if (g.contains !== undefined && !text.includes(g.contains)) return { ok: false, why: g.why || `${g.device} is missing: ${g.contains}` };
    if (g.absent !== undefined && text.includes(g.absent)) return { ok: false, why: g.why || `${g.device} still has: ${g.absent}` };
    return { ok: true };
  },
  saved(lab, net, g) {
    const same = lab.startupOf(g.device).trim() === configText(lab.devices.get(g.device)).trim();
    return same ? { ok: true } : { ok: false, why: `${g.device} has changes that aren't saved. A reload would lose them` };
  },
  dhcp(lab, net, g) {
    const iface = lab.devices.get(g.host).ifaces.get(hostPort(lab.devices.get(g.host)));
    if (!lab.devices.get(g.host).dhcpOn) return { ok: false, why: `${g.host} isn't using DHCP` };
    if (!iface.ip) return { ok: false, why: `${g.host} got no address. ${net.dhcpWhy.get(g.host) ?? ''}`.trim() };
    const [base, len] = g.in.split('/');
    return inNet(iface.ip, base, +len) ? { ok: true } : { ok: false, why: `${g.host} got ${iface.ip}, which isn't in ${g.in}` };
  },
  dns(lab, net, g) {
    const r = resolve(lab, net, lab.devices.get(g.from), g.name);
    if (!r.ok) return { ok: false, why: `${g.from} can't resolve ${g.name}: ${r.why}` };
    const wanted = isIp6(g.answer) ? norm6(g.answer) : g.answer;
    return r.ip === wanted || r.a === wanted || r.aaaa === wanted ? { ok: true } : { ok: false, why: `${g.name} resolves to ${r.ip}, not ${g.answer}` };
  },
  ospf_neighbors(lab, net, g) {
    const list = net.ospfNeighbors.get(g.device) || [];
    if (list.length >= g.count) return { ok: true };
    const why = [...net.ospfWhy].filter(([k]) => k.startsWith(`${g.device}|`)).map(([, t]) => t)[0];
    return { ok: false, why: `${g.device} has ${list.length} of ${g.count} OSPF neighbours.${why ? ` ${why}` : ''}` };
  },
  route(lab, net, g) {
    const dev = lab.devices.get(g.device);
    const six = isIp6(g.to);
    const r = six ? lookup6(net, dev, norm6(g.to)) : lookup(net, dev, g.to);
    if (!r) return { ok: false, why: `${g.device} has no route to ${g.to}` };
    if (g.type && !r.type.startsWith(g.type)) return { ok: false, why: `${g.device} reaches ${g.to} by a ${r.type} route, not ${g.type}` };
    if (g.via && r.via !== (six ? norm6(g.via) : g.via)) return { ok: false, why: `${g.device} sends ${g.to} via ${r.via}, not ${g.via}` };
    return { ok: true };
  },
  vpn_up(lab, net, g) {
    const s = net.ipsec.get(`${g.device}|${g.peer}`);
    if (!s) return { ok: false, why: `${g.device} has no VPN to ${g.peer} on an interface` };
    return s.up ? { ok: true } : { ok: false, why: `The VPN from ${g.device} to ${g.peer} is down. ${s.why}` };
  },
  encrypted(lab, net, g) {
    const from = lab.devices.get(g.from);
    const to = addressOf(lab, net, from, g.to);
    if (to.error) return { ok: false, why: to.error };
    const r = probe(lab, net, from, to.ip, g.proto || 'icmp', g.port || 0);
    if (!r.ok) return { ok: false, why: `${g.from} can't reach ${g.to}: ${r.why}` };
    return r.encrypted ? { ok: true } : { ok: false, why: `That traffic isn't going through the VPN, so anyone on the path can read it` };
  },
  tunnel_up(lab, net, g) {
    const dev = lab.devices.get(g.device);
    return ifaceUp(net, dev, ifaceName(g.interface)) ? { ok: true } : { ok: false, why: `${g.device} ${g.interface} is down` };
  },
  stp_root(lab, net, g) {
    return net.stpRoot?.name === g.device ? { ok: true } : { ok: false, why: `The root bridge is ${net.stpRoot?.name}, not ${g.device}` };
  },
  v6_addr(lab, net, g) {
    const dev = lab.devices.get(g.host);
    const iface = dev.ifaces.get(hostPort(dev));
    const [base, len] = g.in.split('/');
    if (iface.ip6.some((a) => in6(a.addr, base, +len))) return { ok: true };
    return { ok: false, why: `${g.host} has no IPv6 address in ${g.in}. ${net.slaacWhy.get(g.host) ?? ''}`.trim() };
  },
  wifi_assoc(lab, net, g) {
    const assoc = net.air.assoc.get(g.host);
    if (!assoc) return { ok: false, why: `${g.host} isn't on Wi-Fi. ${net.air.why.get(g.host) ?? ''}`.trim() };
    if (g.ssid && assoc.ssid !== g.ssid) return { ok: false, why: `${g.host} is on ${assoc.ssid}, not ${g.ssid}` };
    if (g.ap && assoc.ap !== g.ap) return { ok: false, why: `${g.host} is connected through ${assoc.ap}, not ${g.ap}` };
    return { ok: true };
  },
  wifi_clean(lab, net) {
    const clash = net.air.overlaps[0];
    return clash ? { ok: false, why: `${clash.a} on channel ${clash.channels[0]} and ${clash.b} on channel ${clash.channels[1]} interfere with each other` } : { ok: true };
  },
  mac_on(lab, net, g) {
    const seen = [...(lab.runtime.macs.get(g.device)?.values() || [])].some((m) => m.port === g.port);
    return seen ? { ok: true } : { ok: false, why: `${g.device} hasn't learned anything on ${g.port}. Send some traffic` };
  },
  iface_up(lab, net, g) {
    const dev = lab.devices.get(g.device);
    return ifaceUp(net, dev, ifaceName(g.interface)) ? { ok: true } : { ok: false, why: `${g.device} ${g.interface} isn't up` };
  },
  err_disabled(lab, net, g) {
    return net.errDisabled.has(`${g.device}|${ifaceName(g.interface)}`) ? { ok: true } : { ok: false, why: `${g.device} ${g.interface} hasn't shut itself down` };
  },
  fits(lab, net, g) {
    const iface = lab.devices.get(g.device).ifaces.get(ifaceName(g.interface));
    if (!iface?.ip) return { ok: false, why: `${g.device} ${g.interface} has no address` };
    const room = 2 ** (32 - iface.len) - 2;
    if (room < g.hosts) return { ok: false, why: `A /${iface.len} holds ${room} hosts, and this needs ${g.hosts}` };
    if (g.within) {
      const [base, len] = g.within.split('/');
      if (iface.len < +len || !inNet(iface.ip, base, +len)) return { ok: false, why: `${iface.ip}/${iface.len} isn't inside ${g.within}` };
    }
    if (g.max_len !== undefined && iface.len < g.max_len) return { ok: false, why: `A /${iface.len} wastes addresses here. Use /${g.max_len} or smaller` };
    return { ok: true };
  },
  no_overlap(lab, net, g) {
    const list = g.interfaces.map(([d, i]) => ({ name: `${d} ${i}`, iface: lab.devices.get(d).ifaces.get(ifaceName(i)) }));
    for (const x of list) {
      for (const y of list) {
        if (x === y || !x.iface?.ip || !y.iface?.ip) continue;
        const wide = Math.min(x.iface.len, y.iface.len);
        if (netOf(x.iface.ip, wide) === netOf(y.iface.ip, wide)) return { ok: false, why: `${x.name} and ${y.name} overlap` };
      }
    }
    return { ok: true };
  },
};

function evaluateOne(lab, goal) {
  const [kind] = Object.keys(goal).filter((k) => k !== 'label');
  const body = goal[kind];
  if (kind === 'survives') {
    const copy = lab.clone();
    for (const cut of body.cut || []) copy.cutCable(cut.device, ifaceName(cut.port));
    for (const off of body.shut || []) copy.applyLines(off.device, [`interface ${ifaceName(off.interface)}`, 'shutdown']);
    for (const inner of body.then) {
      const r = evaluateOne(copy, inner);
      if (!r.ok) return { ok: false, why: `With ${[...(body.cut || []).map((c) => `${c.device} ${c.port}`), ...(body.shut || []).map((c) => `${c.device} ${c.interface}`)].join(' and ')} down: ${r.why}` };
    }
    return { ok: true };
  }
  if (kind === 'after_reload') {
    const copy = lab.clone();
    for (const d of body.devices) copy.reload(d);
    for (const inner of body.then) {
      const r = evaluateOne(copy, inner);
      if (!r.ok) return { ok: false, why: `After a reload: ${r.why}` };
    }
    return { ok: true };
  }
  if (!CHECKS[kind]) return { ok: false, why: 'This goal is not one this version understands' };
  return CHECKS[kind](lab, lab.net(), body);
}

/** Every goal, in order, as the player sees them. */
export function checkGoals(lab, goals) {
  return goals.map((goal) => {
    const r = evaluateOne(lab, goal);
    return { label: goal.label, ok: r.ok, why: r.ok ? '' : r.why };
  });
}
export { ip2n };
