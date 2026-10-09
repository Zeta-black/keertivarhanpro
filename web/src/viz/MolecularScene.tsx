/**
 * The hero: an illustrative 3D peptide-inspired structure on a canvas.
 *
 * HONESTY: this is a DESIGNED ILLUSTRATION, not chemistry. The backbone follows
 * an alpha-helix-like curve because that is a recognisable protein motif, and
 * the side-chain beads are coloured by the six classes of the real sequence
 * being displayed. No atomic coordinates, bond lengths, angles or binding poses
 * are claimed or implied. The component labels itself as illustrative wherever
 * it is used.
 *
 * Implementation notes: real 3D rotation matrices and perspective projection,
 * painter's-algorithm depth sorting, drawn with Canvas 2D. No WebGL and no
 * dependency, which keeps it smooth on ordinary laptops and Android phones and
 * removes a large bundle. Honours reduced-motion and the device capability
 * tier, and stops animating when scrolled out of view or the tab is hidden.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLASS_INFO } from '../science/alphabet';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Bead {
  base: Vec3;
  radius: number;
  colourToken: string;
  kind: 'backbone' | 'side' | 'orbital';
  /** Index of the sequence position this bead belongs to, if any. */
  position: number | null;
  /** Phase offset so orbital particles do not move in lockstep. */
  phase: number;
}

const CLASS_COLOUR_VAR = CLASS_INFO.map((c) => c.token);

/** Alpha-helix-like backbone: 1.5 turns per 8 residues reads clearly at this size. */
function buildBeads(codes: readonly number[], orbitalCount: number): Bead[] {
  const beads: Bead[] = [];
  const turns = 1.6;
  const n = codes.length;

  for (let i = 0; i < n; i += 1) {
    const t = i / Math.max(1, n - 1);
    const angle = t * turns * Math.PI * 2;
    const helixR = 0.42;
    const base: Vec3 = {
      x: Math.cos(angle) * helixR,
      y: (t - 0.5) * 1.5,
      z: Math.sin(angle) * helixR,
    };
    beads.push({
      base,
      radius: 0.075,
      colourToken: '--border-strong',
      kind: 'backbone',
      position: i,
      phase: 0,
    });
    // Side chain pushed radially outward, sized by how bulky the class is.
    const bulk = [1.0, 0.86, 0.78, 0.66, 0.7, 0.74][codes[i]] ?? 0.75;
    const outward = helixR + 0.3;
    beads.push({
      base: {
        x: Math.cos(angle) * outward,
        y: base.y + 0.03,
        z: Math.sin(angle) * outward,
      },
      radius: 0.1 * bulk + 0.045,
      colourToken: CLASS_COLOUR_VAR[codes[i]] ?? '--accent',
      kind: 'side',
      position: i,
      phase: 0,
    });
  }

  // Decorative orbital particles. Deliberately sparse: they suggest "molecular
  // environment" without pretending to be solvent molecules.
  for (let i = 0; i < orbitalCount; i += 1) {
    const a = (i / orbitalCount) * Math.PI * 2;
    const tilt = (i % 3) - 1;
    beads.push({
      base: {
        x: Math.cos(a) * 1.05,
        y: tilt * 0.42,
        z: Math.sin(a) * 1.05,
      },
      radius: 0.022,
      colourToken: i % 2 === 0 ? '--accent' : '--optimise',
      kind: 'orbital',
      position: null,
      phase: a,
    });
  }
  return beads;
}

function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x1, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

function readToken(element: HTMLElement, token: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(token).trim();
  return value || fallback;
}

export interface MolecularSceneProps {
  readonly codes: readonly number[];
  /** 'full' animates on canvas; 'lite' renders the static SVG illustration. */
  readonly tier: 'full' | 'lite';
  readonly reducedMotion: boolean;
  readonly height?: number;
  readonly onPositionHover?: (position: number | null) => void;
  readonly className?: string;
}

export function MolecularScene({
  codes,
  tier,
  reducedMotion,
  height = 380,
  onPositionHover,
  className = '',
}: MolecularSceneProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(reducedMotion);
  const [hovered, setHovered] = useState<number | null>(null);

  // Drag-to-rotate state lives in refs so the animation loop never re-binds.
  const yawRef = useRef(0.4);
  const pitchRef = useRef(-0.22);
  const dragRef = useRef<{ active: boolean; x: number; y: number } | null>(null);
  const visibleRef = useRef(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const orbitalCount = tier === 'full' ? 22 : 0;
  const beads = useMemo(() => buildBeads(codes, orbitalCount), [codes, orbitalCount]);
  const beadsRef = useRef(beads);
  beadsRef.current = beads;

  const hoverRef = useRef<{ x: number; y: number } | null>(null);

  const notifyHover = useCallback(
    (position: number | null) => {
      setHovered(position);
      onPositionHover?.(position);
    },
    [onPositionHover],
  );

  useEffect(() => {
    setPaused(reducedMotion);
  }, [reducedMotion]);

  // Pause when off-screen or the tab is hidden: no point burning battery.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    observer.observe(wrap);
    const onVisibility = () => {
      visibleRef.current = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (tier !== 'full') return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let disposed = false;
    // Cap at 2x: a 3x device pixel ratio triples fill cost for no visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let heightPx = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(240, rect.width);
      heightPx = height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(heightPx * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${heightPx}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const palette = new Map<string, string>();
    const colourOf = (token: string): string => {
      const cached = palette.get(token);
      if (cached) return cached;
      const value = readToken(wrap, token, '#42dbea');
      palette.set(token, value);
      return value;
    };
    // Tokens change with the theme, so drop the cache when the attribute flips.
    const themeObserver = new MutationObserver(() => palette.clear());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const start = performance.now();
    let lastHoverCheck = 0;

    const draw = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(draw);
      if (!visibleRef.current) return;

      const elapsed = (now - start) / 1000;
      if (!pausedRef.current && !dragRef.current?.active) {
        yawRef.current += 0.0042;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, heightPx);

      const cx = width / 2;
      const cy = heightPx / 2;
      const scale = Math.min(width, heightPx) * 0.33;
      const cameraZ = 3.4;

      // Project every bead, then paint far-to-near.
      const projected = beadsRef.current.map((bead, index) => {
        let p = bead.base;
        if (bead.kind === 'orbital' && !pausedRef.current) {
          const a = bead.phase + elapsed * 0.35;
          p = { x: Math.cos(a) * 1.05, y: p.y + Math.sin(elapsed * 0.9 + bead.phase) * 0.05, z: Math.sin(a) * 1.05 };
        }
        const r = rotate(p, yawRef.current, pitchRef.current);
        const depth = cameraZ + r.z;
        const perspective = cameraZ / Math.max(depth, 0.35);
        return {
          index,
          bead,
          sx: cx + r.x * scale * perspective,
          sy: cy + r.y * scale * perspective,
          sr: Math.max(bead.radius * scale * perspective, 0.6),
          depth: r.z,
          perspective,
        };
      });
      projected.sort((a, b) => a.depth - b.depth);

      // Backbone ribbon first, so beads sit on top of it.
      const backbone = projected
        .filter((p) => p.bead.kind === 'backbone')
        .sort((a, b) => (a.bead.position ?? 0) - (b.bead.position ?? 0));
      if (backbone.length > 1) {
        context.beginPath();
        context.moveTo(backbone[0].sx, backbone[0].sy);
        for (let i = 1; i < backbone.length; i += 1) {
          const prev = backbone[i - 1];
          const cur = backbone[i];
          const mx = (prev.sx + cur.sx) / 2;
          const my = (prev.sy + cur.sy) / 2;
          context.quadraticCurveTo(prev.sx, prev.sy, mx, my);
        }
        context.strokeStyle = colourOf('--border-strong');
        context.lineWidth = Math.max(scale * 0.045, 2);
        context.lineCap = 'round';
        context.globalAlpha = 0.85;
        context.stroke();
        context.globalAlpha = 1;
      }

      for (const p of projected) {
        const { bead } = p;
        const isHovered = bead.position !== null && bead.position === hovered;
        // Depth cue: things behind the centre dim slightly.
        const depthAlpha = bead.kind === 'orbital' ? 0.45 : 0.6 + 0.4 * ((p.depth + 1) / 2);
        const colour = colourOf(bead.colourToken);

        if (bead.kind === 'side') {
          // Connector from backbone to side chain.
          const spine = projected.find(
            (q) => q.bead.kind === 'backbone' && q.bead.position === bead.position,
          );
          if (spine) {
            context.beginPath();
            context.moveTo(spine.sx, spine.sy);
            context.lineTo(p.sx, p.sy);
            context.strokeStyle = colour;
            context.globalAlpha = depthAlpha * 0.5;
            context.lineWidth = Math.max(scale * 0.016, 1);
            context.stroke();
          }
        }

        context.globalAlpha = Math.min(1, depthAlpha);
        if (bead.kind === 'side') {
          const gradient = context.createRadialGradient(
            p.sx - p.sr * 0.35,
            p.sy - p.sr * 0.35,
            p.sr * 0.1,
            p.sx,
            p.sy,
            p.sr,
          );
          gradient.addColorStop(0, '#ffffff');
          gradient.addColorStop(0.35, colour);
          gradient.addColorStop(1, colour);
          context.fillStyle = gradient;
        } else {
          context.fillStyle = colour;
        }
        context.beginPath();
        context.arc(p.sx, p.sy, p.sr, 0, Math.PI * 2);
        context.fill();

        if (isHovered && bead.kind === 'side') {
          context.globalAlpha = 1;
          context.strokeStyle = colourOf('--text-strong');
          context.lineWidth = 2;
          context.beginPath();
          context.arc(p.sx, p.sy, p.sr + 3, 0, Math.PI * 2);
          context.stroke();
        }
        context.globalAlpha = 1;
      }

      // Hover hit-testing, throttled: it only matters at pointer speed.
      if (hoverRef.current && now - lastHoverCheck > 60) {
        lastHoverCheck = now;
        const { x, y } = hoverRef.current;
        let found: number | null = null;
        let bestDistance = Infinity;
        for (const p of projected) {
          if (p.bead.kind !== 'side') continue;
          const d = Math.hypot(p.sx - x, p.sy - y);
          if (d < p.sr + 8 && d < bestDistance) {
            bestDistance = d;
            found = p.bead.position;
          }
        }
        if (found !== hovered) notifyHover(found);
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [tier, height, hovered, notifyHover]);

  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    hoverRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const drag = dragRef.current;
    if (!drag?.active) return;
    yawRef.current += (event.clientX - drag.x) * 0.008;
    pitchRef.current = Math.max(
      -1.1,
      Math.min(1.1, pitchRef.current + (event.clientY - drag.y) * 0.006),
    );
    dragRef.current = { active: true, x: event.clientX, y: event.clientY };
  };
  const endDrag = () => {
    if (dragRef.current) dragRef.current.active = false;
  };

  const hoveredInfo = hovered !== null ? CLASS_INFO[codes[hovered]] : null;

  if (tier !== 'full') {
    return (
      <div ref={wrapRef} className={className}>
        <StaticMolecularIllustration codes={codes} height={height} />
        <SceneCaption
          paused
          onTogglePause={null}
          hoveredLabel={null}
          note="Showing the lightweight illustration, chosen automatically for this device."
        />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={className} style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          'Illustrative three-dimensional peptide structure. A coiled backbone with eight ' +
          'side-chain beads coloured by building-block family: ' +
          codes.map((c, i) => `position ${i + 1} ${CLASS_INFO[c].name}`).join(', ') +
          '. This is a designed illustration, not a molecular simulation.'
        }
        style={{ touchAction: 'pan-y', cursor: dragRef.current?.active ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          endDrag();
          hoverRef.current = null;
          notifyHover(null);
        }}
      />
      <SceneCaption
        paused={paused}
        onTogglePause={() => setPaused((v) => !v)}
        hoveredLabel={
          hoveredInfo && hovered !== null
            ? `Position ${hovered + 1}: ${hoveredInfo.name}`
            : null
        }
        note="Drag to rotate. Illustration only - not a binding pose."
      />
    </div>
  );
}

function SceneCaption({
  paused,
  onTogglePause,
  hoveredLabel,
  note,
}: {
  readonly paused: boolean;
  readonly onTogglePause: (() => void) | null;
  readonly hoveredLabel: string | null;
  readonly note: string;
}): JSX.Element {
  return (
    <div
      className="row-wrap"
      style={{ justifyContent: 'space-between', marginTop: 'var(--s-2)', gap: 'var(--s-2)' }}
    >
      <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
        {hoveredLabel ?? note}
      </span>
      {onTogglePause ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onTogglePause}
          aria-pressed={paused}
        >
          {paused ? 'Resume rotation' : 'Pause rotation'}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The reduced-motion and low-power path: the same idea as a still SVG, with no
 * canvas, no animation loop and no per-frame cost.
 */
export function StaticMolecularIllustration({
  codes,
  height = 380,
}: {
  readonly codes: readonly number[];
  readonly height?: number;
}): JSX.Element {
  const width = 520;
  const cx = width / 2;
  const turns = 1.6;
  const nodes = codes.map((code, i) => {
    const t = i / Math.max(1, codes.length - 1);
    const angle = t * turns * Math.PI * 2 + 0.4;
    const helixR = 54;
    const y = 54 + t * (height - 108);
    return {
      code,
      i,
      bx: cx + Math.cos(angle) * helixR,
      by: y,
      sx: cx + Math.cos(angle) * (helixR + 46),
      sy: y,
      depth: Math.sin(angle),
    };
  });
  const sorted = [...nodes].sort((a, b) => a.depth - b.depth);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxWidth: width, height: 'auto', margin: '0 auto' }}
      role="img"
      aria-label={
        'Illustrative peptide structure: a coiled backbone with eight side chains coloured by ' +
        'building-block family. A designed illustration, not a molecular simulation.'
      }
    >
      <title>Illustrative peptide structure</title>
      <defs>
        <radialGradient id="halo" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={width} height={height} fill="url(#halo)" />
      <path
        d={nodes.map((n, i) => `${i === 0 ? 'M' : 'L'}${n.bx},${n.by}`).join(' ')}
        stroke="var(--border-strong)"
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
        opacity={0.85}
      />
      {sorted.map((n) => {
        const info = CLASS_INFO[n.code];
        const bulk = [1.0, 0.86, 0.78, 0.66, 0.7, 0.74][n.code] ?? 0.75;
        const r = 11 * bulk + 6;
        const alpha = 0.62 + 0.38 * ((n.depth + 1) / 2);
        return (
          <g key={n.i} data-class={info.id} opacity={alpha}>
            <line
              x1={n.bx}
              y1={n.by}
              x2={n.sx}
              y2={n.sy}
              stroke="var(--block-colour)"
              strokeWidth={3}
              opacity={0.55}
            />
            <circle cx={n.bx} cy={n.by} r={6} fill="var(--border-strong)" />
            <circle cx={n.sx} cy={n.sy} r={r} fill="var(--block-colour)" />
            <text
              x={n.sx}
              y={n.sy}
              textAnchor="middle"
              dy="0.34em"
              style={{
                fill: 'var(--text-on-block)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {info.symbol}
            </text>
            <title>{`Position ${n.i + 1}: ${info.name}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
