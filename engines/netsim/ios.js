/* The network OS: modes, the command tables, and show commands. Everything a player types and everything a
   saved config contains goes through the same tables, so `show running-config` and loading a config are inverses. */
import { inNet, isIp, isIp6, ip2n, lenToMask, lenToWild, maskToLen, n2ip, netOf, norm6, parsePrefix6, portOf, wildToLen } from './addr.js';
import { addEntry, isNumberedStandard, parseEntry } from './acl.js';
import { ifaceName, isSwitchKind, longName, newIface, sortIfaces } from './device.js';
import { entry as e, match, nextWords, tokenize } from './grammar.js';
import { macOf } from './addr.js';
import { probe } from './forward.js';
import { domainOf, ifaceUp } from './net.js';

const hash = (word) => {
  let h = 5381;
  for (const c of word) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0;
  return `$1$${h.toString(36)}`;
};
const routerLike = (d) => d.kind === 'router' || d.kind === 'l3switch';
const need = (test, table) => table.map((x) => ({ ...x, when: test }));

function vlanList(text) {
  if (!/^[\d,-]+$/.test(text)) return null;
  const out = new Set();
  for (const part of text.split(',')) {
    const [a, b] = part.split('-').map(Number);
    if (!a || a > 4094 || (b !== undefined && (!b || b > 4094 || b < a || b - a > 4094))) return null;
    for (let v = a; v <= (b ?? a); v++) out.add(v);
  }
  return out;
}
const vlanText = (set) => {
  const list = [...set].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    parts.push(j > i ? `${list[i]}-${list[j]}` : `${list[i]}`);
    i = j;
  }
  return parts.join(',');
};

const eachIf = (c, fn) => {
  for (const name of c.dev.ctx.ifaces) {
    const out = fn(c.dev.ifaces.get(name));
    if (out) return out;
  }
  return '';
};

/* Finds or makes an interface. Physical ports only exist if the device has them. */
function openIface(dev, text) {
  const name = ifaceName(text);
  if (!name) return null;
  if (dev.ifaces.has(name)) return name;
  const parent = name.split('.')[0];
  if (name.includes('.')) {
    if (!dev.ifaces.has(parent) || !routerLike(dev)) return null;
  } else if (name.startsWith('Gi') || name.startsWith('eth')) return null;
  else if (name.startsWith('Vl') && !isSwitchKind(dev)) return null;
  else if (name.startsWith('Tu') && dev.kind !== 'router') return null;
  else if (name.startsWith('Lo') && dev.kind === 'firewall') return null;
  else if (name.startsWith('Do')) return null;
  dev.ifaces.set(name, newIface(dev, name));
  return name;
}

function enterIface(c, text) {
  const name = openIface(c.dev, text);
  if (!name) return `% Invalid interface ${text}. See: show ip interface brief`;
  c.dev.ctx = { ifaces: [name] };
  c.dev.mode = 'if';
  return '';
}
function enterRange(c, text) {
  const m = /^(?:gigabitethernet|gig|gi|g)\s*(\d+)\/(\d+)\s*-\s*(\d+)$/i.exec(text.replace(/\s+/g, ' '));
  if (!m) return '% Usage: interface range Gi0/1-4';
  const names = [];
  for (let i = +m[2]; i <= +m[3]; i++) {
    const n = `Gi${m[1]}/${i}`;
    if (!c.dev.ifaces.has(n)) return `% ${n} doesn't exist on this device.`;
    names.push(n);
  }
  c.dev.ctx = { ifaces: names };
  c.dev.mode = 'if';
  return '';
}

function addAclLine(c, name, type, words) {
  const dev = c.dev;
  const acl = dev.acls.get(name) || { name, type, named: !/^\d+$/.test(name) || dev.kind === 'firewall', entries: [] };
  const parsed = parseEntry(words, type, dev);
  if (!parsed) return `% That access list line isn't valid: ${words.join(' ')}`;
  addEntry(acl, parsed);
  dev.acls.set(name, acl);
  return '';
}

function setRoute(c, ip, mask, hop, ad) {
  const len = maskToLen(mask);
  const net = netOf(ip, len);
  if (ip2n(ip) !== net) return `% ${ip} isn't the start of a /${len} network. Did you mean ${n2ip(net)}?`;
  const route = { net, len, ad: ad === undefined ? 1 : +ad };
  if (isIp(hop)) route.via = hop;
  else {
    const name = ifaceName(hop);
    if (!name) return `% ${hop} is neither an address nor an interface.`;
    route.iface = name;
    route.via = null;
  }
  c.dev.routes = c.dev.routes.filter((r) => !(r.net === net && r.len === len && r.via === route.via && r.iface === route.iface));
  c.dev.routes.push(route);
  return '';
}
function dropRoute(c, ip, mask, hop) {
  const len = maskToLen(mask);
  const net = netOf(ip, len);
  c.dev.routes = c.dev.routes.filter((r) => !(r.net === net && r.len === len && (!hop || r.via === hop || r.iface === ifaceName(hop))));
  return '';
}

function setAddress(c, ip, mask) {
  const len = maskToLen(mask);
  return eachIf(c, (i) => {
    if (isSwitchKind(c.dev) && i.name.startsWith('Gi') && !i.routed) return '% This is a switch port. Use "no switchport" first, or give the address to a VLAN interface.';
    if (len < 31 && (ip2n(ip) === netOf(ip, len) || ip2n(ip) === netOf(ip, len) + 2 ** (32 - len) - 1)) return `% ${ip} is the network or broadcast address of that /${len}.`;
    for (const other of c.dev.ifaces.values()) {
      if (other !== i && other.ip && (inNet(other.ip, ip, len) || inNet(ip, other.ip, other.len))) return `% ${n2ip(netOf(ip, len))} overlaps with ${other.name}.`;
    }
    i.ip = ip;
    i.len = len;
    return '';
  });
}

function natStatic(c, proto, local, lport, global, gport) {
  const rule = { kind: 'static', local, global, proto: proto || null, lport: lport ? portOf(lport) : null, gport: gport ? portOf(gport) : null };
  c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'static' && r.local === local && r.lport === rule.lport));
  c.dev.natRules.push(rule);
  return '';
}

const GLOBAL_ALL = [
  e('hostname <word>', (c, [n]) => { c.dev.hostname = n; return ''; }),
  e('no hostname', (c) => { c.dev.hostname = c.dev.name; return ''; }),
  e('interface <if>', (c, [n]) => enterIface(c, n), 'Pick an interface'),
  e('interface range <text>', (c, [n]) => enterRange(c, n), 'Pick several interfaces'),
  e('enable secret <word>', (c, [w]) => { c.dev.secret = hash(w); return ''; }, 'Set the privileged password, hashed'),
  e('enable secret 5 <word>', (c, [w]) => { c.dev.secret = w; return ''; }),
  e('no enable secret', (c) => { c.dev.secret = null; return ''; }),
  e('enable password <word>', (c, [w]) => { c.dev.enablePassword = w; return ''; }, 'Set the privileged password in clear text'),
  e('no enable password', (c) => { c.dev.enablePassword = null; return ''; }),
  e('service password-encryption', (c) => { c.dev.passwordEnc = true; return ''; }),
  e('no service password-encryption', (c) => { c.dev.passwordEnc = false; return ''; }),
  e('banner motd <text>', (c, [t]) => { c.dev.banner = t.slice(0, 200); return ''; }),
  e('no banner motd', (c) => { c.dev.banner = ''; return ''; }),
  e('username <word> secret <word>', (c, [u, w]) => { c.dev.users.set(u, { secret: hash(w) }); return ''; }, 'Add a local user'),
  e('username <word> secret 5 <word>', (c, [u, w]) => { c.dev.users.set(u, { secret: w }); return ''; }),
  e('no username <word>', (c, [u]) => { c.dev.users.delete(u); return ''; }),
  e('ip domain-name <word>', (c, [d]) => { c.dev.domain = d; return ''; }),
  e('crypto key generate rsa', (c) => { if (!c.dev.domain) return '% Please define a domain-name first.'; c.dev.rsa = true; return ''; }, 'Make the keys SSH needs'),
  e('crypto key generate rsa modulus <n>', (c) => { if (!c.dev.domain) return '% Please define a domain-name first.'; c.dev.rsa = true; return ''; }),
  e('ip ssh version 2', (c) => { c.dev.sshV2 = true; return ''; }),
  e('no ip ssh version', (c) => { c.dev.sshV2 = false; return ''; }),
  e('ip http server', (c) => { c.dev.httpServer = true; return ''; }),
  e('no ip http server', (c) => { c.dev.httpServer = false; return ''; }),
  e('ntp server <ip>', (c, [s]) => { if (!c.dev.ntp.includes(s)) c.dev.ntp.push(s); return ''; }),
  e('no ntp server <ip>', (c, [s]) => { c.dev.ntp = c.dev.ntp.filter((x) => x !== s); return ''; }),
  e('logging host <ip>', (c, [s]) => { if (!c.dev.logging.includes(s)) c.dev.logging.push(s); return ''; }),
  e('no logging host <ip>', (c, [s]) => { c.dev.logging = c.dev.logging.filter((x) => x !== s); return ''; }),
  e('snmp-server community <word> ro', (c, [w]) => { c.dev.snmp = c.dev.snmp.filter((s) => s.name !== w); c.dev.snmp.push({ name: w, mode: 'ro' }); return ''; }),
  e('snmp-server community <word> rw', (c, [w]) => { c.dev.snmp = c.dev.snmp.filter((s) => s.name !== w); c.dev.snmp.push({ name: w, mode: 'rw' }); return ''; }),
  e('no snmp-server community <word>', (c, [w]) => { c.dev.snmp = c.dev.snmp.filter((s) => s.name !== w); return ''; }),
];

const ACL_WORDS = (c, [name, rest]) => addAclLine(c, name, isNumberedStandard(name) ? 'standard' : 'extended', tokenize(rest));

const GLOBAL_L3 = need(routerLike, [
  e('ip route <ip> <mask> <word>', (c, [i, m, h]) => setRoute(c, i, m, h), 'Add a static route'),
  e('ip route <ip> <mask> <word> <n>', (c, [i, m, h, d]) => setRoute(c, i, m, h, d), 'Add a static route with a distance'),
  e('no ip route <ip> <mask>', (c, [i, m]) => dropRoute(c, i, m)),
  e('no ip route <ip> <mask> <word>', (c, [i, m, h]) => dropRoute(c, i, m, h)),
  e('no ip route <ip> <mask> <word> <n>', (c, [i, m, h]) => dropRoute(c, i, m, h)),
  e('router ospf <n>', (c, [n]) => {
    if (!c.dev.ospf) c.dev.ospf = { pid: +n, rid: null, networks: [], passive: new Set(), defaultOriginate: false };
    c.dev.mode = 'router';
    return '';
  }, 'Start OSPF'),
  e('no router ospf <n>', (c) => { c.dev.ospf = null; return ''; }),
  e('access-list <word> <text>', ACL_WORDS, 'Add an access list line'),
  e('no access-list <word>', (c, [n]) => { c.dev.acls.delete(n); return ''; }),
  e('ip access-list extended <word>', (c, [n]) => { if (!c.dev.acls.has(n)) c.dev.acls.set(n, { name: n, type: 'extended', named: true, entries: [] }); c.dev.ctx = { acl: n }; c.dev.mode = 'acl'; return ''; }),
  e('ip access-list standard <word>', (c, [n]) => { if (!c.dev.acls.has(n)) c.dev.acls.set(n, { name: n, type: 'standard', named: true, entries: [] }); c.dev.ctx = { acl: n }; c.dev.mode = 'acl'; return ''; }),
  e('no ip access-list extended <word>', (c, [n]) => { c.dev.acls.delete(n); return ''; }),
  e('no ip access-list standard <word>', (c, [n]) => { c.dev.acls.delete(n); return ''; }),
  e('ip dhcp excluded-address <ip>', (c, [a]) => { c.dev.dhcp.excluded.push([a, a]); return ''; }),
  e('ip dhcp excluded-address <ip> <ip>', (c, [a, b]) => { c.dev.dhcp.excluded.push([a, b]); return ''; }),
  e('no ip dhcp excluded-address <ip>', (c, [a]) => { c.dev.dhcp.excluded = c.dev.dhcp.excluded.filter((x) => x[0] !== a); return ''; }),
  e('no ip dhcp excluded-address <ip> <ip>', (c, [a]) => { c.dev.dhcp.excluded = c.dev.dhcp.excluded.filter((x) => x[0] !== a); return ''; }),
  e('ip dhcp pool <word>', (c, [n]) => { if (!c.dev.dhcp.pools.has(n)) c.dev.dhcp.pools.set(n, { name: n, net: null, len: null, gw: null, dns: null }); c.dev.ctx = { pool: n }; c.dev.mode = 'dhcp'; return ''; }, 'Create an address pool'),
  e('no ip dhcp pool <word>', (c, [n]) => { c.dev.dhcp.pools.delete(n); return ''; }),
]);

const GLOBAL_V6 = need(routerLike, [
  e('ipv6 unicast-routing', (c) => { c.dev.v6Routing = true; return ''; }, 'Let this device route IPv6 and advertise prefixes'),
  e('no ipv6 unicast-routing', (c) => { c.dev.v6Routing = false; return ''; }),
  e('ipv6 route <ip6p> <ip6>', (c, [p, hop]) => {
    const { addr, len } = parsePrefix6(p);
    const via = norm6(hop);
    c.dev.routes6 = c.dev.routes6.filter((r) => !(r.prefix === addr && r.len === len && r.via === via));
    c.dev.routes6.push({ prefix: addr, len, via });
    return '';
  }, 'Add a static IPv6 route'),
  e('no ipv6 route <ip6p> <ip6>', (c, [p, hop]) => {
    const { addr, len } = parsePrefix6(p);
    c.dev.routes6 = c.dev.routes6.filter((r) => !(r.prefix === addr && r.len === len && r.via === norm6(hop)));
    return '';
  }),
  e('ipv6 access-list <word>', (c, [n]) => { if (!c.dev.acls.has(n)) c.dev.acls.set(n, { name: n, type: 'ipv6', named: true, entries: [] }); c.dev.ctx = { acl: n }; c.dev.mode = 'acl'; return ''; }, 'Filter IPv6, which IPv4 lists never touch'),
  e('no ipv6 access-list <word>', (c, [n]) => { c.dev.acls.delete(n); return ''; }),
]);

const GLOBAL_AP = need((d) => d.kind === 'ap', [
  e('dot11 ssid <word>', (c, [n]) => {
    if (!c.dev.ssidTable.has(n)) c.dev.ssidTable.set(n, { name: n, vlan: 1, auth: 'open', key: null, isolation: false });
    c.dev.ctx = { ssid: n };
    c.dev.mode = 'ssid';
    return '';
  }, 'Create a Wi-Fi network'),
  e('no dot11 ssid <word>', (c, [n]) => {
    c.dev.ssidTable.delete(n);
    for (const r of c.dev.ifaces.values()) r.ssids = (r.ssids || []).filter((x) => x !== n);
    return '';
  }),
  e('radius-server host <ip> key <word>', (c, [h, k]) => { c.dev.radius = { host: h, key: k }; return ''; }, 'Where to check Wi-Fi logins'),
  e('no radius-server host', (c) => { c.dev.radius = null; return ''; }),
]);

const GLOBAL_ROUTER = need((d) => d.kind === 'router', [
  e('ip nat inside source list <word> interface <if> overload', (c, [a, i]) => { c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'dynamic' && r.acl === a)); c.dev.natRules.push({ kind: 'dynamic', acl: a, iface: ifaceName(i) }); return ''; }, 'Share one public address'),
  e('no ip nat inside source list <word> interface <if> overload', (c, [a]) => { c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'dynamic' && r.acl === a)); return ''; }),
  e('ip nat inside source static <ip> <ip>', (c, [l, g]) => natStatic(c, null, l, null, g, null), 'Map one address to another'),
  e('no ip nat inside source static <ip> <ip>', (c, [l]) => { c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'static' && r.local === l && !r.proto)); return ''; }),
  e('ip nat inside source static tcp <ip> <port> <ip> <port>', (c, [l, lp, g, gp]) => natStatic(c, 'tcp', l, lp, g, gp), 'Forward one TCP port'),
  e('ip nat inside source static udp <ip> <port> <ip> <port>', (c, [l, lp, g, gp]) => natStatic(c, 'udp', l, lp, g, gp), 'Forward one UDP port'),
  e('no ip nat inside source static tcp <ip> <port> <ip> <port>', (c, [l, lp]) => { c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'static' && r.local === l && r.lport === portOf(lp))); return ''; }),
  e('no ip nat inside source static udp <ip> <port> <ip> <port>', (c, [l, lp]) => { c.dev.natRules = c.dev.natRules.filter((r) => !(r.kind === 'static' && r.local === l && r.lport === portOf(lp))); return ''; }),
  e('crypto isakmp policy <n>', (c, [n]) => {
    if (!c.dev.crypto.policies.has(+n)) c.dev.crypto.policies.set(+n, { encryption: 'des', hash: 'sha', group: 1, auth: 'rsa-sig' });
    c.dev.ctx = { policy: +n };
    c.dev.mode = 'isakmp';
    return '';
  }, 'Set the phase 1 terms'),
  e('no crypto isakmp policy <n>', (c, [n]) => { c.dev.crypto.policies.delete(+n); return ''; }),
  e('crypto isakmp key <word> address <ip>', (c, [k, a]) => { c.dev.crypto.keys.set(a, k); return ''; }, 'Set the pre-shared key for a peer'),
  e('no crypto isakmp key <word> address <ip>', (c, [, a]) => { c.dev.crypto.keys.delete(a); return ''; }),
  e('crypto ipsec transform-set <word> <text>', (c, [n, t]) => { c.dev.crypto.tsets.set(n, t.toLowerCase()); return ''; }, 'Set the phase 2 terms'),
  e('no crypto ipsec transform-set <word>', (c, [n]) => { c.dev.crypto.tsets.delete(n); return ''; }),
  e('crypto map <word> <n> ipsec-isakmp', (c, [m, n]) => {
    if (!c.dev.crypto.maps.has(m)) c.dev.crypto.maps.set(m, new Map());
    const map = c.dev.crypto.maps.get(m);
    if (!map.has(+n)) map.set(+n, { seq: +n, peer: null, tset: null, acl: null });
    c.dev.ctx = { map: m, seq: +n };
    c.dev.mode = 'cryptomap';
    return '';
  }, 'Tie a peer, terms and traffic together'),
  e('no crypto map <word>', (c, [m]) => { c.dev.crypto.maps.delete(m); return ''; }),
]);

const GLOBAL_SWITCH = need(isSwitchKind, [
  e('vlan <n>', (c, [n]) => {
    if (+n < 1 || +n > 4094) return '% VLAN IDs run from 1 to 4094.';
    if (!c.dev.vlans.has(+n)) c.dev.vlans.set(+n, `VLAN${String(n).padStart(4, '0')}`);
    c.dev.ctx = { vlan: +n };
    c.dev.mode = 'vlan';
    return '';
  }, 'Create a VLAN'),
  e('no vlan <n>', (c, [n]) => { if (+n !== 1) c.dev.vlans.delete(+n); return ''; }),
  e('ip default-gateway <ip>', (c, [g]) => { c.dev.defaultGw = g; return ''; }),
  e('no ip default-gateway', (c) => { c.dev.defaultGw = null; return ''; }),
  e('spanning-tree vlan <word> priority <n>', (c, [, p]) => { c.dev.stp.priority = +p; c.dev.stp.primary = false; return ''; }, 'Set this switch\'s priority'),
  e('spanning-tree vlan <word> root primary', (c) => { c.dev.stp.priority = 24576; c.dev.stp.primary = true; return ''; }, 'Make this switch the root'),
  e('no spanning-tree vlan <word> priority', (c) => { c.dev.stp.priority = 32768; return ''; }),
  e('no spanning-tree vlan <word> root', (c) => { c.dev.stp.priority = 32768; c.dev.stp.primary = false; return ''; }),
  e('spanning-tree mode <word>', () => ''),
]);

const GLOBAL_L3SWITCH = need((d) => d.kind === 'l3switch', [
  e('ip routing', (c) => { c.dev.ipRouting = true; return ''; }, 'Let this switch route between VLANs'),
  e('no ip routing', (c) => { c.dev.ipRouting = false; return ''; }),
]);

const GLOBAL_FIREWALL = need((d) => d.kind === 'firewall', [
  e('route <word> <ip> <mask> <ip>', (c, [outside, ip, mask, hop]) => {
    const iface = [...c.dev.ifaces.values()].find((i) => i.nameif === outside);
    if (!iface) return `% No interface is named ${outside}.`;
    const len = maskToLen(mask);
    const net = netOf(ip, len);
    c.dev.routes = c.dev.routes.filter((r) => !(r.net === net && r.len === len));
    c.dev.routes.push({ net, len, via: hop, ad: 1 });
    return '';
  }, 'Add a route: route outside 0.0.0.0 0.0.0.0 <next hop>'),
  e('no route <word> <ip> <mask> <ip>', (c, [, ip, mask]) => dropRoute(c, ip, mask)),
  e('access-list <word> extended <text>', (c, [n, rest]) => addAclLine(c, n, 'extended', tokenize(rest)), 'Add a rule. Firewalls write masks, not wildcards'),
  e('no access-list <word>', (c, [n]) => { c.dev.acls.delete(n); return ''; }),
  e('access-group <word> in interface <word>', (c, [a, i]) => { c.dev.accessGroups.set(i, a); return ''; }, 'Apply a rule list to traffic coming in'),
  e('no access-group <word> in interface <word>', (c, [, i]) => { c.dev.accessGroups.delete(i); return ''; }),
  e('object network <word>', (c, [n]) => { if (!c.dev.objects.has(n)) c.dev.objects.set(n, { name: n, ip: null, len: 32 }); c.dev.ctx = { object: n }; c.dev.mode = 'object'; return ''; }, 'Name a host or a subnet'),
  e('no object network <word>', (c, [n]) => { c.dev.objects.delete(n); c.dev.natRules = c.dev.natRules.filter((r) => r.object !== n); return ''; }),
]);

const CONFIG = [...GLOBAL_ALL, ...GLOBAL_L3, ...GLOBAL_V6, ...GLOBAL_AP, ...GLOBAL_ROUTER, ...GLOBAL_SWITCH, ...GLOBAL_L3SWITCH, ...GLOBAL_FIREWALL,
  ...need((d) => d.kind !== 'firewall', [
    e('line vty <n> <n>', (c) => { c.dev.mode = 'line'; c.dev.ctx = { line: 'vty' }; return ''; }, 'Set remote login rules'),
    e('line console <n>', (c) => { c.dev.mode = 'line'; c.dev.ctx = { line: 'console' }; return ''; }),
  ]),
];

const swPort = (d) => isSwitchKind(d);
const IFACE = [
  e('description <text>', (c, [t]) => eachIf(c, (i) => { i.desc = t.slice(0, 80); })),
  e('no description', (c) => eachIf(c, (i) => { i.desc = ''; })),
  e('ip address <ip> <mask>', (c, [ip, m]) => setAddress(c, ip, m), 'Give this interface an address'),
  e('no ip address', (c) => eachIf(c, (i) => { i.ip = null; i.len = null; })),
  e('shutdown', (c) => eachIf(c, (i) => { i.shut = true; }), 'Turn it off'),
  e('no shutdown', (c) => eachIf(c, (i) => { i.shut = false; }), 'Turn it on'),
  ...need(swPort, [
    e('no switchport', (c) => eachIf(c, (i) => { if (c.dev.kind !== 'l3switch') return '% Only a layer 3 switch has routed ports.'; i.routed = true; return ''; })),
    e('switchport', (c) => eachIf(c, (i) => { i.routed = false; i.ip = null; i.len = null; })),
    e('switchport mode access', (c) => eachIf(c, (i) => { i.swMode = 'access'; }), 'One VLAN, for an end device'),
    e('switchport mode trunk', (c) => eachIf(c, (i) => { i.swMode = 'trunk'; }), 'Many VLANs, tagged, to another switch'),
    e('switchport access vlan <n>', (c, [v]) => {
      // Typing it creates the VLAN, as on a real switch. Loading a config doesn't, or a deleted VLAN would come back.
      if (!c.dev.vlans.has(+v) && !c.dev.loading) c.dev.vlans.set(+v, `VLAN${String(v).padStart(4, '0')}`);
      return eachIf(c, (i) => { i.accessVlan = +v; });
    }, 'Which VLAN this port belongs to'),
    e('no switchport access vlan', (c) => eachIf(c, (i) => { i.accessVlan = 1; })),
    e('switchport trunk encapsulation <word>', () => ''),
    e('switchport nonegotiate', () => ''),
    e('switchport trunk native vlan <n>', (c, [v]) => eachIf(c, (i) => { i.native = +v; })),
    e('no switchport trunk native vlan', (c) => eachIf(c, (i) => { i.native = 1; })),
    e('switchport trunk allowed vlan <word>', (c, [t]) => {
      if (t === 'all') return eachIf(c, (i) => { i.allowed = null; });
      if (t === 'none') return eachIf(c, (i) => { i.allowed = new Set(); });
      const list = vlanList(t);
      if (!list) return `% ${t} isn't a list of VLANs. Try 10,20,30.`;
      return eachIf(c, (i) => { i.allowed = list; });
    }, 'Which VLANs may cross'),
    e('switchport trunk allowed vlan add <word>', (c, [t]) => {
      const list = vlanList(t);
      if (!list) return `% ${t} isn't a list of VLANs.`;
      return eachIf(c, (i) => { if (i.allowed) for (const v of list) i.allowed.add(v); });
    }),
    e('switchport trunk allowed vlan remove <word>', (c, [t]) => {
      const list = vlanList(t);
      if (!list) return `% ${t} isn't a list of VLANs.`;
      return eachIf(c, (i) => {
        if (!i.allowed) i.allowed = vlanList('1-4094');
        for (const v of list) i.allowed.delete(v);
      });
    }),
    e('no switchport trunk allowed vlan', (c) => eachIf(c, (i) => { i.allowed = null; })),
    e('switchport port-security', (c) => eachIf(c, (i) => { i.portsec = { max: 1, macs: [], sticky: false, violation: 'shutdown', ...(i.portsec || {}), on: true }; }), 'Limit who can use this port'),
    e('no switchport port-security', (c) => eachIf(c, (i) => { i.portsec = null; })),
    e('switchport port-security maximum <n>', (c, [n]) => eachIf(c, (i) => { i.portsec = { macs: [], sticky: false, violation: 'shutdown', on: false, ...(i.portsec || {}), max: +n }; }), 'How many machines may use this port'),
    e('switchport port-security mac-address sticky', (c) => eachIf(c, (i) => { i.portsec = { max: 1, macs: [], violation: 'shutdown', on: false, ...(i.portsec || {}), sticky: true }; }), 'Remember the first machine seen'),
    e('switchport port-security mac-address <word>', (c, [m]) => eachIf(c, (i) => { i.portsec = { max: 1, sticky: false, violation: 'shutdown', on: false, macs: [], ...(i.portsec || {}) }; if (!i.portsec.macs.includes(m)) i.portsec.macs.push(m.toLowerCase()); }), 'Allow only this MAC'),
    e('switchport port-security violation shutdown', (c) => eachIf(c, (i) => { i.portsec = { max: 1, macs: [], sticky: false, on: false, ...(i.portsec || {}), violation: 'shutdown' }; })),
    e('spanning-tree portfast', (c) => eachIf(c, (i) => { i.portfast = true; }), 'Skip the wait on a port for an end device'),
    e('no spanning-tree portfast', (c) => eachIf(c, (i) => { i.portfast = false; })),
    e('spanning-tree bpduguard enable', (c) => eachIf(c, (i) => { i.bpduguard = true; }), 'Shut this port if a switch appears on it'),
    e('no spanning-tree bpduguard', (c) => eachIf(c, (i) => { i.bpduguard = false; })),
  ]),
  ...need(routerLike, [
    e('ip helper-address <ip>', (c, [h]) => eachIf(c, (i) => { if (!i.helper.includes(h)) i.helper.push(h); }), 'Pass DHCP requests on to this server'),
    e('no ip helper-address <ip>', (c, [h]) => eachIf(c, (i) => { i.helper = i.helper.filter((x) => x !== h); })),
    e('ip access-group <word> in', (c, [a]) => eachIf(c, (i) => { i.aclIn = a; }), 'Filter what comes in here'),
    e('ip access-group <word> out', (c, [a]) => eachIf(c, (i) => { i.aclOut = a; }), 'Filter what goes out here'),
    e('no ip access-group <word> in', (c) => eachIf(c, (i) => { i.aclIn = null; })),
    e('no ip access-group <word> out', (c) => eachIf(c, (i) => { i.aclOut = null; })),
    e('ip ospf cost <n>', (c, [n]) => eachIf(c, (i) => { i.ospfCost = +n; }), 'Make this link more or less attractive'),
    e('no ip ospf cost', (c) => eachIf(c, (i) => { i.ospfCost = null; })),
    e('ip ospf hello-interval <n>', (c, [n]) => eachIf(c, (i) => { i.ospfHello = +n; })),
    e('no ip ospf hello-interval', (c) => eachIf(c, (i) => { i.ospfHello = 10; })),
    e('ipv6 address <ip6p>', (c, [p]) => {
      const a = parsePrefix6(p);
      return eachIf(c, (i) => {
        if (isSwitchKind(c.dev) && i.name.startsWith('Gi') && !i.routed) return '% This is a switch port. Give the address to a VLAN interface.';
        i.ip6 = i.ip6.filter((x) => x.addr !== a.addr);
        i.ip6.push(a);
        return '';
      });
    }, 'Give this interface an IPv6 address'),
    e('no ipv6 address', (c) => eachIf(c, (i) => { i.ip6 = []; })),
    e('ipv6 traffic-filter <word> in', (c, [a]) => eachIf(c, (i) => { i.v6In = a; }), 'Filter IPv6 coming in here'),
    e('ipv6 traffic-filter <word> out', (c, [a]) => eachIf(c, (i) => { i.v6Out = a; }), 'Filter IPv6 going out here'),
    e('no ipv6 traffic-filter <word> in', (c) => eachIf(c, (i) => { i.v6In = null; })),
    e('no ipv6 traffic-filter <word> out', (c) => eachIf(c, (i) => { i.v6Out = null; })),
  ]),
  ...need((d) => d.kind === 'ap', [
    e('channel <n>', (c, [n]) => eachIf(c, (i) => {
      if (!i.name.startsWith('Do')) return '% Channels are set on a radio: interface Dot11Radio0 or Dot11Radio1.';
      const ok = i.name === 'Do0' ? +n >= 1 && +n <= 13 : [36, 40, 44, 48, 149, 153, 157, 161].includes(+n);
      if (!ok) return i.name === 'Do0' ? '% The 2.4 GHz radio uses channels 1 to 13.' : '% The 5 GHz radio uses 36, 40, 44, 48, 149, 153, 157 or 161.';
      i.channel = +n;
      return '';
    }), 'Which channel this radio uses'),
    e('ssid <word>', (c, [n]) => eachIf(c, (i) => {
      if (!i.name.startsWith('Do')) return '% Networks go on a radio: interface Dot11Radio0 or Dot11Radio1.';
      if (!c.dev.ssidTable.has(n)) return `% There's no network called ${n}. Create it with dot11 ssid ${n}.`;
      if (!i.ssids.includes(n)) i.ssids = [...i.ssids, n];
      return '';
    }), 'Put a network on this radio'),
    e('no ssid <word>', (c, [n]) => eachIf(c, (i) => { i.ssids = i.ssids.filter((x) => x !== n); })),
  ]),
  ...need((d) => d.kind === 'router', [
    e('encapsulation dot1q <n>', (c, [v]) => eachIf(c, (i) => { if (!i.name.includes('.')) return '% Use a sub-interface, such as Gi0/0.10.'; i.dot1q = +v; i.nativeTag = false; return ''; }), 'Which VLAN this sub-interface carries'),
    e('encapsulation dot1q <n> native', (c, [v]) => eachIf(c, (i) => { if (!i.name.includes('.')) return '% Use a sub-interface, such as Gi0/0.10.'; i.dot1q = +v; i.nativeTag = true; return ''; })),
    e('ip nat inside', (c) => eachIf(c, (i) => { i.nat = 'inside'; }), 'This side has private addresses'),
    e('ip nat outside', (c) => eachIf(c, (i) => { i.nat = 'outside'; }), 'This side faces the internet'),
    e('no ip nat inside', (c) => eachIf(c, (i) => { i.nat = null; })),
    e('no ip nat outside', (c) => eachIf(c, (i) => { i.nat = null; })),
    e('tunnel source <word>', (c, [s]) => eachIf(c, (i) => { i.tunnelSrc = isIp(s) ? s : ifaceName(s); }), 'Where the tunnel starts'),
    e('tunnel destination <ip>', (c, [d]) => eachIf(c, (i) => { i.tunnelDst = d; }), 'The public address of the far end'),
    e('no tunnel source', (c) => eachIf(c, (i) => { i.tunnelSrc = null; })),
    e('no tunnel destination', (c) => eachIf(c, (i) => { i.tunnelDst = null; })),
    e('tunnel mode gre ip', () => ''),
    e('crypto map <word>', (c, [m]) => eachIf(c, (i) => { i.cryptoMap = m; }), 'Turn the VPN on for this interface'),
    e('no crypto map', (c) => eachIf(c, (i) => { i.cryptoMap = null; })),
  ]),
  ...need((d) => d.kind === 'firewall', [
    e('nameif <word>', (c, [n]) => eachIf(c, (i) => {
      i.nameif = n;
      i.level = n === 'inside' ? 100 : 0;
    }), 'Name this side, such as inside or outside'),
    e('no nameif', (c) => eachIf(c, (i) => { i.nameif = null; })),
    e('security-level <n>', (c, [n]) => eachIf(c, (i) => { i.level = Math.min(+n, 100); }), 'How much this side is trusted, 0 to 100'),
  ]),
];

const VLAN_MODE = [
  e('name <word>', (c, [n]) => { c.dev.vlans.set(c.dev.ctx.vlan, n); return ''; }, 'Give this VLAN a name'),
  e('no name', (c) => { c.dev.vlans.set(c.dev.ctx.vlan, `VLAN${String(c.dev.ctx.vlan).padStart(4, '0')}`); return ''; }),
];
const ROUTER_MODE = [
  e('network <ip> <wild> area <n>', (c, [ip, wild, area]) => {
    const o = c.dev.ospf;
    if (!o.networks.some((n) => n.ip === ip && n.wild === wild && n.area === +area)) o.networks.push({ ip, wild, area: +area });
    return '';
  }, 'Run OSPF on interfaces in this range'),
  e('no network <ip> <wild> area <n>', (c, [ip, wild]) => { c.dev.ospf.networks = c.dev.ospf.networks.filter((n) => !(n.ip === ip && n.wild === wild)); return ''; }),
  e('router-id <ip>', (c, [r]) => { c.dev.ospf.rid = r; return ''; }, 'Name this router in OSPF'),
  e('no router-id', (c) => { c.dev.ospf.rid = null; return ''; }),
  e('passive-interface <if>', (c, [i]) => { c.dev.ospf.passive.add(ifaceName(i)); return ''; }, 'Advertise this network but make no neighbours on it'),
  e('no passive-interface <if>', (c, [i]) => { c.dev.ospf.passive.delete(ifaceName(i)); return ''; }),
  e('default-information originate', (c) => { c.dev.ospf.defaultOriginate = true; return ''; }, 'Share this router\'s default route'),
  e('no default-information originate', (c) => { c.dev.ospf.defaultOriginate = false; return ''; }),
];
const DHCP_MODE = [
  e('network <ip> <mask>', (c, [ip, m]) => {
    const pool = c.dev.dhcp.pools.get(c.dev.ctx.pool);
    pool.len = maskToLen(m);
    pool.net = netOf(ip, pool.len);
    return '';
  }, 'Which addresses to hand out'),
  e('default-router <ip>', (c, [g]) => { c.dev.dhcp.pools.get(c.dev.ctx.pool).gw = g; return ''; }, 'The gateway clients should use'),
  e('dns-server <ip>', (c, [d]) => { c.dev.dhcp.pools.get(c.dev.ctx.pool).dns = d; return ''; }, 'The DNS server clients should use'),
  e('lease <n>', () => ''),
];
const ACL_MODE = [
  e('<n> <text>', (c, [seq, rest]) => {
    const acl = c.dev.acls.get(c.dev.ctx.acl);
    const parsed = parseEntry(tokenize(rest), acl.type, c.dev);
    if (!parsed) return `% That line isn't valid: ${rest}`;
    addEntry(acl, parsed, +seq);
    return '';
  }),
  e('permit <text>', (c, [rest]) => addAclLine(c, c.dev.ctx.acl, c.dev.acls.get(c.dev.ctx.acl).type, ['permit', ...tokenize(rest)])),
  e('deny <text>', (c, [rest]) => addAclLine(c, c.dev.ctx.acl, c.dev.acls.get(c.dev.ctx.acl).type, ['deny', ...tokenize(rest)])),
  e('no <n>', (c, [seq]) => { const acl = c.dev.acls.get(c.dev.ctx.acl); acl.entries = acl.entries.filter((x) => x.seq !== +seq); return ''; }),
];
const LINE_MODE = [
  e('transport input ssh', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.transport = 'ssh'; return ''; }, 'Allow only SSH'),
  e('transport input telnet', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.transport = 'telnet'; return ''; }),
  e('transport input all', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.transport = 'all'; return ''; }),
  e('transport input none', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.transport = 'none'; return ''; }),
  e('login local', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.login = 'local'; return ''; }, 'Check the local user list'),
  e('login', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.login = 'line'; return ''; }),
  e('no login', (c) => { if (c.dev.ctx.line === 'vty') c.dev.vty.login = null; return ''; }),
  e('password <word>', (c, [w]) => { if (c.dev.ctx.line === 'vty') c.dev.vty.password = w; return ''; }),
  e('access-class <word> in', (c, [a]) => { if (c.dev.ctx.line === 'vty') c.dev.vty.accessClass = a; return ''; }, 'Who may log in from where'),
  e('no access-class <word> in', (c) => { c.dev.vty.accessClass = null; return ''; }),
  e('exec-timeout <n> <n>', () => ''),
];
const ISAKMP_MODE = [
  e('encryption <word>', (c, [v]) => { c.dev.crypto.policies.get(c.dev.ctx.policy).encryption = v.toLowerCase(); return ''; }),
  e('encryption aes <n>', (c, [n]) => { c.dev.crypto.policies.get(c.dev.ctx.policy).encryption = `aes ${n}`; return ''; }, 'How to scramble the talks'),
  e('hash <word>', (c, [v]) => { c.dev.crypto.policies.get(c.dev.ctx.policy).hash = v.toLowerCase(); return ''; }),
  e('authentication pre-share', (c) => { c.dev.crypto.policies.get(c.dev.ctx.policy).auth = 'pre-share'; return ''; }),
  e('group <n>', (c, [n]) => { c.dev.crypto.policies.get(c.dev.ctx.policy).group = +n; return ''; }),
];
const entryOf = (c) => c.dev.crypto.maps.get(c.dev.ctx.map).get(c.dev.ctx.seq);
const CRYPTOMAP_MODE = [
  e('set peer <ip>', (c, [p]) => { entryOf(c).peer = p; return ''; }, 'The far end\'s public address'),
  e('set transform-set <word>', (c, [t]) => { entryOf(c).tset = t; return ''; }),
  e('match address <word>', (c, [a]) => { entryOf(c).acl = a; return ''; }, 'Which traffic goes in the tunnel'),
];
const ssidOf = (c) => c.dev.ssidTable.get(c.dev.ctx.ssid);
const SSID_MODE = [
  e('vlan <n>', (c, [v]) => {
    if (+v < 1 || +v > 4094) return '% VLAN IDs run from 1 to 4094.';
    ssidOf(c).vlan = +v;
    if (!c.dev.vlans.has(+v) && !c.dev.loading) c.dev.vlans.set(+v, `VLAN${String(v).padStart(4, '0')}`);
    return '';
  }, 'Which VLAN this network\'s traffic joins'),
  e('authentication open', (c) => { Object.assign(ssidOf(c), { auth: 'open', key: null }); return ''; }, 'Anyone can join, with nothing encrypted'),
  e('authentication wpa2 <word>', (c, [k]) => { Object.assign(ssidOf(c), { auth: 'wpa2', key: k }); return ''; }, 'One shared password'),
  e('authentication wpa3 <word>', (c, [k]) => { Object.assign(ssidOf(c), { auth: 'wpa3', key: k }); return ''; }, 'One shared password, with stronger protection'),
  e('authentication enterprise', (c) => { Object.assign(ssidOf(c), { auth: 'enterprise', key: null }); return ''; }, 'Each person logs in, checked by RADIUS'),
  e('client-isolation', (c) => { ssidOf(c).isolation = true; return ''; }, 'Clients can\'t reach each other'),
  e('no client-isolation', (c) => { ssidOf(c).isolation = false; return ''; }),
];
const OBJECT_MODE = [
  e('host <ip>', (c, [ip]) => { const o = c.dev.objects.get(c.dev.ctx.object); o.ip = ip; o.len = 32; return ''; }),
  e('subnet <ip> <mask>', (c, [ip, m]) => { const o = c.dev.objects.get(c.dev.ctx.object); o.len = maskToLen(m); o.ip = n2ip(netOf(ip, o.len)); return ''; }),
  e('nat <word> dynamic interface', (c, [pair]) => objectNat(c, pair, 'dynamic'), 'Share the outside address'),
  e('nat <word> static <ip>', (c, [pair, g]) => objectNat(c, pair, 'static', g), 'Publish on a fixed outside address'),
];
function objectNat(c, pair, kind, global = null) {
  const m = /^\((\S+),(\S+)\)$/.exec(pair);
  if (!m) return '% Write it like: nat (inside,outside) dynamic interface';
  const object = c.dev.ctx.object;
  c.dev.natRules = c.dev.natRules.filter((r) => r.object !== object);
  c.dev.natRules.push({ kind, object, from: m[1], to: m[2], global });
  return '';
}

/* ---------- show commands ---------- */
const pad = (s, n) => String(s).padEnd(n);
const liveIfaces = (dev) => sortIfaces([...dev.ifaces.values()].filter((i) => !i.wifi));

function showIpIntBrief(lab, net, dev) {
  const rows = liveIfaces(dev).map((i) => {
    const up = ifaceUp(net, dev, i.name);
    const status = i.shut ? 'administratively down' : net.errDisabled.has(`${dev.name}|${i.name}`) ? 'err-disabled' : up ? 'up' : 'down';
    return `${pad(longName(i.name), 24)}${pad(i.ip || 'unassigned', 16)}${pad(status, 22)}${up ? 'up' : 'down'}`;
  });
  return `${pad('Interface', 24)}${pad('IP-Address', 16)}${pad('Status', 22)}Protocol\n${rows.join('\n')}`;
}
function showVlanBrief(dev) {
  const rows = [...dev.vlans].sort((a, b) => a[0] - b[0]).map(([id, name]) => {
    const ports = liveIfaces(dev).filter((i) => i.name.startsWith('Gi') && !i.routed && i.swMode === 'access' && i.accessVlan === id).map((i) => i.name);
    return `${pad(id, 5)}${pad(name, 20)}${pad('active', 8)}${ports.join(', ')}`;
  });
  return `${pad('VLAN', 5)}${pad('Name', 20)}${pad('Status', 8)}Ports\n${rows.join('\n')}`;
}
function showTrunk(net, dev) {
  const rows = liveIfaces(dev).filter((i) => i.swMode === 'trunk' && !i.routed).map((i) => `${pad(i.name, 10)}${pad(i.native, 8)}${pad(i.allowed ? vlanText(i.allowed) : '1-4094', 22)}${net.blocked.has(`${dev.name}|${i.name}`) ? 'blocked by STP' : 'forwarding'}`);
  return rows.length ? `${pad('Port', 10)}${pad('Native', 8)}${pad('Allowed', 22)}State\n${rows.join('\n')}` : 'No trunks on this switch.';
}
function showMac(lab, dev) {
  const rows = [...(lab.runtime.macs.get(dev.name)?.values() || [])].sort((a, b) => a.vlan - b.vlan || (a.port < b.port ? -1 : 1)).map((m) => `${pad(m.vlan, 6)}${pad(m.mac, 18)}${pad('DYNAMIC', 10)}${m.port}`);
  return `${pad('Vlan', 6)}${pad('Mac Address', 18)}${pad('Type', 10)}Ports\n${rows.join('\n') || '(empty: nothing has sent a frame yet)'}`;
}
const CODES = 'Codes: C connected, S static, O OSPF, IA inter-area, E2 external, * default';
function showIpRoute(net, dev) {
  const rows = (net.tables.get(dev.name) || []).map((r) => {
    if (r.type === 'C') return `C     ${n2ip(r.net)}/${r.len} is directly connected, ${r.iface}`;
    const via = r.via ? `via ${r.via}` : 'is directly connected';
    return `${pad(r.type, 6)}${n2ip(r.net)}/${r.len} [${r.ad}/${r.metric}] ${via}, ${r.iface}`;
  });
  return `${CODES}\n\n${rows.join('\n') || '(no routes)'}`;
}
function showAcls(dev) {
  const parts = [...dev.acls.values()].map((a) => {
    const head = a.type === 'ipv6' ? `IPv6 access list ${a.name}` : `${a.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${a.name}`;
    const lines = a.entries.map((x) => `    ${x.seq} ${x.text}${x.hits ? ` (${x.hits} matches)` : ''}`);
    return [head, ...lines].join('\n');
  });
  return parts.join('\n') || '(no access lists)';
}
function showNat(lab, dev) {
  const stat = dev.natRules.filter((r) => r.kind === 'static').map((r) => `${pad(r.proto || '---', 6)}${pad(r.global + (r.gport ? `:${r.gport}` : ''), 24)}${pad(r.local + (r.lport ? `:${r.lport}` : ''), 24)}---`);
  const dyn = (lab.runtime.nat.get(dev.name) || []).map((t) => `${pad(t.proto, 6)}${pad(`${t.globalIp}:${t.globalPort}`, 24)}${pad(`${t.insideIp}:${t.insidePort}`, 24)}${t.outsideIp}:${t.outsidePort}`);
  return `${pad('Pro', 6)}${pad('Inside global', 24)}${pad('Inside local', 24)}Outside global\n${[...stat, ...dyn].join('\n') || '(no translations yet)'}`;
}
function showDhcp(net, dev) {
  const leases = net.leases.get(dev.name);
  if (!leases?.size) return 'No addresses handed out yet.';
  return `${pad('IP address', 18)}Client\n${[...leases].map(([ip, name]) => `${pad(ip, 18)}${name}`).join('\n')}`;
}
function showOspfNeighbor(net, dev) {
  if (!dev.ospf) return '% OSPF is not running here.';
  const list = net.ospfNeighbors.get(dev.name) || [];
  const rows = list.map((n) => `${pad(n.rid, 16)}${pad('FULL', 10)}${pad(n.ip, 16)}${n.iface}`);
  const why = [...net.ospfWhy].filter(([k]) => k.startsWith(`${dev.name}|`)).map(([, t]) => `Not forming: ${t}`);
  return [`${pad('Neighbor ID', 16)}${pad('State', 10)}${pad('Address', 16)}Interface`, ...rows, ...why].join('\n');
}
function showOspfInterfaces(net, dev) {
  if (!dev.ospf) return '% OSPF is not running here.';
  const rows = liveIfaces(dev).filter((i) => i.ip).map((i) => {
    const st = dev.ospf.networks.find((n) => { const len = wildToLen(n.wild); return len === null ? false : inNet(i.ip, n.ip, len); });
    if (!st) return null;
    return `${pad(i.name, 10)}${pad(`area ${st.area}`, 10)}${pad(`${i.ip}/${i.len}`, 20)}${pad(`cost ${i.ospfCost ?? 1}`, 10)}${dev.ospf.passive.has(i.name) ? 'passive' : 'active'}`;
  }).filter(Boolean);
  return rows.join('\n') || 'No interfaces match your network lines.';
}
function showStp(net, dev) {
  const rows = liveIfaces(dev).filter((i) => i.name.startsWith('Gi') && !i.routed && ifaceUp(net, dev, i.name)).map((i) => `${pad(i.name, 10)}${net.blocked.has(`${dev.name}|${i.name}`) ? 'BLK' : 'FWD'}`);
  const root = net.stpRoot?.name;
  return `Root bridge: ${root === dev.name ? 'this switch' : root}\nThis switch's priority: ${dev.stp.priority}\n\n${pad('Port', 10)}State\n${rows.join('\n')}`;
}
function showPortSec(net, dev) {
  const rows = liveIfaces(dev).filter((i) => i.portsec?.on).map((i) => `${pad(i.name, 10)}${pad(`max ${i.portsec.max}`, 8)}${pad(i.portsec.sticky ? 'sticky' : i.portsec.macs.join(',') || 'any', 18)}${net.errDisabled.has(`${dev.name}|${i.name}`) ? 'SecureShutdown' : 'SecureUp'}`);
  return rows.join('\n') || 'No ports have port security on.';
}
function showIsakmp(net, dev) {
  const rows = [...net.ipsec.values()].filter((s) => s.dev === dev.name).map((s) => `${pad(s.peer, 18)}${pad(s.local, 18)}${s.up ? 'QM_IDLE' : 'MM_NO_STATE'}${s.up ? '' : `\n  Why: ${s.why}`}`);
  return `${pad('dst', 18)}${pad('src', 18)}state\n${rows.join('\n') || '(no peers)'}`;
}
function showIpsec(net, dev) {
  const rows = [...net.ipsec.values()].filter((s) => s.dev === dev.name).map((s) => `peer ${s.peer}: ${s.up ? 'ACTIVE' : 'no SA'}`);
  return rows.join('\n') || '(no IPsec peers)';
}
function showConn(lab, dev) {
  const conns = lab.runtime.conns.get(dev.name);
  if (!conns?.size) return '0 in use';
  return `${conns.size} in use\n${[...conns.values()].map((c) => `${c.proto.toUpperCase()} ${c.from} -> ${c.to}`).join('\n')}`;
}
function showArp(lab, dev) {
  const rows = [...(lab.runtime.arp.get(dev.name) || [])].filter(([ip]) => !ip.includes(':'));
  return rows.length ? rows.map(([ip, a]) => `Internet  ${pad(ip, 16)}${pad(a.mac, 18)}${a.iface}`).join('\n') : '(nothing learned yet)';
}
function showV6Brief(net, dev) {
  const rows = liveIfaces(dev).filter((i) => i.ip6.length).map((i) => `${longName(i.name)} [${ifaceUp(net, dev, i.name) ? 'up' : 'down'}]\n${i.ip6.map((a) => `    ${a.addr}/${a.len}`).join('\n')}`);
  return rows.join('\n') || 'No interface has an IPv6 address.';
}
function showV6Route(net, dev) {
  const rows = (net.tables6.get(dev.name) || []).map((r) => `${pad(r.type, 4)}${r.prefix}/${r.len} ${r.via ? `via ${r.via}` : 'directly connected'}, ${r.iface}`);
  return `Codes: C connected, S static\n\n${rows.join('\n') || '(no IPv6 routes)'}`;
}
function showV6Neighbors(lab, dev) {
  const rows = [...(lab.runtime.arp.get(dev.name) || [])].filter(([ip]) => ip.includes(':'));
  return rows.length ? rows.map(([ip, a]) => `${pad(ip, 32)}${pad(a.mac, 18)}${a.iface}`).join('\n') : '(nothing learned yet)';
}
function showDot11Assoc(net, dev) {
  const rows = [...net.air.assoc].filter(([, a]) => a.ap === dev.name).map(([host, a]) => `${pad(host, 16)}${pad(a.ssid, 16)}${pad(`ch ${a.channel}`, 8)}${a.signal} dBm`);
  return `${pad('Client', 16)}${pad('SSID', 16)}${pad('Channel', 8)}Signal\n${rows.join('\n') || '(nobody is connected)'}`;
}
function showDot11Neighbors(lab, net, dev) {
  const rows = [];
  for (const ap of lab.devices.values()) {
    if (ap.kind !== 'ap' || ap === dev || Math.hypot(ap.x - dev.x, ap.y - dev.y) > 70) continue;
    for (const radio of [ap.ifaces.get('Do0'), ap.ifaces.get('Do1')]) {
      if (radio.shut || radio.channel === null) continue;
      for (const name of radio.ssids) {
        const known = ap.ssidTable.get(name);
        if (known) rows.push(`${pad(macOf(ap.name), 18)}${pad(name, 16)}${pad(radio.channel, 8)}${known.auth}`);
      }
    }
  }
  const clashes = net.air.overlaps.filter((o) => o.a === dev.name || o.b === dev.name).map((o) => `Interference: ${o.a} on channel ${o.channels[0]} and ${o.b} on channel ${o.channels[1]} overlap`);
  return [`${pad('BSSID', 18)}${pad('SSID', 16)}${pad('Channel', 8)}Security`, ...(rows.length ? rows : ['(no other access points heard)']), ...clashes].join('\n');
}
function showDot11Radio(dev) {
  return ['Do0', 'Do1'].map((n) => {
    const r = dev.ifaces.get(n);
    return `${longName(n)} ${n === 'Do0' ? '2.4 GHz' : '5 GHz'}: ${r.shut ? 'off' : 'on'}, channel ${r.channel ?? 'unset'}, networks ${r.ssids.join(', ') || 'none'}`;
  }).join('\n');
}
function showInterfaces(net, dev) {
  return liveIfaces(dev).map((i) => {
    const up = ifaceUp(net, dev, i.name);
    const lines = [`${longName(i.name)} is ${i.shut ? 'administratively down' : up ? 'up' : 'down'}, line protocol is ${up ? 'up' : 'down'}`];
    if (i.desc) lines.push(`  Description: ${i.desc}`);
    if (i.ip) lines.push(`  Internet address is ${i.ip}/${i.len}`);
    lines.push(`  Hardware address is ${i.mac}`);
    return lines.join('\n');
  }).join('\n');
}

/* ---------- pinging from a device ---------- */
function ping(lab, dev, dst0) {
  const dst = dst0;
  const r = probe(lab, lab.net(), dev, dst, 'icmp');
  lab.setTrace(r);
  return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${dst}:\n${r.ok ? '!!!!!' : '.....'}\nSuccess rate is ${r.ok ? '100 percent (5/5)' : '0 percent (0/5)'}${r.ok ? '' : `\nWhy: ${r.why}`}`;
}
function traceroute(lab, dev, dst) {
  const r = probe(lab, lab.net(), dev, dst, 'icmp');
  lab.setTrace(r);
  const hops = r.there.filter((h) => h.action === 'route' || h.action === 'deliver');
  const lines = hops.map((h, i) => `  ${i + 1} ${h.dev} (${h.ip || dst})`);
  if (!r.ok) lines.push(`  ${hops.length + 1} * * *`, `Why: ${r.why}`);
  return `Tracing the route to ${dst}\n${lines.join('\n')}`;
}

const SHOW = [
  e('show running-config', (c) => running(c.dev), 'What the device is doing now'),
  e('show startup-config', (c) => c.lab.startupOf(c.dev.name) || 'startup-config is not present', 'What it will do after a reload'),
  e('show version', (c) => `${c.dev.hostname} uptime is 1 week\nSimulated by NetLab`),
  e('show interfaces', (c) => showInterfaces(c.lab.net(), c.dev), 'Every interface, in detail'),
  e('show ip interface brief', (c) => showIpIntBrief(c.lab, c.lab.net(), c.dev), 'A table of interfaces and addresses'),
  e('show ip route', (c) => showIpRoute(c.lab.net(), c.dev), 'The routing table'),
  e('show ip arp', (c) => showArp(c.lab, c.dev), 'What ARP has learned'),
  e('show access-lists', (c) => showAcls(c.dev), 'Access lists and how often each line matched'),
];
const SHOW_L3 = need(routerLike, [
  e('show ip nat translations', (c) => showNat(c.lab, c.dev), 'Who is being translated to what'),
  e('show ip dhcp binding', (c) => showDhcp(c.lab.net(), c.dev), 'Addresses handed out'),
  e('show ip ospf neighbor', (c) => showOspfNeighbor(c.lab.net(), c.dev), 'OSPF neighbours, and why some are missing'),
  e('show ip ospf interface', (c) => showOspfInterfaces(c.lab.net(), c.dev), 'Interfaces in OSPF'),
  e('show crypto isakmp sa', (c) => showIsakmp(c.lab.net(), c.dev), 'VPN phase 1'),
  e('show crypto ipsec sa', (c) => showIpsec(c.lab.net(), c.dev), 'VPN phase 2'),
  e('show interfaces tunnel', (c) => showInterfaces(c.lab.net(), c.dev)),
]);
const SHOW_V6 = need(routerLike, [
  e('show ipv6 interface brief', (c) => showV6Brief(c.lab.net(), c.dev), 'Interfaces and their IPv6 addresses'),
  e('show ipv6 route', (c) => showV6Route(c.lab.net(), c.dev), 'The IPv6 routing table'),
  e('show ipv6 neighbors', (c) => showV6Neighbors(c.lab, c.dev), 'What neighbour discovery has learned'),
]);
const SHOW_AP = need((d) => d.kind === 'ap', [
  e('show dot11 associations', (c) => showDot11Assoc(c.lab.net(), c.dev), 'Who is connected'),
  e('show dot11 neighbors', (c) => showDot11Neighbors(c.lab, c.lab.net(), c.dev), 'Other access points heard, including ones you don\'t own'),
  e('show dot11 radio', (c) => showDot11Radio(c.dev), 'Your radios'),
]);
const SHOW_SW = need(isSwitchKind, [
  e('show vlan brief', (c) => showVlanBrief(c.dev), 'VLANs and their ports'),
  e('show interfaces trunk', (c) => showTrunk(c.lab.net(), c.dev), 'Trunks and what they allow'),
  e('show mac address-table', (c) => { c.lab.net(); return showMac(c.lab, c.dev); }, 'Which MAC is on which port'),
  e('show spanning-tree', (c) => showStp(c.lab.net(), c.dev), 'The root bridge and blocked ports'),
  e('show port-security', (c) => showPortSec(c.lab.net(), c.dev), 'Secured ports and their state'),
]);
const SHOW_FW = need((d) => d.kind === 'firewall', [
  e('show conn', (c) => showConn(c.lab, c.dev), 'The state table'),
  e('show nameif', (c) => liveIfaces(c.dev).filter((i) => i.nameif).map((i) => `${pad(i.name, 10)}${pad(i.nameif, 14)}${i.level}`).join('\n') || '(no names yet)', 'Names and security levels'),
  e('show nat', (c) => showNat(c.lab, c.dev), 'Translations'),
]);
const ALL_SHOW = [...SHOW, ...SHOW_L3, ...SHOW_V6, ...SHOW_AP, ...SHOW_SW, ...SHOW_FW];

const USER = [
  e('enable', (c) => {
    if (c.dev.secret || c.dev.enablePassword) {
      c.dev.pending = 'enable';
      return 'Password:';
    }
    c.dev.mode = 'priv';
    return '';
  }, 'Go to privileged mode'),
  e('ping <anyip>', (c, [d]) => ping(c.lab, c.dev, d), 'Can this device reach that address?'),
  ...ALL_SHOW.filter((x) => /show (version|ip interface brief)/.test(x.pattern)),
];
const PRIV = [
  e('disable', (c) => { c.dev.mode = 'user'; return ''; }),
  e('configure terminal', (c) => { c.dev.mode = 'config'; c.dev.ctx = {}; return 'Enter configuration commands, one per line. End with end.'; }, 'Start changing the config'),
  e('copy running-config startup-config', (c) => { c.lab.save(c.dev.name); return '[OK]'; }, 'Save the config so it survives a reload'),
  e('write memory', (c) => { c.lab.save(c.dev.name); return '[OK]'; }, 'Save the config, the short way'),
  e('erase startup-config', (c) => { c.lab.eraseStartup(c.dev.name); return '[OK]'; }),
  e('reload', (c) => { c.lab.reload(c.dev.name); return 'Reloading... back up, from startup-config.'; }, 'Restart from the saved config'),
  e('ping <anyip>', (c, [d]) => ping(c.lab, c.dev, d), 'Can this device reach that address?'),
  e('traceroute <anyip>', (c, [d]) => traceroute(c.lab, c.dev, d), 'Which way does it go?'),
  e('clear ip nat translation *', (c) => { c.lab.runtime.nat.delete(c.dev.name); return ''; }),
  e('clear conn', (c) => { c.lab.runtime.conns.delete(c.dev.name); return ''; }),
  ...ALL_SHOW,
];
const MODE_TABLES = { ssid: SSID_MODE, user: USER, priv: PRIV, config: CONFIG, if: IFACE, vlan: VLAN_MODE, router: ROUTER_MODE, dhcp: DHCP_MODE, acl: ACL_MODE, line: LINE_MODE, isakmp: ISAKMP_MODE, cryptomap: CRYPTOMAP_MODE, object: OBJECT_MODE };
const PARENT = { ssid: 'config', if: 'config', vlan: 'config', router: 'config', dhcp: 'config', acl: 'config', line: 'config', isakmp: 'config', cryptomap: 'config', object: 'config', config: 'priv', priv: 'user' };
const SUFFIX = { ssid: '(ssid-config)#', user: '>', priv: '#', config: '(config)#', if: '(config-if)#', vlan: '(config-vlan)#', router: '(config-router)#', dhcp: '(dhcp-config)#', acl: '(config-ext-nacl)#', line: '(config-line)#', isakmp: '(config-isakmp)#', cryptomap: '(config-crypto-map)#', object: '(config-network-object)#' };

const tableFor = (dev, mode) => (MODE_TABLES[mode] || []).filter((x) => !x.when || x.when(dev));
const subifSuffix = (dev) => (dev.mode === 'if' && dev.ctx.ifaces?.length === 1 && dev.ctx.ifaces[0].includes('.') ? '(config-subif)#' : SUFFIX[dev.mode]);
export const prompt = (dev) => `${dev.hostname}${subifSuffix(dev)}`;

const invalid = (line, at) => `${' '.repeat(at + 1)}^\n% Invalid input detected at '^' marker.\n% Type ? to see what fits here.`;
const inConfig = (mode) => mode !== 'user' && mode !== 'priv';

export function iosRun(lab, dev, rawLine) {
  const line = rawLine.trim();
  if (dev.pending === 'enable') {
    dev.pending = null;
    const ok = (dev.secret && hash(line) === dev.secret) || (dev.enablePassword && line === dev.enablePassword);
    if (ok) dev.mode = 'priv';
    return ok ? '' : '% Access denied';
  }
  if (!line || line.startsWith('!')) return '';
  if (/\?$/.test(line)) return iosHelp(dev, line.slice(0, -1));
  if (/^help$/i.test(line)) return `Here's what fits here. Type part of a command and add ? to see what comes next.\n${iosHelp(dev, '')}`;
  if (/^exit$/i.test(line) || /^quit$/i.test(line)) {
    dev.mode = PARENT[dev.mode] && dev.mode !== 'priv' ? PARENT[dev.mode] : 'user';
    return '';
  }
  if (/^end$/i.test(line)) {
    if (inConfig(dev.mode)) dev.mode = 'priv';
    return '';
  }
  if (inConfig(dev.mode) && /^do\s+/i.test(line)) {
    const was = dev.mode;
    const ctx = dev.ctx;
    dev.mode = 'priv';
    const out = iosRun(lab, dev, line.replace(/^do\s+/i, ''));
    dev.mode = was;
    dev.ctx = ctx;
    return out;
  }
  let result = match(tableFor(dev, dev.mode), line);
  // Like the real thing, a global command typed in a sub-mode just works and leaves the sub-mode.
  if (result.error && inConfig(dev.mode) && dev.mode !== 'config') {
    const global = match(tableFor(dev, 'config'), line);
    if (global.hit) {
      dev.mode = 'config';
      result = global;
    }
  }
  if (result.error === 'invalid') return invalid(line, result.at + prompt(dev).length);
  if (result.error === 'ambiguous') return `% Ambiguous command: "${result.word}"`;
  if (result.error === 'incomplete') return '% Incomplete command.';
  const out = result.hit.run({ lab, dev }, result.args);
  if (inConfig(dev.mode) || /reload|copy|write|erase/.test(line)) lab.touch();
  return out || '';
}

export function iosHelp(dev, partial) {
  const { words } = nextWords(tableFor(dev, dev.mode), partial);
  const helpFor = (w) => tableFor(dev, dev.mode).find((x) => x.parts.includes(w))?.help || '';
  if (!words.length) return `% Unrecognized command\n${inConfig(dev.mode) ? 'Type exit to go back a level.' : ''}`;
  return words.map((w) => `  ${pad(w, 28)}${helpFor(w)}`).join('\n');
}

/** Tab: the rest of the word if only one word fits, or as far as all the choices agree. */
export function iosComplete(dev, partial) {
  const { words, partial: part } = nextWords(tableFor(dev, dev.mode), partial);
  const literal = words.filter((w) => !w.startsWith('<'));
  if (!literal.length || !part) return null;
  let common = literal[0];
  for (const w of literal) while (!w.startsWith(common)) common = common.slice(0, -1);
  if (common.length <= part.length) return null;
  return partial.slice(0, partial.length - part.length) + common + (literal.length === 1 ? ' ' : '');
}

/* ---------- the running config ---------- */
function ifaceLines(dev, i) {
  const lines = [];
  if (i.desc) lines.push(` description ${i.desc}`);
  if (i.dot1q !== null) lines.push(` encapsulation dot1q ${i.dot1q}${i.nativeTag ? ' native' : ''}`);
  if (isSwitchKind(dev) && i.name.startsWith('Gi')) {
    if (i.routed) lines.push(' no switchport');
    else {
      if (i.swMode === 'trunk') lines.push(' switchport mode trunk');
      else if (i.accessVlan !== 1) lines.push(` switchport access vlan ${i.accessVlan}`);
      if (i.swMode === 'access' && (i.accessVlan !== 1)) lines.splice(lines.length - 1, 0, ' switchport mode access');
      if (i.native !== 1) lines.push(` switchport trunk native vlan ${i.native}`);
      if (i.allowed) lines.push(` switchport trunk allowed vlan ${i.allowed.size ? vlanText(i.allowed) : 'none'}`);
      if (i.portsec) {
        if (i.portsec.on) lines.push(' switchport port-security');
        lines.push(` switchport port-security maximum ${i.portsec.max}`);
        if (i.portsec.sticky) lines.push(' switchport port-security mac-address sticky');
        for (const m of i.portsec.macs) lines.push(` switchport port-security mac-address ${m}`);
        lines.push(` switchport port-security violation ${i.portsec.violation}`);
      }
      if (i.portfast) lines.push(' spanning-tree portfast');
      if (i.bpduguard) lines.push(' spanning-tree bpduguard enable');
    }
  }
  if (dev.kind === 'firewall') {
    if (i.nameif) lines.push(` nameif ${i.nameif}`, ` security-level ${i.level}`);
  }
  if (i.ip) lines.push(` ip address ${i.ip} ${lenToMask(i.len)}`);
  for (const h of i.helper) lines.push(` ip helper-address ${h}`);
  if (i.aclIn) lines.push(` ip access-group ${i.aclIn} in`);
  if (i.aclOut) lines.push(` ip access-group ${i.aclOut} out`);
  if (i.nat) lines.push(` ip nat ${i.nat}`);
  for (const a of i.ip6) if (!a.auto) lines.push(` ipv6 address ${a.addr}/${a.len}`);
  if (i.v6In) lines.push(` ipv6 traffic-filter ${i.v6In} in`);
  if (i.v6Out) lines.push(` ipv6 traffic-filter ${i.v6Out} out`);
  if (i.channel !== null) lines.push(` channel ${i.channel}`);
  for (const name of i.ssids) lines.push(` ssid ${name}`);
  if (i.ospfCost !== null) lines.push(` ip ospf cost ${i.ospfCost}`);
  if (i.ospfHello !== 10) lines.push(` ip ospf hello-interval ${i.ospfHello}`);
  if (i.tunnelSrc) lines.push(` tunnel source ${i.tunnelSrc}`);
  if (i.tunnelDst) lines.push(` tunnel destination ${i.tunnelDst}`);
  if (i.cryptoMap) lines.push(` crypto map ${i.cryptoMap}`);
  // Routers start with ports off and switches with them on, so each only records the exception.
  const defaultShut = i.name.startsWith('Do') || (!isSwitchKind(dev) && i.name.startsWith('Gi') && !i.name.includes('.'));
  if (i.shut && !defaultShut) lines.push(' shutdown');
  if (!i.shut && defaultShut) lines.push(' no shutdown');
  return lines;
}

export function running(dev) {
  const o = [`hostname ${dev.hostname}`];
  if (dev.secret) o.push(`enable secret 5 ${dev.secret}`);
  if (dev.enablePassword) o.push(`enable password ${dev.enablePassword}`);
  if (dev.passwordEnc) o.push('service password-encryption');
  if (dev.banner) o.push(`banner motd ${dev.banner}`);
  if (dev.domain) o.push(`ip domain-name ${dev.domain}`);
  if (dev.rsa) o.push('crypto key generate rsa modulus 2048');
  if (dev.sshV2) o.push('ip ssh version 2');
  if (dev.httpServer) o.push('ip http server');
  for (const [u, x] of dev.users) o.push(`username ${u} secret 5 ${x.secret}`);
  if (dev.kind === 'l3switch' && dev.ipRouting) o.push('ip routing');
  if (dev.v6Routing) o.push('ipv6 unicast-routing');
  for (const [id, name] of [...dev.vlans].sort((a, b) => a[0] - b[0])) {
    if (id === 1) continue;
    o.push(`vlan ${id}`, ` name ${name}`);
  }
  for (const x of dev.ssidTable.values()) {
    o.push(`dot11 ssid ${x.name}`);
    if (x.vlan !== 1) o.push(` vlan ${x.vlan}`);
    if (x.auth === 'enterprise') o.push(' authentication enterprise');
    else if (x.auth !== 'open') o.push(` authentication ${x.auth} ${x.key}`);
    if (x.isolation) o.push(' client-isolation');
  }
  if (dev.radius) o.push(`radius-server host ${dev.radius.host} key ${dev.radius.key}`);
  if (isSwitchKind(dev) && dev.stp.primary) o.push('spanning-tree vlan 1 root primary');
  else if (isSwitchKind(dev) && dev.stp.priority !== 32768) o.push(`spanning-tree vlan 1 priority ${dev.stp.priority}`);
  for (const p of dev.crypto.policies.keys()) {
    const x = dev.crypto.policies.get(p);
    o.push(`crypto isakmp policy ${p}`, ` encryption ${x.encryption}`, ` hash ${x.hash}`, ...(x.auth === 'pre-share' ? [' authentication pre-share'] : []), ` group ${x.group}`);
  }
  for (const [peer, key] of dev.crypto.keys) o.push(`crypto isakmp key ${key} address ${peer}`);
  for (const [name, t] of dev.crypto.tsets) o.push(`crypto ipsec transform-set ${name} ${t}`);
  for (const [name, map] of dev.crypto.maps) {
    for (const x of map.values()) {
      o.push(`crypto map ${name} ${x.seq} ipsec-isakmp`);
      if (x.peer) o.push(` set peer ${x.peer}`);
      if (x.tset) o.push(` set transform-set ${x.tset}`);
      if (x.acl) o.push(` match address ${x.acl}`);
    }
  }
  for (const i of liveIfaces(dev)) {
    const lines = ifaceLines(dev, i);
    if (lines.length || i.name.startsWith('Lo') || i.name.startsWith('Tu') || i.name.startsWith('Vl') || i.name.includes('.')) o.push(`interface ${i.name}`, ...lines);
  }
  for (const [, obj] of dev.objects) {
    o.push(`object network ${obj.name}`);
    if (obj.ip) o.push(obj.len === 32 ? ` host ${obj.ip}` : ` subnet ${obj.ip} ${lenToMask(obj.len)}`);
    const rule = dev.natRules.find((r) => r.object === obj.name);
    if (rule) o.push(rule.kind === 'static' ? ` nat (${rule.from},${rule.to}) static ${rule.global}` : ` nat (${rule.from},${rule.to}) dynamic interface`);
  }
  for (const a of dev.acls.values()) {
    if (dev.kind === 'firewall') for (const x of a.entries) o.push(`access-list ${a.name} extended ${x.text}`);
    else if (a.type === 'ipv6') {
      o.push(`ipv6 access-list ${a.name}`);
      for (const x of a.entries) o.push(` ${x.seq} ${x.text}`);
    } else if (a.named) {
      o.push(`ip access-list ${a.type} ${a.name}`);
      for (const x of a.entries) o.push(` ${x.seq} ${x.text}`);
    } else for (const x of a.entries) o.push(`access-list ${a.name} ${x.text}`);
  }
  for (const [iface, acl] of dev.accessGroups) o.push(`access-group ${acl} in interface ${iface}`);
  if (dev.dhcp.excluded.length) for (const [a, b] of dev.dhcp.excluded) o.push(a === b ? `ip dhcp excluded-address ${a}` : `ip dhcp excluded-address ${a} ${b}`);
  for (const pool of dev.dhcp.pools.values()) {
    o.push(`ip dhcp pool ${pool.name}`);
    if (pool.net !== null) o.push(` network ${n2ip(pool.net)} ${lenToMask(pool.len)}`);
    if (pool.gw) o.push(` default-router ${pool.gw}`);
    if (pool.dns) o.push(` dns-server ${pool.dns}`);
  }
  for (const r of dev.natRules) {
    if (dev.kind === 'firewall') continue;
    if (r.kind === 'dynamic') o.push(`ip nat inside source list ${r.acl} interface ${r.iface} overload`);
    else if (r.proto) o.push(`ip nat inside source static ${r.proto} ${r.local} ${r.lport} ${r.global} ${r.gport}`);
    else o.push(`ip nat inside source static ${r.local} ${r.global}`);
  }
  for (const r of dev.routes) {
    if (dev.kind === 'firewall') {
      o.push(`route outside ${n2ip(r.net)} ${lenToMask(r.len)} ${r.via}`);
      continue;
    }
    o.push(`ip route ${n2ip(r.net)} ${lenToMask(r.len)} ${r.via || r.iface}${r.ad !== 1 ? ` ${r.ad}` : ''}`);
  }
  for (const r of dev.routes6) o.push(`ipv6 route ${r.prefix}/${r.len} ${r.via}`);
  if (dev.defaultGw) o.push(`ip default-gateway ${dev.defaultGw}`);
  if (dev.ospf) {
    o.push(`router ospf ${dev.ospf.pid}`);
    if (dev.ospf.rid) o.push(` router-id ${dev.ospf.rid}`);
    for (const n of dev.ospf.networks) o.push(` network ${n.ip} ${n.wild} area ${n.area}`);
    for (const p of dev.ospf.passive) o.push(` passive-interface ${p}`);
    if (dev.ospf.defaultOriginate) o.push(' default-information originate');
  }
  for (const s of dev.ntp) o.push(`ntp server ${s}`);
  for (const s of dev.logging) o.push(`logging host ${s}`);
  for (const s of dev.snmp) o.push(`snmp-server community ${s.name} ${s.mode}`);
  if (dev.kind !== 'firewall' && (dev.vty.transport || dev.vty.login || dev.vty.accessClass)) {
    o.push('line vty 0 15');
    if (dev.vty.login) o.push(dev.vty.login === 'local' ? ' login local' : ' login');
    if (dev.vty.transport) o.push(` transport input ${dev.vty.transport}`);
    if (dev.vty.accessClass) o.push(` access-class ${dev.vty.accessClass} in`);
  }
  return o.join('\n');
}

/* A few config lines, applied on top of what's there. It's how a fault gets in. */
export function iosApply(lab, dev, lines) {
  const [mode, ctx] = [dev.mode, dev.ctx];
  dev.mode = 'config';
  dev.ctx = {};
  for (const line of lines) {
    let result = match(tableFor(dev, dev.mode), line);
    if (result.error) result = match(tableFor(dev, 'config'), line);
    if (result.hit) result.hit.run({ lab, dev }, result.args);
  }
  dev.mode = mode;
  dev.ctx = ctx;
  lab.touch();
}

/* Loads a saved config. Lines that don't parse are skipped, so a bad config can't do anything but fail its goals. */
export function iosLoad(lab, dev, text) {
  const lines = String(text).split('\n').slice(0, 3000);
  dev.mode = 'config';
  dev.ctx = {};
  dev.loading = true;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('!')) continue;
    const nested = raw.startsWith(' ');
    const line = raw.trim();
    if (!nested && dev.mode !== 'config') dev.mode = 'config';
    let result = match(tableFor(dev, dev.mode), line);
    if (result.error) result = match(tableFor(dev, 'config'), line);
    if (result.hit) result.hit.run({ lab, dev }, result.args);
  }
  dev.loading = false;
  dev.mode = 'user';
  dev.ctx = {};
}

export { domainOf, lenToWild, isIp6 };
