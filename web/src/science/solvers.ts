/**
 * Solvers. All of them run for real, in the browser, on the same objective.
 *
 * - exactBruteForce: enumerates all 1,679,616 valid class sequences. Because
 *   the reduced space is enumerable this returns the PROVEN optimum for this
 *   model. It is the reference every other solver is measured against.
 * - simulatedAnnealing: Metropolis annealing on the 48-variable constrained
 *   QUBO, sampling in binary space exactly like the D-Wave-compatible path, so
 *   it can produce one-hot-invalid samples and we report the validity rate.
 * - classSpaceAnnealing: annealing restricted to valid one-hot moves. Always
 *   valid by construction; shown as a contrast to explain why the penalty term
 *   exists at all.
 *
 * NO QUANTUM HARDWARE IS USED ANYWHERE IN THIS FILE OR THIS PROJECT.
 */

import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  LENGTH,
  VALID_SEQUENCES,
  encode,
  indexToCodes,
  isValidOneHot,
  decode,
} from './alphabet';
import type { FlatModel } from './potts';
import { quboEnergy, type Qubo } from './qubo';
import { makeRng, type Rng } from './rng';

export const DEFAULT_TOLERANCE = 1e-8;

export interface FullSpaceScores {
  readonly PET: Float64Array;
  readonly PE: Float64Array;
  readonly PP: Float64Array;
}

export interface BruteForceResult {
  /** Sequence indices of the best `topN`, ascending by objective. */
  readonly order: number[];
  readonly objectives: number[];
  readonly bestIndex: number;
  readonly bestObjective: number;
  /** How many sequences tie the optimum within `tolerance`. */
  readonly optimumHits: number;
  readonly evaluated: number;
  readonly runtimeMs: number;
}

/**
 * Exact minimisation of -PET + lambda*(PE+PP) over the full enumerated space.
 * Ties break by lower sequence index, matching the Python lexsort.
 */
export function exactBruteForce(
  scores: FullSpaceScores,
  lambda: number,
  topN = 10,
  tolerance = DEFAULT_TOLERANCE,
): BruteForceResult {
  const t0 = performance.now();
  const { PET, PE, PP } = scores;
  const n = PET.length;

  // Keep a small ascending top-N list; avoids sorting 1.68M entries.
  const topIdx: number[] = [];
  const topVal: number[] = [];
  let best = Infinity;

  for (let i = 0; i < n; i += 1) {
    const o = -PET[i] + lambda * (PE[i] + PP[i]);
    if (o < best) best = o;
    if (topVal.length < topN || o < topVal[topVal.length - 1]) {
      let pos = topVal.length;
      while (pos > 0 && topVal[pos - 1] > o) pos -= 1;
      topVal.splice(pos, 0, o);
      topIdx.splice(pos, 0, i);
      if (topVal.length > topN) {
        topVal.pop();
        topIdx.pop();
      }
    }
  }

  let hits = 0;
  for (let i = 0; i < n; i += 1) {
    const o = -PET[i] + lambda * (PE[i] + PP[i]);
    if (Math.abs(o - best) <= tolerance) hits += 1;
  }

  return {
    order: topIdx,
    objectives: topVal,
    bestIndex: topIdx[0],
    bestObjective: topVal[0],
    optimumHits: hits,
    evaluated: n,
    runtimeMs: performance.now() - t0,
  };
}

/** Objective value for one sequence index, from precomputed full-space arrays. */
export function objectiveAt(
  scores: FullSpaceScores,
  index: number,
  lambda: number,
): number {
  return -scores.PET[index] + lambda * (scores.PE[index] + scores.PP[index]);
}

export interface AnnealRunRow {
  readonly run: number;
  readonly bestValidEnergy: number | null;
  readonly validSamples: number;
  readonly totalSamples: number;
}

export interface AnnealResult {
  readonly bestEnergy: number | null;
  readonly bestCodes: number[] | null;
  readonly totalSamples: number;
  readonly validSamples: number;
  readonly invalidSamples: number;
  readonly validityRate: number;
  /** Reads whose energy equals the reference optimum within tolerance. */
  readonly optimumHits: number;
  readonly successRate: number;
  readonly runtimeMs: number;
  readonly runRows: AnnealRunRow[];
  readonly medianBestEnergy: number | null;
  readonly stdBestEnergy: number | null;
  readonly meanBestEnergy: number | null;
  readonly seed: number;
  readonly label: string;
}

function summarise(
  rows: AnnealRunRow[],
): { median: number | null; std: number | null; mean: number | null } {
  const vals = rows
    .map((r) => r.bestValidEnergy)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (vals.length === 0) return { median: null, std: null, mean: null };
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { median, std: Math.sqrt(variance), mean };
}

export interface AnnealOptions {
  readonly reads: number;
  readonly sweeps: number;
  readonly runs: number;
  readonly seed: number;
  /** Reference optimum used to count exact hits. */
  readonly referenceEnergy: number | null;
  readonly tolerance?: number;
  /** Called between reads so a worker can stay cancellable. */
  readonly onProgress?: (done: number, total: number) => boolean | void;
}

/**
 * Metropolis simulated annealing in the full 2^48 BINARY space, on the
 * penalty-constrained QUBO. Single-bit flips, geometric temperature schedule.
 * Invalid (non-one-hot) samples are possible and are reported, not hidden.
 */
export function simulatedAnnealing(q: Qubo, options: AnnealOptions): AnnealResult {
  const t0 = performance.now();
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const rows: AnnealRunRow[] = [];
  let bestEnergy = Infinity;
  let bestCodes: number[] | null = null;
  let totalSamples = 0;
  let validSamples = 0;
  let optimumHits = 0;
  let cancelled = false;

  // Temperature range from the coefficient scale, the usual dwave-neal heuristic.
  let maxAbs = 0;
  for (let i = 0; i < q.linear.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(q.linear[i]));
  const hot = Math.max(maxAbs, 1) * 2;
  const cold = Math.max(maxAbs, 1) * 1e-3;

  const x = new Uint8Array(BINARY_VARIABLES);
  const totalReads = options.reads * options.runs;

  for (let run = 0; run < options.runs && !cancelled; run += 1) {
    const rng = makeRng(options.seed + run);
    let runBest: number | null = null;
    let runValid = 0;

    for (let read = 0; read < options.reads; read += 1) {
      // Random start, then anneal.
      for (let i = 0; i < BINARY_VARIABLES; i += 1) x[i] = rng.next() < 0.5 ? 1 : 0;
      let energy = quboEnergy(x, q);

      for (let sweep = 0; sweep < options.sweeps; sweep += 1) {
        const temp = hot * (cold / hot) ** (sweep / Math.max(1, options.sweeps - 1));
        for (let step = 0; step < BINARY_VARIABLES; step += 1) {
          const bit = rng.int(BINARY_VARIABLES);
          const delta = flipDelta(x, q, bit);
          if (delta <= 0 || rng.next() < Math.exp(-delta / temp)) {
            x[bit] ^= 1;
            energy += delta;
          }
        }
      }

      totalSamples += 1;
      if (isValidOneHot(x)) {
        validSamples += 1;
        runValid += 1;
        if (runBest === null || energy < runBest) runBest = energy;
        if (energy < bestEnergy) {
          bestEnergy = energy;
          bestCodes = decode(x);
        }
        if (
          options.referenceEnergy !== null &&
          Math.abs(energy - options.referenceEnergy) <= tolerance
        ) {
          optimumHits += 1;
        }
      }

      if (options.onProgress && read % 8 === 0) {
        const keepGoing = options.onProgress(run * options.reads + read, totalReads);
        if (keepGoing === false) {
          cancelled = true;
          break;
        }
      }
    }
    rows.push({
      run,
      bestValidEnergy: runBest,
      validSamples: runValid,
      totalSamples: options.reads,
    });
  }

  const s = summarise(rows);
  return {
    bestEnergy: bestCodes === null ? null : bestEnergy,
    bestCodes,
    totalSamples,
    validSamples,
    invalidSamples: totalSamples - validSamples,
    validityRate: totalSamples ? validSamples / totalSamples : 0,
    optimumHits,
    successRate: totalSamples ? optimumHits / totalSamples : 0,
    runtimeMs: performance.now() - t0,
    runRows: rows,
    medianBestEnergy: s.median,
    stdBestEnergy: s.std,
    meanBestEnergy: s.mean,
    seed: options.seed,
    label: 'Simulated annealing (binary space, penalty-constrained QUBO)',
  };
}

/** Energy change from flipping one bit, without recomputing the whole energy. */
function flipDelta(x: Uint8Array, q: Qubo, bit: number): number {
  const n = BINARY_VARIABLES;
  const sign = x[bit] ? -1 : 1;
  let delta = q.linear[bit];
  for (let other = 0; other < n; other += 1) {
    if (other === bit || !x[other]) continue;
    delta += other < bit ? q.quadratic[other * n + bit] : q.quadratic[bit * n + other];
  }
  return sign * delta;
}

/**
 * Annealing that moves within the VALID class space (change one position's
 * class). Always one-hot valid, so it needs no penalty term. Useful contrast:
 * it shows the penalty is a cost of using binary hardware, not of the science.
 */
export function classSpaceAnnealing(
  model: FlatModel,
  lambda: number,
  options: AnnealOptions,
): AnnealResult {
  const t0 = performance.now();
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const rows: AnnealRunRow[] = [];
  let bestEnergy = Infinity;
  let bestCodes: number[] | null = null;
  let totalSamples = 0;
  let optimumHits = 0;
  let cancelled = false;

  const evaluate = (codes: number[]): number => {
    let pet = model.PET.intercept;
    let pe = model.PE.intercept;
    let pp = model.PP.intercept;
    for (let i = 0; i < LENGTH; i += 1) {
      const o = i * ALPHABET_SIZE + codes[i];
      pet += model.PET.linear[o];
      pe += model.PE.linear[o];
      pp += model.PP.linear[o];
    }
    let k = 0;
    for (let i = 0; i < LENGTH; i += 1) {
      for (let j = i + 1; j < LENGTH; j += 1) {
        const o = k * 36 + codes[i] * ALPHABET_SIZE + codes[j];
        pet += model.PET.pair[o];
        pe += model.PE.pair[o];
        pp += model.PP.pair[o];
        k += 1;
      }
    }
    return -pet + lambda * (pe + pp);
  };

  const totalReads = options.reads * options.runs;
  for (let run = 0; run < options.runs && !cancelled; run += 1) {
    const rng = makeRng(options.seed + 7919 * (run + 1));
    let runBest: number | null = null;
    for (let read = 0; read < options.reads; read += 1) {
      const codes = Array.from({ length: LENGTH }, () => rng.int(ALPHABET_SIZE));
      let energy = evaluate(codes);
      for (let sweep = 0; sweep < options.sweeps; sweep += 1) {
        const temp =
          Math.max(1, Math.abs(energy)) *
          0.5 *
          (1e-3 / 0.5) ** (sweep / Math.max(1, options.sweeps - 1));
        for (let step = 0; step < LENGTH; step += 1) {
          const pos = rng.int(LENGTH);
          const old = codes[pos];
          let next = rng.int(ALPHABET_SIZE - 1);
          if (next >= old) next += 1;
          codes[pos] = next;
          const candidate = evaluate(codes);
          const delta = candidate - energy;
          if (delta <= 0 || rng.next() < Math.exp(-delta / temp)) {
            energy = candidate;
          } else {
            codes[pos] = old;
          }
        }
      }
      totalSamples += 1;
      if (runBest === null || energy < runBest) runBest = energy;
      if (energy < bestEnergy) {
        bestEnergy = energy;
        bestCodes = [...codes];
      }
      if (
        options.referenceEnergy !== null &&
        Math.abs(energy - options.referenceEnergy) <= tolerance
      ) {
        optimumHits += 1;
      }
      if (options.onProgress && read % 8 === 0) {
        const keepGoing = options.onProgress(run * options.reads + read, totalReads);
        if (keepGoing === false) {
          cancelled = true;
          break;
        }
      }
    }
    rows.push({ run, bestValidEnergy: runBest, validSamples: options.reads, totalSamples: options.reads });
  }

  const s = summarise(rows);
  return {
    bestEnergy: bestCodes === null ? null : bestEnergy,
    bestCodes,
    totalSamples,
    validSamples: totalSamples,
    invalidSamples: 0,
    validityRate: 1,
    optimumHits,
    successRate: totalSamples ? optimumHits / totalSamples : 0,
    runtimeMs: performance.now() - t0,
    runRows: rows,
    medianBestEnergy: s.median,
    stdBestEnergy: s.std,
    meanBestEnergy: s.mean,
    seed: options.seed,
    label: 'Simulated annealing (valid class space, no penalty needed)',
  };
}

/**
 * Random search over valid sequences. The honest baseline: it shows how much of
 * the result is the optimiser and how much is just "looked at a lot of options".
 */
export function randomSearch(
  scores: FullSpaceScores,
  lambda: number,
  samples: number,
  seed: number,
): { bestIndex: number; bestObjective: number; samples: number; runtimeMs: number; seed: number } {
  const t0 = performance.now();
  const rng: Rng = makeRng(seed);
  let bestIndex = -1;
  let bestObjective = Infinity;
  for (let i = 0; i < samples; i += 1) {
    const idx = rng.int(VALID_SEQUENCES);
    const o = objectiveAt(scores, idx, lambda);
    if (o < bestObjective) {
      bestObjective = o;
      bestIndex = idx;
    }
  }
  return { bestIndex, bestObjective, samples, runtimeMs: performance.now() - t0, seed };
}

/**
 * Greedy coordinate descent from a given start: repeatedly take the single best
 * one-position change until nothing improves. Fast, and a useful teaching
 * contrast because it gets stuck in local optima that brute force does not.
 */
export function greedyDescent(
  model: FlatModel,
  lambda: number,
  startCodes: number[],
): { codes: number[]; objective: number; steps: number; runtimeMs: number } {
  const t0 = performance.now();
  const codes = [...startCodes];
  const evaluate = (c: number[]): number => {
    let pet = 0;
    let pe = 0;
    let pp = 0;
    for (let i = 0; i < LENGTH; i += 1) {
      const o = i * ALPHABET_SIZE + c[i];
      pet += model.PET.linear[o];
      pe += model.PE.linear[o];
      pp += model.PP.linear[o];
    }
    let k = 0;
    for (let i = 0; i < LENGTH; i += 1) {
      for (let j = i + 1; j < LENGTH; j += 1) {
        const o = k * 36 + c[i] * ALPHABET_SIZE + c[j];
        pet += model.PET.pair[o];
        pe += model.PE.pair[o];
        pp += model.PP.pair[o];
        k += 1;
      }
    }
    return -pet + lambda * (pe + pp);
  };
  let current = evaluate(codes);
  let steps = 0;
  for (;;) {
    let bestDelta = 0;
    let bestPos = -1;
    let bestClass = -1;
    for (let pos = 0; pos < LENGTH; pos += 1) {
      const old = codes[pos];
      for (let a = 0; a < ALPHABET_SIZE; a += 1) {
        if (a === old) continue;
        codes[pos] = a;
        const delta = evaluate(codes) - current;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestPos = pos;
          bestClass = a;
        }
      }
      codes[pos] = old;
    }
    if (bestPos < 0) break;
    codes[bestPos] = bestClass;
    current += bestDelta;
    steps += 1;
    if (steps > LENGTH * ALPHABET_SIZE) break; // safety, cannot normally trigger
  }
  return { codes, objective: current, steps, runtimeMs: performance.now() - t0 };
}

export function codesFromIndex(index: number): number[] {
  return indexToCodes(index);
}

export function oneHotOf(codes: number[]): Uint8Array {
  return encode(codes);
}
