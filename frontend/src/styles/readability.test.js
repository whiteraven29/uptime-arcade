/* Text has to stay easy to read, whatever the styling does. These work from the real colour tokens, so a
   change that makes the terminal harder on the eyes fails the build. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const hud = readFileSync(new URL('./hud.css', import.meta.url), 'utf8');

const token = (name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens);
  if (!m) throw new Error(`no token --${name}`);
  return m[1].trim();
};
function parse(colour) {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(colour);
  const [r, g, b, a = 1] = rgb[1].split(',').map(Number);
  return { r, g, b, a };
}
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});
const luminance = ({ r, g, b }) => {
  const part = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* The rules that style text in the terminal, the code editor, vi and the Go reader. */
const terminalRules = hud.split('\n').filter((l) => /^\.(term-out|t-[a-z]+|prompt|code-out|code-line|go-reader|vi-text|vi-status|ghost)/.test(l));

describe('terminal text', () => {
  const bg = parse(token('term-bg'));
  it.each(['term-text', 'term-cmd', 'term-where', 'term-dim', 'term-error', 'term-warn', 'term-ok'])('%s reaches AAA contrast on the background', (name) => {
    expect(contrast(parse(token(name)), bg)).toBeGreaterThanOrEqual(7);
  });
  it.each([['term-error', 'term-error-bg'], ['term-warn', 'term-warn-bg'], ['term-ok', 'term-ok-bg']])('%s stays readable on its tinted row', (text, row) => {
    expect(contrast(parse(token(text)), over(parse(token(row)), bg))).toBeGreaterThanOrEqual(7);
  });
  it('avoids pure white on pure black, which is what tires eyes', () => {
    expect(token('term-text').toLowerCase()).not.toBe('#ffffff');
    expect(luminance(bg)).toBeGreaterThan(0);
  });
  it('has no glow, blur or animation on its text', () => {
    expect(terminalRules.length).toBeGreaterThan(8);
    for (const rule of terminalRules) expect(rule).not.toMatch(/text-shadow|animation|filter:\s*blur/);
  });
  it('sits above the scanlines, so nothing scrolls across what you read', () => {
    const scan = /\.frame-scan \{[^}]*z-index: (\d+)/.exec(hud);
    const work = /\.hud\.work \{[^}]*z-index: (\d+)/.exec(hud);
    expect(Number(work[1])).toBeGreaterThan(Number(scan[1]));
  });
  it('keeps text at a comfortable size', () => {
    expect(/\.term-out \{[^}]*font: (\d+(?:\.\d+)?)px/.exec(hud)[1] * 1).toBeGreaterThanOrEqual(14);
  });
});

describe('text on the HUD', () => {
  const tile = parse(token('tile'));
  it.each(['text', 'dim', 'amber', 'holo-soft'])('%s is readable on a tile', (name) => {
    expect(contrast(parse(token(name)), tile)).toBeGreaterThanOrEqual(4.5);
  });
  it('the white button keeps its dark label readable', () => {
    expect(contrast(parse(token('on-accent')), parse(token('cta')))).toBeGreaterThanOrEqual(7);
  });
});
