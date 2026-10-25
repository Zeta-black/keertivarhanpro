/** Small shared hooks used across screens. */

import { useEffect, useRef, useState } from 'react';

import { buildModel, type PottsModel, type PottsModelJson } from '../science/potts';
import { useStore } from '../state/store';

/**
 * Whether animation should be suppressed: either the OS asks for it, or the
 * user chose "reduce animation" in the header.
 */
export function useReducedMotion(): boolean {
  const { state } = useStore();
  const [systemPrefers, setSystemPrefers] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) => setSystemPrefers(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return state.motion === 'reduced' || systemPrefers;
}

/** Debounce a rapidly changing value, for expensive recomputation. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** The previous render's value, for before/after comparisons. */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

/** True once the element has scrolled into view; used for reveal-on-scroll. */
export function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, inView];
}

/** Viewport width bucket, for layouts that genuinely need to branch in JS. */
export function useViewport(): 'mobile' | 'tablet' | 'desktop' {
  const [bucket, setBucket] = useState<'mobile' | 'tablet' | 'desktop'>(() =>
    typeof window === 'undefined'
      ? 'desktop'
      : window.innerWidth < 640
        ? 'mobile'
        : window.innerWidth < 1024
          ? 'tablet'
          : 'desktop',
  );
  useEffect(() => {
    const onResize = () => {
      setBucket(
        window.innerWidth < 640 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return bucket;
}

/**
 * Keeps the scored view of the draft sequence in sync with the worker.
 *
 * Debounced so dragging a slider or hammering the keyboard does not queue
 * dozens of requests, and the worker drops anything stale by runId anyway.
 */
export function useDraftScoring(): void {
  const { state, send, dispatch } = useStore();
  const codesKey = state.draftCodes.join(',');
  const debouncedKey = useDebounced(codesKey, 90);
  const debouncedLambda = useDebounced(state.lambda, 120);
  const lastRequested = useRef<string>('');

  useEffect(() => {
    if (state.status === 'idle' || state.status === 'loadingModel') return;
    const key = `${debouncedKey}@${debouncedLambda}`;
    if (lastRequested.current === key) return;
    lastRequested.current = key;
    dispatch({ type: 'SCORING_STARTED' });
    send({
      kind: 'score',
      codes: debouncedKey.split(',').map(Number),
      lambda: debouncedLambda,
    });
  }, [debouncedKey, debouncedLambda, state.status, send, dispatch]);
}

/**
 * Fetch and build the Potts model on the main thread.
 *
 * The worker already loads this file for the main pipeline, so by the time any
 * screen calls this hook the 49 KB JSON is normally in the browser cache. It
 * exists because the live QAOA on the Quantum screen runs on the main thread
 * (the reduced slices it uses are small enough that a worker round-trip would
 * cost more than the computation) and so needs its own handle on the
 * coefficients.
 */
export function usePottsModel(): {
  readonly model: PottsModel | null;
  readonly error: string | null;
  readonly loading: boolean;
} {
  const [model, setModel] = useState<PottsModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = new URL('model/potts_6class_8mer.json', document.baseURI).href;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`model request failed: ${response.status} ${response.statusText}`);
        }
        return (await response.json()) as PottsModelJson;
      })
      .then((json) => {
        if (cancelled) return;
        // buildModel validates shape, class count and pair order, so a
        // truncated or stale export fails loudly here instead of producing
        // quietly wrong energies downstream.
        setModel(buildModel(json));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'could not load the scoring model');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { model, error, loading: model === null && error === null };
}
