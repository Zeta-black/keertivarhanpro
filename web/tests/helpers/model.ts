/**
 * Shared test helpers: load the real exported Potts coefficients and the
 * Python golden fixture from disk. Tests run against the SAME file the browser
 * downloads, so a stale export fails the suite instead of passing quietly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildModel, type PottsModel, type PottsModelJson } from '../../src/science/potts';

const ROOT = resolve(__dirname, '..', '..');

export interface GoldenCase {
  codes: number[];
  classSequence: string;
  representative: string;
  scores: { PET: number; PE: number; PP: number };
  objectives: Record<string, number>;
  metrics: {
    meanOffTarget: number;
    worstOffTarget: number;
    marginMean: number;
    marginWorst: number;
    aromaticFraction: number;
    hydrophobicFraction: number;
    polarFraction: number;
    netChargeClassBalance: number;
    warnings: string;
  };
}

export interface Golden {
  generated_by: string;
  model_source: string;
  note: string;
  lambdas: number[];
  safePenalty: Record<string, number>;
  cases: GoldenCase[];
}

let cachedJson: PottsModelJson | null = null;
let cachedModel: PottsModel | null = null;
let cachedGolden: Golden | null = null;

export function modelJson(): PottsModelJson {
  if (!cachedJson) {
    cachedJson = JSON.parse(
      readFileSync(resolve(ROOT, 'public/model/potts_6class_8mer.json'), 'utf8'),
    ) as PottsModelJson;
  }
  return cachedJson;
}

export function realModel(): PottsModel {
  if (!cachedModel) cachedModel = buildModel(modelJson());
  return cachedModel;
}

export function golden(): Golden {
  if (!cachedGolden) {
    cachedGolden = JSON.parse(
      readFileSync(resolve(ROOT, 'tests/fixtures/python_golden.json'), 'utf8'),
    ) as Golden;
  }
  return cachedGolden;
}

/** Published optima from results/selectivity_sweep.csv (Ridge surrogate values). */
export const PUBLISHED_OPTIMA: Record<
  string,
  { classSequence: string; objective: number; PET: number; PE: number; PP: number }
> = {
  '0': {
    classSequence:
      'AROM_W-AROM_W-CHARGED_NEG-CHARGED_POS-CHARGED_NEG-CHARGED_NEG-AROM_W-AROM_W',
    objective: -41.00083330563526,
    PET: 41.00083330563526,
    PE: -35.498666680818545,
    PP: -111.45174990812086,
  },
  '0.5': {
    classSequence:
      'AROM_W-SMALL_POLAR-AROM_FY-AROM_W-HYDROPHOBIC-CHARGED_NEG-AROM_FY-HYDROPHOBIC',
    objective: -185.84874158302674,
    PET: 13.695188842086717,
    PE: -143.61492217790908,
    PP: -200.69218330397095,
  },
  '1': {
    classSequence:
      'HYDROPHOBIC-SMALL_POLAR-AROM_W-AROM_W-HYDROPHOBIC-HYDROPHOBIC-AROM_FY-HYDROPHOBIC',
    objective: -383.48736099604986,
    PET: -39.71991114030531,
    PE: -202.599066612459,
    PP: -220.6082055238962,
  },
  '2': {
    classSequence:
      'HYDROPHOBIC-CHARGED_NEG-AROM_W-AROM_W-AROM_FY-AROM_W-AROM_FY-HYDROPHOBIC',
    objective: -864.685582784282,
    PET: -170.73469444659312,
    PE: -220.83119437656688,
    PP: -296.8789442388707,
  },
  '5': {
    classSequence:
      'HYDROPHOBIC-CHARGED_NEG-AROM_W-AROM_W-AROM_FY-AROM_W-AROM_FY-HYDROPHOBIC',
    objective: -2417.815998630595,
    PET: -170.73469444659312,
    PE: -220.83119437656688,
    PP: -296.8789442388707,
  },
};

/**
 * Tolerance for comparing against results/*.csv. Those are Ridge surrogate
 * predictions whose documented test RMSE is ~5e-8 per score; the objective at
 * lambda weights three such scores, so 1e-5 absolute is comfortably strict
 * while still being honest about where the difference comes from.
 */
export const SURROGATE_TOLERANCE = 1e-5;

/** Tolerance for exact-model comparisons: float64 round-trip through JSON only. */
export const EXACT_TOLERANCE = 1e-9;
