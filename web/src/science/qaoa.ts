/**
 * Hard-constrained QAOA with XY mixers, run live in the browser.
 *
 * Mirrors `src/qbind_select/quantum/xy_qaoa.py`. `tests/science/qaoa-parity.test.ts`
 * asserts this implementation matches the Python one to 1e-9 on a golden
 * fixture, so the two can never silently diverge.
 *
 * WHAT IS QUANTUM HERE, EXACTLY
 * -----------------------------
 * This is a real gate-model variational quantum algorithm - the Quantum
 * Alternating Operator Ansatz (Hadfield et al. 2019), the constrained
 * generalisation of QAOA (Farhi et al. 2014) - executed by EXACT STATEVECTOR
 * SIMULATION on your CPU. There is no quantum hardware anywhere in this
 * project, and no quantum speedup is claimed: brute force over the same
 * designs is faster here and returns a PROVEN optimum, which is the reference
 * every number below is measured against.
 *
 * WHY A 48-QUBIT CIRCUIT FITS IN A BROWSER TAB
 * --------------------------------------------
 * The circuit nominally needs one qubit per (position, class) switch: 8 x 6 =
 * 48 qubits, so 2^48 amplitudes, about 4.5 petabytes. It is simulable anyway
 * because of a symmetry. The mixer
 *
 *     H_XY = sum_positions sum_{u<v in that position} ( X_u X_v + Y_u Y_v )
 *
 * conserves the number of 1s inside each position's six-qubit block. Start in
 * a state where every block has exactly one 1 - a product of W states, the
 * uniform superposition over the six classes - and the circuit can never leave
 * the set of valid designs. The dynamics are confined to a sector of dimension
 * 6^8 = 1,679,616 instead of 2^48, and that sector is simulated exactly.
 *
 * Two consequences worth stating plainly:
 *   1. Every measurement is a valid peptide. The validity rate is 1.0 by
 *      construction, not by tuning a penalty weight.
 *   2. The energy penalty that a quantum ANNEALER needs is gone entirely. That
 *      matters: a provably safe one-hot penalty has to exceed the whole
 *      objective range, and on the real Potts model that makes it ~17x larger
 *      than the energy differences the optimiser is trying to resolve. The
 *      penalty formulation measurably barely beats random guessing; this one
 *      does not need it.
 *
 * WHAT THE SIMULATION DOES NOT MODEL
 * ----------------------------------
 * The XY mixer is applied as an exact matrix exponential. Real hardware cannot
 * do that - the XY terms do not commute, so a device must Trotterise, which
 * introduces error this code does not simulate. Device noise, decoherence and
 * limited qubit connectivity are likewise not modelled. `circuitCost()` reports
 * the gate count a device would have to execute so the gap is visible.
 */

import {
  ALPHABET_SIZE,
  LENGTH,
  PAIR_ORDER,
  type Codes,
} from './alphabet';
import { TARGET, type FlatModel, type Plastic } from './potts';

/** Position pair (i<j) to its index in the Potts `pair` array. */
const PAIR_INDEX: ReadonlyMap<number, number> = (() => {
  const map = new Map<number, number>();
  PAIR_ORDER.forEach(([i, j], k) => map.set(i * LENGTH + j, k));
  return map;
})();

function pairIndexOf(i: number, j: number): number {
  const key = i < j ? i * LENGTH + j : j * LENGTH + i;
  const found = PAIR_INDEX.get(key);
  if (found === undefined) throw new Error(`no Potts pair block for positions ${i},${j}`);
  return found;
}

/**
 * Combined class-space objective: -PET + lambda * (PE + PP).
 *
 * Returned in the model's own layout: `linear[i * 6 + a]` and
 * `pair[k * 36 + a * 6 + b]` for pair k = (i<j).
 */
export interface ClassObjective {
  readonly linear: Float64Array;
  readonly pair: Float64Array;
  readonly intercept: number;
  readonly lambda: number;
}

export function combineClassCoefficients(model: FlatModel, lambda: number): ClassObjective {
  const linear = new Float64Array(LENGTH * ALPHABET_SIZE);
  const pair = new Float64Array(PAIR_ORDER.length * ALPHABET_SIZE * ALPHABET_SIZE);
  let intercept = 0;
  for (const plastic of ['PET', 'PE', 'PP'] as const) {
    const weight = plastic === TARGET ? -1 : lambda;
    const coeff = model[plastic as Plastic];
    for (let t = 0; t < linear.length; t += 1) linear[t] += weight * coeff.linear[t];
    for (let t = 0; t < pair.length; t += 1) pair[t] += weight * coeff.pair[t];
    intercept += weight * coeff.intercept;
  }
  return { linear, pair, intercept, lambda };
}

/** Read the i-j class interaction regardless of index order. */
function pairValue(
  objective: ClassObjective,
  i: number,
  j: number,
  a: number,
  b: number,
): number {
  const k = pairIndexOf(i, j);
  // The stored block is oriented (lower position, higher position), so swap the
  // class indices when the caller asks in the other order.
  const [ca, cb] = i < j ? [a, b] : [b, a];
  return objective.pair[k * 36 + ca * ALPHABET_SIZE + cb];
}

/**
 * The feasible-subspace representation of a (possibly reduced) problem.
 *
 * `objective[index]` is the penalty-free energy of one valid design, where
 * `index` is the mixed-radix encoding of the free positions' class choices
 * with slot 0 as the MOST significant digit - matching Python's C-order
 * `(6,)*k` tensor so the parity fixture lines up.
 */
export interface XyProblem {
  readonly freePositions: readonly number[];
  readonly fixedCodes: readonly number[];
  readonly lambda: number;
  readonly slots: number;
  readonly dimension: number;
  readonly nominalQubits: number;
  readonly objective: Float64Array;
  /** Effective one-body terms, `[slot * 6 + class]`. */
  readonly effectiveLinear: Float64Array;
  /** Free-free interactions, `[slotPair * 36 + a * 6 + b]`, slot pairs in (s1<s2) order. */
  readonly effectiveQuadratic: Float64Array;
  readonly contextConstant: number;
  readonly bestIndex: number;
  readonly bestEnergy: number;
  readonly worstEnergy: number;
  readonly meanEnergy: number;
  readonly span: number;
}

export interface BuildXyOptions {
  readonly lambda: number;
  /** Context for the clamped positions. Full 8-position class assignment. */
  readonly fixedCodes: Codes;
  /** Which positions the circuit may vary. Defaults to all 8. */
  readonly freePositions?: readonly number[];
}

/**
 * 6^8 = 1,679,616 doubles is 13 MB for the objective - fine in a worker, and
 * the problem is only 8 positions long, so this never actually binds.
 */
export const MAX_XY_DIMENSION = ALPHABET_SIZE ** LENGTH;

export function buildXyProblem(model: FlatModel, options: BuildXyOptions): XyProblem {
  const { lambda, fixedCodes } = options;
  const free = [...(options.freePositions ?? Array.from({ length: LENGTH }, (_, i) => i))]
    .map((p) => Math.trunc(p))
    .sort((a, b) => a - b);

  if (free.length === 0) throw new Error('at least one free position is required');
  if (new Set(free).size !== free.length) throw new Error('free positions must be distinct');
  for (const p of free) {
    if (p < 0 || p >= LENGTH) throw new Error(`free positions must lie in 0..${LENGTH - 1}`);
  }
  if (fixedCodes.length !== LENGTH) {
    throw new Error(`fixedCodes must have ${LENGTH} entries, got ${fixedCodes.length}`);
  }
  for (const c of fixedCodes) {
    if (!Number.isInteger(c) || c < 0 || c >= ALPHABET_SIZE) {
      throw new Error(`fixed class indices must be integers in 0..${ALPHABET_SIZE - 1}`);
    }
  }

  const objectiveCoefficients = combineClassCoefficients(model, lambda);
  const slots = free.length;
  const dimension = ALPHABET_SIZE ** slots;
  if (dimension > MAX_XY_DIMENSION) {
    throw new Error(`feasible subspace of dimension ${dimension} exceeds the limit`);
  }
  const freeSet = new Set(free);
  const clamped: number[] = [];
  for (let p = 0; p < LENGTH; p += 1) if (!freeSet.has(p)) clamped.push(p);

  // Constant: every term involving no free position. Shifts all energies
  // equally, so it changes no ranking, but it keeps reported energies
  // comparable with the full-model scores shown elsewhere in the app.
  let contextConstant = objectiveCoefficients.intercept;
  for (const i of clamped) {
    contextConstant += objectiveCoefficients.linear[i * ALPHABET_SIZE + fixedCodes[i]];
  }
  for (let x = 0; x < clamped.length; x += 1) {
    for (let y = x + 1; y < clamped.length; y += 1) {
      const i = clamped[x];
      const j = clamped[y];
      contextConstant += pairValue(objectiveCoefficients, i, j, fixedCodes[i], fixedCodes[j]);
    }
  }

  // Effective one-body term: a free position's own coefficient plus every
  // interaction it has with the clamped context.
  const effectiveLinear = new Float64Array(slots * ALPHABET_SIZE);
  for (let slot = 0; slot < slots; slot += 1) {
    const i = free[slot];
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      let value = objectiveCoefficients.linear[i * ALPHABET_SIZE + a];
      for (const j of clamped) {
        value += pairValue(objectiveCoefficients, i, j, a, fixedCodes[j]);
      }
      effectiveLinear[slot * ALPHABET_SIZE + a] = value;
    }
  }

  // Free-free interactions survive unchanged.
  const slotPairs: [number, number][] = [];
  for (let s1 = 0; s1 < slots; s1 += 1) {
    for (let s2 = s1 + 1; s2 < slots; s2 += 1) slotPairs.push([s1, s2]);
  }
  const effectiveQuadratic = new Float64Array(slotPairs.length * 36);
  slotPairs.forEach(([s1, s2], k) => {
    const i = free[s1];
    const j = free[s2];
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      for (let b = 0; b < ALPHABET_SIZE; b += 1) {
        effectiveQuadratic[k * 36 + a * ALPHABET_SIZE + b] = pairValue(
          objectiveCoefficients,
          i,
          j,
          a,
          b,
        );
      }
    }
  });

  // Enumerate the feasible subspace. Slot 0 is the most significant digit.
  const objective = new Float64Array(dimension);
  const digits = new Int32Array(slots);
  const radix = new Int32Array(slots);
  for (let slot = 0; slot < slots; slot += 1) {
    radix[slot] = ALPHABET_SIZE ** (slots - 1 - slot);
  }
  for (let index = 0; index < dimension; index += 1) {
    let rest = index;
    for (let slot = 0; slot < slots; slot += 1) {
      digits[slot] = Math.floor(rest / radix[slot]);
      rest -= digits[slot] * radix[slot];
    }
    let energy = contextConstant;
    for (let slot = 0; slot < slots; slot += 1) {
      energy += effectiveLinear[slot * ALPHABET_SIZE + digits[slot]];
    }
    for (let k = 0; k < slotPairs.length; k += 1) {
      const [s1, s2] = slotPairs[k];
      energy += effectiveQuadratic[k * 36 + digits[s1] * ALPHABET_SIZE + digits[s2]];
    }
    objective[index] = energy;
  }

  let bestIndex = 0;
  let best = objective[0];
  let worst = objective[0];
  let total = 0;
  for (let index = 0; index < dimension; index += 1) {
    const value = objective[index];
    if (value < best) {
      best = value;
      bestIndex = index;
    }
    if (value > worst) worst = value;
    total += value;
  }

  return {
    freePositions: free,
    fixedCodes: [...fixedCodes],
    lambda,
    slots,
    dimension,
    nominalQubits: slots * ALPHABET_SIZE,
    objective,
    effectiveLinear,
    effectiveQuadratic,
    contextConstant,
    bestIndex,
    bestEnergy: best,
    worstEnergy: worst,
    meanEnergy: total / dimension,
    span: worst - best,
  };
}

/** Decode a feasible-subspace index into per-slot class choices. */
export function slotClassesOf(problem: XyProblem, index: number): number[] {
  const out: number[] = [];
  let rest = index;
  for (let slot = 0; slot < problem.slots; slot += 1) {
    const radix = ALPHABET_SIZE ** (problem.slots - 1 - slot);
    const digit = Math.floor(rest / radix);
    out.push(digit);
    rest -= digit * radix;
  }
  return out;
}

/** Expand per-slot class choices back to a full 8-position sequence. */
export function codesFor(problem: XyProblem, slotClasses: readonly number[]): number[] {
  const codes = [...problem.fixedCodes];
  problem.freePositions.forEach((position, slot) => {
    codes[position] = slotClasses[slot];
  });
  return codes;
}

/**
 * Rescale the objective for the phase separator.
 *
 * Subtracting the mean is a global phase, which is physically unobservable;
 * dividing by the span only fixes the units of gamma. Neither changes any
 * measurement probability. Without it, exp(-i*gamma*C) wraps through many full
 * turns for any gamma of order 1 and the optimiser sees noise.
 */
export function scaledPhase(problem: XyProblem): Float64Array {
  const span = problem.span > 0 ? problem.span : 1;
  const phase = new Float64Array(problem.dimension);
  for (let i = 0; i < problem.dimension; i += 1) {
    phase[i] = (problem.objective[i] - problem.meanEnergy) / span;
  }
  return phase;
}

/** A statevector held as separate real and imaginary parts. */
export interface StateVector {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

export function uniformFeasibleState(dimension: number): StateVector {
  const amplitude = 1 / Math.sqrt(dimension);
  const re = new Float64Array(dimension);
  re.fill(amplitude);
  return { re, im: new Float64Array(dimension) };
}

/**
 * Apply the phase separator exp(-i * gamma * C_hat), in place.
 */
export function applyPhaseSeparator(
  state: StateVector,
  phase: Float64Array,
  gamma: number,
): void {
  const { re, im } = state;
  for (let i = 0; i < re.length; i += 1) {
    const angle = -gamma * phase[i];
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = re[i];
    const m = im[i];
    re[i] = r * c - m * s;
    im[i] = r * s + m * c;
  }
}

/**
 * Apply exp(-i * beta * H_XY) exactly, in place, one position at a time.
 *
 * Restricted to one position's one-hot subspace, H_XY acts as 2*(J - I) on the
 * six class states, because (X_u X_v + Y_u Y_v)|..1_u 0_v..> = 2|..0_u 1_v..>.
 * Hence
 *     exp(-i*beta*H_XY) = e^{2i beta} [ I + (e^{-12 i beta} - 1)/6 * J ]
 * and because J is rank one this is a scale plus a broadcast of that position's
 * axis sum - O(dimension) per position, with no Trotter error.
 */
export function applyXyMixer(state: StateVector, beta: number, slots: number): void {
  const { re, im } = state;
  const alphaRe = Math.cos(2 * beta);
  const alphaIm = Math.sin(2 * beta);
  // (e^{-12 i beta} - 1) / 6, then multiplied by alpha.
  const eRe = Math.cos(-12 * beta) - 1;
  const eIm = Math.sin(-12 * beta);
  const deltaRe = (alphaRe * eRe - alphaIm * eIm) / ALPHABET_SIZE;
  const deltaIm = (alphaRe * eIm + alphaIm * eRe) / ALPHABET_SIZE;

  for (let axis = 0; axis < slots; axis += 1) {
    const post = ALPHABET_SIZE ** (slots - 1 - axis);
    const pre = ALPHABET_SIZE ** axis;
    const blockStride = ALPHABET_SIZE * post;
    for (let p = 0; p < pre; p += 1) {
      const blockBase = p * blockStride;
      for (let q = 0; q < post; q += 1) {
        const base = blockBase + q;
        let sumRe = 0;
        let sumIm = 0;
        for (let a = 0; a < ALPHABET_SIZE; a += 1) {
          const idx = base + a * post;
          sumRe += re[idx];
          sumIm += im[idx];
        }
        const dRe = deltaRe * sumRe - deltaIm * sumIm;
        const dIm = deltaRe * sumIm + deltaIm * sumRe;
        for (let a = 0; a < ALPHABET_SIZE; a += 1) {
          const idx = base + a * post;
          const r = re[idx];
          const m = im[idx];
          re[idx] = alphaRe * r - alphaIm * m + dRe;
          im[idx] = alphaRe * m + alphaIm * r + dIm;
        }
      }
    }
  }
}

/** Build |psi(gamma, beta)> from the uniform feasible state. */
export function xyQaoaState(
  problem: XyProblem,
  phase: Float64Array,
  gammas: readonly number[],
  betas: readonly number[],
): StateVector {
  if (gammas.length !== betas.length) {
    throw new Error('gammas and betas must have the same length p');
  }
  const state = uniformFeasibleState(problem.dimension);
  for (let layer = 0; layer < gammas.length; layer += 1) {
    applyPhaseSeparator(state, phase, gammas[layer]);
    applyXyMixer(state, betas[layer], problem.slots);
  }
  return state;
}

/** Measurement probabilities, normalised. */
export function probabilitiesOf(state: StateVector): Float64Array {
  const { re, im } = state;
  const out = new Float64Array(re.length);
  let total = 0;
  for (let i = 0; i < re.length; i += 1) {
    const value = re[i] * re[i] + im[i] * im[i];
    out[i] = value;
    total += value;
  }
  if (total > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] /= total;
  }
  return out;
}

export function expectationOf(probabilities: Float64Array, objective: Float64Array): number {
  let total = 0;
  for (let i = 0; i < probabilities.length; i += 1) total += probabilities[i] * objective[i];
  return total;
}

/**
 * Nelder-Mead simplex minimisation.
 *
 * Deliberately the same algorithm, with the same standard coefficients, as
 * Python `qbind_select.quantum.qaoa.nelder_mead`: the browser must not drift
 * from the published benchmark. Reflection 1, expansion 2, contraction 0.5,
 * shrink 0.5.
 */
export function nelderMead(
  objective: (point: Float64Array) => number,
  start: Float64Array,
  options: { step?: number; maxIterations?: number; tolerance?: number } = {},
): { point: Float64Array; value: number; evaluations: number } {
  const step = options.step ?? 0.25;
  const maxIterations = options.maxIterations ?? 2000;
  const tolerance = options.tolerance ?? 1e-10;
  const dimension = start.length;

  const simplex: Float64Array[] = [Float64Array.from(start)];
  for (let i = 0; i < dimension; i += 1) {
    const point = Float64Array.from(start);
    point[i] += step;
    simplex.push(point);
  }
  let values = simplex.map((point) => objective(point));
  let evaluations = simplex.length;

  const centroidOf = (points: Float64Array[]): Float64Array => {
    const out = new Float64Array(dimension);
    for (const point of points) {
      for (let i = 0; i < dimension; i += 1) out[i] += point[i];
    }
    for (let i = 0; i < dimension; i += 1) out[i] /= points.length;
    return out;
  };

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const order = values
      .map((value, index) => [value, index] as const)
      .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]))
      .map(([, index]) => index);
    const sortedSimplex = order.map((index) => simplex[index]);
    const sortedValues = order.map((index) => values[index]);
    for (let i = 0; i < simplex.length; i += 1) {
      simplex[i] = sortedSimplex[i];
      values[i] = sortedValues[i];
    }

    const last = simplex.length - 1;
    if (Math.abs(values[last] - values[0]) <= tolerance * (Math.abs(values[0]) + tolerance)) {
      break;
    }

    const centroid = centroidOf(simplex.slice(0, last));
    const reflected = new Float64Array(dimension);
    for (let i = 0; i < dimension; i += 1) {
      reflected[i] = centroid[i] + (centroid[i] - simplex[last][i]);
    }
    const reflectedValue = objective(reflected);
    evaluations += 1;

    if (reflectedValue < values[0]) {
      const expanded = new Float64Array(dimension);
      for (let i = 0; i < dimension; i += 1) {
        expanded[i] = centroid[i] + 2 * (centroid[i] - simplex[last][i]);
      }
      const expandedValue = objective(expanded);
      evaluations += 1;
      if (expandedValue < reflectedValue) {
        simplex[last] = expanded;
        values[last] = expandedValue;
      } else {
        simplex[last] = reflected;
        values[last] = reflectedValue;
      }
    } else if (reflectedValue < values[last - 1]) {
      simplex[last] = reflected;
      values[last] = reflectedValue;
    } else {
      const contracted = new Float64Array(dimension);
      for (let i = 0; i < dimension; i += 1) {
        contracted[i] = centroid[i] + 0.5 * (simplex[last][i] - centroid[i]);
      }
      const contractedValue = objective(contracted);
      evaluations += 1;
      if (contractedValue < values[last]) {
        simplex[last] = contracted;
        values[last] = contractedValue;
      } else {
        for (let i = 1; i < simplex.length; i += 1) {
          const shrunk = new Float64Array(dimension);
          for (let d = 0; d < dimension; d += 1) {
            shrunk[d] = simplex[0][d] + 0.5 * (simplex[i][d] - simplex[0][d]);
          }
          simplex[i] = shrunk;
          values[i] = objective(shrunk);
          evaluations += 1;
        }
      }
    }
  }

  let bestIndex = 0;
  for (let i = 1; i < values.length; i += 1) if (values[i] < values[bestIndex]) bestIndex = i;
  return { point: simplex[bestIndex], value: values[bestIndex], evaluations };
}

/** Linear-ramp warm start: the standard deterministic QAOA initialisation. */
export function rampStart(depth: number): Float64Array {
  const out = new Float64Array(2 * depth);
  for (let layer = 1; layer <= depth; layer += 1) {
    out[layer - 1] = (0.7 * layer) / depth;
    out[depth + layer - 1] = 0.7 * (1 - (layer - 1) / depth);
  }
  return out;
}

/**
 * INTERP seeding (Zhou et al. 2020): lift an optimised depth-p schedule to a
 * depth-(p+1) starting guess. Optimised QAOA schedules are smooth in the layer
 * index, so this beats a random restart and stops a deeper circuit scoring
 * worse purely because the optimiser got trapped.
 */
export function interpolateAngles(angles: Float64Array, depth: number): Float64Array {
  const previous = angles.length / 2;
  const out = new Float64Array(2 * depth);
  const resample = (source: (index: number) => number, target: number): number => {
    if (previous === 1) return source(0);
    const position = (target / Math.max(depth - 1, 1)) * (previous - 1);
    const low = Math.floor(position);
    const high = Math.min(low + 1, previous - 1);
    const fraction = position - low;
    return source(low) * (1 - fraction) + source(high) * fraction;
  };
  for (let layer = 0; layer < depth; layer += 1) {
    out[layer] = resample((i) => angles[i], layer);
    out[depth + layer] = resample((i) => angles[previous + i], layer);
  }
  return out;
}

export interface TopDesign {
  readonly rank: number;
  readonly index: number;
  readonly slotClasses: readonly number[];
  readonly codes: readonly number[];
  readonly probability: number;
  readonly energy: number;
  readonly isExactOptimum: boolean;
}

export interface XyQaoaResult {
  readonly depth: number;
  readonly nominalQubits: number;
  readonly dimension: number;
  readonly gammas: number[];
  readonly betas: number[];
  readonly expectation: number;
  readonly approximationRatio: number;
  readonly randomBaselineRatio: number;
  /** 1 by construction: the XY mixer cannot leave the feasible set. */
  readonly validityRate: 1;
  readonly mostLikelyIndex: number;
  readonly mostLikelySlotClasses: readonly number[];
  readonly mostLikelyCodes: readonly number[];
  readonly mostLikelyEnergy: number;
  readonly mostLikelyProbability: number;
  readonly foundExactOptimum: boolean;
  readonly optimumProbability: number;
  readonly optimumRank: number;
  readonly enrichmentOverUniform: number;
  readonly provenOptimumEnergy: number;
  readonly provenOptimumCodes: readonly number[];
  readonly worstEnergy: number;
  readonly uniformMeanEnergy: number;
  readonly topDesigns: readonly TopDesign[];
  readonly functionEvaluations: number;
  readonly starts: number;
  readonly runtimeMs: number;
}

export interface OptimiseXyOptions {
  readonly depth?: number;
  readonly restarts?: number;
  readonly maxIterations?: number;
  readonly seed?: number;
  readonly topN?: number;
  readonly extraStarts?: readonly Float64Array[];
  /** Called with 0..1 progress so a long run can show a real fraction. */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Optimise the 2p variational angles and score the result against the proven
 * optimum of the same design space.
 */
export function optimiseXyQaoa(
  problem: XyProblem,
  options: OptimiseXyOptions = {},
): XyQaoaResult {
  const depth = options.depth ?? 2;
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error('QAOA depth p must be an integer of at least 1');
  }
  const restarts = Math.max(1, options.restarts ?? 2);
  const maxIterations = options.maxIterations ?? 150;
  const topN = options.topN ?? 10;
  const startedAt = Date.now();

  const phase = scaledPhase(problem);
  let evaluations = 0;

  const evaluate = (angles: Float64Array): number => {
    evaluations += 1;
    const gammas = Array.from(angles.subarray(0, depth));
    const betas = Array.from(angles.subarray(depth));
    const state = xyQaoaState(problem, phase, gammas, betas);
    return expectationOf(probabilitiesOf(state), problem.objective);
  };

  const starts: Float64Array[] = [rampStart(depth)];
  for (const extra of options.extraStarts ?? []) starts.push(Float64Array.from(extra));
  // Deterministic pseudo-random restarts. Mirrors the Python run's intent
  // (seeded restarts) without importing a generator: a fixed low-discrepancy
  // offset per restart keeps it reproducible across browsers.
  const seed = options.seed ?? 42;
  for (let r = 1; r < restarts; r += 1) {
    const angles = new Float64Array(2 * depth);
    for (let i = 0; i < angles.length; i += 1) {
      // Golden-ratio additive recurrence: deterministic, well spread in [0, pi).
      const t = ((seed + r * 97 + i * 31) * 0.6180339887498949) % 1;
      angles[i] = t * Math.PI;
    }
    starts.push(angles);
  }

  let bestAngles = starts[0];
  let bestValue = Number.POSITIVE_INFINITY;
  starts.forEach((start, index) => {
    const outcome = nelderMead(evaluate, start, { maxIterations });
    if (outcome.value < bestValue) {
      bestValue = outcome.value;
      bestAngles = outcome.point;
    }
    options.onProgress?.((index + 1) / starts.length);
  });

  const gammas = Array.from(bestAngles.subarray(0, depth));
  const betas = Array.from(bestAngles.subarray(depth));
  const state = xyQaoaState(problem, phase, gammas, betas);
  const probabilities = probabilitiesOf(state);

  let mostLikelyIndex = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[mostLikelyIndex]) mostLikelyIndex = i;
  }

  // Rank of the proven optimum by measurement probability.
  const optimumProbability = probabilities[problem.bestIndex];
  let optimumRank = 1;
  for (let i = 0; i < probabilities.length; i += 1) {
    if (probabilities[i] > optimumProbability) optimumRank += 1;
  }

  const span = problem.span > 0 ? problem.span : 1;
  const expectation = expectationOf(probabilities, problem.objective);

  const order = Array.from({ length: probabilities.length }, (_, i) => i).sort((a, b) => {
    const difference = probabilities[b] - probabilities[a];
    return difference !== 0 ? difference : a - b;
  });
  const topDesigns: TopDesign[] = order.slice(0, topN).map((index, position) => {
    const slotClasses = slotClassesOf(problem, index);
    return {
      rank: position + 1,
      index,
      slotClasses,
      codes: codesFor(problem, slotClasses),
      probability: probabilities[index],
      energy: problem.objective[index],
      isExactOptimum: index === problem.bestIndex,
    };
  });

  const mostLikelySlotClasses = slotClassesOf(problem, mostLikelyIndex);
  const provenSlotClasses = slotClassesOf(problem, problem.bestIndex);

  return {
    depth,
    nominalQubits: problem.nominalQubits,
    dimension: problem.dimension,
    gammas,
    betas,
    expectation,
    approximationRatio: (problem.worstEnergy - expectation) / span,
    randomBaselineRatio: (problem.worstEnergy - problem.meanEnergy) / span,
    validityRate: 1,
    mostLikelyIndex,
    mostLikelySlotClasses,
    mostLikelyCodes: codesFor(problem, mostLikelySlotClasses),
    mostLikelyEnergy: problem.objective[mostLikelyIndex],
    mostLikelyProbability: probabilities[mostLikelyIndex],
    foundExactOptimum: mostLikelyIndex === problem.bestIndex,
    optimumProbability,
    optimumRank,
    enrichmentOverUniform: optimumProbability * problem.dimension,
    provenOptimumEnergy: problem.bestEnergy,
    provenOptimumCodes: codesFor(problem, provenSlotClasses),
    worstEnergy: problem.worstEnergy,
    uniformMeanEnergy: problem.meanEnergy,
    topDesigns,
    functionEvaluations: evaluations,
    starts: starts.length,
    runtimeMs: Date.now() - startedAt,
  };
}

/** Optimise across increasing depth, seeding each depth from the previous. */
export function sweepXyDepths(
  problem: XyProblem,
  depths: readonly number[],
  options: OptimiseXyOptions = {},
): XyQaoaResult[] {
  const results: XyQaoaResult[] = [];
  let previous: Float64Array | null = null;
  depths.forEach((depth, index) => {
    const result = optimiseXyQaoa(problem, {
      ...options,
      depth,
      extraStarts: previous ? [interpolateAngles(previous, depth)] : undefined,
      onProgress: (fraction) =>
        options.onProgress?.((index + fraction) / Math.max(depths.length, 1)),
    });
    results.push(result);
    previous = Float64Array.from([...result.gammas, ...result.betas]);
  });
  return results;
}

/**
 * Gate cost the circuit would incur on real hardware.
 *
 * The honesty counterweight to the exact mixer above. Phase separator: one RZ
 * per one-hot variable plus one ZZ rotation (2 CNOTs) per coupled class pair.
 * XY mixer: each position is a complete graph on 6 variables = 15 XY pair
 * terms, each 2 CNOTs and 3 single-qubit rotations, per Trotter step. W-state
 * preparation: ~2*(6-1) CNOTs per position, once.
 *
 * All counts assume all-to-all connectivity and are therefore LOWER BOUNDS.
 * Nothing here has been executed on a device.
 */
export function circuitCost(
  slots: number,
  depth: number,
  options: { trotterSteps?: number; coupledPairs?: number } = {},
): {
  qubits: number;
  layers: number;
  trotterStepsPerLayer: number;
  statePrepCnot: number;
  phaseSeparatorRz: number;
  phaseSeparatorZz: number;
  phaseSeparatorCnot: number;
  xyPairTermsPerLayer: number;
  mixerCnot: number;
  mixerSingleQubit: number;
  cnotTotalLowerBound: number;
  variationalParameters: number;
} {
  const trotterSteps = options.trotterSteps ?? 1;
  const slotPairs = (slots * (slots - 1)) / 2;
  const coupledPairs = options.coupledPairs ?? slotPairs * ALPHABET_SIZE * ALPHABET_SIZE;
  const qubits = slots * ALPHABET_SIZE;
  const xyPairsPerPosition = (ALPHABET_SIZE * (ALPHABET_SIZE - 1)) / 2; // 15
  const xyPairs = slots * xyPairsPerPosition;

  const statePrepCnot = slots * 2 * (ALPHABET_SIZE - 1);
  const phaseSeparatorCnot = 2 * coupledPairs * depth;
  const mixerCnot = 2 * xyPairs * trotterSteps * depth;

  return {
    qubits,
    layers: depth,
    trotterStepsPerLayer: trotterSteps,
    statePrepCnot,
    phaseSeparatorRz: qubits * depth,
    phaseSeparatorZz: coupledPairs * depth,
    phaseSeparatorCnot,
    xyPairTermsPerLayer: xyPairs,
    mixerCnot,
    mixerSingleQubit: 3 * xyPairs * trotterSteps * depth,
    cnotTotalLowerBound: statePrepCnot + phaseSeparatorCnot + mixerCnot,
    variationalParameters: 2 * depth,
  };
}
