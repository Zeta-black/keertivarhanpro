import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
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
 *
 * A few suites run in the node environment (the RDKit cross-check needs
 * WebAssembly and a real `require`), so there is no `window` to patch there.
 * ------------------------------------------------------------------ */

const hasDom = typeof window !== 'undefined';

if (hasDom && !window.matchMedia) {
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

if (hasDom) {
  // jsdom DEFINES these and then throws "Not implemented", so they must be
  // replaced unconditionally rather than only when absent.
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = (() => {}) as typeof window.scrollTo;

  /**
   * jsdom has no canvas backend and no WebGL. Returning null is the honest
   * answer, and every viewer in the app is written to tolerate it: the 3D
   * viewer reports that it cannot render and offers the 2D structure instead.
   * Returning a fake context would hide a real crash-on-null bug.
   */
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

/* ------------------------------------------------------------------ *
 * Default fetch stub.
 *
 * The Quantum screen loads the Potts coefficients itself (see
 * `usePottsModel`), so any suite that renders the app triggers a real
 * request. Left unstubbed, jsdom tries to reach an unroutable URL and
 * blocks until it gives up - which took the persona review, 168 full app
 * renders, from minutes to tens of minutes.
 *
 * Serving the real file from disk is both faster and better coverage: the
 * screen reaches its loaded state in every suite rather than sitting
 * permanently in its "model could not be loaded" branch. Anything else
 * 404s immediately, so a test that depends on some other request has to
 * say so by stubbing it.
 *
 * Individual tests still override this with `vi.stubGlobal('fetch', ...)`;
 * `vi.unstubAllGlobals()` in their teardown restores this default.
 * ------------------------------------------------------------------ */
if (hasDom) {
  const modelPath = resolve(__dirname, '..', 'public', 'model', 'potts_6class_8mer.json');
  let modelJson: string | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    if (url.includes('potts_6class_8mer.json')) {
      if (modelJson === null) modelJson = readFileSync(modelPath, 'utf8');
      return new Response(modelJson, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Deliberately not a network call. A test that needs one must stub it.
    return new Response('not found in tests', { status: 404, statusText: 'Not Found' });
  }) as typeof fetch;
}
