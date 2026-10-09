/**
 * The selectivity objective and the candidate metrics.
 *
 * Mirrors `src/qbind_select/solvers/brute_force.py` and
 * `src/qbind_select/metrics.py`.
 *
 * objective = -PET + lambda * (PE + PP)        <- MINIMISED (lower is better)
 *
 * Reading it in plain language: the first term rewards a high PET score, and
 * the lambda term punishes high PE and PP scores. lambda is an optimisation
 * weight chosen by the user, not a measured biological quantity. In the UI it
 * is presented as "Selectivity Priority".
 */

import { ALPHABET_SIZE, CLASSES, type Codes, assertCodes } from './alphabet';
import { OFF_TARGETS, TARGET, type ScoreTriple } from './potts';

/** The lambda values the Python benchmark actually ran. */
export const BENCHMARK_LAMBDAS = [0.0, 0.5, 1.0, 2.0, 5.0] as const;
export const DEFAULT_LAMBDA = 1.0;

/** Continuous slider bounds. Any value in range is recomputed exactly, not interpolated. */
export const LAMBDA_MIN = 0;
export const LAMBDA_MAX = 5;

export function objective(scores: ScoreTriple, lambda: number): number {
  return -scores[TARGET] + lambda * (scores.PE + scores.PP);
}

/** The two halves of the objective, so the UI can show what each one contributes. */
export interface ObjectiveParts {
  /** -PET: the "reward PET binding" term. */
  readonly targetTerm: number;
  /** PE + PP, before the lambda weight. */
  readonly offTargetSum: number;
  /** lambda * (PE + PP): the "avoid off-target binding" term. */
  readonly penaltyTerm: number;
  readonly lambda: number;
  readonly total: number;
}

export function objectiveParts(scores: ScoreTriple, lambda: number): ObjectiveParts {
  const offTargetSum = scores.PE + scores.PP;
  const targetTerm = -scores[TARGET];
  const penaltyTerm = lambda * offTargetSum;
  return {
    targetTerm,
    offTargetSum,
    penaltyTerm,
    lambda,
    total: targetTerm + penaltyTerm,
  };
}

export type CandidateLabel =
  | 'BALANCED'
  | 'HIGH_HYDROPHOBICITY'
  | 'HIGH_CHARGE'
  | 'LOW_SELECTIVITY';

export interface CandidateMetrics {
  /** (PE + PP) / 2 */
  readonly meanOffTarget: number;
  /** max(PE, PP) - the off-target this peptide scores HIGHEST for, i.e. the worst case. */
  readonly worstOffTarget: number;
  /** PET - mean(PE, PP). Higher is better. */
  readonly marginMean: number;
  /** PET - max(PE, PP). Higher is better. The conservative selectivity measure. */
  readonly marginWorst: number;
  readonly aromaticFraction: number;
  readonly hydrophobicFraction: number;
  readonly polarFraction: number;
  /** positive-class fraction minus negative-class fraction. */
  readonly netChargeClassBalance: number;
  readonly labels: CandidateLabel[];
  /** Semicolon-joined labels, the exact string the Python CSV writes. */
  readonly warnings: string;
}

export function classFractions(codes: Codes): number[] {
  assertCodes(codes);
  const counts = new Array<number>(ALPHABET_SIZE).fill(0);
  for (const c of codes) counts[c] += 1;
  return counts.map((n) => n / codes.length);
}

export function candidateMetrics(codes: Codes, scores: ScoreTriple): CandidateMetrics {
  assertCodes(codes);
  const f = classFractions(codes);
  const idx = (name: string) => CLASSES.indexOf(name as (typeof CLASSES)[number]);
  const aromatic = f[idx('AROM_W')] + f[idx('AROM_FY')];
  const hydrophobic = f[idx('HYDROPHOBIC')];
  const polar = f[idx('SMALL_POLAR')];
  const chargeBalance = f[idx('CHARGED_POS')] - f[idx('CHARGED_NEG')];

  const pet = scores[TARGET];
  const meanOff = (scores.PE + scores.PP) / 2;
  const worstOff = Math.max(scores.PE, scores.PP);

  const labels: CandidateLabel[] = [];
  if (hydrophobic >= 0.75) labels.push('HIGH_HYDROPHOBICITY');
  if (f[idx('CHARGED_NEG')] + f[idx('CHARGED_POS')] >= 0.5) labels.push('HIGH_CHARGE');
  if (pet - meanOff <= 0) labels.push('LOW_SELECTIVITY');
  if (labels.length === 0) labels.push('BALANCED');

  return {
    meanOffTarget: meanOff,
    worstOffTarget: worstOff,
    marginMean: pet - meanOff,
    marginWorst: pet - worstOff,
    aromaticFraction: aromatic,
    hydrophobicFraction: hydrophobic,
    polarFraction: polar,
    netChargeClassBalance: chargeBalance,
    labels,
    warnings: labels.join(';'),
  };
}

/** Which off-target plastic is the binding risk for this candidate. */
export function worstOffTargetName(scores: ScoreTriple): 'PE' | 'PP' {
  return scores.PE >= scores.PP ? 'PE' : 'PP';
}

/** Everything the UI needs about one candidate, in one object. */
export interface Candidate {
  readonly codes: number[];
  readonly index: number;
  readonly classSequence: string;
  readonly representative: string;
  readonly scores: ScoreTriple;
  readonly objective: number;
  readonly metrics: CandidateMetrics;
  readonly lambda: number;
}

export const OFF_TARGET_NAMES = OFF_TARGETS.join(' and ');
