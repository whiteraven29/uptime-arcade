/* Mission goals as data (the expect rules in content/schema). The runner in M9 and the server's grader
   apply the same rules, so a goal means one thing everywhere. No React, no DOM. */
import { S } from '../host.js';
import { HOME, fs } from './index.js';

const path = (p) => p.replace(/^~(?=\/|$)/, HOME);
const BITS = { r: 0o400, w: 0o200, x: 0o100 };

const RULES = {
  file_exists: (p) => !!fs.get(path(p)),
  file_missing: (p) => !fs.get(path(p)),
  file_equals: ({ path: p, content }) => fs.get(path(p))?.c === content,
  file_contains: ({ path: p, text }) => !!fs.get(path(p))?.c?.includes(text),
  mode_has: ({ path: p, bit }) => !!((fs.get(path(p))?.m ?? 0) & BITS[bit]),
  cwd_is: (p) => S.cwd === path(p),
  gateway_is: (ip) => S.net?.gw === ip,
  script_ran: (p) => S.ranScript === path(p),
  vi_saved: (p) => (S.viKeys[path(p)] || 0) > 0,
  vi_used: ({ path: p, keys }) => keys.every((k) => (S.viUsed?.[path(p)] || []).includes(k)),
};

export function evalExpect(rules) {
  return rules.every((rule) => {
    const [name, arg] = Object.entries(rule)[0];
    return RULES[name](arg);
  });
}
