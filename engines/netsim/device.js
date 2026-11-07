/* What a device is: its ports and its configuration. Nothing here knows about packets. */
import { macOf } from './addr.js';

const PORT_COUNT = { router: 4, firewall: 4, switch: 24, l3switch: 24, ap: 1 };
export const isHost = (d) => d.kind === 'pc' || d.kind === 'server' || d.kind === 'laptop';
/* An access point forwards like a switch, so it shares all that code. It just isn't part of the spanning tree. */
export const isSwitchKind = (d) => d.kind === 'switch' || d.kind === 'l3switch' || d.kind === 'ap';
export const isBridge = (d) => d.kind === 'switch' || d.kind === 'l3switch';
export const hostPort = (d) => (d.kind === 'laptop' ? 'wlan0' : 'eth0');

export function newIface(dev, name) {
  const up = isHost(dev) || isSwitchKind(dev);
  const virtual = /^(Lo|Tu|Vl|Ws)/.test(name) || name.includes('.');
  return {
    name, desc: '', shut: virtual ? false : !up, ip: null, len: null, mac: macOf(dev.name, name),
    // switching, for ports on a switch that haven't been made routed
    routed: !isSwitchKind(dev), swMode: 'access', accessVlan: 1, allowed: null, native: 1,
    portsec: null, portfast: false, bpduguard: false,
    dot1q: null, nativeTag: false, helper: [], aclIn: null, aclOut: null, nat: null,
    ospfCost: null, ospfHello: 10, tunnelSrc: null, tunnelDst: null, cryptoMap: null, nameif: null, level: 0,
    ip6: [], v6In: null, v6Out: null, channel: null, ssids: [], isolated: false,
  };
}

export function newDevice(spec) {
  const dev = {
    name: spec.name, kind: spec.kind, x: spec.x ?? 0, y: spec.y ?? 0, locked: !!spec.locked, spec,
    hostname: spec.name, ifaces: new Map(), mode: 'user', ctx: {}, pending: null,
    secret: null, enablePassword: null, passwordEnc: false, banner: '', users: new Map(),
    vlans: new Map([[1, 'default']]), ipRouting: spec.kind !== 'switch' && spec.kind !== 'l3switch', defaultGw: null,
    routes: [], acls: new Map(), natRules: [], natPools: new Map(),
    dhcp: { pools: new Map(), excluded: [] }, ospf: null,
    stp: { priority: 32768 }, vty: { transport: null, login: null, accessClass: null }, domain: '', rsa: false, sshV2: false,
    ntp: [], logging: [], snmp: [], httpServer: false,
    crypto: { policies: new Map(), keys: new Map(), tsets: new Map(), maps: new Map() },
    objects: new Map(), accessGroups: new Map(),
    // hosts
    gateway: null, extraRoutes: [], nameserver: null, dhcpOn: false, services: new Set(), records: new Map(), records6: new Map(), linkDown: false,
    gateway6: null, slaac: false, wifi: null, radiusUsers: new Map(), radiusClients: new Map(),
    // IPv6 and Wi-Fi
    v6Routing: false, routes6: [], ssidTable: new Map(), radius: null,
  };
  if (isHost(dev)) {
    dev.ifaces.set(hostPort(dev), newIface(dev, hostPort(dev)));
  } else {
    const count = spec.ports || PORT_COUNT[spec.kind] || 4;
    const first = isSwitchKind(dev) ? 1 : 0;
    for (let i = first; i < first + count; i++) dev.ifaces.set(`Gi0/${i}`, newIface(dev, `Gi0/${i}`));
    if (dev.kind === 'ap') {
      // Two radios, off until they're set up: 0 is 2.4 GHz and 1 is 5 GHz.
      for (const name of ['Do0', 'Do1']) dev.ifaces.set(name, { ...newIface(dev, name), shut: true });
    }
  }
  return dev;
}

/* Interface names as people type them, in the form the device prints them. */
const FAMILY = [[/^(?:gigabitethernet|gigabit|gig|gi|g)\s*(\d+\/\d+(?:\.\d+)?)$/i, 'Gi'], [/^(?:tunnel|tun|tu)\s*(\d+)$/i, 'Tu'], [/^(?:vlan|vl)\s*(\d+)$/i, 'Vl'], [/^(?:loopback|loop|lo)\s*(\d+)$/i, 'Lo'], [/^(?:dot11radio|dot11|do)\s*(\d+)$/i, 'Do'], [/^(eth\d+|wlan\d+)$/i, '']];
export function ifaceName(text) {
  for (const [re, prefix] of FAMILY) {
    const m = re.exec(text);
    if (m) return prefix + m[1];
  }
  return null;
}
export const longName = (n) => n.replace(/^Gi/, 'GigabitEthernet').replace(/^Tu/, 'Tunnel').replace(/^Vl/, 'Vlan').replace(/^Lo/, 'Loopback').replace(/^Do/, 'Dot11Radio');
const familyRank = (n) => (n.startsWith('Lo') ? 0 : n.startsWith('Gi') || n.startsWith('eth') || n.startsWith('wlan') ? 1 : n.startsWith('Do') ? 4 : n.startsWith('Tu') ? 2 : 3);
const portKey = (n) => n.replace(/^\D+/, '').split(/[/.]/).map(Number);
export function sortIfaces(list) {
  return [...list].sort((a, b) => {
    const r = familyRank(a.name) - familyRank(b.name);
    if (r) return r;
    const [x, y] = [portKey(a.name), portKey(b.name)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
    return 0;
  });
}
