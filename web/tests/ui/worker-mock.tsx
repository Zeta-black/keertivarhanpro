/**
 * A Worker stand-in for the UI suites.
 *
 * jsdom has no module-worker support, so every screen test needs one of these.
 * It speaks the REAL protocol and computes with the REAL science core, so what
 * the screens receive is genuine model output rather than invented fixtures -
 * which is what lets these tests catch a wiring bug (wrong field, stale
 * response, missing state) rather than only a crash.
 *
 * It lives in its own module because three suites use it, and three copies of
 * a mock this size is how the copies drift apart.
 */
import { vi } from 'vitest';

import {
  CLASS_INFO,
  VALID_SEQUENCES,
  classSequence,
  indexToCodes,
} from '../../src/science/alphabet';
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

export const model = realModel();

/** Every Worker the app creates in a test, so tests can drive them. */
export const liveWorkers: StubWorker[] = [];

/**
 * A Worker stand-in. It records what the app sent and replies with real
 * computed payloads. `autoRespond: false` lets a test hold a reply back and
 * assert the loading state, or reply out of order to prove staleness handling.
 */
export class StubWorker implements Partial<Worker> {
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

export function toCandidate(index: number, lambda: number, rank: number): CandidateRecord {
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
export function makeRunRecord(runId: string, lambda: number, seed: number): RunRecord {
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
export function respondTo(message: WorkerRequest): WorkerResponse[] {
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


/**
 * Installs the stub as `globalThis.Worker` and clears any workers left over
 * from a previous test. Call from `beforeEach`; pair with
 * `vi.unstubAllGlobals()` in `afterEach`.
 */
export function installWorkerMock(): void {
  liveWorkers.length = 0;
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return new StubWorker() as unknown as Worker;
      }
    },
  );
}
