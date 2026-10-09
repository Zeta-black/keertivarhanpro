/**
 * PROPERTY GATE for the exact Potts scorer and the candidate metrics.
 *
 * `parity.test.ts` proves the browser scorer agrees with the Python core on the
 * 398 recorded golden cases. This file proves the STRUCTURAL identities that
 * must hold on every input, not only on the recorded ones:
 *
 *   - the explanation breakdown adds up to the number it explains,
 *   - a single-position edit moves the score by exactly the amount the locality
 *     argument predicts (independent-oracle check),
 *   - the metric and warning definitions are the definitions the UI copy claims,
 *   - the objective really is linear in the selectivity weight lambda.
 *
 * INDEPENDENT ORACLES. Wherever an expected value exists, it is recomputed from
 * the raw exported JSON (`public/model/potts_6class_8mer.json`, nested arrays)
 * rather than from the flattened Float64Array the production code indexes. A
 * flattening or index-arithmetic bug therefore cannot hide behind itself.
 *
 * NUMERIC TOLERANCES. Measured, not guessed: over 4,000 random sequences x 3
 * plastics the worst |contributions.total - scoreCodes| was 1.28e-13 and the
 * worst locality-delta residue was 1.21e-13, so 1e-12 is a real bound with one
 * decimal order of headroom. The nested-array score oracle accumulates in the
 * identical order as `scoreCodes`, so it agrees BIT FOR BIT (measured error
 * exactly 0) and is asserted with Object.is.
 *
 * All randomness comes from `makeRng(seed)` with fixed seeds, so any failure
 * reproduces exactly.
 */
import { afterAll, describe, expect, it } from 'vitest';

import {
  CLASSES,
  LENGTH,
  PAIR_COUNT,
  PAIR_ORDER,
  classSequence,
  codesToIndex,
  parseClassSequence,
  type Codes,
} from '../../src/science/alphabet';
import {
  candidateMetrics,
  classFractions,
  objective,
  objectiveParts,
  worstOffTargetName,
  type CandidateLabel,
} from '../../src/science/objective';
import {
  PLASTICS,
  contributions,
  scoreAll,
  scoreCodes,
  scoreStats,
  type Plastic,
} from '../../src/science/potts';
import { makeRng } from '../../src/science/rng';
import { PUBLISHED_OPTIMA, modelJson, realModel } from '../helpers/model';

const model = realModel();
const json = modelJson();

/** Measured float64 accumulation bound for 36-term sums of ~1e2 magnitudes. */
const SUM_TOLERANCE = 1e-12;
/** Slacker bound for quantities divided by a lambda step, which amplifies the residue. */
const SLOPE_TOLERANCE = 1e-9;

/**
 * expect() wrapper that counts executed assertions, so this file can report an
 * honest total instead of an estimated one. Set REPORT_ASSERTIONS=1 to print it.
 */
let executedAssertions = 0;
function check<T>(actual: T, message?: string) {
  executedAssertions += 1;
  return expect(actual, message);
}

afterAll(() => {
  if (process.env.REPORT_ASSERTIONS) {
    console.log(`[scoring.property] executed assertions: ${executedAssertions}`);
  }
});

// --------------------------------------------------------------------------
// Fixtures and independent oracles
// --------------------------------------------------------------------------

const AROM_W = CLASSES.indexOf('AROM_W');
const AROM_FY = CLASSES.indexOf('AROM_FY');
const HYDROPHOBIC = CLASSES.indexOf('HYDROPHOBIC');
const SMALL_POLAR = CLASSES.indexOf('SMALL_POLAR');
const CHARGED_NEG = CLASSES.indexOf('CHARGED_NEG');
const CHARGED_POS = CLASSES.indexOf('CHARGED_POS');

/** Pair indices (into PAIR_ORDER) that involve a given position. */
const PAIRS_TOUCHING: readonly number[][] = Array.from({ length: LENGTH }, (_unused, p) =>
  PAIR_ORDER.flatMap(([i, j], k) => (i === p || j === p ? [k] : [])),
);

function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function countOf(codes: Codes, classIndex: number): number {
  let n = 0;
  for (const c of codes) if (c === classIndex) n += 1;
  return n;
}

/** `count` distinct sequences from a fixed seed, so no work is wasted on repeats. */
function distinctSequences(seed: number, count: number): number[][] {
  const rng = makeRng(seed);
  const seen = new Set<number>();
  const out: number[][] = [];
  for (let guard = 0; guard < count * 500 && out.length < count; guard += 1) {
    const codes = Array.from({ length: LENGTH }, () => rng.int(CLASSES.length));
    const index = codesToIndex(codes);
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(codes);
  }
  if (out.length !== count) throw new Error(`could not draw ${count} distinct sequences`);
  return out;
}

/** The six single-class sequences - the corners of the design space. */
const UNIFORM_SEQUENCES: number[][] = CLASSES.map((_unused, a) =>
  new Array<number>(LENGTH).fill(a),
);

/** The five published sweep optima, as class codes. */
const PUBLISHED_SEQUENCES: number[][] = Object.values(PUBLISHED_OPTIMA).map((o) =>
  parseClassSequence(o.classSequence),
);

/** Sequence built from explicit class counts, padded out with `filler`. */
function composed(parts: ReadonlyArray<readonly [number, number]>, filler: number): number[] {
  const codes: number[] = [];
  for (const [cls, n] of parts) for (let i = 0; i < n; i += 1) codes.push(cls);
  if (codes.length > LENGTH) throw new Error('composed sequence is longer than 8');
  while (codes.length < LENGTH) codes.push(filler);
  return codes;
}

/**
 * Score recomputed from the nested exported arrays. Deliberately shares no
 * index arithmetic with `scoreCodes`.
 */
function oracleScore(codes: Codes, plastic: Plastic): number {
  let s = json.intercept;
  for (let i = 0; i < LENGTH; i += 1) s += json[plastic].linear[i][codes[i]];
  for (let k = 0; k < PAIR_COUNT; k += 1) {
    const [i, j] = PAIR_ORDER[k];
    s += json[plastic].pair[k][codes[i]][codes[j]];
  }
  return s;
}

/**
 * Change at `position` to `newClass`: the one-body difference plus the
 * differences of the 7 pair terms that touch that position. Every other term in
 * the 36-term sum is untouched, so this is the whole delta.
 */
function oracleLocalDelta(
  codes: Codes,
  position: number,
  newClass: number,
  plastic: Plastic,
): number {
  const linear = json[plastic].linear;
  const pair = json[plastic].pair;
  const oldClass = codes[position];
  let delta = linear[position][newClass] - linear[position][oldClass];
  for (const k of PAIRS_TOUCHING[position]) {
    const [i, j] = PAIR_ORDER[k];
    const oldA = codes[i];
    const oldB = codes[j];
    const newA = i === position ? newClass : oldA;
    const newB = j === position ? newClass : oldB;
    delta += pair[k][newA][newB] - pair[k][oldA][oldB];
  }
  return delta;
}

interface StatsOracle {
  readonly mean: number;
  readonly std: number;
  readonly min: number;
  readonly max: number;
}

/** Population mean/std/min/max, computed with plain array reductions. */
function oracleStats(values: readonly number[]): StatsOracle {
  const mean = sum(values) / values.length;
  let sq = 0;
  for (const v of values) sq += (v - mean) * (v - mean);
  return {
    mean,
    std: Math.sqrt(sq / values.length),
    min: values.reduce((a, b) => (b < a ? b : a), Infinity),
    max: values.reduce((a, b) => (b > a ? b : a), -Infinity),
  };
}

// --------------------------------------------------------------------------
// 1. contributions(): the breakdown adds up to the number it explains
// --------------------------------------------------------------------------

const CONTRIBUTION_SEQUENCES = distinctSequences(0x5c01, 20);
const ORACLE_SEQUENCES = distinctSequences(0x5c02, 2);

describe('contributions: the breakdown adds up to the score it explains', () => {
  it('parts sum to scoreCodes within 1e-12, for every plastic', () => {
    for (const codes of CONTRIBUTION_SEQUENCES) {
      for (const plastic of PLASTICS) {
        const coeff = model.flat[plastic];
        const exact = scoreCodes(codes, coeff);
        const parts = contributions(codes, coeff);
        const where = `${classSequence(codes)} / ${plastic}`;

        check(parts.positions.length, `${where}: one entry per position`).toBe(8);
        check(parts.pairs.length, `${where}: one entry per position pair`).toBe(28);
        // The exported model carries no intercept; the UI shows the two sums only.
        check(parts.intercept, `${where}: intercept`).toBe(0);
        const summed = parts.intercept + sum(parts.positions) + sum(parts.pairs);
        check(
          Math.abs(summed - exact),
          `${where}: re-summed parts ${summed} vs scoreCodes ${exact}`,
        ).toBeLessThan(SUM_TOLERANCE);
        check(Math.abs(parts.total - exact), `${where}: reported total`).toBeLessThan(
          SUM_TOLERANCE,
        );
        check(
          Math.abs(parts.linearTotal - sum(parts.positions)),
          `${where}: linearTotal`,
        ).toBeLessThan(SUM_TOLERANCE);
        check(Math.abs(parts.pairTotal - sum(parts.pairs)), `${where}: pairTotal`).toBeLessThan(
          SUM_TOLERANCE,
        );
      }
    }
  });

  it('every position and pair entry is the coefficient the exported JSON holds', () => {
    for (const codes of ORACLE_SEQUENCES) {
      for (const plastic of PLASTICS) {
        const parts = contributions(codes, model.flat[plastic]);
        for (let i = 0; i < LENGTH; i += 1) {
          check(
            parts.positions[i],
            `${plastic} one-body at position ${i}, class ${CLASSES[codes[i]]}`,
          ).toBe(json[plastic].linear[i][codes[i]]);
        }
        for (let k = 0; k < PAIR_COUNT; k += 1) {
          const [i, j] = PAIR_ORDER[k];
          check(parts.pairs[k], `${plastic} pair ${i}-${j} (PAIR_ORDER index ${k})`).toBe(
            json[plastic].pair[k][codes[i]][codes[j]],
          );
        }
      }
    }
  });

  it('scoreCodes equals the nested-array oracle bit for bit', () => {
    for (const codes of CONTRIBUTION_SEQUENCES) {
      for (const plastic of PLASTICS) {
        const flat = scoreCodes(codes, model.flat[plastic]);
        const nested = oracleScore(codes, plastic);
        check(
          Object.is(flat, nested),
          `${classSequence(codes)} / ${plastic}: flat ${flat} vs nested ${nested}`,
        ).toBe(true);
      }
    }
  });
});

// --------------------------------------------------------------------------
// 2. Determinism
// --------------------------------------------------------------------------

const DETERMINISM_SEQUENCES = distinctSequences(0x5c03, 30);

describe('determinism', () => {
  it('scoring the same sequence twice gives bit-identical results', () => {
    for (const codes of DETERMINISM_SEQUENCES) {
      for (const plastic of PLASTICS) {
        const coeff = model.flat[plastic];
        const first = scoreCodes(codes, coeff);
        const second = scoreCodes(codes, coeff);
        check(
          Object.is(first, second),
          `${classSequence(codes)} / ${plastic}: ${first} then ${second}`,
        ).toBe(true);
        check(contributions(codes, coeff), `${classSequence(codes)} / ${plastic}`).toEqual(
          contributions(codes, coeff),
        );
      }
    }
  });

  it('an equal-but-distinct codes array scores bit-identically', () => {
    for (const codes of DETERMINISM_SEQUENCES) {
      const copy = Array.from(codes);
      const frozen = Object.freeze(Array.from(codes)) as readonly number[];
      const base = scoreAll(codes, model.flat);
      const fromCopy = scoreAll(copy, model.flat);
      const fromFrozen = scoreAll(frozen, model.flat);
      for (const plastic of PLASTICS) {
        check(
          Object.is(base[plastic], fromCopy[plastic]),
          `${classSequence(codes)} / ${plastic}: array copy`,
        ).toBe(true);
        check(
          Object.is(base[plastic], fromFrozen[plastic]),
          `${classSequence(codes)} / ${plastic}: frozen readonly array`,
        ).toBe(true);
      }
    }
  });

  it('scoring never mutates the codes it was handed', () => {
    for (const codes of DETERMINISM_SEQUENCES) {
      const before = Array.from(codes);
      const scores = scoreAll(codes, model.flat);
      contributions(codes, model.flat.PET);
      candidateMetrics(codes, scores);
      classFractions(codes);
      check(codes, `${classSequence(before)} must be unchanged`).toEqual(before);
    }
  });
});

// --------------------------------------------------------------------------
// 3. Locality: one edit moves the score by exactly the local delta
// --------------------------------------------------------------------------

const LOCALITY_BASES = distinctSequences(0x5c04, 3);

describe('locality: a one-position edit moves the score by exactly the local delta', () => {
  it('each position is touched by exactly 7 of the 28 pairs', () => {
    let touches = 0;
    for (let p = 0; p < LENGTH; p += 1) {
      check(PAIRS_TOUCHING[p].length, `position ${p} pair count`).toBe(7);
      touches += PAIRS_TOUCHING[p].length;
    }
    // Each unordered pair is counted once from each of its two endpoints.
    check(touches, 'total endpoint incidences').toBe(56);
    check(touches / 2, 'distinct pairs').toBe(PAIR_COUNT);
  });

  it('the full-score difference equals the independently computed local delta', () => {
    for (const base of LOCALITY_BASES) {
      for (let position = 0; position < LENGTH; position += 1) {
        for (let step = 1; step < CLASSES.length; step += 1) {
          const newClass = (base[position] + step) % CLASSES.length;
          const mutated = base.slice();
          mutated[position] = newClass;
          for (const plastic of PLASTICS) {
            const coeff = model.flat[plastic];
            const measured = scoreCodes(mutated, coeff) - scoreCodes(base, coeff);
            const predicted = oracleLocalDelta(base, position, newClass, plastic);
            check(
              Math.abs(measured - predicted),
              `${classSequence(base)} / ${plastic}: position ${position} ` +
                `${CLASSES[base[position]]}->${CLASSES[newClass]}, ` +
                `measured ${measured} vs local ${predicted}`,
            ).toBeLessThan(SUM_TOLERANCE);
          }
        }
      }
    }
  });

  it('the local delta is antisymmetric: delta(a->b) = -delta(b->a)', () => {
    for (const base of LOCALITY_BASES.slice(0, 2)) {
      for (let position = 0; position < LENGTH; position += 1) {
        for (let step = 1; step <= 2; step += 1) {
          const newClass = (base[position] + step) % CLASSES.length;
          const mutated = base.slice();
          mutated[position] = newClass;
          for (const plastic of PLASTICS) {
            const forward = oracleLocalDelta(base, position, newClass, plastic);
            const backward = oracleLocalDelta(mutated, position, base[position], plastic);
            check(
              Math.abs(forward + backward),
              `${classSequence(base)} / ${plastic}: position ${position} round trip`,
            ).toBeLessThan(SUM_TOLERANCE);
          }
        }
      }
    }
  });

  it('terms that do not involve the edited position are untouched', () => {
    const base = LOCALITY_BASES[0];
    const before = contributions(base, model.flat.PET);
    for (let position = 0; position < 4; position += 1) {
      const newClass = (base[position] + 3) % CLASSES.length;
      const mutated = base.slice();
      mutated[position] = newClass;
      const after = contributions(mutated, model.flat.PET);
      for (let i = 0; i < LENGTH; i += 1) {
        if (i === position) continue;
        check(after.positions[i], `edit at ${position}: one-body ${i} unchanged`).toBe(
          before.positions[i],
        );
      }
      for (let k = 0; k < PAIR_COUNT; k += 1) {
        const [i, j] = PAIR_ORDER[k];
        if (i === position || j === position) continue;
        check(after.pairs[k], `edit at ${position}: pair ${i}-${j} unchanged`).toBe(
          before.pairs[k],
        );
      }
    }
  });
});

// --------------------------------------------------------------------------
// 4. candidateMetrics: the four definitions
// --------------------------------------------------------------------------

const METRIC_SEQUENCES = [
  ...distinctSequences(0x5c05, 30),
  ...UNIFORM_SEQUENCES,
  ...PUBLISHED_SEQUENCES,
];

describe('candidateMetrics definitions', () => {
  it('reproduces the four definitions and keeps marginWorst <= marginMean', () => {
    for (const codes of METRIC_SEQUENCES) {
      const s = scoreAll(codes, model.flat);
      const m = candidateMetrics(codes, s);
      const where = classSequence(codes);

      check(m.meanOffTarget, `${where}: meanOffTarget = (PE+PP)/2`).toBe((s.PE + s.PP) / 2);
      check(m.worstOffTarget, `${where}: worstOffTarget = max(PE,PP)`).toBe(
        Math.max(s.PE, s.PP),
      );
      check(m.marginMean, `${where}: marginMean = PET - meanOffTarget`).toBe(
        s.PET - (s.PE + s.PP) / 2,
      );
      check(m.marginWorst, `${where}: marginWorst = PET - worstOffTarget`).toBe(
        s.PET - Math.max(s.PE, s.PP),
      );
      // The worst case can never look better than the average case.
      check(m.marginWorst, `${where}: marginWorst <= marginMean`).toBeLessThanOrEqual(
        m.marginMean,
      );
      check(worstOffTargetName(s), `${where}: worst off-target name`).toBe(
        s.PE >= s.PP ? 'PE' : 'PP',
      );
      check(m.worstOffTarget, `${where}: the named worst off-target carries that score`).toBe(
        s[worstOffTargetName(s)],
      );
      // The mean of two numbers lies between them.
      check(
        m.meanOffTarget >= Math.min(s.PE, s.PP) && m.meanOffTarget <= m.worstOffTarget,
        `${where}: meanOffTarget ${m.meanOffTarget} between ${s.PE} and ${s.PP}`,
      ).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// 5. classFractions
// --------------------------------------------------------------------------

const FRACTION_SEQUENCES = [...distinctSequences(0x5c06, 14), ...UNIFORM_SEQUENCES];

describe('classFractions', () => {
  it('sums to exactly 1 and every entry is an exact multiple of 1/8', () => {
    for (const codes of FRACTION_SEQUENCES) {
      const f = classFractions(codes);
      const where = classSequence(codes);
      check(f.length, `${where}: one fraction per class`).toBe(CLASSES.length);
      // Eighths are exact in binary floating point, so this is a real equality.
      check(sum(f), `${where}: fractions sum to 1`).toBe(1);
      for (let a = 0; a < CLASSES.length; a += 1) {
        check(f[a], `${where}: ${CLASSES[a]} fraction`).toBe(countOf(codes, a) / LENGTH);
        check(
          Number.isInteger(f[a] * LENGTH),
          `${where}: ${CLASSES[a]} fraction ${f[a]} is a multiple of 1/8`,
        ).toBe(true);
      }
    }
  });

  it('the derived fractions in candidateMetrics are the documented sums', () => {
    for (const codes of FRACTION_SEQUENCES) {
      const f = classFractions(codes);
      const m = candidateMetrics(codes, scoreAll(codes, model.flat));
      const where = classSequence(codes);
      check(m.aromaticFraction, `${where}: aromatic = AROM_W + AROM_FY`).toBe(
        f[AROM_W] + f[AROM_FY],
      );
      check(m.hydrophobicFraction, `${where}: hydrophobic = HYDROPHOBIC`).toBe(f[HYDROPHOBIC]);
      check(m.polarFraction, `${where}: polar = SMALL_POLAR`).toBe(f[SMALL_POLAR]);
      check(m.netChargeClassBalance, `${where}: net charge = POS - NEG`).toBe(
        f[CHARGED_POS] - f[CHARGED_NEG],
      );
      check(
        m.aromaticFraction +
          m.hydrophobicFraction +
          m.polarFraction +
          f[CHARGED_NEG] +
          f[CHARGED_POS],
        `${where}: the reported groups cover all 8 positions`,
      ).toBe(1);
    }
  });
});

// --------------------------------------------------------------------------
// 6. Warning labels
// --------------------------------------------------------------------------

interface LabelCase {
  readonly codes: number[];
  /** Labels the composition alone forces to appear. */
  readonly must: readonly CandidateLabel[];
  /** Labels the composition alone forces to be absent. */
  readonly mustNot: readonly CandidateLabel[];
  readonly why: string;
}

const LABEL_CASES: readonly LabelCase[] = [
  {
    codes: composed([[HYDROPHOBIC, 8]], SMALL_POLAR),
    must: ['HIGH_HYDROPHOBICITY'],
    mustNot: ['HIGH_CHARGE', 'BALANCED'],
    why: '8/8 hydrophobic',
  },
  {
    codes: composed([[HYDROPHOBIC, 7]], SMALL_POLAR),
    must: ['HIGH_HYDROPHOBICITY'],
    mustNot: ['HIGH_CHARGE', 'BALANCED'],
    why: '7/8 hydrophobic',
  },
  {
    codes: composed([[HYDROPHOBIC, 6]], SMALL_POLAR),
    must: ['HIGH_HYDROPHOBICITY'],
    mustNot: ['HIGH_CHARGE', 'BALANCED'],
    why: '6/8 hydrophobic sits exactly on the 0.75 threshold',
  },
  {
    codes: composed(
      [
        [AROM_W, 1],
        [HYDROPHOBIC, 6],
      ],
      AROM_FY,
    ),
    must: ['HIGH_HYDROPHOBICITY'],
    mustNot: ['HIGH_CHARGE', 'BALANCED'],
    why: '6/8 hydrophobic, not starting at position 0, aromatic neighbours',
  },
  {
    codes: composed(
      [
        [HYDROPHOBIC, 6],
        [CHARGED_NEG, 2],
      ],
      SMALL_POLAR,
    ),
    must: ['HIGH_HYDROPHOBICITY'],
    mustNot: ['HIGH_CHARGE', 'BALANCED'],
    why: '6/8 hydrophobic with only 2/8 charged: hydrophobicity fires, charge does not',
  },
  {
    codes: composed([[HYDROPHOBIC, 5]], SMALL_POLAR),
    must: [],
    mustNot: ['HIGH_HYDROPHOBICITY'],
    why: '5/8 hydrophobic is 0.625, below the 0.75 threshold',
  },
  {
    codes: composed(
      [
        [HYDROPHOBIC, 5],
        [CHARGED_NEG, 3],
      ],
      SMALL_POLAR,
    ),
    must: [],
    mustNot: ['HIGH_HYDROPHOBICITY', 'HIGH_CHARGE'],
    why: '5/8 hydrophobic and 3/8 charged clears neither threshold',
  },
  {
    codes: composed([[CHARGED_NEG, 4]], SMALL_POLAR),
    must: ['HIGH_CHARGE'],
    mustNot: ['HIGH_HYDROPHOBICITY', 'BALANCED'],
    why: '4/8 charged sits exactly on the 0.5 threshold',
  },
  {
    codes: composed(
      [
        [CHARGED_NEG, 2],
        [CHARGED_POS, 2],
      ],
      SMALL_POLAR,
    ),
    must: ['HIGH_CHARGE'],
    mustNot: ['HIGH_HYDROPHOBICITY', 'BALANCED'],
    why: 'mixed sign still counts as 4/8 charged',
  },
  {
    codes: composed(
      [
        [CHARGED_POS, 5],
        [HYDROPHOBIC, 3],
      ],
      SMALL_POLAR,
    ),
    must: ['HIGH_CHARGE'],
    mustNot: ['HIGH_HYDROPHOBICITY', 'BALANCED'],
    why: '5/8 charged alongside 3/8 hydrophobic',
  },
  {
    codes: composed([[CHARGED_NEG, 3]], SMALL_POLAR),
    must: [],
    mustNot: ['HIGH_CHARGE'],
    why: '3/8 charged is 0.375, below the 0.5 threshold',
  },
  {
    codes: composed(
      [
        [CHARGED_NEG, 2],
        [CHARGED_POS, 1],
      ],
      AROM_W,
    ),
    must: [],
    mustNot: ['HIGH_CHARGE'],
    why: '3/8 mixed charge is below the threshold',
  },
];

/** The rule table restated from the documented thresholds, not from the source. */
function expectedLabels(codes: Codes, marginMean: number): CandidateLabel[] {
  const hydrophobic = countOf(codes, HYDROPHOBIC) / LENGTH;
  const charged = (countOf(codes, CHARGED_NEG) + countOf(codes, CHARGED_POS)) / LENGTH;
  const labels: CandidateLabel[] = [];
  if (hydrophobic >= 0.75) labels.push('HIGH_HYDROPHOBICITY');
  if (charged >= 0.5) labels.push('HIGH_CHARGE');
  if (marginMean <= 0) labels.push('LOW_SELECTIVITY');
  if (labels.length === 0) labels.push('BALANCED');
  return labels;
}

describe('warning labels', () => {
  it('fires on composition-forced cases and stays silent just below each threshold', () => {
    for (const c of LABEL_CASES) {
      const m = candidateMetrics(c.codes, scoreAll(c.codes, model.flat));
      const f = classFractions(c.codes);
      const where = `${classSequence(c.codes)} (${c.why})`;
      for (const label of c.must) {
        check(m.labels, `${where}: must carry ${label}`).toContain(label);
      }
      for (const label of c.mustNot) {
        check(m.labels, `${where}: must not carry ${label}`).not.toContain(label);
      }
      check(m.hydrophobicFraction, `${where}: hydrophobic fraction`).toBe(
        countOf(c.codes, HYDROPHOBIC) / LENGTH,
      );
      check(f[CHARGED_NEG] + f[CHARGED_POS], `${where}: charged fraction`).toBe(
        (countOf(c.codes, CHARGED_NEG) + countOf(c.codes, CHARGED_POS)) / LENGTH,
      );
      check(m.warnings, `${where}: warnings string is the labels joined by ';'`).toBe(
        m.labels.join(';'),
      );
    }
  });

  it('LOW_SELECTIVITY fires exactly when PET - meanOffTarget <= 0, and is reachable', () => {
    // All-CHARGED_POS scores higher for the off-targets than for PET in this
    // model, so it is a concrete, reproducible LOW_SELECTIVITY case.
    const unselective = composed([[CHARGED_POS, 8]], CHARGED_POS);
    const um = candidateMetrics(unselective, scoreAll(unselective, model.flat));
    check(um.marginMean, 'all-CHARGED_POS margin is not positive').toBeLessThanOrEqual(0);
    check(um.labels, 'all-CHARGED_POS must be flagged LOW_SELECTIVITY').toContain(
      'LOW_SELECTIVITY',
    );
    check(um.labels, 'all-CHARGED_POS is also 8/8 charged').toContain('HIGH_CHARGE');

    // All-AROM_W is selective in this model, so it must NOT be flagged.
    const selective = composed([[AROM_W, 8]], AROM_W);
    const sm = candidateMetrics(selective, scoreAll(selective, model.flat));
    check(sm.marginMean, 'all-AROM_W margin is positive').toBeGreaterThan(0);
    check(sm.labels, 'all-AROM_W must not be flagged LOW_SELECTIVITY').not.toContain(
      'LOW_SELECTIVITY',
    );
    check(sm.labels, 'all-AROM_W clears every threshold, so it is BALANCED alone').toEqual([
      'BALANCED',
    ]);
  });

  it('labels match the documented rules and BALANCED never shares the field', () => {
    const population = [
      ...distinctSequences(0x5c07, 30),
      ...UNIFORM_SEQUENCES,
      ...LABEL_CASES.map((c) => c.codes),
    ];
    const seen = new Set<CandidateLabel>();
    for (const codes of population) {
      const m = candidateMetrics(codes, scoreAll(codes, model.flat));
      const where = classSequence(codes);
      const hydrophobic = countOf(codes, HYDROPHOBIC) / LENGTH;
      const charged = (countOf(codes, CHARGED_NEG) + countOf(codes, CHARGED_POS)) / LENGTH;

      check(
        m.labels.includes('HIGH_HYDROPHOBICITY'),
        `${where}: hydrophobic ${hydrophobic} against the 0.75 threshold`,
      ).toBe(hydrophobic >= 0.75);
      check(
        m.labels.includes('HIGH_CHARGE'),
        `${where}: charged ${charged} against the 0.5 threshold`,
      ).toBe(charged >= 0.5);
      check(m.labels.includes('LOW_SELECTIVITY'), `${where}: marginMean ${m.marginMean}`).toBe(
        m.marginMean <= 0,
      );
      check(m.labels, `${where}: full label list`).toEqual(expectedLabels(codes, m.marginMean));
      check(
        m.labels.includes('BALANCED') && m.labels.length > 1,
        `${where}: BALANCED combined with ${m.warnings}`,
      ).toBe(false);
      check(m.labels.length, `${where}: at least one label always`).toBeGreaterThan(0);
      check(new Set(m.labels).size, `${where}: no duplicate labels`).toBe(m.labels.length);
      check(m.warnings, `${where}: warnings string`).toBe(m.labels.join(';'));

      for (const label of m.labels) seen.add(label);
    }

    // This population is chosen so every label is actually exercised; if one
    // stops being reachable the suite says so instead of passing quietly.
    for (const label of [
      'BALANCED',
      'HIGH_HYDROPHOBICITY',
      'HIGH_CHARGE',
      'LOW_SELECTIVITY',
    ] as const) {
      check(seen.has(label), `${label} must be exercised by this population`).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// 7. objectiveParts
// --------------------------------------------------------------------------

const LAMBDAS = [0, 0.25, 0.5, 1, 2.5, 5];
const OBJECTIVE_SEQUENCES = distinctSequences(0x5c08, 8);

describe('objectiveParts', () => {
  it('splits the objective into two terms that add back to the total', () => {
    for (const codes of OBJECTIVE_SEQUENCES) {
      const s = scoreAll(codes, model.flat);
      for (const lambda of LAMBDAS) {
        const p = objectiveParts(s, lambda);
        const where = `${classSequence(codes)} @ lambda=${lambda}`;
        check(p.lambda, `${where}: lambda is carried through`).toBe(lambda);
        check(p.offTargetSum, `${where}: offTargetSum = PE + PP`).toBe(s.PE + s.PP);
        check(p.targetTerm, `${where}: targetTerm = -PET`).toBe(-s.PET);
        check(p.penaltyTerm, `${where}: penaltyTerm = lambda * offTargetSum`).toBe(
          lambda * p.offTargetSum,
        );
        check(p.targetTerm + p.penaltyTerm, `${where}: the two terms add to total`).toBe(
          p.total,
        );
        check(p.total, `${where}: total = objective(scores, lambda)`).toBe(objective(s, lambda));
      }
    }
  });

  it('at lambda = 0 the objective collapses to -PET with no penalty', () => {
    for (const codes of OBJECTIVE_SEQUENCES) {
      const s = scoreAll(codes, model.flat);
      const p = objectiveParts(s, 0);
      const where = classSequence(codes);
      check(objective(s, 0), `${where}: objective at lambda=0`).toBe(-s.PET);
      // 0 * (negative) is -0 in IEEE 754; the claim is about magnitude.
      check(Math.abs(p.penaltyTerm), `${where}: penalty vanishes at lambda=0`).toBe(0);
    }
  });
});

// --------------------------------------------------------------------------
// 8. The objective is linear in lambda, with slope (PE + PP)
// --------------------------------------------------------------------------

describe('objective is linear in lambda', () => {
  const LAMBDA_PAIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [1, 2],
    [0.5, 2.5],
    [2, 5],
    [0, 5],
  ];
  const SECOND_DIFFERENCES: ReadonlyArray<readonly [number, number]> = [
    [1, 0.5],
    [2.5, 1],
    [3, 2],
  ];

  it('the numerical slope in lambda is exactly (PE + PP)', () => {
    for (const codes of OBJECTIVE_SEQUENCES) {
      const s = scoreAll(codes, model.flat);
      const offSum = s.PE + s.PP;
      const where = classSequence(codes);

      for (const [l1, l2] of LAMBDA_PAIRS) {
        const slope = (objective(s, l2) - objective(s, l1)) / (l2 - l1);
        check(
          Math.abs(slope - offSum),
          `${where}: slope between lambda ${l1} and ${l2} is ${slope}, expected ${offSum}`,
        ).toBeLessThan(SLOPE_TOLERANCE);
      }

      for (const lambda of LAMBDAS) {
        check(
          Math.abs(objective(s, lambda) - (objective(s, 0) + lambda * offSum)),
          `${where}: objective(${lambda}) must equal objective(0) + ${lambda} * offSum`,
        ).toBeLessThan(SLOPE_TOLERANCE);
      }

      // Zero curvature: the second difference of a straight line vanishes.
      for (const [centre, h] of SECOND_DIFFERENCES) {
        const second =
          objective(s, centre - h) - 2 * objective(s, centre) + objective(s, centre + h);
        check(
          Math.abs(second),
          `${where}: second difference at lambda=${centre}, h=${h}`,
        ).toBeLessThan(SLOPE_TOLERANCE);
      }

      // The direction of travel is decided by the sign of the off-target sum alone.
      check(
        objective(s, 5) > objective(s, 0),
        `${where}: offSum ${offSum} sets whether raising lambda raises the objective`,
      ).toBe(offSum > 0);
    }
  });
});

// --------------------------------------------------------------------------
// 9. scoreStats
// --------------------------------------------------------------------------

describe('scoreStats', () => {
  const CASES: ReadonlyArray<readonly [string, number[]]> = [
    ['ascending integers', [1, 2, 3, 4]],
    ['single value', [42]],
    ['constant negative', [-3, -3, -3, -3]],
    ['symmetric about zero', [-10, 0, 10]],
    ['mixed magnitudes', [0.5, -0.25, 100, -100, 7]],
    [
      'seeded random spread',
      Array.from({ length: 64 }, (_unused, i) => makeRng(0x5c09 + i).next() * 200 - 100),
    ],
  ];

  it('matches independently computed mean, std, min and max', () => {
    for (const [name, values] of CASES) {
      const got = scoreStats(Float64Array.from(values));
      const want = oracleStats(values);
      check(got.mean, `${name}: mean`).toBeCloseTo(want.mean, 9);
      check(got.std, `${name}: population std`).toBeCloseTo(want.std, 9);
      check(got.min, `${name}: min`).toBe(want.min);
      check(got.max, `${name}: max`).toBe(want.max);
      check(got.min, `${name}: min <= mean`).toBeLessThanOrEqual(got.mean);
      check(got.mean, `${name}: mean <= max`).toBeLessThanOrEqual(got.max);
    }
  });

  it('pins the hand-computed values for the two textbook cases', () => {
    const quad = scoreStats(Float64Array.from([1, 2, 3, 4]));
    check(quad.mean, 'mean of 1..4').toBe(2.5);
    check(quad.std, 'population std of 1..4 is sqrt(1.25)').toBeCloseTo(Math.sqrt(1.25), 12);
    check(quad.min, 'min of 1..4').toBe(1);
    check(quad.max, 'max of 1..4').toBe(4);

    const constant = scoreStats(Float64Array.from([-3, -3, -3, -3]));
    check(constant.std, 'a constant array has zero spread').toBe(0);
    check(constant.mean, 'a constant array has its own value as the mean').toBe(-3);
  });

  it('matches an independent pass over a small array of real PET scores', () => {
    const values: number[] = [];
    for (const codes of distinctSequences(0x5c0a, 96)) {
      values.push(scoreCodes(codes, model.flat.PET));
    }
    const got = scoreStats(Float64Array.from(values));
    const want = oracleStats(values);
    check(got.mean, 'real PET scores: mean').toBeCloseTo(want.mean, 9);
    check(got.std, 'real PET scores: std').toBeCloseTo(want.std, 9);
    check(got.min, 'real PET scores: min').toBe(want.min);
    check(got.max, 'real PET scores: max').toBe(want.max);
    // 96 distinct sequences cannot all score the same, so the spread is real.
    check(got.std, 'real PET scores vary').toBeGreaterThan(0);
    check(got.max, 'real PET scores: max exceeds min').toBeGreaterThan(got.min);
  });
});
