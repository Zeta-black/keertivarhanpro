/**
 * Public surface of the chemistry layer.
 *
 * The one rule this layer enforces: molecular depiction is built from
 * SPECIFIC residues, while the optimiser searches amino-acid CLASSES. Nothing
 * here reads or writes a Potts score, and nothing in `src/science` imports
 * from here, so a change of displayed residue cannot move a class-level
 * number.
 */

export * from './elements';
export * from './residues';
export * from './molecule';
export * from './peptide';
export * from './conformer';

import { embed3D, SECONDARY_STRUCTURES, type EmbedOptions, type EmbedReport } from './conformer';
import { centre, toMolfile, toPdb, toSdf } from './molecule';
import { buildPeptide, toFasta, type PeptideStructure } from './peptide';

export interface PeptideModel {
  readonly structure: PeptideStructure;
  readonly embed: EmbedReport;
  /** PDB coordinate text, ready for a molecular viewer. */
  readonly pdb: string;
  /** MDL molfile with explicit bond orders. */
  readonly molfile: string;
}

/**
 * Builds the molecule, generates a conformer and renders both file formats.
 * Throws if the connection table is not chemically consistent, so a broken
 * template can never reach a viewer.
 */
export function buildPeptideModel(
  residues: readonly string[],
  options: EmbedOptions = {},
): PeptideModel {
  const structure = buildPeptide(residues);
  if (structure.valenceProblems.length > 0) {
    throw new Error(
      `peptide ${structure.sequence} failed valence validation: ${structure.valenceProblems
        .map((p) => `${p.name} ${p.message}`)
        .join('; ')}`,
    );
  }
  const embed = embed3D(structure, options);
  centre(structure.molecule);
  const name = SECONDARY_STRUCTURES.find((s) => s.id === embed.structure.id)?.label ?? '';
  return {
    structure,
    embed,
    pdb: toPdb(structure.molecule, {
      title: `QBindSelect generated conformer ${structure.sequence}`,
      remarks: [
        'GENERATED CONFORMER - idealised internal coordinates, not an experimental structure.',
        `Backbone torsions: phi ${embed.structure.phi} psi ${embed.structure.psi} omega ${embed.structure.omega} (${name}).`,
        'Heavy atoms only. Termini stored neutral (-NH2, -COOH).',
      ],
    }),
    molfile: toMolfile(structure.molecule, `QBindSelect ${structure.sequence}`),
  };
}

/** The full export bundle for one designed peptide. */
export function peptideExportFiles(
  model: PeptideModel,
  label: string,
): { readonly name: string; readonly mime: string; readonly text: string }[] {
  const { structure, embed } = model;
  return [
    {
      name: `${label}.fasta`,
      mime: 'text/plain;charset=utf-8',
      text: toFasta(structure, `${label} ${structure.sequence} | QBindSelect representative residues`),
    },
    {
      name: `${label}.smi`,
      mime: 'chemical/x-daylight-smiles',
      text: `${structure.smiles}\t${label}\n`,
    },
    {
      name: `${label}.sdf`,
      mime: 'chemical/x-mdl-sdfile',
      text: toSdf(structure.molecule, `QBindSelect ${structure.sequence}`, {
        SEQUENCE: structure.sequence,
        SMILES: structure.smiles,
        FORMULA: structure.formula,
        AVERAGE_MASS: structure.mass.average.toFixed(3),
        MONOISOTOPIC_MASS: structure.mass.monoisotopic.toFixed(4),
        CONFORMER: `generated, ${embed.structure.label} torsions (phi ${embed.structure.phi}, psi ${embed.structure.psi}, omega ${embed.structure.omega})`,
        PROVENANCE: 'Idealised generated conformer. Not an experimental structure and not a docking pose.',
      }),
    },
    {
      name: `${label}.pdb`,
      mime: 'chemical/x-pdb',
      text: model.pdb,
    },
  ];
}
