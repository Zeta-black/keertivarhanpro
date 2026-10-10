/**
 * The eight-position peptide chain and the six-family palette.
 *
 * Three input methods, all first-class - no feature requires dragging:
 *   mouse     drag a family from the palette onto a position
 *   touch     tap a family to arm it, then tap a position
 *   keyboard  arrow keys move between positions, 1-6 place a family
 *
 * Validity is structural: a position always holds exactly one family, so the
 * one-hot encoding cannot be broken by the UI. The Understand screen shows what
 * a broken encoding would cost, using a deliberately invalid vector.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { CLASS_INFO, LENGTH, type ClassInfo } from '../science/alphabet';

export interface PeptideChainProps {
  readonly codes: number[];
  readonly onChange: (position: number, classIndex: number) => void;
  /** Positions that differ from the comparison sequence get a marker. */
  readonly changedPositions?: readonly number[];
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly idPrefix?: string;
  /** Family currently armed by tap-to-place, if any. */
  readonly armedClass?: number | null;
  readonly onConsumeArmed?: () => void;
}

export function PeptideChain({
  codes,
  onChange,
  changedPositions = [],
  disabled = false,
  compact = false,
  idPrefix = 'chain',
  armedClass = null,
  onConsumeArmed,
}: PeptideChainProps): JSX.Element {
  const [focused, setFocused] = useState(0);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [justChanged, setJustChanged] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const changedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (changedTimer.current) window.clearTimeout(changedTimer.current);
    },
    [],
  );

  const place = useCallback(
    (position: number, classIndex: number) => {
      if (disabled) return;
      if (classIndex < 0 || classIndex >= CLASS_INFO.length) return;
      onChange(position, classIndex);
      setJustChanged(position);
      if (changedTimer.current) window.clearTimeout(changedTimer.current);
      changedTimer.current = window.setTimeout(() => setJustChanged(null), 450);
      onConsumeArmed?.();
    },
    [disabled, onChange, onConsumeArmed],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent, position: number) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(LENGTH - 1, position + 1);
        setFocused(next);
        refs.current[next]?.focus();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, position - 1);
        setFocused(next);
        refs.current[next]?.focus();
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setFocused(0);
        refs.current[0]?.focus();
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setFocused(LENGTH - 1);
        refs.current[LENGTH - 1]?.focus();
        return;
      }
      // 1-6 place a family directly. This is the keyboard equivalent of a drag.
      if (/^[1-6]$/.test(event.key)) {
        event.preventDefault();
        place(position, Number(event.key) - 1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (armedClass !== null) place(position, armedClass);
        else {
          // No family armed: cycle to the next family so Enter always does something.
          place(position, (codes[position] + 1) % CLASS_INFO.length);
        }
      }
    },
    [armedClass, codes, place],
  );

  return (
    <div
      className="chain"
      role="group"
      aria-label="Peptide sequence, eight positions"
      style={{ gap: compact ? 2 : 4 }}
    >
      {codes.map((classIndex, position) => {
        const info = CLASS_INFO[classIndex];
        const changed = changedPositions.includes(position);
        return (
          <div className="chain-slot" key={`${idPrefix}-${position}`}>
            <button
              ref={(el) => {
                refs.current[position] = el;
              }}
              type="button"
              className="block"
              data-class={info.id}
              data-dragover={dragOver === position}
              data-changed={justChanged === position}
              data-selected={focused === position}
              disabled={disabled}
              tabIndex={position === focused ? 0 : -1}
              aria-label={
                `Position ${position + 1} of ${LENGTH}: ${info.name}` +
                `${changed ? ', changed from the comparison sequence' : ''}` +
                `. ${info.plain} Press 1 to 6 to change it.`
              }
              onFocus={() => setFocused(position)}
              onKeyDown={(event) => onKeyDown(event, position)}
              onClick={() => {
                if (armedClass !== null) place(position, armedClass);
                else setFocused(position);
              }}
              onDragOver={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                setDragOver(position);
              }}
              onDragLeave={() => setDragOver((v) => (v === position ? null : v))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const raw = event.dataTransfer.getData('text/plain');
                const parsed = Number(raw);
                if (Number.isInteger(parsed)) place(position, parsed);
              }}
              style={compact ? { minHeight: 46 } : undefined}
            >
              <span className="block-symbol">{info.symbol}</span>
              {compact ? null : <span className="block-residue">{info.representative}</span>}
              {changed ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    boxShadow: '0 0 0 2px var(--surface)',
                  }}
                />
              ) : null}
            </button>
            <span className="slot-index" aria-hidden="true">
              {position + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ */
export function ClassPalette({
  armedClass,
  onArm,
  disabled = false,
}: {
  readonly armedClass: number | null;
  readonly onArm: (classIndex: number | null) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <div>
      <div className="palette">
        {CLASS_INFO.map((info) => (
          <button
            key={info.id}
            type="button"
            className="palette-item"
            data-class={info.id}
            disabled={disabled}
            draggable={!disabled}
            aria-pressed={armedClass === info.index}
            aria-label={
              `${info.name}, family ${info.index + 1} of 6. ${info.property}. ` +
              `Contains ${info.residues.join(', ')}. ` +
              `${armedClass === info.index ? 'Armed: now choose a position.' : 'Select, then choose a position.'}`
            }
            onClick={() => onArm(armedClass === info.index ? null : info.index)}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', String(info.index));
              event.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <span className="palette-swatch" aria-hidden="true">
              {info.symbol}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="palette-name">{info.name}</span>
              <span className="palette-meta">
                {info.index + 1} &middot; {info.residues.join(' ')}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
        Each option is a FAMILY of amino acids. The letter on a block is one representative
        member, for readability; the optimiser never distinguishes members within a family.
      </p>
    </div>
  );
}

/** A read-only sequence rendering, used in tables, cards and the podium. */
export function SequenceGlyph({
  codes,
  size = 'md',
  showResidues = false,
}: {
  readonly codes: readonly number[];
  readonly size?: 'sm' | 'md';
  readonly showResidues?: boolean;
}): JSX.Element {
  const dimension = size === 'sm' ? 16 : 24;
  return (
    <span
      className="row"
      style={{ gap: 2 }}
      role="img"
      aria-label={`Sequence: ${codes.map((c) => CLASS_INFO[c].name).join(', then ')}`}
    >
      {codes.map((c, i) => {
        const info: ClassInfo = CLASS_INFO[c];
        return (
          <span
            key={i}
            data-class={info.id}
            title={`Position ${i + 1}: ${info.name}`}
            style={{
              width: dimension,
              height: dimension,
              borderRadius: 4,
              background: 'var(--block-colour)',
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: size === 'sm' ? 9 : 11,
              fontWeight: 700,
              color: 'var(--text-on-block)',
              flex: 'none',
            }}
          >
            {showResidues ? info.representative : ''}
          </span>
        );
      })}
    </span>
  );
}
