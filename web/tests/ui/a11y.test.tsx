/**
 * Accessibility scans with axe-core, on every screen, in both themes.
 *
 * These run against the real rendered DOM. axe cannot judge colour contrast in
 * jsdom (it has no layout or paint), so contrast is verified separately by
 * `tests/ui/contrast.test.ts`, which computes WCAG ratios from the actual token
 * values. Between them: structure and semantics here, colour there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe, { type AxeResults, type Result } from 'axe-core';

import App from '../../src/App';
import { NAV_ORDER, SCREENS } from '../../src/content/copy';
import { classSequence } from '../../src/science/alphabet';
import { candidateMetrics, objective, objectiveParts } from '../../src/science/objective';
import { contributions, scoreAll } from '../../src/science/potts';
import { CLASS_INFO } from '../../src/science/alphabet';
import { realModel } from '../helpers/model';
import type { WorkerRequest, WorkerResponse } from '../../src/workers/protocol';

const model = realModel();

/** Screens are lazily imported; see screens.test.tsx for the rationale. */
const LAZY_TIMEOUT = 15_000;

/** Minimal worker stub: enough for every screen to reach a populated state. */
class Stub {
  private listeners: ((event: MessageEvent<WorkerResponse>) => void)[] = [];
  addEventListener(type: string, handler: EventListenerOrEventListenerObject) {
    if (type === 'message') this.listeners.push(handler as never);
  }
  removeEventListener() {}
  terminate() {}
  postMessage(message: WorkerRequest) {
    const emit = (r: WorkerResponse) => this.listeners.forEach((l) => l({ data: r } as never));
    if (message.kind === 'init') {
      emit({
        kind: 'ready',
        runId: message.runId,
        modelSource: model.meta.source,
        orientation: model.meta.orientation,
      });
      return;
    }
    if (message.kind === 'score') {
      const { codes, lambda } = message;
      const scores = scoreAll(codes, model.flat);
      const m = candidateMetrics(codes, scores);
      const parts = objectiveParts(scores, lambda);
      const b = (p: 'PET' | 'PE' | 'PP') => {
        const c = contributions(codes, model.flat[p]);
        return {
          positions: c.positions,
          pairs: c.pairs,
          linearTotal: c.linearTotal,
          pairTotal: c.pairTotal,
        };
      };
      emit({
        kind: 'score',
        runId: message.runId,
        payload: {
          codes: [...codes],
          classSequence: classSequence(codes),
          representative: codes.map((c) => CLASS_INFO[c].representative).join(''),
          scores,
          objective: objective(scores, lambda),
          objectiveParts: {
            targetTerm: parts.targetTerm,
            offTargetSum: parts.offTargetSum,
            penaltyTerm: parts.penaltyTerm,
            lambda: parts.lambda,
            total: parts.total,
          },
          metrics: {
            meanOffTarget: m.meanOffTarget,
            worstOffTarget: m.worstOffTarget,
            marginMean: m.marginMean,
            marginWorst: m.marginWorst,
            aromaticFraction: m.aromaticFraction,
            hydrophobicFraction: m.hydrophobicFraction,
            polarFraction: m.polarFraction,
            netChargeClassBalance: m.netChargeClassBalance,
            warnings: m.warnings,
          },
          contributions: { PET: b('PET'), PE: b('PE'), PP: b('PP') },
          rankInSpace: 1234,
          percentile: 99.9,
        },
      });
    }
  }
}

/**
 * Rules axe cannot evaluate meaningfully without layout/paint, so running them
 * in jsdom would produce noise rather than signal. Each exclusion is justified
 * and covered elsewhere.
 */
const DISABLED_RULES = {
  // jsdom has no paint; real ratios are computed in contrast.test.ts.
  'color-contrast': { enabled: false },
  // Needs real geometry; touch sizes are asserted from the tokens instead.
  'target-size': { enabled: false },
};

async function scan(): Promise<AxeResults> {
  return axe.run(document.body, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: DISABLED_RULES,
  });
}

function describeViolations(violations: Result[]): string {
  if (violations.length === 0) return 'none';
  return violations
    .map(
      (v) =>
        `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n` +
        v.nodes
          .slice(0, 3)
          .map((n) => `    -> ${n.html.slice(0, 160)}`)
          .join('\n'),
    )
    .join('\n');
}

beforeEach(() => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return new Stub() as unknown as Worker;
      }
    },
  );
  window.history.pushState({}, '', '/');
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
});

async function renderAndSettle() {
  render(<App />);
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  const skip = screen.queryByRole('button', { name: /^skip$/i });
  if (skip) {
    await act(async () => {
      fireEvent.click(skip);
    });
  }
}

async function go(nav: string) {
  const link = await screen.findByRole('link', { name: new RegExp(nav, 'i') });
  await act(async () => {
    fireEvent.click(link);
  });
}

describe('accessibility (axe-core)', () => {
  it.each(NAV_ORDER)('%s screen has no axe violations', async (id) => {
    await renderAndSettle();
    if (id !== 'discover') {
      await go(SCREENS[id].nav);
      await screen.findByText(SCREENS[id].title, undefined, { timeout: LAZY_TIMEOUT });
    }
    // Let debounced scoring settle so the scanned DOM is the populated one.
    await waitFor(() => expect(document.querySelectorAll('main *').length).toBeGreaterThan(5));
    const results = await scan();
    expect(results.violations.length, describeViolations(results.violations)).toBe(0);
  });

  it('has no axe violations in the light theme', async () => {
    await renderAndSettle();
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) theme/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    const results = await scan();
    expect(results.violations.length, describeViolations(results.violations)).toBe(0);
  });

  it('has no axe violations with the help dialog open', async () => {
    await renderAndSettle();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /help, shortcuts/i }));
    });
    await screen.findByRole('dialog');
    const results = await scan();
    expect(results.violations.length, describeViolations(results.violations)).toBe(0);
  });

  it('has no axe violations while the tour is open', async () => {
    render(<App />);
    // The tour is opt-in: it is opened from the header, never on its own.
    const open = await screen.findByRole('button', { name: /take the guided tour/i }, {
      timeout: LAZY_TIMEOUT,
    });
    await act(async () => {
      fireEvent.click(open);
    });
    await screen.findByRole('button', { name: /^skip$/i }, { timeout: LAZY_TIMEOUT });
    const results = await scan();
    expect(results.violations.length, describeViolations(results.violations)).toBe(0);
  });

  it('has exactly one h1 per screen and no skipped heading levels', async () => {
    for (const id of NAV_ORDER) {
      cleanup();
      await renderAndSettle();
      if (id !== 'discover') {
        await go(SCREENS[id].nav);
        await screen.findByText(SCREENS[id].title, undefined, { timeout: LAZY_TIMEOUT });
      }
      const h1s = document.querySelectorAll('h1');
      expect(h1s.length, `${id} should have exactly one h1`).toBe(1);

      const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) =>
        Number(h.tagName[1]),
      );
      for (let i = 1; i < levels.length; i += 1) {
        expect(
          levels[i] - levels[i - 1],
          `${id}: heading jumped from h${levels[i - 1]} to h${levels[i]}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives every image, canvas and chart an accessible name', async () => {
    for (const id of NAV_ORDER) {
      cleanup();
      await renderAndSettle();
      if (id !== 'discover') {
        await go(SCREENS[id].nav);
        await screen.findByText(SCREENS[id].title, undefined, { timeout: LAZY_TIMEOUT });
      }
      const graphics = document.querySelectorAll('canvas, svg[role="img"], [role="img"]');
      for (const node of graphics) {
        const labelled =
          node.getAttribute('aria-label') ||
          node.getAttribute('aria-labelledby') ||
          node.querySelector('title');
        expect(
          Boolean(labelled),
          `${id}: a graphic has no accessible name: ${node.outerHTML.slice(0, 120)}`,
        ).toBe(true);
      }
    }
  });

  it('labels every form control', async () => {
    await renderAndSettle();
    await go(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    const controls = document.querySelectorAll('input, select, textarea');
    for (const control of controls) {
      const id = control.getAttribute('id');
      const hasLabel =
        control.getAttribute('aria-label') ||
        control.getAttribute('aria-labelledby') ||
        (id && document.querySelector(`label[for="${id}"]`));
      expect(
        Boolean(hasLabel),
        `an input has no label: ${control.outerHTML.slice(0, 140)}`,
      ).toBe(true);
    }
  });

  it('keeps every interactive element keyboard reachable', async () => {
    await renderAndSettle();
    await go(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title);
    const interactive = document.querySelectorAll('button, a[href], input, [role="button"]');
    for (const node of interactive) {
      const tabIndex = node.getAttribute('tabindex');
      // -1 is allowed only inside a managed group (the chain uses a roving
      // tabindex, where exactly one member is reachable at a time).
      if (tabIndex === '-1') {
        const inChain = node.closest('.chain') !== null;
        const isMain = node.id === 'main';
        expect(
          inChain || isMain,
          `tabindex=-1 outside a roving group: ${node.outerHTML.slice(0, 140)}`,
        ).toBe(true);
      }
    }
    // The roving group must always expose exactly one reachable member.
    const chainButtons = document.querySelectorAll('.chain button');
    const reachable = [...chainButtons].filter((b) => b.getAttribute('tabindex') === '0');
    expect(reachable.length, 'the peptide chain must expose one tab stop').toBe(1);
  });

  it('announces live computation status politely', async () => {
    await renderAndSettle();
    await go(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title);
    // Whatever is announcing progress must not be assertive (which interrupts).
    const live = document.querySelectorAll('[aria-live]');
    for (const node of live) {
      expect(['polite', 'off']).toContain(node.getAttribute('aria-live'));
    }
  });
});
