/**
 * Conceptual binding illustration.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * This component draws an abstract peptide chain approaching an abstract
 * plastic surface. It is a TEACHING PICTURE for the idea "some building blocks
 * are modelled as fitting this surface better than others". It is NOT:
 *   - molecular docking
 *   - a molecular-dynamics simulation
 *   - an experimentally observed binding pose
 *   - a prediction of hydrogen bonds, distances, pockets or bond strengths
 *
 * The ONLY quantitative thing it is allowed to show is the sign and relative
 * size of the model's own per-position contribution to each plastic's score,
 * which is a real number from the real Potts model. A position whose
 * contribution favours the target is drawn as a favourable (teal) interaction;
 * one that favours an off-target is drawn as unfavourable (amber). That mapping
 * is stated in the caption so nobody has to guess what the colours mean.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { CLASS_INFO, LENGTH } from '../science/alphabet';
import { HONESTY } from '../content/copy';
import { PLASTIC_INFO, type Plastic } from '../science/potts';

export interface BindingConceptProps {
  readonly codes: readonly number[];
  /**
   * Per-position contribution to each plastic's score, from
   * `contributions(codes, model.flat[plastic]).positions`. Real model numbers.
   */
  readonly perPosition: Readonly<Record<Plastic, readonly number[]>> | null;
  readonly surface: Plastic;
  readonly reducedMotion: boolean;
  readonly height?: number;
}

/** How a single position's modelled preference is rendered. */
type Verdict = 'favoursTarget' | 'favoursOffTarget' | 'neutral';

function verdictFor(
  position: number,
  perPosition: BindingConceptProps['perPosition'],
  surface: Plastic,
): { verdict: Verdict; value: number | null } {
  if (!perPosition) return { verdict: 'neutral', value: null };
  const own = perPosition[surface]?.[position];
  if (typeof own !== 'number') return { verdict: 'neutral', value: null };
  // Compare this position's contribution to this surface against its mean
  // contribution across the other two plastics. Positive means the model likes
  // this block here for THIS surface more than for the others.
  const others = (['PET', 'PE', 'PP'] as const).filter((p) => p !== surface);
  const otherMean =
    others.reduce((sum, p) => sum + (perPosition[p]?.[position] ?? 0), 0) / others.length;
  const relative = own - otherMean;
  if (Math.abs(relative) < 0.25) return { verdict: 'neutral', value: relative };
  return {
    verdict: relative > 0 ? 'favoursTarget' : 'favoursOffTarget',
    value: relative,
  };
}

export function BindingConcept({
  codes,
  perPosition,
  surface,
  reducedMotion,
  height = 300,
}: BindingConceptProps): JSX.Element {
  const [phase, setPhase] = useState(reducedMotion ? 1 : 0);
  const [paused, setPaused] = useState(reducedMotion);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    setPaused(reducedMotion);
    if (reducedMotion) setPhase(1);
  }, [reducedMotion]);

  useEffect(() => {
    if (paused) return;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const t = ((now - start) / 2600) % 2;
      // Ease in, hold, ease out: approach, settle, lift away.
      setPhase(t < 1 ? 1 - (1 - t) ** 2 : 1);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [paused]);

  const width = 560;
  const surfaceY = height - 56;
  const approach = 86 * (1 - phase);
  const info = PLASTIC_INFO.find((p) => p.id === surface)!;

  const nodes = useMemo(
    () =>
      codes.map((code, i) => {
        const spread = (width - 150) / Math.max(1, LENGTH - 1);
        const x = 75 + i * spread;
        // A gentle arc so the chain reads as flexible rather than a ruler.
        const arc = Math.sin((i / (LENGTH - 1)) * Math.PI) * 18;
        return { code, i, x, y: surfaceY - 52 - arc + approach };
      }),
    [codes, approach, surfaceY, width],
  );

  const verdicts = codes.map((_, i) => verdictFor(i, perPosition, surface));
  const favourable = verdicts.filter((v) => v.verdict === 'favoursTarget').length;
  const unfavourable = verdicts.filter((v) => v.verdict === 'favoursOffTarget').length;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ maxWidth: width, height: 'auto', margin: '0 auto' }}
        role="img"
        aria-label={
          `Conceptual illustration: an abstract eight-block peptide chain above an abstract ` +
          `${info.chemical} surface. ${favourable} positions carry a modelled preference for ` +
          `${surface}, ${unfavourable} carry a preference for one of the other plastics. ` +
          `This is a teaching diagram, not molecular docking and not an observed binding pose.`
        }
      >
        <title>{`Conceptual peptide-on-${surface} illustration`}</title>
        <defs>
          <linearGradient id={`surf-${surface}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--c-${surface.toLowerCase()})`} stopOpacity="0.4" />
            <stop offset="100%" stopColor={`var(--c-${surface.toLowerCase()})`} stopOpacity="0.1" />
          </linearGradient>
          <pattern
            id={`hatch-${surface}`}
            width="12"
            height="12"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(28)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="12"
              stroke={`var(--c-${surface.toLowerCase()})`}
              strokeWidth="1.4"
              opacity="0.4"
            />
          </pattern>
        </defs>

        {/* The abstract surface. Repeating units, deliberately schematic. */}
        <rect
          x={0}
          y={surfaceY}
          width={width}
          height={height - surfaceY}
          fill={`url(#surf-${surface})`}
        />
        <rect
          x={0}
          y={surfaceY}
          width={width}
          height={height - surfaceY}
          fill={`url(#hatch-${surface})`}
        />
        <line
          x1={0}
          y1={surfaceY}
          x2={width}
          y2={surfaceY}
          stroke={`var(--c-${surface.toLowerCase()})`}
          strokeWidth={2.4}
        />
        {Array.from({ length: 15 }, (_, i) => (
          <circle
            key={i}
            cx={18 + i * 38}
            cy={surfaceY + 16}
            r={7}
            fill="none"
            stroke={`var(--c-${surface.toLowerCase()})`}
            strokeWidth={1.4}
            opacity={0.55}
          />
        ))}
        <text
          x={width - 12}
          y={height - 12}
          textAnchor="end"
          style={{
            fill: `var(--c-${surface.toLowerCase()})`,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {`${surface} surface (schematic)`}
        </text>

        {/* Interaction markers, only where the model shows a real preference. */}
        {nodes.map((node, i) => {
          const { verdict, value } = verdicts[i];
          if (verdict === 'neutral') return null;
          const colour = verdict === 'favoursTarget' ? 'var(--success)' : 'var(--attention)';
          const strength = Math.min(1, Math.abs(value ?? 0) / 4);
          return (
            <g key={`link-${i}`} opacity={0.3 + 0.7 * phase}>
              <line
                x1={node.x}
                y1={node.y + 14}
                x2={node.x}
                y2={surfaceY - 2}
                stroke={colour}
                strokeWidth={1 + strength * 2.4}
                strokeDasharray={verdict === 'favoursTarget' ? undefined : '3 4'}
                opacity={0.85}
              />
              {verdict === 'favoursTarget' ? (
                <circle cx={node.x} cy={surfaceY - 2} r={3 + strength * 2} fill={colour} />
              ) : (
                <g stroke={colour} strokeWidth={1.8} strokeLinecap="round">
                  <line x1={node.x - 4} y1={surfaceY - 6} x2={node.x + 4} y2={surfaceY + 2} />
                  <line x1={node.x + 4} y1={surfaceY - 6} x2={node.x - 4} y2={surfaceY + 2} />
                </g>
              )}
            </g>
          );
        })}

        {/* The chain backbone. */}
        <path
          d={nodes.map((n, i) => `${i === 0 ? 'M' : 'L'}${n.x},${n.y}`).join(' ')}
          stroke="var(--border-strong)"
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
        {nodes.map((node) => {
          const classInfo = CLASS_INFO[node.code];
          return (
            <g key={node.i} data-class={classInfo.id}>
              <circle cx={node.x} cy={node.y} r={14} fill="var(--block-colour)" />
              <text
                x={node.x}
                y={node.y}
                textAnchor="middle"
                dy="0.34em"
                style={{
                  fill: 'var(--text-on-block)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 700,
                }}
              >
                {classInfo.symbol}
              </text>
              <title>{`Position ${node.i + 1}: ${classInfo.name}`}</title>
            </g>
          );
        })}
      </svg>

      <div
        className="row-wrap"
        style={{ justifyContent: 'space-between', marginTop: 'var(--s-2)' }}
      >
        <div className="legend">
          <span className="legend-item">
            <span className="legend-key legend-key-round" style={{ background: 'var(--success)' }} />
            modelled preference for {surface}
          </span>
          <span className="legend-item">
            <span className="legend-key" style={{ background: 'var(--attention)' }} />
            modelled preference for another plastic
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-pressed={paused}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
      </div>

      <figcaption
        className="notice notice-honest"
        style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-xs)' }}
      >
        <div>
          <strong>{HONESTY.conceptualVisual}</strong>
          <p style={{ marginTop: 'var(--s-1)' }}>
            The only quantity drawn here is each position&rsquo;s own contribution to the{' '}
            {surface} score compared with its contribution to the other two plastics, taken
            directly from the scoring model. Marker thickness scales with that difference.
            Positions where the difference is smaller than 0.25 are left unmarked because the
            model does not express a meaningful preference there.
          </p>
        </div>
      </figcaption>
    </figure>
  );
}
