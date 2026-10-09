/**
 * Exact six-class Potts scoring model.
 *
 * The coefficients in `public/model/potts_6class_8mer.json` are exported
 * verbatim from `data/processed/real_aggregated_potts_model.npz`, which the
 * Python benchmark builds from the public QA-PBP-RL-Nexus PottsModel_Energies
 * files (PET/PE/PP, backbone bb1, source positions 2..9, arithmetic-mean
 * 20-residue to 6-class aggregation).
 *
 * Score convention, unchanged from the Python side: the source MINIMISES raw
 * Potts energy, so the canonical binding score is the NEGATIVE of that energy.
 * Higher canonical binding score = stronger PREDICTED binding. It is a
 * dimensionless model score, not a measured affinity.
 *
 * `scoreCodes` here is bit-identical to Python `score_model.score_codes` on the
 * same coefficients (verified in tests/science/parity.test.ts against values
 * recorded from the Python run).
 */

import {
  ALPHABET_SIZE,
  LENGTH,
  PAIR_COUNT,
  PAIR_ORDER,
  VALID_SEQUENCES,
  assertCodes,
  type Codes,
} from './alphabet';

export const PLASTICS = ['PET', 'PE', 'PP'] as const;
export type Plastic = (typeof PLASTICS)[number];

export interface PlasticInfo {
  readonly id: Plastic;
  /** Full chemical name. */
  readonly chemical: string;
  /** What a shopper would recognise. */
  readonly everyday: string;
  readonly examples: readonly string[];
  readonly role: 'target' | 'offTarget';
  readonly plain: string;
  readonly token: string;
}

export const PLASTIC_INFO: readonly PlasticInfo[] = [
  {
    id: 'PET',
    chemical: 'Polyethylene terephthalate',
    everyday: 'Drink bottles',
    examples: ['Water and soft-drink bottles', 'Polyester clothing fibre', 'Food trays'],
    role: 'target',
    plain: 'The plastic we WANT to stick to. Clear, rigid, used for drink bottles.',
    token: '--c-pet',
  },
  {
    id: 'PE',
    chemical: 'Polyethylene',
    everyday: 'Bags and films',
    examples: ['Shopping bags', 'Cling film', 'Squeeze bottles'],
    role: 'offTarget',
    plain: 'A plastic we want to AVOID sticking to. Soft, stretchy, used for bags.',
    token: '--c-pe',
  },
  {
    id: 'PP',
    chemical: 'Polypropylene',
    everyday: 'Tubs and containers',
    examples: ['Yoghurt tubs', 'Bottle caps', 'Microwave containers'],
    role: 'offTarget',
    plain: 'Another plastic we want to AVOID sticking to. Stiffer, used for tubs and caps.',
    token: '--c-pp',
  },
];

export const TARGET: Plastic = 'PET';
export const OFF_TARGETS: readonly Plastic[] = ['PE', 'PP'];

/** Raw JSON shape of the exported coefficient file. */
export interface PottsModelJson {
  schema: string;
  source: string;
  orientation: string;
  positions: number;
  classes: string[];
  intercept: number;
  pairOrder: [number, number][];
  PET: { linear: number[][]; pair: number[][][] };
  PE: { linear: number[][]; pair: number[][][] };
  PP: { linear: number[][]; pair: number[][][] };
}

/**
 * Flattened coefficients for one plastic.
 * `linear[i * 6 + a]`                 one-body term for position i, class a
 * `pair[k * 36 + a * 6 + b]`          two-body term for pair k = (i<j), classes a,b
 */
export interface FlatCoefficients {
  readonly intercept: number;
  readonly linear: Float64Array;
  readonly pair: Float64Array;
}

export type FlatModel = Readonly<Record<Plastic, FlatCoefficients>>;

export interface PottsModel {
  readonly meta: {
    readonly schema: string;
    readonly source: string;
    readonly orientation: string;
  };
  readonly flat: FlatModel;
}

export const LINEAR_TERMS = LENGTH * ALPHABET_SIZE; // 48
export const PAIR_TERMS = PAIR_COUNT * ALPHABET_SIZE * ALPHABET_SIZE; // 1008

function flattenPlastic(
  intercept: number,
  linear: number[][],
  pair: number[][][],
): FlatCoefficients {
  if (linear.length !== LENGTH) {
    throw new Error(`linear coefficients must have ${LENGTH} positions, got ${linear.length}`);
  }
  if (pair.length !== PAIR_COUNT) {
    throw new Error(`pair coefficients must have ${PAIR_COUNT} blocks, got ${pair.length}`);
  }
  const flatLinear = new Float64Array(LINEAR_TERMS);
  for (let i = 0; i < LENGTH; i += 1) {
    const row = linear[i];
    if (row.length !== ALPHABET_SIZE) {
      throw new Error(`linear row ${i} must have ${ALPHABET_SIZE} classes`);
    }
    for (let a = 0; a < ALPHABET_SIZE; a += 1) flatLinear[i * ALPHABET_SIZE + a] = row[a];
  }
  const flatPair = new Float64Array(PAIR_TERMS);
  for (let k = 0; k < PAIR_COUNT; k += 1) {
    const block = pair[k];
    if (block.length !== ALPHABET_SIZE) {
      throw new Error(`pair block ${k} must be ${ALPHABET_SIZE}x${ALPHABET_SIZE}`);
    }
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      for (let b = 0; b < ALPHABET_SIZE; b += 1) {
        flatPair[k * 36 + a * ALPHABET_SIZE + b] = block[a][b];
      }
    }
  }
  return { intercept, linear: flatLinear, pair: flatPair };
}

export function buildModel(json: PottsModelJson): PottsModel {
  if (!json || typeof json !== 'object') throw new Error('Potts model JSON is empty');
  if (json.positions !== LENGTH) {
    throw new Error(`model has ${json.positions} positions, expected ${LENGTH}`);
  }
  if (json.classes.length !== ALPHABET_SIZE) {
    throw new Error(`model has ${json.classes.length} classes, expected ${ALPHABET_SIZE}`);
  }
  // The exported pairOrder must match the (i<j) order this code indexes with.
  PAIR_ORDER.forEach(([i, j], k) => {
    const got = json.pairOrder[k];
    if (!got || got[0] !== i || got[1] !== j) {
      throw new Error(`pairOrder mismatch at ${k}: expected [${i},${j}], got ${String(got)}`);
    }
  });
  const flat = {
    PET: flattenPlastic(json.intercept, json.PET.linear, json.PET.pair),
    PE: flattenPlastic(json.intercept, json.PE.linear, json.PE.pair),
    PP: flattenPlastic(json.intercept, json.PP.linear, json.PP.pair),
  } satisfies FlatModel;
  return {
    meta: { schema: json.schema, source: json.source, orientation: json.orientation },
    flat,
  };
}

/**
 * Exact canonical binding score for one sequence against one plastic.
 * score = intercept + sum_i linear[i][c_i] + sum_{i<j} pair[i,j][c_i][c_j]
 */
export function scoreCodes(codes: Codes, coeff: FlatCoefficients): number {
  assertCodes(codes);
  const { linear, pair } = coeff;
  let s = coeff.intercept;
  for (let i = 0; i < LENGTH; i += 1) s += linear[i * ALPHABET_SIZE + codes[i]];
  for (let k = 0; k < PAIR_COUNT; k += 1) {
    const [i, j] = PAIR_ORDER[k];
    s += pair[k * 36 + codes[i] * ALPHABET_SIZE + codes[j]];
  }
  return s;
}

export interface ScoreTriple {
  readonly PET: number;
  readonly PE: number;
  readonly PP: number;
}

export function scoreAll(codes: Codes, model: FlatModel): ScoreTriple {
  return {
    PET: scoreCodes(codes, model.PET),
    PE: scoreCodes(codes, model.PE),
    PP: scoreCodes(codes, model.PP),
  };
}

/**
 * Per-position and per-pair contribution breakdown for one plastic.
 * Used by the "why does this number change?" explanation panels. The parts sum
 * exactly to `scoreCodes`.
 */
export interface Contribution {
  readonly intercept: number;
  /** One entry per position. */
  readonly positions: number[];
  /** One entry per (i<j) pair, in PAIR_ORDER order. */
  readonly pairs: number[];
  readonly linearTotal: number;
  readonly pairTotal: number;
  readonly total: number;
}

export function contributions(codes: Codes, coeff: FlatCoefficients): Contribution {
  assertCodes(codes);
  const positions: number[] = [];
  let linearTotal = 0;
  for (let i = 0; i < LENGTH; i += 1) {
    const v = coeff.linear[i * ALPHABET_SIZE + codes[i]];
    positions.push(v);
    linearTotal += v;
  }
  const pairs: number[] = [];
  let pairTotal = 0;
  for (let k = 0; k < PAIR_COUNT; k += 1) {
    const [i, j] = PAIR_ORDER[k];
    const v = coeff.pair[k * 36 + codes[i] * ALPHABET_SIZE + codes[j]];
    pairs.push(v);
    pairTotal += v;
  }
  return {
    intercept: coeff.intercept,
    positions,
    pairs,
    linearTotal,
    pairTotal,
    total: coeff.intercept + linearTotal + pairTotal,
  };
}

/**
 * Enumerate every one of the 1,679,616 valid sequences and write exact scores
 * into `out`. Runs in chunks so a worker can report honest progress and stay
 * cancellable; `from`/`to` are sequence indices (half-open).
 */
export function scoreRange(
  coeff: FlatCoefficients,
  out: Float64Array,
  from: number,
  to: number,
): void {
  const { linear, pair, intercept } = coeff;
  const codes = new Int32Array(LENGTH);
  const end = Math.min(to, VALID_SEQUENCES);
  for (let n = from; n < end; n += 1) {
    let v = n;
    for (let i = LENGTH - 1; i >= 0; i -= 1) {
      codes[i] = v % ALPHABET_SIZE;
      v = (v - codes[i]) / ALPHABET_SIZE;
    }
    let s = intercept;
    for (let i = 0; i < LENGTH; i += 1) s += linear[i * ALPHABET_SIZE + codes[i]];
    for (let k = 0; k < PAIR_COUNT; k += 1) {
      const p = PAIR_ORDER[k];
      s += pair[k * 36 + codes[p[0]] * ALPHABET_SIZE + codes[p[1]]];
    }
    out[n] = s;
  }
}

/** Summary statistics over a full-space score array, for the Verify screen. */
export interface ScoreStats {
  readonly mean: number;
  readonly std: number;
  readonly min: number;
  readonly max: number;
}

export function scoreStats(values: Float64Array): ScoreStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / values.length;
  let sq = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - mean;
    sq += d * d;
  }
  return { mean, std: Math.sqrt(sq / values.length), min, max };
}
