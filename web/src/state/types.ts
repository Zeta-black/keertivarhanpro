/**
 * The single typed source of truth for the whole app.
 *
 * Rules this shape enforces:
 *  - A result always travels with the lambda and seed that produced it, so
 *    numbers from different settings can never be mixed by accident.
 *  - `baseline` (the reference run) and `draft` (what the user is editing) are
 *    separate, so "before vs after" is always answerable.
 *  - Anything that is NOT computed carries a provenance tag.
 */

import type {
  CandidateRecord,
  ParetoPoint,
  QuboPayload,
  RunConfig,
  RunRecord,
  ScoreResponsePayload,
  StageId,
  SweepPoint,
  VerifyReport,
} from '../workers/protocol';

export type Provenance =
  | 'computed'
  | 'sampled'
  | 'estimate'
  | 'illustrative'
  | 'unavailable';

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  computed: 'Computed',
  sampled: 'Sampled',
  estimate: 'Model estimate',
  illustrative: 'Illustrative',
  unavailable: 'Not available',
};

export const PROVENANCE_MEANING: Record<Provenance, string> = {
  computed:
    'Calculated exactly, in your browser, from the published scoring model. Reproducible from the stated seed.',
  sampled:
    'Calculated exactly, but on a random subset rather than all 1,679,616 sequences. The sample size and seed are shown.',
  estimate:
    'Output of the scoring model, which is a computational prediction. Not a measurement of real binding.',
  illustrative:
    'A drawing made to explain an idea. It is not computed, not to scale, and not a simulation.',
  unavailable: 'We do not have this. The reason is stated rather than filled in with a guess.',
};

/** Beginner hides maths and jargon; Researcher reveals equations and raw terms. */
export type ExplanationMode = 'beginner' | 'researcher';

export type ThemeChoice = 'system' | 'dark' | 'light';
export type MotionChoice = 'system' | 'reduced';

/** Where the numbers on screen came from. */
export type DataMode =
  | 'none'      // nothing computed yet
  | 'live'      // computed in this browser session
  | 'replay';   // the recorded Python reference run, clearly labelled

export type RunStatus =
  | 'idle'
  | 'loadingModel'
  | 'ready'
  | 'running'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface StageState {
  readonly status: 'pending' | 'active' | 'done';
  readonly fraction: number | null;
  readonly note: string;
  readonly elapsedMs: number;
}

export interface ScenarioSnapshot {
  readonly id: string;
  readonly name: string;
  readonly codes: number[];
  readonly lambda: number;
  readonly savedAtIso: string;
}

/** A candidate the user has starred, kept with the settings that produced it. */
export interface FavouriteEntry {
  readonly classSequence: string;
  readonly codes: number[];
  readonly lambda: number;
  readonly objective: number;
  readonly scores: { PET: number; PE: number; PP: number };
  readonly addedAtIso: string;
}

export interface AppState {
  /** ---- model + run lifecycle ---- */
  readonly status: RunStatus;
  readonly dataMode: DataMode;
  readonly modelSource: string;
  readonly modelOrientation: string;
  readonly error: { message: string; stage: StageId | null; fatal: boolean } | null;

  /** The run currently awaited. Responses for any other id are discarded. */
  readonly pendingRunId: string | null;
  readonly stages: Readonly<Record<StageId, StageState>>;

  /** ---- results ---- */
  readonly baseline: RunRecord | null;
  readonly replay: RunRecord | null;
  readonly config: RunConfig;

  /** ---- the peptide the user is editing ---- */
  readonly draftCodes: number[];
  /**
   * One concrete amino acid per position, chosen from the members of that
   * position's class. This exists ONLY so a real molecule can be drawn: the
   * scoring model works at class resolution, so swapping leucine for
   * isoleucine changes the molecule and changes no score. The reducer keeps
   * this list reconciled with `draftCodes` so the two can never disagree.
   */
  readonly draftResidues: string[];
  readonly baselineCodes: number[] | null;
  readonly draftScore: ScoreResponsePayload | null;
  readonly previousScore: ScoreResponsePayload | null;
  readonly scoring: boolean;
  readonly history: number[][];
  readonly future: number[][];

  /** ---- comparison + selection ---- */
  readonly lambda: number;
  readonly selectedCandidate: CandidateRecord | null;
  readonly favourites: FavouriteEntry[];
  readonly compareA: number[] | null;
  readonly compareB: number[] | null;

  /** ---- derived views, cached by configuration ---- */
  readonly sweep: SweepPoint[] | null;
  readonly sweepLambdaKey: string | null;
  readonly pareto: { lambda: number; points: ParetoPoint[]; sampled: number } | null;
  readonly qubo: QuboPayload | null;
  readonly verify: VerifyReport | null;

  /** ---- preferences ---- */
  readonly mode: ExplanationMode;
  readonly theme: ThemeChoice;
  readonly motion: MotionChoice;
  readonly tourSeen: boolean;
  readonly scenarios: ScenarioSnapshot[];

  /** Device capability, measured once, used to pick render quality. */
  readonly capability: DeviceCapability;
}

export interface DeviceCapability {
  readonly cores: number;
  readonly memoryGb: number | null;
  readonly prefersReducedMotion: boolean;
  readonly coarsePointer: boolean;
  /** 'full' gets the 3D scene, 'lite' gets the 2D illustration. */
  readonly tier: 'full' | 'lite';
  readonly reason: string;
}
