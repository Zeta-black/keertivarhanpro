/**
 * WCAG 2.2 contrast verification, computed from the real token values.
 *
 * axe cannot do this in jsdom: there is no paint, so `color-contrast` is
 * skipped there. Instead the token file is parsed and every foreground /
 * background pair the design actually uses is checked against the real WCAG
 * formula, in BOTH themes. If someone changes a colour, this fails.
 *
 * Thresholds (WCAG 2.2 AA):
 *   4.5:1  normal text
 *   3.0:1  large text (>= 18.66px bold or >= 24px) and UI component boundaries
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const TOKENS = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

/** Parse one `:root`-style block into a token map. */
function parseBlock(selector: string): Record<string, string> {
  const index = TOKENS.indexOf(selector);
  if (index < 0) throw new Error(`token block not found: ${selector}`);
  const open = TOKENS.indexOf('{', index);
  // Find the matching close brace, tolerating nested blocks.
  let depth = 0;
  let close = open;
  for (let i = open; i < TOKENS.length; i += 1) {
    if (TOKENS[i] === '{') depth += 1;
    if (TOKENS[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const body = TOKENS.slice(open + 1, close);
  const map: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map[match[1]] = match[2].trim();
  }
  return map;
}

const DARK = parseBlock(':root {');
const LIGHT = { ...DARK, ...parseBlock(":root[data-theme='light']") };

/** Resolve a token to a hex colour, following `var(--x)` chains. */
function resolveColour(map: Record<string, string>, token: string, depth = 0): string {
  if (depth > 12) throw new Error(`token chain too deep for ${token}`);
  const raw = map[token];
  if (!raw) throw new Error(`token not defined: ${token}`);
  const varMatch = raw.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) return resolveColour(map, varMatch[1], depth + 1);
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  throw new Error(`token ${token} is not a plain colour: ${raw}`);
}

function toRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, always >= 1. */
function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Foreground / background pairs the UI genuinely renders. */
const TEXT_PAIRS: { fg: string; bg: string; where: string }[] = [
  { fg: '--text', bg: '--bg', where: 'body text on the page background' },
  { fg: '--text', bg: '--surface', where: 'body text on a card' },
  { fg: '--text', bg: '--surface-raised', where: 'body text on a raised card' },
  { fg: '--text', bg: '--surface-sunken', where: 'body text on a sunken panel' },
  { fg: '--text', bg: '--surface-overlay', where: 'body text in a modal' },
  { fg: '--text-strong', bg: '--bg', where: 'headings on the page background' },
  { fg: '--text-strong', bg: '--surface', where: 'headings on a card' },
  { fg: '--text-strong', bg: '--surface-sunken', where: 'stat values on a sunken panel' },
  { fg: '--text-muted', bg: '--bg', where: 'secondary text on the page background' },
  { fg: '--text-muted', bg: '--surface', where: 'secondary text on a card' },
  { fg: '--text-muted', bg: '--surface-sunken', where: 'secondary text on a sunken panel' },
  { fg: '--accent', bg: '--bg', where: 'links and eyebrows on the page background' },
  { fg: '--accent', bg: '--surface', where: 'links on a card' },
  { fg: '--accent', bg: '--surface-sunken', where: 'links on a sunken panel' },
  { fg: '--text-on-accent', bg: '--accent', where: 'primary button label' },
  { fg: '--success', bg: '--surface', where: 'success text on a card' },
  { fg: '--success', bg: '--surface-sunken', where: 'good stat value on a sunken panel' },
  { fg: '--attention', bg: '--surface', where: 'attention text on a card' },
  { fg: '--attention', bg: '--surface-sunken', where: 'warning stat value' },
  { fg: '--danger', bg: '--surface', where: 'error text on a card' },
  { fg: '--danger', bg: '--surface-sunken', where: 'error text on a sunken panel' },
  { fg: '--optimise', bg: '--surface', where: 'optimisation text on a card' },
  { fg: '--optimise', bg: '--surface-sunken', where: 'optimisation text on a sunken panel' },
  { fg: '--c-pet', bg: '--surface-sunken', where: 'PET score value' },
  { fg: '--c-pe', bg: '--surface-sunken', where: 'PE score value' },
  { fg: '--c-pp', bg: '--surface-sunken', where: 'PP score value' },
];

/**
 * `--text-faint` is used only for small supporting captions. It is held to the
 * same 4.5:1 bar as other text rather than being exempted, because "it is only
 * a caption" is exactly the reasoning that produces unreadable pages.
 */
const FAINT_PAIRS: { fg: string; bg: string; where: string }[] = [
  { fg: '--text-faint', bg: '--bg', where: 'caption on the page background' },
  { fg: '--text-faint', bg: '--surface', where: 'caption on a card' },
  { fg: '--text-faint', bg: '--surface-sunken', where: 'caption on a sunken panel' },
];

/** Non-text contrast: borders and component boundaries need 3:1. */
const UI_PAIRS: { fg: string; bg: string; where: string }[] = [
  { fg: '--border-strong', bg: '--bg', where: 'strong border on the page background' },
  { fg: '--border-strong', bg: '--surface', where: 'strong border on a card' },
  { fg: '--border-strong', bg: '--surface-sunken', where: 'slider track border' },
  { fg: '--accent', bg: '--bg', where: 'focus ring against the page background' },
  { fg: '--accent', bg: '--surface', where: 'focus ring against a card' },
];

/** Amino-acid class colours carry a white-ish glyph in the sequence blocks. */
const CLASS_TOKENS = [
  '--c-arom-w',
  '--c-arom-fy',
  '--c-hydrophobic',
  '--c-small-polar',
  '--c-charged-neg',
  '--c-charged-pos',
];

const THEMES: { name: string; map: Record<string, string> }[] = [
  { name: 'dark', map: DARK },
  { name: 'light', map: LIGHT },
];

describe('WCAG 2.2 AA contrast, computed from the real tokens', () => {
  it('parses both theme blocks', () => {
    expect(Object.keys(DARK).length).toBeGreaterThan(40);
    expect(Object.keys(LIGHT).length).toBeGreaterThan(40);
    // The light theme must actually override the canvas, or it is not a theme.
    expect(resolveColour(LIGHT, '--bg')).not.toBe(resolveColour(DARK, '--bg'));
  });

  for (const theme of THEMES) {
    describe(`${theme.name} theme`, () => {
      it.each(TEXT_PAIRS)('normal text reaches 4.5:1 - $where', ({ fg, bg, where }) => {
        const value = ratio(resolveColour(theme.map, fg), resolveColour(theme.map, bg));
        expect(
          value,
          `${theme.name}: ${where} (${fg} on ${bg}) is ${value.toFixed(2)}:1, needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it.each(FAINT_PAIRS)('caption text reaches 4.5:1 - $where', ({ fg, bg, where }) => {
        const value = ratio(resolveColour(theme.map, fg), resolveColour(theme.map, bg));
        expect(
          value,
          `${theme.name}: ${where} (${fg} on ${bg}) is ${value.toFixed(2)}:1, needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it.each(UI_PAIRS)('UI boundary reaches 3:1 - $where', ({ fg, bg, where }) => {
        const value = ratio(resolveColour(theme.map, fg), resolveColour(theme.map, bg));
        expect(
          value,
          `${theme.name}: ${where} (${fg} on ${bg}) is ${value.toFixed(2)}:1, needs 3:1`,
        ).toBeGreaterThanOrEqual(3);
      });

      it.each(CLASS_TOKENS)('class swatch %s carries a legible glyph', (token) => {
        // Swatches render --text-on-block over the class colour. The dark theme
        // uses a near-black glyph on pastel swatches; the light theme inverts to
        // white on darker swatches. Both must clear 4.5:1.
        const value = ratio(resolveColour(theme.map, token), resolveColour(theme.map, '--text-on-block'));
        expect(
          value,
          `${theme.name}: glyph on ${token} is ${value.toFixed(2)}:1, needs 4.5:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it.each(CLASS_TOKENS)('class swatch %s is distinguishable from the canvas', (token) => {
        const value = ratio(resolveColour(theme.map, token), resolveColour(theme.map, '--surface'));
        expect(
          value,
          `${theme.name}: ${token} against --surface is ${value.toFixed(2)}:1, needs 3:1`,
        ).toBeGreaterThanOrEqual(3);
      });

      it('the six class colours are mutually distinguishable', () => {
        // Colour is never the only signal (every block also carries a symbol),
        // but adjacent swatches still need to look different.
        for (let i = 0; i < CLASS_TOKENS.length; i += 1) {
          for (let j = i + 1; j < CLASS_TOKENS.length; j += 1) {
            const a = resolveColour(theme.map, CLASS_TOKENS[i]);
            const b = resolveColour(theme.map, CLASS_TOKENS[j]);
            expect(
              a,
              `${theme.name}: ${CLASS_TOKENS[i]} and ${CLASS_TOKENS[j]} are the same colour`,
            ).not.toBe(b);
            const [ar, ag, ab] = toRgb(a);
            const [br, bg2, bb] = toRgb(b);
            const distance = Math.hypot(ar - br, ag - bg2, ab - bb);
            expect(
              distance,
              `${theme.name}: ${CLASS_TOKENS[i]} and ${CLASS_TOKENS[j]} are only ${distance.toFixed(0)} apart in RGB`,
            ).toBeGreaterThan(40);
          }
        }
      });

      it('the three plastic colours are mutually distinguishable', () => {
        const tokens = ['--c-pet', '--c-pe', '--c-pp'];
        for (let i = 0; i < tokens.length; i += 1) {
          for (let j = i + 1; j < tokens.length; j += 1) {
            const a = toRgb(resolveColour(theme.map, tokens[i]));
            const b = toRgb(resolveColour(theme.map, tokens[j]));
            const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            expect(
              distance,
              `${theme.name}: ${tokens[i]} and ${tokens[j]} are only ${distance.toFixed(0)} apart`,
            ).toBeGreaterThan(60);
          }
        }
      });
    });
  }
});

describe('touch target and type-size tokens', () => {
  it('declares a touch minimum of at least 44px', () => {
    const value = DARK['--touch-min'];
    expect(value).toBeDefined();
    expect(parseInt(value, 10)).toBeGreaterThanOrEqual(44);
  });

  it('never sets base body type below 16px', () => {
    expect(DARK['--fs-base']).toBe('1rem');
  });

  it('keeps the smallest type token at or above 12px', () => {
    // 0.78rem = 12.48px at a 16px root.
    const rem = parseFloat(DARK['--fs-xs']);
    expect(rem * 16).toBeGreaterThanOrEqual(12);
  });
});
