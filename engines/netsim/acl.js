/* Access lists: parsing what people type, and first match wins. The implicit deny at the end is real. */
import { in6, isIp, isIp6, lenToWild, maskToLen, norm6, parsePrefix6, portOf, wildMatch } from './addr.js';

const PROTOS = new Set(['ip', 'icmp', 'tcp', 'udp', 'gre', 'esp', 'ahp', 'ospf']);
const ANY = { ip: '0.0.0.0', wild: '255.255.255.255' };

function address(t, i, firewall, dev) {
  if (t[i] === 'any') return { spec: ANY, next: i + 1 };
  if (t[i] === 'host' && isIp(t[i + 1])) return { spec: { ip: t[i + 1], wild: '0.0.0.0' }, next: i + 2 };
  if (t[i] === 'object' && firewall && dev.objects.has(t[i + 1])) {
    const o = dev.objects.get(t[i + 1]);
    return { spec: { ip: o.ip, wild: lenToWild(o.len) }, next: i + 2 };
  }
  if (isIp(t[i])) {
    // A firewall writes a mask where a router writes a wildcard, and mixing them up is a classic mistake.
    if (isIp(t[i + 1])) {
      if (firewall) {
        const len = maskToLen(t[i + 1]);
        return len === null ? null : { spec: { ip: t[i], wild: lenToWild(len) }, next: i + 2 };
      }
      return { spec: { ip: t[i], wild: t[i + 1] }, next: i + 2 };
    }
    return { spec: { ip: t[i], wild: '0.0.0.0' }, next: i + 1 };
  }
  return null;
}

function ports(t, i) {
  const op = t[i];
  if (op === 'eq' || op === 'gt' || op === 'lt' || op === 'neq') {
    const p = portOf(t[i + 1]);
    return p === null ? null : { spec: { op, a: p }, next: i + 2 };
  }
  if (op === 'range') {
    const [a, b] = [portOf(t[i + 1]), portOf(t[i + 2])];
    return a === null || b === null ? null : { spec: { op, a, b }, next: i + 3 };
  }
  return { spec: null, next: i };
}

/* Returns the entry, or null if it isn't a valid line. */
export function parseEntry(tokens, type, dev) {
  if (type === 'ipv6') return parseEntry6(tokens);
  const firewall = dev.kind === 'firewall';
  const t = tokens.map((x) => (isIp(x) ? x : x.toLowerCase()));
  const action = t[0];
  if (action !== 'permit' && action !== 'deny') return null;
  const text = tokens.join(' ');
  if (type === 'standard') {
    const src = address(t, 1, false, dev);
    if (!src || src.next !== t.length) return null;
    return { action, proto: 'ip', src: src.spec, dst: ANY, text, hits: 0 };
  }
  const proto = t[1];
  if (!PROTOS.has(proto)) return null;
  const src = address(t, 2, firewall, dev);
  if (!src) return null;
  const sp = proto === 'tcp' || proto === 'udp' ? ports(t, src.next) : { spec: null, next: src.next };
  if (!sp) return null;
  const dst = address(t, sp.next, firewall, dev);
  if (!dst) return null;
  const dp = proto === 'tcp' || proto === 'udp' ? ports(t, dst.next) : { spec: null, next: dst.next };
  if (!dp) return null;
  const e = { action, proto, src: src.spec, sport: sp.spec, dst: dst.spec, dport: dp.spec, established: false, icmpType: null, log: false, text, hits: 0 };
  for (const word of t.slice(dp.next)) {
    if (word === 'established' && proto === 'tcp') e.established = true;
    else if (word === 'log') e.log = true;
    else if ((word === 'echo' || word === 'echo-reply') && proto === 'icmp') e.icmpType = word;
    else return null;
  }
  return e;
}

/* IPv6 lists write prefixes, and they're separate from IPv4 lists on purpose: one never filters the other. */
function address6(t, i) {
  if (t[i] === 'any') return { spec: { any: true }, next: i + 1 };
  if (t[i] === 'host' && isIp6(t[i + 1])) return { spec: { addr: norm6(t[i + 1]), len: 128 }, next: i + 2 };
  const p = t[i] ? parsePrefix6(t[i]) : null;
  return p ? { spec: p, next: i + 1 } : null;
}
export function parseEntry6(tokens) {
  const t = tokens.map((x) => x.toLowerCase());
  const [action, proto] = t;
  if ((action !== 'permit' && action !== 'deny') || !['ipv6', 'icmp', 'tcp', 'udp'].includes(proto)) return null;
  const src = address6(t, 2);
  if (!src) return null;
  const dst = address6(t, src.next);
  if (!dst) return null;
  const dp = proto === 'tcp' || proto === 'udp' ? ports(t, dst.next) : { spec: null, next: dst.next };
  if (!dp || dp.next !== t.length) return null;
  return { v6: true, action, proto: proto === 'ipv6' ? 'ip' : proto, src: src.spec, dst: dst.spec, sport: null, dport: dp.spec, text: t.join(' '), hits: 0 };
}
const match6 = (spec, addr) => spec.any || in6(addr, spec.addr, spec.len);

const portOk = (spec, p) => {
  if (!spec) return true;
  if (spec.op === 'eq') return p === spec.a;
  if (spec.op === 'neq') return p !== spec.a;
  if (spec.op === 'gt') return p > spec.a;
  if (spec.op === 'lt') return p < spec.a;
  return p >= spec.a && p <= spec.b;
};

function entryMatches(e, pkt) {
  if (e.proto !== 'ip' && e.proto !== pkt.proto) return false;
  if (e.v6) return match6(e.src, pkt.src) && match6(e.dst, pkt.dst) && (!(e.proto === 'tcp' || e.proto === 'udp') || portOk(e.dport, pkt.dport));
  if (!wildMatch(pkt.src, e.src.ip, e.src.wild) || !wildMatch(pkt.dst, e.dst.ip, e.dst.wild)) return false;
  if (e.proto === 'tcp' || e.proto === 'udp') {
    if (!portOk(e.sport, pkt.sport) || !portOk(e.dport, pkt.dport)) return false;
  }
  if (e.established && !pkt.ack) return false;
  if (e.icmpType && (e.icmpType === 'echo') === !!pkt.reply) return false;
  return true;
}

/* Which line decides this packet. `count` is off when only asking, so a check doesn't run up the counters. */
export function evaluate(acl, pkt, count = true) {
  for (const e of acl.entries) {
    if (entryMatches(e, pkt)) {
      if (count) e.hits++;
      return { permit: e.action === 'permit', seq: e.seq, text: e.text };
    }
  }
  return { permit: false, seq: null, text: 'implicit deny' };
}

export const nextSeq = (acl) => (acl.entries.length ? acl.entries.at(-1).seq + 10 : 10);
export function addEntry(acl, entry, seq = null) {
  entry.seq = seq ?? nextSeq(acl);
  acl.entries = acl.entries.filter((e) => e.seq !== entry.seq);
  acl.entries.push(entry);
  acl.entries.sort((a, b) => a.seq - b.seq);
}
export const isNumberedStandard = (name) => /^\d+$/.test(name) && (+name < 100 || (+name >= 1300 && +name <= 1999));
