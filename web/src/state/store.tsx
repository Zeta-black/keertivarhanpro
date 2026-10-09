/**
 * App store: a typed reducer plus a worker client, exposed through context.
 *
 * Staleness is handled in one place. Every worker response carries a runId;
 * `WORKER_MESSAGE` drops anything that is not the run we are waiting for, so a
 * superseded or cancelled computation cannot write into the UI.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';

import { LENGTH, indexToCodes, isValidCodes } from '../science/alphabet';
import { DEFAULT_LAMBDA } from '../science/objective';
import {
  DEFAULT_RUN_CONFIG,
  STAGE_IDS,
  type RunConfig,
  type StageId,
  type WorkerRequest,
  type WorkerResponse,
} from '../workers/protocol';
import { detectCapability } from './capability';
import { loadPreferences, savePreferences } from './persistence';
import type { AppState, DataMode, ExplanationMode, MotionChoice, StageState, ThemeChoice } from './types';

const EMPTY_STAGE: StageState = {
  status: 'pending',
  fraction: null,
  note: '',
  elapsedMs: 0,
};

function emptyStages(): Record<StageId, StageState> {
  return Object.fromEntries(STAGE_IDS.map((id) => [id, EMPTY_STAGE])) as Record<
    StageId,
    StageState
  >;
}

/** The sequence the Python benchmark reports as rank 1 at lambda = 1. */
export const REFERENCE_CODES = [2, 3, 0, 0, 2, 2, 1, 2];

export function initialState(): AppState {
  const prefs = loadPreferences();
  return {
    status: 'idle',
    dataMode: 'none',
    modelSource: '',
    modelOrientation: '',
    error: null,
    pendingRunId: null,
    stages: emptyStages(),
    baseline: null,
    replay: null,
    config: DEFAULT_RUN_CONFIG,
    draftCodes: [...REFERENCE_CODES],
    baselineCodes: [...REFERENCE_CODES],
    draftScore: null,
    previousScore: null,
    scoring: false,
    history: [],
    future: [],
    lambda: DEFAULT_LAMBDA,
    selectedCandidate: null,
    favourites: prefs.favourites,
    compareA: null,
    compareB: null,
    sweep: null,
    sweepLambdaKey: null,
    pareto: null,
    qubo: null,
    verify: null,
    mode: prefs.mode,
    theme: prefs.theme,
    motion: prefs.motion,
    tourSeen: prefs.tourSeen,
    scenarios: prefs.scenarios,
    capability: detectCapability(),
  };
}

export type Action =
  | { type: 'WORKER_MESSAGE'; message: WorkerResponse }
  | { type: 'RUN_REQUESTED'; runId: string; config: RunConfig }
  | { type: 'RUN_CANCEL_REQUESTED' }
  | { type: 'SCORING_STARTED' }
  | { type: 'SET_DRAFT'; codes: number[]; recordHistory?: boolean }
  | { type: 'SET_POSITION'; position: number; classIndex: number }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET_DRAFT' }
  | { type: 'SET_LAMBDA'; lambda: number }
  | { type: 'SELECT_CANDIDATE'; index: number | null }
  | { type: 'TOGGLE_FAVOURITE'; codes: number[] }
  | { type: 'CLEAR_FAVOURITES' }
  | { type: 'SET_COMPARE'; slot: 'A' | 'B'; codes: number[] | null }
  | { type: 'SET_MODE'; mode: ExplanationMode }
  | { type: 'SET_THEME'; theme: ThemeChoice }
  | { type: 'SET_MOTION'; motion: MotionChoice }
  | { type: 'TOUR_SEEN' }
  | { type: 'SAVE_SCENARIO'; name: string }
  | { type: 'LOAD_SCENARIO'; id: string }
  | { type: 'DELETE_SCENARIO'; id: string }
  | { type: 'IMPORT_SCENARIOS'; scenarios: AppState['scenarios'] }
  | { type: 'SET_DATA_MODE'; mode: DataMode }
  | { type: 'DISMISS_ERROR' }
  | { type: 'RESET_ALL' };

const MAX_HISTORY = 50;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'WORKER_MESSAGE':
      return applyWorkerMessage(state, action.message);

    case 'RUN_REQUESTED':
      return {
        ...state,
        status: 'running',
        pendingRunId: action.runId,
        config: action.config,
        lambda: action.config.lambda,
        stages: emptyStages(),
        error: null,
      };

    case 'RUN_CANCEL_REQUESTED':
      return { ...state, status: 'cancelled', pendingRunId: null };

    case 'SCORING_STARTED':
      return { ...state, scoring: true };

    case 'SET_DRAFT': {
      if (!isValidCodes(action.codes)) return state;
      const record = action.recordHistory !== false;
      return {
        ...state,
        draftCodes: [...action.codes],
        history: record
          ? [...state.history, state.draftCodes].slice(-MAX_HISTORY)
          : state.history,
        future: record ? [] : state.future,
      };
    }

    case 'SET_POSITION': {
      const { position, classIndex } = action;
      if (position < 0 || position >= LENGTH || classIndex < 0 || classIndex > 5) return state;
      if (state.draftCodes[position] === classIndex) return state;
      const next = [...state.draftCodes];
      next[position] = classIndex;
      return {
        ...state,
        draftCodes: next,
        history: [...state.history, state.draftCodes].slice(-MAX_HISTORY),
        future: [],
      };
    }

    case 'UNDO': {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        ...state,
        draftCodes: [...previous],
        history: state.history.slice(0, -1),
        future: [state.draftCodes, ...state.future].slice(0, MAX_HISTORY),
      };
    }

    case 'REDO': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        draftCodes: [...next],
        history: [...state.history, state.draftCodes].slice(-MAX_HISTORY),
        future: rest,
      };
    }

    case 'RESET_DRAFT': {
      const target = state.baselineCodes ?? REFERENCE_CODES;
      if (target.every((c, i) => c === state.draftCodes[i])) return state;
      return {
        ...state,
        draftCodes: [...target],
        history: [...state.history, state.draftCodes].slice(-MAX_HISTORY),
        future: [],
      };
    }

    case 'SET_LAMBDA': {
      const lambda = Math.min(5, Math.max(0, action.lambda));
      if (lambda === state.lambda) return state;
      // A new lambda invalidates every lambda-dependent derived view.
      return {
        ...state,
        lambda,
        selectedCandidate: null,
        pareto: null,
        qubo: null,
      };
    }

    case 'SELECT_CANDIDATE': {
      if (action.index === null) return { ...state, selectedCandidate: null };
      const source = state.baseline ?? state.replay;
      const found = source?.candidates.find((c) => c.index === action.index) ?? null;
      return { ...state, selectedCandidate: found };
    }

    case 'TOGGLE_FAVOURITE': {
      if (!isValidCodes(action.codes)) return state;
      const key = action.codes.join(',');
      const existing = state.favourites.findIndex((f) => f.codes.join(',') === key);
      if (existing >= 0) {
        return {
          ...state,
          favourites: state.favourites.filter((_, i) => i !== existing),
        };
      }
      const score = state.draftScore;
      // Only star something we have real numbers for.
      if (!score || score.codes.join(',') !== key) return state;
      return {
        ...state,
        favourites: [
          ...state.favourites,
          {
            classSequence: score.classSequence,
            codes: [...action.codes],
            lambda: state.lambda,
            objective: score.objective,
            scores: score.scores,
            addedAtIso: new Date().toISOString(),
          },
        ].slice(-40),
      };
    }

    case 'CLEAR_FAVOURITES':
      return { ...state, favourites: [] };

    case 'SET_COMPARE':
      return action.slot === 'A'
        ? { ...state, compareA: action.codes ? [...action.codes] : null }
        : { ...state, compareB: action.codes ? [...action.codes] : null };

    case 'SET_MODE':
      return { ...state, mode: action.mode };

    case 'SET_THEME':
      return { ...state, theme: action.theme };

    case 'SET_MOTION':
      return { ...state, motion: action.motion };

    case 'TOUR_SEEN':
      return { ...state, tourSeen: true };

    case 'SAVE_SCENARIO': {
      const name = action.name.trim().slice(0, 60) || 'Untitled scenario';
      return {
        ...state,
        scenarios: [
          ...state.scenarios,
          {
            id: `s${state.scenarios.length}-${state.draftCodes.join('')}-${state.lambda}`,
            name,
            codes: [...state.draftCodes],
            lambda: state.lambda,
            savedAtIso: new Date().toISOString(),
          },
        ].slice(-30),
      };
    }

    case 'LOAD_SCENARIO': {
      const found = state.scenarios.find((s) => s.id === action.id);
      if (!found) return state;
      return {
        ...state,
        draftCodes: [...found.codes],
        lambda: found.lambda,
        history: [...state.history, state.draftCodes].slice(-MAX_HISTORY),
        future: [],
        pareto: null,
        qubo: null,
      };
    }

    case 'DELETE_SCENARIO':
      return { ...state, scenarios: state.scenarios.filter((s) => s.id !== action.id) };

    case 'IMPORT_SCENARIOS': {
      const valid = action.scenarios.filter(
        (s) => isValidCodes(s.codes) && Number.isFinite(s.lambda),
      );
      return { ...state, scenarios: [...state.scenarios, ...valid].slice(-30) };
    }

    case 'SET_DATA_MODE':
      return { ...state, dataMode: action.mode };

    case 'DISMISS_ERROR':
      return { ...state, error: null };

    case 'RESET_ALL': {
      const fresh = initialState();
      // Preferences survive a reset; results and edits do not.
      return {
        ...fresh,
        mode: state.mode,
        theme: state.theme,
        motion: state.motion,
        tourSeen: state.tourSeen,
        modelSource: state.modelSource,
        modelOrientation: state.modelOrientation,
        status: state.modelSource ? 'ready' : 'idle',
        favourites: [],
        scenarios: state.scenarios,
      };
    }

    default:
      return state;
  }
}

function applyWorkerMessage(state: AppState, message: WorkerResponse): AppState {
  // `init` replies and one-off queries use their own ids; only the long-running
  // pipeline is gated on pendingRunId.
  const isPipelineMessage =
    message.kind === 'stage' || message.kind === 'run' || message.kind === 'cancelled';
  if (isPipelineMessage && state.pendingRunId !== message.runId) {
    return state; // stale: a newer run superseded this one
  }

  switch (message.kind) {
    case 'ready':
      return {
        ...state,
        status: state.status === 'running' ? 'running' : 'ready',
        modelSource: message.modelSource,
        modelOrientation: message.orientation,
        error: null,
      };

    case 'stage':
      return {
        ...state,
        stages: {
          ...state.stages,
          [message.stage]: {
            status: message.status,
            fraction: message.fraction,
            note: message.note,
            elapsedMs: message.elapsedMs,
          },
        },
      };

    case 'run':
      return {
        ...state,
        status: 'complete',
        dataMode: 'live',
        baseline: message.record,
        pendingRunId: null,
        verify: message.record.verify,
        sweep: message.record.sweep,
        sweepLambdaKey: message.record.config.sweepLambdas.join(','),
        selectedCandidate: message.record.candidates[0] ?? null,
        baselineCodes: message.record.candidates[0]
          ? [...message.record.candidates[0].codes]
          : state.baselineCodes,
      };

    case 'score':
      return {
        ...state,
        scoring: false,
        previousScore:
          state.draftScore && state.draftScore.classSequence !== message.payload.classSequence
            ? state.draftScore
            : state.previousScore,
        draftScore: message.payload,
      };

    case 'sweep':
      return { ...state, sweep: message.sweep };

    case 'solveAt': {
      const first = message.candidates[0] ?? null;
      return { ...state, selectedCandidate: first };
    }

    case 'pareto':
      return {
        ...state,
        pareto: { lambda: message.lambda, points: message.points, sampled: message.sampled },
      };

    case 'qubo':
      return { ...state, qubo: message.payload };

    case 'verify':
      return { ...state, verify: message.report };

    case 'cancelled':
      return { ...state, status: 'cancelled', pendingRunId: null };

    case 'error':
      return {
        ...state,
        status: message.fatal ? 'error' : state.status === 'running' ? 'ready' : state.status,
        scoring: false,
        pendingRunId: message.fatal ? null : state.pendingRunId,
        error: { message: message.message, stage: message.stage, fatal: message.fatal },
      };

    default:
      return state;
  }
}

/** ---------------- Context ---------------- */

/**
 * `Omit` over a discriminated union collapses it to the keys all members share,
 * which would silently drop `codes`, `lambda` and friends. Distribute it.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SendRequest = DistributiveOmit<WorkerRequest, 'runId'> & { runId?: string };

export interface StoreApi {
  readonly state: AppState;
  readonly dispatch: Dispatch<Action>;
  /** Send a request to the worker. Returns the runId it was tagged with. */
  readonly send: (request: SendRequest) => string;
  readonly startRun: (overrides?: Partial<RunConfig>) => void;
  readonly cancelRun: () => void;
  readonly workerAvailable: boolean;
}

const StoreContext = createContext<StoreApi | null>(null);

let runCounter = 0;
function nextRunId(prefix: string): string {
  runCounter += 1;
  return `${prefix}-${runCounter}`;
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const workerRef = useRef<Worker | null>(null);
  const availableRef = useRef(false);

  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      dispatch({
        type: 'WORKER_MESSAGE',
        message: {
          kind: 'error',
          runId: 'init',
          message:
            `This browser could not start the computation worker: ${(error as Error).message}. ` +
            'Every calculation on this site runs in that worker, so no scores or runs are ' +
            'available. The explanations, methodology and honesty sections all still work.',
          stage: null,
          fatal: true,
        },
      });
      return;
    }
    workerRef.current = worker;
    availableRef.current = true;

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      dispatch({ type: 'WORKER_MESSAGE', message: event.data });
    });
    worker.addEventListener('error', (event) => {
      dispatch({
        type: 'WORKER_MESSAGE',
        message: {
          kind: 'error',
          runId: 'worker',
          message: event.message || 'the computation worker crashed',
          stage: null,
          fatal: false,
        },
      });
    });

    const modelUrl = new URL('model/potts_6class_8mer.json', document.baseURI).href;
    worker.postMessage({
      kind: 'init',
      runId: nextRunId('init'),
      modelJsonUrl: modelUrl,
    } satisfies WorkerRequest);

    return () => {
      worker?.terminate();
      workerRef.current = null;
      availableRef.current = false;
    };
  }, []);

  const send = useCallback(
    (request: SendRequest): string => {
      const runId = request.runId ?? nextRunId(request.kind);
      workerRef.current?.postMessage({ ...request, runId } as WorkerRequest);
      return runId;
    },
    [],
  );

  const startRun = useCallback(
    (overrides: Partial<RunConfig> = {}) => {
      const config: RunConfig = {
        ...DEFAULT_RUN_CONFIG,
        ...overrides,
        lambda: overrides.lambda ?? state.lambda,
      };
      const runId = nextRunId('run');
      dispatch({ type: 'RUN_REQUESTED', runId, config });
      workerRef.current?.postMessage({ kind: 'run', runId, config } satisfies WorkerRequest);
    },
    [state.lambda],
  );

  const cancelRun = useCallback(() => {
    if (state.pendingRunId) {
      workerRef.current?.postMessage({
        kind: 'cancel',
        runId: state.pendingRunId,
      } satisfies WorkerRequest);
    }
    dispatch({ type: 'RUN_CANCEL_REQUESTED' });
  }, [state.pendingRunId]);

  // Persist only small, non-sensitive preferences.
  useEffect(() => {
    savePreferences({
      mode: state.mode,
      theme: state.theme,
      motion: state.motion,
      tourSeen: state.tourSeen,
      favourites: state.favourites,
      scenarios: state.scenarios,
    });
  }, [state.mode, state.theme, state.motion, state.tourSeen, state.favourites, state.scenarios]);

  // Reflect theme and motion choices onto the document root.
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (state.motion === 'reduced') root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
  }, [state.motion]);

  const api = useMemo<StoreApi>(
    () => ({
      state,
      dispatch,
      send,
      startRun,
      cancelRun,
      workerAvailable: availableRef.current,
    }),
    [state, send, startRun, cancelRun],
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const api = useContext(StoreContext);
  if (!api) throw new Error('useStore must be used inside <StoreProvider>');
  return api;
}

export function useAppState(): AppState {
  return useStore().state;
}

/** Convenience: the run record currently being displayed, live or replay. */
export function useActiveRun() {
  const { state } = useStore();
  return state.dataMode === 'replay' ? state.replay : state.baseline;
}

export { indexToCodes };
