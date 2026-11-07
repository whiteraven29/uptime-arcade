/* The part of a network OS everyone feels: abbreviations, ?, Tab and the caret under what went wrong. Commands
   are patterns of words and <typed> values, so all of that comes for free for every command. */
import { isIp, isIp6, maskToLen, parsePrefix6, portOf } from './addr.js';
import { ifaceName } from './device.js';

const VALUE = {
  '<ip>': isIp,
  '<ip6>': isIp6,
  '<ip6p>': (t) => parsePrefix6(t) !== null,
  '<anyip>': (t) => isIp(t) || isIp6(t),
  '<mask>': (t) => maskToLen(t) !== null,
  '<wild>': isIp,
  '<n>': (t) => /^\d{1,9}$/.test(t),
  '<word>': (t) => t.length > 0 && t.length <= 64,
  '<if>': (t) => ifaceName(t) !== null,
  '<port>': (t) => portOf(t) !== null,
  '<ipm>': (t) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(t),
};
const isLiteral = (p) => !p.startsWith('<');

export const entry = (pattern, run, help = '') => ({ parts: pattern.split(' '), run, help, pattern });
export const tokenize = (line) => line.trim().split(/\s+/).filter(Boolean);

/* "interface gigabitethernet 0/1" names one interface. Only after "interface", because "vlan 10" alone is a VLAN. */
export function joinIfaceTokens(tokens) {
  const out = [];
  for (const t of tokens) {
    if (out.length > 1 && /^int/i.test(out.at(-2)) && /^(gigabitethernet|gig|gi|tunnel|vlan|loopback)$/i.test(out.at(-1)) && /^\d/.test(t)) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

/* Narrow the patterns one word at a time. Words beat values, and an exact word beats an abbreviation. */
function narrow(candidates, word, pos) {
  const lower = word.toLowerCase();
  const passing = candidates.filter((c) => {
    const part = c.parts[pos];
    if (part === undefined) return false;
    if (part === '<text>') return true;
    if (isLiteral(part)) return part.startsWith(lower);
    return VALUE[part](word);
  });
  const exact = passing.filter((c) => c.parts[pos] === lower);
  if (exact.length) return { list: exact };
  const literal = passing.filter((c) => c.parts[pos] && isLiteral(c.parts[pos]));
  if (literal.length) {
    const words = new Set(literal.map((c) => c.parts[pos]));
    return words.size > 1 ? { list: literal, ambiguous: true } : { list: literal };
  }
  return { list: passing };
}

export function match(table, line) {
  const tokens = joinIfaceTokens(tokenize(line));
  let list = table;
  const args = [];
  for (let pos = 0; pos < tokens.length; pos++) {
    const greedy = list.filter((c) => c.parts[pos] === '<text>');
    const { list: next, ambiguous } = narrow(list, tokens[pos], pos);
    if (!next.length) return { error: 'invalid', at: tokens.slice(0, pos).join(' ').length + (pos ? 1 : 0) };
    if (ambiguous) return { error: 'ambiguous', word: tokens[pos] };
    if (greedy.length && next.every((c) => c.parts[pos] === '<text>')) {
      args.push(tokens.slice(pos).join(' '));
      return { hit: greedy[0], args };
    }
    if (!isLiteral(next[0].parts[pos])) args.push(tokens[pos]);
    list = next;
  }
  const done = list.filter((c) => c.parts.length === tokens.length);
  if (!done.length) return { error: 'incomplete' };
  return { hit: done[0], args };
}

/* What could come next, for ? and for Tab. */
export function nextWords(table, line) {
  const trailing = /\s$/.test(line) || line === '';
  const tokens = joinIfaceTokens(tokenize(line));
  const settled = trailing ? tokens : tokens.slice(0, -1);
  let list = table;
  for (let pos = 0; pos < settled.length; pos++) {
    const { list: next } = narrow(list, settled[pos], pos);
    list = next;
  }
  const pos = settled.length;
  const partial = trailing ? '' : tokens.at(-1).toLowerCase();
  const seen = new Map();
  for (const c of list) {
    const part = c.parts[pos];
    if (part === undefined) seen.set('<cr>', '');
    else if (!isLiteral(part) || part.startsWith(partial)) if (!seen.has(part)) seen.set(part, c.help);
  }
  return { words: [...seen.keys()], partial, settled: settled.length };
}
