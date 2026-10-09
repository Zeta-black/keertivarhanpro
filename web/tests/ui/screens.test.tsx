/**
 * UI / integration coverage: every screen, in its real states.
 *
 * These render the actual App with a stubbed Worker, because jsdom has no
 * module-worker support. The stub speaks the REAL protocol and computes with
 * the REAL science core, so what the screens receive is genuine model output
 * rather than invented fixtures. That makes these tests able to catch a wiring
 * bug (wrong field, stale response, missing state) rather than only a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../../src/App';
import { NAV_ORDER, SCREENS } from '../../src/content/copy';
import { CLASS_INFO, VALID_SEQUENCES, classSequence, indexToCodes } from '../../src/science/alphabet';
import { candidateMetrics, objective, objectiveParts } from '../../src/science/objective';
import { contributions, scoreAll } from '../../src/science/potts';
import {
  addOneHotConstraint,
  coefficientMass,
  combineObjective,
  maxAbsCoefficient,
  quadraticEntries,
  quboToIsing,
  safePenalty,
} from '../../src/science/qubo';
import { realModel } from '../helpers/model';
import type {
  CandidateRecord,
  RunRecord,
  WorkerRequest,
  WorkerResponse,
} from '../../src/workers/protocol';
import { STAGES } from '../../src/workers/protocol';

const model = realModel();

/**
 * Every screen is a separate lazily-imported chunk, so a first render has to
 * await a real dynamic import. Under full-suite load that can exceed Testing
 * Library's 1000ms default, which would show up as a confusing
 * "Unable to find role=heading" rather than as the timeout it is.
 */
const LAZY_TIMEOUT = 15_000;

/** Every Worker the app creates in a test, so tests can drive them. */
const liveWorkers: StubWorker[] = [];

/**
 * A Worker stand-in. It records what the app sent and replies with real
 * computed payloads. `autoRespond: false` lets a test hold a reply back and
 * assert the loading state, or reply out of order to prove staleness handling.
 */
class StubWorker implements Partial<Worker> {
  readonly sent: WorkerRequest[] = [];
  private listeners: ((event: MessageEvent<WorkerResponse>) => void)[] = [];
  terminated = false;
  autoRespond = true;

  constructor() {
    liveWorkers.push(this);
  }

  addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
    if (type === 'message') {
      this.listeners.push(handler as (event: MessageEvent<WorkerResponse>) => void);
    }
  }

  removeEventListener(): void {}

  terminate(): void {
    this.terminated = true;
    this.listeners = [];
  }

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    if (!this.autoRespond) return;
    const reply = respondTo(message);
    for (const r of reply) this.emit(r);
  }

  /** Push a response into the app as if the worker produced it. */
  emit(response: WorkerResponse): void {
    for (const listener of this.listeners) {
      listener({ data: response } as MessageEvent<WorkerResponse>);
    }
  }

  lastOfKind<K extends WorkerRequest['kind']>(kind: K): Extract<WorkerRequest, { kind: K }> | null {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      if (this.sent[i].kind === kind) return this.sent[i] as Extract<WorkerRequest, { kind: K }>;
    }
    return null;
  }
}

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

/** A small but structurally complete run record, built from real scores. */
function makeRunRecord(runId: string, lambda: number, seed: number): RunRecord {
  const indices = [0, 7, 42, 1000, 55555, 123456, 777777, 1000000, 1234567, 1679615];
  const candidates = indices
    .map((i) => toCandidate(i, lambda, 0))
    .sort((a, b) => a.objective - b.objective)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  const sweep = [0, 0.5, 1, 2, 5].map((lam) => {
    const q = combineObjective(model.flat, lam);
    const best = indices
      .map((i) => toCandidate(i, lam, 1))
      .sort((a, b) => a.objective - b.objective)[0];
    return {
      lambda: lam,
      best,
      penalty: safePenalty(q),
      runtimeMs: 12.5,
      optimumHits: 1,
    };
  });

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
        reads: VALID_SEQUENCES,
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
    searchSpace: { positions: 8, classes: 6, binaryVariables: 48, validSequences: VALID_SEQUENCES },
    timings: Object.fromEntries(STAGES.map((s, i) => [s.id, 10 + i * 5])),
    totalMs: 1820,
    environment: { userAgent: 'test', hardwareConcurrency: 8, deviceMemoryGb: 8 },
    quantumHardware: 'NO QUANTUM HARDWARE EXECUTION',
    modelSource: model.meta.source,
    startedAtIso: '2026-10-09T00:00:00.000Z',
  };
}

/** Real replies, computed with the real science core. */
function respondTo(message: WorkerRequest): WorkerResponse[] {
  switch (message.kind) {
    case 'init':
      return [
        {
          kind: 'ready',
          runId: message.runId,
          modelSource: model.meta.source,
          orientation: model.meta.orientation,
        },
      ];

    case 'score': {
      const { codes, lambda } = message;
      const scores = scoreAll(codes, model.flat);
      const m = candidateMetrics(codes, scores);
      const parts = objectiveParts(scores, lambda);
      const breakdown = (p: 'PET' | 'PE' | 'PP') => {
        const c = contributions(codes, model.flat[p]);
        return {
          positions: c.positions,
          pairs: c.pairs,
          linearTotal: c.linearTotal,
          pairTotal: c.pairTotal,
        };
      };
      return [
        {
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
            contributions: { PET: breakdown('PET'), PE: breakdown('PE'), PP: breakdown('PP') },
            rankInSpace: null,
            percentile: null,
          },
        },
      ];
    }

    case 'run': {
      const stages: WorkerResponse[] = STAGES.flatMap((s) => [
        {
          kind: 'stage' as const,
          runId: message.runId,
          stage: s.id,
          status: 'active' as const,
          fraction: s.measurable ? 0.5 : null,
          note: `working on ${s.title}`,
          elapsedMs: 5,
        },
        {
          kind: 'stage' as const,
          runId: message.runId,
          stage: s.id,
          status: 'done' as const,
          fraction: 1,
          note: `${s.title} complete`,
          elapsedMs: 12,
        },
      ]);
      return [
        ...stages,
        {
          kind: 'run',
          runId: message.runId,
          record: makeRunRecord(message.runId, message.config.lambda, message.config.seed),
        },
      ];
    }

    case 'quboAt': {
      const base = combineObjective(model.flat, message.lambda);
      const mass = coefficientMass(base);
      const ising = quboToIsing(base);
      return [
        {
          kind: 'qubo',
          runId: message.runId,
          payload: {
            lambda: message.lambda,
            penalty: safePenalty(base, message.penaltyMultiplier),
            penaltyMultiplier: message.penaltyMultiplier,
            offset: base.offset,
            linear: Array.from(base.linear),
            quadratic: quadraticEntries(base).map(
              (e) => [e.u, e.v, e.value] as [number, number, number],
            ),
            maxAbsCoefficient: maxAbsCoefficient(base),
            linearMass: mass.linear,
            quadraticMass: mass.quadratic,
            ising: { hMin: -1, hMax: 1, jMin: -1, jMax: 1, constant: ising.constant },
          },
        },
      ];
    }

    case 'verify': {
      const base = combineObjective(model.flat, 1);
      const penalty = safePenalty(base);
      addOneHotConstraint(base, penalty);
      return [
        {
          kind: 'verify',
          runId: message.runId,
          report: {
            sampleSize: message.sampleSize,
            seed: message.seed,
            maxQuboObjectiveError: 7.1e-13,
            maxPenaltyResidue: 3.6e-12,
            encodeDecodeRoundTrips: message.sampleSize,
            invalidTested: message.sampleSize,
            invalidCorrectlyPenalised: message.sampleSize,
            penaltyBound: penalty,
            lambda: 1,
            runtimeMs: 24,
          },
        },
      ];
    }

    case 'solveAt':
      return [
        {
          kind: 'solveAt',
          runId: message.runId,
          lambda: message.lambda,
          candidates: [toCandidate(0, message.lambda, 1)],
        },
      ];

    case 'pareto':
      return [
        {
          kind: 'pareto',
          runId: message.runId,
          lambda: message.lambda,
          points: [0, 7, 42, 1000].map((index, i) => {
            const s = scoreAll(indexToCodes(index), model.flat);
            return {
              index,
              pet: s.PET,
              worstOff: Math.max(s.PE, s.PP),
              objective: objective(s, message.lambda),
              onFrontier: i === 0,
            };
          }),
          sampled: 4,
        },
      ];

    case 'cancel':
      return [{ kind: 'cancelled', runId: message.runId, atStage: null }];

    default:
      return [];
  }
}

beforeEach(() => {
  liveWorkers.length = 0;
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return new StubWorker() as unknown as Worker;
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
});

/** Render the app and wait for the model-ready reply to land. */
async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(liveWorkers.length).toBeGreaterThan(0));
  // Screens are lazily imported; wait for the first one to actually mount.
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  return utils;
}

/** Dismiss the first-run tour so it does not overlay assertions. */
async function skipTour() {
  const skip = await screen.findByRole('button', { name: /^skip$/i }, { timeout: 3000 }).catch(
    () => null,
  );
  if (skip) fireEvent.click(skip);
}

async function gotoScreen(nav: string) {
  const link = await screen.findByRole('link', { name: new RegExp(nav, 'i') });
  await act(async () => {
    fireEvent.click(link);
  });
}

/* ================================================================== *
 * Shell, navigation and global state
 * ================================================================== */
describe('shell and navigation', () => {
  it('renders the landing screen with the problem, the promise and the next action', async () => {
    await renderApp();
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
    // The 30-second test: problem, what it does, what is next, all present.
    expect(screen.getByText(/tell plastics apart/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1,679,616/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /explore discovery/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /understand the science/i })).toBeInTheDocument();
  });

  it('exposes a skip link as an early tab stop', async () => {
    await renderApp();
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main');
  });

  it('lists every screen in the main navigation', async () => {
    await renderApp();
    const nav = screen.getByRole('navigation', { name: /main/i });
    for (const id of NAV_ORDER) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(SCREENS[id].nav, 'i') }),
        `nav link for ${id}`,
      ).toBeInTheDocument();
    }
  });

  it.each(NAV_ORDER.filter((id) => id !== 'discover'))(
    'navigates to %s without crashing, before any computation exists',
    async (id) => {
      await renderApp();
      await skipTour();
      await gotoScreen(SCREENS[id].nav);
      // Each screen must show its own plain-English title.
      expect(await screen.findByText(SCREENS[id].title)).toBeInTheDocument();
    },
  );

  it('marks the active screen with aria-current', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.understand.nav);
    const nav = screen.getByRole('navigation', { name: /main/i });
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current).toHaveTextContent(new RegExp(SCREENS.understand.nav, 'i'));
  });

  it('supports browser back navigation', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.compare.nav);
    expect(await screen.findByText(SCREENS.compare.title)).toBeInTheDocument();
    await act(async () => {
      window.history.back();
      // jsdom dispatches popstate asynchronously.
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
  });

  it('switches between Beginner and Researcher detail levels', async () => {
    await renderApp();
    await skipTour();
    const researcher = screen.getByRole('button', { name: /^researcher$/i });
    expect(researcher).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(researcher);
    });
    expect(screen.getByRole('button', { name: /^researcher$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('toggles the theme and records it on the document root', async () => {
    await renderApp();
    await skipTour();
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) theme/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(['dark', 'light']).toContain(document.documentElement.getAttribute('data-theme'));
  });

  it('opens the help dialog with the FAQ, shortcuts and accessibility tabs', async () => {
    await renderApp();
    await skipTour();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /help, shortcuts/i }));
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/was a quantum computer used/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /shortcuts/i }));
    });
    expect(within(dialog).getByText(/undo the last edit/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /accessibility/i }));
    });
    expect(within(dialog).getByText(/WCAG 2.2 AA/i)).toBeInTheDocument();
  });

  it('closes the help dialog with Escape', async () => {
    await renderApp();
    await skipTour();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /help, shortcuts/i }));
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('states plainly that nothing has been computed yet', async () => {
    await renderApp();
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });

  it('terminates the worker on unmount', async () => {
    const { unmount } = await renderApp();
    const worker = liveWorkers[0];
    unmount();
    expect(worker.terminated).toBe(true);
  });
});

/* ================================================================== *
 * First-run tour
 * ================================================================== */
describe('first-run tour', () => {
  it('appears on a first visit and can be skipped', async () => {
    await renderApp();
    const skip = await screen.findByRole('button', { name: /^skip$/i }, { timeout: 3000 });
    expect(screen.getByRole('dialog', { name: /quick tour/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(skip);
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /quick tour/i })).not.toBeInTheDocument(),
    );
  });

  it('advances through every step and finishes', async () => {
    await renderApp();
    await screen.findByRole('button', { name: /^skip$/i }, { timeout: 3000 });
    for (let i = 0; i < 10; i += 1) {
      const next = screen.queryByRole('button', { name: /next|start exploring/i });
      if (!next) break;
      const label = next.textContent ?? '';
      await act(async () => {
        fireEvent.click(next);
      });
      if (/start exploring/i.test(label)) break;
    }
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /quick tour/i })).not.toBeInTheDocument(),
    );
  });
});

/* ================================================================== *
 * Build screen - the flagship interaction
 * ================================================================== */
describe('Build screen', () => {
  async function openBuild() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title);
  }

  it('renders eight position buttons and six palette families', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    expect(positions).toHaveLength(8);
    for (const info of CLASS_INFO) {
      expect(
        screen.getByRole('button', { name: new RegExp(`${info.name}, family`, 'i') }),
        `palette entry for ${info.id}`,
      ).toBeInTheDocument();
    }
  });

  it('scores the initial design with real model numbers', async () => {
    await openBuild();
    // The reference design's real PET score, to 2dp, must appear on screen.
    const scores = scoreAll([2, 3, 0, 0, 2, 2, 1, 2], model.flat);
    // Each score appears in both the stat tile and the score-bar row, so the
    // assertion is "present at least once" rather than "exactly once".
    await waitFor(() =>
      expect(screen.getAllByText(scores.PET.toFixed(2)).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(scores.PE.toFixed(2)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(scores.PP.toFixed(2)).length).toBeGreaterThan(0);
  });

  it('places a family with the keyboard and rescores', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '5' });
    });
    const edited = [4, 3, 0, 0, 2, 2, 1, 2];
    const scores = scoreAll(edited, model.flat);
    await waitFor(
      () => expect(screen.getAllByText(scores.PET.toFixed(2)).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    expect(screen.getByText(classSequence(edited))).toBeInTheDocument();
  });

  it('moves focus between positions with the arrow keys', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(positions[1]);
    await act(async () => {
      fireEvent.keyDown(positions[1], { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(positions[0]);
    await act(async () => {
      fireEvent.keyDown(positions[0], { key: 'End' });
    });
    expect(document.activeElement).toBe(positions[7]);
  });

  it('supports tap-to-arm then tap-to-place (the touch path)', async () => {
    await openBuild();
    const palette = screen.getByRole('button', { name: /negatively charged, family/i });
    await act(async () => {
      fireEvent.click(palette);
    });
    expect(screen.getByRole('button', { name: /negatively charged, family/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      fireEvent.click(positions[2]);
    });
    const edited = [2, 3, 4, 0, 2, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('supports drag and drop onto a position', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(key: string, value: string) {
        this.data[key] = value;
      },
      getData(key: string) {
        return this.data[key] ?? '';
      },
      dropEffect: '',
      effectAllowed: '',
    };
    dataTransfer.setData('text/plain', '1');
    await act(async () => {
      fireEvent.dragOver(positions[4], { dataTransfer });
      fireEvent.drop(positions[4], { dataTransfer });
    });
    const edited = [2, 3, 0, 0, 1, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('undoes and redoes an edit', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '6' });
    });
    const edited = [5, 3, 0, 0, 2, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
    });
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('disables undo when there is no history', async () => {
    await openBuild();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
  });

  it('resets to the reference design', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[3].focus();
      fireEvent.keyDown(positions[3], { key: '5' });
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 4, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset to reference design/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
  });

  it('explains the before/after effect of an edit in plain language', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '1' });
    });
    await waitFor(() => expect(screen.getByText(/what your last edit did/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/this edit means/i)).toBeInTheDocument();
  });

  it('states that families are not individual amino acids', async () => {
    await openBuild();
    expect(
      screen.getAllByText(/FAMILIES of amino acids, not individual amino acids/i).length,
    ).toBeGreaterThan(0);
  });

  it('runs the guided challenge and tracks the margin', async () => {
    await openBuild();
    await screen.findByText(/can you beat the optimiser/i);
    const start = screen.getByRole('button', { name: /start the challenge/i });
    await waitFor(() => expect(start).not.toBeDisabled(), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(screen.getByRole('button', { name: /end challenge/i })).toBeInTheDocument();
  });

  it('stores and clears a comparison slot', async () => {
    await openBuild();
    const storeButtons = screen.getAllByRole('button', { name: /store current/i });
    await act(async () => {
      fireEvent.click(storeButtons[0]);
    });
    expect(await screen.findByText(/this is your current design/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear slot a/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByText(/empty\. store the current design/i).length).toBe(2),
    );
  });

  it('switches the conceptual binding surface between the three plastics', async () => {
    await openBuild();
    const ppButton = await screen.findByRole('button', { name: /PP — tubs and containers/i });
    await act(async () => {
      fireEvent.click(ppButton);
    });
    expect(ppButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/PP surface \(schematic\)/i)).toBeInTheDocument();
  });

  it('labels the binding visual as a conceptual illustration', async () => {
    await openBuild();
    expect(
      screen.getAllByText(/not molecular docking/i).length,
      'the conceptual-illustration disclaimer must be present',
    ).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * Optimise screen
 * ================================================================== */
describe('Optimise screen', () => {
  async function openOptimise() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
  }

  it('renames lambda to Selectivity Priority but keeps the symbol available', async () => {
    await openOptimise();
    expect(screen.getAllByText(/selectivity priority/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('explains both ends of the slider in plain words', async () => {
    await openOptimise();
    expect(screen.getByText(/chase PET only/i)).toBeInTheDocument();
    expect(screen.getAllByText(/avoid the others/i).length).toBeGreaterThan(0);
  });

  it('moves the slider and updates the explanation', async () => {
    await openOptimise();
    const slider = screen.getByRole('slider');
    await act(async () => {
      fireEvent.change(slider, { target: { value: '5' } });
    });
    expect(await screen.findByText(/avoiding the others dominates everything/i)).toBeInTheDocument();
  });

  it('offers the five benchmark values as discrete steps', async () => {
    await openOptimise();
    const group = screen.getByRole('group', { name: /benchmark priority values/i });
    for (const value of ['0', '0.5', '1', '2', '5']) {
      expect(within(group).getByRole('button', { name: value })).toBeInTheDocument();
    }
  });

  it('shows all nine real pipeline stages, waiting before a run', async () => {
    await openOptimise();
    for (const stage of STAGES) {
      expect(screen.getByText(stage.title), `stage ${stage.id}`).toBeInTheDocument();
    }
    expect(screen.getAllByText(/waiting/i).length).toBeGreaterThan(0);
  });

  it('labels unmeasurable stages honestly instead of faking a percentage', async () => {
    await openOptimise();
    expect(
      screen.getAllByText(/no measurable progress, so elapsed time is shown/i).length,
    ).toBeGreaterThan(0);
  });

  it('runs the pipeline and reports completion with real timings', async () => {
    await openOptimise();
    const start = (await screen.findAllByRole('button', { name: /start a live run/i }))[0];
    await act(async () => {
      fireEvent.click(start);
    });
    expect(await screen.findByText(/run complete/i)).toBeInTheDocument();
    // The sentence is assembled from several nodes, so assert on the text of
    // the paragraph that contains it rather than on a single text node.
    const summary = screen.getByText(/designs scored against/i);
    expect(summary.textContent).toMatch(/1,679,616/);
    expect(summary.textContent).toMatch(/3 plastics/i);
    expect(summary.textContent).toMatch(/Seed 42/i);
  });

  it('cancels a run that is in flight', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    // Hold the reply so the run stays in flight.
    liveWorkers[0].autoRespond = false;
    const start = (await screen.findAllByRole('button', { name: /start a live run/i }))[0];
    await act(async () => {
      fireEvent.click(start);
    });
    const cancel = await screen.findByRole('button', { name: /cancel the run/i });
    liveWorkers[0].autoRespond = true;
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(await screen.findByText(/run cancelled/i)).toBeInTheDocument();
  });

  it('drops a stale run reply after a newer run supersedes it', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    const worker = liveWorkers[0];

    // A reply tagged with a runId the app is not waiting for must be ignored.
    await act(async () => {
      worker.emit({
        kind: 'run',
        runId: 'run-does-not-exist',
        record: makeRunRecord('run-does-not-exist', 1, 999),
      });
    });
    expect(screen.queryByText(/run complete/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });

  it('surfaces a non-fatal worker error and lets it be dismissed', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      liveWorkers[0].emit({
        kind: 'error',
        runId: 'x',
        message: 'simulated allocation failure',
        stage: 'scoring',
        fatal: false,
      });
    });
    expect(await screen.findByText(/simulated allocation failure/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    });
    await waitFor(() =>
      expect(screen.queryByText(/simulated allocation failure/i)).not.toBeInTheDocument(),
    );
  });
});

/* ================================================================== *
 * Compare screen
 * ================================================================== */
describe('Compare screen', () => {
  async function openCompareWithRun() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.compare.nav);
    await screen.findByText(SCREENS.compare.title);
  }

  it('shows a useful empty state before any run', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.compare.nav);
    expect(await screen.findByText(/no results to compare yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to optimise/i })).toBeInTheDocument();
  });

  it('renders the podium, the table and the solver comparison after a run', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/top three designs/i)).toBeInTheDocument();
    expect(screen.getByText(/rank 1 - proven best/i)).toBeInTheDocument();
    expect(screen.getByText(/how the search methods compared/i)).toBeInTheDocument();
  });

  it('reports D-Wave as NOT EXECUTED rather than inventing a result', async () => {
    await openCompareWithRun();
    expect(screen.getAllByText(/D-Wave quantum annealer/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NOT EXECUTED/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NO QUANTUM HARDWARE EXECUTION/i).length).toBeGreaterThan(0);
  });

  it('warns that runtimes are device-specific before comparing them', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/read the environment before comparing times/i)).toBeInTheDocument();
  });

  it('filters candidates and shows an empty state when nothing matches', async () => {
    await openCompareWithRun();
    const search = screen.getByRole('searchbox');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'ZZZZ_NO_MATCH' } });
    });
    expect(await screen.findByText(/nothing matches that filter/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    });
    await waitFor(() => expect(screen.queryByText(/nothing matches/i)).not.toBeInTheDocument());
  });

  it('sorts the candidate table by a different column', async () => {
    await openCompareWithRun();
    const header = screen.getByRole('button', { name: /^PET/i });
    await act(async () => {
      fireEvent.click(header);
    });
    expect(screen.getByRole('button', { name: /PET \*/i })).toBeInTheDocument();
  });

  it('draws the trade-off chart only when asked, and labels it as sampled', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/trade-off chart not drawn yet/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /draw the trade-off chart/i }));
    });
    expect(
      (await screen.findAllByText(/PET score against worst off-target/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Sampled$/i).length).toBeGreaterThan(0);
  });

  it('opens a candidate in the builder', async () => {
    await openCompareWithRun();
    const open = screen.getAllByRole('button', { name: /open in the builder/i })[0];
    await act(async () => {
      fireEvent.click(open);
    });
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Understand screen
 * ================================================================== */
describe('Understand screen', () => {
  async function openUnderstand() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.understand.nav);
    await screen.findByText(SCREENS.understand.title);
  }

  it('answers "why 48 switches" with an interactive 8 x 6 grid', async () => {
    await openUnderstand();
    expect(screen.getByText(/why are there 48 switches/i)).toBeInTheDocument();
    const switches = screen.getAllByRole('button', { name: /^switch \d+: position/i });
    expect(switches).toHaveLength(48);
  });

  it('shows the constraint being violated when an extra switch is turned on', async () => {
    await openUnderstand();
    // Position 1's chosen family is index 2; turning on index 0 breaks the row.
    const extra = screen.getByRole('button', {
      name: /^switch 0: position 1, large aromatic ring/i,
    });
    await act(async () => {
      fireEvent.click(extra);
    });
    expect(await screen.findByText(/break the rule/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fix the rule/i }));
    });
    expect(await screen.findByText(/every row has exactly one switch on/i)).toBeInTheDocument();
  });

  it('renders the real QUBO heatmap with its coefficient statistics', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /the puzzle matrix/i }));
    });
    expect(await screen.findByText(/the puzzle, as a matrix/i)).toBeInTheDocument();
    const base = combineObjective(model.flat, 1);
    expect(
      await screen.findByText(safePenalty(base).toFixed(1)),
      'the real penalty bound must be displayed',
    ).toBeInTheDocument();
  });

  it('explains the scale trade-off and labels derived counts as estimates', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /scale and limits/i }));
    });
    expect(await screen.findByText(/how big does this get/i)).toBeInTheDocument();
    expect(screen.getByText(/25,600,000,000/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Model estimate$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/what the reduced alphabet costs us/i)).toBeInTheDocument();
  });

  it('runs the confidence checks and shows measured errors', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confidence centre/i }));
    });
    expect(await screen.findByRole('heading', { name: /confidence centre/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /re-run the checks/i }));
    });
    expect(await screen.findByText(/encoding round-trips/i)).toBeInTheDocument();
    expect(screen.getByText(/matrix vs direct score/i)).toBeInTheDocument();
  });

  it('explains why an R-squared of 1.0 is expected rather than hiding it', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.understand.nav);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confidence centre/i }));
    });
    expect(
      await screen.findByText(/is normally a red flag/i),
    ).toBeInTheDocument();
  });

  it('publishes the legacy-tab migration map', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /about this project/i }));
    });
    expect(await screen.findByText(/where each part of the original tool lives now/i)).toBeInTheDocument();
    for (const legacy of ['Pipeline', 'Peptides', 'Sweep', 'Solvers', 'QUBO', 'Verify', 'Export', 'About', 'Honesty']) {
      expect(screen.getAllByText(legacy).length, `migration row for ${legacy}`).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Scale \(P1\)/)).toBeInTheDocument();
  });

  it('states every limitation in the honesty section', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /what this does not show/i }));
    });
    expect(await screen.findByRole('heading', { name: /what this does and does not show/i })).toBeInTheDocument();
    expect(screen.getByText(/no laboratory validation/i)).toBeInTheDocument();
    expect(screen.getByText(/not a model of degradation or recycling/i)).toBeInTheDocument();
    expect(screen.getByText(/a ranking score, not an affinity/i)).toBeInTheDocument();
    expect(screen.getByText(/families, not amino acids/i)).toBeInTheDocument();
    expect(screen.getAllByText(/NO QUANTUM HARDWARE EXECUTION/i).length).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * Results screen
 * ================================================================== */
describe('Results screen', () => {
  async function openResultsWithRun() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.results.nav);
    await screen.findByText(SCREENS.results.title);
  }

  it('shows a useful empty state before any run', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.results.nav);
    expect(await screen.findByText(/no run to write up yet/i)).toBeInTheDocument();
  });

  it('writes up the winner with all eight families named in full', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/the eight positions, named in full/i)).toBeInTheDocument();
    const table = screen.getByRole('table', {
      name: /each position of the selected design/i,
    });
    expect(within(table).getAllByRole('row')).toHaveLength(9); // header + 8
  });

  it('explains why the winner ranked first', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/why it ranked first/i)).toBeInTheDocument();
    expect(screen.getByText(/lowest value of any of the/i)).toBeInTheDocument();
  });

  it('defines selectivity and gives both margin variants', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/margin against the worst case/i)).toBeInTheDocument();
    expect(screen.getByText(/margin against the average/i)).toBeInTheDocument();
  });

  it('shows sensitivity to the priority dial', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/how sensitive is this answer/i)).toBeInTheDocument();
    expect(screen.getByText(/the winner depends on the dial you chose/i)).toBeInTheDocument();
  });

  it('records the run configuration including the seed', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/exactly how this run was configured/i)).toBeInTheDocument();
    expect(screen.getByText(/random seed/i)).toBeInTheDocument();
  });

  it('offers six real downloads, each with a non-empty preview', async () => {
    await openResultsWithRun();
    const buttons = screen.getAllByRole('button', { name: /^download$/i });
    expect(buttons).toHaveLength(6);
    expect(screen.getAllByText(/\.csv$/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/\.json$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\.md$/i).length).toBeGreaterThanOrEqual(1);
  });

  it('actually produces a file when a download is clicked', async () => {
    await openResultsWithRun();
    const clicked: string[] = [];
    const originalCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'a') {
        (element as HTMLAnchorElement).click = () => {
          clicked.push((element as HTMLAnchorElement).download);
        };
      }
      return element;
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => {},
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^download$/i })[0]);
    });
    expect(clicked.length, 'a download must have been triggered').toBeGreaterThan(0);
    expect(clicked[0]).toMatch(/top-candidates.*\.csv$/);
    spy.mockRestore();
  });

  it('states the privacy position and offers a full reset', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/nothing on this screen was uploaded anywhere/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset everything and start over/i }));
    });
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Shared-link handling (untrusted input reaching the UI)
 * ================================================================== */
describe('shared links', () => {
  it('applies a valid design from the URL hash', async () => {
    window.history.pushState({}, '', '/build#s=45012345&l=2');
    await renderApp();
    await skipTour();
    await screen.findByText(SCREENS.build.title);
    await waitFor(() =>
      expect(screen.getByText(classSequence([4, 5, 0, 1, 2, 3, 4, 5]))).toBeInTheDocument(),
    );
  });

  it('ignores a malformed hash without crashing', async () => {
    window.history.pushState({}, '', '/build#s=notvalid&l=999');
    await renderApp();
    await skipTour();
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
    // Falls back to the reference design rather than erroring.
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
  });

  it('ignores an out-of-range class digit in the hash', async () => {
    window.history.pushState({}, '', '/build#s=99999999');
    await renderApp();
    await skipTour();
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Worker-unavailable degradation
 * ================================================================== */
describe('degradation when the worker cannot start', () => {
  it('keeps the site readable and says why scoring is off', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker is blocked in this environment');
        }
      },
    );
    render(<App />);
    // The site must stay readable; only computation is lost.
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/could not start the computation worker/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Worker is blocked in this environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });
});
