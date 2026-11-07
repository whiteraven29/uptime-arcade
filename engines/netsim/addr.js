/* Addresses as numbers. Everything else in the simulator leans on these few helpers. */
export const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((o) => +o <= 255);
export const ip2n = (s) => s.split('.').reduce((a, o) => a * 256 + +o, 0);
export const n2ip = (n) => [24, 16, 8, 0].map((b) => Math.floor(n / 2 ** b) % 256).join('.');
export const lenToMaskN = (len) => (len === 0 ? 0 : (0xffffffff - (2 ** (32 - len) - 1)));
export const lenToMask = (len) => n2ip(lenToMaskN(len));
export function maskToLen(mask) {
  if (!isIp(mask)) return null;
  const n = ip2n(mask);
  for (let len = 0; len <= 32; len++) if (lenToMaskN(len) === n) return len;
  return null;
}
export const wildToLen = (wild) => (isIp(wild) ? maskToLen(n2ip(0xffffffff - ip2n(wild))) : null);
export const lenToWild = (len) => n2ip(0xffffffff - lenToMaskN(len));
const hi = (n) => Math.floor(n / 65536);
const lo = (n) => n % 65536;
/* JavaScript's bit operators stop at 31 bits, so each 16-bit half is compared on its own. */
export function andN(a, b) {
  return (hi(a) & hi(b)) * 65536 + ((lo(a) & lo(b)) >>> 0);
}
export const netOf = (ip, len) => andN(ip2n(ip), lenToMaskN(len));
export const inNet = (ip, net, len) => netOf(ip, len) === (typeof net === 'number' ? net : netOf(net, len));
export const broadcastOf = (ip, len) => netOf(ip, len) + 2 ** (32 - len) - 1;
export const wildMatch = (ip, base, wild) => {
  const mask = 0xffffffff - ip2n(wild);
  return andN(ip2n(ip), mask) === andN(ip2n(base), mask);
};
/* A stable MAC for each device and port, so the same lab always shows the same table. */
export function macOf(name, port = '') {
  let h = 2166136261;
  for (const c of `${name}/${port}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `02aa.${hex.slice(0, 4)}.${hex.slice(4)}`;
}
const PORT_NAMES = { radius: 1812, ftp: 21, ssh: 22, telnet: 23, smtp: 25, domain: 53, www: 80, http: 80, ntp: 123, https: 443, bootps: 67, bootpc: 68, isakmp: 500 };
export const portOf = (s) => (PORT_NAMES[s] !== undefined ? PORT_NAMES[s] : /^\d+$/.test(s) && +s <= 65535 ? +s : null);

/* ---------- IPv6: 128-bit numbers, so these use BigInt, and addresses are always kept in their shortest form ---------- */
export function isIp6(text) {
  if (typeof text !== 'string' || !/^[0-9a-f:]+$/i.test(text) || !text.includes(':') || text.length > 39) return false;
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const groups = (h) => (h === '' ? [] : h.split(':'));
  const all = [...groups(halves[0]), ...(halves.length === 2 ? groups(halves[1]) : [])];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}
export function ip6n(text) {
  const [head, tail] = text.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const zeros = text.includes('::') ? 8 - a.length - b.length : 0;
  return [...a, ...Array(zeros).fill('0'), ...b].reduce((n, g) => (n << 16n) + BigInt(`0x${g}`), 0n);
}
export function n2ip6(value) {
  const parts = [];
  for (let i = 7n; i >= 0n; i--) parts.push(((value >> (i * 16n)) & 0xffffn).toString(16));
  // The longest run of zeros becomes ::, as every tool prints it.
  let best = [-1, 0];
  for (let i = 0; i < 8;) {
    if (parts[i] !== '0') { i++; continue; }
    let j = i;
    while (j < 8 && parts[j] === '0') j++;
    if (j - i > best[1] && j - i > 1) best = [i, j - i];
    i = j;
  }
  if (best[0] < 0) return parts.join(':');
  return `${parts.slice(0, best[0]).join(':')}::${parts.slice(best[0] + best[1]).join(':')}`;
}
export const norm6 = (text) => n2ip6(ip6n(text));
export const mask6 = (len) => ((1n << BigInt(len)) - 1n) << BigInt(128 - len);
export const net6 = (addr, len) => ip6n(addr) & mask6(len);
export const in6 = (addr, prefix, len) => net6(addr, len) === net6(prefix, len);
/* A host's own address from its router's prefix and its MAC, the way SLAAC does it. */
export function eui64(prefix, mac) {
  const hex = mac.replace(/\./g, '');
  const first = (parseInt(hex.slice(0, 2), 16) ^ 2).toString(16).padStart(2, '0');
  const id = BigInt(`0x${first}${hex.slice(2, 6)}fffe${hex.slice(6)}`);
  return n2ip6(net6(prefix, 64) | id);
}
export const parsePrefix6 = (text) => {
  const m = /^([0-9a-f:]+)\/(\d{1,3})$/i.exec(text);
  return m && isIp6(m[1]) && +m[2] <= 128 ? { addr: norm6(m[1]), len: +m[2] } : null;
};
