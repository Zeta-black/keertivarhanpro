/**
 * Beginner and Researcher mode.
 *
 * The rule these helpers exist to enforce: the two modes change what is
 * EXPLAINED and what is EXPOSED, never what is COMPUTED. Both modes read the
 * same scores from the same worker, with the same seed, and must never show
 * different numbers for the same design. A mode that changed a result would be
 * a fabrication, so no helper here accepts a value - only content and
 * controls.
 *
 * What each mode is for:
 *
 *   Beginner    Someone with a general engineering background and no
 *               biotechnology. Plain words first, equations hidden, advanced
 *               parameters hidden behind their defaults, fewer columns, and a
 *               short "what am I looking at" line on anything unfamiliar.
 *
 *   Researcher  Someone who wants to check the work. Equations shown, raw
 *               coefficients and seeds exposed, full-precision values, every
 *               table column, methodology expanded by default.
 */

import type { ReactNode } from 'react';

import { useStore } from '../state/store';
import type { ExplanationMode } from '../state/types';

export function useMode(): {
  readonly mode: ExplanationMode;
  readonly researcher: boolean;
  readonly beginner: boolean;
} {
  const { state } = useStore();
  return {
    mode: state.mode,
    researcher: state.mode === 'researcher',
    beginner: state.mode === 'beginner',
  };
}

/** Renders its children only in Researcher mode. */
export function Researcher({ children }: { readonly children: ReactNode }): JSX.Element | null {
  const { researcher } = useMode();
  return researcher ? <>{children}</> : null;
}

/** Renders its children only in Beginner mode. */
export function Beginner({ children }: { readonly children: ReactNode }): JSX.Element | null {
  const { beginner } = useMode();
  return beginner ? <>{children}</> : null;
}

/**
 * Two renderings of the same fact, one per mode.
 *
 * Use this rather than two sibling `<Beginner>`/`<Researcher>` blocks whenever
 * the content is the SAME information at two levels of detail, because it
 * keeps the two versions next to each other in the source where they can be
 * kept consistent.
 */
export function ModeSplit({
  beginner,
  researcher,
}: {
  readonly beginner: ReactNode;
  readonly researcher: ReactNode;
}): JSX.Element {
  const { researcher: isResearcher } = useMode();
  return <>{isResearcher ? researcher : beginner}</>;
}

/**
 * Number of decimal places to print.
 *
 * Beginner mode rounds to something a reader can hold in their head;
 * Researcher mode shows the precision needed to reproduce a comparison. The
 * underlying value is identical - only its rendering changes.
 */
export function useDigits(beginnerDigits = 2, researcherDigits = 4): number {
  const { researcher } = useMode();
  return researcher ? researcherDigits : beginnerDigits;
}

/**
 * A short plain-language gloss shown only to beginners.
 *
 * Deliberately not a tooltip: a beginner should not have to discover that a
 * word is explained somewhere. In Researcher mode it disappears entirely
 * rather than collapsing, because the clutter is the whole cost.
 */
export function PlainNote({ children }: { readonly children: ReactNode }): JSX.Element | null {
  const { beginner } = useMode();
  if (!beginner) return null;
  return <p className="plain-note">{children}</p>;
}

/** The equation block, shown only in Researcher mode. */
export function Equation({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}): JSX.Element | null {
  const { researcher } = useMode();
  if (!researcher) return null;
  return (
    <figure className="equation">
      <pre className="equation-body scroll-x">{children}</pre>
      {label ? <figcaption>{label}</figcaption> : null}
    </figure>
  );
}
