/**
 * Three-dimensional molecular viewer, rendered by 3Dmol.js.
 *
 * 3Dmol.js is the WebGL viewer used by the RCSB-adjacent tool ecosystem; it is
 * given a real PDB coordinate file produced by `src/chem/conformer.ts` and
 * renders it with the standard CPK element colouring, the same as PyMOL or
 * Jmol would. There is no decorative geometry in this component: every sphere
 * is an atom from the connection table and every stick is a bond.
 *
 * The conformer is generated from idealised internal coordinates, which the
 * caller states next to the viewer. The viewer itself makes no claim about
 * where the peptide would actually sit on a surface.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PeptideStructure } from '../chem/peptide';

/* 3Dmol ships no types for the ES module build, so only the surface this
   component uses is declared. */
interface GLModel {
  setStyle(selection: unknown, style: unknown): void;
  addStyle(selection: unknown, style: unknown): void;
  setColorByElement?(selection: unknown): void;
}
interface GLViewer {
  addModel(data: string, format: string): GLModel;
  setStyle(selection: unknown, style: unknown): void;
  addStyle(selection: unknown, style: unknown): void;
  setBackgroundColor(colour: string, alpha?: number): void;
  addLabel(text: string, options: unknown): unknown;
  removeAllLabels(): void;
  removeAllModels(): void;
  zoomTo(selection?: unknown): void;
  zoom(factor: number, duration?: number): void;
  render(): void;
  resize(): void;
  spin(axis: boolean | string): void;
  clear(): void;
  getCanvas?(): HTMLCanvasElement;
}
interface Mol3D {
  createViewer(
    element: HTMLElement,
    config: { backgroundAlpha?: number; backgroundColor?: string; antialias?: boolean },
  ): GLViewer;
}

export type Representation = 'ballStick' | 'stick' | 'spaceFill' | 'backbone';

export interface Structure3DProps {
  /** PDB text from `buildPeptideModel`. */
  readonly pdb: string;
  readonly structure: PeptideStructure;
  readonly representation: Representation;
  /** 1-based residue to emphasise, or null. */
  readonly highlightResidue?: number | null;
  readonly showLabels?: boolean;
  readonly height?: number;
  readonly label: string;
  readonly onResiduePick?: (seq: number | null) => void;
  readonly onStatus?: (status: ViewerStatus) => void;
}

export type ViewerStatus =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string };

let modulePromise: Promise<Mol3D> | null = null;

function load3Dmol(): Promise<Mol3D> {
  if (!modulePromise) {
    modulePromise = import('3dmol/build/3Dmol.es6-min.js').then(
      (m) => m as unknown as Mol3D,
    );
  }
  return modulePromise;
}

function styleFor(representation: Representation): Record<string, unknown> {
  switch (representation) {
    case 'stick':
      return { stick: { radius: 0.13, colorscheme: 'default' } };
    case 'spaceFill':
      return { sphere: { scale: 0.95, colorscheme: 'default' } };
    case 'backbone':
      return {
        stick: { radius: 0.08, opacity: 0.45, colorscheme: 'default' },
        cartoon: { style: 'trace', thickness: 0.5, color: 'spectrum' },
      };
    case 'ballStick':
    default:
      return {
        stick: { radius: 0.12, colorscheme: 'default' },
        sphere: { scale: 0.26, colorscheme: 'default' },
      };
  }
}

export function Structure3D({
  pdb,
  structure,
  representation,
  highlightResidue = null,
  showLabels = false,
  height = 360,
  label,
  onResiduePick,
  onStatus,
}: Structure3DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading' });

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const residueNames = useMemo(
    () =>
      structure.residues.map((residue) => ({
        seq: residue.seq,
        text: `${residue.template.code3}${residue.seq}`,
      })),
    [structure],
  );

  /** Builds (or rebuilds) the scene. Called whenever the molecule changes. */
  const draw = useCallback(
    (viewer: GLViewer) => {
      viewer.removeAllModels();
      viewer.removeAllLabels();
      viewer.addModel(pdb, 'pdb');
      viewer.setStyle({}, styleFor(representation));
      if (highlightResidue !== null) {
        // The emphasised residue keeps the element colours but gets a thicker
        // stick and a larger sphere, so the chemistry stays readable.
        viewer.addStyle(
          { resi: highlightResidue },
          {
            stick: { radius: 0.2, colorscheme: 'default' },
            sphere: { scale: 0.34, colorscheme: 'default' },
          },
        );
      }
      if (showLabels) {
        for (const residue of residueNames) {
          viewer.addLabel(residue.text, {
            fontSize: 11,
            fontColor: 'white',
            backgroundColor: '#0b182a',
            backgroundOpacity: 0.72,
            borderThickness: 0,
            inFront: true,
            alignment: 'center',
            // Anchor on the alpha carbon, which is the residue's centre of mass
            // in the eyes of a structural biologist.
            position: undefined,
            sel: { resi: residue.seq, atom: 'CA' },
          });
        }
      }
      viewer.zoomTo();
      // zoomTo fits the bounding sphere, which leaves an extended peptide
      // looking small in a wide panel; a small nudge fills the frame.
      viewer.zoom(1.2);
      viewer.render();
    },
    [pdb, representation, highlightResidue, showLabels, residueNames],
  );

  // Create the viewer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let viewer: GLViewer | null = null;

    load3Dmol()
      .then((mol3d) => {
        if (cancelled || !hostRef.current) return;
        viewer = mol3d.createViewer(hostRef.current, {
          backgroundAlpha: 0,
          antialias: true,
        });
        viewerRef.current = viewer;
        setStatus({ kind: 'ready' });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: 'failed',
          reason:
            cause instanceof Error
              ? cause.message
              : 'WebGL is unavailable in this browser',
        });
      });

    return () => {
      cancelled = true;
      try {
        viewer?.clear();
      } catch {
        // A viewer that never finished initialising has nothing to clear.
      }
      viewerRef.current = null;
    };
  }, []);

  // Redraw whenever the molecule or the representation changes.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status.kind !== 'ready') return;
    try {
      draw(viewer);
    } catch (cause) {
      setStatus({
        kind: 'failed',
        reason: cause instanceof Error ? cause.message : 'the viewer failed to draw',
      });
    }
  }, [draw, status.kind]);

  // Keep the canvas sized to its container.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        viewer.resize();
        viewer.render();
      } catch {
        // Resizing before the first draw is harmless.
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="struct3d" style={{ height }}>
      <div
        ref={hostRef}
        className="struct3d-host"
        role="img"
        aria-label={label}
        // 3Dmol needs a positioned element it can own.
        style={{ position: 'relative', width: '100%', height: '100%' }}
      />
      {status.kind !== 'ready' ? (
        <div className="struct3d-state" role="status" aria-live="polite">
          {status.kind === 'loading' ? (
            <>
              <span className="struct2d-spinner" aria-hidden="true" />
              <p className="struct2d-state-title">Starting the 3D molecular viewer</p>
            </>
          ) : (
            <>
              <p className="struct2d-state-title">3D rendering is not available here.</p>
              <p className="muted">
                {status.reason}. The 2D structure and the downloadable PDB and SDF files are
                unaffected.
              </p>
            </>
          )}
        </div>
      ) : null}
      {onResiduePick && status.kind === 'ready' ? (
        <div className="sr-only">
          Residue selection is available from the sequence editor; the 3D view follows it.
        </div>
      ) : null}
    </div>
  );
}
