import { describe, expect, it } from 'vitest';
import { createLab, faultCandidates, gradeLab, injectFaults, playSolution, reachabilityGoals } from '../netsim/index.js';

const run = (lab, dev, lines) => lines.split('\n').map((l) => lab.run(dev, l.trim())).filter(Boolean).join('\n');
const conf = (lab, dev, lines) => { lab.run(dev, 'enable'); lab.run(dev, 'configure terminal'); run(lab, dev, lines); lab.run(dev, 'end'); };
const goal = (lab, g) => lab.check([{ label: 'g', ...g }])[0];

const twoPcs = () => createLab({ devices: [{ name: 'A', kind: 'pc' }, { name: 'B', kind: 'pc' }], cables: [['A', 'eth0', 'B', 'eth0']] });

describe('hosts', () => {
  it('reach each other on one subnet, once both have addresses', () => {
    const lab = twoPcs();
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    expect(lab.run('A', 'ping 10.0.0.2')).toMatch(/100% packet loss/);
    lab.run('B', 'ip addr add 10.0.0.2/24 dev eth0');
    expect(lab.run('A', 'ping 10.0.0.2')).toMatch(/0% packet loss/);
  });
  it('explains that a host needs a gateway to leave its subnet', () => {
    const lab = twoPcs();
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    expect(lab.run('A', 'ping 10.0.1.2')).toMatch(/no default gateway/);
  });
  it('needs a cable', () => {
    const lab = createLab({ cabling: true, devices: [{ name: 'A', kind: 'pc' }, { name: 'B', kind: 'pc' }] });
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    lab.run('B', 'ip addr add 10.0.0.2/24 dev eth0');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(false);
    expect(lab.plug('A', 'eth0', 'B', 'eth0')).toBe('');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
    expect(lab.plug('A', 'eth0', 'B', 'eth0')).toMatch(/already/);
  });
});

const lan = () => createLab({
  devices: [{ name: 'A', kind: 'pc' }, { name: 'B', kind: 'pc' }, { name: 'SW1', kind: 'switch', ports: 8 }, { name: 'R1', kind: 'router' }],
  cables: [['A', 'eth0', 'SW1', 'Gi0/1'], ['B', 'eth0', 'SW1', 'Gi0/2'], ['R1', 'Gi0/0', 'SW1', 'Gi0/8']],
});

describe('the console', () => {
  it('moves through modes with the right prompts', () => {
    const lab = lan();
    expect(lab.promptOf('R1')).toBe('R1>');
    lab.run('R1', 'en');
    expect(lab.promptOf('R1')).toBe('R1#');
    lab.run('R1', 'conf t');
    expect(lab.promptOf('R1')).toBe('R1(config)#');
    lab.run('R1', 'int g0/0');
    expect(lab.promptOf('R1')).toBe('R1(config-if)#');
    lab.run('R1', 'exit');
    lab.run('R1', 'hostname EDGE');
    lab.run('R1', 'end');
    expect(lab.promptOf('R1')).toBe('EDGE#');
  });
  it('points at what it did not understand', () => {
    const lab = lan();
    lab.run('R1', 'en');
    const out = lab.run('R1', 'show banana');
    expect(out).toMatch(/\^/);
    expect(out).toMatch(/Invalid input/);
  });
  it('accepts abbreviations and refuses ambiguous ones', () => {
    const lab = lan();
    lab.run('R1', 'en');
    expect(lab.run('R1', 'sh ip int br')).toMatch(/GigabitEthernet0\/0/);
    expect(lab.run('R1', 'c')).toMatch(/Ambiguous/);
    expect(lab.run('R1', 'configure')).toMatch(/Incomplete/);
  });
  it('answers ? with what fits next', () => {
    const lab = lan();
    lab.run('R1', 'en');
    expect(lab.run('R1', 'show ip ?')).toMatch(/route/);
    expect(lab.run('R1', 'sh?')).toMatch(/show/);
  });
  it('has help wherever you are', () => {
    const lab = lan();
    expect(lab.run('R1', 'help')).toMatch(/enable/);
    expect(lab.run('A', 'help')).toMatch(/ip addr/);
    expect(lab.run('A', '?')).toMatch(/ip addr/);
  });
  it('completes with Tab', () => {
    const lab = lan();
    lab.run('R1', 'en');
    expect(lab.complete('R1', 'conf')).toBe('configure ');
    expect(lab.complete('R1', 'configure t')).toBe('configure terminal ');
  });
  it('lets a global command leave a sub-mode, as the real thing does', () => {
    const lab = lan();
    conf(lab, 'R1', 'int g0/0\nhostname Z\nint g0/1\nno shut');
    expect(lab.configOf('R1')).toMatch(/hostname Z/);
    expect(lab.configOf('R1')).toMatch(/interface Gi0\/1\n no shutdown/);
  });
  it('runs show commands from config mode with do', () => {
    const lab = lan();
    lab.run('R1', 'en');
    lab.run('R1', 'conf t');
    expect(lab.run('R1', 'do show ip route')).toMatch(/Codes/);
    expect(lab.promptOf('R1')).toBe('R1(config)#');
  });
  it('asks for the enable secret once one is set', () => {
    const lab = lan();
    conf(lab, 'R1', 'enable secret hunter2');
    lab.run('R1', 'disable');
    expect(lab.run('R1', 'enable')).toBe('Password:');
    expect(lab.run('R1', 'wrong')).toMatch(/denied/);
    lab.run('R1', 'enable');
    lab.run('R1', 'hunter2');
    expect(lab.promptOf('R1')).toBe('R1#');
    expect(lab.configOf('R1')).not.toMatch(/hunter2/);
  });
});

describe('saving', () => {
  it('loses unsaved changes on reload, and keeps saved ones', () => {
    const lab = lan();
    conf(lab, 'R1', 'hostname ONE');
    lab.run('R1', 'reload');
    expect(lab.promptOf('R1')).toBe('R1#');
    conf(lab, 'R1', 'hostname TWO');
    lab.run('R1', 'copy running-config startup-config');
    lab.run('R1', 'reload');
    expect(lab.promptOf('R1')).toBe('TWO#');
    expect(goal(lab, { saved: { device: 'R1' } }).ok).toBe(true);
  });
});

describe('switching', () => {
  it('learns MAC addresses from traffic', () => {
    const lab = lan();
    lab.run('SW1', 'en');
    expect(lab.run('SW1', 'show mac address-table')).toMatch(/empty/);
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    lab.run('B', 'ip addr add 10.0.0.2/24 dev eth0');
    lab.run('A', 'ping 10.0.0.2');
    const table = lab.run('SW1', 'show mac address-table');
    expect(table).toMatch(/Gi0\/1/);
    expect(table).toMatch(/Gi0\/2/);
  });
  it('keeps VLANs apart', () => {
    const lab = lan();
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    lab.run('B', 'ip addr add 10.0.0.2/24 dev eth0');
    conf(lab, 'SW1', 'vlan 10\nname ENG\nint g0/1\nswitchport mode access\nswitchport access vlan 10');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(false);
    conf(lab, 'SW1', 'int g0/2\nswitchport access vlan 10');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
    lab.run('SW1', 'en');
    expect(lab.run('SW1', 'show vlan brief')).toMatch(/ENG/);
  });
  it('carries VLANs over a trunk, and says when one is not allowed', () => {
    const lab = createLab({
      devices: [{ name: 'A', kind: 'pc' }, { name: 'B', kind: 'pc' }, { name: 'S1', kind: 'switch', ports: 4 }, { name: 'S2', kind: 'switch', ports: 4 }],
      cables: [['A', 'eth0', 'S1', 'Gi0/1'], ['B', 'eth0', 'S2', 'Gi0/1'], ['S1', 'Gi0/4', 'S2', 'Gi0/4']],
    });
    lab.run('A', 'ip addr add 10.0.0.1/24 dev eth0');
    lab.run('B', 'ip addr add 10.0.0.2/24 dev eth0');
    for (const s of ['S1', 'S2']) conf(lab, s, 'vlan 10\nint g0/1\nswitchport access vlan 10');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(false);
    for (const s of ['S1', 'S2']) conf(lab, s, 'int g0/4\nswitchport mode trunk\nswitchport trunk allowed vlan 20');
    const why = goal(lab, { reach: { from: 'A', to: 'B' } }).why;
    expect(why).toMatch(/VLAN 10 isn't allowed on the trunk/);
    for (const s of ['S1', 'S2']) conf(lab, s, 'int g0/4\nswitchport trunk allowed vlan add 10');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
  });
  it('blocks a loop and lets you choose the root', () => {
    const lab = createLab({
      devices: [{ name: 'S1', kind: 'switch', ports: 4 }, { name: 'S2', kind: 'switch', ports: 4 }, { name: 'S3', kind: 'switch', ports: 4 }],
      cables: [['S1', 'Gi0/1', 'S2', 'Gi0/1'], ['S2', 'Gi0/2', 'S3', 'Gi0/2'], ['S3', 'Gi0/3', 'S1', 'Gi0/3']],
    });
    expect(lab.net().blocked.size).toBe(1);
    conf(lab, 'S3', 'spanning-tree vlan 1 root primary');
    expect(goal(lab, { stp_root: { device: 'S3' } }).ok).toBe(true);
    const blocked = [...lab.net().blocked][0];
    expect(blocked.startsWith('S3|')).toBe(false);
  });
  it('shuts a secured port when too many machines appear', () => {
    const lab = createLab({
      devices: [{ name: 'A', kind: 'pc' }, { name: 'ROGUE', kind: 'pc' }, { name: 'S', kind: 'switch', ports: 4 }, { name: 'MINI', kind: 'switch', ports: 4 }],
      cables: [['A', 'eth0', 'MINI', 'Gi0/1'], ['ROGUE', 'eth0', 'MINI', 'Gi0/2'], ['MINI', 'Gi0/4', 'S', 'Gi0/1']],
    });
    conf(lab, 'S', 'int g0/1\nswitchport mode access\nswitchport port-security\nswitchport port-security maximum 1');
    expect(goal(lab, { err_disabled: { device: 'S', interface: 'Gi0/1' } }).ok).toBe(true);
    conf(lab, 'S', 'int g0/1\nswitchport port-security maximum 2');
    expect(goal(lab, { err_disabled: { device: 'S', interface: 'Gi0/1' } }).ok).toBe(false);
  });
});

const routed = () => {
  const lab = createLab({
    devices: [{ name: 'A', kind: 'pc', config: 'ip addr add 10.1.0.2/24 dev eth0\nip route add default via 10.1.0.1' }, { name: 'B', kind: 'server', config: 'ip addr add 10.2.0.2/24 dev eth0\nip route add default via 10.2.0.1\nservice http start' }, { name: 'R1', kind: 'router', config: 'interface Gi0/0\n ip address 10.1.0.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.2.0.1 255.255.255.0\n no shutdown' }],
    cables: [['A', 'eth0', 'R1', 'Gi0/0'], ['B', 'eth0', 'R1', 'Gi0/1']],
  });
  return lab;
};

describe('routing', () => {
  it('routes between connected networks', () => {
    const lab = routed();
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
    expect(lab.run('A', 'traceroute 10.2.0.2')).toMatch(/R1/);
    expect(lab.run('A', 'curl 10.2.0.2')).toMatch(/200 OK/);
  });
  it('tells refused apart from dropped', () => {
    const lab = routed();
    expect(lab.run('A', 'nc -z 10.2.0.2 22')).toMatch(/Connection refused/);
  });
  it('a router interface starts off, and needs no shutdown', () => {
    const lab = routed();
    conf(lab, 'R1', 'int g0/1\nshutdown');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(false);
  });
  it('refuses overlapping addresses and impossible ones', () => {
    const lab = routed();
    lab.run('R1', 'en');
    lab.run('R1', 'conf t');
    lab.run('R1', 'int g0/2');
    expect(lab.run('R1', 'ip address 10.1.0.9 255.255.255.0')).toMatch(/overlaps/);
    expect(lab.run('R1', 'ip address 10.5.0.0 255.255.255.0')).toMatch(/network or broadcast/);
  });
  it('prefers the longest prefix, then the lowest distance', () => {
    const lab = routed();
    conf(lab, 'R1', 'ip route 192.168.0.0 255.255.0.0 10.2.0.2\nip route 192.168.5.0 255.255.255.0 10.1.0.2\nip route 192.168.5.0 255.255.255.0 10.2.0.2 200');
    expect(goal(lab, { route: { device: 'R1', to: '192.168.5.9', via: '10.1.0.2' } }).ok).toBe(true);
    expect(goal(lab, { route: { device: 'R1', to: '192.168.6.9', via: '10.2.0.2' } }).ok).toBe(true);
  });
  it('reports a routing loop rather than hanging', () => {
    const lab = createLab({
      devices: [{ name: 'A', kind: 'pc', config: 'ip addr add 10.0.0.2/24 dev eth0\nip route add default via 10.0.0.1' }, { name: 'R1', kind: 'router', config: 'interface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.9.0.1 255.255.255.0\n no shutdown\nip route 0.0.0.0 0.0.0.0 10.9.0.2' }, { name: 'R2', kind: 'router', config: 'interface Gi0/0\n ip address 10.9.0.2 255.255.255.0\n no shutdown\nip route 0.0.0.0 0.0.0.0 10.9.0.1' }],
      cables: [['A', 'eth0', 'R1', 'Gi0/0'], ['R1', 'Gi0/1', 'R2', 'Gi0/0']],
    });
    expect(goal(lab, { reach: { from: 'A', to: '8.8.8.8' } }).why).toMatch(/TTL|loop/);
  });
});

const threeRouters = () => createLab({
  devices: [
    { name: 'R1', kind: 'router', config: 'interface Lo0\n ip address 1.1.1.1 255.255.255.255\ninterface Gi0/0\n ip address 10.12.0.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.13.0.1 255.255.255.0\n no shutdown' },
    { name: 'R2', kind: 'router', config: 'interface Lo0\n ip address 2.2.2.2 255.255.255.255\ninterface Gi0/0\n ip address 10.12.0.2 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.23.0.2 255.255.255.0\n no shutdown' },
    { name: 'R3', kind: 'router', config: 'interface Lo0\n ip address 3.3.3.3 255.255.255.255\ninterface Gi0/0\n ip address 10.13.0.3 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.23.0.3 255.255.255.0\n no shutdown' },
  ],
  cables: [['R1', 'Gi0/0', 'R2', 'Gi0/0'], ['R1', 'Gi0/1', 'R3', 'Gi0/0'], ['R2', 'Gi0/1', 'R3', 'Gi0/1']],
});
const ospfOn = (lab) => { for (const r of ['R1', 'R2', 'R3']) conf(lab, r, 'router ospf 1\nnetwork 0.0.0.0 255.255.255.255 area 0'); };

describe('OSPF', () => {
  it('forms neighbours and learns routes', () => {
    const lab = threeRouters();
    ospfOn(lab);
    expect(goal(lab, { ospf_neighbors: { device: 'R1', count: 2 } }).ok).toBe(true);
    expect(goal(lab, { route: { device: 'R1', to: '3.3.3.3', type: 'O' } }).ok).toBe(true);
    lab.run('R1', 'en');
    expect(lab.run('R1', 'show ip ospf neighbor')).toMatch(/FULL/);
  });
  it('says why neighbours do not form', () => {
    for (const [fault, why] of [['interface Gi0/0\n ip ospf hello-interval 5', /hello/], ['router ospf 1\n passive-interface Gi0/0', /passive/], ['interface Gi0/0\n ip address 10.12.0.1 255.255.255.128', /masks/]]) {
      const lab = threeRouters();
      ospfOn(lab);
      conf(lab, 'R1', fault.replace(/\n /g, '\n'));
      expect(goal(lab, { ospf_neighbors: { device: 'R2', count: 2 } }).why).toMatch(why);
    }
  });
  it('takes the cheaper path and heals around a cut', () => {
    const lab = threeRouters();
    ospfOn(lab);
    conf(lab, 'R1', 'int g0/1\nip ospf cost 50');
    expect(goal(lab, { route: { device: 'R1', to: '3.3.3.3', via: '10.12.0.2' } }).ok).toBe(true);
    expect(goal(lab, { survives: { cut: [{ device: 'R1', port: 'Gi0/0' }], then: [{ route: { device: 'R1', to: '3.3.3.3', via: '10.13.0.3' } }] } }).ok).toBe(true);
  });
  it('uses a floating static only when the better route has gone', () => {
    const lab = threeRouters();
    conf(lab, 'R1', 'ip route 3.3.3.3 255.255.255.255 10.13.0.3\nip route 3.3.3.3 255.255.255.255 10.12.0.2 200');
    expect(goal(lab, { route: { device: 'R1', to: '3.3.3.3', via: '10.13.0.3' } }).ok).toBe(true);
    expect(goal(lab, { survives: { cut: [{ device: 'R1', port: 'Gi0/1' }], then: [{ route: { device: 'R1', to: '3.3.3.3', via: '10.12.0.2' } }] } }).ok).toBe(true);
  });
});

describe('access lists', () => {
  it('apply first match wins with an implicit deny', () => {
    const lab = routed();
    conf(lab, 'R1', 'access-list 110 permit tcp any any eq 80\ninterface g0/0\nip access-group 110 in');
    expect(goal(lab, { reach: { from: 'A', to: 'B', proto: 'tcp', port: 80 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).why).toMatch(/implicit deny/);
  });
  it('name the line that dropped it', () => {
    const lab = routed();
    conf(lab, 'R1', 'ip access-list extended F\ndeny tcp host 10.1.0.2 any eq 80\npermit ip any any\ninterface g0/0\nip access-group F in');
    expect(goal(lab, { reach: { from: 'A', to: 'B', proto: 'tcp', port: 80 } }).why).toMatch(/line 10/);
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
    lab.run('R1', 'en');
    expect(lab.run('R1', 'show access-lists')).toMatch(/matches/);
  });
  it('see replies too, unless told they are established', () => {
    const lab = routed();
    conf(lab, 'R1', 'access-list 120 permit tcp host 10.2.0.2 eq 80 host 10.1.0.2\ninterface g0/1\nip access-group 120 in');
    expect(goal(lab, { reach: { from: 'A', to: 'B', proto: 'tcp', port: 80 } }).ok).toBe(true);
    conf(lab, 'R1', 'no access-list 120\naccess-list 120 deny ip any any\n');
    expect(goal(lab, { reach: { from: 'A', to: 'B', proto: 'tcp', port: 80 } }).why).toMatch(/never came back/);
  });
});

const edge = () => createLab({
  devices: [
    { name: 'PC', kind: 'pc', config: 'ip addr add 10.0.0.5/24 dev eth0\nip route add default via 10.0.0.1' },
    { name: 'WEB', kind: 'server', config: 'ip addr add 10.0.0.80/24 dev eth0\nip route add default via 10.0.0.1\nservice http start' },
    { name: 'SW', kind: 'switch', ports: 4 },
    { name: 'R1', kind: 'router', config: 'interface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n no shutdown\n ip nat inside\ninterface Gi0/1\n ip address 203.0.113.2 255.255.255.0\n no shutdown\n ip nat outside\nip route 0.0.0.0 0.0.0.0 203.0.113.1' },
    { name: 'ISP', kind: 'router', locked: true, config: 'interface Gi0/0\n ip address 203.0.113.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 198.51.100.1 255.255.255.0\n no shutdown' },
    { name: 'NET', kind: 'server', locked: true, config: 'ip addr add 198.51.100.10/24 dev eth0\nip route add default via 198.51.100.1\nservice http start' },
  ],
  cables: [['PC', 'eth0', 'SW', 'Gi0/1'], ['WEB', 'eth0', 'SW', 'Gi0/2'], ['R1', 'Gi0/0', 'SW', 'Gi0/4'], ['R1', 'Gi0/1', 'ISP', 'Gi0/0'], ['NET', 'eth0', 'ISP', 'Gi0/1']],
});

describe('NAT', () => {
  it('private addresses go nowhere until they are translated', () => {
    const lab = edge();
    const net = { reach: { from: 'PC', to: 'NET', proto: 'tcp', port: 80 } };
    expect(goal(lab, net).ok).toBe(false);
    conf(lab, 'R1', 'access-list 1 permit 10.0.0.0 0.0.0.255\nip nat inside source list 1 interface Gi0/1 overload');
    expect(goal(lab, net).ok).toBe(true);
    lab.run('PC', 'curl 198.51.100.10');
    lab.run('R1', 'en');
    expect(lab.run('R1', 'show ip nat translations')).toMatch(/203\.0\.113\.2/);
  });
  it('publishes one port and no others', () => {
    const lab = edge();
    conf(lab, 'R1', 'ip nat inside source static tcp 10.0.0.80 80 203.0.113.10 80');
    expect(goal(lab, { reach: { from: 'NET', to: '203.0.113.10', proto: 'tcp', port: 80 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'NET', to: '203.0.113.10', proto: 'tcp', port: 22 } }).ok).toBe(false);
    expect(goal(lab, { reach: { from: 'NET', to: '10.0.0.5' } }).ok).toBe(false);
  });
});

describe('DHCP and DNS', () => {
  const office = () => createLab({
    devices: [
      { name: 'PC', kind: 'pc' }, { name: 'PC2', kind: 'pc' }, { name: 'SW', kind: 'switch', ports: 4 },
      { name: 'R1', kind: 'router', config: 'interface Gi0/0\n ip address 10.0.0.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 10.9.0.1 255.255.255.0\n no shutdown' },
      { name: 'DNS', kind: 'server', config: 'ip addr add 10.9.0.53/24 dev eth0\nip route add default via 10.9.0.1\nservice dns start\ndns add www.corp.test A 10.9.0.80\ndns add web.corp.test CNAME www.corp.test' },
    ],
    cables: [['PC', 'eth0', 'SW', 'Gi0/1'], ['PC2', 'eth0', 'SW', 'Gi0/2'], ['R1', 'Gi0/0', 'SW', 'Gi0/4'], ['DNS', 'eth0', 'R1', 'Gi0/1']],
  });
  it('hands out addresses in order, skipping exclusions', () => {
    const lab = office();
    conf(lab, 'R1', 'ip dhcp excluded-address 10.0.0.1 10.0.0.10\nip dhcp pool FLOOR\nnetwork 10.0.0.0 255.255.255.0\ndefault-router 10.0.0.1\ndns-server 10.9.0.53');
    expect(lab.run('PC', 'dhclient eth0')).toMatch(/10\.0\.0\.11/);
    lab.run('PC2', 'dhclient eth0');
    expect(goal(lab, { dhcp: { host: 'PC2', in: '10.0.0.0/24' } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'PC', to: '10.9.0.53' } }).ok).toBe(true);
    lab.run('R1', 'en');
    expect(lab.run('R1', 'show ip dhcp binding')).toMatch(/PC2/);
  });
  it('follows names and aliases, and says when one is missing', () => {
    const lab = office();
    conf(lab, 'R1', 'ip dhcp pool FLOOR\nnetwork 10.0.0.0 255.255.255.0\ndefault-router 10.0.0.1\ndns-server 10.9.0.53');
    lab.run('PC', 'dhclient eth0');
    expect(lab.run('PC', 'dig web.corp.test')).toMatch(/CNAME/);
    expect(goal(lab, { dns: { from: 'PC', name: 'web.corp.test', answer: '10.9.0.80' } }).ok).toBe(true);
    expect(lab.run('PC', 'dig nope.corp.test')).toMatch(/NXDOMAIN/);
  });
});

const firewalled = (extra = '') => createLab({
  devices: [
    { name: 'PC', kind: 'pc', config: 'ip addr add 10.0.0.5/24 dev eth0\nip route add default via 10.0.0.1' },
    { name: 'WEB', kind: 'server', config: 'ip addr add 172.16.0.80/24 dev eth0\nip route add default via 172.16.0.1\nservice http start\nservice ssh start' },
    { name: 'ISP', kind: 'router', locked: true, config: 'interface Gi0/0\n ip address 203.0.113.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 198.51.100.1 255.255.255.0\n no shutdown' },
    { name: 'NET', kind: 'server', locked: true, config: 'ip addr add 198.51.100.10/24 dev eth0\nip route add default via 198.51.100.1\nservice http start' },
    { name: 'FW', kind: 'firewall', config: `interface Gi0/0\n nameif inside\n security-level 100\n ip address 10.0.0.1 255.255.255.0\n no shutdown\ninterface Gi0/1\n nameif outside\n security-level 0\n ip address 203.0.113.2 255.255.255.0\n no shutdown\ninterface Gi0/2\n nameif dmz\n security-level 50\n ip address 172.16.0.1 255.255.255.0\n no shutdown\nroute outside 0.0.0.0 0.0.0.0 203.0.113.1\n${extra}` },
  ],
  cables: [['PC', 'eth0', 'FW', 'Gi0/0'], ['WEB', 'eth0', 'FW', 'Gi0/2'], ['FW', 'Gi0/1', 'ISP', 'Gi0/0'], ['NET', 'eth0', 'ISP', 'Gi0/1']],
});

describe('the firewall', () => {
  it('lets high talk to low and lets the answer back, but not the reverse', () => {
    const lab = firewalled();
    expect(goal(lab, { reach: { from: 'PC', to: 'WEB', proto: 'tcp', port: 80 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'WEB', to: 'PC' } }).why).toMatch(/can't start traffic/);
  });
  it('translates inside addresses and publishes the web server through an ACL', () => {
    const lab = firewalled('object network IN\n subnet 10.0.0.0 255.255.255.0\n nat (inside,outside) dynamic interface\nobject network W\n host 172.16.0.80\n nat (dmz,outside) static 203.0.113.80');
    expect(goal(lab, { reach: { from: 'PC', to: 'NET', proto: 'tcp', port: 80 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'NET', to: '203.0.113.80', proto: 'tcp', port: 80 } }).ok).toBe(false);
    conf(lab, 'FW', 'access-list OUT extended permit tcp any host 172.16.0.80 eq 80\naccess-group OUT in interface outside');
    expect(goal(lab, { reach: { from: 'NET', to: '203.0.113.80', proto: 'tcp', port: 80 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'NET', to: '203.0.113.80', proto: 'tcp', port: 22 } }).ok).toBe(false);
    lab.run('FW', 'en');
    expect(lab.run('FW', 'show conn')).toMatch(/TCP/);
  });
  it('reads masks where a router would read wildcards', () => {
    const lab = firewalled();
    conf(lab, 'FW', 'access-list D extended permit ip 172.16.0.0 255.255.255.0 any\naccess-group D in interface dmz');
    expect(goal(lab, { reach: { from: 'WEB', to: 'PC' } }).ok).toBe(true);
  });
});

const sites = (faults = {}) => {
  const side = (n, other, lan, wan, otherLan) => `interface Gi0/0
 ip address ${lan}.1 255.255.255.0
 no shutdown
 ip nat inside
interface Gi0/1
 ip address ${wan} 255.255.255.0
 no shutdown
 ip nat outside
ip route 0.0.0.0 0.0.0.0 ${wan.split('.').slice(0, 3).join('.')}.254
access-list 1 permit ${lan}.0 0.0.0.255`;
  return createLab({
    devices: [
      { name: 'HQ', kind: 'pc', config: 'ip addr add 10.1.0.5/24 dev eth0\nip route add default via 10.1.0.1' },
      { name: 'BR', kind: 'server', config: 'ip addr add 10.2.0.5/24 dev eth0\nip route add default via 10.2.0.1\nservice http start' },
      { name: 'R1', kind: 'router', config: side(1, 2, '10.1.0', '203.0.113.1') + (faults.r1 || '') },
      { name: 'R2', kind: 'router', config: side(2, 1, '10.2.0', '198.51.100.1') + (faults.r2 || '') },
      { name: 'ISP', kind: 'router', locked: true, config: 'interface Gi0/0\n ip address 203.0.113.254 255.255.255.0\n no shutdown\ninterface Gi0/1\n ip address 198.51.100.254 255.255.255.0\n no shutdown' },
    ],
    cables: [['HQ', 'eth0', 'R1', 'Gi0/0'], ['BR', 'eth0', 'R2', 'Gi0/0'], ['R1', 'Gi0/1', 'ISP', 'Gi0/0'], ['R2', 'Gi0/1', 'ISP', 'Gi0/1']],
  });
};
const vpn = (lab, r, lan, otherLan, peer, map = 'VPN', key = 'k3y', hash = 'sha256') => conf(lab, r, `crypto isakmp policy 10
encryption aes 256
hash ${hash}
authentication pre-share
group 14
crypto isakmp key ${key} address ${peer}
crypto ipsec transform-set TS esp-aes 256 esp-sha256-hmac
access-list 101 permit ip ${lan}.0 0.0.0.255 ${otherLan}.0 0.0.0.255
crypto map ${map} 10 ipsec-isakmp
set peer ${peer}
set transform-set TS
match address 101
interface g0/1
crypto map ${map}`);

describe('VPNs', () => {
  it('private addresses cross the internet only through the tunnel', () => {
    const lab = sites();
    expect(goal(lab, { reach: { from: 'HQ', to: 'BR' } }).ok).toBe(false);
    vpn(lab, 'R1', '10.1.0', '10.2.0', '198.51.100.1');
    vpn(lab, 'R2', '10.2.0', '10.1.0', '203.0.113.1');
    expect(goal(lab, { vpn_up: { device: 'R1', peer: '198.51.100.1' } }).ok).toBe(true);
  });
  it('NAT breaks it until the VPN traffic is exempt', () => {
    const lab = sites();
    vpn(lab, 'R1', '10.1.0', '10.2.0', '198.51.100.1');
    vpn(lab, 'R2', '10.2.0', '10.1.0', '203.0.113.1');
    conf(lab, 'R1', 'ip nat inside source list 1 interface Gi0/1 overload');
    conf(lab, 'R2', 'ip nat inside source list 1 interface Gi0/1 overload');
    expect(goal(lab, { encrypted: { from: 'HQ', to: 'BR' } }).ok).toBe(false);
    for (const [r, a, b] of [['R1', '10.1.0', '10.2.0'], ['R2', '10.2.0', '10.1.0']]) {
      conf(lab, r, `no access-list 1\nno ip nat inside source list 1 interface Gi0/1 overload\naccess-list 102 deny ip ${a}.0 0.0.0.255 ${b}.0 0.0.0.255\naccess-list 102 permit ip ${a}.0 0.0.0.255 any\nip nat inside source list 102 interface Gi0/1 overload`);
    }
    expect(goal(lab, { encrypted: { from: 'HQ', to: 'BR' } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'HQ', to: 'BR', proto: 'tcp', port: 80 } }).ok).toBe(true);
  });
  it.each([
    [{ key: 'other' }, /pre-shared keys/],
    [{ hash: 'sha' }, /ISAKMP policies/],
  ])('says which phase failed: %o', (fault, why) => {
    const lab = sites();
    vpn(lab, 'R1', '10.1.0', '10.2.0', '198.51.100.1');
    vpn(lab, 'R2', '10.2.0', '10.1.0', '203.0.113.1', 'VPN', fault.key || 'k3y', fault.hash || 'sha256');
    expect(goal(lab, { vpn_up: { device: 'R1', peer: '198.51.100.1' } }).why).toMatch(why);
  });
  it('a GRE tunnel carries OSPF between sites', () => {
    const lab = sites();
    for (const [r, wan, far, tun] of [['R1', 'Gi0/1', '198.51.100.1', '172.31.0.1'], ['R2', 'Gi0/1', '203.0.113.1', '172.31.0.2']]) {
      conf(lab, r, `interface tunnel0\nip address ${tun} 255.255.255.252\ntunnel source ${wan}\ntunnel destination ${far}\nrouter ospf 1\nnetwork 172.31.0.0 0.0.0.3 area 0\nnetwork 10.0.0.0 0.255.255.255 area 0`);
    }
    expect(goal(lab, { tunnel_up: { device: 'R1', interface: 'Tunnel0' } }).ok).toBe(true);
    expect(goal(lab, { ospf_neighbors: { device: 'R1', count: 1 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'HQ', to: 'BR', proto: 'tcp', port: 80 } }).ok).toBe(true);
  });
});

describe('inter-VLAN routing', () => {
  it('works with a router on a stick', () => {
    const lab = createLab({
      devices: [
        { name: 'A', kind: 'pc', config: 'ip addr add 10.10.0.2/24 dev eth0\nip route add default via 10.10.0.1' },
        { name: 'B', kind: 'pc', config: 'ip addr add 10.20.0.2/24 dev eth0\nip route add default via 10.20.0.1' },
        { name: 'SW', kind: 'switch', ports: 4, config: 'vlan 10\nvlan 20\ninterface Gi0/1\n switchport access vlan 10\ninterface Gi0/2\n switchport access vlan 20\ninterface Gi0/4\n switchport mode trunk' },
        { name: 'R1', kind: 'router' },
      ],
      cables: [['A', 'eth0', 'SW', 'Gi0/1'], ['B', 'eth0', 'SW', 'Gi0/2'], ['R1', 'Gi0/0', 'SW', 'Gi0/4']],
    });
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(false);
    conf(lab, 'R1', 'interface g0/0\nno shutdown\ninterface g0/0.10\nencapsulation dot1q 10\nip address 10.10.0.1 255.255.255.0\ninterface g0/0.20\nencapsulation dot1q 20\nip address 10.20.0.1 255.255.255.0');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
  });
  it('works on a layer 3 switch once ip routing is on', () => {
    const lab = createLab({
      devices: [
        { name: 'A', kind: 'pc', config: 'ip addr add 10.10.0.2/24 dev eth0\nip route add default via 10.10.0.1' },
        { name: 'B', kind: 'pc', config: 'ip addr add 10.20.0.2/24 dev eth0\nip route add default via 10.20.0.1' },
        { name: 'CORE', kind: 'l3switch', ports: 4, config: 'vlan 10\nvlan 20\ninterface Gi0/1\n switchport access vlan 10\ninterface Gi0/2\n switchport access vlan 20' },
      ],
      cables: [['A', 'eth0', 'CORE', 'Gi0/1'], ['B', 'eth0', 'CORE', 'Gi0/2']],
    });
    conf(lab, 'CORE', 'interface vlan 10\nip address 10.10.0.1 255.255.255.0\ninterface vlan 20\nip address 10.20.0.1 255.255.255.0');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).why).toMatch(/isn't routing/);
    conf(lab, 'CORE', 'ip routing');
    expect(goal(lab, { reach: { from: 'A', to: 'B' } }).ok).toBe(true);
  });
});

describe('hardening', () => {
  const box = () => {
    const lab = routed();
    conf(lab, 'R1', 'line vty 0 15\nlogin local\ntransport input all\nusername admin secret s3cret');
    return lab;
  };
  it('moves remote login from Telnet to SSH', () => {
    const lab = box();
    expect(goal(lab, { reach: { from: 'A', to: '10.1.0.1', proto: 'tcp', port: 23 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'A', to: '10.1.0.1', proto: 'tcp', port: 22 } }).ok).toBe(false);
    lab.run('R1', 'en');
    lab.run('R1', 'conf t');
    expect(lab.run('R1', 'crypto key generate rsa')).toMatch(/domain-name/);
    lab.run('R1', 'end');
    conf(lab, 'R1', 'ip domain-name corp.test\ncrypto key generate rsa\nline vty 0 15\ntransport input ssh');
    expect(goal(lab, { reach: { from: 'A', to: '10.1.0.1', proto: 'tcp', port: 22 } }).ok).toBe(true);
    expect(goal(lab, { reach: { from: 'A', to: '10.1.0.1', proto: 'tcp', port: 23 } }).ok).toBe(false);
  });
  it('limits who can log in', () => {
    const lab = box();
    conf(lab, 'R1', 'access-list 5 permit host 10.2.0.2\nline vty 0 15\naccess-class 5 in');
    expect(goal(lab, { reach: { from: 'A', to: '10.1.0.1', proto: 'tcp', port: 23 } }).why).toMatch(/access-class/);
    expect(goal(lab, { reach: { from: 'B', to: '10.2.0.1', proto: 'tcp', port: 23 } }).ok).toBe(true);
  });
});

describe('the config is the whole truth', () => {
  it('printing and loading a config are inverses', () => {
    const lab = firewalled('object network IN\n subnet 10.0.0.0 255.255.255.0\n nat (inside,outside) dynamic interface\naccess-list OUT extended permit tcp any host 172.16.0.80 eq 80\naccess-group OUT in interface outside');
    const before = lab.serialize();
    const after = createLab(lab.topology, before).serialize();
    expect(after).toEqual(before);
    const r = sites();
    vpn(r, 'R1', '10.1.0', '10.2.0', '198.51.100.1');
    conf(r, 'R1', 'router ospf 1\nnetwork 10.0.0.0 0.255.255.255 area 0\nip dhcp excluded-address 10.1.0.1 10.1.0.9\nip dhcp pool P\nnetwork 10.1.0.0 255.255.255.0\ndefault-router 10.1.0.1\nline vty 0 15\nlogin local\ntransport input ssh\nenable secret abc');
    expect(createLab(r.topology, r.serialize()).serialize()).toEqual(r.serialize());
  });
  it('a claim from a client about a locked device is never read', () => {
    const topo = edge().topology;
    const state = { devices: { ISP: { running: 'interface Gi0/0\n shutdown', startup: '' } } };
    expect(gradeLab(topo, state, [{ label: 'x', reach: { from: 'NET', to: '203.0.113.1' } }])[0].ok).toBe(true);
  });
  it('rubbish in a config just fails to apply', () => {
    const topo = edge().topology;
    const state = { devices: { R1: { running: 'interface Gi0/99\n\u0000\nrm -rf /\n'.repeat(50), startup: '' }, NOPE: { running: 'x' } } };
    expect(gradeLab(topo, state, [{ label: 'x', reach: { from: 'PC', to: 'NET' } }])[0].ok).toBe(false);
  });
  it('the same config always gives the same answer', () => {
    const go = () => {
      const lab = edge();
      conf(lab, 'R1', 'access-list 1 permit 10.0.0.0 0.0.0.255\nip nat inside source list 1 interface Gi0/1 overload');
      lab.run('PC', 'curl 198.51.100.10');
      lab.run('R1', 'en');
      return lab.run('R1', 'show ip nat translations');
    };
    expect(go()).toBe(go());
  });
});

describe('stepping through a packet', () => {
  it('records each decision, with the packet as it looked then', () => {
    const lab = edge();
    conf(lab, 'R1', 'access-list 1 permit 10.0.0.0 0.0.0.255\nip nat inside source list 1 interface Gi0/1 overload');
    lab.run('PC', 'curl 198.51.100.10');
    const { there, back } = lab.trace;
    expect(there[0].action).toBe('send');
    expect(there.find((h) => h.action === 'switch').detail).toMatch(/VLAN 1/);
    const nat = there.find((h) => h.action === 'nat');
    expect(nat.detail).toMatch(/10\.0\.0\.5 to 203\.0\.113\.2/);
    expect(nat.pkt.src).toBe('203.0.113.2');
    expect(there.at(-1).action).toBe('deliver');
    expect(back.find((h) => h.action === 'nat').detail).toMatch(/destination/);
  });
  it('says which line let it through and which stopped it', () => {
    const lab = routed();
    conf(lab, 'R1', 'ip access-list extended F\ndeny tcp host 10.1.0.2 any eq 22\npermit ip any any\ninterface g0/0\nip access-group F in');
    lab.run('A', 'curl 10.2.0.2');
    expect(lab.trace.there.find((h) => h.action === 'acl').detail).toMatch(/line 20/);
    lab.run('A', 'nc -z 10.2.0.2 22');
    expect(lab.trace.there.at(-1).action).toBe('drop');
    expect(lab.trace.there.at(-1).detail).toMatch(/line 10/);
  });
  it('shows a packet being wrapped and unwrapped', () => {
    const lab = sites();
    vpn(lab, 'R1', '10.1.0', '10.2.0', '198.51.100.1');
    vpn(lab, 'R2', '10.2.0', '10.1.0', '203.0.113.1');
    lab.run('HQ', 'ping 10.2.0.5');
    const actions = lab.trace.there.map((h) => h.action);
    expect(actions).toContain('encrypt');
    expect(actions).toContain('decrypt');
    expect(lab.trace.there.find((h) => h.action === 'encrypt').pkt.proto).toBe('esp');
    expect(lab.trace.there.find((h) => h.action === 'encrypt').pkt.inner.src).toBe('10.1.0.5');
  });
});

const office6 = () => createLab({
  devices: [
    { name: 'PC', kind: 'pc' }, { name: 'SRV', kind: 'server', config: 'service http start\nip -6 addr add 2001:db8:2::80/64 dev eth0\nip -6 route add default via 2001:db8:2::1' },
    { name: 'SW', kind: 'switch', ports: 4 },
    { name: 'R1', kind: 'router', config: 'interface Gi0/0\n no shutdown\ninterface Gi0/1\n no shutdown' },
  ],
  cables: [['PC', 'eth0', 'SW', 'Gi0/1'], ['R1', 'Gi0/0', 'SW', 'Gi0/4'], ['SRV', 'eth0', 'R1', 'Gi0/1']],
});
const v6Router = 'interface g0/0\nipv6 address 2001:db8:1::1/64\ninterface g0/1\nipv6 address 2001:DB8:2:0::1/64';

describe('IPv6', () => {
  it('prints addresses in their shortest form', () => {
    const lab = office6();
    conf(lab, 'R1', v6Router);
    expect(lab.configOf('R1')).toContain('ipv6 address 2001:db8:2::1/64');
  });
  it('gets an address from the router by itself, once it routes', () => {
    const lab = office6();
    conf(lab, 'R1', v6Router);
    expect(lab.run('PC', 'rdisc6 eth0')).toMatch(/unicast-routing/);
    conf(lab, 'R1', 'ipv6 unicast-routing');
    expect(goal(lab, { v6_addr: { host: 'PC', in: '2001:db8:1::/64' } }).ok).toBe(true);
    expect(lab.run('PC', 'ip -6 addr')).toMatch(/2001:db8:1:0:.*ff:fe/);
  });
  it('routes across subnets and refuses to until told to', () => {
    const lab = office6();
    conf(lab, 'R1', v6Router);
    lab.run('PC', 'ip -6 addr add 2001:db8:1::5/64 dev eth0');
    lab.run('PC', 'ip -6 route add default via 2001:db8:1::1');
    expect(lab.run('PC', 'ping 2001:db8:2::80')).toMatch(/unicast-routing is off/);
    conf(lab, 'R1', 'ipv6 unicast-routing');
    expect(lab.run('PC', 'ping 2001:db8:2::80')).toMatch(/0% packet loss/);
    expect(lab.run('PC', 'curl [2001:db8:2::80]')).toMatch(/200 OK/);
    expect(goal(lab, { reach: { from: 'PC', to: 'SRV', family: 6, proto: 'tcp', port: 80 } }).ok).toBe(true);
  });
  it('an IPv4 list never filters IPv6, which is the classic hole', () => {
    const lab = office6();
    conf(lab, 'R1', `${v6Router}\nipv6 unicast-routing\naccess-list 100 deny ip any any\ninterface g0/0\nip access-group 100 in`);
    lab.run('PC', 'ip -6 addr add 2001:db8:1::5/64 dev eth0');
    lab.run('PC', 'ip -6 route add default via 2001:db8:1::1');
    expect(goal(lab, { reach: { from: 'PC', to: '2001:db8:2::80' } }).ok).toBe(true);
    conf(lab, 'R1', 'ipv6 access-list NOPE\ndeny ipv6 any 2001:db8:2::/64\npermit ipv6 any any\ninterface g0/0\nipv6 traffic-filter NOPE in');
    expect(goal(lab, { reach: { from: 'PC', to: '2001:db8:2::80' } }).why).toMatch(/NOPE.*line 10/);
    conf(lab, 'R1', 'ipv6 access-list NOPE\nno 10\n5 deny tcp any host 2001:db8:2::80 eq 22');
    expect(goal(lab, { reach: { from: 'PC', to: '2001:db8:2::80' } }).ok).toBe(true);
  });
  it('resolves AAAA records, and prefers IPv6 when the host has it', () => {
    const lab = office6();
    conf(lab, 'R1', `${v6Router}\nipv6 unicast-routing\ninterface g0/1\nip address 10.2.0.1 255.255.255.0\ninterface g0/0\nip address 10.1.0.1 255.255.255.0`);
    lab.run('SRV', 'ip addr add 10.2.0.80/24 dev eth0');
    lab.run('SRV', 'ip route add default via 10.2.0.1');
    lab.run('SRV', 'service dns start');
    lab.run('SRV', 'dns add www.corp.test A 10.2.0.80');
    lab.run('SRV', 'dns add www.corp.test AAAA 2001:db8:2::80');
    lab.run('PC', 'ip addr add 10.1.0.5/24 dev eth0');
    lab.run('PC', 'ip route add default via 10.1.0.1');
    lab.run('PC', 'echo nameserver 10.2.0.80 > /etc/resolv.conf');
    expect(lab.run('PC', 'dig www.corp.test')).toMatch(/AAAA\t2001:db8:2::80/);
    lab.run('PC', 'curl www.corp.test');
    expect(lab.trace.dst).toBe('10.2.0.80');
    lab.run('PC', 'rdisc6 eth0');
    lab.run('PC', 'curl www.corp.test');
    expect(lab.trace.dst).toBe('2001:db8:2::80');
  });
  it('a firewall here passes IPv4 only, and says so', () => {
    const lab = firewalled();
    expect(goal(lab, { reach: { from: 'PC', to: '10.0.0.1' } }).ok).toBe(true);
  });
});

const wifi = () => createLab({
  devices: [
    { name: 'LAP', kind: 'laptop', x: 30, y: 50 },
    { name: 'LAP2', kind: 'laptop', x: 35, y: 60 },
    { name: 'AP1', kind: 'ap', x: 40, y: 40, config: 'hostname AP1' },
    { name: 'SW', kind: 'switch', x: 60, y: 40, ports: 4, config: 'vlan 10\nvlan 20\ninterface Gi0/1\n switchport mode trunk\ninterface Gi0/2\n switchport access vlan 10' },
    { name: 'SRV', kind: 'server', x: 80, y: 40, config: 'ip addr add 10.10.0.9/24 dev eth0' },
  ],
  cables: [['AP1', 'Gi0/1', 'SW', 'Gi0/1'], ['SRV', 'eth0', 'SW', 'Gi0/2']],
});
const staff = 'dot11 ssid STAFF\nvlan 10\nauthentication wpa2 Corr3ct-Horse\ninterface Dot11Radio0\nchannel 6\nssid STAFF\nno shutdown\ninterface Gi0/1\nswitchport mode trunk';

describe('Wi-Fi', () => {
  it('shows nothing until a radio is on', () => {
    const lab = wifi();
    expect(lab.run('LAP', 'wifi scan')).toMatch(/No networks/);
    conf(lab, 'AP1', staff);
    expect(lab.run('LAP', 'wifi scan')).toMatch(/STAFF.*wpa2/);
  });
  it('needs the right password', () => {
    const lab = wifi();
    conf(lab, 'AP1', staff);
    expect(lab.run('LAP', 'wifi connect STAFF nope')).toMatch(/wrong password/);
    expect(lab.run('LAP', 'wifi connect STAFF Corr3ct-Horse')).toMatch(/Connected to STAFF through AP1/);
    expect(goal(lab, { wifi_assoc: { host: 'LAP', ssid: 'STAFF', ap: 'AP1' } }).ok).toBe(true);
  });
  it('puts a client in its network\'s VLAN, across the trunk', () => {
    const lab = wifi();
    conf(lab, 'AP1', staff);
    lab.run('LAP', 'wifi connect STAFF Corr3ct-Horse');
    lab.run('LAP', 'ip addr add 10.10.0.5/24 dev wlan0');
    expect(lab.run('LAP', 'ping 10.10.0.9')).toMatch(/0% packet loss/);
    conf(lab, 'AP1', 'dot11 ssid STAFF\nvlan 20');
    expect(goal(lab, { reach: { from: 'LAP', to: '10.10.0.9' } }).ok).toBe(false);
  });
  it('keeps clients apart with isolation, without cutting them off', () => {
    const lab = wifi();
    conf(lab, 'AP1', 'dot11 ssid GUEST\nvlan 10\nauthentication open\ninterface Do0\nchannel 1\nssid GUEST\nno shutdown\ninterface Gi0/1\nswitchport mode trunk');
    for (const [h, ip] of [['LAP', '5'], ['LAP2', '6']]) {
      lab.run(h, 'wifi connect GUEST');
      lab.run(h, `ip addr add 10.10.0.${ip}/24 dev wlan0`);
    }
    expect(goal(lab, { reach: { from: 'LAP', to: 'LAP2' } }).ok).toBe(true);
    conf(lab, 'AP1', 'dot11 ssid GUEST\nclient-isolation');
    expect(goal(lab, { reach: { from: 'LAP', to: 'LAP2' } }).ok).toBe(false);
    expect(goal(lab, { reach: { from: 'LAP', to: '10.10.0.9' } }).ok).toBe(true);
  });
  it('is out of reach when it\'s too far away', () => {
    const lab = createLab({ devices: [{ name: 'LAP', kind: 'laptop', x: 0, y: 0 }, { name: 'AP1', kind: 'ap', x: 90, y: 90 }], cables: [] });
    conf(lab, 'AP1', 'dot11 ssid STAFF\ninterface Do0\nchannel 1\nssid STAFF\nno shutdown');
    expect(lab.run('LAP', 'wifi connect STAFF')).toMatch(/Nothing in range/);
  });
  it('flags neighbours on overlapping channels, and not on 1, 6 and 11', () => {
    const lab = createLab({ devices: ['A', 'B', 'C'].map((n, i) => ({ name: n, kind: 'ap', x: 20 + i * 20, y: 50 })), cables: [] });
    for (const n of ['A', 'B', 'C']) conf(lab, n, 'dot11 ssid S\ninterface Do0\nchannel 6\nssid S\nno shutdown');
    expect(goal(lab, { wifi_clean: {} }).ok).toBe(false);
    lab.run('A', 'en');
    expect(lab.run('A', 'show dot11 neighbors')).toMatch(/Interference/);
    conf(lab, 'A', 'interface Do0\nchannel 1');
    conf(lab, 'C', 'interface Do0\nchannel 11');
    expect(goal(lab, { wifi_clean: {} }).ok).toBe(true);
    conf(lab, 'C', 'interface Do0\nchannel 9');
    expect(goal(lab, { wifi_clean: {} }).why).toMatch(/channel/);
  });
  it('roams to the next access point when one goes off', () => {
    const lab = createLab({ devices: [{ name: 'LAP', kind: 'laptop', x: 40, y: 50 }, { name: 'A1', kind: 'ap', x: 30, y: 50 }, { name: 'A2', kind: 'ap', x: 60, y: 50 }], cables: [] });
    for (const [n, ch] of [['A1', 1], ['A2', 6]]) conf(lab, n, `dot11 ssid S\ninterface Do0\nchannel ${ch}\nssid S\nno shutdown`);
    lab.run('LAP', 'wifi connect S');
    expect(goal(lab, { wifi_assoc: { host: 'LAP', ap: 'A1' } }).ok).toBe(true);
    expect(goal(lab, { survives: { shut: [{ device: 'A1', interface: 'Do0' }], then: [{ wifi_assoc: { host: 'LAP', ap: 'A2' } }] } }).ok).toBe(true);
  });
  it('checks each person with RADIUS', () => {
    const lab = wifi();
    conf(lab, 'SW', 'interface Gi0/1\nswitchport trunk native vlan 10');
    conf(lab, 'AP1', 'dot11 ssid STAFF\nvlan 10\nauthentication enterprise\nradius-server host 10.10.0.9 key S3cret\ninterface Do0\nchannel 1\nssid STAFF\nno shutdown\ninterface Gi0/1\nswitchport mode trunk\nswitchport trunk native vlan 10\ninterface vlan 10\nip address 10.10.0.2 255.255.255.0');
    lab.run('LAP', 'wifi connect STAFF');
    expect(goal(lab, { wifi_assoc: { host: 'LAP' } }).why).toMatch(/username and password/);
    lab.run('LAP', 'wifi connect STAFF amina pw1');
    expect(goal(lab, { wifi_assoc: { host: 'LAP' } }).why).toMatch(/Nothing at 10\.10\.0\.9 is running RADIUS/);
    lab.run('SRV', 'service radius start');
    expect(goal(lab, { wifi_assoc: { host: 'LAP' } }).why).toMatch(/doesn't trust/);
    lab.run('SRV', 'radius add-client 10.10.0.2 S3cret');
    expect(goal(lab, { wifi_assoc: { host: 'LAP' } }).why).toMatch(/refused amina/);
    lab.run('SRV', 'radius add-user amina pw1');
    expect(goal(lab, { wifi_assoc: { host: 'LAP', ssid: 'STAFF' } }).ok).toBe(true);
  });
  it('lets a rogue access point be traced to a switch port', () => {
    const lab = wifi();
    conf(lab, 'AP1', staff);
    lab.run('SW', 'en');
    expect(lab.run('SW', 'show mac address-table')).toMatch(/Gi0\/1/);
  });
  it('its config prints and loads the same', () => {
    const lab = wifi();
    conf(lab, 'AP1', `${staff}\ndot11 ssid GUEST\nvlan 20\nclient-isolation\ninterface Do1\nchannel 36\nssid GUEST\nno shutdown\nradius-server host 10.10.0.9 key K`);
    lab.run('LAP', 'wifi connect STAFF Corr3ct-Horse');
    lab.run('LAP', 'dhclient wlan0');
    expect(createLab(lab.topology, lab.serialize()).serialize()).toEqual(lab.serialize());
  });
  it('draws a client\'s link on the map', () => {
    const lab = wifi();
    conf(lab, 'AP1', staff);
    lab.run('LAP', 'wifi connect STAFF Corr3ct-Horse');
    expect(lab.view().cables.find((c) => c.wifi)).toMatchObject({ a: 'LAP', b: 'AP1' });
  });
});

describe('fault drills', () => {
  const working = () => {
    const lab = edge();
    conf(lab, 'R1', 'access-list 1 permit 10.0.0.0 0.0.0.255\nip nat inside source list 1 interface Gi0/1 overload');
    return lab;
  };
  const goals = [{ label: 'out', reach: { from: 'PC', to: 'NET', proto: 'tcp', port: 80 } }];
  it('breaks something real, and says what', () => {
    const lab = working();
    expect(lab.check(goals)[0].ok).toBe(true);
    const done = injectFaults(lab, goals, 42);
    expect(done).toHaveLength(1);
    expect(lab.check(goals)[0].ok).toBe(false);
    expect(done[0].explain).toMatch(/\w/);
  });
  it('the same seed breaks the same thing, and others vary', () => {
    const picks = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => injectFaults(working(), goals, seed)[0].explain);
    expect(injectFaults(working(), goals, 1)[0].explain).toBe(picks[0]);
    expect(new Set(picks).size).toBeGreaterThan(1);
  });
  it('never touches a locked device', () => {
    expect(faultCandidates(working()).every((f) => !['ISP', 'NET'].includes(f.device))).toBe(true);
  });
  it('can stack several', () => {
    expect(injectFaults(working(), goals, 9, 3).length).toBeGreaterThan(1);
  });
  it('leaves goals about config text out of what counts as broken', () => {
    expect(injectFaults(working(), [{ label: 'x', config: { device: 'R1', contains: 'overload' } }], 1)).toEqual([]);
  });
  it('a reload doesn\'t magically fix it', () => {
    const lab = working();
    injectFaults(lab, goals, 42);
    lab.reload('R1');
    expect(lab.check(goals)[0].ok).toBe(false);
  });
  it('every candidate fault is config that loads cleanly', () => {
    for (const fault of faultCandidates(working())) {
      const copy = working();
      copy.applyLines(fault.device, fault.lines);
      expect(createLab(copy.topology, copy.serialize()).serialize()).toEqual(copy.serialize());
    }
  });
  it('gives the sandbox goals from what works now', () => {
    const lab = working();
    const made = reachabilityGoals(lab);
    expect(made.map((g) => g.label)).toContain('PC can ping WEB');
    expect(injectFaults(lab, made, 3).length).toBe(1);
  });
});

describe('the sandbox', () => {
  const blank = () => createLab({ cabling: true, devices: [], cables: [] });
  it('adds, cables, configures, moves and removes devices', () => {
    const lab = blank();
    expect(lab.addDevice({ name: 'PC-1', kind: 'pc', x: 10, y: 10 })).toBe(true);
    expect(lab.addDevice({ name: 'PC-1', kind: 'pc', x: 10, y: 10 })).toBe(false);
    lab.addDevice({ name: 'PC-2', kind: 'pc', x: 50, y: 10 });
    lab.plug('PC-1', 'eth0', 'PC-2', 'eth0');
    lab.run('PC-1', 'ip addr add 10.0.0.1/24 dev eth0');
    lab.run('PC-2', 'ip addr add 10.0.0.2/24 dev eth0');
    expect(lab.run('PC-1', 'ping 10.0.0.2')).toMatch(/0% packet loss/);
    lab.moveDevice('PC-2', 70, 70);
    expect(lab.view().devices.find((d) => d.name === 'PC-2').x).toBe(70);
    lab.removeDevice('PC-2');
    expect(lab.view().cables).toEqual([]);
    expect(lab.run('PC-1', 'ping 10.0.0.2')).toMatch(/100% packet loss/);
  });
  it('comes back from a save with everything in place', () => {
    const lab = blank();
    lab.addDevice({ name: 'R-1', kind: 'router', x: 10, y: 10 });
    lab.addDevice({ name: 'AP-1', kind: 'ap', x: 30, y: 10 });
    lab.addDevice({ name: 'LAP-1', kind: 'laptop', x: 40, y: 10 });
    lab.run('R-1', 'en');
    lab.run('R-1', 'conf t');
    lab.run('R-1', 'hostname EDGE');
    const again = createLab(JSON.parse(JSON.stringify(lab.topology)), lab.serialize());
    expect(again.configOf('R-1')).toContain('hostname EDGE');
    expect(again.view().devices.map((d) => d.kind).sort()).toEqual(['ap', 'laptop', 'router']);
  });
  it('plays a written solution', () => {
    const lab = createLab({ cabling: true, devices: [{ name: 'A', kind: 'pc' }, { name: 'B', kind: 'pc' }] });
    const said = playSolution(lab, '[cable] A eth0 B eth0\n[A]\nip addr add 10.0.0.1/24 dev eth0\n[B]\nip addr add 10.0.0.2/24 dev eth0\nping 10.0.0.1');
    expect(said.at(-1).said).toMatch(/0% packet loss/);
  });
});
