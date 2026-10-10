/**
 * Choose the concrete amino acid shown at each position.
 *
 * The scientific point this component exists to make visible: the optimiser
 * searches CLASSES, and a class is not one amino acid. The class chip at the
 * top of each cell is what the optimiser decided; the select underneath is a
 * choice the user makes so that a real molecule can be drawn. Changing it
 * changes the molecule and changes no score, and the panel says so once.
 */

import { CLASS_INFO } from '../science/alphabet';
import { residueOptions } from '../chem/peptide';
import { residueFor } from '../chem/residues';

export interface ResiduePickerProps {
  /** Class index per position, from the optimiser or the builder. */
  readonly codes: readonly number[];
  /** Currently chosen residue per position. */
  readonly residues: readonly string[];
  readonly onChange: (position: number, residue: string) => void;
  /** Position to emphasise, 0-based. */
  readonly focusPosition?: number | null;
  readonly onFocusPosition?: (position: number | null) => void;
  readonly disabled?: boolean;
  readonly idPrefix?: string;
}

export function ResiduePicker({
  codes,
  residues,
  onChange,
  focusPosition = null,
  onFocusPosition,
  disabled = false,
  idPrefix = 'residue',
}: ResiduePickerProps): JSX.Element {
  return (
    <div className="residue-grid">
      {codes.map((classIndex, position) => {
        const info = CLASS_INFO[classIndex];
        const options = residueOptions(classIndex);
        const chosen = residues[position] ?? info.representative;
        const template = residueFor(chosen);
        const selectId = `${idPrefix}-${position}`;
        return (
          <div
            key={position}
            className="residue-cell"
            data-active={focusPosition === position ? 'true' : 'false'}
            onMouseEnter={() => onFocusPosition?.(position)}
            onMouseLeave={() => onFocusPosition?.(null)}
          >
            <div className="residue-cell-head">
              <span className="residue-cell-pos">{position + 1}</span>
              <span className="residue-class-chip" title={info.name}>
                <span className="dot" style={{ background: `var(${info.token})` }} aria-hidden="true" />
                {info.symbol}
              </span>
            </div>
            <label className="sr-only" htmlFor={selectId}>
              Amino acid shown at position {position + 1}, chosen from the {info.name} family
            </label>
            <select
              id={selectId}
              value={chosen}
              disabled={disabled || options.length < 2}
              onChange={(event) => onChange(position, event.target.value)}
              onFocus={() => onFocusPosition?.(position)}
              onBlur={() => onFocusPosition?.(null)}
            >
              {options.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} &nbsp;{option.code3}
                </option>
              ))}
            </select>
            <span className="residue-cell-note">
              {options.length === 1
                ? 'Only member of this family'
                : `1 of ${options.length} in this family`}
              {' · '}
              {template.polarity}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A compact read-only sequence readout in three-letter codes. */
export function ResidueSequenceReadout({
  residues,
}: {
  readonly residues: readonly string[];
}): JSX.Element {
  return (
    <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
      H<sub>2</sub>N&ndash;
      {residues.map((code, i) => (
        <span key={i}>
          {i > 0 ? '-' : ''}
          {residueFor(code).code3}
        </span>
      ))}
      &ndash;COOH
    </span>
  );
}
