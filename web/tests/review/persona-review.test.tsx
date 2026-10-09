/**
 * Executes the 500-scenario simulated review and writes a machine-readable
 * issue matrix to `review/persona-matrix.json` and `.csv`.
 *
 * SIMULATED, NOT USER TESTING. See tests/review/personas.ts for the standing
 * caveat. Every check below runs against the real rendered DOM of the real app;
 * what it cannot do is tell you whether a human understood anything.
 *
 * To keep runtime sane, scenarios are grouped by the environment they need
 * (screen x device x motion x data x visit). Each distinct environment is
 * rendered ONCE and every scenario sharing it is evaluated against that render.
 * The scenario count is therefore honest: 500 scenarios are evaluated, across
 * far fewer renders.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';

import App from '../../src/App';
import { SCREENS } from '../../src/content/copy';
import { CLASS_INFO, classSequence, indexToCodes } from '../../src/science/alphabet';
import { candidateMetrics, objective, objectiveParts } from '../../src/science/objective';
import { contributions, scoreAll } from '../../src/science/potts';
import { combineObjective, safePenalty } from '../../src/science/qubo';
import { realModel } from '../helpers/model';
import type {
  CandidateRecord,
  RunRecord,
  WorkerRequest,
  WorkerResponse,
} from '../../src/workers/protocol';
import { STAGES } from '../../src/workers/protocol';
import {
  CHECKS,
  VIEWPORTS,
  buildScenarios,
  type CheckId,
  type Scenario,
} from './personas';

const model = realModel();
const SCENARIOS = buildScenarios(500);

/** Screens are lazily imported; see screens.test.tsx for the rationale. */
const LAZY_TIMEOUT = 15_000;

/* ------------------------------------------------------------------ *
 * Worker stub (real science, real protocol)
 * ------------------------------------------------------------------ */
function toCandidate(index: number, lambda: number, rank: number): CandidateRecord {
  const codes = indexToCodes(index);
  const scores = scoreAll(codes, model.flat);
  const m = candidateMetrics(codes, scores);
  return {
    index,
    codes,
    classSequence: classSequence(codes),
    representative: codes.map((c) => CLASS_INFO[c].representative).join(''),
    scores,
    objective: objective(scores, lambda),
    rank,
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
  };
}

function makeRunRecord(runId: string, lambda: number, seed: number): RunRecord {
  const indices = [0, 7, 42, 1000, 55555, 123456, 777777, 1000000, 1234567, 1679615];
  const candidates = indices
    .map((i) => toCandidate(i, lambda, 0))
    .sort((a, b) => a.objective - b.objective)
    .map((c, i) => ({ ...c, rank: i + 1 }));
  const sweep = [0, 0.5, 1, 2, 5].map((lam) => ({
    lambda: lam,
    best: indices.map((i) => toCandidate(i, lam, 1)).sort((a, b) => a.objective - b.objective)[0],
    penalty: safePenalty(combineObjective(model.flat, lam)),
    runtimeMs: 11,
    optimumHits: 1,
  }));
  return {
    runId,
    config: {
      lambda,
      seed,
      sweepLambdas: [0, 0.5, 1, 2, 5],
      topN: 10,
      surrogate: { alpha: 1e-6, trainSize: 600, validationSize: 200, testSize: 200, enabled: true },
      annealing: { reads: 4, sweeps: 20, runs: 2, enabled: true },
      penaltyMultiplier: 2,
      tolerance: 1e-8,
    },
    mode: 'live',
    candidates,
    sweep,
    solvers: [
      {
        solver: 'Brute force (exact)',
        lambda,
        status: 'EXECUTED',
        bestObjective: candidates[0].objective,
        classSequence: candidates[0].classSequence,
        validityRate: 1,
        successRate: 1,
        runtimeMs: 180,
        seed: null,
        reads: 1679616,
        medianBestEnergy: null,
        stdBestEnergy: null,
        note: 'Checked every valid sequence.',
        exact: true,
      },
      {
        solver: 'Simulated annealing',
        lambda,
        status: 'EXECUTED',
        bestObjective: candidates[1].objective,
        classSequence: candidates[1].classSequence,
        validityRate: 0.42,
        successRate: 0,
        runtimeMs: 95,
        seed,
        reads: 8,
        medianBestEnergy: candidates[1].objective,
        stdBestEnergy: 3.2,
        note: '2 runs x 4 reads x 20 sweeps.',
        exact: false,
      },
      {
        solver: 'D-Wave quantum annealer',
        lambda,
        status: 'NOT EXECUTED',
        bestObjective: null,
        classSequence: null,
        validityRate: null,
        successRate: null,
        runtimeMs: null,
        seed: null,
        reads: null,
        medianBestEnergy: null,
        stdBestEnergy: null,
        note: 'NO QUANTUM HARDWARE EXECUTION.',
        exact: false,
      },
    ],
    surrogates: [
      {
        plastic: 'PET',
        alpha: 1e-6,
        seed,
        train: { count: 600, r2: 1, rmse: 4e-8, mae: 3e-8, maxAbsError: 9e-8 },
        validation: { count: 200, r2: 1, rmse: 5e-8, mae: 4e-8, maxAbsError: 1e-7 },
        test: { count: 200, r2: 1, rmse: 5e-8, mae: 4e-8, maxAbsError: 1e-7 },
        splitsDisjoint: true,
        fitMs: 410,
      },
    ],
    verify: {
      sampleSize: 250,
      seed,
      maxQuboObjectiveError: 7.1e-13,
      maxPenaltyResidue: 3.6e-12,
      encodeDecodeRoundTrips: 250,
      invalidTested: 250,
      invalidCorrectlyPenalised: 250,
      penaltyBound: 16953.26,
      lambda,
      runtimeMs: 31,
    },
    stats: {
      PET: { mean: -63.6, std: 52.8, min: -256.4, max: 41 },
      PE: { mean: -64, std: 50.5, min: -280.2, max: 19.2 },
      PP: { mean: -77.3, std: 54.2, min: -349.1, max: 24.2 },
    },
    searchSpace: { positions: 8, classes: 6, binaryVariables: 48, validSequences: 1679616 },
    timings: Object.fromEntries(STAGES.map((s, i) => [s.id, 10 + i * 5])),
    totalMs: 1820,
    environment: { userAgent: 'review', hardwareConcurrency: 8, deviceMemoryGb: 8 },
    quantumHardware: 'NO QUANTUM HARDWARE EXECUTION',
    modelSource: model.meta.source,
    startedAtIso: '2026-10-09T00:00:00.000Z',
  };
}

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
      return;
    }
    if (message.kind === 'run') {
      for (const s of STAGES) {
        emit({
          kind: 'stage',
          runId: message.runId,
          stage: s.id,
          status: 'done',
          fraction: 1,
          note: `${s.title} complete`,
          elapsedMs: 12,
        });
      }
      emit({
        kind: 'run',
        runId: message.runId,
        record: makeRunRecord(message.runId, message.config.lambda, message.config.seed),
      });
      return;
    }
    if (message.kind === 'quboAt') {
      const base = combineObjective(model.flat, message.lambda);
      emit({
        kind: 'qubo',
        runId: message.runId,
        payload: {
          lambda: message.lambda,
          penalty: safePenalty(base, message.penaltyMultiplier),
          penaltyMultiplier: message.penaltyMultiplier,
          offset: base.offset,
          linear: Array.from(base.linear),
          quadratic: [],
          maxAbsCoefficient: 10,
          linearMass: 100,
          quadraticMass: 200,
          ising: { hMin: -1, hMax: 1, jMin: -1, jMax: 1, constant: 0 },
        },
      });
    }
  }
}

/* ------------------------------------------------------------------ *
 * The checks. Each returns null when satisfied, or a defect string.
 * ------------------------------------------------------------------ */
type CheckResult = string | null;

const CHECK_IMPL: Record<CheckId, (ctx: RenderContext) => Promise<CheckResult> | CheckResult> = {
  plainTitle: ({ screen }) => {
    const h1s = document.querySelectorAll('h1');
    if (h1s.length !== 1) return `expected exactly one h1, found ${h1s.length}`;
    const text = h1s[0].textContent ?? '';
    if (text.trim().length < 8) return `h1 is too short to be meaningful: "${text}"`;
    // The h1 must not be pure jargon: require at least four common words.
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    if (words.length < 3) return `h1 is not a plain-English phrase: "${text}"`;
    if (screen !== 'discover' && !document.body.textContent?.includes(SCREENS[screen].title)) {
      return `screen title "${SCREENS[screen].title}" is not present`;
    }
    return null;
  },

  onePurpose: ({ screen }) => {
    const body = document.body.textContent ?? '';
    if (!body.includes(SCREENS[screen].purpose)) {
      // Discover states its purpose through the hero paragraphs instead.
      if (screen === 'discover' && /The problem\./.test(body) && /What this does\./.test(body)) {
        return null;
      }
      return `one-sentence purpose for "${screen}" not found on screen`;
    }
    return null;
  },

  primaryAction: () => {
    const primary = document.querySelectorAll('.btn-primary, button.btn-primary');
    const anyButton = document.querySelectorAll('main button:not(:disabled)');
    if (primary.length === 0 && anyButton.length === 0) {
      return 'no enabled action available anywhere in main';
    }
    return null;
  },

  noBareNumbers: () => {
    // Every stat tile must carry a label and a unit/direction line.
    const stats = document.querySelectorAll('.stat');
    for (const stat of stats) {
      const label = stat.querySelector('.stat-label');
      const value = stat.querySelector('.stat-value');
      const unit = stat.querySelector('.stat-unit');
      if (!label || (label.textContent ?? '').trim().length === 0) {
        return `a stat tile has no label: ${stat.textContent?.slice(0, 60)}`;
      }
      if (value && !unit) {
        return `stat "${label.textContent?.trim()}" shows a value with no unit or direction`;
      }
    }
    return null;
  },

  jargonExplained: () => {
    const body = document.body.textContent ?? '';
    // If lambda appears as a bare symbol, an explanation must be nearby.
    if (/λ/.test(body) && !/Selectivity Priority/i.test(body)) {
      return 'the lambda symbol appears without the plain-language name';
    }
    if (/\bQUBO\b/.test(body) && !/switch|binary/i.test(body)) {
      return 'QUBO appears with no plain-language gloss';
    }
    if (/\bIsing\b/.test(body) && !/spin|plus-one|minus-one|\+1|-1/i.test(body)) {
      return 'Ising appears with no plain-language gloss';
    }
    if (/one-hot/i.test(body) && !/exactly one/i.test(body)) {
      return 'one-hot appears without the "exactly one per position" gloss';
    }
    if (/\bpeptide\b/i.test(body) && !/chain of amino|amino-acid building block/i.test(body)) {
      return 'peptide appears with no definition on screen';
    }
    return null;
  },

  keyboardReachable: () => {
    const nodes = document.querySelectorAll('button, a[href], input, select, textarea');
    let reachable = 0;
    for (const node of nodes) {
      const tabIndex = node.getAttribute('tabindex');
      if (tabIndex === '-1') {
        const inRoving = node.closest('.chain') !== null;
        if (!inRoving && node.id !== 'main') {
          return `focusable control removed from tab order: ${node.outerHTML.slice(0, 100)}`;
        }
        continue;
      }
      if (!(node as HTMLButtonElement).disabled) reachable += 1;
    }
    if (nodes.length > 0 && reachable === 0) return 'no control on this screen is tabbable';
    // Where a chain exists it must expose exactly one tab stop.
    const chain = document.querySelectorAll('.chain button');
    if (chain.length > 0) {
      const stops = [...chain].filter((b) => b.getAttribute('tabindex') === '0');
      if (stops.length !== 1) {
        return `the peptide chain exposes ${stops.length} tab stops, expected 1`;
      }
    }
    return null;
  },

  honestyPresent: () => {
    const body = document.body.textContent ?? '';
    const hasNoLab = /not been tested in a laboratory|Nothing here has been tested/i.test(body);
    const hasNoQuantum = /NO QUANTUM HARDWARE EXECUTION/i.test(body);
    if (!hasNoLab) return 'no statement that nothing was tested in a laboratory';
    if (!hasNoQuantum) return 'no NO QUANTUM HARDWARE EXECUTION statement';
    return null;
  },

  stateHandled: ({ data }) => {
    if (data !== 'cold') return null;
    const body = document.body.textContent ?? '';
    // A cold screen must explain the absence rather than render blank.
    const hasEmptyState =
      document.querySelector('.state-box') !== null ||
      /no run|nothing has been computed|not drawn yet|not run yet|no results/i.test(body);
    if (!hasEmptyState) return 'cold screen shows neither data nor an explicit empty state';
    return null;
  },

  noHorizontalOverflow: () => {
    // jsdom reports no layout, so this checks the structural rule instead: any
    // element wider than the viewport must sit inside a scroll container.
    const wide = document.querySelectorAll('table, pre, svg[role="img"]');
    for (const node of wide) {
      const inScroller = node.closest('.scroll-x') !== null;
      const isResponsiveSvg =
        node.tagName.toLowerCase() === 'svg' &&
        (node.getAttribute('width') === '100%' || node.hasAttribute('viewBox'));
      if (!inScroller && !isResponsiveSvg) {
        return `wide element outside a scroll container: <${node.tagName.toLowerCase()}>`;
      }
    }
    if ((document.body.style.overflowX ?? '') === 'visible') {
      return 'body allows horizontal overflow';
    }
    return null;
  },

  motionOptional: () => {
    // With motion reduced, the root must carry the attribute the CSS keys off.
    if (document.documentElement.getAttribute('data-motion') !== 'reduced') {
      return 'reduced-motion preference is not reflected on the document root';
    }
    return null;
  },

  landmarks: async () => {
    const results = await axe.run(document.body, {
      runOnly: { type: 'rule', values: ['region', 'landmark-one-main', 'page-has-heading-one'] },
    });
    if (results.violations.length > 0) {
      return results.violations.map((v) => `${v.id}: ${v.help}`).join('; ');
    }
    return null;
  },

  accessibleGraphics: () => {
    const graphics = document.querySelectorAll('canvas, [role="img"]');
    for (const node of graphics) {
      const named =
        node.getAttribute('aria-label') ||
        node.getAttribute('aria-labelledby') ||
        node.querySelector('title');
      if (!named) return `graphic with no accessible name: <${node.tagName.toLowerCase()}>`;
    }
    return null;
  },

  provenanceLabelled: ({ data }) => {
    if (data !== 'computed') return null;
    const badges = document.querySelectorAll('.badge-prov');
    const stats = document.querySelectorAll('.stat');
    if (stats.length > 0 && badges.length === 0) {
      return 'statistics are shown with no provenance badge anywhere on screen';
    }
    return null;
  },

  nextStepObvious: () => {
    const links = document.querySelectorAll('main a[href], main button');
    if (links.length === 0) return 'no onward route from this screen';
    return null;
  },

  recoveryAvailable: () => {
    const body = document.body.textContent ?? '';
    if (!/undo/i.test(body)) return 'no undo affordance on an editing screen';
    if (!/reset/i.test(body)) return 'no reset affordance on an editing screen';
    return null;
  },
};

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */
interface RenderContext {
  readonly screen: Scenario['screen'];
  readonly device: Scenario['device'];
  readonly motion: Scenario['motion'];
  readonly data: Scenario['data'];
  readonly visit: Scenario['visit'];
}

function envKey(s: Scenario): string {
  return `${s.screen}|${s.device}|${s.motion}|${s.data}|${s.visit}`;
}

async function setUpEnvironment(ctx: RenderContext): Promise<void> {
  const viewport = VIEWPORTS[ctx.device];
  Object.defineProperty(window, 'innerWidth', { value: viewport.width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: viewport.height, configurable: true });

  // A repeat visitor has already seen the tour; a first visit has not.
  try {
    localStorage.clear();
    if (ctx.visit === 'repeat') {
      localStorage.setItem(
        'qbind-select:prefs:v1',
        JSON.stringify({
          mode: 'beginner',
          theme: 'system',
          motion: ctx.motion === 'reduced' ? 'reduced' : 'system',
          tourSeen: true,
          favourites: [],
          scenarios: [],
        }),
      );
    } else if (ctx.motion === 'reduced') {
      localStorage.setItem(
        'qbind-select:prefs:v1',
        JSON.stringify({
          mode: 'beginner',
          theme: 'system',
          motion: 'reduced',
          tourSeen: false,
          favourites: [],
          scenarios: [],
        }),
      );
    }
  } catch {
    /* storage unavailable is itself tolerated by the app */
  }

  window.history.pushState({}, '', '/');
  render(<App />);
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });

  // Dismiss the tour so checks see the screen, not the overlay.
  const skip = screen.queryByRole('button', { name: /^skip$/i });
  if (skip) {
    await act(async () => {
      fireEvent.click(skip);
    });
  }

  if (ctx.data === 'computed') {
    const link = await screen.findByRole('link', { name: new RegExp(SCREENS.optimise.nav, 'i') });
    await act(async () => {
      fireEvent.click(link);
    });
    const run = (await screen.findAllByRole('button', { name: /start a live run|run it now/i }))[0];
    await act(async () => {
      fireEvent.click(run);
    });
    await waitFor(() => expect(screen.getByText(/run complete/i)).toBeInTheDocument());
  }

  // Always navigate, including back to Discover. Skipping this for 'discover'
  // left computed-data scenarios sitting on the Optimise screen, which made
  // several findings point at the wrong screen entirely.
  const target = await screen.findByRole('link', {
    name: new RegExp(SCREENS[ctx.screen].nav, 'i'),
  });
  await act(async () => {
    fireEvent.click(target);
  });
  if (ctx.screen === 'discover') {
    await screen.findByText(/tell plastics apart/i, undefined, { timeout: LAZY_TIMEOUT });
  } else {
    await screen.findByText(SCREENS[ctx.screen].title, undefined, {
      timeout: LAZY_TIMEOUT,
    });
  }

  // Let debounced scoring settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 160));
  });
}

interface Finding {
  scenarioId: string;
  persona: string;
  personaLabel: string;
  skill: string;
  screen: string;
  device: string;
  visit: string;
  motion: string;
  data: string;
  check: CheckId;
  severity: string;
  problem: string;
  reproduction: string;
  status: 'open' | 'fixed';
}

const findings: Finding[] = [];
const executed: { scenarioId: string; checks: number }[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return new Stub() as unknown as Worker;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-motion');
});

describe('500-scenario simulated persona review (NOT user testing)', () => {
  // Group scenarios by the environment they need.
  const groups = new Map<string, Scenario[]>();
  for (const scenario of SCENARIOS) {
    const key = envKey(scenario);
    const list = groups.get(key) ?? [];
    list.push(scenario);
    groups.set(key, list);
  }

  it('enumerates exactly 500 reproducible scenarios across every axis', () => {
    expect(SCENARIOS).toHaveLength(500);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(500);
    // Every persona, screen, device, motion, visit and data state is represented.
    expect(new Set(SCENARIOS.map((s) => s.persona.id)).size).toBe(8);
    expect(new Set(SCENARIOS.map((s) => s.screen)).size).toBe(6);
    expect(new Set(SCENARIOS.map((s) => s.device)).size).toBe(3);
    expect(new Set(SCENARIOS.map((s) => s.motion)).size).toBe(2);
    expect(new Set(SCENARIOS.map((s) => s.visit)).size).toBe(2);
    // Rebuilding gives an identical matrix.
    expect(buildScenarios(500).map((s) => s.id + s.screen + s.persona.id)).toEqual(
      SCENARIOS.map((s) => s.id + s.screen + s.persona.id),
    );
  });

  for (const [key, scenarios] of groups) {
    const [screenId, device, motion, data, visit] = key.split('|');
    it(`evaluates ${scenarios.length} scenario(s) on ${screenId} / ${device} / ${motion} motion / ${data} data / ${visit} visit`, async () => {
      const ctx: RenderContext = {
        screen: screenId as RenderContext['screen'],
        device: device as RenderContext['device'],
        motion: motion as RenderContext['motion'],
        data: data as RenderContext['data'],
        visit: visit as RenderContext['visit'],
      };
      await setUpEnvironment(ctx);

      // Run the union of checks once, then attribute results to each scenario.
      const needed = new Set<CheckId>(scenarios.flatMap((s) => s.checks));
      const outcomes = new Map<CheckId, CheckResult>();
      for (const check of needed) {
        outcomes.set(check, await CHECK_IMPL[check](ctx));
      }

      for (const scenario of scenarios) {
        executed.push({ scenarioId: scenario.id, checks: scenario.checks.length });
        for (const check of scenario.checks) {
          const problem = outcomes.get(check);
          if (problem) {
            const def = CHECKS.find((c) => c.id === check)!;
            findings.push({
              scenarioId: scenario.id,
              persona: scenario.persona.id,
              personaLabel: scenario.persona.label,
              skill: scenario.persona.skill,
              screen: scenario.screen,
              device: scenario.device,
              visit: scenario.visit,
              motion: scenario.motion,
              data: scenario.data,
              check,
              severity: def.severityIfFailed,
              problem,
              reproduction: `Open ${SCREENS[scenario.screen].path} at ${VIEWPORTS[scenario.device].width}px, motion=${scenario.motion}, data=${scenario.data}, visit=${scenario.visit}`,
              status: 'open',
            });
          }
        }
      }

      // Critical findings fail the suite; that is the whole point of the gate.
      const critical = findings.filter(
        (f) => f.severity === 'critical' && scenarios.some((s) => s.id === f.scenarioId),
      );
      expect(
        critical.length,
        critical.map((f) => `${f.scenarioId} ${f.check}: ${f.problem}`).join('\n'),
      ).toBe(0);
    });
  }

  it('writes the machine-readable issue matrix and reports honest coverage', () => {
    const dir = resolve(__dirname, '../../review');
    mkdirSync(dir, { recursive: true });

    const totalChecks = executed.reduce((a, e) => a + e.checks, 0);
    const bySeverity = {
      critical: findings.filter((f) => f.severity === 'critical').length,
      major: findings.filter((f) => f.severity === 'major').length,
      minor: findings.filter((f) => f.severity === 'minor').length,
    };

    const summary = {
      disclaimer:
        'SIMULATED REVIEW. These 500 scenarios are scripted heuristic inspections executed ' +
        'against the real rendered application. No human participated. A passing scenario ' +
        'means the automated checks found no defect, NOT that a person understood the page.',
      pendingHumanVerification: [
        'Can a novice explain what PET, PE and PP are after a 30-90 second walkthrough?',
        'Can a novice explain what a peptide is in their own words?',
        'Can a novice explain what the Selectivity Priority dial does?',
        'Can a novice state what the displayed results do NOT prove?',
        'These require moderated testing with real participants and consent. NOT measured here.',
      ],
      scenariosEvaluated: executed.length,
      distinctEnvironmentsRendered: groups.size,
      checksExecuted: totalChecks,
      personas: [...new Set(SCENARIOS.map((s) => s.persona.label))],
      checkCatalogue: CHECKS.map((c) => ({
        id: c.id,
        title: c.title,
        severityIfFailed: c.severityIfFailed,
      })),
      findings: bySeverity,
      openFindings: findings,
    };

    writeFileSync(resolve(dir, 'persona-matrix.json'), JSON.stringify(summary, null, 2), 'utf8');

    const header =
      'scenario_id,persona,persona_label,skill,screen,device,visit,motion,data,check,severity,problem,reproduction,status';
    const rows = findings.map((f) =>
      [
        f.scenarioId,
        f.persona,
        f.personaLabel,
        f.skill,
        f.screen,
        f.device,
        f.visit,
        f.motion,
        f.data,
        f.check,
        f.severity,
        f.problem,
        f.reproduction,
        f.status,
      ]
        .map((cell) => {
          const text = String(cell);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    );
    writeFileSync(
      resolve(dir, 'persona-matrix.csv'),
      [header, ...rows].join('\r\n') + '\r\n',
      'utf8',
    );

    // eslint-disable-next-line no-console
    console.log(
      `[persona review] ${executed.length} scenarios, ${groups.size} environments rendered, ` +
        `${totalChecks} checks executed, findings: ` +
        `${bySeverity.critical} critical / ${bySeverity.major} major / ${bySeverity.minor} minor`,
    );

    expect(executed.length).toBe(500);
    expect(totalChecks).toBeGreaterThan(500);
    // No critical finding may survive into the delivered build.
    expect(bySeverity.critical, JSON.stringify(findings.filter((f) => f.severity === 'critical'), null, 2)).toBe(0);
  });
});
