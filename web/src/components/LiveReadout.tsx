/**
 * The compact "what just changed" strip that sits next to a control.
 *
 * Why this exists: every screen had its controls at the top and the numbers
 * those controls move several screens further down. Editing a design meant
 * drag, scroll down, read, scroll up, drag again. The detailed panels are
 * still worth having - they carry the units, the provenance and the
 * explanation - but the immediate feedback has to be where the hand is.
 *
 * So this is deliberately small: a row of values with their change since the
 * last edit, sticky inside its own column, and nothing else. It never
 * introduces a number that is not already shown in full further down, and it
 * never computes one of its own - the caller passes values that came from the
 * same worker response as the detailed panels, so the two cannot disagree.
 */

import type { ReactNode } from 'react';

import { DeltaChip } from './primitives';

export interface ReadoutItem {
  readonly label: string;
  /** Already formatted by the caller, so this component never rounds. */
  readonly value: string;
  readonly tone?: 'pet' | 'pe' | 'pp' | 'good' | 'warn' | 'plain';
  readonly delta?: { readonly value: number; readonly betterWhen: 'higher' | 'lower' } | null;
}

export function LiveReadout({
  items,
  caption,
  note,
  pending = false,
  sticky = true,
  children,
}: {
  readonly items: readonly ReadoutItem[];
  /** Short line above the values, naming what they describe. */
  readonly caption?: string;
  /** Short line below, for a status or a nudge. */
  readonly note?: ReactNode;
  /** True while a recomputation is in flight: values are dimmed, not replaced. */
  readonly pending?: boolean;
  /**
   * Stick to the top of the scroll container. Right when the readout belongs
   * to a long scrolling column (the Build editor); wrong when it already sits
   * inside the same card as its control, where sticking would detach it from
   * the thing it describes.
   */
  readonly sticky?: boolean;
  readonly children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="live-readout"
      data-sticky={sticky ? 'yes' : 'no'}
      data-pending={pending ? 'yes' : undefined}
    >
      {caption ? <p className="live-readout-caption">{caption}</p> : null}
      <dl className="live-readout-row">
        {items.map((item) => (
          <div
            key={item.label}
            className="live-readout-item"
            data-tone={item.tone && item.tone !== 'plain' ? item.tone : undefined}
          >
            <dt>{item.label}</dt>
            <dd>
              <span className="live-readout-value">{item.value}</span>
              {item.delta ? (
                <DeltaChip value={item.delta.value} betterWhen={item.delta.betterWhen} />
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <div className="live-readout-note">{note}</div> : null}
      {children}
      {/* Values update without a visible reflow, so a screen reader needs to be
          told. Polite, because an edit is user-initiated and not urgent. */}
      <span className="sr-only" role="status" aria-live="polite">
        {pending
          ? 'Recomputing scores.'
          : items.map((item) => `${item.label} ${item.value}`).join('. ')}
      </span>
    </div>
  );
}
