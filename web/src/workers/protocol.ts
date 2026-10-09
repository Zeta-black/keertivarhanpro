/**
 * Worker message contract.
 *
 * Every response carries the `runId` it belongs to. The client drops any
 * message whose runId is not the run it is currently waiting for, so a
 * cancelled or superseded run can never write stale numbers into the UI.
 *
 * The nine stages mirror `scripts/run_benchmark.py` one-for-one, so the
 * animated pipeline on the Optimise screen is a real picture of the real
 * computation rather than a decorative sequence.
 */

export const STAGE_IDS = [
  'variableMapping',
  'enumeration',
  'scoring',
  'featureSampling',
  'surrogate',
  'quboConstruction',
  'solving',
  'analysis',
  'export',
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export interface StageDescriptor {
  readonly id: StageId;
  readonly ordinal: number;
  /** Plain-English name shown to everyone. */
  readonly title: string;
  /** One sentence, no jargon. */
  readonly plain: string;
  /** What the code actually does, for the technical panel. */
  readonly technical: string;
  /** The Python symbol this stage corresponds to. */
  readonly pythonRef: string;
  /** True when this stage can report a real 0..1 fraction. */
  readonly measurable: boolean;
}

export const STAGES: readonly StageDescriptor[] = [
  {
    id: 'variableMapping',
    ordinal: 1,
    title: 'Set up the switches',
    plain:
      'We give every position-and-building-block combination its own on/off switch. Eight positions times six choices makes 48 switches.',
    technical:
      'Builds the (position, class) to binary-variable index map, variable_index(i, a) = i * 6 + a, for 48 variables.',
    pythonRef: 'qbind_select.alphabet.variable_index',
    measurable: false,
  },
  {
    id: 'enumeration',
    ordinal: 2,
    title: 'List every possible design',
    plain:
      'There are 1,679,616 different eight-block designs. We can list them all, which is why we can later prove we found the best one.',
    technical:
      'Enumerates all 6^8 = 1,679,616 valid class sequences. The 2^48 binary cube is never enumerated.',
    pythonRef: 'qbind_select.enumerate_space.enumerate_codes',
    measurable: true,
  },
  {
    id: 'scoring',
    ordinal: 3,
    title: 'Score every design against all three plastics',
    plain:
      'For each design we work out three numbers: how well the model thinks it sticks to PET, to PE and to PP.',
    technical:
      'Evaluates the exact six-class Potts model (8 one-body + 28 two-body terms) for PET, PE and PP over the full space.',
    pythonRef: 'qbind_select.score_model.score_codes',
    measurable: true,
  },
  {
    id: 'featureSampling',
    ordinal: 4,
    title: 'Draw a training sample',
    plain:
      'We pick a set of designs at random to teach a simpler stand-in model, keeping separate sets aside to test it honestly.',
    technical:
      'Draws disjoint train/validation/test index sets without replacement using the seeded generator.',
    pythonRef: 'qbind_select.surrogate.fit_surrogate (rng.choice)',
    measurable: true,
  },
  {
    id: 'surrogate',
    ordinal: 5,
    title: 'Fit the stand-in model',
    plain:
      'The stand-in model has to be written as a simple sum of switch terms, because that is the only form an optimiser like this can read.',
    technical:
      'Ridge regression over 48 one-hot + 1008 class-pair features (1056 total). The basis exactly spans the Potts model, so R-squared is 1.0 by construction, not by luck.',
    pythonRef: 'qbind_select.surrogate.fit_surrogate',
    measurable: true,
  },
  {
    id: 'quboConstruction',
    ordinal: 6,
    title: 'Write it as a switch puzzle (QUBO)',
    plain:
      'We turn the goal into one number to make as small as possible, plus a rule that each position must pick exactly one block.',
    technical:
      'Builds E = -PET + lambda*(PE+PP), then adds P * sum_i (sum_a x[i,a] - 1)^2 with the conservative penalty bound P.',
    pythonRef: 'qbind_select.qubo.combine_objective + add_one_hot_constraint',
    measurable: false,
  },
  {
    id: 'solving',
    ordinal: 7,
    title: 'Search for the best design',
    plain:
      'Two searches run: one checks every single design and is guaranteed correct, the other wanders the space like a quantum annealer would and we see how close it gets.',
    technical:
      'Exact brute force over the enumerated space, plus Metropolis simulated annealing on the constrained 48-variable QUBO.',
    pythonRef: 'solvers.brute_force.solve + solvers.simulated_annealing.solve',
    measurable: true,
  },
  {
    id: 'analysis',
    ordinal: 8,
    title: 'Work out what the answer means',
    plain:
      'We rank the top designs, measure how much better the winner is for PET than for the other plastics, and flag anything odd.',
    technical:
      'Computes selectivity margins, class composition fractions, warning labels, the top-10 ranking and the lambda sweep.',
    pythonRef: 'qbind_select.metrics.candidate_metrics',
    measurable: true,
  },
  {
    id: 'export',
    ordinal: 9,
    title: 'Package the results',
    plain:
      'Everything gets bundled with the exact settings used, so the run can be downloaded, checked and repeated.',
    technical:
      'Assembles the run record: candidates, sweep, solver comparison, validation checks, seed, timings and provenance.',
    pythonRef: 'scripts/run_benchmark.py write_csv + provenance.metadata',
    measurable: false,
  },
];

export const STAGE_BY_ID: Readonly<Record<StageId, StageDescriptor>> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageDescriptor>;

/** ---------------- Requests ---------------- */

export interface RunConfig {
  readonly lambda: number;
  readonly seed: number;
  /** Lambda values to sweep. Each one is solved exactly, never interpolated. */
  readonly sweepLambdas: number[];
  readonly topN: number;
  readonly surrogate: {
    readonly alpha: number;
    readonly trainSize: number;
    readonly validationSize: number;
    readonly testSize: number;
    /** Skipped on low-power devices; the UI then says so explicitly. */
    readonly enabled: boolean;
  };
  readonly annealing: {
    readonly reads: number;
    readonly sweeps: number;
    readonly runs: number;
    readonly enabled: boolean;
  };
  readonly penaltyMultiplier: number;
  readonly tolerance: number;
}

export const DEFAULT_RUN_CONFIG: RunConfig = {
  lambda: 1.0,
  seed: 42,
  sweepLambdas: [0, 0.5, 1, 2, 5],
  topN: 10,
  surrogate: {
    alpha: 1e-6,
    trainSize: 4000,
    validationSize: 1000,
    testSize: 1000,
    enabled: true,
  },
  annealing: { reads: 40, sweeps: 120, runs: 3, enabled: true },
  penaltyMultiplier: 2.0,
  tolerance: 1e-8,
};

export type WorkerRequest =
  | { kind: 'init'; runId: string; modelJsonUrl: string }
  | { kind: 'run'; runId: string; config: RunConfig }
  | { kind: 'score'; runId: string; codes: number[]; lambda: number }
  | { kind: 'sweep'; runId: string; lambdas: number[]; topN: number }
  | { kind: 'solveAt'; runId: string; lambda: number; topN: number }
  | { kind: 'pareto'; runId: string; lambda: number; sampleSize: number; seed: number }
  | { kind: 'quboAt'; runId: string; lambda: number; penaltyMultiplier: number }
  | { kind: 'verify'; runId: string; seed: number; sampleSize: number }
  | { kind: 'cancel'; runId: string };

/** ---------------- Responses ---------------- */

export interface CandidateRecord {
  readonly index: number;
  readonly codes: number[];
  readonly classSequence: string;
  readonly representative: string;
  readonly scores: { PET: number; PE: number; PP: number };
  readonly objective: number;
  readonly rank: number;
  readonly metrics: {
    readonly meanOffTarget: number;
    readonly worstOffTarget: number;
    readonly marginMean: number;
    readonly marginWorst: number;
    readonly aromaticFraction: number;
    readonly hydrophobicFraction: number;
    readonly polarFraction: number;
    readonly netChargeClassBalance: number;
    readonly warnings: string;
  };
}

export interface SweepPoint {
  readonly lambda: number;
  readonly best: CandidateRecord;
  readonly penalty: number;
  readonly runtimeMs: number;
  readonly optimumHits: number;
}

export interface SolverRecord {
  readonly solver: string;
  readonly lambda: number;
  readonly status: 'EXECUTED' | 'NOT EXECUTED' | 'SKIPPED';
  readonly bestObjective: number | null;
  readonly classSequence: string | null;
  readonly validityRate: number | null;
  readonly successRate: number | null;
  readonly runtimeMs: number | null;
  readonly seed: number | null;
  readonly reads: number | null;
  readonly medianBestEnergy: number | null;
  readonly stdBestEnergy: number | null;
  readonly note: string;
  readonly exact: boolean;
}

export interface SurrogateReport {
  readonly plastic: string;
  readonly alpha: number;
  readonly seed: number;
  readonly train: { count: number; r2: number; rmse: number; mae: number; maxAbsError: number };
  readonly validation: {
    count: number;
    r2: number;
    rmse: number;
    mae: number;
    maxAbsError: number;
  };
  readonly test: { count: number; r2: number; rmse: number; mae: number; maxAbsError: number };
  readonly splitsDisjoint: boolean;
  readonly fitMs: number;
}

export interface VerifyReport {
  readonly sampleSize: number;
  readonly seed: number;
  /** max |QUBO energy - objective| over valid sampled sequences. */
  readonly maxQuboObjectiveError: number;
  /** max |constrained - unconstrained| for valid sequences; should be ~0. */
  readonly maxPenaltyResidue: number;
  /** Every sampled one-hot vector decoded back to the same sequence. */
  readonly encodeDecodeRoundTrips: number;
  /** Invalid assignments tested, and how many were correctly penalised. */
  readonly invalidTested: number;
  readonly invalidCorrectlyPenalised: number;
  readonly penaltyBound: number;
  readonly lambda: number;
  readonly runtimeMs: number;
}

export interface ScoreResponsePayload {
  readonly codes: number[];
  readonly classSequence: string;
  readonly representative: string;
  readonly scores: { PET: number; PE: number; PP: number };
  readonly objective: number;
  readonly objectiveParts: {
    targetTerm: number;
    offTargetSum: number;
    penaltyTerm: number;
    lambda: number;
    total: number;
  };
  readonly metrics: CandidateRecord['metrics'];
  readonly contributions: {
    PET: { positions: number[]; pairs: number[]; linearTotal: number; pairTotal: number };
    PE: { positions: number[]; pairs: number[]; linearTotal: number; pairTotal: number };
    PP: { positions: number[]; pairs: number[]; linearTotal: number; pairTotal: number };
  };
  /** Rank of this sequence among all 1,679,616, at this lambda. Null until a full run exists. */
  readonly rankInSpace: number | null;
  readonly percentile: number | null;
}

export interface QuboPayload {
  readonly lambda: number;
  readonly penalty: number;
  readonly penaltyMultiplier: number;
  readonly offset: number;
  readonly linear: number[];
  /** Non-zero upper-triangular entries, as flat [u, v, value] triples. */
  readonly quadratic: [number, number, number][];
  readonly maxAbsCoefficient: number;
  readonly linearMass: number;
  readonly quadraticMass: number;
  readonly ising: { hMin: number; hMax: number; jMin: number; jMax: number; constant: number };
}

export interface ParetoPoint {
  readonly index: number;
  readonly pet: number;
  readonly worstOff: number;
  readonly objective: number;
  readonly onFrontier: boolean;
}

export interface RunRecord {
  readonly runId: string;
  readonly config: RunConfig;
  readonly mode: 'live';
  readonly candidates: CandidateRecord[];
  readonly sweep: SweepPoint[];
  readonly solvers: SolverRecord[];
  readonly surrogates: SurrogateReport[];
  readonly verify: VerifyReport | null;
  readonly stats: Record<string, { mean: number; std: number; min: number; max: number }>;
  readonly searchSpace: {
    positions: number;
    classes: number;
    binaryVariables: number;
    validSequences: number;
  };
  readonly timings: Partial<Record<StageId, number>>;
  readonly totalMs: number;
  readonly environment: {
    userAgent: string;
    hardwareConcurrency: number;
    deviceMemoryGb: number | null;
  };
  readonly quantumHardware: 'NO QUANTUM HARDWARE EXECUTION';
  readonly modelSource: string;
  readonly startedAtIso: string;
}

export type WorkerResponse =
  | { kind: 'ready'; runId: string; modelSource: string; orientation: string }
  | {
      kind: 'stage';
      runId: string;
      stage: StageId;
      status: 'active' | 'done';
      /** 0..1 when the stage is measurable, otherwise null. */
      fraction: number | null;
      note: string;
      elapsedMs: number;
    }
  | { kind: 'run'; runId: string; record: RunRecord }
  | { kind: 'score'; runId: string; payload: ScoreResponsePayload }
  | { kind: 'sweep'; runId: string; sweep: SweepPoint[] }
  | { kind: 'solveAt'; runId: string; lambda: number; candidates: CandidateRecord[] }
  | { kind: 'pareto'; runId: string; lambda: number; points: ParetoPoint[]; sampled: number }
  | { kind: 'qubo'; runId: string; payload: QuboPayload }
  | { kind: 'verify'; runId: string; report: VerifyReport }
  | { kind: 'cancelled'; runId: string; atStage: StageId | null }
  | { kind: 'error'; runId: string; message: string; stage: StageId | null; fatal: boolean };
