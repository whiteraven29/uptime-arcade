/* PCs, laptops and servers speak the same Linux tools the Networking track teaches. */
import { inNet, ip2n, isIp, isIp6, lenToMask, n2ip, netOf, norm6, parsePrefix6 } from './addr.js';
import { hostPort } from './device.js';
import { SERVICES, probe, resolve, servicePorts } from './forward.js';
import { scan } from './net.js';

/* What someone types when they think they're on a router. They need to hear where to go, not a list of laptop tools. */
const NETWORK_GEAR_WORDS = new Set(['enable', 'en', 'configure', 'conf', 'show', 'interface', 'int', 'switchport', 'router', 'vlan', 'dot11', 'write']);
const USAGE = "Tools: ip, ping, traceroute, dig, curl, nc, ss, dhclient, rdisc6, cat /etc/resolv.conf. Laptops have wifi, and servers have service, dns and radius. Try 'help'.";
const help = (dev) => {
  const p = hostPort(dev);
  const lines = [
    'ip addr                         show addresses',
    `ip addr add 10.0.0.2/24 dev ${p}  set an address`,
    `ip addr flush dev ${p}          remove it`,
    `ip link set ${p} up|down        turn the port on or off`,
    'ip route                        show routes',
    'ip route add default via 10.0.0.1  set the gateway',
    'ip route del default            remove the gateway',
    'ip neigh                        show what ARP has learned',
    `ip -6 addr add 2001:db8::2/64 dev ${p}  set an IPv6 address`,
    'ip -6 route add default via 2001:db8::1  set the IPv6 gateway',
    `rdisc6 ${p}                     get an IPv6 address from the router (SLAAC)`,
    `dhclient ${p}                   get an address by DHCP`,
    `dhclient -r ${p}                give it back`,
    'ping <address or name>          can I reach it?',
    'traceroute <address or name>    which way does it go?',
    'dig <name> [@server]            look up a name',
    'curl <address or name>[:port]   talk to a web server',
    'nc -z <address or name> <port>  is this TCP port open?',
    'echo nameserver 10.0.0.53 > /etc/resolv.conf  set your DNS server',
    'cat /etc/resolv.conf            show your DNS server',
    'ss -tuln                        what\'s listening here?',
  ];
  if (dev.kind === 'laptop') {
    lines.push('wifi scan                       what Wi-Fi can I see?', 'wifi connect <ssid> [password]  join a network', 'wifi connect <ssid> <user> <password>  join with your own login', 'wifi status                     what am I joined to?', 'wifi disconnect                 leave');
  }
  if (dev.kind === 'server') {
    lines.push(
      `service <name> start|stop       ${SERVICES.join(', ')}`,
      'dns add <name> A <ip>           add a DNS record',
      'dns add <name> AAAA <ipv6>      add an IPv6 record',
      'dns add <name> CNAME <name>     add an alias',
      'dns del <name>                  remove a record',
      'dns list                        list records',
      'radius add-client <ip> <key>    trust an access point',
      'radius add-user <user> <pass>   add a Wi-Fi login',
      'radius list                     show who\'s set up',
    );
  }
  return lines.join('\n');
};
export const HOST_WORDS = ['ip', 'ping', 'traceroute', 'dig', 'curl', 'nc', 'ss', 'dhclient', 'rdisc6', 'cat', 'echo', 'service', 'dns', 'radius', 'wifi', 'help', 'clear', 'hostname'];

function parseCidr(text) {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(text);
  if (!m || !isIp(m[1]) || +m[2] > 32) return null;
  return { ip: m[1], len: +m[2] };
}

/* Names go through DNS, the same as everywhere else. */
function target(lab, net, dev, text) {
  if (isIp(text)) return { ip: text };
  if (isIp6(text)) return { ip: norm6(text) };
  const r = resolve(lab, net, dev, text);
  return r.ok ? { ip: r.ip } : { error: r.why };
}

function ping(lab, net, dev, words) {
  const name = words.filter((w, i) => i > 0 && !w.startsWith('-') && !/^\d+$/.test(w)).at(-1);
  if (!name) return 'Usage: ping <address or name>';
  const to = target(lab, net, dev, name);
  if (to.error) return `ping: ${name}: ${to.error}`;
  const r = probe(lab, net, dev, to.ip, 'icmp');
  lab.setTrace(r);
  if (!r.ok) return `PING ${name} (${to.ip})\n--- ${name} ping statistics ---\n4 packets transmitted, 0 received, 100% packet loss\nWhy: ${r.why}`;
  const ttl = 64 - r.there.filter((h) => h.action === 'route').length;
  const lines = [1, 2, 3, 4].map((i) => `64 bytes from ${to.ip}: icmp_seq=${i} ttl=${ttl} time=${(r.there.length + 1) * 2 / 10}ms`);
  return `PING ${name} (${to.ip})\n${lines.join('\n')}\n--- ${name} ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss`;
}

function traceroute(lab, net, dev, words) {
  const name = words[1];
  if (!name) return 'Usage: traceroute <address or name>';
  const to = target(lab, net, dev, name);
  if (to.error) return `traceroute: ${name}: ${to.error}`;
  const r = probe(lab, net, dev, to.ip, 'icmp');
  lab.setTrace(r);
  const hops = r.there.filter((h) => h.action === 'route' || h.action === 'deliver');
  const lines = hops.map((h, i) => `${String(i + 1).padStart(2)}  ${h.dev} (${h.ip || to.ip})`);
  if (!r.ok) lines.push(`${String(hops.length + 1).padStart(2)}  * * *`, `Why: ${r.why}`);
  return `traceroute to ${name} (${to.ip})\n${lines.join('\n')}`;
}

function dig(lab, net, dev, words) {
  const server = words.find((w) => w.startsWith('@'))?.slice(1) || null;
  const name = words.slice(1).find((w) => !w.startsWith('@'));
  if (!name) return 'Usage: dig <name> [@server]';
  const r = resolve(lab, net, dev, name, server);
  if (r.trip) lab.setTrace(r.trip);
  if (!r.ok && !r.status) return `;; connection timed out; no servers could be reached\nWhy: ${r.why}`;
  const answers = r.chain.map((c) => `${c.name}.\t300\tIN\t${c.type}\t${c.value}`).join('\n');
  return `;; ->>HEADER<<- status: ${r.ok ? 'NOERROR' : r.status}\n;; ANSWER SECTION:\n${answers || ';; (empty)'}\n;; SERVER: ${r.server}#53`;
}

function curl(lab, net, dev, words) {
  const url = words.slice(1).find((w) => !w.startsWith('-'));
  if (!url) return 'Usage: curl <address or name>[:port]';
  const bare = isIp6(url) ? { host: url, port: null, scheme: null } : null;
  const m = bare ? null : /^(?:(https?):\/\/)?(\[[^\]]+\]|[^/:]+)(?::(\d+))?/.exec(url);
  if (!bare && !m) return `curl: bad address ${url}`;
  const host = bare ? bare.host : m[2].replace(/^\[|\]$/g, '');
  const port = bare ? 80 : m[3] ? +m[3] : m[1] === 'https' ? 443 : 80;
  const to = target(lab, net, dev, host);
  if (to.error) return `curl: could not resolve ${host}: ${to.error}`;
  const r = probe(lab, net, dev, to.ip, 'tcp', port);
  lab.setTrace(r);
  if (r.status === 'refused') return `curl: connection refused to ${to.ip} port ${port}\nWhy: ${r.why}`;
  if (!r.ok) return `curl: timed out connecting to ${to.ip} port ${port}\nWhy: ${r.why}`;
  return `HTTP/1.1 200 OK\nServer: ${r.reached}\n\nHello from ${r.reached}`;
}

function nc(lab, net, dev, words) {
  const rest = words.slice(1).filter((w) => !w.startsWith('-'));
  if (rest.length !== 2) return 'Usage: nc -z <address or name> <port>';
  const to = target(lab, net, dev, rest[0]);
  if (to.error) return `nc: ${to.error}`;
  const r = probe(lab, net, dev, to.ip, 'tcp', +rest[1]);
  lab.setTrace(r);
  if (r.ok) return `Connection to ${rest[0]} ${rest[1]} port [tcp] succeeded!`;
  return `nc: connect to ${rest[0]} port ${rest[1]} (tcp) ${r.status === 'refused' ? 'failed: Connection refused' : 'timed out'}\nWhy: ${r.why}`;
}

function ip6Command(lab, net, dev, words) {
  const iface = dev.ifaces.get(hostPort(dev));
  const [sub, verb] = [words[2], words[3]];
  if (sub === 'addr' || sub === 'a' || sub === 'address') {
    if (!verb || verb === 'show') {
      const rows = iface.ip6.map((a) => `    inet6 ${a.addr}/${a.len} scope global${a.auto ? ' dynamic' : ''}`);
      return `2: ${iface.name}\n${rows.join('\n') || '    (no IPv6 address)'}`;
    }
    if (verb === 'add') {
      const p = parsePrefix6(words[4] || '');
      if (!p) return `Usage: ip -6 addr add 2001:db8::2/64 dev ${iface.name}`;
      iface.ip6 = iface.ip6.filter((a) => a.addr !== p.addr);
      iface.ip6.push(p);
      return '';
    }
    if (verb === 'flush' || verb === 'del') {
      iface.ip6 = [];
      return '';
    }
  }
  if (sub === 'route' || sub === 'r') {
    if (!verb || verb === 'show') {
      const rows = (net?.tables6.get(dev.name) || []).map((r) => (r.via ? `${r.len === 0 ? 'default' : `${r.prefix}/${r.len}`} via ${r.via} dev ${r.iface}` : `${r.prefix}/${r.len} dev ${r.iface}`));
      return rows.join('\n') || '(no IPv6 routes)';
    }
    if (verb === 'add' && words[4] === 'default' && words[5] === 'via' && isIp6(words[6] || '')) {
      dev.gateway6 = norm6(words[6]);
      dev.gatewayAuto = false;
      return '';
    }
    if (verb === 'del' && words[4] === 'default') {
      dev.gateway6 = null;
      return '';
    }
  }
  return 'Usage: ip -6 addr or ip -6 route. See help.';
}

function ipCommand(lab, net, dev, words) {
  if (words[1] === '-6') return ip6Command(lab, net, dev, words);
  const port = hostPort(dev);
  const iface = dev.ifaces.get(port);
  const [sub, verb] = [words[1], words[2]];
  if (sub === 'addr' || sub === 'a' || sub === 'address') {
    if (!verb || verb === 'show') {
      const state = net && !dev.linkDown && net.tables.get(dev.name)?.length ? 'UP' : 'DOWN';
      const six = iface.ip6.map((a) => `\n    inet6 ${a.addr}/${a.len} scope global${a.auto ? ' dynamic' : ''}`).join('');
      return `2: ${port}: <${state}>\n    link/ether ${iface.mac}\n${iface.ip ? `    inet ${iface.ip}/${iface.len} scope global${dev.dhcpOn ? ' dynamic' : ''} ${port}` : '    (no address)'}${six}`;
    }
    if (verb === 'add') {
      const cidr = parseCidr(words[3] || '');
      if (!cidr) return `Usage: ip addr add 10.0.0.2/24 dev ${port}`;
      if (words[5] && words[5] !== port) return `Cannot find device "${words[5]}"`;
      iface.ip = cidr.ip;
      iface.len = cidr.len;
      dev.dhcpOn = false;
      return '';
    }
    if (verb === 'flush' || verb === 'del') {
      iface.ip = null;
      iface.len = null;
      return '';
    }
  }
  if (sub === 'link' && verb === 'set') {
    if (words[3] !== port || !['up', 'down'].includes(words[4])) return `Usage: ip link set ${port} up|down`;
    dev.linkDown = words[4] === 'down';
    return '';
  }
  if (sub === 'route' || sub === 'r') {
    if (!verb || verb === 'show') {
      const lines = [];
      if (dev.gateway) lines.push(`default via ${dev.gateway} dev ${port}`);
      for (const r of dev.extraRoutes) lines.push(`${n2ip(r.net)}/${r.len} via ${r.via} dev ${port}`);
      if (iface.ip) lines.push(`${n2ip(netOf(iface.ip, iface.len))}/${iface.len} dev ${port} scope link src ${iface.ip}`);
      return lines.join('\n') || '(no routes)';
    }
    if (verb === 'add' && words[4] === 'via' && isIp(words[5] || '')) {
      if (words[3] === 'default') {
        dev.gateway = words[5];
        return '';
      }
      const cidr = parseCidr(words[3]);
      if (!cidr) return 'Usage: ip route add default via 10.0.0.1';
      dev.extraRoutes = dev.extraRoutes.filter((r) => !(r.net === netOf(cidr.ip, cidr.len) && r.len === cidr.len));
      dev.extraRoutes.push({ net: netOf(cidr.ip, cidr.len), len: cidr.len, via: words[5] });
      return '';
    }
    if (verb === 'del') {
      if (words[3] === 'default') dev.gateway = null;
      else {
        const cidr = parseCidr(words[3] || '');
        if (cidr) dev.extraRoutes = dev.extraRoutes.filter((r) => !(r.net === netOf(cidr.ip, cidr.len) && r.len === cidr.len));
      }
      return '';
    }
    return 'Usage: ip route add default via 10.0.0.1';
  }
  if (sub === 'neigh' || sub === 'n') {
    const arp = lab.runtime.arp.get(dev.name);
    return arp?.size ? [...arp].map(([ip, a]) => `${ip} dev ${a.iface} lladdr ${a.mac}`).join('\n') : '(nothing learned yet)';
  }
  return 'Usage: ip addr, ip link, ip route, ip neigh or ip -6. See help.';
}

function serviceCommand(dev, words) {
  if (dev.kind !== 'server') return 'service: only servers run services here.';
  const [name, action] = [words[1], words[2]];
  if (!SERVICES.includes(name) || !['start', 'stop'].includes(action)) return `Usage: service <name> start|stop. Names: ${SERVICES.join(', ')}`;
  if (action === 'start') dev.services.add(name);
  else dev.services.delete(name);
  return '';
}

function dnsCommand(dev, words) {
  if (dev.kind !== 'server') return 'dns: only servers hold DNS records here.';
  if (words[1] === 'list') {
    const rows = [...dev.records].map(([name, r]) => [name, r.type, r.value]).concat([...dev.records6].map(([name, v]) => [name, 'AAAA', v]));
    if (!rows.length) return '(no records)';
    return rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, type, value]) => `${name}\tIN\t${type}\t${value}`).join('\n');
  }
  if (words[1] === 'del' && words[2]) {
    dev.records.delete(words[2].toLowerCase());
    dev.records6.delete(words[2].toLowerCase());
    return '';
  }
  if (words[1] === 'add' && words.length === 5) {
    const type = words[3].toUpperCase();
    if (dev.records.size + dev.records6.size >= 64) return 'dns: this zone is full.';
    if (type === 'AAAA') {
      if (!isIp6(words[4])) return `dns: ${words[4]} isn't an IPv6 address.`;
      dev.records6.set(words[2].toLowerCase(), norm6(words[4]));
      return '';
    }
    if (type === 'A' && !isIp(words[4])) return `dns: ${words[4]} isn't an IP address.`;
    if (type !== 'A' && type !== 'CNAME') return 'dns: this server holds A, AAAA and CNAME records.';
    dev.records.set(words[2].toLowerCase(), { type, value: words[4] });
    return '';
  }
  return 'Usage: dns add <name> A <ip>, dns add <name> AAAA <ipv6>, dns add <name> CNAME <name>, dns del <name> or dns list';
}

function radiusCommand(dev, words) {
  if (dev.kind !== 'server') return 'radius: only servers run RADIUS here.';
  if (words[1] === 'add-client' && isIp(words[2] || '') && words[3]) {
    dev.radiusClients.set(words[2], words[3]);
    return '';
  }
  if (words[1] === 'add-user' && words[2] && words[3]) {
    if (dev.radiusUsers.size >= 64) return 'radius: that\'s enough users for one lab.';
    dev.radiusUsers.set(words[2], words[3]);
    return '';
  }
  if (words[1] === 'del-user' && words[2]) {
    dev.radiusUsers.delete(words[2]);
    return '';
  }
  if (words[1] === 'list') return `Clients: ${[...dev.radiusClients.keys()].join(', ') || 'none'}\nUsers: ${[...dev.radiusUsers.keys()].join(', ') || 'none'}`;
  return 'Usage: radius add-client <ip> <key>, radius add-user <user> <password>, radius del-user <user> or radius list';
}

function wifiCommand(lab, dev, words, replaying) {
  if (dev.kind !== 'laptop') return 'wifi: this machine has no radio.';
  if (words[1] === 'connect' && words[2]) {
    dev.wifi = { ssid: words[2], key: words.length === 4 ? words[3] : null, user: words.length === 5 ? words[3] : null, pass: words.length === 5 ? words[4] : null };
    lab.touch();
    if (replaying) return '';
    const net = lab.net();
    const assoc = net.air.assoc.get(dev.name);
    return assoc ? `Connected to ${assoc.ssid} through ${assoc.ap}, channel ${assoc.channel}, signal ${assoc.signal} dBm.` : `Couldn't connect to ${words[2]}.\nWhy: ${net.air.why.get(dev.name) ?? 'Nothing answered'}`;
  }
  if (words[1] === 'disconnect') {
    dev.wifi = null;
    lab.touch();
    return '';
  }
  const net = lab.net();
  if (words[1] === 'status') {
    const assoc = net.air.assoc.get(dev.name);
    if (assoc) return `Connected to ${assoc.ssid} through ${assoc.ap}, channel ${assoc.channel}, signal ${assoc.signal} dBm.`;
    return dev.wifi ? `Not connected to ${dev.wifi.ssid}.\nWhy: ${net.air.why.get(dev.name) ?? 'Nothing answered'}` : 'Not connected.';
  }
  if (words[1] === 'scan') {
    const rows = scan(lab, dev).map((o) => `${o.ssid.name.padEnd(18)}${String(o.signal).padEnd(8)}${String(o.radio.channel).padEnd(7)}${o.ssid.auth.padEnd(12)}${o.ap.name}`);
    return rows.length ? `${'SSID'.padEnd(18)}${'Signal'.padEnd(8)}${'Chan'.padEnd(7)}${'Security'.padEnd(12)}Access point\n${rows.join('\n')}` : 'No networks in range.';
  }
  return 'Usage: wifi scan, wifi connect <ssid> [password], wifi connect <ssid> <user> <password>, wifi status or wifi disconnect';
}

const NEEDS_NETWORK = new Set(['ip', 'ping', 'traceroute', 'tracepath', 'dig', 'curl', 'nc']);

/* `replaying` is true when a saved config is being loaded: the commands apply without working anything out. */
export function hostRun(lab, dev, line, replaying = false) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const net = !replaying && NEEDS_NETWORK.has(words[0]) ? lab.net() : null;
  const port = hostPort(dev);
  const iface = dev.ifaces.get(port);
  let out;
  switch (words[0]) {
    case 'help': case '?': out = help(dev); break;
    case 'hostname': out = dev.name; break;
    case 'ip': out = ipCommand(lab, net, dev, words); lab.touch(); break;
    case 'ping': out = ping(lab, net, dev, words); break;
    case 'traceroute': case 'tracepath': out = traceroute(lab, net, dev, words); break;
    case 'dig': out = dig(lab, net, dev, words); break;
    case 'curl': out = curl(lab, net, dev, words); break;
    case 'nc': out = nc(lab, net, dev, words); break;
    case 'service': out = serviceCommand(dev, words); lab.touch(); break;
    case 'dns': out = dnsCommand(dev, words); lab.touch(); break;
    case 'radius': out = radiusCommand(dev, words); lab.touch(); break;
    case 'wifi': out = wifiCommand(lab, dev, words, replaying); break;
    case 'rdisc6':
      dev.slaac = true;
      lab.touch();
      if (replaying) return '';
      {
        const after = lab.net();
        const auto = iface.ip6.find((a) => a.auto);
        out = auto ? `Router advertisement received\nAddress: ${auto.addr}/64\nGateway: ${dev.gateway6}` : `No router advertisement received.\nWhy: ${after.slaacWhy.get(dev.name) ?? 'Nothing answered'}`;
      }
      break;
    case 'dhclient':
      if (words[1] === '-r') {
        dev.dhcpOn = false;
        iface.ip = null;
        iface.len = null;
        dev.gateway = null;
        dev.dhcpDns = null;
        lab.touch();
        out = '';
      } else {
        dev.dhcpOn = true;
        lab.touch();
        if (replaying) return '';
        const after = lab.net();
        out = iface.ip ? `DHCPDISCOVER on ${port}\nDHCPOFFER of ${iface.ip}\nDHCPREQUEST for ${iface.ip}\nDHCPACK of ${iface.ip}\nbound to ${iface.ip}, gateway ${dev.gateway ?? 'none'}, DNS ${dev.dhcpDns ?? 'none'}` : `DHCPDISCOVER on ${port}\nNo DHCPOFFERS received.\nWhy: ${after.dhcpWhy.get(dev.name) ?? 'Nothing answered'}`;
      }
      break;
    case 'cat':
      out = words[1] === '/etc/resolv.conf' ? `nameserver ${dev.nameserver || dev.dhcpDns || '(none)'}` : `cat: ${words[1] ?? ''}: not on this box. Only /etc/resolv.conf is.`;
      break;
    case 'echo': {
      const m = /^echo\s+["']?nameserver\s+(\S+?)["']?\s*>\s*\/etc\/resolv\.conf$/.exec(line.trim());
      if (m && isIp(m[1])) {
        dev.nameserver = m[1];
        lab.touch();
        out = '';
      } else out = 'Usage: echo nameserver 10.0.0.53 > /etc/resolv.conf';
      break;
    }
    case 'ss': {
      const rows = [...dev.services].flatMap((s) => servicePorts(s).map(([p, n]) => `${p}   LISTEN   0.0.0.0:${n}   ${s}`));
      out = `Netid State    Local Address\n${rows.join('\n') || '(nothing is listening)'}`;
      break;
    }
    case 'nameserver':
      if (isIp(words[1] || '')) dev.nameserver = words[1];
      lab.touch();
      out = '';
      break;
    default:
      out = NETWORK_GEAR_WORDS.has(words[0].toLowerCase())
        ? `${words[0]}: that's for routers, switches, firewalls and access points, and ${dev.name} is a ${dev.kind}. Click one of those on the map to open its console.`
        : `${words[0]}: command not found. ${USAGE}`;
  }
  return out;
}

export function hostConfig(dev) {
  const port = hostPort(dev);
  const iface = dev.ifaces.get(port);
  const lines = [];
  if (dev.linkDown) lines.push(`ip link set ${port} down`);
  if (dev.wifi) lines.push(`wifi connect ${dev.wifi.ssid}${dev.wifi.user ? ` ${dev.wifi.user} ${dev.wifi.pass}` : dev.wifi.key ? ` ${dev.wifi.key}` : ''}`);
  if (dev.dhcpOn) lines.push(`dhclient ${port}`);
  else {
    if (iface.ip) lines.push(`ip addr add ${iface.ip}/${iface.len} dev ${port}`);
    if (dev.gateway) lines.push(`ip route add default via ${dev.gateway}`);
  }
  for (const r of dev.extraRoutes) lines.push(`ip route add ${n2ip(r.net)}/${r.len} via ${r.via}`);
  for (const a of iface.ip6) if (!a.auto) lines.push(`ip -6 addr add ${a.addr}/${a.len} dev ${port}`);
  if (dev.slaac) lines.push(`rdisc6 ${port}`);
  else if (dev.gateway6) lines.push(`ip -6 route add default via ${dev.gateway6}`);
  if (dev.nameserver) lines.push(`nameserver ${dev.nameserver}`);
  for (const s of [...dev.services].sort()) lines.push(`service ${s} start`);
  for (const [name, r] of [...dev.records].sort((a, b) => (a[0] < b[0] ? -1 : 1))) lines.push(`dns add ${name} ${r.type} ${r.value}`);
  for (const [name, v] of [...dev.records6].sort((a, b) => (a[0] < b[0] ? -1 : 1))) lines.push(`dns add ${name} AAAA ${v}`);
  for (const [ip, key] of dev.radiusClients) lines.push(`radius add-client ${ip} ${key}`);
  for (const [user, pass] of dev.radiusUsers) lines.push(`radius add-user ${user} ${pass}`);
  return lines.join('\n');
}
export { inNet, ip2n, lenToMask };
