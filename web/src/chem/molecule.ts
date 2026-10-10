/**
 * The molecular graph, and the standard file formats written from it.
 *
 * A `Molecule` here is a real connection table: every heavy atom, every bond
 * with a formal order, and the implicit hydrogen count derived from each
 * atom's valence. Formula and mass are counted off that table, so they cannot
 * drift away from what is drawn.
 *
 * Nothing in this module knows anything about scoring. Depiction and
 * class-level optimisation are deliberately separate: a molecule is built from
 * explicit RESIDUES, while the optimiser works on CLASSES.
 */

import { ELEMENT_INFO, HILL_ORDER, type Element } from './elements';

export interface Atom {
  readonly index: number;
  readonly element: Element;
  /** Standard PDB atom name, unique within its residue. */
  readonly name: string;
  /** 1-based residue number this atom belongs to. */
  readonly residueSeq: number;
  /** PDB residue name (TRP, GLY ...). */
  readonly residueName: string;
  /** Hydrogens implied by valence; not present as separate atoms. */
  readonly hydrogens: number;
  /** Set once a conformer has been generated. Angstrom. */
  x: number;
  y: number;
  z: number;
}

export interface Bond {
  readonly a: number;
  readonly b: number;
  readonly order: 1 | 2 | 3;
  readonly aromatic: boolean;
}

export interface Molecule {
  readonly atoms: Atom[];
  readonly bonds: Bond[];
  /** True once `embed3D` has written coordinates. */
  hasCoordinates: boolean;
}

export function emptyMolecule(): Molecule {
  return { atoms: [], bonds: [], hasCoordinates: false };
}

/** Sum of formal bond orders at an atom, ignoring hydrogens. */
export function heavyValence(mol: Molecule, index: number): number {
  let sum = 0;
  for (const bond of mol.bonds) {
    if (bond.a === index || bond.b === index) sum += bond.order;
  }
  return sum;
}

export function neighbours(mol: Molecule, index: number): number[] {
  const out: number[] = [];
  for (const bond of mol.bonds) {
    if (bond.a === index) out.push(bond.b);
    else if (bond.b === index) out.push(bond.a);
  }
  return out;
}

/** Adjacency list, built once for the geometry and ring code. */
export function adjacency(mol: Molecule): number[][] {
  const adj: number[][] = mol.atoms.map(() => []);
  for (const bond of mol.bonds) {
    adj[bond.a].push(bond.b);
    adj[bond.b].push(bond.a);
  }
  return adj;
}

export function bondBetween(mol: Molecule, a: number, b: number): Bond | null {
  for (const bond of mol.bonds) {
    if ((bond.a === a && bond.b === b) || (bond.a === b && bond.b === a)) return bond;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

export type Composition = Readonly<Partial<Record<Element, number>>>;

export function composition(mol: Molecule): Composition {
  const counts: Partial<Record<Element, number>> = {};
  let hydrogens = 0;
  for (const atom of mol.atoms) {
    counts[atom.element] = (counts[atom.element] ?? 0) + 1;
    hydrogens += atom.hydrogens;
  }
  if (hydrogens > 0) counts.H = (counts.H ?? 0) + hydrogens;
  return counts;
}

/** Hill-notation molecular formula, e.g. `C52H71N11O12`. */
export function molecularFormula(mol: Molecule): string {
  const counts = composition(mol);
  let out = '';
  for (const element of HILL_ORDER) {
    const n = counts[element];
    if (!n) continue;
    out += element + (n > 1 ? String(n) : '');
  }
  return out;
}

export interface MassReport {
  /** Average (standard atomic weight) molecular mass, g/mol. */
  readonly average: number;
  /** Monoisotopic mass, Da - the value a mass spectrometer would target. */
  readonly monoisotopic: number;
}

export function molecularMass(mol: Molecule): MassReport {
  const counts = composition(mol);
  let average = 0;
  let monoisotopic = 0;
  for (const element of HILL_ORDER) {
    const n = counts[element];
    if (!n) continue;
    average += ELEMENT_INFO[element].mass * n;
    monoisotopic += ELEMENT_INFO[element].monoisotopic * n;
  }
  return { average, monoisotopic };
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface ValenceProblem {
  readonly atom: number;
  readonly name: string;
  readonly message: string;
}

/**
 * Checks that every atom's formal bond orders plus its implicit hydrogens come
 * to exactly the neutral covalent valence, and that no bond is self-referential
 * or duplicated. A molecule that fails this is never handed to a viewer.
 */
export function validateValence(mol: Molecule): ValenceProblem[] {
  const problems: ValenceProblem[] = [];
  const seen = new Set<string>();
  for (const bond of mol.bonds) {
    if (bond.a === bond.b) {
      problems.push({ atom: bond.a, name: mol.atoms[bond.a]?.name ?? '?', message: 'bond joins an atom to itself' });
      continue;
    }
    const key = bond.a < bond.b ? `${bond.a}-${bond.b}` : `${bond.b}-${bond.a}`;
    if (seen.has(key)) {
      problems.push({ atom: bond.a, name: mol.atoms[bond.a]?.name ?? '?', message: 'duplicate bond' });
    }
    seen.add(key);
  }
  for (const atom of mol.atoms) {
    const expected = ELEMENT_INFO[atom.element].valence;
    const actual = heavyValence(mol, atom.index) + atom.hydrogens;
    if (actual !== expected) {
      problems.push({
        atom: atom.index,
        name: `${atom.residueName}${atom.residueSeq}:${atom.name}`,
        message: `${atom.element} has valence ${actual}, expected ${expected}`,
      });
    }
  }
  return problems;
}

/** Ring bond count via the cyclomatic number: bonds - atoms + connected components. */
export function ringCount(mol: Molecule): number {
  const adj = adjacency(mol);
  const seen = new Array<boolean>(mol.atoms.length).fill(false);
  let components = 0;
  for (let i = 0; i < mol.atoms.length; i += 1) {
    if (seen[i]) continue;
    components += 1;
    const stack = [i];
    seen[i] = true;
    while (stack.length > 0) {
      const v = stack.pop() as number;
      for (const w of adj[v]) {
        if (!seen[w]) {
          seen[w] = true;
          stack.push(w);
        }
      }
    }
  }
  return mol.bonds.length - mol.atoms.length + components;
}

/**
 * Smallest set of smallest rings, found by a breadth-first shortest-cycle
 * search through each bond. Enough for the planar aromatic systems in the
 * amino-acid set (benzene, imidazole, the fused indole pair).
 */
export function findRings(mol: Molecule): number[][] {
  const target = ringCount(mol);
  if (target <= 0) return [];
  const adj = adjacency(mol);
  const rings: number[][] = [];
  const signatures = new Set<string>();

  for (const bond of mol.bonds) {
    // Shortest path from bond.a to bond.b that does not use the bond itself
    // closes the smallest ring through that bond.
    const prev = new Map<number, number>();
    const queue: number[] = [bond.a];
    prev.set(bond.a, -1);
    let found = false;
    while (queue.length > 0 && !found) {
      const v = queue.shift() as number;
      for (const w of adj[v]) {
        if (v === bond.a && w === bond.b) continue;
        if (v === bond.b && w === bond.a) continue;
        if (prev.has(w)) continue;
        prev.set(w, v);
        if (w === bond.b) {
          found = true;
          break;
        }
        queue.push(w);
      }
    }
    if (!found) continue;
    const ring: number[] = [];
    let cursor: number | undefined = bond.b;
    while (cursor !== undefined && cursor !== -1) {
      ring.push(cursor);
      cursor = prev.get(cursor);
    }
    const signature = [...ring].sort((p, q) => p - q).join(',');
    if (!signatures.has(signature)) {
      signatures.add(signature);
      rings.push(ring);
    }
  }

  rings.sort((p, q) => p.length - q.length);
  return rings.slice(0, target);
}

/* ------------------------------------------------------------------ *
 * File formats
 * ------------------------------------------------------------------ */

function fixed(value: number, width: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return text.length >= width ? text.slice(0, width) : ' '.repeat(width - text.length) + text;
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : ' '.repeat(width - text.length) + text;
}

/**
 * PDB atom name field: the element symbol is right-justified in columns 13-14,
 * which for one-letter elements means a leading space. Getting this wrong makes
 * every viewer mis-assign the element, so it is done explicitly.
 */
function pdbAtomName(name: string): string {
  return padRight(name.length >= 4 ? name : ` ${name}`, 4);
}

export interface PdbOptions {
  readonly title?: string;
  readonly remarks?: readonly string[];
  readonly chain?: string;
}

/** Writes a standards-compliant PDB coordinate file (heavy atoms only). */
export function toPdb(mol: Molecule, options: PdbOptions = {}): string {
  if (!mol.hasCoordinates) {
    throw new Error('toPdb needs a conformer: call embed3D first');
  }
  const chain = options.chain ?? 'A';
  const lines: string[] = [];
  if (options.title) lines.push(`TITLE     ${options.title.slice(0, 70)}`);
  for (const remark of options.remarks ?? []) {
    lines.push(`REMARK   1 ${remark.slice(0, 68)}`);
  }
  mol.atoms.forEach((atom, i) => {
    lines.push(
      'ATOM  ' +
        padLeft(String(i + 1), 5) +
        ' ' +
        pdbAtomName(atom.name) +
        ' ' +
        padRight(atom.residueName, 3) +
        ' ' +
        chain +
        padLeft(String(atom.residueSeq), 4) +
        '    ' +
        fixed(atom.x, 8, 3) +
        fixed(atom.y, 8, 3) +
        fixed(atom.z, 8, 3) +
        '  1.00  0.00          ' +
        padLeft(atom.element, 2),
    );
  });
  lines.push(
    'TER   ' +
      padLeft(String(mol.atoms.length + 1), 5) +
      '      ' +
      padRight(mol.atoms[mol.atoms.length - 1]?.residueName ?? 'UNK', 3) +
      ' ' +
      chain +
      padLeft(String(mol.atoms[mol.atoms.length - 1]?.residueSeq ?? 1), 4),
  );
  // CONECT records so a viewer does not have to guess connectivity. PDB CONECT
  // carries no bond order; the SDF export below does.
  const partners = mol.atoms.map(() => [] as number[]);
  for (const bond of mol.bonds) {
    partners[bond.a].push(bond.b + 1);
    partners[bond.b].push(bond.a + 1);
  }
  partners.forEach((list, i) => {
    for (let start = 0; start < list.length; start += 4) {
      const slice = list.slice(start, start + 4);
      lines.push(
        'CONECT' + padLeft(String(i + 1), 5) + slice.map((n) => padLeft(String(n), 5)).join(''),
      );
    }
  });
  lines.push('END');
  return lines.join('\n') + '\n';
}

/**
 * Writes an MDL molfile (V2000). Bond orders are explicit, so this is the
 * format to use when bond order matters - a 2D depiction or a cheminformatics
 * tool downstream.
 */
export function toMolfile(mol: Molecule, title = 'QBindSelect peptide'): string {
  const lines: string[] = [];
  lines.push(title.slice(0, 80));
  lines.push('  QBindSelect  2D/3D connection table');
  lines.push('');
  lines.push(
    padLeft(String(mol.atoms.length), 3) +
      padLeft(String(mol.bonds.length), 3) +
      '  0  0  0  0  0  0  0  0999 V2000',
  );
  for (const atom of mol.atoms) {
    lines.push(
      fixed(mol.hasCoordinates ? atom.x : 0, 10, 4) +
        fixed(mol.hasCoordinates ? atom.y : 0, 10, 4) +
        fixed(mol.hasCoordinates ? atom.z : 0, 10, 4) +
        ' ' +
        padRight(atom.element, 3) +
        ' 0  0  0  0  0  0  0  0  0  0  0  0',
    );
  }
  for (const bond of mol.bonds) {
    lines.push(
      padLeft(String(bond.a + 1), 3) +
        padLeft(String(bond.b + 1), 3) +
        padLeft(String(bond.order), 3) +
        '  0  0  0  0',
    );
  }
  lines.push('M  END');
  return lines.join('\n') + '\n';
}

/** An SDF record: a molfile plus named data fields. */
export function toSdf(
  mol: Molecule,
  title: string,
  data: Readonly<Record<string, string>> = {},
): string {
  const parts = [toMolfile(mol, title).trimEnd()];
  for (const [key, value] of Object.entries(data)) {
    parts.push(`> <${key}>`);
    parts.push(value);
    parts.push('');
  }
  parts.push('$$$$');
  return parts.join('\n') + '\n';
}

/** Translates the molecule so its centroid sits at the origin. */
export function centre(mol: Molecule): void {
  if (mol.atoms.length === 0) return;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const atom of mol.atoms) {
    cx += atom.x;
    cy += atom.y;
    cz += atom.z;
  }
  cx /= mol.atoms.length;
  cy /= mol.atoms.length;
  cz /= mol.atoms.length;
  for (const atom of mol.atoms) {
    atom.x -= cx;
    atom.y -= cy;
    atom.z -= cz;
  }
}
