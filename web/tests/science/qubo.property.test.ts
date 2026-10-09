/**
 * QUBO / PENALTY / ISING INVARIANTS.
 *
 * The Verify screen, the annealing solvers and every "this is the same problem
 * a quantum annealer would be handed" claim on the site rest on three things
 * being true at once:
 *
 *   1. the QUBO is the objective - for a valid one-hot assignment the
 *      48-variable quadratic form reproduces -PET + lambda*(PE + PP) exactly;
 *   2. the one-hot penalty is free for valid assignments and ruinous for
 *      invalid ones - it adds exactly P * sum_i (n_i - 1)^2, which is 0 when
 *      every position holds exactly one bit;
 *   3. the Ising form is the same energy landscape re-parameterised, for ANY
 *      binary vector, not just the feasible ones.
 *
 * All three are checked against the real exported coefficients, over many
 * sequences and many lambdas, with a seeded RNG so a failure is reproducible.
 *
 * NO QUANTUM HARDWARE IS INVOLVED. The Ising form is built and checked purely
 * in software; it is the standard x = (s + 1) / 2 change of variables.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  LENGTH,
  PAIR_COUNT,
  PAIR_ORDER,
  VALID_SEQUENCES,
  classSequence,
  encode,
  indexToCodes,
  isValidOneHot,
  parseClassSequence,
  variableIndex,
  type Codes,
} from '../../src/science/alphabet';
import { LAMBDA_MAX, objective } from '../../src/science/objective';
import { TARGET, scoreAll, scoreRange } from '../../src/science/potts';
import {
  DEFAULT_PENALTY_MULTIPLIER,
  addOneHotConstraint,
  binaryToSpins,
  coefficientMass,
  combineObjective,
  isingEnergy,
  maxAbsCoefficient,
  quadIndex,
  quadraticEntries,
  quboEnergy,
  quboEnergyOfCodes,
  quboToIsing,
  safePenalty,
  type Qubo,
} from '../../src/science/qubo';
import { makeRng, sampleWithoutReplacement } from '../../src/science/rng';
import { exactBruteForce, type FullSpaceScores } from '../../src/science/solvers';
import {
  PUBLISHED_OPTIMA,
  SURROGATE_TOLERANCE,
  golden,
  realModel,
} from '../helpers/model';

const model = realModel();
const flat = model.flat;
const g = golden();

/** Objective-vs-QUBO agreement bound. Both are O(1e3); float64 gives ~1e-12. */
const QUBO_TOLERANCE = 1e-9;
/**
 * Penalty-cancellation bound. The expanded constraint sums +8P of offset
 * against -8P of linear terms with P ~ 1e4..7e4, so the exact zero arrives as a
 * float64 residue of order eps * P * terms ~ 1e-9. 1e-8 absolute is honest.
 */
const PENALTY_CANCELLATION_TOLERANCE = 1e-8;

/* ------------------------------------------------------------------ *
 * Seeded inputs. Nothing in this file draws from an unseeded source.
 * ------------------------------------------------------------------ */

const seqRng = makeRng(20260409);
const lamRng = makeRng(31337);
const bitRng = makeRng(8675309);

function dedupe(list: readonly Codes[]): number[][] {
  const seen = new Set<string>();
  const out: number[][] = [];
  for (const c of list) {
    const key = classSequence(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([...c]);
  }
  return out;
}

/** The six single-class sequences - corners of the class space. */
const UNIFORM: number[][] = Array.from({ length: ALPHABET_SIZE }, (_, a) =>
  Array.from({ length: LENGTH }, () => a),
);

/** Published optima (class strings only; every number here is recomputed). */
const OPTIMA: number[][] = Object.values(PUBLISHED_OPTIMA).map((o) =>
  parseClassSequence(o.classSequence),
);

/** Evenly spaced slice of the Python golden fixture. */
const GOLDEN_SAMPLE: number[][] = g.cases
  .filter((_, i) => i % 11 === 0)
  .map((c) => [...c.codes]);

/** Distinct random sequences, drawn once, deterministically. */
const RANDOM_SAMPLE: number[][] = sampleWithoutReplacement(
  seqRng,
  VALID_SEQUENCES,
  32,
).map((n) => indexToCodes(n));

const SEQUENCES: number[][] = dedupe([
  ...UNIFORM,
  ...OPTIMA,
  ...GOLDEN_SAMPLE,
  ...RANDOM_SAMPLE,
]);

const FIXED_LAMBDAS = [0, 0.25, 0.5, 1, 1.5, 2, 3, 5];
const RANDOM_LAMBDAS = Array.from({ length: 12 }, () => lamRng.next() * LAMBDA_MAX);
const ALL_LAMBDAS = [...FIXED_LAMBDAS, ...RANDOM_LAMBDAS];

/** Lambdas used for the expensive full-space dominance checks. */
const DOMINANCE_LAMBDAS = [0, 1, 5];

const quboCache = new Map<number, Qubo>();
function qAt(lambda: number): Qubo {
  let q = quboCache.get(lambda);
  if (!q) {
    q = combineObjective(flat, lambda);
    quboCache.set(lambda, q);
  }
  return q;
}

const constrainedCache = new Map<number, Qubo>();
function constrainedAt(lambda: number): Qubo {
  let q = constrainedCache.get(lambda);
  if (!q) {
    const base = qAt(lambda);
    q = addOneHotConstraint(base, safePenalty(base));
    constrainedCache.set(lambda, q);
  }
  return q;
}

function objectiveOf(codes: Codes, lambda: number): number {
  return objective(scoreAll(codes, flat), lambda);
}

/** Bits switched on per position, for an arbitrary binary vector. */
function bitsPerPosition(x: ArrayLike<number>): number[] {
  const counts: number[] = [];
  for (let i = 0; i < LENGTH; i += 1) {
    let n = 0;
    for (let a = 0; a < ALPHABET_SIZE; a += 1) n += x[variableIndex(i, a)];
    counts.push(n);
  }
  return counts;
}

/** sum_i (n_i - 1)^2 - the exact multiple of P the expanded constraint adds. */
function violationCost(x: ArrayLike<number>): number {
  return bitsPerPosition(x).reduce((acc, n) => acc + (n - 1) * (n - 1), 0);
}

interface Broken {
  readonly label: string;
  readonly x: Uint8Array;
  /** sum_i (n_i - 1)^2 */
  readonly cost: number;
}

function broken(label: string, x: Uint8Array): Broken {
  return { label, x, cost: violationCost(x) };
}

/** Deliberately infeasible assignments derived from one valid sequence. */
function brokenFrom(codes: number[]): Broken[] {
  const base = encode(codes);
  const tag = classSequence(codes).slice(0, 12);
  const out: Broken[] = [];

  // One extra bit: that position now holds two classes at once.
  for (let p = 0; p < LENGTH; p += 1) {
    const x = Uint8Array.from(base);
    x[variableIndex(p, (codes[p] + 1) % ALPHABET_SIZE)] = 1;
    out.push(broken(`${tag} two-bits@p${p}`, x));
  }

  // A position with no bit at all: the peptide has a hole.
  for (let p = 0; p < LENGTH; p += 1) {
    const x = Uint8Array.from(base);
    x[variableIndex(p, codes[p])] = 0;
    out.push(broken(`${tag} zero-bits@p${p}`, x));
  }

  // Two positions broken, in opposite directions.
  const two = Uint8Array.from(base);
  two[variableIndex(0, (codes[0] + 2) % ALPHABET_SIZE)] = 1;
  two[variableIndex(3, codes[3])] = 0;
  out.push(broken(`${tag} two-positions`, two));

  // Three positions broken at once.
  const three = Uint8Array.from(base);
  three[variableIndex(1, (codes[1] + 3) % ALPHABET_SIZE)] = 1;
  three[variableIndex(2, (codes[2] + 4) % ALPHABET_SIZE)] = 1;
  three[variableIndex(5, codes[5])] = 0;
  out.push(broken(`${tag} three-positions`, three));

  // Four positions carrying three classes each.
  const heavy = Uint8Array.from(base);
  for (const p of [0, 2, 4, 6]) {
    heavy[variableIndex(p, (codes[p] + 1) % ALPHABET_SIZE)] = 1;
    heavy[variableIndex(p, (codes[p] + 2) % ALPHABET_SIZE)] = 1;
  }
  out.push(broken(`${tag} four-triples`, heavy));

  return out;
}

const ALL_ON = broken('all-48-bits-on', new Uint8Array(BINARY_VARIABLES).fill(1));
const ALL_OFF = broken('all-48-bits-off', new Uint8Array(BINARY_VARIABLES));

const DOMINANCE_BASES: number[][] = [
  UNIFORM[0],
  parseClassSequence(PUBLISHED_OPTIMA['1'].classSequence),
  RANDOM_SAMPLE[0],
];

const BROKEN: Broken[] = [...DOMINANCE_BASES.flatMap(brokenFrom), ALL_ON, ALL_OFF];

/** Random binary vectors - mostly infeasible, which is exactly the point. */
const RANDOM_BITS: Uint8Array[] = Array.from({ length: 25 }, (_, k) => {
  const x = new Uint8Array(BINARY_VARIABLES);
  // Vary the density so some vectors are sparse and some nearly full.
  const density = 0.08 + (k % 12) * 0.08;
  for (let i = 0; i < BINARY_VARIABLES; i += 1) x[i] = bitRng.next() < density ? 1 : 0;
  return x;
});

/* ------------------------------------------------------------------ *
 * Full-space reference. Enumerating all 1,679,616 valid sequences is
 * the only way to say "no infeasible assignment beats the BEST valid
 * one" without hand-waving, so the dominance block pays for it once.
 * ------------------------------------------------------------------ */

let fullSpace: FullSpaceScores | null = null;
const provenOptima = new Map<number, number>();

function provenOptimum(lambda: number): number {
  const cached = provenOptima.get(lambda);
  if (cached === undefined) throw new Error(`no proven optimum for lambda=${lambda}`);
  return cached;
}

describe('sampling pools', () => {
  it('covers a diverse, deterministic set of sequences and lambdas', () => {
    expect(SEQUENCES.length).toBeGreaterThanOrEqual(70);
    expect(new Set(SEQUENCES.map(classSequence)).size).toBe(SEQUENCES.length);
    for (const codes of SEQUENCES) {
      expect(codes.length).toBe(LENGTH);
      expect(isValidOneHot(encode(codes))).toBe(true);
    }
    // All six classes are actually exercised.
    const usedClasses = new Set<number>();
    for (const codes of SEQUENCES) for (const c of codes) usedClasses.add(c);
    expect(usedClasses.size).toBe(ALPHABET_SIZE);

    expect(RANDOM_LAMBDAS.length).toBe(12);
    for (const lambda of RANDOM_LAMBDAS) {
      expect(lambda).toBeGreaterThanOrEqual(0);
      expect(lambda).toBeLessThanOrEqual(LAMBDA_MAX);
    }
    // Seeded: the same draws must come back on every run, in every browser.
    expect(RANDOM_LAMBDAS[0]).toBeCloseTo(makeRng(31337).next() * LAMBDA_MAX, 15);
  });
});

/* =================================================================== *
 * 1. The unconstrained QUBO *is* the objective, for valid sequences.
 * =================================================================== */

describe('unconstrained QUBO reproduces the objective', () => {
  for (const lambda of FIXED_LAMBDAS) {
    it(`matches -PET + ${lambda}*(PE+PP) for every sampled sequence`, () => {
      const q = qAt(lambda);
      for (const codes of SEQUENCES.slice(0, 30)) {
        const viaQubo = quboEnergyOfCodes(codes, q);
        const viaScores = objectiveOf(codes, lambda);
        expect(
          Math.abs(viaQubo - viaScores),
          `${classSequence(codes)} @ lambda=${lambda}`,
        ).toBeLessThan(QUBO_TOLERANCE);
      }
    });
  }

  it('matches the objective at twelve seeded random lambdas', () => {
    for (const lambda of RANDOM_LAMBDAS) {
      const q = qAt(lambda);
      for (const codes of SEQUENCES.slice(0, 12)) {
        const err = Math.abs(quboEnergyOfCodes(codes, q) - objectiveOf(codes, lambda));
        expect(err, `${classSequence(codes)} @ lambda=${lambda}`).toBeLessThan(
          QUBO_TOLERANCE,
        );
      }
    }
  });

  it('reports itself as unconstrained, with the model intercepts as its offset', () => {
    for (const lambda of ALL_LAMBDAS) {
      const q = qAt(lambda);
      const expectedOffset =
        -flat[TARGET].intercept + lambda * (flat.PE.intercept + flat.PP.intercept);
      expect(q.lambda).toBe(lambda);
      expect(q.penalty).toBe(0);
      expect(q.constrained).toBe(false);
      expect(q.offset).toBeCloseTo(expectedOffset, 12);
    }
  });
});

/* =================================================================== *
 * 2. The one-hot penalty is free for feasible assignments.
 * =================================================================== */

describe('one-hot penalty is exactly zero on valid sequences', () => {
  for (const lambda of FIXED_LAMBDAS) {
    it(`leaves every valid energy unchanged at lambda=${lambda}`, () => {
      const q = qAt(lambda);
      const c = constrainedAt(lambda);
      for (const codes of SEQUENCES.slice(0, 25)) {
        const plain = quboEnergyOfCodes(codes, q);
        const withPenalty = quboEnergyOfCodes(codes, c);
        expect(
          Math.abs(withPenalty - plain),
          `${classSequence(codes)} @ lambda=${lambda}`,
        ).toBeLessThan(PENALTY_CANCELLATION_TOLERANCE);
      }
    });
  }

  it('constrained energy still equals the objective for valid sequences', () => {
    for (const lambda of [0, 1, 2, 5]) {
      const c = constrainedAt(lambda);
      for (const codes of SEQUENCES.slice(0, 12)) {
        const err = Math.abs(quboEnergyOfCodes(codes, c) - objectiveOf(codes, lambda));
        expect(err, `${classSequence(codes)} @ lambda=${lambda}`).toBeLessThan(
          PENALTY_CANCELLATION_TOLERANCE,
        );
      }
    }
  });

  it('records the penalty it was built with and shifts the offset by LENGTH*P', () => {
    for (const lambda of ALL_LAMBDAS) {
      const q = qAt(lambda);
      const p = safePenalty(q);
      const c = constrainedAt(lambda);
      expect(c.constrained).toBe(true);
      expect(c.penalty).toBe(p);
      expect(c.lambda).toBe(lambda);
      expect(c.offset - q.offset).toBeCloseTo(LENGTH * p, 6);
    }
  });

  it('shifts every linear coefficient down by exactly P and no further', () => {
    for (const lambda of FIXED_LAMBDAS) {
      const q = qAt(lambda);
      const p = safePenalty(q);
      const c = constrainedAt(lambda);
      let worst = 0;
      for (let i = 0; i < BINARY_VARIABLES; i += 1) {
        worst = Math.max(worst, Math.abs(c.linear[i] - (q.linear[i] - p)));
      }
      expect(worst, `lambda=${lambda}`).toBeLessThan(1e-9);
      // The largest coefficient anywhere in the constrained problem is the
      // within-position coupling, exactly 2P.
      expect(maxAbsCoefficient(c)).toBe(2 * p);
    }
  });
});

/* =================================================================== *
 * 3. Penalty dominance: infeasible assignments can never win.
 * =================================================================== */

describe('penalty dominance over the proven optimum', () => {
  beforeAll(() => {
    const PET = new Float64Array(VALID_SEQUENCES);
    const PE = new Float64Array(VALID_SEQUENCES);
    const PP = new Float64Array(VALID_SEQUENCES);
    scoreRange(flat.PET, PET, 0, VALID_SEQUENCES);
    scoreRange(flat.PE, PE, 0, VALID_SEQUENCES);
    scoreRange(flat.PP, PP, 0, VALID_SEQUENCES);
    fullSpace = { PET, PE, PP };
    for (const lambda of [...DOMINANCE_LAMBDAS, 0.5, 2]) {
      provenOptima.set(lambda, exactBruteForce(fullSpace, lambda, 1).bestObjective);
    }
  }, 600000);

  it('the enumerated optimum agrees with the published surrogate optimum', () => {
    for (const key of Object.keys(PUBLISHED_OPTIMA)) {
      const lambda = Number(key);
      const exact = provenOptimum(lambda);
      const published = PUBLISHED_OPTIMA[key];
      // results/*.csv holds Ridge surrogate values; the gap is the surrogate
      // error, not a disagreement about which sequence is optimal.
      expect(Math.abs(exact - published.objective), `lambda=${key}`).toBeLessThan(
        SURROGATE_TOLERANCE,
      );
      // The published class sequence really is an optimum of the exact model.
      const codes = parseClassSequence(published.classSequence);
      expect(objectiveOf(codes, lambda) - exact, `lambda=${key}`).toBeLessThan(1e-9);
    }
  });

  it('every generated assignment really is infeasible, with the stated cost', () => {
    expect(BROKEN.length).toBeGreaterThanOrEqual(50);
    for (const b of BROKEN) {
      expect(isValidOneHot(b.x), b.label).toBe(false);
      expect(b.cost, b.label).toBeGreaterThan(0);
    }
    // The breakage kinds are genuinely different, not 50 copies of one bug.
    expect(new Set(BROKEN.map((b) => b.cost)).size).toBeGreaterThanOrEqual(4);
    expect(ALL_ON.cost).toBe(LENGTH * (ALPHABET_SIZE - 1) * (ALPHABET_SIZE - 1));
    expect(ALL_OFF.cost).toBe(LENGTH);
  });

  for (const lambda of DOMINANCE_LAMBDAS) {
    it(`no infeasible assignment beats the enumerated optimum at lambda=${lambda}`, () => {
      const q = qAt(lambda);
      const p = safePenalty(q);
      const c = constrainedAt(lambda);
      const best = provenOptimum(lambda);

      for (const b of BROKEN) {
        const unconstrained = quboEnergy(b.x, q);
        const constrained = quboEnergy(b.x, c);
        const delta = constrained - unconstrained;
        const expectedDelta = p * b.cost;
        const where = `${b.label} @ lambda=${lambda}`;

        // (a) the whole point: infeasible can never look better than the best
        //     feasible sequence in the entire 1,679,616-sequence space.
        expect(constrained, where).toBeGreaterThan(best);

        // (b) the expanded constraint adds exactly P * sum_i (n_i - 1)^2.
        expect(Math.abs(delta - expectedDelta), where).toBeLessThan(
          1e-8 + 1e-10 * Math.abs(expectedDelta),
        );

        // (c) the increase outweighs the whole unconstrained advantage the
        //     infeasible vector gained by cheating, in absolute value.
        expect(delta, where).toBeGreaterThan(Math.abs(unconstrained - best));

        // (d) a single violation costs one full penalty unit - the scale the
        //     bound was designed around.
        if (b.cost === 1) {
          expect(delta / p, where).toBeCloseTo(1, 9);
        }
      }
    });
  }

  it('the penalty exceeds the full objective range over the valid space', () => {
    const scores = fullSpace;
    if (!scores) throw new Error('full-space scores were not built');
    for (const lambda of [0, 0.5, 1, 2, 5]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < VALID_SEQUENCES; i += 1) {
        const o = -scores.PET[i] + lambda * (scores.PE[i] + scores.PP[i]);
        if (o < lo) lo = o;
        if (o > hi) hi = o;
      }
      const p = safePenalty(qAt(lambda));
      expect(lo, `lambda=${lambda}`).toBeCloseTo(provenOptimum(lambda), 9);
      expect(p, `lambda=${lambda}`).toBeGreaterThan(hi - lo);
    }
  });
});

/* =================================================================== *
 * 4. safePenalty is the documented conservative bound.
 * =================================================================== */

describe('safePenalty bound', () => {
  it('equals 2*(linearMass + quadraticMass) + 1 recomputed from coefficientMass', () => {
    for (const lambda of ALL_LAMBDAS) {
      const q = qAt(lambda);
      const mass = coefficientMass(q);
      const expected = DEFAULT_PENALTY_MULTIPLIER * (mass.linear + mass.quadratic) + 1;
      expect(safePenalty(q), `lambda=${lambda}`).toBe(expected);
    }
  });

  it('strictly exceeds the total absolute coefficient mass and every coefficient', () => {
    for (const lambda of ALL_LAMBDAS) {
      const q = qAt(lambda);
      const mass = coefficientMass(q);
      const total = mass.linear + mass.quadratic;
      const p = safePenalty(q);
      expect(p, `lambda=${lambda}`).toBeGreaterThan(total);
      expect(p, `lambda=${lambda}`).toBeGreaterThan(maxAbsCoefficient(q));
      expect(mass.linear, `lambda=${lambda}`).toBeGreaterThan(0);
      expect(mass.quadratic, `lambda=${lambda}`).toBeGreaterThan(mass.linear);
    }
  });

  it('honours a custom multiplier', () => {
    for (const lambda of FIXED_LAMBDAS) {
      const q = qAt(lambda);
      const mass = coefficientMass(q);
      const total = mass.linear + mass.quadratic;
      expect(safePenalty(q, 1), `lambda=${lambda}`).toBe(total + 1);
      expect(safePenalty(q, 3), `lambda=${lambda}`).toBe(3 * total + 1);
      expect(safePenalty(q, 3), `lambda=${lambda}`).toBeGreaterThan(safePenalty(q, 1));
      expect(safePenalty(q), `lambda=${lambda}`).toBe(
        safePenalty(q, DEFAULT_PENALTY_MULTIPLIER),
      );
    }
  });

  it('grows with lambda across the whole slider range', () => {
    let previous = -Infinity;
    for (let step = 0; step <= 50; step += 1) {
      const lambda = (step / 50) * LAMBDA_MAX;
      const p = safePenalty(combineObjective(flat, lambda));
      expect(p, `lambda=${lambda}`).toBeGreaterThan(previous);
      previous = p;
    }
  });
});

/* =================================================================== *
 * 5. quadIndex is a symmetric upper-triangular address.
 * =================================================================== */

describe('quadIndex addressing', () => {
  it('is symmetric and always lands in the upper triangle', () => {
    const rng = makeRng(4242);
    for (let t = 0; t < 80; t += 1) {
      const u = rng.int(BINARY_VARIABLES);
      let v = rng.int(BINARY_VARIABLES);
      if (v === u) v = (u + 1 + rng.int(BINARY_VARIABLES - 1)) % BINARY_VARIABLES;
      const idx = quadIndex(u, v);
      expect(quadIndex(v, u), `(${u},${v})`).toBe(idx);
      expect(idx, `(${u},${v})`).toBe(
        Math.min(u, v) * BINARY_VARIABLES + Math.max(u, v),
      );
      expect(Math.floor(idx / BINARY_VARIABLES), `(${u},${v})`).toBeLessThan(
        idx % BINARY_VARIABLES,
      );
    }
  });

  it('maps the diagonal to itself', () => {
    for (let u = 0; u < BINARY_VARIABLES; u += 1) {
      expect(quadIndex(u, u)).toBe(u * BINARY_VARIABLES + u);
    }
  });

  it('handles the corners of the 48x48 grid', () => {
    for (const [u, v] of [
      [0, 1],
      [0, 47],
      [46, 47],
      [1, 0],
      [47, 0],
      [47, 46],
    ]) {
      const idx = quadIndex(u, v);
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      expect(idx).toBe(lo * BINARY_VARIABLES + hi);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(BINARY_VARIABLES * BINARY_VARIABLES);
    }
  });
});

/* =================================================================== *
 * 6. quadraticEntries is a faithful sparse view.
 * =================================================================== */

function nonZeroUpperCount(q: Qubo): number {
  let n = 0;
  for (let u = 0; u < BINARY_VARIABLES; u += 1) {
    for (let v = u + 1; v < BINARY_VARIABLES; v += 1) {
      if (q.quadratic[u * BINARY_VARIABLES + v] !== 0) n += 1;
    }
  }
  return n;
}

describe('quadraticEntries sparse view', () => {
  it('returns only u<v entries, in ascending order, matching the dense matrix', () => {
    for (const lambda of FIXED_LAMBDAS) {
      for (const [name, q] of [
        ['unconstrained', qAt(lambda)],
        ['constrained', constrainedAt(lambda)],
      ] as const) {
        const entries = quadraticEntries(q);
        const where = `${name} lambda=${lambda}`;
        let minGap = Infinity;
        let outOfOrder = 0;
        let mismatched = 0;
        let previous = -1;
        for (const e of entries) {
          minGap = Math.min(minGap, e.v - e.u);
          const flatIdx = e.u * BINARY_VARIABLES + e.v;
          if (flatIdx <= previous) outOfOrder += 1;
          previous = flatIdx;
          if (q.quadratic[quadIndex(e.u, e.v)] !== e.value) mismatched += 1;
        }
        expect(minGap, where).toBeGreaterThan(0);
        expect(outOfOrder, where).toBe(0);
        expect(mismatched, where).toBe(0);
        expect(entries.length, where).toBe(nonZeroUpperCount(q));
      }
    }
  });

  it('absolute values sum to coefficientMass().quadratic', () => {
    for (const lambda of FIXED_LAMBDAS) {
      for (const q of [qAt(lambda), constrainedAt(lambda)]) {
        let sum = 0;
        for (const e of quadraticEntries(q)) sum += Math.abs(e.value);
        const mass = coefficientMass(q).quadratic;
        expect(Math.abs(sum - mass), `lambda=${lambda}`).toBeLessThanOrEqual(
          1e-12 * mass,
        );
      }
    }
  });

  it('leaves the lower triangle and the diagonal untouched', () => {
    for (const lambda of FIXED_LAMBDAS) {
      for (const q of [qAt(lambda), constrainedAt(lambda)]) {
        let stray = 0;
        for (let u = 0; u < BINARY_VARIABLES; u += 1) {
          for (let v = 0; v <= u; v += 1) {
            if (q.quadratic[u * BINARY_VARIABLES + v] !== 0) stray += 1;
          }
        }
        expect(stray, `lambda=${lambda}`).toBe(0);
      }
    }
  });

  it('couples only different positions, while the constraint couples only within one', () => {
    for (const lambda of FIXED_LAMBDAS) {
      const q = qAt(lambda);
      const c = constrainedAt(lambda);
      const p = safePenalty(q);
      const sameBlock = (e: { u: number; v: number }) =>
        Math.floor(e.u / ALPHABET_SIZE) === Math.floor(e.v / ALPHABET_SIZE);

      expect(quadraticEntries(q).filter(sameBlock).length, `lambda=${lambda}`).toBe(0);
      // 28 position pairs x 36 class pairs is the ceiling for the objective.
      expect(quadraticEntries(q).length, `lambda=${lambda}`).toBeLessThanOrEqual(
        PAIR_COUNT * ALPHABET_SIZE * ALPHABET_SIZE,
      );
      // The constraint adds one entry per within-position class pair.
      const added = LENGTH * ((ALPHABET_SIZE * (ALPHABET_SIZE - 1)) / 2);
      expect(
        quadraticEntries(c).length - quadraticEntries(q).length,
        `lambda=${lambda}`,
      ).toBe(added);
      const within = quadraticEntries(c).filter(sameBlock);
      expect(within.length, `lambda=${lambda}`).toBe(added);
      let worst = 0;
      for (const e of within) worst = Math.max(worst, Math.abs(e.value - 2 * p));
      expect(worst, `lambda=${lambda}`).toBe(0);
    }
  });

  it('epsilon filtering only ever drops entries', () => {
    for (const lambda of FIXED_LAMBDAS) {
      const q = qAt(lambda);
      const all = quadraticEntries(q);
      for (const epsilon of [1e-9, 0.5, 5]) {
        const kept = quadraticEntries(q, epsilon);
        expect(kept.length, `lambda=${lambda} eps=${epsilon}`).toBeLessThanOrEqual(
          all.length,
        );
        expect(
          kept.every((e) => Math.abs(e.value) > epsilon),
          `lambda=${lambda} eps=${epsilon}`,
        ).toBe(true);
      }
      expect(quadraticEntries(q, Number.MAX_VALUE).length, `lambda=${lambda}`).toBe(0);
    }
  });
});

/* =================================================================== *
 * 7. Ising equivalence - an independent re-derivation of the energy.
 * =================================================================== */

describe('QUBO to Ising equivalence', () => {
  for (const lambda of [0, 0.5, 1, 2, 5]) {
    it(`agrees on valid sequences at lambda=${lambda}, constrained and not`, () => {
      const q = qAt(lambda);
      const c = constrainedAt(lambda);
      const iq = quboToIsing(q);
      const ic = quboToIsing(c);
      for (const codes of SEQUENCES.slice(0, 20)) {
        const x = encode(codes);
        const s = binaryToSpins(x);
        const where = `${classSequence(codes)} @ lambda=${lambda}`;

        // Unconstrained coefficients are O(1e3); float64 clears a flat 1e-8.
        expect(
          Math.abs(isingEnergy(s, iq) - quboEnergy(x, q)),
          `unconstrained ${where}`,
        ).toBeLessThan(1e-8);

        // The constrained form carries the ~1e4..7e4 penalty scale through h
        // and the constant, so the identity holds to float64 relative
        // precision rather than to a flat absolute bound. Measured residues
        // are ~1e-9..1e-8 at energies of ~1e6, i.e. ~1e-15 relative.
        const e = quboEnergy(x, c);
        expect(Math.abs(isingEnergy(s, ic) - e), `constrained ${where}`).toBeLessThan(
          1e-8 + 1e-12 * Math.abs(e),
        );
      }
    });

    it(`agrees on arbitrary binary vectors at lambda=${lambda}`, () => {
      const q = qAt(lambda);
      const c = constrainedAt(lambda);
      const iq = quboToIsing(q);
      const ic = quboToIsing(c);
      const vectors = [...RANDOM_BITS, ALL_ON.x, ALL_OFF.x];
      for (const x of vectors) {
        const s = binaryToSpins(x);
        let on = 0;
        for (let i = 0; i < x.length; i += 1) on += x[i];
        const where = `density=${on}/48 @ lambda=${lambda}`;
        const eq = quboEnergy(x, q);
        const ec = quboEnergy(x, c);
        expect(
          Math.abs(isingEnergy(s, iq) - eq),
          `unconstrained ${where}`,
        ).toBeLessThan(1e-8 + 1e-12 * Math.abs(eq));
        expect(Math.abs(isingEnergy(s, ic) - ec), `constrained ${where}`).toBeLessThan(
          1e-8 + 1e-12 * Math.abs(ec),
        );
      }
      // Most of those vectors are infeasible - that is what makes this an
      // independent check rather than a restatement of the one-hot case.
      expect(vectors.filter((x) => !isValidOneHot(x)).length).toBeGreaterThan(20);
    });
  }

  it('builds h, J and the constant from the documented formulas', () => {
    for (const lambda of [0, 1, 5]) {
      for (const q of [qAt(lambda), constrainedAt(lambda)]) {
        const ising = quboToIsing(q);
        let worstJ = 0;
        let constant = q.offset;
        const h = new Float64Array(BINARY_VARIABLES);
        for (let i = 0; i < BINARY_VARIABLES; i += 1) {
          h[i] += q.linear[i] / 2;
          constant += q.linear[i] / 2;
        }
        for (let u = 0; u < BINARY_VARIABLES; u += 1) {
          for (let v = u + 1; v < BINARY_VARIABLES; v += 1) {
            const w = q.quadratic[u * BINARY_VARIABLES + v];
            worstJ = Math.max(
              worstJ,
              Math.abs(ising.J[u * BINARY_VARIABLES + v] - w / 4),
            );
            h[u] += w / 4;
            h[v] += w / 4;
            constant += w / 4;
          }
        }
        let worstH = 0;
        for (let i = 0; i < BINARY_VARIABLES; i += 1) {
          worstH = Math.max(worstH, Math.abs(ising.h[i] - h[i]));
        }
        expect(worstJ, `lambda=${lambda}`).toBe(0);
        expect(worstH, `lambda=${lambda}`).toBeLessThan(1e-9);
        expect(Math.abs(ising.constant - constant), `lambda=${lambda}`).toBeLessThan(
          1e-9 + 1e-12 * Math.abs(constant),
        );
        // J is stored upper-triangular only.
        let strayJ = 0;
        for (let u = 0; u < BINARY_VARIABLES; u += 1) {
          for (let v = 0; v <= u; v += 1) {
            if (ising.J[u * BINARY_VARIABLES + v] !== 0) strayJ += 1;
          }
        }
        expect(strayJ, `lambda=${lambda}`).toBe(0);
      }
    }
  });

  it('binaryToSpins is the x -> 2x-1 map and nothing else', () => {
    for (const x of [...RANDOM_BITS, ALL_ON.x, ALL_OFF.x]) {
      const s = binaryToSpins(x);
      expect(s.length).toBe(x.length);
      let bad = 0;
      for (let i = 0; i < x.length; i += 1) if (s[i] !== 2 * x[i] - 1) bad += 1;
      expect(bad).toBe(0);
    }
  });
});

/* =================================================================== *
 * 8. lambda = 0 is the pure PET problem, with the sign flipped.
 * =================================================================== */

describe('lambda = 0 is the negated PET-only QUBO', () => {
  it('has linear coefficients exactly equal to -PET linear coefficients', () => {
    const q = qAt(0);
    for (let i = 0; i < BINARY_VARIABLES; i += 1) {
      // Written as a sum so a signed zero cannot masquerade as a mismatch.
      expect(q.linear[i] + flat[TARGET].linear[i], `variable ${i}`).toBe(0);
    }
  });

  it('has quadratic coefficients exactly equal to -PET pair coefficients', () => {
    const q = qAt(0);
    let worst = 0;
    let checked = 0;
    for (let k = 0; k < PAIR_COUNT; k += 1) {
      const [i, j] = PAIR_ORDER[k];
      for (let a = 0; a < ALPHABET_SIZE; a += 1) {
        for (let b = 0; b < ALPHABET_SIZE; b += 1) {
          const u = variableIndex(i, a);
          const v = variableIndex(j, b);
          const got = q.quadratic[quadIndex(u, v)];
          const want = flat[TARGET].pair[k * 36 + a * ALPHABET_SIZE + b];
          worst = Math.max(worst, Math.abs(got + want));
          checked += 1;
          // Spot-check a deterministic spread exactly, not just in aggregate.
          if (checked % 17 === 0) {
            expect(got + want, `pair ${k} classes ${a},${b}`).toBe(0);
          }
        }
      }
    }
    expect(checked).toBe(PAIR_COUNT * ALPHABET_SIZE * ALPHABET_SIZE);
    expect(worst).toBe(0);
  });

  it('scores every sampled sequence as exactly minus its PET score', () => {
    const q = qAt(0);
    for (const codes of SEQUENCES) {
      const scores = scoreAll(codes, flat);
      expect(
        Math.abs(quboEnergyOfCodes(codes, q) + scores.PET),
        classSequence(codes),
      ).toBeLessThan(QUBO_TOLERANCE);
    }
  });

  it('ignores PE and PP entirely at lambda = 0', () => {
    const q = qAt(0);
    // The coefficient-level fact that makes it true: the mass of the lambda=0
    // QUBO is the PET mass alone, with no PE or PP contribution smuggled in.
    let petLinear = 0;
    for (let i = 0; i < BINARY_VARIABLES; i += 1) {
      petLinear += Math.abs(flat[TARGET].linear[i]);
    }
    let petPair = 0;
    for (let i = 0; i < flat[TARGET].pair.length; i += 1) {
      petPair += Math.abs(flat[TARGET].pair[i]);
    }
    const mass = coefficientMass(q);
    expect(Math.abs(mass.linear - petLinear)).toBeLessThan(1e-12 * petLinear);
    expect(Math.abs(mass.quadratic - petPair)).toBeLessThan(1e-12 * petPair);
  });
});
