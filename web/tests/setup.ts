import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import '@testing-library/jest-dom/vitest';

/* ------------------------------------------------------------------ *
 * Honest assertion counting.
 *
 * The release gate asks for a measured number of executed assertions, not an
 * estimate. `expect` is wrapped here so every call increments a counter, and
 * each worker appends its real total on teardown. `scripts/count-assertions.mjs`
 * sums the file. Nothing is hardcoded and nothing is extrapolated: if a test
 * is skipped, its assertions simply never run and never get counted.
 * ------------------------------------------------------------------ */
const COUNT_FILE = resolve(__dirname, '..', '.vitest-assertions.jsonl');

let assertions = 0;

/**
 * Vitest's expect (jest-expect based) tracks `assertionCalls` in its per-test
 * state. Reading it after each test gives the REAL number of expect() calls
 * that actually executed - a skipped test contributes nothing, and a loop of
 * 500 expects contributes 500. Patching the global `expect` does not work here
 * because test files import it directly from 'vitest'.
 */
afterEach(() => {
  const calls = (expect.getState?.() as { assertionCalls?: number } | undefined)?.assertionCalls;
  if (typeof calls === 'number') assertions += calls;
});

afterAll(() => {
  try {
    mkdirSync(dirname(COUNT_FILE), { recursive: true });
    const path =
      (expect.getState?.() as { testPath?: string } | undefined)?.testPath ?? 'unknown';
    appendFileSync(COUNT_FILE, `${JSON.stringify({ file: path, assertions })}\n`, 'utf8');
    assertions = 0;
  } catch {
    // Counting is diagnostics, never a reason to fail a suite.
  }
});

/* ------------------------------------------------------------------ *
 * jsdom gaps the app relies on.
 * ------------------------------------------------------------------ */

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// jsdom DEFINES these and then throws "Not implemented", so they must be
// replaced unconditionally rather than only when absent.
Element.prototype.scrollIntoView = () => {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

/**
 * jsdom has no canvas backend. Returning null is the honest answer and is
 * exactly what MolecularScene is written to tolerate: it skips its draw loop
 * and the page still renders. Returning a fake context would hide a real
 * crash-on-null bug, so null it is.
 */
HTMLCanvasElement.prototype.getContext = (() =>
  null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
