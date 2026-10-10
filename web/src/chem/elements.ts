/**
 * Element data used by the molecular builder, the conformer generator and the
 * viewers.
 *
 * Values are the standard reference numbers a chemistry package would use:
 *  - `valence` is the neutral covalent valence, used to derive the implicit
 *    hydrogen count from the explicit heavy-atom bond orders. That is what
 *    makes the molecular formula and mass exact rather than approximate.
 *  - `vdw` are Bondi van der Waals radii (A), used only for steric relief.
 *  - `colour` is the Jmol/CPK element palette, so the 3D view matches what
 *    PyMOL, Jmol and Mol* show for the same atom.
 *  - `mass` is the IUPAC standard atomic weight; `monoisotopic` is the mass of
 *    the most abundant isotope, used for the monoisotopic molecular mass.
 */

export const ELEMENTS = ['H', 'C', 'N', 'O', 'S'] as const;
export type Element = (typeof ELEMENTS)[number];

export interface ElementInfo {
  readonly symbol: Element;
  readonly z: number;
  readonly valence: number;
  /** Bondi van der Waals radius, angstrom. */
  readonly vdw: number;
  /** Single-bond covalent radius, angstrom. */
  readonly covalent: number;
  /** Jmol CPK colour. */
  readonly colour: string;
  /** IUPAC standard atomic weight. */
  readonly mass: number;
  /** Mass of the most abundant isotope. */
  readonly monoisotopic: number;
}

export const ELEMENT_INFO: Readonly<Record<Element, ElementInfo>> = {
  H: { symbol: 'H', z: 1, valence: 1, vdw: 1.2, covalent: 0.31, colour: '#ffffff', mass: 1.008, monoisotopic: 1.0078250319 },
  C: { symbol: 'C', z: 6, valence: 4, vdw: 1.7, covalent: 0.76, colour: '#909090', mass: 12.011, monoisotopic: 12.0 },
  N: { symbol: 'N', z: 7, valence: 3, vdw: 1.55, covalent: 0.71, colour: '#3050f8', mass: 14.007, monoisotopic: 14.0030740052 },
  O: { symbol: 'O', z: 8, valence: 2, vdw: 1.52, covalent: 0.66, colour: '#ff0d0d', mass: 15.999, monoisotopic: 15.9949146221 },
  S: { symbol: 'S', z: 16, valence: 2, vdw: 1.8, covalent: 1.05, colour: '#ffff30', mass: 32.06, monoisotopic: 31.97207069 },
};

/** Hill-system element order for a molecular formula: C, then H, then the rest alphabetically. */
export const HILL_ORDER: readonly Element[] = ['C', 'H', 'N', 'O', 'S'];

export function isElement(value: string): value is Element {
  return (ELEMENTS as readonly string[]).includes(value);
}

/**
 * Equilibrium bond length, angstrom, by element pair and bond order.
 * Sources are the usual tabulated averages from small-molecule
 * crystallography (CCDC/Allen et al.); amide and carboxyl lengths are the
 * delocalised values rather than the pure single/double ones because that is
 * what the real geometry shows.
 */
const BOND_TABLE: Readonly<Record<string, number>> = {
  'C-C:1': 1.52,
  'C-C:2': 1.33,
  'C-C:ar': 1.39,
  'C-N:1': 1.47,
  'C-N:2': 1.28,
  'C-N:ar': 1.34,
  'C-N:amide': 1.333,
  'C-O:1': 1.41,
  'C-O:2': 1.231,
  'C-O:carboxyl': 1.26,
  'C-S:1': 1.81,
  'N-N:1': 1.45,
  'O-O:1': 1.48,
  'H-C:1': 1.09,
  'H-N:1': 1.01,
  'H-O:1': 0.97,
  'H-S:1': 1.34,
};

export type BondFlavour = '1' | '2' | 'ar' | 'amide' | 'carboxyl';

/** Looks up an equilibrium bond length; element order does not matter. */
export function bondLength(a: Element, b: Element, flavour: BondFlavour): number {
  const pair = [a, b].sort().join('-');
  const exact = BOND_TABLE[`${pair}:${flavour}`];
  if (exact !== undefined) return exact;
  // Fall back to the single-bond entry, then to covalent radii. Both paths are
  // deterministic, so a missing table row can never silently become a zero.
  const single = BOND_TABLE[`${pair}:1`];
  if (single !== undefined) return single;
  return ELEMENT_INFO[a].covalent + ELEMENT_INFO[b].covalent;
}
