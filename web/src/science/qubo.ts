/**
 * QUBO / Ising construction for the 48-variable selectivity problem.
 *
 * Mirrors `src/qbind_select/qubo.py`.
 *
 * Objective, before constraints:
 *     E(x) = -PET(x) + lambda * (PE(x) + PP(x))
 *
 * The Potts model is already quadratic in the one-hot variables, so the mapping
 * is exact: a one-body term becomes a QUBO linear coefficient and a two-body
 * term becomes a QUBO quadratic coefficient. (The Python pipeline fits a Ridge
 * surrogate over exactly this feature basis and recovers the same coefficients
 * to ~5e-8; see docs/METHODOLOGY in the repo root and the Verify screen.)
 *
 * Exactly-one-of-six per position is enforced by adding
 *     P * sum_i ( sum_a x[i,a] - 1 )^2
 * expanded as: linear -P per variable, quadratic +2P per within-position pair,
 * and +P per position added to the constant offset. For a valid assignment the
 * expanded constraint contributes exactly zero.
 */

import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  LENGTH,
  PAIR_COUNT,
  PAIR_ORDER,
  encode,
  type Codes,
} from './alphabet';
import { TARGET, type FlatModel } from './potts';

/** Quadratic coefficients keyed by `u * 48 + v` with u < v. */
export interface Qubo {
  readonly linear: Float64Array;
  /** Dense upper-triangular matrix, index `u * 48 + v` for u < v. */
  readonly quadratic: Float64Array;
  readonly offset: number;
  readonly lambda: number;
  /** Penalty weight P, or 0 when constraints have not been added. */
  readonly penalty: number;
  readonly constrained: boolean;
}

export function quadIndex(u: number, v: number): number {
  return u < v ? u * BINARY_VARIABLES + v : v * BINARY_VARIABLES + u;
}

/**
 * Build the unconstrained objective QUBO at a given lambda, directly from the
 * exact Potts coefficients.
 */
export function combineObjective(model: FlatModel, lambda: number): Qubo {
  const linear = new Float64Array(BINARY_VARIABLES);
  const quadratic = new Float64Array(BINARY_VARIABLES * BINARY_VARIABLES);

  const weight = (plastic: keyof FlatModel) => (plastic === TARGET ? -1 : lambda);

  for (const plastic of ['PET', 'PE', 'PP'] as const) {
    const w = weight(plastic);
    const coeff = model[plastic];
    for (let i = 0; i < LENGTH; i += 1) {
      for (let a = 0; a < ALPHABET_SIZE; a += 1) {
        linear[i * ALPHABET_SIZE + a] += w * coeff.linear[i * ALPHABET_SIZE + a];
      }
    }
    for (let k = 0; k < PAIR_COUNT; k += 1) {
      const [i, j] = PAIR_ORDER[k];
      for (let a = 0; a < ALPHABET_SIZE; a += 1) {
        for (let b = 0; b < ALPHABET_SIZE; b += 1) {
          const u = i * ALPHABET_SIZE + a;
          const v = j * ALPHABET_SIZE + b;
          quadratic[quadIndex(u, v)] += w * coeff.pair[k * 36 + a * ALPHABET_SIZE + b];
        }
      }
    }
  }

  // All three intercepts are 0 in this model, but keep the term for fidelity.
  const offset =
    -model[TARGET].intercept + lambda * (model.PE.intercept + model.PP.intercept);

  return { linear, quadratic, offset, lambda, penalty: 0, constrained: false };
}

/** Sum of absolute non-constant coefficients - the basis of the penalty bound. */
export function coefficientMass(q: Qubo): { linear: number; quadratic: number } {
  let l = 0;
  for (let i = 0; i < q.linear.length; i += 1) l += Math.abs(q.linear[i]);
  let s = 0;
  for (let i = 0; i < q.quadratic.length; i += 1) s += Math.abs(q.quadratic[i]);
  return { linear: l, quadratic: s };
}

export const DEFAULT_PENALTY_MULTIPLIER = 2.0;

/**
 * Conservative penalty bound, identical to Python `safe_penalty`:
 *   P = multiplier * (sum|linear| + sum|quadratic|) + 1
 * This exceeds the full objective range, so any one-hot violation is guaranteed
 * to cost more than any objective gain.
 */
export function safePenalty(q: Qubo, multiplier = DEFAULT_PENALTY_MULTIPLIER): number {
  const mass = coefficientMass(q);
  return multiplier * (mass.linear + mass.quadratic) + 1.0;
}

/** Add the expanded exactly-one-of-six penalty. Returns a new Qubo. */
export function addOneHotConstraint(q: Qubo, penalty: number): Qubo {
  const linear = Float64Array.from(q.linear);
  const quadratic = Float64Array.from(q.quadratic);
  let offset = q.offset;
  for (let position = 0; position < LENGTH; position += 1) {
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      linear[position * ALPHABET_SIZE + a] += -penalty;
    }
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      for (let b = a + 1; b < ALPHABET_SIZE; b += 1) {
        const u = position * ALPHABET_SIZE + a;
        const v = position * ALPHABET_SIZE + b;
        quadratic[quadIndex(u, v)] += 2.0 * penalty;
      }
    }
    offset += penalty;
  }
  return { linear, quadratic, offset, lambda: q.lambda, penalty, constrained: true };
}

/** QUBO energy of an arbitrary binary vector (valid or not). */
export function quboEnergy(x: ArrayLike<number>, q: Qubo): number {
  let e = q.offset;
  for (let i = 0; i < BINARY_VARIABLES; i += 1) {
    if (x[i]) e += q.linear[i];
  }
  for (let u = 0; u < BINARY_VARIABLES; u += 1) {
    if (!x[u]) continue;
    for (let v = u + 1; v < BINARY_VARIABLES; v += 1) {
      if (x[v]) e += q.quadratic[u * BINARY_VARIABLES + v];
    }
  }
  return e;
}

/** QUBO energy of a valid class sequence. */
export function quboEnergyOfCodes(codes: Codes, q: Qubo): number {
  return quboEnergy(encode(codes), q);
}

/**
 * Non-zero quadratic entries, for the heatmap and graph views.
 * Returns upper-triangular entries only.
 */
export interface QuadEntry {
  readonly u: number;
  readonly v: number;
  readonly value: number;
}

export function quadraticEntries(q: Qubo, epsilon = 0): QuadEntry[] {
  const out: QuadEntry[] = [];
  for (let u = 0; u < BINARY_VARIABLES; u += 1) {
    for (let v = u + 1; v < BINARY_VARIABLES; v += 1) {
      const value = q.quadratic[u * BINARY_VARIABLES + v];
      if (Math.abs(value) > epsilon) out.push({ u, v, value });
    }
  }
  return out;
}

/** Largest absolute coefficient, used to scale the heatmap colour ramp. */
export function maxAbsCoefficient(q: Qubo): number {
  let m = 0;
  for (let i = 0; i < q.linear.length; i += 1) m = Math.max(m, Math.abs(q.linear[i]));
  for (let i = 0; i < q.quadratic.length; i += 1) m = Math.max(m, Math.abs(q.quadratic[i]));
  return m;
}

/**
 * QUBO (x in {0,1}) to Ising (s in {-1,+1}) conversion via x = (s + 1) / 2.
 *
 * h[i]     = linear[i]/2 + sum_{j != i} J_full[i][j] / 4
 * J[i][j]  = quadratic[i][j] / 4
 * constant = offset + sum_i linear[i]/2 + sum_{i<j} quadratic[i][j] / 4
 *
 * Provided because the published pipeline targets D-Wave hardware, which is an
 * Ising machine. NOTE: no quantum hardware was used in this project.
 */
export interface Ising {
  readonly h: Float64Array;
  /** Dense upper triangular, index u * 48 + v for u < v. */
  readonly J: Float64Array;
  readonly constant: number;
}

export function quboToIsing(q: Qubo): Ising {
  const n = BINARY_VARIABLES;
  const h = new Float64Array(n);
  const J = new Float64Array(n * n);
  let constant = q.offset;
  for (let i = 0; i < n; i += 1) {
    h[i] += q.linear[i] / 2;
    constant += q.linear[i] / 2;
  }
  for (let u = 0; u < n; u += 1) {
    for (let v = u + 1; v < n; v += 1) {
      const w = q.quadratic[u * n + v];
      if (w === 0) continue;
      J[u * n + v] = w / 4;
      h[u] += w / 4;
      h[v] += w / 4;
      constant += w / 4;
    }
  }
  return { h, J, constant };
}

export function isingEnergy(spins: ArrayLike<number>, ising: Ising): number {
  const n = BINARY_VARIABLES;
  let e = ising.constant;
  for (let i = 0; i < n; i += 1) e += ising.h[i] * spins[i];
  for (let u = 0; u < n; u += 1) {
    for (let v = u + 1; v < n; v += 1) {
      const j = ising.J[u * n + v];
      if (j !== 0) e += j * spins[u] * spins[v];
    }
  }
  return e;
}

export function binaryToSpins(x: ArrayLike<number>): Int8Array {
  const s = new Int8Array(x.length);
  for (let i = 0; i < x.length; i += 1) s[i] = x[i] ? 1 : -1;
  return s;
}
