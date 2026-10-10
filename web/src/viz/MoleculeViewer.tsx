/**
 * The molecular viewer panel: one real structure, shown either as a 2D
 * chemical diagram (RDKit) or as a 3D model (3Dmol.js).
 *
 * Both views are generated from the same connection table, so they can never
 * disagree. The panel states which engine drew what, and in 3D it states that
 * the coordinates are a generated conformer rather than a measured structure -
 * once, in the caption, not as a badge on every control.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { buildPeptideModel, type PeptideModel } from '../chem';
import { peptideExportFiles } from '../chem';
import type { SecondaryStructure } from '../chem/conformer';
import { SECONDARY_STRUCTURES } from '../chem/conformer';
import { Structure2D } from './Structure2D';
import { Structure3D, type Representation } from './Structure3D';
import type { EngineStatus } from './rdkit';

export type ViewMode = '2d' | '3d';

const REPRESENTATIONS: { readonly id: Representation; readonly label: string }[] = [
  { id: 'ballStick', label: 'Ball and stick' },
  { id: 'stick', label: 'Stick' },
  { id: 'spaceFill', label: 'Space filling' },
  { id: 'backbone', label: 'Backbone trace' },
];

export interface MoleculeViewerProps {
  /** One-letter residue codes, N-terminus first. */
  readonly residues: readonly string[];
  /** `compact` shows only the 2D/3D switch; `workbench` shows every control. */
  readonly variant?: 'compact' | 'workbench';
  readonly height?: number;
  readonly highlightResidue?: number | null;
  readonly initialMode?: ViewMode;
  /** Label used for downloaded files. */
  readonly exportLabel?: string;
  readonly onModelReady?: (model: PeptideModel) => void;
}

/** Hands the caller a Blob download without leaving the page. */
function download(name: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function MoleculeViewer({
  residues,
  variant = 'compact',
  height = 380,
  highlightResidue = null,
  initialMode = '2d',
  exportLabel = 'qbindselect-design',
  onModelReady,
}: MoleculeViewerProps): JSX.Element {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [representation, setRepresentation] = useState<Representation>('ballStick');
  const [backbone, setBackbone] = useState<SecondaryStructure['id']>('extended');
  const [labels, setLabels] = useState(false);
  const [engine, setEngine] = useState<EngineStatus>({ kind: 'idle' });
  const announced = useRef<string>('');

  const key = residues.join('');

  const model = useMemo<{ model: PeptideModel | null; error: string | null }>(() => {
    try {
      return { model: buildPeptideModel(residues, { structure: backbone }), error: null };
    } catch (cause) {
      return {
        model: null,
        error: cause instanceof Error ? cause.message : 'the molecule could not be built',
      };
    }
  }, [key, backbone, residues]);

  useEffect(() => {
    if (model.model && announced.current !== key) {
      announced.current = key;
      onModelReady?.(model.model);
    }
  }, [model.model, key, onModelReady]);

  if (!model.model) {
    return (
      <div className="viewer-panel">
        <div className="struct2d-state" role="alert">
          <p className="struct2d-state-title">This sequence could not be built as a molecule.</p>
          <p className="muted">{model.error}</p>
        </div>
      </div>
    );
  }

  const { structure, embed } = model.model;
  const chosen = SECONDARY_STRUCTURES.find((s) => s.id === backbone) ?? SECONDARY_STRUCTURES[0];
  const files = peptideExportFiles(model.model, exportLabel);

  return (
    <div className="viewer-panel">
      <header className="viewer-head">
        <div className="viewer-identity">
          <span className="viewer-seq" title="Residue sequence, N-terminus first">
            {structure.sequence}
          </span>
          <span className="viewer-formula">
            {formatFormula(structure.formula)}
            <span className="viewer-dot" aria-hidden="true">
              ·
            </span>
            {structure.mass.average.toFixed(1)}&nbsp;g/mol
          </span>
        </div>
        <div className="viewer-switch" role="group" aria-label="Structure view">
          <button
            type="button"
            className="viewer-switch-btn"
            aria-pressed={mode === '2d'}
            onClick={() => setMode('2d')}
          >
            2D structure
          </button>
          <button
            type="button"
            className="viewer-switch-btn"
            aria-pressed={mode === '3d'}
            onClick={() => setMode('3d')}
          >
            3D model
          </button>
        </div>
      </header>

      <div className="viewer-body">
        {mode === '2d' ? (
          <Structure2D
            smiles={structure.smiles}
            templates={structure.residues.map((r) => r.template)}
            highlightResidue={highlightResidue}
            height={height}
            showStereoAnnotation={variant === 'workbench'}
            prerenderKey={structure.sequence}
            eager={variant === 'workbench'}
            onStatus={setEngine}
            label={`Chemical structure diagram of the peptide ${structure.sequence}: ${structure.heavyAtoms} heavy atoms, ${structure.peptideBonds} peptide bonds, molecular formula ${structure.formula}.`}
          />
        ) : (
          <Structure3D
            pdb={model.model.pdb}
            structure={structure}
            representation={representation}
            highlightResidue={highlightResidue}
            showLabels={labels}
            height={height}
            label={`Three-dimensional model of the peptide ${structure.sequence} in a generated ${chosen.label} conformation.`}
          />
        )}
      </div>

      {variant === 'workbench' ? (
        <div className="viewer-controls">
          {mode === '3d' ? (
            <>
              <label className="viewer-control">
                <span>Representation</span>
                <select
                  value={representation}
                  onChange={(event) => setRepresentation(event.target.value as Representation)}
                >
                  {REPRESENTATIONS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="viewer-control">
                <span>Backbone torsions</span>
                <select
                  value={backbone}
                  onChange={(event) =>
                    setBackbone(event.target.value as SecondaryStructure['id'])
                  }
                >
                  {SECONDARY_STRUCTURES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="viewer-control viewer-control-inline">
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(event) => setLabels(event.target.checked)}
                />
                <span>Residue labels</span>
              </label>
            </>
          ) : (
            <p className="viewer-note">
              Drawn by RDKit{engine.kind === 'ready' ? ` ${engine.version}` : ''} from the
              peptide&rsquo;s SMILES. Hetero atoms carry element colours; carbons are implicit
              vertices, as in any structure diagram.
            </p>
          )}
          <div className="viewer-downloads">
            {files.map((file) => (
              <button
                key={file.name}
                type="button"
                className="btn btn-sm"
                onClick={() => download(file.name, file.mime, file.text)}
              >
                {file.name.split('.').pop()?.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="viewer-foot">
        {mode === '2d' ? (
          <p>
            <strong>{structure.heavyAtoms}</strong> heavy atoms,{' '}
            <strong>{structure.bondCount}</strong> bonds,{' '}
            <strong>{structure.peptideBonds}</strong> peptide bonds,{' '}
            <strong>{structure.rings}</strong> rings. Connection table validated for neutral
            valence at every atom.
          </p>
        ) : (
          <p>
            Generated conformer: idealised bond lengths and angles with {chosen.label.toLowerCase()}{' '}
            torsions (&phi;&nbsp;{chosen.phi}&deg;, &psi;&nbsp;{chosen.psi}&deg;,
            &omega;&nbsp;{chosen.omega}&deg;), relaxed for steric overlap. Not an experimental
            structure and not a binding pose. Drag to rotate, scroll to zoom.
            {embed.worstClash > 0.2 ? ' Residual close contacts remain in this conformation.' : ''}
          </p>
        )}
      </footer>
    </div>
  );
}

/** Renders C52H71N11O12 with the digits as subscripts. */
export function formatFormula(formula: string): JSX.Element {
  const parts = formula.match(/[A-Z][a-z]?|\d+/g) ?? [formula];
  return (
    <span className="formula">
      {parts.map((part, i) =>
        /^\d+$/.test(part) ? <sub key={i}>{part}</sub> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}
