/**
 * Quadratic Ridge surrogate, fitted live in the browser.
 *
 * Mirrors `src/qbind_select/surrogate.py` and `features.py`. The feature basis
 * is the one-hot position indicators (48) plus every inter-position class-pair
 * indicator (28 * 36 = 1008), so 1056 features. That basis EXACTLY spans the
 * Potts model, which is why the Python run reports test R^2 = 1.0 with
 * RMSE ~5e-8: the surrogate is not approximating a hard function, it is
 * recovering a known quadratic form. Saying so plainly matters - a reported
 * R^2 of 1.0 would otherwise look like a data-leakage bug.
 *
 * Train / validation / test splits are disjoint index ranges drawn without
 * replacement from the full space, so a sequence cannot appear in two splits.
 */

import {
  ALPHABET_SIZE,
  LENGTH,
  PAIR_COUNT,
  PAIR_ORDER,
  VALID_SEQUENCES,
  indexToCodes,
} from './alphabet';
import type { FlatCoefficients } from './potts';
import { scoreCodes } from './potts';
import { makeRng, sampleWithoutReplacement } from './rng';

export const LINEAR_FEATURES = LENGTH * ALPHABET_SIZE; // 48
export const PAIR_FEATURES = PAIR_COUNT * ALPHABET_SIZE * ALPHABET_SIZE; // 1008
export const FEATURE_COUNT = LINEAR_FEATURES + PAIR_FEATURES; // 1056

/**
 * Indices of the non-zero features for one sequence. Exactly 36 of 1056 are
 * non-zero (8 one-body + 28 two-body), so everything below works sparsely.
 */
export function featureIndices(codes: readonly number[], out: Int32Array): void {
  for (let i = 0; i < LENGTH; i += 1) out[i] = i * ALPHABET_SIZE + codes[i];
  for (let k = 0; k < PAIR_COUNT; k += 1) {
    const [i, j] = PAIR_ORDER[k];
    out[LENGTH + k] =
      LINEAR_FEATURES + k * 36 + codes[i] * ALPHABET_SIZE + codes[j];
  }
}

export const NONZERO_PER_ROW = LENGTH + PAIR_COUNT; // 36

export interface SplitMetrics {
  readonly count: number;
  readonly r2: number;
  readonly rmse: number;
  readonly mae: number;
  readonly maxAbsError: number;
}

export interface FittedSurrogate {
  readonly intercept: number;
  readonly coef: Float64Array;
  readonly alpha: number;
  readonly seed: number;
  readonly metrics: {
    readonly train: SplitMetrics;
    readonly validation: SplitMetrics;
    readonly test: SplitMetrics;
  };
  readonly splitSizes: { train: number; validation: number; test: number };
  /** True when no sequence index appears in more than one split. */
  readonly splitsDisjoint: boolean;
  readonly fitMs: number;
}

/**
 * Cholesky solve of (A + alpha*I) w = b, where A is symmetric positive
 * semi-definite. A is passed as a dense row-major Float64Array of size n*n and
 * is overwritten.
 */
function choleskySolve(A: Float64Array, b: Float64Array, n: number, alpha: number): Float64Array {
  for (let i = 0; i < n; i += 1) A[i * n + i] += alpha;

  // In-place Cholesky: A = L L^T, lower triangle of A becomes L.
  for (let j = 0; j < n; j += 1) {
    let d = A[j * n + j];
    for (let k = 0; k < j; k += 1) d -= A[j * n + k] * A[j * n + k];
    // A tiny jitter keeps a rank-deficient basis solvable; ridge alpha normally
    // already guarantees positive definiteness.
    const diag = Math.sqrt(Math.max(d, 1e-300));
    A[j * n + j] = diag;
    for (let i = j + 1; i < n; i += 1) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k += 1) s -= A[i * n + k] * A[j * n + k];
      A[i * n + j] = s / diag;
    }
  }

  // Forward substitution L y = b.
  const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= A[i * n + k] * y[k];
    y[i] = s / A[i * n + i];
  }
  // Back substitution L^T w = y.
  const w = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < n; k += 1) s -= A[k * n + i] * w[k];
    w[i] = s / A[i * n + i];
  }
  return w;
}

function metricsFor(actual: Float64Array, predicted: Float64Array): SplitMetrics {
  const n = actual.length;
  if (n === 0) return { count: 0, r2: Number.NaN, rmse: Number.NaN, mae: Number.NaN, maxAbsError: Number.NaN };
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += actual[i];
  mean /= n;
  let ssTot = 0;
  let ssRes = 0;
  let absSum = 0;
  let maxAbs = 0;
  for (let i = 0; i < n; i += 1) {
    const e = actual[i] - predicted[i];
    ssRes += e * e;
    ssTot += (actual[i] - mean) ** 2;
    const ae = Math.abs(e);
    absSum += ae;
    if (ae > maxAbs) maxAbs = ae;
  }
  return {
    count: n,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    rmse: Math.sqrt(ssRes / n),
    mae: absSum / n,
    maxAbsError: maxAbs,
  };
}

export interface FitOptions {
  readonly alpha: number;
  readonly seed: number;
  readonly trainSize: number;
  readonly validationSize: number;
  readonly testSize: number;
  readonly onProgress?: (fraction: number, note: string) => void;
}

/**
 * Fit the surrogate against the exact Potts scorer for one plastic.
 * Scores are generated on demand from `coeff`, so this needs no cached dataset.
 */
export function fitSurrogate(coeff: FlatCoefficients, options: FitOptions): FittedSurrogate {
  const t0 = performance.now();
  const total = options.trainSize + options.validationSize + options.testSize;
  if (total > VALID_SEQUENCES) {
    throw new Error(`requested ${total} samples but only ${VALID_SEQUENCES} sequences exist`);
  }
  const rng = makeRng(options.seed);
  const indices = sampleWithoutReplacement(rng, VALID_SEQUENCES, total);

  const trainEnd = options.trainSize;
  const validEnd = trainEnd + options.validationSize;

  // Splits are disjoint iff the sample had no duplicates.
  const splitsDisjoint = new Set(indices).size === indices.length;

  const idxBuf = new Int32Array(NONZERO_PER_ROW);
  const n = FEATURE_COUNT;

  // Centre the target so the intercept is handled outside the ridge penalty,
  // matching scikit-learn Ridge(fit_intercept=True).
  const yTrain = new Float64Array(options.trainSize);
  for (let r = 0; r < options.trainSize; r += 1) {
    yTrain[r] = scoreCodes(indexToCodes(indices[r]), coeff);
  }
  let yMean = 0;
  for (let r = 0; r < options.trainSize; r += 1) yMean += yTrain[r];
  yMean /= options.trainSize;

  // Feature means, for the same reason.
  const xMean = new Float64Array(n);
  for (let r = 0; r < options.trainSize; r += 1) {
    featureIndices(indexToCodes(indices[r]), idxBuf);
    for (let t = 0; t < NONZERO_PER_ROW; t += 1) xMean[idxBuf[t]] += 1;
  }
  for (let i = 0; i < n; i += 1) xMean[i] /= options.trainSize;

  options.onProgress?.(0.15, 'accumulating normal equations');

  // Build X'X and X'y on centred data. Expanding the centring algebraically
  // keeps the sparse accumulation: (X - m)'(X - m) = X'X - N m m'.
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  for (let r = 0; r < options.trainSize; r += 1) {
    featureIndices(indexToCodes(indices[r]), idxBuf);
    const yr = yTrain[r];
    for (let s = 0; s < NONZERO_PER_ROW; s += 1) {
      const i = idxBuf[s];
      b[i] += yr;
      for (let t = 0; t < NONZERO_PER_ROW; t += 1) A[i * n + idxBuf[t]] += 1;
    }
    if (options.onProgress && r % 2000 === 0) {
      options.onProgress(0.15 + 0.35 * (r / options.trainSize), 'accumulating normal equations');
    }
  }
  const N = options.trainSize;
  for (let i = 0; i < n; i += 1) {
    b[i] -= N * xMean[i] * yMean;
    for (let j = 0; j < n; j += 1) A[i * n + j] -= N * xMean[i] * xMean[j];
  }

  options.onProgress?.(0.55, 'solving 1056x1056 ridge system');
  const coefVec = choleskySolve(A, b, n, options.alpha);
  let intercept = yMean;
  for (let i = 0; i < n; i += 1) intercept -= coefVec[i] * xMean[i];

  options.onProgress?.(0.85, 'scoring held-out splits');

  const predictRange = (from: number, to: number) => {
    const count = to - from;
    const actual = new Float64Array(count);
    const pred = new Float64Array(count);
    for (let r = from; r < to; r += 1) {
      const codes = indexToCodes(indices[r]);
      actual[r - from] = scoreCodes(codes, coeff);
      featureIndices(codes, idxBuf);
      let p = intercept;
      for (let t = 0; t < NONZERO_PER_ROW; t += 1) p += coefVec[idxBuf[t]];
      pred[r - from] = p;
    }
    return metricsFor(actual, pred);
  };

  const fitted: FittedSurrogate = {
    intercept,
    coef: coefVec,
    alpha: options.alpha,
    seed: options.seed,
    metrics: {
      train: predictRange(0, trainEnd),
      validation: predictRange(trainEnd, validEnd),
      test: predictRange(validEnd, total),
    },
    splitSizes: {
      train: options.trainSize,
      validation: options.validationSize,
      test: options.testSize,
    },
    splitsDisjoint,
    fitMs: performance.now() - t0,
  };
  options.onProgress?.(1, 'done');
  return fitted;
}

export function predictSurrogate(codes: readonly number[], fitted: FittedSurrogate): number {
  const idx = new Int32Array(NONZERO_PER_ROW);
  featureIndices(codes, idx);
  let p = fitted.intercept;
  for (let t = 0; t < NONZERO_PER_ROW; t += 1) p += fitted.coef[idx[t]];
  return p;
}

/**
 * Map fitted surrogate coefficients back to QUBO linear/quadratic terms,
 * mirroring Python `feature_to_qubo`. Demonstrates that the surrogate and the
 * QUBO are the same object in two notations.
 */
export function surrogateToQuboTerms(fitted: FittedSurrogate): {
  linear: Float64Array;
  pair: Float64Array;
} {
  const linear = new Float64Array(LINEAR_FEATURES);
  for (let i = 0; i < LINEAR_FEATURES; i += 1) linear[i] = fitted.coef[i];
  const pair = new Float64Array(PAIR_FEATURES);
  for (let i = 0; i < PAIR_FEATURES; i += 1) pair[i] = fitted.coef[LINEAR_FEATURES + i];
  return { linear, pair };
}
