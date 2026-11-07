/* Breaking a working network on purpose (section 9.4). Each fault is ordinary config, so anything broken here can be
   found and fixed with the tools a player has. A fault only counts if it really breaks something. */
import { lenToMask, n2ip } from './addr.js';
import { hostPort, isHost, isSwitchKind } from './device.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function hostFaults(dev) {
  const port = hostPort(dev);
  const iface = dev.ifaces.get(port);
  const out = [];
  const add = (lines, explain) => out.push({ device: dev.name, lines, explain: `${dev.name}: ${explain}` });
  if (dev.gateway && !dev.dhcpOn) add(['ip route del default', `ip route add default via ${dev.gateway.replace(/\d+$/, '254')}`], `its default gateway was changed from ${dev.gateway}`);
  if (iface.ip && !dev.dhcpOn) add([`ip addr add ${iface.ip}/${Math.min(iface.len + 2, 30)} dev ${port}`], `its subnet mask was changed from /${iface.len}`);
  if (dev.nameserver) add(['nameserver 10.255.255.53'], `its DNS server was changed from ${dev.nameserver}`);
  for (const s of dev.services) add([`service ${s} stop`], `the ${s} service was stopped`);
  for (const [name, r] of dev.records) if (r.type === 'A') add([`dns add ${name} A 10.255.255.80`], `the DNS record for ${name} was pointed at the wrong address`);
  if (dev.kind !== 'laptop') add([`ip link set ${port} down`], `its network port was turned off`);
  if (dev.wifi?.key) add([`wifi connect ${dev.wifi.ssid} wrong-password`], `its saved Wi-Fi password was changed`);
  return out;
}

function networkFaults(dev, lab) {
  const out = [];
  const add = (lines, explain) => out.push({ device: dev.name, lines, explain: `${dev.name}: ${explain}` });
  for (const i of dev.ifaces.values()) {
    if (i.wifi) continue;
    const inside = (extra) => [`interface ${i.name}`, ...extra];
    const cabled = lab.cableMap.has(`${dev.name}|${i.name}`);
    if ((cabled || i.name.includes('.')) && !i.shut) add(inside(['shutdown']), `${i.name} was shut down`);
    if (i.ip && i.len < 30) add(inside([`ip address ${i.ip} ${lenToMask(i.len + 1)}`]), `the mask on ${i.name} was changed from /${i.len}`);
    if (i.aclIn && dev.acls.get(i.aclIn)?.named) add([`ip access-list ${dev.acls.get(i.aclIn).type} ${i.aclIn}`, '1 deny ip any any'], `a deny line went in at the top of ${i.aclIn}`);
    if (i.nat === 'inside') add(inside(['no ip nat inside']), `${i.name} stopped being marked as NAT inside`);
    if (i.nat === 'outside') add(inside(['no ip nat outside']), `${i.name} stopped being marked as NAT outside`);
    for (const h of i.helper) add(inside([`no ip helper-address ${h}`]), `the DHCP relay on ${i.name} was removed`);
    if (i.ospfHello === 10 && dev.ospf && i.ip) add(inside(['ip ospf hello-interval 7']), `the OSPF hello timer on ${i.name} was changed`);
    if (dev.ospf && i.ip && cabled && !dev.ospf.passive.has(i.name)) add(['router ospf 1', `passive-interface ${i.name}`], `${i.name} was made passive in OSPF`);
    if (i.tunnelDst) add(inside(['tunnel destination 192.0.2.254']), `the tunnel destination on ${i.name} was changed`);
    if (i.cryptoMap) add(inside(['no crypto map']), `the crypto map came off ${i.name}`);
    if (i.channel !== null && !i.shut) add(inside(['shutdown']), `the radio ${i.name} was turned off`);
    if (isSwitchKind(dev) && !i.routed && cabled && i.name.startsWith('Gi')) {
      if (i.swMode === 'trunk' && i.allowed && i.allowed.size) {
        const vlan = [...i.allowed][0];
        add(inside([`switchport trunk allowed vlan remove ${vlan}`]), `VLAN ${vlan} was taken off the trunk on ${i.name}`);
      }
      if (i.swMode === 'trunk') add(inside(['switchport mode access']), `${i.name} stopped being a trunk`);
      if (i.swMode === 'access' && i.accessVlan !== 1) add(inside(['switchport access vlan 999']), `${i.name} was moved out of VLAN ${i.accessVlan}`);
    }
    for (const a of i.ip6 || []) add(inside(['no ipv6 address']), `the IPv6 address ${a.addr} came off ${i.name}`);
  }
  for (const r of dev.routes) {
    if (r.via && dev.kind !== 'firewall') add([`no ip route ${n2ip(r.net)} ${lenToMask(r.len)} ${r.via}`], `the route to ${n2ip(r.net)}/${r.len} was removed`);
  }
  for (const r of dev.routes6) add([`no ipv6 route ${r.prefix}/${r.len} ${r.via}`], `the IPv6 route to ${r.prefix}/${r.len} was removed`);
  if (dev.v6Routing) add(['no ipv6 unicast-routing'], 'IPv6 routing was turned off');
  if (dev.kind === 'l3switch' && dev.ipRouting) add(['no ip routing'], 'IP routing was turned off');
  for (const id of dev.vlans.keys()) if (id !== 1 && isSwitchKind(dev)) add([`no vlan ${id}`], `VLAN ${id} was deleted`);
  for (const [name, pool] of dev.dhcp.pools) if (pool.gw) add([`ip dhcp pool ${name}`, 'default-router 10.255.255.1'], `the gateway handed out by the ${name} pool was changed`);
  for (const peer of dev.crypto.keys.keys()) add([`crypto isakmp key wrong-key address ${peer}`], `the pre-shared key for ${peer} was changed`);
  for (const [name, s] of dev.ssidTable) {
    if (s.key) add([`dot11 ssid ${name}`, `authentication ${s.auth} wrong-password`], `the password on ${name} was changed`);
    if (s.vlan !== 1) add([`dot11 ssid ${name}`, 'vlan 999'], `${name} was moved out of VLAN ${s.vlan}`);
  }
  for (const [iface, acl] of dev.accessGroups) add([`no access-group ${acl} in interface ${iface}`], `the rule list came off ${iface}`);
  return out;
}

export function faultCandidates(lab) {
  const out = [];
  for (const dev of lab.devices.values()) {
    if (dev.locked) continue;
    out.push(...(isHost(dev) ? hostFaults(dev) : networkFaults(dev, lab)));
  }
  return out;
}

/* Goals about config text would count any change as breaking something, so only goals about the network count. */
const functional = (goals) => goals.filter((g) => !('saved' in g) && !('config' in g));
const failing = (lab, goals) => lab.check(goals).filter((r) => !r.ok).length;

/** Breaks a working lab in place. Returns what was done, or fewer than asked for if the lab has little to break. */
export function injectFaults(lab, goals, seed, count = 1) {
  const random = rng(seed);
  const tests = functional(goals);
  const done = [];
  if (!tests.length) return done;
  // Each fault has to break something by itself, so fixing one still leaves the others to find.
  const base = lab.clone();
  const baseline = failing(base.clone(), tests);
  for (const fault of shuffled(faultCandidates(lab), random)) {
    if (done.length >= count) break;
    const untouched = base.clone();
    untouched.applyLines(fault.device, fault.lines);
    if (failing(untouched, tests) <= baseline) continue;
    lab.applyLines(fault.device, fault.lines);
    done.push({ device: fault.device, explain: fault.explain });
  }
  // It's as if the change had been made and saved, so a reload won't magically fix it.
  for (const dev of lab.devices.values()) if (!dev.locked) lab.save(dev.name);
  return done;
}

/** For the sandbox, which has no goals: everything that can reach everything right now, as goals. */
export function reachabilityGoals(lab) {
  const hosts = [...lab.devices.values()].filter((d) => isHost(d) && d.ifaces.get(hostPort(d)).ip);
  const goals = [];
  for (const a of hosts) {
    for (const b of hosts) {
      if (a !== b) goals.push({ label: `${a.name} can ping ${b.name}`, reach: { from: a.name, to: b.ifaces.get(hostPort(b)).ip } });
    }
  }
  return goals;
}
