/** Small shared hooks used across screens. */

import { useEffect, useRef, useState } from 'react';

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
