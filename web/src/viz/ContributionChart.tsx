/**
 * Per-position contribution chart.
 *
 * This replaces the old conceptual "peptide approaching a surface" drawing.
 * Every bar here is a real number from the Potts model: the one-body term
 * `linear[position][class]` that the chosen class contributes to that
 * plastic's score. The bars sum, with the pair terms and the intercept, to
 * exactly the score shown elsewhere on the page - which is stated in the
 * caption and is why a chart is the honest form for this information and a
 * cartoon was not.
 *
 * Reading it: a taller PET bar than PE/PP bar at a position means the model
 * prefers that building-block family at that position for the target. Nothing
 * about atoms, distances or binding poses is implied or drawn.
 */

import { useId, useState } from 'react';

import { CLASS_INFO } from '../science/alphabet';
import { PLASTIC_INFO, type Plastic } from '../science/potts';
import type { ResidueTemplate } from '../chem/residues';

export interface ContributionChartProps {
  readonly codes: readonly number[];
  /** `contributions(codes, model.flat[plastic]).positions` for each plastic. */
  readonly perPosition: Readonly<Record<Plastic, readonly number[]>>;
  /** Residue actually displayed at each position, for the axis labels. */
  readonly residues?: readonly ResidueTemplate[];
  /** Position (0-based) to emphasise, or null. */
  readonly focusPosition?: number | null;
  readonly onFocusPosition?: (position: number | null) => void;
  readonly height?: number;
}

const PAD = { top: 16, right: 12, bottom: 64, left: 56 };
const WIDTH = 760;

function niceBounds(values: number[]): [number, number] {
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const pad = span * 0.12;
  return [min - pad, max + pad];
}

function tickValues(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function ContributionChart({
  codes,
  perPosition,
  residues,
  focusPosition = null,
  onFocusPosition,
  height = 300,
}: ContributionChartProps): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const n = codes.length;
  const band = innerW / n;
  const barWidth = Math.min(16, (band - 14) / 3);

  const all = PLASTIC_INFO.flatMap((info) => [...(perPosition[info.id] ?? [])]);
  const [lo, hi] = niceBounds(all);
  const yOf = (value: number) => innerH - ((value - lo) / (hi - lo)) * innerH;
  const zero = yOf(0);
  const active = hover ?? focusPosition;

  const summary =
    `Grouped bar chart. For each of the ${n} positions it shows the one-body contribution of the ` +
    `selected building-block family to the PET, PE and PP model scores. ` +
    codes
      .map((code, i) => {
        const label = `position ${i + 1} (${CLASS_INFO[code].name})`;
        const values = PLASTIC_INFO.map(
          (info) => `${info.id} ${(perPosition[info.id]?.[i] ?? 0).toFixed(2)}`,
        ).join(', ');
        return `${label}: ${values}`;
      })
      .join('. ');

  return (
    <figure className="plot" style={{ margin: 0 }}>
      <div className="plot-head">
        <div>
          <div className="plot-title">One-body score contribution, by position</div>
          <div className="plot-sub">
            Dimensionless model units. Higher is better for PET, lower is better for PE and PP.
          </div>
        </div>
        <div className="legend">
          {PLASTIC_INFO.map((info) => (
            <span className="legend-item" key={info.id}>
              <span
                className="legend-key"
                style={{
                  ['--legend-colour' as string]: `var(--c-${info.id.toLowerCase()})`,
                  background: `var(--c-${info.id.toLowerCase()})`,
                }}
              />
              {info.id}
              {info.role === 'target' ? ' (target)' : ''}
            </span>
          ))}
        </div>
      </div>

      <div className="scroll-x">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width="100%"
          style={{ minWidth: 520, maxWidth: '100%', height: 'auto', overflow: 'visible' }}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>One-body score contribution by position</title>
          <desc id={descId}>{summary}</desc>
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {tickValues(lo, hi).map((value) => (
              <g key={value}>
                <line className="axis-grid" x1={0} x2={innerW} y1={yOf(value)} y2={yOf(value)} />
                <text
                  className="axis-text"
                  x={-8}
                  y={yOf(value)}
                  textAnchor="end"
                  dy="0.32em"
                >
                  {value.toFixed(1)}
                </text>
              </g>
            ))}
            <line className="axis-line" x1={0} x2={innerW} y1={zero} y2={zero} />

            {codes.map((code, i) => {
              const x0 = i * band;
              const info = CLASS_INFO[code];
              const residue = residues?.[i];
              const isActive = active === i;
              return (
                <g key={i}>
                  {isActive ? (
                    <rect
                      x={x0 + 1}
                      y={0}
                      width={band - 2}
                      height={innerH}
                      fill="var(--accent)"
                      opacity={0.07}
                    />
                  ) : null}
                  {PLASTIC_INFO.map((plastic, p) => {
                    const value = perPosition[plastic.id]?.[i] ?? 0;
                    const y = yOf(value);
                    const top = Math.min(y, zero);
                    const barHeight = Math.max(1.5, Math.abs(zero - y));
                    const cx = x0 + band / 2 + (p - 1) * (barWidth + 3) - barWidth / 2;
                    return (
                      <rect
                        key={plastic.id}
                        x={cx}
                        y={top}
                        width={barWidth}
                        height={barHeight}
                        rx={1.5}
                        fill={`var(--c-${plastic.id.toLowerCase()})`}
                        opacity={active === null || isActive ? 1 : 0.42}
                      />
                    );
                  })}

                  {/* Position label: the class symbol plus the residue shown. */}
                  <text
                    className="axis-text"
                    x={x0 + band / 2}
                    y={innerH + 16}
                    textAnchor="middle"
                    fill={isActive ? 'var(--text-strong)' : undefined}
                  >
                    {i + 1}
                  </text>
                  <text
                    x={x0 + band / 2}
                    y={innerH + 31}
                    textAnchor="middle"
                    fontSize={11}
                    fontFamily="var(--font-mono)"
                    fill={`var(${info.token})`}
                  >
                    {info.symbol}
                  </text>
                  {residue ? (
                    <text
                      x={x0 + band / 2}
                      y={innerH + 45}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily="var(--font-mono)"
                      fill="var(--text-faint)"
                    >
                      {residue.code3}
                    </text>
                  ) : null}

                  {/* Pointer hit area only. The SVG is role="img" and must
                      not contain interactive controls; keyboard and screen
                      reader access to the same information is the real button
                      row underneath the chart. */}
                  <rect
                    x={x0}
                    y={0}
                    width={band}
                    height={innerH + 48}
                    fill="transparent"
                    aria-hidden="true"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onFocusPosition?.(focusPosition === i ? null : i)}
                    style={{ cursor: onFocusPosition ? 'pointer' : 'default' }}
                  />
                </g>
              );
            })}

            <text className="axis-label" x={innerW / 2} y={innerH + 62} textAnchor="middle">
              Position in the eight-residue design
            </text>
            <text
              className="axis-label"
              transform={`rotate(-90) translate(${-innerH / 2}, ${-PAD.left + 14})`}
              textAnchor="middle"
            >
              Contribution to score
            </text>
          </g>
        </svg>
      </div>

      <div className="position-picker" role="group" aria-label="Inspect one position">
        {codes.map((code, i) => {
          const info = CLASS_INFO[code];
          const residue = residues?.[i];
          return (
            <button
              key={i}
              type="button"
              className="position-pick"
              aria-pressed={focusPosition === i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onFocusPosition?.(focusPosition === i ? null : i)}
            >
              <span className="position-pick-index">{i + 1}</span>
              <span className="sr-only">
                {`${info.name}${residue ? `, shown as ${residue.name}` : ''}. ` +
                  PLASTIC_INFO.map(
                    (plastic) =>
                      `${plastic.id} contribution ${(perPosition[plastic.id]?.[i] ?? 0).toFixed(3)}`,
                  ).join(', ')}
              </span>
              <span className="position-pick-dot" style={{ background: `var(${info.token})` }} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <figcaption className="plot-sub" style={{ marginTop: 'var(--s-2)' }}>
        {active !== null ? (
          <>
            <strong style={{ color: 'var(--text-strong)' }}>
              Position {active + 1} &middot; {CLASS_INFO[codes[active]].name}
            </strong>{' '}
            {PLASTIC_INFO.map(
              (plastic) =>
                `${plastic.id} ${(perPosition[plastic.id]?.[active] ?? 0).toFixed(3)}`,
            ).join('  ·  ')}
            . {CLASS_INFO[codes[active]].property}.
          </>
        ) : (
          <>
            These eight one-body terms plus the 28 pair terms and the model intercept sum exactly
            to each plastic score. Hover or focus a position for its numbers.
          </>
        )}
      </figcaption>
    </figure>
  );
}
