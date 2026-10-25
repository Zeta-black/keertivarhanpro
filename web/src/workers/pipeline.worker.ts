/// <reference lib="webworker" />
/**
 * The computation worker. Everything expensive happens here so the main thread
 * stays responsive and the page never freezes.
 *
 * Honesty rules this file follows:
 *  - Progress fractions are real counts of real work, never timers.
 *  - A stage marked `measurable: false` reports `fraction: null`, and the UI
 *    shows activity plus elapsed time instead of a fake percentage.
 *  - Cancellation is checked between chunks and actually stops the loop.
 *  - Every response carries its runId so the client can drop stale results.
 */

import {
  VALID_SEQUENCES,
  classSequence,
  decode,
  encode,
  indexToCodes,
  isValidOneHot,
  representativeSequence,
  variableIndex,
} from '../science/alphabet';
import {
  candidateMetrics,
  objective as objectiveOf,
  objectiveParts,
} from '../science/objective';
import {
  PLASTICS,
  buildModel,
  contributions,
  scoreAll,
  scoreRange,
  scoreStats,
  type PottsModel,
  type PottsModelJson,
} from '../science/potts';
import {
  addOneHotConstraint,
  combineObjective,
  coefficientMass,
  maxAbsCoefficient,
  quadraticEntries,
  quboEnergy,
  quboEnergyOfCodes,
  quboToIsing,
  safePenalty,
} from '../science/qubo';
import { makeRng } from '../science/rng';
import {
  exactBruteForce,
  objectiveAt,
  simulatedAnnealing,
  type FullSpaceScores,
} from '../science/solvers';
import { fitSurrogate } from '../science/surrogate';
import {
  DEFAULT_RUN_CONFIG,
  type CandidateRecord,
  type DensityCell,
  type ParetoPoint,
  type TradeoffPayload,
  type QuboPayload,
  type RunConfig,
  type RunRecord,
  type SolverRecord,
  type StageId,
  type SurrogateReport,
  type SweepPoint,
  type VerifyReport,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';
import { groupInt } from '../content/format';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let model: PottsModel | null = null;
let modelSource = '';
/** Full-space exact scores, computed once and reused for every lambda. */
let fullSpace: FullSpaceScores | null = null;
/** The run currently executing. Anything else is stale. */
let activeRunId: string | null = null;
let cancelledRunIds = new Set<string>();

function post(message: WorkerResponse): void {
  ctx.postMessage(message);
}

function cancelled(runId: string): boolean {
  return cancelledRunIds.has(runId) || activeRunId !== runId;
}

/** Yield to the event loop so a `cancel` message can actually be received. */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function toCandidate(
  index: number,
  lambda: number,
  rank: number,
  m: PottsModel,
): CandidateRecord {
  const codes = indexToCodes(index);
  const scores = scoreAll(codes, m.flat);
  const metrics = candidateMetrics(codes, scores);
  return {
    index,
    codes,
    classSequence: classSequence(codes),
    representative: representativeSequence(codes),
    scores,
    objective: objectiveOf(scores, lambda),
    rank,
    metrics: {
      meanOffTarget: metrics.meanOffTarget,
      worstOffTarget: metrics.worstOffTarget,
      marginMean: metrics.marginMean,
      marginWorst: metrics.marginWorst,
      aromaticFraction: metrics.aromaticFraction,
      hydrophobicFraction: metrics.hydrophobicFraction,
      polarFraction: metrics.polarFraction,
      netChargeClassBalance: metrics.netChargeClassBalance,
      warnings: metrics.warnings,
    },
  };
}

async function loadModel(runId: string, url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`model file returned HTTP ${response.status}`);
    }
    const json = (await response.json()) as PottsModelJson;
    model = buildModel(json);
    modelSource = json.source;
    post({
      kind: 'ready',
      runId,
      modelSource: json.source,
      orientation: json.orientation,
    });
  } catch (error) {
    post({
      kind: 'error',
      runId,
      message: `Could not load the scoring model: ${(error as Error).message}`,
      stage: null,
      fatal: true,
    });
  }
}

/** Score the whole space in cancellable chunks, reporting honest progress. */
async function computeFullSpace(runId: string, m: PottsModel): Promise<FullSpaceScores | null> {
  const out: Record<string, Float64Array> = {};
  const CHUNK = 60_000;
  const totalWork = VALID_SEQUENCES * PLASTICS.length;
  let done = 0;
  const t0 = performance.now();

  for (const plastic of PLASTICS) {
    let array: Float64Array;
    try {
      array = new Float64Array(VALID_SEQUENCES);
    } catch {
      post({
        kind: 'error',
        runId,
        message:
          'This device could not allocate the 13 MB score array needed for a full live run. Use Guided Replay instead, which needs no allocation.',
        stage: 'scoring',
        fatal: false,
      });
      return null;
    }
    for (let from = 0; from < VALID_SEQUENCES; from += CHUNK) {
      if (cancelled(runId)) return null;
      scoreRange(m.flat[plastic], array, from, from + CHUNK);
      done += Math.min(CHUNK, VALID_SEQUENCES - from);
      post({
        kind: 'stage',
        runId,
        stage: 'scoring',
        status: 'active',
        fraction: done / totalWork,
        note: `scored ${groupInt(done)} of ${groupInt(totalWork)} sequence-plastic pairs`,
        elapsedMs: performance.now() - t0,
      });
      await breathe();
    }
    out[plastic] = array;
  }
  return out as unknown as FullSpaceScores;
}

function stage(
  runId: string,
  id: StageId,
  status: 'active' | 'done',
  fraction: number | null,
  note: string,
  elapsedMs: number,
): void {
  post({ kind: 'stage', runId, stage: id, status, fraction, note, elapsedMs });
}

async function runPipeline(runId: string, config: RunConfig): Promise<void> {
  if (!model) {
    post({
      kind: 'error',
      runId,
      message: 'The scoring model is not loaded yet.',
      stage: null,
      fatal: true,
    });
    return;
  }
  const m = model;
  const t0 = performance.now();
  const timings: Partial<Record<StageId, number>> = {};
  const mark = (id: StageId, from: number) => {
    timings[id] = performance.now() - from;
  };

  try {
    // ---- 1. variable mapping -------------------------------------------
    let s = performance.now();
    stage(runId, 'variableMapping', 'active', null, 'building the 48-variable map', 0);
    const variableMap: { binaryIndex: number; position: number; classIndex: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      for (let a = 0; a < 6; a += 1) {
        variableMap.push({ binaryIndex: variableIndex(i, a), position: i, classIndex: a });
      }
    }
    mark('variableMapping', s);
    stage(
      runId,
      'variableMapping',
      'done',
      1,
      `${variableMap.length} binary variables mapped`,
      timings.variableMapping!,
    );
    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'variableMapping' });

    // ---- 2. enumeration -------------------------------------------------
    s = performance.now();
    stage(runId, 'enumeration', 'active', 0, 'enumerating the valid class space', 0);
    // Enumeration is implicit in the index space: sequence n maps to codes via
    // base-6 digits, so there is nothing to materialise. Say so rather than
    // pretending to spend time here.
    mark('enumeration', s);
    stage(
      runId,
      'enumeration',
      'done',
      1,
      `${groupInt(VALID_SEQUENCES)} valid sequences addressable (base-6 index, nothing materialised)`,
      timings.enumeration!,
    );
    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'enumeration' });

    // ---- 3. scoring -----------------------------------------------------
    s = performance.now();
    stage(runId, 'scoring', 'active', 0, 'scoring the full space', 0);
    if (!fullSpace) {
      const computed = await computeFullSpace(runId, m);
      if (!computed) {
        if (cancelled(runId)) post({ kind: 'cancelled', runId, atStage: 'scoring' });
        return;
      }
      fullSpace = computed;
    }
    const scores = fullSpace;
    mark('scoring', s);
    stage(
      runId,
      'scoring',
      'done',
      1,
      `${groupInt(VALID_SEQUENCES * 3)} exact Potts evaluations complete`,
      timings.scoring!,
    );
    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'scoring' });

    const stats = {
      PET: scoreStats(scores.PET),
      PE: scoreStats(scores.PE),
      PP: scoreStats(scores.PP),
    };

    // ---- 4 + 5. feature sampling and surrogate --------------------------
    const surrogates: SurrogateReport[] = [];
    s = performance.now();
    if (config.surrogate.enabled) {
      stage(runId, 'featureSampling', 'active', 0, 'drawing disjoint train/validation/test sets', 0);
      mark('featureSampling', s);
      stage(
        runId,
        'featureSampling',
        'done',
        1,
        `${groupInt(
          config.surrogate.trainSize +
            config.surrogate.validationSize +
            config.surrogate.testSize,
        )} sequences sampled without replacement (seed ${config.seed})`,
        timings.featureSampling!,
      );

      s = performance.now();
      for (let p = 0; p < PLASTICS.length; p += 1) {
        const plastic = PLASTICS[p];
        if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'surrogate' });
        stage(
          runId,
          'surrogate',
          'active',
          p / PLASTICS.length,
          `fitting the ${plastic} surrogate (1056 features)`,
          performance.now() - s,
        );
        await breathe();
        const fitted = fitSurrogate(m.flat[plastic], {
          alpha: config.surrogate.alpha,
          seed: config.seed + p,
          trainSize: config.surrogate.trainSize,
          validationSize: config.surrogate.validationSize,
          testSize: config.surrogate.testSize,
        });
        surrogates.push({
          plastic,
          alpha: fitted.alpha,
          seed: fitted.seed,
          train: fitted.metrics.train,
          validation: fitted.metrics.validation,
          test: fitted.metrics.test,
          splitsDisjoint: fitted.splitsDisjoint,
          fitMs: fitted.fitMs,
        });
      }
      mark('surrogate', s);
      stage(
        runId,
        'surrogate',
        'done',
        1,
        `3 surrogates fitted; test R-squared ${surrogates
          .map((x) => x.test.r2.toFixed(6))
          .join(', ')}`,
        timings.surrogate!,
      );
    } else {
      stage(
        runId,
        'featureSampling',
        'done',
        null,
        'skipped: surrogate disabled for this device',
        0,
      );
      stage(runId, 'surrogate', 'done', null, 'skipped: surrogate disabled for this device', 0);
    }
    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'surrogate' });

    // ---- 6. QUBO construction -------------------------------------------
    s = performance.now();
    stage(runId, 'quboConstruction', 'active', null, 'assembling the constrained QUBO', 0);
    const base = combineObjective(m.flat, config.lambda);
    const penalty = safePenalty(base, config.penaltyMultiplier);
    const constrained = addOneHotConstraint(base, penalty);
    mark('quboConstruction', s);
    stage(
      runId,
      'quboConstruction',
      'done',
      1,
      `48 linear + ${quadraticEntries(base).length} quadratic terms, penalty P = ${penalty.toFixed(1)}`,
      timings.quboConstruction!,
    );
    if (cancelled(runId))
      return void post({ kind: 'cancelled', runId, atStage: 'quboConstruction' });

    // ---- 7. solving ------------------------------------------------------
    s = performance.now();
    stage(runId, 'solving', 'active', 0, 'exact brute force over the full space', 0);
    await breathe();
    const brute = exactBruteForce(scores, config.lambda, config.topN, config.tolerance);

    const solvers: SolverRecord[] = [
      {
        solver: 'Brute force (exact)',
        lambda: config.lambda,
        status: 'EXECUTED',
        bestObjective: brute.bestObjective,
        classSequence: classSequence(indexToCodes(brute.bestIndex)),
        validityRate: 1,
        successRate: 1,
        runtimeMs: brute.runtimeMs,
        seed: null,
        reads: brute.evaluated,
        medianBestEnergy: null,
        stdBestEnergy: null,
        note: `Checked all ${groupInt(brute.evaluated)} valid sequences. This is the proven optimum for this model, so it is the reference the others are scored against.`,
        exact: true,
      },
    ];

    if (config.annealing.enabled) {
      stage(
        runId,
        'solving',
        'active',
        0.4,
        'simulated annealing on the 48-variable QUBO',
        performance.now() - s,
      );
      await breathe();
      let stop = false;
      const anneal = simulatedAnnealing(constrained, {
        reads: config.annealing.reads,
        sweeps: config.annealing.sweeps,
        runs: config.annealing.runs,
        seed: config.seed,
        referenceEnergy: brute.bestObjective,
        tolerance: config.tolerance,
        onProgress: (doneReads, totalReads) => {
          if (cancelled(runId)) {
            stop = true;
            return false;
          }
          stage(
            runId,
            'solving',
            'active',
            0.4 + 0.6 * (doneReads / totalReads),
            `annealing read ${doneReads} of ${totalReads}`,
            performance.now() - s,
          );
          return true;
        },
      });
      if (stop) return void post({ kind: 'cancelled', runId, atStage: 'solving' });

      solvers.push({
        solver: 'Simulated annealing',
        lambda: config.lambda,
        status: 'EXECUTED',
        bestObjective: anneal.bestEnergy,
        classSequence: anneal.bestCodes ? classSequence(anneal.bestCodes) : null,
        validityRate: anneal.validityRate,
        successRate: anneal.successRate,
        runtimeMs: anneal.runtimeMs,
        seed: anneal.seed,
        reads: anneal.totalSamples,
        medianBestEnergy: anneal.medianBestEnergy,
        stdBestEnergy: anneal.stdBestEnergy,
        note: `${anneal.runRows.length} runs x ${config.annealing.reads} reads x ${config.annealing.sweeps} sweeps, seed ${anneal.seed}. Samples in binary space, so it can land on invalid assignments; ${(anneal.validityRate * 100).toFixed(1)}% were valid.`,
        exact: false,
      });
    } else {
      solvers.push({
        solver: 'Simulated annealing',
        lambda: config.lambda,
        status: 'SKIPPED',
        bestObjective: null,
        classSequence: null,
        validityRate: null,
        successRate: null,
        runtimeMs: null,
        seed: null,
        reads: null,
        medianBestEnergy: null,
        stdBestEnergy: null,
        note: 'Disabled for this device to keep the page responsive.',
        exact: false,
      });
    }

    solvers.push({
      solver: 'D-Wave quantum annealer',
      lambda: config.lambda,
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
      note: 'NO QUANTUM HARDWARE EXECUTION. No quantum processor was used in this project, in the browser or in the Python benchmark. The QUBO is in a form a quantum annealer could accept; separately, a gate-model XY-mixer QAOA is run on the same objective by exact statevector simulation (see the Quantum screen and results/quantum_*.csv). No speedup is claimed.',
      exact: false,
    });

    mark('solving', s);
    stage(runId, 'solving', 'done', 1, `${solvers.length} solver entries recorded`, timings.solving!);
    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'solving' });

    // ---- 8. analysis -----------------------------------------------------
    s = performance.now();
    stage(runId, 'analysis', 'active', 0, 'ranking candidates', 0);
    const candidates = brute.order.map((idx, i) => toCandidate(idx, config.lambda, i + 1, m));

    const sweep: SweepPoint[] = [];
    for (let i = 0; i < config.sweepLambdas.length; i += 1) {
      if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'analysis' });
      const lam = config.sweepLambdas[i];
      const r = exactBruteForce(scores, lam, 1, config.tolerance);
      const q = combineObjective(m.flat, lam);
      sweep.push({
        lambda: lam,
        best: toCandidate(r.bestIndex, lam, 1, m),
        penalty: safePenalty(q, config.penaltyMultiplier),
        runtimeMs: r.runtimeMs,
        optimumHits: r.optimumHits,
      });
      stage(
        runId,
        'analysis',
        'active',
        (i + 1) / config.sweepLambdas.length,
        `solved lambda = ${lam} exactly`,
        performance.now() - s,
      );
      await breathe();
    }
    mark('analysis', s);
    stage(
      runId,
      'analysis',
      'done',
      1,
      `${candidates.length} ranked candidates and ${sweep.length} exact sweep points`,
      timings.analysis!,
    );

    // ---- 9. export -------------------------------------------------------
    s = performance.now();
    stage(runId, 'export', 'active', null, 'assembling the run record', 0);
    const verify = runVerify(m, config.lambda, config.seed, 250, config.penaltyMultiplier);
    const record: RunRecord = {
      runId,
      config,
      mode: 'live',
      candidates,
      sweep,
      solvers,
      surrogates,
      verify,
      stats,
      searchSpace: {
        positions: 8,
        classes: 6,
        binaryVariables: 48,
        validSequences: VALID_SEQUENCES,
      },
      timings,
      totalMs: performance.now() - t0,
      environment: {
        userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
        hardwareConcurrency:
          typeof navigator === 'undefined' ? 0 : (navigator.hardwareConcurrency ?? 0),
        deviceMemoryGb:
          typeof navigator === 'undefined'
            ? null
            : ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null),
      },
      quantumHardware: 'NO QUANTUM HARDWARE EXECUTION',
      modelSource,
      startedAtIso: new Date().toISOString(),
    };
    mark('export', s);
    stage(runId, 'export', 'done', 1, 'run record ready to download', timings.export!);

    if (cancelled(runId)) return void post({ kind: 'cancelled', runId, atStage: 'export' });
    post({ kind: 'run', runId, record });
  } catch (error) {
    post({
      kind: 'error',
      runId,
      message: (error as Error).message || 'the pipeline failed',
      stage: null,
      fatal: false,
    });
  }
}

/** Live numerical self-check: the claims the Verify screen makes, measured. */
function runVerify(
  m: PottsModel,
  lambda: number,
  seed: number,
  sampleSize: number,
  penaltyMultiplier: number,
): VerifyReport {
  const t0 = performance.now();
  const base = combineObjective(m.flat, lambda);
  const penalty = safePenalty(base, penaltyMultiplier);
  const constrained = addOneHotConstraint(base, penalty);
  const rng = makeRng(seed);

  let maxQuboObjectiveError = 0;
  let maxPenaltyResidue = 0;
  let roundTrips = 0;
  let invalidTested = 0;
  let invalidCorrectlyPenalised = 0;

  for (let i = 0; i < sampleSize; i += 1) {
    const codes = indexToCodes(rng.int(VALID_SEQUENCES));
    const viaScores = objectiveOf(scoreAll(codes, m.flat), lambda);
    const viaQubo = quboEnergyOfCodes(codes, base);
    maxQuboObjectiveError = Math.max(maxQuboObjectiveError, Math.abs(viaQubo - viaScores));
    maxPenaltyResidue = Math.max(
      maxPenaltyResidue,
      Math.abs(quboEnergyOfCodes(codes, constrained) - viaQubo),
    );
    const x = encode(codes);
    if (isValidOneHot(x) && decode(x).every((c, k) => c === codes[k])) roundTrips += 1;

    // Break one-hot deliberately and confirm the penalty dominates.
    const broken = Uint8Array.from(x);
    broken[variableIndex(rng.int(8), rng.int(6))] = 1;
    if (!isValidOneHot(broken)) {
      invalidTested += 1;
      const validEnergy = quboEnergy(x, constrained);
      if (quboEnergy(broken, constrained) > validEnergy) invalidCorrectlyPenalised += 1;
    }
  }

  return {
    sampleSize,
    seed,
    maxQuboObjectiveError,
    maxPenaltyResidue,
    encodeDecodeRoundTrips: roundTrips,
    invalidTested,
    invalidCorrectlyPenalised,
    penaltyBound: penalty,
    lambda,
    runtimeMs: performance.now() - t0,
  };
}

function buildQuboPayload(
  m: PottsModel,
  lambda: number,
  penaltyMultiplier: number,
): QuboPayload {
  const base = combineObjective(m.flat, lambda);
  const penalty = safePenalty(base, penaltyMultiplier);
  const mass = coefficientMass(base);
  const ising = quboToIsing(base);
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < ising.h.length; i += 1) {
    hMin = Math.min(hMin, ising.h[i]);
    hMax = Math.max(hMax, ising.h[i]);
  }
  let jMin = Infinity;
  let jMax = -Infinity;
  for (let i = 0; i < ising.J.length; i += 1) {
    if (ising.J[i] === 0) continue;
    jMin = Math.min(jMin, ising.J[i]);
    jMax = Math.max(jMax, ising.J[i]);
  }
  return {
    lambda,
    penalty,
    penaltyMultiplier,
    offset: base.offset,
    linear: Array.from(base.linear),
    quadratic: quadraticEntries(base).map((e) => [e.u, e.v, e.value] as [number, number, number]),
    maxAbsCoefficient: maxAbsCoefficient(base),
    linearMass: mass.linear,
    quadraticMass: mass.quadratic,
    ising: {
      hMin,
      hMax,
      jMin: Number.isFinite(jMin) ? jMin : 0,
      jMax: Number.isFinite(jMax) ? jMax : 0,
      constant: ising.constant,
    },
  };
}

/**
 * The trade-off chart, computed over EVERY valid design. Nothing is sampled.
 *
 * This replaced a random 1,200-design scatter. The frontier that scatter drew
 * was the frontier *of the sample*, which is not the frontier of the problem:
 * a random 0.07% of the space will miss most of the staircase. Both parts
 * below use all 1,679,616 designs.
 *
 * Frontier, exactly
 * -----------------
 * We want the points no other design beats on both axes (higher PET, lower
 * worst off-target). Doing that by sorting 1.68 million indices with a JS
 * comparator is slow, so it is done in two stages:
 *
 *   1. Bin the off-target axis. For each bin record the best PET inside it,
 *      then take a running maximum across bins in increasing off-target order.
 *      Any design whose PET is below the running maximum of all *earlier* bins
 *      is dominated - some design has strictly lower off-target and at least
 *      as much PET - so it can be dropped without comparing it to anything.
 *      This is a safe prune, not an approximation.
 *   2. Sort only the survivors and sweep them exactly.
 *
 * The survivor set is a few thousand at most, so the sort is trivial and the
 * result is the true frontier of the whole space.
 *
 * Density, honestly
 * -----------------
 * A 2D histogram of all designs. Counts are real counts. This is what the
 * reader sees instead of dots, and because every design lands in a bin, the
 * picture is of the whole space rather than a sample of it.
 */
function buildTradeoff(
  scores: FullSpaceScores,
  lambda: number,
): Omit<TradeoffPayload, 'lambda'> {
  const startedAt = Date.now();
  const n = VALID_SEQUENCES;
  const pet = scores.PET;

  // Worst off-target per design, kept so it is computed once rather than in
  // every pass below.
  const off = new Float64Array(n);
  let petMin = Infinity;
  let petMax = -Infinity;
  let offMin = Infinity;
  let offMax = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const worst = scores.PE[i] > scores.PP[i] ? scores.PE[i] : scores.PP[i];
    off[i] = worst;
    const p = pet[i];
    if (p < petMin) petMin = p;
    if (p > petMax) petMax = p;
    if (worst < offMin) offMin = worst;
    if (worst > offMax) offMax = worst;
  }

  /* ---- stage 1: prune with a binned running maximum ---- */
  const PRUNE_BINS = 4096;
  const offSpan = offMax - offMin || 1;
  const binOf = (value: number) => {
    const b = Math.floor(((value - offMin) / offSpan) * PRUNE_BINS);
    return b < 0 ? 0 : b >= PRUNE_BINS ? PRUNE_BINS - 1 : b;
  };

  const binBestPet = new Float64Array(PRUNE_BINS).fill(-Infinity);
  for (let i = 0; i < n; i += 1) {
    const b = binOf(off[i]);
    if (pet[i] > binBestPet[b]) binBestPet[b] = pet[i];
  }
  // runningMax[b] = best PET found in any bin strictly before b.
  const runningMax = new Float64Array(PRUNE_BINS);
  let best = -Infinity;
  for (let b = 0; b < PRUNE_BINS; b += 1) {
    runningMax[b] = best;
    if (binBestPet[b] > best) best = binBestPet[b];
  }

  const candidates: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (pet[i] >= runningMax[binOf(off[i])]) candidates.push(i);
  }

  /* ---- stage 2: exact sweep over the survivors ---- */
  candidates.sort((a, b) => (off[a] - off[b]) || (pet[b] - pet[a]));
  const frontier: ParetoPoint[] = [];
  let bestPet = -Infinity;
  for (const index of candidates) {
    if (pet[index] > bestPet) {
      bestPet = pet[index];
      frontier.push({
        index,
        pet: pet[index],
        worstOff: off[index],
        objective: objectiveAt(scores, index, lambda),
        onFrontier: true,
      });
    }
  }

  /* ---- the objective optimum at this lambda, so it is always plotted ---- */
  const optimum = exactBruteForce(scores, lambda, 1);
  if (!frontier.some((point) => point.index === optimum.bestIndex)) {
    frontier.push({
      index: optimum.bestIndex,
      pet: pet[optimum.bestIndex],
      worstOff: off[optimum.bestIndex],
      objective: objectiveAt(scores, optimum.bestIndex, lambda),
      // Honest: the lambda optimum need not sit on the PET-vs-worst-off
      // frontier, because the objective also counts the other off-target.
      onFrontier: false,
    });
  }

  /* ---- density over every design ---- */
  // Sized for the DOM, not for the data. A 150x110 grid leaves ~11,500
  // occupied cells, which is ~11,500 SVG rects; this is ~4,700, the same
  // order as the QUBO heatmap already on the Understand screen, and at a
  // 700px-wide plot each cell is still only ~7px across.
  const BINS_X = 96;
  const BINS_Y = 68;
  const petSpan = petMax - petMin || 1;
  const widthX = petSpan / BINS_X;
  const widthY = offSpan / BINS_Y;
  const counts = new Uint32Array(BINS_X * BINS_Y);
  for (let i = 0; i < n; i += 1) {
    let bx = Math.floor((pet[i] - petMin) / widthX);
    let by = Math.floor((off[i] - offMin) / widthY);
    if (bx >= BINS_X) bx = BINS_X - 1;
    if (by >= BINS_Y) by = BINS_Y - 1;
    counts[by * BINS_X + bx] += 1;
  }

  const density: DensityCell[] = [];
  let maxCount = 0;
  for (let by = 0; by < BINS_Y; by += 1) {
    for (let bx = 0; bx < BINS_X; bx += 1) {
      const count = counts[by * BINS_X + bx];
      if (count === 0) continue;
      if (count > maxCount) maxCount = count;
      density.push({
        x: petMin + (bx + 0.5) * widthX,
        y: offMin + (by + 0.5) * widthY,
        count,
      });
    }
  }

  return {
    frontier,
    density,
    evaluated: n,
    bins: { x: BINS_X, y: BINS_Y },
    binSize: { x: widthX, y: widthY },
    maxCount,
    optimumIndex: optimum.bestIndex,
    computeMs: Date.now() - startedAt,
  };
}

ctx.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message.kind !== 'string') return;

  switch (message.kind) {
    case 'init':
      void loadModel(message.runId, message.modelJsonUrl);
      return;

    case 'cancel':
      cancelledRunIds.add(message.runId);
      if (activeRunId === message.runId) activeRunId = null;
      post({ kind: 'cancelled', runId: message.runId, atStage: null });
      return;

    case 'run':
      activeRunId = message.runId;
      cancelledRunIds.delete(message.runId);
      // Keep the cancelled set from growing without bound.
      if (cancelledRunIds.size > 64) cancelledRunIds = new Set();
      void runPipeline(message.runId, { ...DEFAULT_RUN_CONFIG, ...message.config });
      return;

    case 'score': {
      if (!model) {
        post({
          kind: 'error',
          runId: message.runId,
          message: 'The scoring model is not loaded yet.',
          stage: null,
          fatal: false,
        });
        return;
      }
      const m = model;
      const { codes, lambda } = message;
      try {
        const scores = scoreAll(codes, m.flat);
        const metrics = candidateMetrics(codes, scores);
        const parts = objectiveParts(scores, lambda);
        const breakdown = (p: 'PET' | 'PE' | 'PP') => {
          const c = contributions(codes, m.flat[p]);
          return {
            positions: c.positions,
            pairs: c.pairs,
            linearTotal: c.linearTotal,
            pairTotal: c.pairTotal,
          };
        };
        // Rank is only knowable when the full space has been scored.
        let rankInSpace: number | null = null;
        let percentile: number | null = null;
        if (fullSpace) {
          const mine = objectiveOf(scores, lambda);
          let better = 0;
          for (let i = 0; i < VALID_SEQUENCES; i += 1) {
            if (objectiveAt(fullSpace, i, lambda) < mine) better += 1;
          }
          rankInSpace = better + 1;
          percentile = 100 * (1 - better / VALID_SEQUENCES);
        }
        post({
          kind: 'score',
          runId: message.runId,
          payload: {
            codes: [...codes],
            classSequence: classSequence(codes),
            representative: representativeSequence(codes),
            scores,
            objective: objectiveOf(scores, lambda),
            objectiveParts: {
              targetTerm: parts.targetTerm,
              offTargetSum: parts.offTargetSum,
              penaltyTerm: parts.penaltyTerm,
              lambda: parts.lambda,
              total: parts.total,
            },
            metrics: {
              meanOffTarget: metrics.meanOffTarget,
              worstOffTarget: metrics.worstOffTarget,
              marginMean: metrics.marginMean,
              marginWorst: metrics.marginWorst,
              aromaticFraction: metrics.aromaticFraction,
              hydrophobicFraction: metrics.hydrophobicFraction,
              polarFraction: metrics.polarFraction,
              netChargeClassBalance: metrics.netChargeClassBalance,
              warnings: metrics.warnings,
            },
            contributions: { PET: breakdown('PET'), PE: breakdown('PE'), PP: breakdown('PP') },
            rankInSpace,
            percentile,
          },
        });
      } catch (error) {
        post({
          kind: 'error',
          runId: message.runId,
          message: (error as Error).message,
          stage: null,
          fatal: false,
        });
      }
      return;
    }

    case 'solveAt': {
      if (!model || !fullSpace) {
        post({
          kind: 'error',
          runId: message.runId,
          message:
            'A full run has to finish before a new lambda can be solved exactly. Run the pipeline first.',
          stage: null,
          fatal: false,
        });
        return;
      }
      const r = exactBruteForce(fullSpace, message.lambda, message.topN);
      post({
        kind: 'solveAt',
        runId: message.runId,
        lambda: message.lambda,
        candidates: r.order.map((idx, i) => toCandidate(idx, message.lambda, i + 1, model!)),
      });
      return;
    }

    case 'sweep': {
      if (!model || !fullSpace) {
        post({
          kind: 'error',
          runId: message.runId,
          message: 'A full run has to finish before the sweep can be recomputed.',
          stage: null,
          fatal: false,
        });
        return;
      }
      const sweep: SweepPoint[] = message.lambdas.map((lam) => {
        const r = exactBruteForce(fullSpace!, lam, 1);
        const q = combineObjective(model!.flat, lam);
        return {
          lambda: lam,
          best: toCandidate(r.bestIndex, lam, 1, model!),
          penalty: safePenalty(q),
          runtimeMs: r.runtimeMs,
          optimumHits: r.optimumHits,
        };
      });
      post({ kind: 'sweep', runId: message.runId, sweep });
      return;
    }

    case 'pareto': {
      if (!fullSpace) {
        post({
          kind: 'error',
          runId: message.runId,
          message: 'The trade-off chart needs a completed run.',
          stage: null,
          fatal: false,
        });
        return;
      }
      const tradeoff = buildTradeoff(fullSpace, message.lambda);
      post({
        kind: 'pareto',
        runId: message.runId,
        payload: { lambda: message.lambda, ...tradeoff },
      });
      return;
    }

    case 'quboAt': {
      if (!model) {
        post({
          kind: 'error',
          runId: message.runId,
          message: 'The scoring model is not loaded yet.',
          stage: null,
          fatal: false,
        });
        return;
      }
      post({
        kind: 'qubo',
        runId: message.runId,
        payload: buildQuboPayload(model, message.lambda, message.penaltyMultiplier),
      });
      return;
    }

    case 'verify': {
      if (!model) {
        post({
          kind: 'error',
          runId: message.runId,
          message: 'The scoring model is not loaded yet.',
          stage: null,
          fatal: false,
        });
        return;
      }
      post({
        kind: 'verify',
        runId: message.runId,
        report: runVerify(model, 1.0, message.seed, message.sampleSize, 2.0),
      });
      return;
    }

    default:
      return;
  }
});
