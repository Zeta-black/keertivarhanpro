/**
 * Builds a real peptide from a list of amino-acid residues.
 *
 * The chemistry is the ordinary condensation: for each residue the backbone
 * contributes N, CA, C and a carbonyl O; the carboxyl carbon of residue i is
 * bonded to the amide nitrogen of residue i+1, which is the peptide bond. One
 * water is lost per bond formed, and the resulting molecular formula is
 * therefore sum(free amino acids) - (n-1) * H2O. That identity is asserted in
 * `tests/chem/peptide.test.ts` rather than assumed.
 *
 * Termini are stored in their NEUTRAL forms (a free -NH2 amine and a -COOH
 * acid) because that is what a structure file and a SMILES string normally
 * carry. The zwitterion that actually exists at pH 7 is reported separately as
 * a charge count, not silently drawn.
 *
 * This module has no connection to the Potts scoring model. A peptide is built
 * from SPECIFIC residues; the optimiser searches amino-acid CLASSES. Choosing a
 * different member of the same class changes the molecule here and changes
 * nothing about the class-level score, by construction.
 */

import { CLASS_INFO, type ClassName, type Codes } from '../science/alphabet';
import {
  emptyMolecule,
  heavyValence,
  molecularFormula,
  molecularMass,
  ringCount,
  validateValence,
  type Atom,
  type MassReport,
  type Molecule,
  type ValenceProblem,
} from './molecule';
import { ELEMENT_INFO } from './elements';
import { RESIDUE_TEMPLATES, residueFor, type ResidueTemplate } from './residues';

export interface ResidueInstance {
  /** 1-based position in the peptide. */
  readonly seq: number;
  readonly template: ResidueTemplate;
  /** Every atom index belonging to this residue, backbone first. */
  readonly atoms: readonly number[];
  /** Backbone atom indices, for highlighting and for the geometry builder. */
  readonly backbone: { readonly N: number; readonly CA: number; readonly C: number; readonly O: number };
  /** Side-chain atom indices only. Empty for glycine. */
  readonly sideChain: readonly number[];
}

export interface PeptideStructure {
  /** One-letter sequence, N-terminus first. */
  readonly sequence: string;
  readonly residues: readonly ResidueInstance[];
  readonly molecule: Molecule;
  /** Isomeric SMILES with explicit L-stereocentres. */
  readonly smiles: string;
  readonly formula: string;
  readonly mass: MassReport;
  /** Peptide bonds, i.e. residues - 1. */
  readonly peptideBonds: number;
  readonly heavyAtoms: number;
  readonly bondCount: number;
  readonly rings: number;
  /** Rotatable single bonds, excluding amides and ring bonds. */
  readonly rotatableBonds: number;
  /** Net formal charge at pH 7: termini plus charged side chains. */
  readonly netChargeAtPh7: number;
  /** Empty when the connection table is chemically consistent. */
  readonly valenceProblems: readonly ValenceProblem[];
}

/** FASTA record for the sequence, wrapped at 60 columns like the standard. */
export function toFasta(structure: PeptideStructure, header: string): string {
  const lines = [`>${header}`];
  for (let i = 0; i < structure.sequence.length; i += 60) {
    lines.push(structure.sequence.slice(i, i + 60));
  }
  return lines.join('\n') + '\n';
}

function pushAtom(
  mol: Molecule,
  element: Atom['element'],
  name: string,
  residueSeq: number,
  residueName: string,
): number {
  const index = mol.atoms.length;
  mol.atoms.push({
    index,
    element,
    name,
    residueSeq,
    residueName,
    hydrogens: 0,
    x: 0,
    y: 0,
    z: 0,
  });
  return index;
}

/**
 * Assembles the peptide. `codes` is a list of one-letter residue codes; every
 * code must be one of the nineteen the six-class alphabet contains.
 */
export function buildPeptide(codes: readonly string[]): PeptideStructure {
  if (codes.length === 0) throw new Error('a peptide needs at least one residue');
  const templates = codes.map((code) => residueFor(code));
  const mol = emptyMolecule();
  const residues: ResidueInstance[] = [];

  let previousC: number | null = null;

  templates.forEach((template, i) => {
    const seq = i + 1;
    const res = template.code3;
    const nIndex = pushAtom(mol, 'N', 'N', seq, res);
    const caIndex = pushAtom(mol, 'C', 'CA', seq, res);
    const cIndex = pushAtom(mol, 'C', 'C', seq, res);
    const oIndex = pushAtom(mol, 'O', 'O', seq, res);

    mol.bonds.push({ a: nIndex, b: caIndex, order: 1, aromatic: false });
    mol.bonds.push({ a: caIndex, b: cIndex, order: 1, aromatic: false });
    mol.bonds.push({ a: cIndex, b: oIndex, order: 2, aromatic: false });

    // Side chain, keyed by PDB atom name so the template bonds can name 'CA'.
    const byName = new Map<string, number>([['CA', caIndex]]);
    const sideChain: number[] = [];
    for (const atom of template.atoms) {
      const index = pushAtom(mol, atom.element, atom.name, seq, res);
      byName.set(atom.name, index);
      sideChain.push(index);
    }
    for (const bond of template.bonds) {
      const a = byName.get(bond.a);
      const b = byName.get(bond.b);
      if (a === undefined || b === undefined) {
        throw new Error(`${template.code3} template names an atom that does not exist: ${bond.a}-${bond.b}`);
      }
      mol.bonds.push({ a, b, order: bond.order, aromatic: bond.aromatic === true });
    }

    // The peptide bond itself.
    if (previousC !== null) {
      mol.bonds.push({ a: previousC, b: nIndex, order: 1, aromatic: false });
    }
    previousC = cIndex;

    residues.push({
      seq,
      template,
      atoms: [nIndex, caIndex, cIndex, oIndex, ...sideChain],
      backbone: { N: nIndex, CA: caIndex, C: cIndex, O: oIndex },
      sideChain,
    });
  });

  // C-terminal hydroxyl completes the free acid.
  const lastC = previousC as unknown as number;
  const oxt = pushAtom(
    mol,
    'O',
    'OXT',
    residues[residues.length - 1].seq,
    residues[residues.length - 1].template.code3,
  );
  mol.bonds.push({ a: lastC, b: oxt, order: 1, aromatic: false });
  residues[residues.length - 1] = {
    ...residues[residues.length - 1],
    atoms: [...residues[residues.length - 1].atoms, oxt],
  };

  // Implicit hydrogens from the neutral covalent valence. Doing this after the
  // whole table is built is what makes the formula exact.
  for (const atom of mol.atoms) {
    const used = heavyValence(mol, atom.index);
    const free = ELEMENT_INFO[atom.element].valence - used;
    if (free < 0) {
      throw new Error(
        `${atom.residueName}${atom.residueSeq}:${atom.name} is over-bonded (${used} > ${ELEMENT_INFO[atom.element].valence})`,
      );
    }
    (atom as { hydrogens: number }).hydrogens = free;
  }

  const sequence = templates.map((t) => t.code).join('');
  const sideChainCharge = templates.reduce((sum, t) => sum + t.sideChainCharge, 0);

  return {
    sequence,
    residues,
    molecule: mol,
    smiles: peptideSmiles(templates),
    formula: molecularFormula(mol),
    mass: molecularMass(mol),
    peptideBonds: templates.length - 1,
    heavyAtoms: mol.atoms.length,
    bondCount: mol.bonds.length,
    rings: ringCount(mol),
    rotatableBonds: countRotatableBonds(mol),
    // N-terminal amine protonated (+1), C-terminal carboxyl deprotonated (-1).
    netChargeAtPh7: 1 - 1 + sideChainCharge,
    valenceProblems: validateValence(mol),
  };
}

/**
 * Isomeric SMILES for the peptide.
 *
 * `N[C@@H](R)C(=O)` is the standard peptide-SMILES idiom: with the neighbour
 * order (N, H, side chain, carbonyl) fixed, the `@@` tag is the L configuration
 * for every residue, which is why the same pattern is reused unchanged.
 * Glycine has no side chain and therefore no tag.
 */
export function peptideSmiles(templates: readonly ResidueTemplate[]): string {
  let out = '';
  for (const template of templates) {
    if (!template.chiral) out += 'NCC(=O)';
    else out += `N[C@@H](${template.sideChainSmiles})C(=O)`;
  }
  return `${out}O`;
}

/**
 * The SMILES heavy-atom index of every atom, grouped by residue.
 *
 * `peptideSmiles` writes each residue as N, CA, (side chain), C, O in that
 * order, and SMILES atom indices are assigned in writing order, so the ranges
 * are determined by the residue lengths alone. This is what lets the 2D
 * depiction highlight residue 3 of 8 without re-parsing the drawing.
 */
export function smilesResidueRanges(templates: readonly ResidueTemplate[]): number[][] {
  const ranges: number[][] = [];
  let next = 0;
  templates.forEach((template, i) => {
    const size = 4 + template.atoms.length + (i === templates.length - 1 ? 1 : 0);
    ranges.push(Array.from({ length: size }, (_, k) => next + k));
    next += size;
  });
  return ranges;
}

/** SMILES for a single free amino acid, used by the residue inspector. */
export function residueSmiles(template: ResidueTemplate): string {
  return peptideSmiles([template]);
}

/**
 * Rotatable bonds: acyclic single bonds between two non-terminal heavy atoms,
 * excluding amide C-N bonds. This is the usual Veber-style definition.
 */
export function countRotatableBonds(mol: Molecule): number {
  const inRing = new Set<string>();
  for (const bond of mol.bonds) {
    if (bond.aromatic) inRing.add(key(bond.a, bond.b));
  }
  let count = 0;
  for (const bond of mol.bonds) {
    if (bond.order !== 1) continue;
    if (inRing.has(key(bond.a, bond.b))) continue;
    const a = mol.atoms[bond.a];
    const b = mol.atoms[bond.b];
    // Terminal heavy atoms cannot define a torsion.
    if (heavyDegree(mol, bond.a) < 2 || heavyDegree(mol, bond.b) < 2) continue;
    // Amide: a nitrogen bonded to a carbon that also carries a double-bonded O.
    if (isAmideBond(mol, a.index, b.index) || isAmideBond(mol, b.index, a.index)) continue;
    count += 1;
  }
  return count;
}

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function heavyDegree(mol: Molecule, index: number): number {
  let n = 0;
  for (const bond of mol.bonds) if (bond.a === index || bond.b === index) n += 1;
  return n;
}

function isAmideBond(mol: Molecule, nitrogen: number, carbon: number): boolean {
  if (mol.atoms[nitrogen].element !== 'N' || mol.atoms[carbon].element !== 'C') return false;
  for (const bond of mol.bonds) {
    if (bond.order !== 2) continue;
    const other = bond.a === carbon ? bond.b : bond.b === carbon ? bond.a : null;
    if (other !== null && mol.atoms[other].element === 'O') return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * The bridge between class-level optimisation and residue-level chemistry
 * ------------------------------------------------------------------ */

/**
 * A choice of one concrete residue per position.
 *
 * The optimiser never produces this: it produces a class sequence. Turning a
 * class sequence into a molecule REQUIRES picking a member of each class, and
 * that choice is the user's (or the documented default representative). This
 * type exists so the distinction is visible in the type system and cannot be
 * lost by accident.
 */
export interface ResidueSelection {
  /** One-letter residue code per position. */
  readonly codes: readonly string[];
  /** The class sequence these residues are members of. */
  readonly classCodes: Codes;
}

/** The documented representative of each class, as the Python benchmark lists it. */
export function defaultResidues(classCodes: Codes): string[] {
  return classCodes.map((c) => CLASS_INFO[c].representative);
}

/** True when `code` is a member of the class at `classIndex`. */
export function residueBelongsToClass(code: string, classIndex: number): boolean {
  const info = CLASS_INFO[classIndex];
  return info !== undefined && info.residues.includes(code.toUpperCase());
}

/**
 * Snaps a residue selection back onto a class sequence: any residue that is not
 * a member of its position's class is replaced by that class's representative.
 * Called whenever the class sequence changes so the two can never disagree.
 */
export function reconcileResidues(classCodes: Codes, chosen: readonly string[]): string[] {
  return classCodes.map((classIndex, position) => {
    const candidate = chosen[position];
    if (candidate && residueBelongsToClass(candidate, classIndex)) return candidate.toUpperCase();
    return CLASS_INFO[classIndex].representative;
  });
}

/** Residue options for a position, as the class mapping orders them. */
export function residueOptions(classIndex: number): readonly ResidueTemplate[] {
  const info = CLASS_INFO[classIndex];
  if (!info) return [];
  return info.residues
    .map((code) => RESIDUE_TEMPLATES.find((t) => t.code === code))
    .filter((t): t is ResidueTemplate => t !== undefined);
}

/** How many distinct molecules a class sequence stands for. */
export function residueDegeneracy(classCodes: Codes): number {
  return classCodes.reduce((product, c) => product * (CLASS_INFO[c]?.residues.length ?? 1), 1);
}

export function classOfResidue(code: string): ClassName | null {
  const template = RESIDUE_TEMPLATES.find((t) => t.code === code.toUpperCase());
  return template ? template.classId : null;
}
