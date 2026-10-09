/**
 * PARITY GATE. The browser scorer must agree with the Python scientific core.
 *
 * Everything the website claims rests on this file. If it fails, the site is
 * showing numbers the published benchmark does not support, and that is a
 * correctness bug, not a cosmetic one.
 */
import { describe, expect, it } from 'vitest';

import {
  CLASSES,
  classSequence,
  decode,
  encode,
  isValidOneHot,
  representativeSequence,
  variableIndex,
} from '../../src/science/alphabet';
import { candidateMetrics } from '../../src/science/objective';
import { objective as objectiveOf } from '../../src/science/objective';
import { contributions, scoreAll, scoreCodes } from '../../src/science/potts';
import {
  addOneHotConstraint,
  combineObjective,
  quboEnergyOfCodes,
  safePenalty,
} from '../../src/science/qubo';
import { EXACT_TOLERANCE, golden, realModel } from '../helpers/model';

const model = realModel();
const g = golden();

/**
 * Python writes float dict keys as "1.0"; JS `String(1.0)` gives "1". Resolve
 * either spelling so a key-format difference cannot masquerade as a science
 * failure (and fail loudly if the key genuinely is not there).
 */
function goldenObjective(c: (typeof g.cases)[number], lambda: number): number {
  const value = c.objectives[String(lambda)] ?? c.objectives[lambda.toFixed(1)];
  if (value === undefined) {
    throw new Error(`golden fixture has no objective for lambda=${lambda}`);
  }
  return value;
}

describe('exported coefficient file', () => {
  it('declares the schema, source and orientation the app relies on', () => {
    expect(model.meta.schema).toBe('qbind-potts-6class-8mer/1');
    expect(model.meta.source).toContain('QA-PBP-RL-Nexus');
    expect(model.meta.orientation).toContain('higher');
  });

  it('carries a golden fixture built from the exact model, not the surrogate', () => {
    expect(g.generated_by).toContain('exact Potts model');
    expect(g.cases.length).toBeGreaterThanOrEqual(390);
  });
});

describe('per-sequence score parity with Python', () => {
  it.each(['PET', 'PE', 'PP'] as const)(
    '%s scores match Python exactly for every golden case',
    (plastic) => {
      let worst = 0;
      let worstCase = '';
      for (const c of g.cases) {
        const got = scoreCodes(c.codes, model.flat[plastic]);
        const err = Math.abs(got - c.scores[plastic]);
        if (err > worst) {
          worst = err;
          worstCase = c.classSequence;
        }
      }
      expect(worst, `worst case: ${worstCase}`).toBeLessThan(EXACT_TOLERANCE);
    },
  );

  it('class sequence and representative strings match Python', () => {
    for (const c of g.cases) {
      expect(classSequence(c.codes)).toBe(c.classSequence);
      expect(representativeSequence(c.codes)).toBe(c.representative);
    }
  });

  it('contribution breakdown sums exactly to the total score', () => {
    for (const c of g.cases) {
      for (const plastic of ['PET', 'PE', 'PP'] as const) {
        const parts = contributions(c.codes, model.flat[plastic]);
        expect(Math.abs(parts.total - c.scores[plastic])).toBeLessThan(EXACT_TOLERANCE);
        const summed =
          parts.intercept +
          parts.positions.reduce((a, b) => a + b, 0) +
          parts.pairs.reduce((a, b) => a + b, 0);
        expect(Math.abs(summed - parts.total)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('objective parity with Python', () => {
  for (const lambda of [0.0, 0.5, 1.0, 2.0, 5.0]) {
    it(`objective matches Python at lambda=${lambda} for every golden case`, () => {
      let worst = 0;
      for (const c of g.cases) {
        const got = objectiveOf(scoreAll(c.codes, model.flat), lambda);
        worst = Math.max(worst, Math.abs(got - goldenObjective(c, lambda)));
      }
      expect(worst).toBeLessThan(EXACT_TOLERANCE);
    });
  }
});

describe('candidate metrics parity with Python', () => {
  it('reproduces every metric and the warning label string', () => {
    for (const c of g.cases) {
      const scores = scoreAll(c.codes, model.flat);
      const m = candidateMetrics(c.codes, scores);
      const e = c.metrics;
      expect(Math.abs(m.meanOffTarget - e.meanOffTarget)).toBeLessThan(EXACT_TOLERANCE);
      expect(Math.abs(m.worstOffTarget - e.worstOffTarget)).toBeLessThan(EXACT_TOLERANCE);
      expect(Math.abs(m.marginMean - e.marginMean)).toBeLessThan(EXACT_TOLERANCE);
      expect(Math.abs(m.marginWorst - e.marginWorst)).toBeLessThan(EXACT_TOLERANCE);
      expect(m.aromaticFraction).toBeCloseTo(e.aromaticFraction, 12);
      expect(m.hydrophobicFraction).toBeCloseTo(e.hydrophobicFraction, 12);
      expect(m.polarFraction).toBeCloseTo(e.polarFraction, 12);
      expect(m.netChargeClassBalance).toBeCloseTo(e.netChargeClassBalance, 12);
      expect(m.warnings, `labels for ${c.classSequence}`).toBe(e.warnings);
    }
  });
});

describe('QUBO parity with Python', () => {
  it('safePenalty matches the Python conservative bound at every lambda', () => {
    for (const [lambda, expected] of Object.entries(g.safePenalty)) {
      const q = combineObjective(model.flat, Number(lambda));
      const p = safePenalty(q);
      // Relative comparison: these are values in the 1e4 range.
      expect(Math.abs(p - expected) / expected).toBeLessThan(1e-12);
    }
  });

  it('unconstrained QUBO energy equals the objective for valid sequences', () => {
    for (const lambda of [0.0, 0.5, 1.0, 2.0, 5.0]) {
      const q = combineObjective(model.flat, lambda);
      for (const c of g.cases.slice(0, 60)) {
        const viaQubo = quboEnergyOfCodes(c.codes, q);
        const viaScores = objectiveOf(scoreAll(c.codes, model.flat), lambda);
        expect(Math.abs(viaQubo - viaScores)).toBeLessThan(1e-9);
      }
    }
  });

  it('constrained QUBO energy is unchanged for valid sequences (penalty contributes zero)', () => {
    for (const lambda of [0.0, 1.0, 5.0]) {
      const q = combineObjective(model.flat, lambda);
      const p = safePenalty(q);
      const constrained = addOneHotConstraint(q, p);
      for (const c of g.cases.slice(0, 40)) {
        const plain = quboEnergyOfCodes(c.codes, q);
        const withPenalty = quboEnergyOfCodes(c.codes, constrained);
        // Penalty terms are ~1e4 and cancel exactly in exact arithmetic; in
        // float64 the cancellation leaves a relative residue near 1e-16 * P.
        expect(Math.abs(withPenalty - plain)).toBeLessThan(1e-8);
      }
    }
  });

  it('one-hot violations are penalised by at least P', () => {
    const lambda = 1.0;
    const q = combineObjective(model.flat, lambda);
    const p = safePenalty(q);
    const constrained = addOneHotConstraint(q, p);
    const valid = encode(g.cases[0].codes);
    const validEnergy = quboEnergyOfCodes(g.cases[0].codes, constrained);

    // Turn on a second class at position 0: now two bits in that position.
    const broken = Uint8Array.from(valid);
    broken[variableIndex(0, (g.cases[0].codes[0] + 1) % 6)] = 1;
    expect(isValidOneHot(broken)).toBe(false);

    let e = constrained.offset;
    for (let i = 0; i < 48; i += 1) if (broken[i]) e += constrained.linear[i];
    for (let u = 0; u < 48; u += 1) {
      if (!broken[u]) continue;
      for (let v = u + 1; v < 48; v += 1) {
        if (broken[v]) e += constrained.quadratic[u * 48 + v];
      }
    }
    // The penalty bound is designed to exceed the whole objective range, so an
    // invalid assignment can never beat a valid one.
    expect(e).toBeGreaterThan(validEnergy);
  });
});

describe('encoding invariants', () => {
  it('encode/decode round-trips every golden case', () => {
    for (const c of g.cases) {
      const x = encode(c.codes);
      expect(x.length).toBe(48);
      expect(x.reduce((a, b) => a + b, 0)).toBe(8);
      expect(isValidOneHot(x)).toBe(true);
      expect(decode(x)).toEqual(c.codes);
    }
  });

  it('variableIndex covers 0..47 exactly once', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 8; i += 1) {
      for (let a = 0; a < CLASSES.length; a += 1) seen.add(variableIndex(i, a));
    }
    expect(seen.size).toBe(48);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(47);
  });
});
