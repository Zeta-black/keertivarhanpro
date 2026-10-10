/**
 * Two-dimensional chemical structure, drawn by RDKit.
 *
 * The depiction is produced by RDKit MinimalLib from the peptide's SMILES, so
 * it is the same structure diagram the reference cheminformatics toolkit would
 * draw: real ring templates, real kekulisation, hetero-atom labels, explicit
 * stereo bonds. Nothing here approximates a bond or invents an atom.
 *
 * The engine is a 7 MB WebAssembly module, so this component is honest about
 * the three states it can be in: loading, ready, or unavailable with the
 * reason. It never substitutes a decorative drawing for a real one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { smilesResidueRanges } from '../chem/peptide';
import type { ResidueTemplate } from '../chem/residues';
import { PRERENDERED, peptideKey } from '../generated/depictions';
import { depictSmiles, loadRdkit, rdkitIfReady, type EngineStatus } from './rdkit';

export interface Structure2DProps {
  readonly smiles: string;
  /** Residue templates in sequence order, used to map a residue to its atoms. */
  readonly templates?: readonly ResidueTemplate[];
  /** 1-based residue number to highlight, or null for none. */
  readonly highlightResidue?: number | null;
  readonly height?: number;
  /** Accessible description. Required: a structure diagram is information. */
  readonly label: string;
  readonly showStereoAnnotation?: boolean;
  /**
   * One-letter sequence. When a build-time depiction of this exact sequence
   * exists it is shown immediately, so the landing page never waits on the
   * WebAssembly runtime. It is replaced by the live rendering of the same
   * molecule once RDKit is ready, which looks identical.
   */
  readonly prerenderKey?: string;
  /**
   * Start loading RDKit even when a pre-rendered diagram covers the current
   * molecule. The workbench sets this because the user is there to edit, and
   * waiting until the first edit would put the download in the middle of an
   * interaction. A landing page leaves it off and may never fetch the engine
   * at all.
   */
  readonly eager?: boolean;
  /** Called when the engine state changes, so a parent can show it once. */
  readonly onStatus?: (status: EngineStatus) => void;
}

export function Structure2D({
  smiles,
  templates,
  highlightResidue = null,
  height = 320,
  label,
  showStereoAnnotation = false,
  prerenderKey,
  eager = false,
  onStatus,
}: Structure2DProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<EngineStatus>(() =>
    rdkitIfReady() ? { kind: 'ready', version: rdkitIfReady()!.version() } : { kind: 'idle' },
  );
  const prerendered = prerenderKey ? (PRERENDERED[peptideKey(prerenderKey)] ?? null) : null;
  const [svg, setSvg] = useState<string | null>(prerendered);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(720);

  // Report engine status upward exactly once per change.
  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // Load the engine when it is actually needed: when nothing pre-rendered
  // covers this molecule, or when the caller expects an edit shortly.
  useEffect(() => {
    if (rdkitIfReady()) return;
    if (prerendered && !eager) return;
    let cancelled = false;
    setStatus({ kind: 'loading' });
    loadRdkit()
      .then((module) => {
        if (!cancelled) setStatus({ kind: 'ready', version: module.version() });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: 'failed',
          reason: cause instanceof Error ? cause.message : 'unknown error',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [prerendered, eager]);

  // Track the available width so the diagram uses the whole panel.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 80) setWidth(Math.round(next));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const highlightAtoms = useMemo(() => {
    if (!templates || highlightResidue === null) return [];
    const ranges = smilesResidueRanges(templates);
    return ranges[highlightResidue - 1] ?? [];
  }, [templates, highlightResidue]);

  // Swap the pre-rendered diagram back in when the sequence changes to one
  // that has a build-time rendering, so switching designs never shows a stale
  // structure for the previous one.
  useEffect(() => {
    if (status.kind === 'ready') return;
    setSvg(prerendered);
  }, [prerendered, status.kind]);

  useEffect(() => {
    if (status.kind !== 'ready') return;
    const module = rdkitIfReady();
    if (!module) return;
    try {
      const drawn = depictSmiles(module, smiles, {
        width,
        height,
        highlightAtoms,
        transparent: true,
        addStereoAnnotation: showStereoAnnotation,
        highlightColour: [0.26, 0.86, 0.92],
      });
      if (!drawn) {
        setError('RDKit could not parse this structure.');
        setSvg(null);
        return;
      }
      setError(null);
      setSvg(drawn);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the depiction engine failed');
      setSvg(null);
    }
  }, [status, smiles, width, height, highlightAtoms, showStereoAnnotation]);

  return (
    <div ref={hostRef} className="struct2d" style={{ minHeight: height }}>
      {svg ? (
        <figure
          className="struct2d-figure"
          role="img"
          aria-label={label}
          // RDKit returns a complete, self-contained SVG document. It is
          // generated locally from our own SMILES, never from user text.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : status.kind === 'failed' || error ? (
        <div className="struct2d-state" role="status">
          <p className="struct2d-state-title">The 2D depiction engine is unavailable.</p>
          <p className="muted">
            {error ?? (status.kind === 'failed' ? status.reason : '')} The 3D viewer and every
            exported structure file still work, and the sequence editor is unaffected.
          </p>
        </div>
      ) : (
        <div className="struct2d-state" role="status" aria-live="polite">
          <span className="struct2d-spinner" aria-hidden="true" />
          <p className="struct2d-state-title">Loading the RDKit depiction engine</p>
          <p className="muted">
            A 7 MB WebAssembly build of RDKit, fetched once and then cached by the browser.
          </p>
        </div>
      )}
    </div>
  );
}
