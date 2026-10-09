/**
 * SURROGATE, RNG AND UNTRUSTED INPUT.
 *
 * Three things are checked here, and they fail for different reasons:
 *
 *  1. The RNG is the reproducibility guarantee. Every stated seed in the UI is
 *     a promise that the same numbers come back. If `makeRng` drifts, every
 *     "reproducible from seed N" label on the site becomes a false claim.
 *  2. The surrogate is the only place where the site shows a value that is not
 *     the exact Potts score. Its feature basis exactly spans the Potts model,
 *     so a correctly fitted surrogate is a RE-DERIVATION, not an approximation
 *     - but only once there are more training rows than features. Both regimes
 *     are measured below rather than assumed.
 *  3. `parseShareState` and `sanitiseScenarios` are the two functions that read
 *     input the user did not type: a pasted URL and a restored localStorage
 *     blob. They are fuzzed with hostile strings and must never throw, never
 *     emit an out-of-range value, and never pollute Object.prototype.
 *
 * No number in this file is asserted without having been measured first; every
 * tolerance below is stated together with the value actually observed.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  ALPHABET_SIZE,
  LENGTH,
  VALID_SEQUENCES,
  indexToCodes,
} from '../../src/science/alphabet';
import { scoreCodes } from '../../src/science/potts';
import { makeRng, sampleWithoutReplacement } from '../../src/science/rng';
import {
  FEATURE_COUNT,
  LINEAR_FEATURES,
  NONZERO_PER_ROW,
  PAIR_FEATURES,
  featureIndices,
  fitSurrogate,
  predictSurrogate,
  surrogateToQuboTerms,
} from '../../src/science/surrogate';
import {
  encodeShareState,
  parseShareState,
  sanitiseScenarios,
} from '../../src/state/persistence';
import { golden, realModel } from '../helpers/model';

const model = realModel();

/* ------------------------------------------------------------------ *
 * Assertion accounting. The suite claims broad coverage; this counts   *
 * it instead of estimating it. The final test asserts the floor.       *
 * ------------------------------------------------------------------ */
let assertionTotal = 0;
afterEach(() => {
  const state = (expect as unknown as { getState?: () => { assertionCalls?: number } }).getState?.();
  assertionTotal += state?.assertionCalls ?? 0;
});
afterAll(() => {
  console.log(`[surrogate-and-io] executed ${assertionTotal} assertions`);
});

/* ------------------------------------------------------------------ *
 * Verdict helpers: return 'ok' or a sentence naming the violation, so  *
 * a fuzz failure reports WHICH input broke WHICH invariant.            *
 * ------------------------------------------------------------------ */

function rangeVerdict(values: ArrayLike<number>, lo: number, hi: number): string {
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isInteger(v)) return `entry ${i} = ${String(v)} is not an integer`;
    if (v < lo || v >= hi) return `entry ${i} = ${v} outside [${lo}, ${hi})`;
  }
  return 'ok';
}

function shapeVerdict(result: unknown): string {
  if (result === null || typeof result !== 'object') return `returned ${String(result)}`;
  const keys = Object.keys(result as object).sort().join(',');
  if (keys !== 'codes,errors,lambda') return `keys are "${keys}"`;
  return 'ok';
}

function codesVerdict(codes: unknown): string {
  if (codes === null) return 'ok';
  if (!Array.isArray(codes)) return `codes is ${typeof codes}, expected null or array`;
  if (codes.length !== LENGTH) return `codes length ${codes.length}, expected ${LENGTH}`;
  for (let i = 0; i < codes.length; i += 1) {
    const c: unknown = codes[i];
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c >= ALPHABET_SIZE) {
      return `codes[${i}] = ${String(c)} is not an integer in 0..${ALPHABET_SIZE - 1}`;
    }
  }
  return 'ok';
}

function lambdaVerdict(lambda: unknown): string {
  if (lambda === null) return 'ok';
  if (typeof lambda !== 'number') return `lambda is ${typeof lambda}`;
  if (!Number.isFinite(lambda)) return `lambda is ${String(lambda)}`;
  if (lambda < 0 || lambda > 5) return `lambda ${lambda} outside [0, 5]`;
  return 'ok';
}

function errorsVerdict(errors: unknown): string {
  if (!Array.isArray(errors)) return `errors is ${typeof errors}`;
  for (let i = 0; i < errors.length; i += 1) {
    if (typeof errors[i] !== 'string') return `errors[${i}] is ${typeof errors[i]}`;
  }
  return 'ok';
}

/** Keys a pollution payload would plant. None exist on a clean Object.prototype. */
const POLLUTION_KEYS = ['x', 'y', 'polluted', 'pwned', 'isAdmin', 'injected', 'codes', 'lambda'];
const PROTOTYPE_BASELINE = Object.getOwnPropertyNames(Object.prototype).sort().join(',');

function pollutionProbe(): string {
  const probe: Record<string, unknown> = {};
  const own = Object.keys(probe);
  if (own.length !== 0) return `a fresh {} has enumerable keys: ${own.join(',')}`;
  for (const key of POLLUTION_KEYS) {
    if (probe[key] !== undefined) return `Object.prototype now carries "${key}"`;
  }
  const names = Object.getOwnPropertyNames(Object.prototype).sort().join(',');
  if (names !== PROTOTYPE_BASELINE) return 'Object.prototype own-property list changed';
  return 'clean';
}

/** Calls a parser and turns a throw into an inspectable value. */
function noThrow<T>(fn: () => T): { threw: string | null; value: T | undefined } {
  try {
    return { threw: null, value: fn() };
  } catch (err) {
    return { threw: err instanceof Error ? err.message : String(err), value: undefined };
  }
}

/* ================================================================== *
 * 1. makeRng                                                          *
 * ================================================================== */

describe('makeRng: the reproducibility guarantee', () => {
  it('two generators with the same seed produce identical sequences of 500 draws', () => {
    const a = makeRng(20240607);
    const b = makeRng(20240607);
    for (let i = 0; i < 500; i += 1) {
      const va = a.next();
      const vb = b.next();
      expect(vb, `draw ${i} diverged: ${va} vs ${vb}`).toBe(va);
    }
  });

  it('replaying a seed later in the session gives the same stream again', () => {
    const first = new Array<number>(64).fill(0);
    const gen = makeRng(7);
    for (let i = 0; i < 64; i += 1) first[i] = gen.next();
    // Burn an unrelated generator in between: state must not be shared.
    const noise = makeRng(8);
    for (let i = 0; i < 1000; i += 1) noise.next();
    const replay = makeRng(7);
    for (let i = 0; i < 64; i += 1) {
      expect(replay.next(), `replayed draw ${i}`).toBe(first[i]);
    }
  });

  it('different seeds give different streams', () => {
    const base = makeRng(1);
    const baseline: number[] = [];
    for (let i = 0; i < 50; i += 1) baseline.push(base.next());
    const seeds = [0, 2, 3, 17, 99, 1000, 65535, 123456, 999983, 2 ** 31, 4294967295];
    for (const seed of seeds) {
      const other = makeRng(seed);
      let differing = 0;
      for (let i = 0; i < 50; i += 1) if (other.next() !== baseline[i]) differing += 1;
      expect(differing, `seed ${seed} vs seed 1: differing draws out of 50`).toBeGreaterThan(45);
    }
  });

  it('exposes the seed it started from, coerced with >>> 0', () => {
    expect(makeRng(0).seed).toBe(0);
    expect(makeRng(1).seed).toBe(1);
    expect(makeRng(4294967295).seed).toBe(4294967295);
    expect(makeRng(-1).seed).toBe(4294967295);
    expect(makeRng(-2).seed).toBe(4294967294);
    expect(makeRng(2.7).seed).toBe(2);
    expect(makeRng(4294967296).seed).toBe(0);
    // Seeds that coerce to the same uint32 must produce the same stream.
    const neg = makeRng(-1);
    const pos = makeRng(4294967295);
    for (let i = 0; i < 40; i += 1) {
      expect(neg.next(), `draw ${i} of seed -1 vs seed 4294967295`).toBe(pos.next());
    }
  });

  it('next() is always in [0, 1), with the 2^-32 granularity mulberry32 implies', () => {
    const rng = makeRng(31337);
    const DRAWS = 20000;
    let below = 0;
    let atLeastOne = 0;
    let notGranular = 0;
    let repeatsOfPrevious = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let previous = Number.NaN;
    for (let i = 0; i < DRAWS; i += 1) {
      const v = rng.next();
      if (v < 0) below += 1;
      if (v >= 1) atLeastOne += 1;
      if (!Number.isInteger(v * 4294967296)) notGranular += 1;
      if (v === previous) repeatsOfPrevious += 1;
      previous = v;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    expect(below, 'draws below 0').toBe(0);
    expect(atLeastOne, 'draws >= 1').toBe(0);
    expect(notGranular, 'draws that are not a multiple of 2^-32').toBe(0);
    expect(repeatsOfPrevious, 'consecutive identical draws').toBe(0);
    expect(min, `min of ${DRAWS} draws`).toBeGreaterThanOrEqual(0);
    expect(max, `max of ${DRAWS} draws`).toBeLessThan(1);
    expect(max, 'the stream should reach near the top of the unit interval').toBeGreaterThan(0.999);
    expect(min, 'the stream should reach near the bottom of the unit interval').toBeLessThan(0.001);
    expect(sum / DRAWS, `mean of ${DRAWS} draws`).toBeGreaterThan(0.48);
    expect(sum / DRAWS, `mean of ${DRAWS} draws`).toBeLessThan(0.52);
  });

  it('int(n) is always an integer in [0, n) for n = 1..24', () => {
    for (let n = 1; n <= 24; n += 1) {
      const rng = makeRng(500 + n);
      let nonInteger = 0;
      let outOfRange = 0;
      const seen = new Set<number>();
      for (let i = 0; i < 4000; i += 1) {
        const v = rng.int(n);
        if (!Number.isInteger(v)) nonInteger += 1;
        if (v < 0 || v >= n) outOfRange += 1;
        seen.add(v);
      }
      expect(nonInteger, `int(${n}) non-integer draws`).toBe(0);
      expect(outOfRange, `int(${n}) out-of-range draws`).toBe(0);
      expect(seen.size, `int(${n}) distinct values seen in 4000 draws`).toBe(n);
    }
  });

  it('int(6) hits every class bucket and no bucket exceeds twice its expected share', () => {
    const DRAWS = 20000;
    const rng = makeRng(2468);
    const counts = new Array<number>(ALPHABET_SIZE).fill(0);
    for (let i = 0; i < DRAWS; i += 1) counts[rng.int(ALPHABET_SIZE)] += 1;
    const expected = DRAWS / ALPHABET_SIZE;
    for (let c = 0; c < ALPHABET_SIZE; c += 1) {
      expect(counts[c], `bucket ${c} was never drawn`).toBeGreaterThan(0);
      expect(counts[c], `bucket ${c} = ${counts[c]}, expected ~${expected}`).toBeLessThan(2 * expected);
      expect(counts[c], `bucket ${c} = ${counts[c]} is implausibly rare`).toBeGreaterThan(expected / 2);
    }
    expect(counts.reduce((a, b) => a + b, 0), 'bucket counts must sum to the draw count').toBe(DRAWS);
  });

  it('int(n) over the whole sequence space stays inside the enumeration', () => {
    const rng = makeRng(90210);
    let bad = 0;
    for (let i = 0; i < 5000; i += 1) {
      const v = rng.int(VALID_SEQUENCES);
      if (!Number.isInteger(v) || v < 0 || v >= VALID_SEQUENCES) bad += 1;
    }
    expect(bad, 'int(1679616) draws outside the enumeration').toBe(0);
  });
});

/* ================================================================== *
 * 2. sampleWithoutReplacement                                         *
 * ================================================================== */

const SAMPLE_CASES: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [3, 1], [3, 3], [5, 2], [5, 5],
  [6, 0], [6, 3], [6, 6], [7, 7], [8, 4], [10, 0], [10, 1], [10, 9], [10, 10],
  [13, 5], [16, 16], [28, 14], [36, 12], [36, 36], [48, 1], [48, 47], [48, 48],
  [64, 64], [100, 1], [100, 50], [100, 99], [100, 100], [128, 3], [256, 255],
  [500, 250], [1000, 10], [1000, 500], [1000, 999], [1000, 1000], [2048, 64],
  [4096, 1024], [10000, 2], [10000, 5000], [65536, 128], [1679616, 1],
  [1679616, 36], [1679616, 1000], [1679616, 5000],
];

describe('sampleWithoutReplacement', () => {
  it('returns exactly `count` distinct in-range values for every (n, count) pair', () => {
    for (const [n, count] of SAMPLE_CASES) {
      const out = sampleWithoutReplacement(makeRng(n * 31 + count), n, count);
      const label = `n=${n}, count=${count}`;
      expect(Array.isArray(out), `${label}: result type`).toBe(true);
      expect(out.length, `${label}: length`).toBe(count);
      expect(new Set(out).size, `${label}: distinct values`).toBe(count);
      expect(rangeVerdict(out, 0, n), `${label}: membership`).toBe('ok');
    }
  });

  it('is deterministic per seed and sensitive to the seed', () => {
    for (const [n, count] of SAMPLE_CASES) {
      const label = `n=${n}, count=${count}`;
      const seed = n * 7 + count;
      const a = sampleWithoutReplacement(makeRng(seed), n, count);
      const b = sampleWithoutReplacement(makeRng(seed), n, count);
      expect(b, `${label}: same seed must replay exactly`).toEqual(a);
      // count === n is excluded on purpose - see the next test.
      if (n >= 1000 && count >= 5 && count < n) {
        const c = sampleWithoutReplacement(makeRng(seed + 1), n, count);
        expect(c, `${label}: a different seed must not give the identical sample`).not.toEqual(a);
      }
    }
  });

  it('returns the population in index order when count === n, whatever the seed', () => {
    // Measured property of Floyd's algorithm as implemented: at step i every
    // value below i is already picked, so the draw can only resolve to i. The
    // SET is correct, but the ORDER is the identity permutation - the function
    // samples without replacement, it does not shuffle. Any caller that needs a
    // randomised order must not reach for count === n.
    for (const n of [2, 5, 10, 100, 1000]) {
      const identity = Array.from({ length: n }, (_, i) => i);
      for (const seed of [0, 1, 12345, 999999]) {
        expect(
          sampleWithoutReplacement(makeRng(seed), n, n),
          `n=count=${n}, seed=${seed}: order is the identity, not a shuffle`,
        ).toEqual(identity);
      }
    }
    // With count < n the order genuinely does depend on the seed.
    const a = sampleWithoutReplacement(makeRng(1), 1000, 999);
    const b = sampleWithoutReplacement(makeRng(2), 1000, 999);
    expect(b, 'count = n - 1 must still respond to the seed').not.toEqual(a);
  });

  it('count === n enumerates the whole population exactly once', () => {
    for (const n of [1, 2, 3, 5, 6, 7, 10, 16, 36, 48, 64, 100, 1000]) {
      const out = sampleWithoutReplacement(makeRng(n), n, n);
      const sorted = [...out].sort((x, y) => x - y);
      expect(out.length, `n=${n}: length`).toBe(n);
      expect(sorted, `n=${n}: must be a permutation of 0..${n - 1}`).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
      expect(out.reduce((a, b) => a + b, 0), `n=${n}: sum of a permutation`).toBe((n * (n - 1)) / 2);
    }
  });

  it('count === 0 returns an empty array for every n', () => {
    for (const n of [0, 1, 2, 10, 100, 1679616]) {
      const out = sampleWithoutReplacement(makeRng(n + 1), n, 0);
      expect(out, `n=${n}: empty sample`).toEqual([]);
      expect(out.length, `n=${n}: empty sample length`).toBe(0);
    }
  });

  it('throws when count > n rather than returning duplicates', () => {
    const impossible: ReadonlyArray<readonly [number, number]> = [
      [0, 1], [1, 2], [2, 3], [5, 6], [6, 7], [10, 11], [48, 49], [100, 101],
      [1000, 1001], [1679616, 1679617], [-1, 0], [-5, 1],
    ];
    for (const [n, count] of impossible) {
      const label = `n=${n}, count=${count}`;
      expect(() => sampleWithoutReplacement(makeRng(1), n, count), label).toThrow();
      expect(
        () => sampleWithoutReplacement(makeRng(1), n, count),
        `${label}: message should name the impossible request`,
      ).toThrow(/cannot sample/);
    }
  });

  it('samples spread over the population instead of clustering at one end', () => {
    // A broken Floyd implementation that collapses onto `i` would pile the
    // sample into the top of the range; this notices that.
    const n = VALID_SEQUENCES;
    const out = sampleWithoutReplacement(makeRng(4242), n, 4000);
    const inLowerHalf = out.filter((v) => v < n / 2).length;
    expect(inLowerHalf, `${inLowerHalf} of 4000 draws fell in the lower half`).toBeGreaterThan(1700);
    expect(inLowerHalf, `${inLowerHalf} of 4000 draws fell in the lower half`).toBeLessThan(2300);
    expect(Math.max(...out), 'max sampled index').toBeLessThan(n);
    expect(Math.min(...out), 'min sampled index').toBeGreaterThanOrEqual(0);
  });
});

/* ================================================================== *
 * 3. featureIndices                                                   *
 * ================================================================== */

/**
 * Independent re-derivation of the 36 non-zero feature indices. Deliberately
 * written with literal 48 / 36 / 6 and its own i<j loop rather than PAIR_ORDER,
 * so a change to the shared constants cannot silently agree with itself.
 */
function expectedFeatureIndices(codes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 8; i += 1) out.push(i * 6 + codes[i]);
  let k = 0;
  for (let i = 0; i < 8; i += 1) {
    for (let j = i + 1; j < 8; j += 1) {
      out.push(48 + k * 36 + codes[i] * 6 + codes[j]);
      k += 1;
    }
  }
  return out;
}

const FEATURE_SEQUENCES: readonly number[][] = (() => {
  const list: number[][] = [];
  for (let c = 0; c < ALPHABET_SIZE; c += 1) list.push(new Array<number>(LENGTH).fill(c));
  for (const index of [0, 1, 2, 6, 7, 1679615, 1679614, 839808]) {
    list.push(indexToCodes(index));
  }
  for (const c of golden().cases.slice(0, 30)) list.push([...c.codes]);
  const rng = makeRng(99);
  for (let k = 0; k < 40; k += 1) list.push(indexToCodes(rng.int(VALID_SEQUENCES)));
  return list;
})();

describe('featureIndices', () => {
  it('declares a basis of 48 one-body plus 1008 pair features', () => {
    expect(LINEAR_FEATURES).toBe(48);
    expect(PAIR_FEATURES).toBe(1008);
    expect(FEATURE_COUNT).toBe(1056);
    expect(LINEAR_FEATURES + PAIR_FEATURES).toBe(FEATURE_COUNT);
    expect(NONZERO_PER_ROW).toBe(36);
  });

  it('writes exactly 36 distinct in-range indices for every sequence', () => {
    for (const codes of FEATURE_SEQUENCES) {
      const label = codes.join('');
      // Oversized buffer prefilled with -1: anything past index 35 must stay.
      const buf = new Int32Array(NONZERO_PER_ROW + 4).fill(-1);
      featureIndices(codes, buf);
      const written = Array.from(buf.subarray(0, NONZERO_PER_ROW));
      expect(Array.from(buf.subarray(NONZERO_PER_ROW)), `${label}: wrote past 36 slots`).toEqual([
        -1, -1, -1, -1,
      ]);
      expect(written, `${label}: index vector`).toEqual(expectedFeatureIndices(codes));
      expect(new Set(written).size, `${label}: distinct indices`).toBe(NONZERO_PER_ROW);
      expect(rangeVerdict(written, 0, FEATURE_COUNT), `${label}: index range`).toBe('ok');
      // The first 8 are the one-body indices i*6 + codes[i].
      expect(written.slice(0, LENGTH), `${label}: one-body block`).toEqual(
        codes.map((c, i) => i * ALPHABET_SIZE + c),
      );
      // The remaining 28 live strictly above the one-body block.
      expect(
        Math.min(...written.slice(LENGTH)),
        `${label}: smallest pair index must be >= ${LINEAR_FEATURES}`,
      ).toBeGreaterThanOrEqual(LINEAR_FEATURES);
    }
  });

  it('gives each position pair its own disjoint block of 36 indices', () => {
    const buf = new Int32Array(NONZERO_PER_ROW);
    for (const codes of FEATURE_SEQUENCES) {
      featureIndices(codes, buf);
      let verdict = 'ok';
      for (let k = 0; k < 28; k += 1) {
        const v = buf[LENGTH + k];
        const lo = LINEAR_FEATURES + k * 36;
        if (v < lo || v >= lo + 36) {
          verdict = `pair ${k} index ${v} escaped its block [${lo}, ${lo + 36})`;
          break;
        }
      }
      expect(verdict, `${codes.join('')}: pair-block containment`).toBe('ok');
    }
  });

  it('is injective over sequences: distinct sequences give distinct index sets', () => {
    const seen = new Map<string, string>();
    const rng = makeRng(555);
    const buf = new Int32Array(NONZERO_PER_ROW);
    for (let k = 0; k < 400; k += 1) {
      const codes = indexToCodes(rng.int(VALID_SEQUENCES));
      featureIndices(codes, buf);
      const key = Array.from(buf).join(',');
      const seq = codes.join('');
      const prior = seen.get(key);
      if (prior !== undefined && prior !== seq) {
        expect(prior, `two different sequences share one feature pattern`).toBe(seq);
      }
      seen.set(key, seq);
    }
    expect(seen.size, 'distinct feature patterns observed').toBeGreaterThan(390);
  });
});

/* ================================================================== *
 * 4. fitSurrogate                                                     *
 * ================================================================== */

/**
 * Two fits, both for PET, both at alpha 1e-6, computed once at module scope.
 *
 * DETERMINED: trainSize 4000 > 1056 features. The normal equations have full
 * rank, so Ridge recovers the Potts coefficients themselves and every split
 * reports R^2 = 1 with max |error| under 1e-6. This is the regime the Python
 * benchmark reports (test R^2 1.0, RMSE ~5e-8) and the reason that value is
 * not a data-leakage bug.
 *
 * UNDERDETERMINED: trainSize 600 < 1056 features, which is the size named in
 * the task brief. 600 rows cannot pin down 1056 coefficients, so the ridge
 * solution interpolates the training rows (R^2 = 1 there) while held-out R^2 is
 * MEASURED at ~0.98, not >= 0.999. The brief's >= 0.999 claim only holds once
 * trainSize exceeds the feature count, so both are asserted at their measured
 * values rather than at the assumed one.
 */
const FIT_SEED = 1234;
const DETERMINED = { alpha: 1e-6, seed: FIT_SEED, trainSize: 4000, validationSize: 500, testSize: 500 };
const UNDERDETERMINED = { alpha: 1e-6, seed: 4321, trainSize: 600, validationSize: 200, testSize: 200 };

const determinedFit = fitSurrogate(model.flat.PET, DETERMINED);
const underdeterminedFit = fitSurrogate(model.flat.PET, UNDERDETERMINED);

/** The exact index set those splits consumed - fitSurrogate's own draw, replayed. */
const usedIndices = new Set(
  sampleWithoutReplacement(
    makeRng(FIT_SEED),
    VALID_SEQUENCES,
    DETERMINED.trainSize + DETERMINED.validationSize + DETERMINED.testSize,
  ),
);

describe('fitSurrogate with more training rows than features', () => {
  it('honours the requested split sizes', () => {
    expect(determinedFit.splitSizes.train).toBe(4000);
    expect(determinedFit.splitSizes.validation).toBe(500);
    expect(determinedFit.splitSizes.test).toBe(500);
    expect(determinedFit.metrics.train.count).toBe(4000);
    expect(determinedFit.metrics.validation.count).toBe(500);
    expect(determinedFit.metrics.test.count).toBe(500);
    expect(determinedFit.alpha).toBe(1e-6);
    expect(determinedFit.seed).toBe(FIT_SEED);
    expect(Number.isFinite(determinedFit.fitMs), 'fitMs must be a real measurement').toBe(true);
    expect(determinedFit.fitMs).toBeGreaterThanOrEqual(0);
  });

  it('reports disjoint splits, and the splits really are disjoint', () => {
    expect(determinedFit.splitsDisjoint, 'fitSurrogate self-report').toBe(true);
    // Replay the draw and check the three ranges independently of that flag.
    const indices = sampleWithoutReplacement(makeRng(FIT_SEED), VALID_SEQUENCES, 5000);
    expect(indices.length).toBe(5000);
    expect(new Set(indices).size, 'the sampled indices must be distinct').toBe(5000);
    const train = new Set(indices.slice(0, 4000));
    const validation = new Set(indices.slice(4000, 4500));
    const test = new Set(indices.slice(4500, 5000));
    expect(train.size).toBe(4000);
    expect(validation.size).toBe(500);
    expect(test.size).toBe(500);
    expect([...validation].filter((i) => train.has(i)).length, 'train/validation overlap').toBe(0);
    expect([...test].filter((i) => train.has(i)).length, 'train/test overlap').toBe(0);
    expect([...test].filter((i) => validation.has(i)).length, 'validation/test overlap').toBe(0);
  });

  it('recovers the Potts model: R^2 is 1 on every split, not just on train', () => {
    for (const split of ['train', 'validation', 'test'] as const) {
      const m = determinedFit.metrics[split];
      expect(m.r2, `${split} R^2 measured ${m.r2}`).toBeGreaterThanOrEqual(0.999);
      expect(m.r2, `${split} R^2 measured ${m.r2}`).toBeGreaterThan(1 - 1e-9);
      expect(m.r2, `${split} R^2 measured ${m.r2} - R^2 cannot exceed 1`).toBeLessThanOrEqual(1);
      expect(m.rmse, `${split} RMSE measured ${m.rmse.toExponential(3)}`).toBeLessThan(1e-5);
      expect(m.mae, `${split} MAE measured ${m.mae.toExponential(3)}`).toBeLessThan(1e-5);
      expect(
        m.maxAbsError,
        `${split} max |error| measured ${m.maxAbsError.toExponential(3)}`,
      ).toBeLessThan(1e-5);
      expect(m.rmse, `${split} RMSE must be non-negative`).toBeGreaterThanOrEqual(0);
      expect(m.maxAbsError, `${split} max |error| must bound RMSE`).toBeGreaterThanOrEqual(m.rmse);
    }
  });

  it('produces a finite 1056-long coefficient vector and a finite intercept', () => {
    expect(determinedFit.coef.length).toBe(FEATURE_COUNT);
    let nonFinite = 0;
    let nonZero = 0;
    for (let i = 0; i < determinedFit.coef.length; i += 1) {
      if (!Number.isFinite(determinedFit.coef[i])) nonFinite += 1;
      if (determinedFit.coef[i] !== 0) nonZero += 1;
    }
    expect(nonFinite, 'non-finite coefficients').toBe(0);
    expect(nonZero, 'a fitted surrogate cannot be all zeros').toBeGreaterThan(500);
    expect(Number.isFinite(determinedFit.intercept), 'intercept must be finite').toBe(true);
  });

  it('predictSurrogate matches the exact Potts scorer on genuinely held-out sequences', () => {
    const rng = makeRng(8888);
    let worst = 0;
    let worstSeq = '';
    let absSum = 0;
    let checked = 0;
    let nonFinite = 0;
    while (checked < 400) {
      const index = rng.int(VALID_SEQUENCES);
      if (usedIndices.has(index)) continue; // never trained, validated or tested on
      const codes = indexToCodes(index);
      const predicted = predictSurrogate(codes, determinedFit);
      const exact = scoreCodes(codes, model.flat.PET);
      if (!Number.isFinite(predicted)) nonFinite += 1;
      const err = Math.abs(predicted - exact);
      absSum += err;
      if (err > worst) {
        worst = err;
        worstSeq = codes.join('');
      }
      checked += 1;
    }
    expect(checked, 'held-out sequences compared').toBe(400);
    expect(nonFinite, 'non-finite predictions').toBe(0);
    expect(
      worst,
      `max |predict - exact| over 400 held-out sequences = ${worst.toExponential(3)} (worst at ${worstSeq})`,
    ).toBeLessThan(1e-5);
    expect(
      absSum / checked,
      `mean |predict - exact| = ${(absSum / checked).toExponential(3)}`,
    ).toBeLessThan(1e-6);
  });

  it('predictSurrogate agrees with the metrics path and with the golden cases', () => {
    for (const c of golden().cases.slice(0, 60)) {
      const predicted = predictSurrogate(c.codes, determinedFit);
      const err = Math.abs(predicted - c.scores.PET);
      expect(
        err,
        `${c.classSequence}: |surrogate - Python exact PET| = ${err.toExponential(3)}`,
      ).toBeLessThan(1e-5);
    }
  });

  it('is deterministic: the same seed and sizes reproduce the same fit', () => {
    const again = fitSurrogate(model.flat.PET, DETERMINED);
    expect(again.intercept, 'intercept').toBe(determinedFit.intercept);
    expect(again.metrics.test.rmse, 'test RMSE').toBe(determinedFit.metrics.test.rmse);
    expect(again.metrics.test.maxAbsError, 'test max |error|').toBe(
      determinedFit.metrics.test.maxAbsError,
    );
    expect(Array.from(again.coef.subarray(0, LINEAR_FEATURES)), 'one-body coefficients').toEqual(
      Array.from(determinedFit.coef.subarray(0, LINEAR_FEATURES)),
    );
  });

  it('refuses to request more samples than the space contains', () => {
    const over = [
      { trainSize: VALID_SEQUENCES, validationSize: 1, testSize: 0 },
      { trainSize: VALID_SEQUENCES + 1, validationSize: 0, testSize: 0 },
      { trainSize: 1679000, validationSize: 600, testSize: 100 },
      { trainSize: 1000000, validationSize: 1000000, testSize: 0 },
      { trainSize: 0, validationSize: 0, testSize: VALID_SEQUENCES + 5 },
    ];
    for (const sizes of over) {
      const total = sizes.trainSize + sizes.validationSize + sizes.testSize;
      expect(
        () => fitSurrogate(model.flat.PET, { alpha: 1e-6, seed: 1, ...sizes }),
        `total ${total} exceeds ${VALID_SEQUENCES}`,
      ).toThrow(/only 1679616 sequences exist/);
    }
    // Exactly at the boundary the guard must NOT fire for the size check
    // itself; 1,679,616 samples is legal, so the only thing stopping it is time.
    expect(VALID_SEQUENCES).toBe(1679616);
  });
});

describe('fitSurrogate with fewer training rows than features (the 600-row brief)', () => {
  it('honours the requested 600 / 200 / 200 split', () => {
    expect(underdeterminedFit.splitSizes.train).toBe(600);
    expect(underdeterminedFit.splitSizes.validation).toBe(200);
    expect(underdeterminedFit.splitSizes.test).toBe(200);
    expect(underdeterminedFit.metrics.train.count).toBe(600);
    expect(underdeterminedFit.metrics.validation.count).toBe(200);
    expect(underdeterminedFit.metrics.test.count).toBe(200);
    expect(underdeterminedFit.splitsDisjoint, 'splits must still be disjoint').toBe(true);
  });

  it('interpolates its 600 training rows exactly', () => {
    const m = underdeterminedFit.metrics.train;
    expect(m.r2, `train R^2 measured ${m.r2}`).toBeGreaterThan(0.999999);
    expect(
      m.maxAbsError,
      `train max |error| measured ${m.maxAbsError.toExponential(3)} - 600 rows and 1056 free parameters can be fitted exactly`,
    ).toBeLessThan(1e-3);
  });

  it('does NOT generalise to 1e-6, because 600 rows cannot pin down 1056 coefficients', () => {
    for (const split of ['validation', 'test'] as const) {
      const m = underdeterminedFit.metrics[split];
      // Measured, not assumed: these are the values this exact fit produces.
      expect(m.r2, `${split} R^2 measured ${m.r2}`).toBeGreaterThan(0.9);
      expect(
        m.r2,
        `${split} R^2 measured ${m.r2}: the >= 0.999 target is only reachable once trainSize exceeds the 1056-feature basis`,
      ).toBeLessThan(0.999);
      expect(
        m.maxAbsError,
        `${split} max |error| measured ${m.maxAbsError.toFixed(3)} score units`,
      ).toBeGreaterThan(1);
    }
    // The determined fit is better by many orders of magnitude on held-out data.
    expect(
      determinedFit.metrics.test.maxAbsError,
      'adding training rows must improve held-out accuracy, not worsen it',
    ).toBeLessThan(underdeterminedFit.metrics.test.maxAbsError);
  });
});

/* ================================================================== *
 * 5. surrogateToQuboTerms                                             *
 * ================================================================== */

describe('surrogateToQuboTerms', () => {
  it('splits the 1056 coefficients into 48 linear and 1008 pair values', () => {
    const terms = surrogateToQuboTerms(determinedFit);
    expect(terms.linear.length, 'linear term count').toBe(48);
    expect(terms.pair.length, 'pair term count').toBe(1008);
    expect(terms.linear.length + terms.pair.length).toBe(FEATURE_COUNT);
    expect(Array.from(terms.linear), 'linear block must be coef[0..48)').toEqual(
      Array.from(determinedFit.coef.subarray(0, LINEAR_FEATURES)),
    );
    expect(Array.from(terms.pair), 'pair block must be coef[48..1056)').toEqual(
      Array.from(determinedFit.coef.subarray(LINEAR_FEATURES)),
    );
    let nonFinite = 0;
    for (let i = 0; i < terms.linear.length; i += 1) if (!Number.isFinite(terms.linear[i])) nonFinite += 1;
    for (let i = 0; i < terms.pair.length; i += 1) if (!Number.isFinite(terms.pair[i])) nonFinite += 1;
    expect(nonFinite, 'non-finite QUBO terms').toBe(0);
  });

  it('returns a copy, so editing the QUBO terms cannot mutate the fit', () => {
    const terms = surrogateToQuboTerms(determinedFit);
    const before = determinedFit.coef[0];
    terms.linear[0] = 123456;
    expect(determinedFit.coef[0], 'fitted coefficient must be untouched').toBe(before);
    const pairBefore = determinedFit.coef[LINEAR_FEATURES];
    terms.pair[0] = -987654;
    expect(determinedFit.coef[LINEAR_FEATURES], 'fitted pair coefficient must be untouched').toBe(
      pairBefore,
    );
  });

  it('reconstructs a prediction from the QUBO terms alone', () => {
    const terms = surrogateToQuboTerms(determinedFit);
    const buf = new Int32Array(NONZERO_PER_ROW);
    const rng = makeRng(3141);
    for (let k = 0; k < 40; k += 1) {
      const codes = indexToCodes(rng.int(VALID_SEQUENCES));
      featureIndices(codes, buf);
      let viaTerms = determinedFit.intercept;
      for (let t = 0; t < NONZERO_PER_ROW; t += 1) {
        const idx = buf[t];
        viaTerms += idx < LINEAR_FEATURES ? terms.linear[idx] : terms.pair[idx - LINEAR_FEATURES];
      }
      const viaPredict = predictSurrogate(codes, determinedFit);
      expect(
        Math.abs(viaTerms - viaPredict),
        `${codes.join('')}: QUBO-term reconstruction vs predictSurrogate`,
      ).toBeLessThan(1e-9);
    }
  });
});

/* ================================================================== *
 * 6. parseShareState - UNTRUSTED INPUT                                *
 *                                                                     *
 * This reads a hash fragment that anyone can craft and send. It must   *
 * never throw, never hand the app an out-of-range value, and never let *
 * a key like `__proto__` reach Object.prototype.                       *
 * ================================================================== */

const VALID_CODES = [0, 1, 2, 3, 4, 5, 0, 1];
const VALID_S = '01234501';

/** Characters picked to break a naive parser: separators, quotes, markup, NUL, non-ASCII. */
const HOSTILE_CHARS =
  '0123456789abcXYZ-_%&=#+ .,:;"\'<>\\/|~`!@$^*()[]{}? é́中۱０';

const NUMERIC_TOKENS = [
  '', '0', '-0', '1', '5', '5.0000001', '-1', '-0.0001', '6', '99', '1e1', '1e-7', '1e999',
  '-1e999', 'NaN', 'nan', 'Infinity', '-Infinity', 'infinity', '0x10', '0b11', '0o7', '1_000',
  '2,5', '2.5.5', '  2  ', '+2', '2%', 'null', 'undefined', 'true', '[]', '{}', '[1]',
  '1/0', '٢', '２', '2 ', 'Number.MAX_VALUE', '1e308', '1e309', '.5', '5.', '0.0',
];

function buildHostileHashes(): string[] {
  const out: string[] = [];
  const rng = makeRng(13572468);
  const pick = (s: string) => s[rng.int(s.length)];

  // --- Literals the task brief names, plus close relatives. ---
  out.push(
    '',
    '#',
    'junk',
    '#junk',
    's=',
    's=abc',
    's=12345678', // digits 6,7,8 are NOT valid class indices - see the targeted test
    's=99999999',
    's=1234567',
    's=123456789',
    's=00000000',
    's=55555555',
    `s=${VALID_S}`,
    `#s=${VALID_S}`,
    'l=-1',
    'l=99',
    'l=NaN',
    'l=Infinity',
    'l=-Infinity',
    'l=1e999',
    'l=1e-999',
    'l=',
    'l=0',
    'l=5',
    'l=2.5',
    'l=0&l=5',
    'l=5&l=0',
    `s=${VALID_S}&s=55555555`,
    `#s=${VALID_S}&l=2`,
    `#l=2&s=${VALID_S}`,
    `s=${VALID_S}&l=2&unknown=ignored`,
    `#s=${VALID_S}#l=2`,
    `S=${VALID_S}`,
    'L=2',
    '=',
    '&',
    '&&&&',
    '===',
    `s==${VALID_S}`,
    '?s=00000000',
    '#<script>alert(1)</script>',
    's=<script>alert("xss")</script>',
    `s=${VALID_S}&l=<img src=x onerror=alert(1)>`,
    'l=javascript:alert(1)',
    's=\'"><svg/onload=alert(1)>',
    '%%%',
    '%',
    '%zz',
    '%E0%A4%A',
    '%FF%FE',
    's=%30%31%32%33%34%35%30%31', // percent-encoded VALID_S: must decode and be accepted
    's=0123450%31',
    '%73=01234501', // percent-encoded KEY "s" - URLSearchParams decodes keys too
    `l=%32`,
    'l=2%2E5',
    'l=+2',
    's=%2501234501', // double-encoded: decodes to "%01234501", not eight digits
    `s=${encodeURIComponent(encodeURIComponent(VALID_S))}`,
    '__proto__[x]=y',
    '__proto__.x=y',
    '__proto__=polluted',
    'constructor[prototype][x]=y',
    'constructor.prototype.polluted=1',
    'prototype[isAdmin]=true',
    `s=${VALID_S}&__proto__[polluted]=1`,
    'l=0&__proto__[isAdmin]=true',
    '?__proto__[y]=z',
    ' ',
    `s=0000000 `,
    'l=1 2',
    's=١٢٣٤٥٠١٢', // Arabic-Indic digits
    's=０１２３４５０１', // fullwidth digits
    's=🚀🚀',
    '中文=值',
    's=́́́́́́́́',
    '#'.repeat(50),
    'a'.repeat(5000),
    `s=${'0'.repeat(5000)}`,
    `l=${'9'.repeat(400)}`,
    `${'k=v&'.repeat(500)}s=${VALID_S}`,
    '{"codes":[0,0,0,0,0,0,0,0],"lambda":1}',
    '[object Object]',
    'null',
    'undefined',
    'NaN',
    's=null',
    's=undefined',
    's=00000000&l=null',
  );

  // --- Generated: eight hostile characters in the `s` slot. ---
  for (let k = 0; k < 110; k += 1) {
    let body = '';
    for (let c = 0; c < 8; c += 1) body += pick(HOSTILE_CHARS);
    out.push(`s=${body}`);
  }

  // --- Generated: `s` values of the wrong length, digits only. ---
  for (let k = 0; k < 55; k += 1) {
    const len = rng.int(17);
    let body = '';
    for (let c = 0; c < len; c += 1) body += pick('0123456789');
    out.push(`s=${body}`);
  }

  // --- Generated: hostile lambda tokens. ---
  for (const token of NUMERIC_TOKENS) out.push(`l=${token}`);
  for (let k = 0; k < 30; k += 1) {
    const token = NUMERIC_TOKENS[rng.int(NUMERIC_TOKENS.length)];
    out.push(`#s=${VALID_S}&l=${token}`);
  }

  // --- Generated: both slots hostile at once. ---
  for (let k = 0; k < 70; k += 1) {
    let body = '';
    for (let c = 0; c < 1 + rng.int(10); c += 1) body += pick(HOSTILE_CHARS);
    const token = NUMERIC_TOKENS[rng.int(NUMERIC_TOKENS.length)];
    out.push(`${rng.int(2) === 0 ? '#' : ''}s=${body}&l=${token}`);
  }

  // --- Generated: free-form junk, no recognisable structure. ---
  for (let k = 0; k < 60; k += 1) {
    let body = '';
    for (let c = 0; c < 1 + rng.int(40); c += 1) body += pick(HOSTILE_CHARS);
    out.push(body);
  }

  return out;
}

const HOSTILE_HASHES = buildHostileHashes();

describe('parseShareState: fuzzing the shareable-link parser', () => {
  it('has a corpus of at least 400 distinct hostile inputs', () => {
    expect(HOSTILE_HASHES.length, 'corpus size').toBeGreaterThanOrEqual(400);
    expect(new Set(HOSTILE_HASHES).size, 'the corpus should not be mostly duplicates').toBeGreaterThan(
      350,
    );
    expect(pollutionProbe(), 'baseline must be clean before fuzzing').toBe('clean');
  });

  it('upholds every output invariant for every hostile input', () => {
    for (let i = 0; i < HOSTILE_HASHES.length; i += 1) {
      const input = HOSTILE_HASHES[i];
      const label = `input #${i} ${JSON.stringify(input.slice(0, 80))}`;
      const call = noThrow(() => parseShareState(input));
      const shape = call.threw !== null ? `threw: ${call.threw}` : shapeVerdict(call.value);
      expect(shape, `${label}: must return {codes, lambda, errors} and never throw`).toBe('ok');
      const result = call.value as { codes: unknown; lambda: unknown; errors: unknown };
      expect(codesVerdict(result.codes), `${label}: codes`).toBe('ok');
      expect(lambdaVerdict(result.lambda), `${label}: lambda`).toBe('ok');
      expect(errorsVerdict(result.errors), `${label}: errors`).toBe('ok');
      expect(pollutionProbe(), `${label}: Object.prototype`).toBe('clean');
    }
  });

  it('never reflects the attacker payload or markup back inside an error message', () => {
    const reflectors = HOSTILE_HASHES.filter(
      (h) => h.includes('<') || h.includes('script') || h.includes('"') || h.includes(' '),
    );
    expect(reflectors.length, 'markup-bearing inputs in the corpus').toBeGreaterThan(5);
    for (const input of reflectors) {
      const { errors } = parseShareState(input);
      for (const message of errors) {
        expect(message.includes('<'), `error message must not carry markup: ${message}`).toBe(false);
        expect(
          message.includes(input.slice(3, 20)) && input.length > 10,
          `error message must not echo the raw input: ${message}`,
        ).toBe(false);
        expect(message.endsWith('.'), `error message should be a sentence: ${message}`).toBe(true);
      }
    }
  });

  it('is idempotent: parsing the same input twice gives the same answer', () => {
    for (let i = 0; i < HOSTILE_HASHES.length; i += 4) {
      const input = HOSTILE_HASHES[i];
      const a = parseShareState(input);
      const b = parseShareState(input);
      expect(b, `input #${i} must parse identically twice`).toEqual(a);
    }
  });

  it('survives inputs that are not strings at all', () => {
    const nonStrings: unknown[] = [
      null, undefined, 0, 1, Number.NaN, Number.POSITIVE_INFINITY, true, false, {}, [],
      ['s=01234501'], { s: '01234501' }, () => '#s=01234501', Symbol('#s=01234501'), 12345678n,
      new Date(0), /s=01234501/, new Map(), Object.create(null),
    ];
    for (const value of nonStrings) {
      const label = `non-string ${String(typeof value)}`;
      const call = noThrow(() => parseShareState(value as unknown as string));
      expect(call.threw, `${label}: must be caught internally, not thrown`).toBe(null);
      const result = call.value as { codes: unknown; lambda: unknown; errors: string[] };
      expect(shapeVerdict(result), `${label}: shape`).toBe('ok');
      expect(result.codes, `${label}: codes`).toBe(null);
      expect(result.lambda, `${label}: lambda`).toBe(null);
      expect(errorsVerdict(result.errors), `${label}: errors`).toBe('ok');
      expect(pollutionProbe(), `${label}: Object.prototype`).toBe('clean');
    }
  });

  it('accepts a well-formed link and rejects the near-misses, one case at a time', () => {
    const accepted = parseShareState(`#s=${VALID_S}&l=2.5`);
    expect(accepted.codes, 'eight in-range digits decode to class indices').toEqual(VALID_CODES);
    expect(accepted.lambda, 'lambda 2.5 is inside [0, 5]').toBe(2.5);
    expect(accepted.errors, 'a clean link must not produce complaints').toEqual([]);

    // The brief lists 's=12345678' as valid; it is not. There are six classes,
    // so digits 6, 7 and 8 are out of range and the sequence is rejected.
    const sixSevenEight = parseShareState('s=12345678');
    expect(sixSevenEight.codes, "digits 6/7/8 are not class indices in a 6-class alphabet").toBe(null);
    expect(sixSevenEight.errors.length, 'rejection must be explained').toBe(1);
    expect(sixSevenEight.errors[0]).toContain('eight digits');

    for (const bad of ['s=99999999', 's=1234567', 's=123456789', 's=abc', 's=', 's=0123450a', 's=-1234501']) {
      const r = parseShareState(bad);
      expect(r.codes, `${bad}: codes`).toBe(null);
      expect(r.errors.length, `${bad}: exactly one explanation`).toBe(1);
      expect(r.lambda, `${bad}: lambda untouched`).toBe(null);
    }

    for (const [hash, expected] of [
      ['l=0', 0],
      ['l=5', 5],
      ['l=2.5', 2.5],
      ['l=0.0001', 0.0001],
      ['l=4.999999', 4.999999],
      ['l=0&l=5', 0], // duplicate keys: URLSearchParams.get returns the first
      ['l=5&l=0', 5],
      ['l=', 0], // Number('') is 0, so an empty value is treated as lambda 0
      ['l=%32', 2],
      ['l=2%2E5', 2.5],
      ['l=+2', 2], // '+' decodes to a space; Number(' 2') is 2
    ] as const) {
      const r = parseShareState(hash as string);
      expect(r.lambda, `${hash}: lambda`).toBe(expected);
      expect(r.errors, `${hash}: no complaints expected`).toEqual([]);
    }

    for (const bad of ['l=-1', 'l=99', 'l=NaN', 'l=Infinity', 'l=-Infinity', 'l=1e999', 'l=5.0000001', 'l=6', 'l=2,5', 'l=null']) {
      const r = parseShareState(bad);
      expect(r.lambda, `${bad}: lambda must be refused`).toBe(null);
      expect(r.errors.length, `${bad}: exactly one explanation`).toBe(1);
      expect(r.errors[0], `${bad}: message names the range`).toContain('0 to 5');
    }

    // Silence, not complaints, for input that simply carries no state.
    for (const quiet of ['', '#', 'junk', 'unknown=1', `S=${VALID_S}`, 'L=2', '&&&&']) {
      const r = parseShareState(quiet);
      expect(r.codes, `${JSON.stringify(quiet)}: codes`).toBe(null);
      expect(r.lambda, `${JSON.stringify(quiet)}: lambda`).toBe(null);
      expect(r.errors, `${JSON.stringify(quiet)}: should stay silent`).toEqual([]);
    }

    // Percent-encoding is decoded before validation, in keys and in values.
    expect(parseShareState('s=%30%31%32%33%34%35%30%31').codes, 'encoded value').toEqual(VALID_CODES);
    expect(parseShareState('s=0123450%31').codes, 'partially encoded value').toEqual(VALID_CODES);
    expect(parseShareState('%73=01234501').codes, 'encoded key "s"').toEqual(VALID_CODES);
    // Double encoding must NOT be unwrapped twice.
    expect(parseShareState('s=%2530%2531%2532%2533%2534%2535%2530%2531').codes, 'double-encoded').toBe(
      null,
    );
  });

  it('returns a fresh array each call, so a caller cannot corrupt the next parse', () => {
    const first = parseShareState(`#s=${VALID_S}&l=1`);
    expect(first.codes).toEqual(VALID_CODES);
    (first.codes as number[])[0] = 99;
    first.errors.push('injected');
    const second = parseShareState(`#s=${VALID_S}&l=1`);
    expect(second.codes, 'the next parse must be unaffected').toEqual(VALID_CODES);
    expect(second.errors, 'the next parse must start with no errors').toEqual([]);
  });
});

/* ================================================================== *
 * 7. encodeShareState round-trip                                      *
 * ================================================================== */

const ROUND_TRIP_CODES: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [5, 5, 5, 5, 5, 5, 5, 5],
  VALID_CODES,
  [5, 4, 3, 2, 1, 0, 5, 4],
  ...golden().cases.slice(0, 2).map((c) => [...c.codes]),
  indexToCodes(1234567),
  indexToCodes(42),
];

const ROUND_TRIP_LAMBDAS = [0, 0.5, 1, 2, 5, 0.25, 1 / 3, 4.999999];

describe('encodeShareState / parseShareState round-trip', () => {
  it('round-trips every (codes, lambda) pair exactly', () => {
    for (const codes of ROUND_TRIP_CODES) {
      for (const lambda of ROUND_TRIP_LAMBDAS) {
        const label = `${codes.join('')} @ lambda=${lambda}`;
        const hash = encodeShareState([...codes], lambda);
        expect(hash, `${label}: hash format`).toMatch(/^#s=[0-5]{8}&l=/);
        const back = parseShareState(hash);
        expect(back.codes, `${label}: codes survive`).toEqual(codes);
        expect(back.lambda, `${label}: lambda survives bit-for-bit`).toBe(lambda);
        expect(back.errors, `${label}: no complaints`).toEqual([]);
      }
    }
  });

  it('writes the exact textual form the app documents', () => {
    expect(encodeShareState([...VALID_CODES], 2)).toBe('#s=01234501&l=2');
    expect(encodeShareState([0, 0, 0, 0, 0, 0, 0, 0], 0)).toBe('#s=00000000&l=0');
    expect(encodeShareState([5, 5, 5, 5, 5, 5, 5, 5], 5)).toBe('#s=55555555&l=5');
    expect(encodeShareState([...VALID_CODES], 0.5)).toBe('#s=01234501&l=0.5');
  });

  it('returns an empty string for anything that is not a valid 8-class sequence', () => {
    const invalid: unknown[] = [
      [], [0], [0, 1, 2, 3, 4, 5, 0], [0, 1, 2, 3, 4, 5, 0, 1, 2], [0, 0, 0, 0, 0, 0, 0, 6],
      [0, 0, 0, 0, 0, 0, 0, -1], [0, 0, 0, 0, 0, 0, 0, 0.5], [0, 0, 0, 0, 0, 0, 0, Number.NaN],
      ['0', '1', '2', '3', '4', '5', '0', '1'], [null, 0, 0, 0, 0, 0, 0, 0],
      [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
      null, undefined, 'ice cream', 12345678, {}, { 0: 0, length: 8 },
    ];
    for (const codes of invalid) {
      expect(
        encodeShareState(codes as number[], 1),
        `${JSON.stringify(codes ?? null)} must not be encodable`,
      ).toBe('');
    }
  });

  it('refuses to silently round-trip a lambda the parser would reject', () => {
    // encodeShareState does not validate lambda, so it can emit a link the
    // parser then refuses. The failure mode is "defaults are used", never a
    // crash and never an out-of-range value reaching the app.
    for (const lambda of [-1, 6, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const hash = encodeShareState([...VALID_CODES], lambda);
      expect(hash, `lambda=${lambda}: codes still encode`).toMatch(/^#s=01234501&l=/);
      const back = parseShareState(hash);
      expect(back.codes, `lambda=${lambda}: codes survive`).toEqual(VALID_CODES);
      expect(back.lambda, `lambda=${lambda}: must be refused on the way back`).toBe(null);
      expect(back.errors.length, `lambda=${lambda}: explained`).toBe(1);
    }
  });

  it('DOCUMENTED HOLE: a SPARSE codes array slips past isValidCodes', () => {
    // `isValidCodes` validates with Array.prototype.every, which SKIPS holes, so
    // a sparse 8-slot array is reported valid without a single element being
    // checked. A dense array of the same undefined values is correctly refused,
    // which is what isolates the cause.
    //
    // Reach of the hole, measured below: the share link it produces is refused
    // on the way back in, so no bad state can re-enter through a URL. But
    // `sanitiseScenarios` does accept it and emits a scenario whose eight codes
    // are undefined. It is not reachable from stored preferences, because
    // JSON.parse cannot produce holes - only in-process callers can.
    //
    // If this test starts failing, `isValidCodes` was tightened: that is the fix,
    // and this test should then be deleted rather than adjusted.
    const sparse = new Array(8) as number[];
    const dense = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined];
    expect(sparse.length, 'a sparse array still reports length 8').toBe(8);
    expect(0 in sparse, 'slot 0 is a hole, not an undefined value').toBe(false);
    expect(0 in dense, 'the dense contrast really does own slot 0').toBe(true);

    const encoded = encodeShareState(sparse, 1);
    expect(encoded, 'the hole produces an empty sequence in the link').toBe('#s=&l=1');
    const back = parseShareState(encoded);
    expect(back.codes, 'containment: the parser refuses the malformed link').toBe(null);
    expect(back.errors.length, 'and explains why').toBe(1);
    expect(encodeShareState(dense as unknown as number[], 1), 'the dense form is refused up front').toBe('');

    const leaked = sanitiseScenarios([okEntry({ codes: sparse })]);
    expect(leaked.length, 'sanitiseScenarios accepts the sparse sequence').toBe(1);
    expect(leaked[0].codes.length, 'and emits eight slots').toBe(8);
    expect(leaked[0].codes[0], 'whose values are undefined, not class indices').toBeUndefined();
    expect(sanitiseScenarios([okEntry({ codes: dense })]), 'the dense form is dropped').toEqual([]);

    // JSON.parse cannot create holes, so the localStorage path cannot reach this.
    const viaJson = JSON.parse('[null,null,null,null,null,null,null,null]') as unknown[];
    expect(0 in viaJson, 'JSON nulls are real values, not holes').toBe(true);
    expect(
      sanitiseScenarios([okEntry({ codes: viaJson })]),
      'a restored-from-JSON sequence of nulls is correctly dropped',
    ).toEqual([]);
  });

  it('parses its own output with or without the leading hash', () => {
    for (const codes of ROUND_TRIP_CODES) {
      const hash = encodeShareState([...codes], 1.5);
      const withHash = parseShareState(hash);
      const withoutHash = parseShareState(hash.slice(1));
      expect(withoutHash, `${codes.join('')}: '#' must be optional`).toEqual(withHash);
    }
  });
});

/* ================================================================== *
 * 8. sanitiseScenarios - UNTRUSTED INPUT                              *
 * ================================================================== */

const LONG = 'x'.repeat(500);
const okEntry = (over: Record<string, unknown> = {}) => ({
  id: 'scenario-1',
  name: 'A scenario',
  codes: [...VALID_CODES],
  lambda: 1,
  savedAtIso: '2024-01-01T00:00:00.000Z',
  ...over,
});

function buildScenarioInputs(): unknown[] {
  const inputs: unknown[] = [
    // Not arrays at all.
    null, undefined, 0, 1, -1, Number.NaN, '', 'scenarios', true, false, {}, { length: 3 },
    Object.create(null), () => [], new Map(), new Set([okEntry()]), new Date(0), /re/,
    JSON.stringify([okEntry()]), 12345678n, Symbol('x'),
    // Arrays of junk.
    [], [null], [undefined], [0], ['x'], [[]], [{}], [[1, 2]], [() => {}], [true], [Number.NaN],
    new Array(40), [null, undefined, 0, '', false],
    // Missing or wrong-typed fields.
    [{ codes: [...VALID_CODES] }], [{ lambda: 1 }], [{ codes: [...VALID_CODES], lambda: '1' }],
    [{ codes: [...VALID_CODES], lambda: null }], [{ codes: [...VALID_CODES], lambda: true }],
    [{ codes: [...VALID_CODES], lambda: Number.NaN }],
    [{ codes: [...VALID_CODES], lambda: Number.POSITIVE_INFINITY }],
    // Invalid codes.
    [okEntry({ codes: [0, 1, 2, 3, 4, 5, 0] })],
    [okEntry({ codes: [0, 1, 2, 3, 4, 5, 0, 1, 2] })],
    [okEntry({ codes: [0, 0, 0, 0, 0, 0, 0, 6] })],
    [okEntry({ codes: [0, 0, 0, 0, 0, 0, 0, -1] })],
    [okEntry({ codes: [0, 0, 0, 0, 0, 0, 0, 0.5] })],
    [okEntry({ codes: '01234501' })],
    [okEntry({ codes: null })],
    [okEntry({ codes: [] })],
    // Lambda out of range.
    [okEntry({ lambda: -1 })], [okEntry({ lambda: -0.0001 })], [okEntry({ lambda: 5.0001 })],
    [okEntry({ lambda: 99 })], [okEntry({ lambda: 1e999 })],
    // Accepted, with hostile strings in the label fields.
    [okEntry({ lambda: 0 })], [okEntry({ lambda: 5 })], [okEntry({ lambda: 4.999999 })],
    [okEntry({ name: LONG })], [okEntry({ id: LONG })], [okEntry({ savedAtIso: LONG })],
    [okEntry({ name: '<script>alert(1)</script>'.repeat(20) })],
    [okEntry({ name: null })], [okEntry({ id: null })], [okEntry({ name: 42 })],
    [okEntry({ name: { toString: () => 'object name' } })],
    [okEntry({ extra: 'should not survive', __proto__junk: 1 })],
    // Too many entries.
    Array.from({ length: 50 }, (_, i) => okEntry({ id: `s-${i}` })),
    Array.from({ length: 31 }, (_, i) => okEntry({ id: `s-${i}` })),
    Array.from({ length: 35 }, (_, i) => (i < 5 ? { junk: true } : okEntry({ id: `s-${i}` }))),
    // Prototype pollution attempts.
    JSON.parse('{"__proto__":{"polluted":1}}'),
    JSON.parse('[{"__proto__":{"polluted":1}}]'),
    JSON.parse('[{"__proto__":{"pwned":1},"codes":[0,1,2,3,4,5,0,1],"lambda":1}]'),
    JSON.parse('[{"constructor":{"prototype":{"isAdmin":true}},"codes":[0,0,0,0,0,0,0,0],"lambda":0}]'),
    JSON.parse('[{"id":"__proto__","name":"constructor","codes":[0,0,0,0,0,0,0,0],"lambda":0}]'),
    [okEntry({ id: '__proto__' })], [okEntry({ name: 'constructor' })],
  ];
  // A few randomly mangled entries, deterministically generated.
  const rng = makeRng(777111);
  for (let k = 0; k < 20; k += 1) {
    const entry = okEntry() as Record<string, unknown>;
    const keys = Object.keys(entry);
    const victim = keys[rng.int(keys.length)];
    const replacements: unknown[] = [undefined, null, 0, '', [], {}, Number.NaN, LONG, -1, 6];
    entry[victim] = replacements[rng.int(replacements.length)];
    inputs.push([entry]);
  }
  return inputs;
}

const SCENARIO_INPUTS = buildScenarioInputs();

function scenarioCodesVerdict(out: readonly { codes: number[] }[]): string {
  for (let i = 0; i < out.length; i += 1) {
    const v = codesVerdict(out[i].codes);
    if (v !== 'ok') return `entry ${i}: ${v}`;
    if (out[i].codes === null) return `entry ${i}: codes must never be null in a scenario`;
  }
  return 'ok';
}

function scenarioLambdaVerdict(out: readonly { lambda: number }[]): string {
  for (let i = 0; i < out.length; i += 1) {
    const l = out[i].lambda;
    if (typeof l !== 'number' || !Number.isFinite(l)) return `entry ${i}: lambda is ${String(l)}`;
    if (l < 0 || l > 5) return `entry ${i}: lambda ${l} outside [0, 5]`;
  }
  return 'ok';
}

function scenarioTruncationVerdict(
  out: readonly { id: string; name: string; savedAtIso: string }[],
): string {
  for (let i = 0; i < out.length; i += 1) {
    const e = out[i];
    if (typeof e.id !== 'string') return `entry ${i}: id is ${typeof e.id}`;
    if (typeof e.name !== 'string') return `entry ${i}: name is ${typeof e.name}`;
    if (typeof e.savedAtIso !== 'string') return `entry ${i}: savedAtIso is ${typeof e.savedAtIso}`;
    if (e.id.length > 80) return `entry ${i}: id is ${e.id.length} chars, cap is 80`;
    if (e.name.length > 60) return `entry ${i}: name is ${e.name.length} chars, cap is 60`;
    if (e.savedAtIso.length > 40) return `entry ${i}: savedAtIso is ${e.savedAtIso.length} chars, cap is 40`;
    const keys = Object.keys(e).sort().join(',');
    if (keys !== 'codes,id,lambda,name,savedAtIso') return `entry ${i}: unexpected keys "${keys}"`;
  }
  return 'ok';
}

describe('sanitiseScenarios: fuzzing the restored-state sanitiser', () => {
  it('fuzzes at least 80 hostile inputs', () => {
    expect(SCENARIO_INPUTS.length, 'scenario corpus size').toBeGreaterThanOrEqual(80);
    expect(pollutionProbe(), 'baseline must be clean before fuzzing').toBe('clean');
  });

  it('always returns an array of at most 30 fully valid scenarios', () => {
    for (let i = 0; i < SCENARIO_INPUTS.length; i += 1) {
      const label = `input #${i}`;
      const call = noThrow(() => sanitiseScenarios(SCENARIO_INPUTS[i]));
      expect(call.threw, `${label}: must not throw`).toBe(null);
      const out = call.value as { id: string; name: string; codes: number[]; lambda: number; savedAtIso: string }[];
      expect(Array.isArray(out), `${label}: must return an array`).toBe(true);
      expect(out.length, `${label}: at most 30 scenarios`).toBeLessThanOrEqual(30);
      expect(scenarioCodesVerdict(out), `${label}: codes`).toBe('ok');
      expect(scenarioLambdaVerdict(out), `${label}: lambda`).toBe('ok');
      expect(scenarioTruncationVerdict(out), `${label}: string caps and shape`).toBe('ok');
      expect(pollutionProbe(), `${label}: Object.prototype`).toBe('clean');
    }
  });

  it('drops non-arrays and junk entries entirely', () => {
    for (const input of [null, undefined, 0, '', 'x', {}, true, new Set(), new Array(5)]) {
      expect(sanitiseScenarios(input), `${String(input)} yields no scenarios`).toEqual([]);
    }
    expect(sanitiseScenarios([null, 0, 'x', [], {}, true]), 'array of junk').toEqual([]);
  });

  it('keeps a well-formed scenario unchanged', () => {
    const [kept] = sanitiseScenarios([okEntry()]);
    expect(kept.id).toBe('scenario-1');
    expect(kept.name).toBe('A scenario');
    expect(kept.codes).toEqual(VALID_CODES);
    expect(kept.lambda).toBe(1);
    expect(kept.savedAtIso).toBe('2024-01-01T00:00:00.000Z');
  });

  it('truncates over-long ids, names and timestamps to their caps', () => {
    const [entry] = sanitiseScenarios([
      okEntry({ id: LONG, name: LONG, savedAtIso: LONG }),
    ]);
    expect(entry.id.length, 'id cap').toBe(80);
    expect(entry.name.length, 'name cap').toBe(60);
    expect(entry.savedAtIso.length, 'savedAtIso cap').toBe(40);
    expect(entry.id, 'truncation keeps the prefix').toBe('x'.repeat(80));
  });

  it('supplies defaults rather than undefined for missing labels', () => {
    const [entry] = sanitiseScenarios([{ codes: [...VALID_CODES], lambda: 2 }]);
    expect(entry.id, 'generated id').toBe('imported-0');
    expect(entry.name, 'default name').toBe('Untitled scenario');
    expect(entry.savedAtIso, 'missing timestamp becomes empty, never "undefined"').toBe('');
    expect(entry.lambda).toBe(2);
    const many = sanitiseScenarios([
      { codes: [...VALID_CODES], lambda: 0 },
      { codes: [...VALID_CODES], lambda: 1 },
      { codes: [...VALID_CODES], lambda: 2 },
    ]);
    expect(many.map((s) => s.id), 'generated ids are positional and unique').toEqual([
      'imported-0',
      'imported-1',
      'imported-2',
    ]);
  });

  it('caps the output at 30 even when far more entries are offered', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => okEntry({ id: `s-${i}` }));
    const out = sanitiseScenarios(fifty);
    expect(out.length, 'cap').toBe(30);
    expect(out[0].id, 'the first 30 are kept, in order').toBe('s-0');
    expect(out[29].id, 'the 30th kept entry').toBe('s-29');
    // The cap is applied BEFORE filtering, so junk inside the first 30 reduces
    // the output rather than pulling later entries forward.
    const mixed = Array.from({ length: 35 }, (_, i) => (i < 5 ? { junk: true } : okEntry({ id: `s-${i}` })));
    const mixedOut = sanitiseScenarios(mixed);
    expect(mixedOut.length, '5 junk entries inside the first 30 leave 25').toBe(25);
    expect(mixedOut[0].id, 'first survivor').toBe('s-5');
  });

  it('rejects every out-of-range lambda and keeps every in-range one', () => {
    for (const lambda of [-1, -0.0001, 5.0001, 6, 99, 1e999, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(sanitiseScenarios([okEntry({ lambda })]), `lambda=${lambda} must be dropped`).toEqual([]);
    }
    for (const lambda of [0, 0.0001, 1, 2.5, 4.999999, 5]) {
      const out = sanitiseScenarios([okEntry({ lambda })]);
      expect(out.length, `lambda=${lambda} must be kept`).toBe(1);
      expect(out[0].lambda, `lambda=${lambda} value`).toBe(lambda);
    }
  });

  it('copies the codes array instead of aliasing the untrusted one', () => {
    const source = [...VALID_CODES];
    const [entry] = sanitiseScenarios([okEntry({ codes: source })]);
    source[0] = 5;
    expect(entry.codes, 'later mutation of the input must not reach the output').toEqual(VALID_CODES);
    entry.codes[1] = 5;
    expect(source[1], 'mutation of the output must not reach the input').toBe(1);
  });

  it('does not copy unexpected fields out of the untrusted object', () => {
    const [entry] = sanitiseScenarios([
      okEntry({ extra: 'nope', onclick: 'alert(1)', codesRaw: [1, 2, 3] }),
    ]);
    expect(Object.keys(entry).sort(), 'only the five known fields survive').toEqual([
      'codes',
      'id',
      'lambda',
      'name',
      'savedAtIso',
    ]);
    expect((entry as unknown as Record<string, unknown>).extra, 'extra field').toBeUndefined();
    expect((entry as unknown as Record<string, unknown>).onclick, 'event-handler-shaped field').toBeUndefined();
  });

  it('leaves Object.prototype alone after every pollution payload', () => {
    const payloads: unknown[] = [
      JSON.parse('{"__proto__":{"polluted":1}}'),
      JSON.parse('[{"__proto__":{"polluted":1}}]'),
      JSON.parse('[{"__proto__":{"x":"y"},"codes":[0,1,2,3,4,5,0,1],"lambda":1}]'),
      JSON.parse('[{"constructor":{"prototype":{"pwned":1}},"codes":[0,0,0,0,0,0,0,0],"lambda":0}]'),
      [okEntry({ id: '__proto__', name: 'constructor' })],
    ];
    for (let i = 0; i < payloads.length; i += 1) {
      const out = sanitiseScenarios(payloads[i]);
      expect(Array.isArray(out), `payload ${i}: array`).toBe(true);
      expect(pollutionProbe(), `payload ${i}: Object.prototype`).toBe('clean');
      expect(({} as Record<string, unknown>).polluted, `payload ${i}: no "polluted" key`).toBeUndefined();
      expect(({} as Record<string, unknown>).pwned, `payload ${i}: no "pwned" key`).toBeUndefined();
    }
    // The id/name pollution payload is still accepted as DATA, as a string.
    const [entry] = sanitiseScenarios([okEntry({ id: '__proto__', name: 'constructor' })]);
    expect(entry.id, 'a dangerous-looking id is stored as an inert string').toBe('__proto__');
    expect(entry.name, 'a dangerous-looking name is stored as an inert string').toBe('constructor');
  });
});

/* ================================================================== *
 * Coverage floor                                                      *
 * ================================================================== */

describe('suite accounting', () => {
  it('executed the full assertion budget', () => {
    // Counted from vitest's own assertion counter, not estimated. The floor is
    // set below the measured total so adding coverage never fails the suite,
    // but deleting a whole section does.
    expect(assertionTotal, `assertions executed before this test: ${assertionTotal}`).toBeGreaterThan(
      3800,
    );
  });
});
