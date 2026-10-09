/**
 * The three plastics, as recognisable objects rather than abbreviations.
 *
 * Someone who has never heard of PET must be able to look at this row and come
 * away with "bottles, bags, tubs - we want the bottle one". The illustrations
 * are deliberately simple line drawings of everyday objects, not chemistry.
 */

import { PLASTIC_INFO, type Plastic } from '../science/potts';

function BottleGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 48 64" width="44" height="58" aria-hidden="true">
      <path
        d="M19 4h10v6c0 2 4 4 4 9v37a4 4 0 01-4 4H19a4 4 0 01-4-4V19c0-5 4-7 4-9V4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M17 3h14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M15 28h18" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
      <path d="M15 34h18" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

function BagGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 56 64" width="48" height="58" aria-hidden="true">
      <path
        d="M11 20h34l-3 38a4 4 0 01-4 4H18a4 4 0 01-4-4L11 20z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M20 20V12a8 8 0 0116 0v8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M18 34c6 3 14 3 20 0" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

function TubGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 56 64" width="48" height="58" aria-hidden="true">
      <path
        d="M12 22h32l-4 36a4 4 0 01-4 4H20a4 4 0 01-4-4L12 22z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect
        x="8"
        y="13"
        width="40"
        height="9"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M17 36h22" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

const GLYPHS: Record<Plastic, () => JSX.Element> = {
  PET: BottleGlyph,
  PE: BagGlyph,
  PP: TubGlyph,
};

export function PlasticCards({
  onSelect,
  selected,
  compact = false,
}: {
  readonly onSelect?: (plastic: Plastic) => void;
  readonly selected?: Plastic | null;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <ul
      className="grid-auto"
      style={{ listStyle: 'none', padding: 0, margin: 0 }}
      aria-label="The three plastics in this study"
    >
      {PLASTIC_INFO.map((info) => {
        const Glyph = GLYPHS[info.id];
        const isTarget = info.role === 'target';
        const colour = `var(--c-${info.id.toLowerCase()})`;
        const isSelected = selected === info.id;
        const interactive = Boolean(onSelect);

        const inner = (
          <>
            <div
              className="spread"
              style={{ alignItems: 'flex-start', marginBottom: 'var(--s-3)' }}
            >
              <span style={{ color: colour }}>
                <Glyph />
              </span>
              <span
                className="badge"
                style={{
                  borderColor: colour,
                  color: colour,
                  background: `color-mix(in srgb, ${colour} 12%, transparent)`,
                }}
              >
                {isTarget ? 'Target - stick to this' : 'Avoid - do not stick'}
              </span>
            </div>
            <h3 style={{ fontSize: 'var(--fs-lg)', color: colour }}>{info.everyday}</h3>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-1)' }}>
              <strong style={{ color: 'var(--text)' }}>{info.id}</strong> &mdash;{' '}
              {info.chemical}
            </p>
            {compact ? null : (
              <>
                <p style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>{info.plain}</p>
                <ul
                  className="faint"
                  style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}
                >
                  {info.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        );

        return (
          <li key={info.id}>
            {interactive ? (
              <button
                type="button"
                className={`card card-interactive ${isSelected ? 'card-selected' : ''}`}
                style={{ width: '100%', textAlign: 'left', display: 'block' }}
                aria-pressed={isSelected}
                onClick={() => onSelect?.(info.id)}
              >
                {inner}
              </button>
            ) : (
              <div className="card">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
