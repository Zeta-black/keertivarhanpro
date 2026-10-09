/**
 * Chart primitives, hand-built as inline SVG.
 *
 * Why not a chart library: these need to follow the theme tokens exactly in
 * both light and dark, be keyboard reachable, carry shapes as well as colours
 * in legends, and export as standalone SVG. Owning ~400 lines of SVG is a
 * smaller cost than fighting a library on all four.
 *
 * Accessibility contract for every chart here:
 *  - role="img" with a text summary, plus a <title>/<desc> pair
 *  - axis labels name the quantity AND its units
 *  - no information carried by colour alone
 *  - every chart is accompanied by a real table elsewhere on the screen
 */

import { useId, useMemo, useRef, useState } from 'react';

const PAD = { top: 16, right: 18, bottom: 44, left: 58 };

export interface Scale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as Scale;
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** Round a domain outward to tidy tick values. */
function niceDomain(min: number, max: number, pad = 0.06): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const span = max - min;
  return [min - span * pad, max + span * pad];
}

function ticks(domain: [number, number], count = 5): number[] {
  const [d0, d1] = domain;
  const step = (d1 - d0) / (count - 1);
  return Array.from({ length: count }, (_, i) => d0 + i * step);
}

function fmt(value: number): string {
  if (Math.abs(value) >= 10000) return value.toExponential(1);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

/* ------------------------------------------------------------------ *
 * Shared frame
 * ------------------------------------------------------------------ */
export interface PlotFrameProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly summary: string;
  readonly width?: number;
  readonly height?: number;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xDomain: [number, number];
  readonly yDomain: [number, number];
  readonly legend?: readonly { label: string; colour: string; shape?: 'square' | 'round' | 'line' }[];
  readonly children: (ctx: { x: Scale; y: Scale; w: number; h: number }) => React.ReactNode;
  readonly svgRef?: React.Ref<SVGSVGElement>;
  readonly footer?: React.ReactNode;
}

export function PlotFrame({
  title,
  subtitle,
  summary,
  width = 640,
  height = 300,
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  legend,
  children,
  svgRef,
  footer,
}: PlotFrameProps): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = linearScale(xDomain, [0, innerW]);
  const y = linearScale(yDomain, [innerH, 0]);

  return (
    <figure className="plot" style={{ margin: 0 }}>
      <div className="plot-head">
        <div>
          <div className="plot-title">{title}</div>
          {subtitle ? <div className="plot-sub">{subtitle}</div> : null}
        </div>
        {legend ? (
          <div className="legend">
            {legend.map((item) => (
              <span className="legend-item" key={item.label}>
                <span
                  className={`legend-key ${
                    item.shape === 'round'
                      ? 'legend-key-round'
                      : item.shape === 'line'
                        ? 'legend-key-line'
                        : ''
                  }`}
                  style={{ ['--legend-colour' as string]: item.colour, background: item.colour }}
                />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="scroll-x">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 420, maxWidth: '100%', height: 'auto', overflow: 'visible' }}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>{summary}</desc>
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* horizontal gridlines + y ticks */}
            {ticks(yDomain).map((value) => (
              <g key={`y${value}`}>
                <line className="axis-grid" x1={0} x2={innerW} y1={y(value)} y2={y(value)} />
                <text className="axis-text" x={-8} y={y(value)} textAnchor="end" dy="0.32em">
                  {fmt(value)}
                </text>
              </g>
            ))}
            {/* x ticks */}
            {ticks(xDomain).map((value) => (
              <g key={`x${value}`}>
                <text
                  className="axis-text"
                  x={x(value)}
                  y={innerH + 18}
                  textAnchor="middle"
                >
                  {fmt(value)}
                </text>
              </g>
            ))}
            {/* zero line, when zero is inside the y range */}
            {yDomain[0] < 0 && yDomain[1] > 0 ? (
              <line
                className="axis-line"
                x1={0}
                x2={innerW}
                y1={y(0)}
                y2={y(0)}
                strokeDasharray="4 3"
              />
            ) : null}
            <line className="axis-line" x1={0} x2={innerW} y1={innerH} y2={innerH} />
            <line className="axis-line" x1={0} x2={0} y1={0} y2={innerH} />
            {children({ x, y, w: innerW, h: innerH })}
            <text
              className="axis-label"
              x={innerW / 2}
              y={innerH + 38}
              textAnchor="middle"
            >
              {xLabel}
            </text>
            <text
              className="axis-label"
              transform={`rotate(-90) translate(${-innerH / 2}, ${-PAD.left + 14})`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          </g>
        </svg>
      </div>
      {footer ? <figcaption className="plot-sub" style={{ marginTop: 'var(--s-2)' }}>{footer}</figcaption> : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Multi-series line chart with focusable points
 * ------------------------------------------------------------------ */
export interface LineSeries {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
  readonly points: readonly { x: number; y: number }[];
  readonly dashed?: boolean;
}

export function LineChart({
  title,
  subtitle,
  xLabel,
  yLabel,
  series,
  height = 300,
  highlightX,
  onPointSelect,
  valueFormatter = (v: number) => v.toFixed(2),
  svgRef,
  footer,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly series: readonly LineSeries[];
  readonly height?: number;
  readonly highlightX?: number | null;
  readonly onPointSelect?: (seriesId: string, x: number) => void;
  readonly valueFormatter?: (value: number) => string;
  readonly svgRef?: React.Ref<SVGSVGElement>;
  readonly footer?: React.ReactNode;
}): JSX.Element {
  const all = series.flatMap((s) => s.points);
  const xDomain = useMemo<[number, number]>(() => {
    if (all.length === 0) return [0, 1];
    return [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))];
  }, [all]);
  const yDomain = useMemo<[number, number]>(() => {
    if (all.length === 0) return [0, 1];
    return niceDomain(Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)));
  }, [all]);

  const summary =
    `Line chart. ${xLabel} on the horizontal axis, ${yLabel} on the vertical axis. ` +
    series
      .map(
        (s) =>
          `${s.label} goes from ${valueFormatter(s.points[0]?.y ?? 0)} at ${fmt(
            s.points[0]?.x ?? 0,
          )} to ${valueFormatter(s.points[s.points.length - 1]?.y ?? 0)} at ${fmt(
            s.points[s.points.length - 1]?.x ?? 0,
          )}.`,
      )
      .join(' ');

  return (
    <PlotFrame
      title={title}
      subtitle={subtitle}
      summary={summary}
      height={height}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={xDomain}
      yDomain={yDomain}
      legend={series.map((s) => ({ label: s.label, colour: s.colour, shape: 'line' as const }))}
      svgRef={svgRef}
      footer={footer}
    >
      {({ x, y, h }) => (
        <>
          {highlightX !== null && highlightX !== undefined ? (
            <line
              x1={x(highlightX)}
              x2={x(highlightX)}
              y1={0}
              y2={h}
              stroke="var(--accent)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              opacity={0.75}
            />
          ) : null}
          {series.map((s) => (
            <g key={s.id}>
              <path
                d={s.points
                  .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x)},${y(p.y)}`)
                  .join(' ')}
                stroke={s.colour}
                strokeWidth={2.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? '6 4' : undefined}
                fill="none"
              />
              {s.points.map((p) => (
                <g key={`${s.id}-${p.x}`}>
                  <circle
                    cx={x(p.x)}
                    cy={y(p.y)}
                    r={4.5}
                    fill="var(--surface)"
                    stroke={s.colour}
                    strokeWidth={2.2}
                  />
                  {/* A generous, invisible hit area for touch and mouse. */}
                  <circle
                    cx={x(p.x)}
                    cy={y(p.y)}
                    r={14}
                    fill="transparent"
                    style={{ cursor: onPointSelect ? 'pointer' : 'default' }}
                    tabIndex={onPointSelect ? 0 : -1}
                    role={onPointSelect ? 'button' : undefined}
                    aria-label={`${s.label} at ${xLabel} ${fmt(p.x)}: ${valueFormatter(p.y)}`}
                    onClick={() => onPointSelect?.(s.id, p.x)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onPointSelect?.(s.id, p.x);
                      }
                    }}
                  />
                </g>
              ))}
            </g>
          ))}
        </>
      )}
    </PlotFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Scatter with a highlighted Pareto frontier
 * ------------------------------------------------------------------ */
export function ScatterChart({
  title,
  subtitle,
  xLabel,
  yLabel,
  points,
  height = 340,
  selectedIndex,
  onSelect,
  footer,
  svgRef,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly points: readonly {
    index: number;
    x: number;
    y: number;
    onFrontier: boolean;
    label?: string;
  }[];
  readonly height?: number;
  readonly selectedIndex?: number | null;
  readonly onSelect?: (index: number) => void;
  readonly footer?: React.ReactNode;
  readonly svgRef?: React.Ref<SVGSVGElement>;
}): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const xDomain = useMemo<[number, number]>(
    () =>
      points.length
        ? niceDomain(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)))
        : [0, 1],
    [points],
  );
  const yDomain = useMemo<[number, number]>(
    () =>
      points.length
        ? niceDomain(Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)))
        : [0, 1],
    [points],
  );
  const frontier = points.filter((p) => p.onFrontier).sort((a, b) => a.x - b.x);

  return (
    <PlotFrame
      title={title}
      subtitle={subtitle}
      summary={
        `Scatter plot of ${points.length} sampled designs. ${xLabel} horizontally, ` +
        `${yLabel} vertically. ${frontier.length} designs lie on the best-trade-off frontier.`
      }
      height={height}
      xLabel={xLabel}
      yLabel={yLabel}
      xDomain={xDomain}
      yDomain={yDomain}
      legend={[
        { label: 'Sampled design', colour: 'var(--text-faint)', shape: 'round' },
        { label: 'Best trade-off (frontier)', colour: 'var(--success)', shape: 'round' },
        { label: 'Selected', colour: 'var(--accent)', shape: 'round' },
      ]}
      svgRef={svgRef}
      footer={footer}
    >
      {({ x, y }) => (
        <>
          {frontier.length > 1 ? (
            <path
              d={frontier.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.x)},${y(p.y)}`).join(' ')}
              stroke="var(--success)"
              strokeWidth={1.8}
              strokeDasharray="5 4"
              fill="none"
              opacity={0.8}
            />
          ) : null}
          {points.map((p) => {
            const selected = selectedIndex === p.index;
            const isHover = hover === p.index;
            return (
              <circle
                key={p.index}
                cx={x(p.x)}
                cy={y(p.y)}
                r={selected ? 7 : p.onFrontier ? 4.5 : 2.8}
                fill={
                  selected
                    ? 'var(--accent)'
                    : p.onFrontier
                      ? 'var(--success)'
                      : 'var(--text-faint)'
                }
                stroke={selected || isHover ? 'var(--text-strong)' : 'none'}
                strokeWidth={selected || isHover ? 1.8 : 0}
                opacity={selected || p.onFrontier ? 1 : 0.5}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                tabIndex={p.onFrontier && onSelect ? 0 : -1}
                role={onSelect ? 'button' : undefined}
                aria-label={
                  p.label ??
                  `Design ${p.index}: ${xLabel} ${fmt(p.x)}, ${yLabel} ${fmt(p.y)}` +
                    (p.onFrontier ? ', on the frontier' : '')
                }
                onMouseEnter={() => setHover(p.index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p.index)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(p.index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(p.index);
                  }
                }}
              />
            );
          })}
        </>
      )}
    </PlotFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Horizontal score bars with a real zero line
 * ------------------------------------------------------------------ */
export function ScoreBars({
  rows,
  domain,
  digits = 2,
}: {
  readonly rows: readonly {
    label: string;
    value: number;
    colour: string;
    direction: 'higher' | 'lower';
  }[];
  readonly domain?: [number, number];
  readonly digits?: number;
}): JSX.Element {
  const values = rows.map((r) => r.value);
  const [lo, hi] = domain ?? [Math.min(0, ...values), Math.max(0, ...values)];
  const span = hi - lo || 1;
  const pct = (value: number) => ((value - lo) / span) * 100;
  const zeroPct = pct(0);

  return (
    <div className="stack-sm">
      {rows.map((row) => {
        const valuePct = pct(row.value);
        const left = Math.min(valuePct, zeroPct);
        const width = Math.abs(valuePct - zeroPct);
        return (
          <div className="bar-row" key={row.label}>
            <span style={{ fontSize: 'var(--fs-sm)' }}>{row.label}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  ['--bar-colour' as string]: row.colour,
                  background: row.colour,
                  left: `${left}%`,
                  width: `${Math.max(width, 0.6)}%`,
                }}
              />
              {lo < 0 && hi > 0 ? <div className="bar-zero" style={{ left: `${zeroPct}%` }} /> : null}
            </div>
            <span className="bar-value">
              {row.value.toFixed(digits)}
              <span className="sr-only">
                , {row.direction === 'higher' ? 'higher is better' : 'lower is better'}
              </span>
            </span>
          </div>
        );
      })}
      {lo < 0 && hi > 0 ? (
        <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          The dashed line is zero. These scores come from energies, so negative values are normal
          and only the gaps between them are meaningful.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Coefficient heatmap (the real QUBO matrix)
 * ------------------------------------------------------------------ */
export function Heatmap({
  size,
  valueAt,
  maxAbs,
  title,
  subtitle,
  rowLabel,
  colLabel,
  cellTitle,
  onCellSelect,
  footer,
  svgRef,
}: {
  readonly size: number;
  readonly valueAt: (row: number, col: number) => number;
  readonly maxAbs: number;
  readonly title: string;
  readonly subtitle?: string;
  readonly rowLabel: string;
  readonly colLabel: string;
  readonly cellTitle: (row: number, col: number, value: number) => string;
  readonly onCellSelect?: (row: number, col: number) => void;
  readonly footer?: React.ReactNode;
  readonly svgRef?: React.Ref<SVGSVGElement>;
}): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const cell = 13;
  const margin = 46;
  const dimension = size * cell + margin + 10;
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  // Diverging ramp: violet for negative, cyan for positive, transparent at zero.
  const colourFor = (value: number): string => {
    if (maxAbs === 0 || value === 0) return 'transparent';
    const t = Math.min(1, Math.abs(value) / maxAbs);
    const alpha = 0.12 + 0.88 * Math.sqrt(t);
    return value > 0
      ? `color-mix(in srgb, var(--c-pet) ${Math.round(alpha * 100)}%, transparent)`
      : `color-mix(in srgb, var(--optimise) ${Math.round(alpha * 100)}%, transparent)`;
  };

  return (
    <figure className="plot" style={{ margin: 0 }}>
      <div className="plot-head">
        <div>
          <div className="plot-title">{title}</div>
          {subtitle ? <div className="plot-sub">{subtitle}</div> : null}
        </div>
        <div className="legend">
          <span className="legend-item">
            <span className="legend-key" style={{ background: 'var(--optimise)' }} />
            negative (pushes the objective down)
          </span>
          <span className="legend-item">
            <span className="legend-key" style={{ background: 'var(--c-pet)' }} />
            positive (pushes it up)
          </span>
        </div>
      </div>
      <div className="scroll-x">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${dimension} ${dimension}`}
          width="100%"
          style={{ minWidth: 420, maxWidth: 720, height: 'auto' }}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>
            {`A ${size} by ${size} matrix of coupling coefficients between binary variables. ` +
              `The largest absolute coefficient is ${maxAbs.toFixed(3)}. ` +
              `Blocks of six along the diagonal correspond to the six class choices within one position.`}
          </desc>
          <g transform={`translate(${margin},${margin})`}>
            {Array.from({ length: size }, (_, r) =>
              Array.from({ length: size }, (_, c) => {
                const value = valueAt(r, c);
                if (value === 0) return null;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={c * cell}
                    y={r * cell}
                    width={cell - 1}
                    height={cell - 1}
                    rx={2}
                    fill={colourFor(value)}
                    stroke={
                      hover && hover.r === r && hover.c === c ? 'var(--text-strong)' : 'none'
                    }
                    strokeWidth={1.4}
                    style={{ cursor: onCellSelect ? 'pointer' : 'default' }}
                    onMouseEnter={() => setHover({ r, c })}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => onCellSelect?.(r, c)}
                  >
                    <title>{cellTitle(r, c, value)}</title>
                  </rect>
                );
              }),
            )}
            {/* Position-block separators every 6 variables. */}
            {Array.from({ length: 9 }, (_, i) => (
              <g key={`sep${i}`}>
                <line
                  x1={i * 6 * cell - 0.5}
                  x2={i * 6 * cell - 0.5}
                  y1={-4}
                  y2={size * cell}
                  stroke="var(--border-strong)"
                  strokeWidth={i % 8 === 0 ? 1.2 : 0.6}
                  opacity={0.7}
                />
                <line
                  x1={-4}
                  x2={size * cell}
                  y1={i * 6 * cell - 0.5}
                  y2={i * 6 * cell - 0.5}
                  stroke="var(--border-strong)"
                  strokeWidth={i % 8 === 0 ? 1.2 : 0.6}
                  opacity={0.7}
                />
                {i < 8 ? (
                  <>
                    <text
                      className="axis-text"
                      x={i * 6 * cell + 3 * cell}
                      y={-10}
                      textAnchor="middle"
                    >
                      {i + 1}
                    </text>
                    <text
                      className="axis-text"
                      x={-10}
                      y={i * 6 * cell + 3 * cell}
                      textAnchor="end"
                      dy="0.32em"
                    >
                      {i + 1}
                    </text>
                  </>
                ) : null}
              </g>
            ))}
            <text className="axis-label" x={size * cell * 0.5} y={-28} textAnchor="middle">
              {colLabel}
            </text>
            <text
              className="axis-label"
              transform={`rotate(-90) translate(${(-size * cell) / 2}, ${-margin + 12})`}
              textAnchor="middle"
            >
              {rowLabel}
            </text>
          </g>
        </svg>
      </div>
      {hover ? (
        <figcaption className="plot-sub" style={{ marginTop: 'var(--s-2)' }}>
          {cellTitle(hover.r, hover.c, valueAt(hover.r, hover.c))}
        </figcaption>
      ) : footer ? (
        <figcaption className="plot-sub" style={{ marginTop: 'var(--s-2)' }}>
          {footer}
        </figcaption>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Grouped bar chart, for solver comparisons
 * ------------------------------------------------------------------ */
export function BarChart({
  title,
  subtitle,
  yLabel,
  bars,
  height = 260,
  valueFormatter = (v: number) => v.toFixed(2),
  footer,
  svgRef,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly yLabel: string;
  readonly bars: readonly { label: string; value: number | null; colour: string; note?: string }[];
  readonly height?: number;
  readonly valueFormatter?: (value: number) => string;
  readonly footer?: React.ReactNode;
  readonly svgRef?: React.Ref<SVGSVGElement>;
}): JSX.Element {
  const titleId = useId();
  const descId = useId();
  const width = 640;
  const pad = { top: 18, right: 16, bottom: 64, left: 64 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const present = bars.filter((b) => b.value !== null) as { label: string; value: number; colour: string }[];
  const maxValue = present.length ? Math.max(...present.map((b) => b.value)) : 1;
  const y = linearScale([0, maxValue * 1.12 || 1], [innerH, 0]);
  const slot = innerW / Math.max(bars.length, 1);
  const barW = Math.min(slot * 0.56, 74);

  return (
    <figure className="plot" style={{ margin: 0 }}>
      <div className="plot-head">
        <div>
          <div className="plot-title">{title}</div>
          {subtitle ? <div className="plot-sub">{subtitle}</div> : null}
        </div>
      </div>
      <div className="scroll-x">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: 420, maxWidth: '100%', height: 'auto' }}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
        >
          <title id={titleId}>{title}</title>
          <desc id={descId}>
            {bars
              .map((b) =>
                b.value === null
                  ? `${b.label}: not available${b.note ? ` - ${b.note}` : ''}.`
                  : `${b.label}: ${valueFormatter(b.value)}.`,
              )
              .join(' ')}
          </desc>
          <g transform={`translate(${pad.left},${pad.top})`}>
            {ticks([0, maxValue * 1.12 || 1]).map((value) => (
              <g key={value}>
                <line className="axis-grid" x1={0} x2={innerW} y1={y(value)} y2={y(value)} />
                <text className="axis-text" x={-8} y={y(value)} textAnchor="end" dy="0.32em">
                  {fmt(value)}
                </text>
              </g>
            ))}
            <line className="axis-line" x1={0} x2={innerW} y1={innerH} y2={innerH} />
            {bars.map((bar, i) => {
              const cx = i * slot + slot / 2;
              if (bar.value === null) {
                return (
                  <g key={bar.label}>
                    <rect
                      x={cx - barW / 2}
                      y={innerH - 26}
                      width={barW}
                      height={26}
                      rx={4}
                      fill="none"
                      stroke="var(--border-strong)"
                      strokeWidth={1.4}
                      strokeDasharray="4 3"
                    />
                    <text
                      className="axis-text"
                      x={cx}
                      y={innerH - 34}
                      textAnchor="middle"
                      style={{ fill: 'var(--text-faint)' }}
                    >
                      not run
                    </text>
                    <text
                      className="axis-text"
                      x={cx}
                      y={innerH + 18}
                      textAnchor="middle"
                      style={{ fontFamily: 'var(--font-sans)' }}
                    >
                      {bar.label}
                    </text>
                  </g>
                );
              }
              const barH = Math.max(innerH - y(bar.value), 2);
              return (
                <g key={bar.label}>
                  <rect
                    x={cx - barW / 2}
                    y={y(bar.value)}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={bar.colour}
                  >
                    <title>{`${bar.label}: ${valueFormatter(bar.value)}`}</title>
                  </rect>
                  <text
                    className="axis-text"
                    x={cx}
                    y={y(bar.value) - 7}
                    textAnchor="middle"
                    style={{ fill: 'var(--text-strong)' }}
                  >
                    {valueFormatter(bar.value)}
                  </text>
                  <text
                    className="axis-text"
                    x={cx}
                    y={innerH + 18}
                    textAnchor="middle"
                    style={{ fontFamily: 'var(--font-sans)' }}
                  >
                    {bar.label}
                  </text>
                </g>
              );
            })}
            <text
              className="axis-label"
              transform={`rotate(-90) translate(${-innerH / 2}, ${-pad.left + 14})`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
          </g>
        </svg>
      </div>
      {footer ? (
        <figcaption className="plot-sub" style={{ marginTop: 'var(--s-2)' }}>
          {footer}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Hook for exporting any chart above as a standalone SVG file. */
export function useSvgExport(): {
  ref: React.RefObject<SVGSVGElement>;
  getSvg: () => SVGSVGElement | null;
} {
  const ref = useRef<SVGSVGElement>(null);
  return { ref, getSvg: () => ref.current };
}
