/**
 * Explicit chemical templates for the nineteen amino acids that appear in the
 * QBindSelect six-class alphabet (proline is absent from
 * `config/amino_acid_class_mapping.yaml`, so it is absent here too).
 *
 * Each template carries REAL connectivity, not a picture of connectivity:
 *  - every heavy atom with its standard PDB atom name and element
 *  - every bond with an explicit Kekule bond order and an aromatic flag
 *  - the side-chain SMILES branch as it attaches to CA
 *
 * Aromatic rings use a valid Kekule structure (alternating formal orders)
 * rather than an "aromatic" placeholder, because the implicit-hydrogen count,
 * and therefore the molecular formula and mass, are derived from bond orders.
 * `freeFormula` / `freeMass` are the published values for the free amino acid
 * and exist so the computed formula can be checked against them in tests.
 */

import { CLASS_INFO, type ClassName } from '../science/alphabet';
import type { Element } from './elements';

export interface TemplateAtom {
  /** Standard PDB atom name (CB, CG1, NE2, OXT ...). */
  readonly name: string;
  readonly element: Element;
}

export interface TemplateBond {
  readonly a: string;
  readonly b: string;
  /** Kekule bond order. Aromatic rings alternate 1 and 2. */
  readonly order: 1 | 2;
  /** True when the bond is part of an aromatic ring system. */
  readonly aromatic?: boolean;
}

export type Polarity = 'nonpolar' | 'polar' | 'acidic' | 'basic' | 'aromatic';

export interface ResidueTemplate {
  readonly code: string;
  readonly code3: string;
  readonly name: string;
  readonly classId: ClassName;
  /** Glycine has no side chain and therefore no stereocentre at CA. */
  readonly chiral: boolean;
  /** SMILES branch written immediately after CA in `N[C@@H](...)C(=O)`. */
  readonly sideChainSmiles: string;
  /** Side-chain heavy atoms, excluding the backbone N, CA, C, O. */
  readonly atoms: readonly TemplateAtom[];
  /** Side-chain bonds. `CA` is a legal endpoint for the CA-CB bond. */
  readonly bonds: readonly TemplateBond[];
  /** Kyte-Doolittle hydropathy index. */
  readonly hydropathy: number;
  readonly polarity: Polarity;
  /** Formal charge of the side chain at pH 7, for the composition readout. */
  readonly sideChainCharge: -1 | 0 | 1;
  /** Published molecular formula of the FREE amino acid; checked in tests. */
  readonly freeFormula: string;
  /** Published average molecular mass of the free amino acid, g/mol. */
  readonly freeMass: number;
  /** One line of chemistry a reader can actually use. */
  readonly note: string;
}

/** Benzene ring shared by Phe and Tyr, as a valid Kekule structure. */
const PHENYL_BONDS: readonly TemplateBond[] = [
  { a: 'CG', b: 'CD1', order: 2, aromatic: true },
  { a: 'CD1', b: 'CE1', order: 1, aromatic: true },
  { a: 'CE1', b: 'CZ', order: 2, aromatic: true },
  { a: 'CZ', b: 'CE2', order: 1, aromatic: true },
  { a: 'CE2', b: 'CD2', order: 2, aromatic: true },
  { a: 'CD2', b: 'CG', order: 1, aromatic: true },
];

const PHENYL_ATOMS: readonly TemplateAtom[] = [
  { name: 'CG', element: 'C' },
  { name: 'CD1', element: 'C' },
  { name: 'CD2', element: 'C' },
  { name: 'CE1', element: 'C' },
  { name: 'CE2', element: 'C' },
  { name: 'CZ', element: 'C' },
];

export const RESIDUE_TEMPLATES: readonly ResidueTemplate[] = [
  /* ---------------- AROM_W ---------------- */
  {
    code: 'W',
    code3: 'TRP',
    name: 'Tryptophan',
    classId: 'AROM_W',
    chiral: true,
    sideChainSmiles: 'Cc1c[nH]c2ccccc12',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD1', element: 'C' },
      { name: 'CD2', element: 'C' },
      { name: 'NE1', element: 'N' },
      { name: 'CE2', element: 'C' },
      { name: 'CE3', element: 'C' },
      { name: 'CZ2', element: 'C' },
      { name: 'CZ3', element: 'C' },
      { name: 'CH2', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      // Indole, standard Kekule form: C2=C3, C3a=C4, C5=C6, C7=C7a.
      { a: 'CG', b: 'CD1', order: 2, aromatic: true },
      { a: 'CD1', b: 'NE1', order: 1, aromatic: true },
      { a: 'NE1', b: 'CE2', order: 1, aromatic: true },
      { a: 'CE2', b: 'CD2', order: 1, aromatic: true },
      { a: 'CD2', b: 'CG', order: 1, aromatic: true },
      { a: 'CD2', b: 'CE3', order: 2, aromatic: true },
      { a: 'CE3', b: 'CZ3', order: 1, aromatic: true },
      { a: 'CZ3', b: 'CH2', order: 2, aromatic: true },
      { a: 'CH2', b: 'CZ2', order: 1, aromatic: true },
      { a: 'CZ2', b: 'CE2', order: 2, aromatic: true },
    ],
    hydropathy: -0.9,
    polarity: 'aromatic',
    sideChainCharge: 0,
    freeFormula: 'C11H12N2O2',
    freeMass: 204.23,
    note: 'Indole: a benzene ring fused to a pyrrole ring. The largest and flattest natural side chain, and the usual choice when a design needs to stack against a flat hydrophobic surface.',
  },

  /* ---------------- AROM_FY ---------------- */
  {
    code: 'F',
    code3: 'PHE',
    name: 'Phenylalanine',
    classId: 'AROM_FY',
    chiral: true,
    sideChainSmiles: 'Cc1ccccc1',
    atoms: [{ name: 'CB', element: 'C' }, ...PHENYL_ATOMS],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      ...PHENYL_BONDS,
    ],
    hydropathy: 2.8,
    polarity: 'aromatic',
    sideChainCharge: 0,
    freeFormula: 'C9H11NO2',
    freeMass: 165.19,
    note: 'A plain benzene ring on a single CH2 linker. Rigid, flat and entirely non-polar.',
  },
  {
    code: 'Y',
    code3: 'TYR',
    name: 'Tyrosine',
    classId: 'AROM_FY',
    chiral: true,
    sideChainSmiles: 'Cc1ccc(O)cc1',
    atoms: [{ name: 'CB', element: 'C' }, ...PHENYL_ATOMS, { name: 'OH', element: 'O' }],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      ...PHENYL_BONDS,
      { a: 'CZ', b: 'OH', order: 1 },
    ],
    hydropathy: -1.3,
    polarity: 'aromatic',
    sideChainCharge: 0,
    freeFormula: 'C9H11NO3',
    freeMass: 181.19,
    note: 'Phenylalanine with a hydroxyl at the para position. Keeps the flat ring but adds one hydrogen-bond donor and acceptor.',
  },

  /* ---------------- HYDROPHOBIC ---------------- */
  {
    code: 'A',
    code3: 'ALA',
    name: 'Alanine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: 'C',
    atoms: [{ name: 'CB', element: 'C' }],
    bonds: [{ a: 'CA', b: 'CB', order: 1 }],
    hydropathy: 1.8,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C3H7NO2',
    freeMass: 89.09,
    note: 'A single methyl group: the smallest non-polar side chain.',
  },
  {
    code: 'V',
    code3: 'VAL',
    name: 'Valine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: 'C(C)C',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG1', element: 'C' },
      { name: 'CG2', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG1', order: 1 },
      { a: 'CB', b: 'CG2', order: 1 },
    ],
    hydropathy: 4.2,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C5H11NO2',
    freeMass: 117.15,
    note: 'Branched at the first side-chain carbon, which makes it bulky right next to the backbone.',
  },
  {
    code: 'L',
    code3: 'LEU',
    name: 'Leucine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: 'CC(C)C',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD1', element: 'C' },
      { name: 'CD2', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'CD1', order: 1 },
      { a: 'CG', b: 'CD2', order: 1 },
    ],
    hydropathy: 3.8,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C6H13NO2',
    freeMass: 131.17,
    note: 'Branched one carbon further out than valine, so it is bulky but still flexible. The most common hydrophobic residue in natural proteins.',
  },
  {
    code: 'I',
    code3: 'ILE',
    name: 'Isoleucine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: '[C@@H](C)CC',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG1', element: 'C' },
      { name: 'CG2', element: 'C' },
      { name: 'CD1', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG1', order: 1 },
      { a: 'CB', b: 'CG2', order: 1 },
      { a: 'CG1', b: 'CD1', order: 1 },
    ],
    hydropathy: 4.5,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C6H13NO2',
    freeMass: 131.17,
    note: 'The most hydrophobic residue on the Kyte-Doolittle scale. Has a second stereocentre at CB; the natural form is (2S,3S).',
  },
  {
    code: 'M',
    code3: 'MET',
    name: 'Methionine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: 'CCSC',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'SD', element: 'S' },
      { name: 'CE', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'SD', order: 1 },
      { a: 'SD', b: 'CE', order: 1 },
    ],
    hydropathy: 1.9,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C5H11NO2S',
    freeMass: 149.21,
    note: 'A thioether. Long, flexible and non-polar, with a sulfur that is noticeably larger than carbon.',
  },
  {
    code: 'C',
    code3: 'CYS',
    name: 'Cysteine',
    classId: 'HYDROPHOBIC',
    chiral: true,
    sideChainSmiles: 'CS',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'SG', element: 'S' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'SG', order: 1 },
    ],
    hydropathy: 2.5,
    polarity: 'nonpolar',
    sideChainCharge: 0,
    freeFormula: 'C3H7NO2S',
    freeMass: 121.16,
    note: 'A free thiol. Two cysteines can oxidise into a disulfide bridge; this builder always leaves them reduced.',
  },

  /* ---------------- SMALL_POLAR ---------------- */
  {
    code: 'G',
    code3: 'GLY',
    name: 'Glycine',
    classId: 'SMALL_POLAR',
    chiral: false,
    sideChainSmiles: '',
    atoms: [],
    bonds: [],
    hydropathy: -0.4,
    polarity: 'polar',
    sideChainCharge: 0,
    freeFormula: 'C2H5NO2',
    freeMass: 75.07,
    note: 'No side chain at all, so CA carries two hydrogens and is not a stereocentre. The most flexible residue, used as a hinge.',
  },
  {
    code: 'S',
    code3: 'SER',
    name: 'Serine',
    classId: 'SMALL_POLAR',
    chiral: true,
    sideChainSmiles: 'CO',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'OG', element: 'O' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'OG', order: 1 },
    ],
    hydropathy: -0.8,
    polarity: 'polar',
    sideChainCharge: 0,
    freeFormula: 'C3H7NO3',
    freeMass: 105.09,
    note: 'A short hydroxymethyl group: small, uncharged, and both a hydrogen-bond donor and an acceptor.',
  },
  {
    code: 'T',
    code3: 'THR',
    name: 'Threonine',
    classId: 'SMALL_POLAR',
    chiral: true,
    sideChainSmiles: '[C@H](O)C',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'OG1', element: 'O' },
      { name: 'CG2', element: 'C' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'OG1', order: 1 },
      { a: 'CB', b: 'CG2', order: 1 },
    ],
    hydropathy: -0.7,
    polarity: 'polar',
    sideChainCharge: 0,
    freeFormula: 'C4H9NO3',
    freeMass: 119.12,
    note: 'Serine plus a methyl branch. Has a second stereocentre at CB; the natural form is (2S,3R).',
  },
  {
    code: 'N',
    code3: 'ASN',
    name: 'Asparagine',
    classId: 'SMALL_POLAR',
    chiral: true,
    sideChainSmiles: 'CC(N)=O',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'OD1', element: 'O' },
      { name: 'ND2', element: 'N' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'OD1', order: 2 },
      { a: 'CG', b: 'ND2', order: 1 },
    ],
    hydropathy: -3.5,
    polarity: 'polar',
    sideChainCharge: 0,
    freeFormula: 'C4H8N2O3',
    freeMass: 132.12,
    note: 'A primary amide, the same functional group as the peptide bond itself. Planar, neutral, and strongly hydrogen-bonding.',
  },
  {
    code: 'Q',
    code3: 'GLN',
    name: 'Glutamine',
    classId: 'SMALL_POLAR',
    chiral: true,
    sideChainSmiles: 'CCC(N)=O',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD', element: 'C' },
      { name: 'OE1', element: 'O' },
      { name: 'NE2', element: 'N' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'CD', order: 1 },
      { a: 'CD', b: 'OE1', order: 2 },
      { a: 'CD', b: 'NE2', order: 1 },
    ],
    hydropathy: -3.5,
    polarity: 'polar',
    sideChainCharge: 0,
    freeFormula: 'C5H10N2O3',
    freeMass: 146.15,
    note: 'Asparagine with one extra CH2, so the amide reaches further from the backbone.',
  },

  /* ---------------- CHARGED_NEG ---------------- */
  {
    code: 'D',
    code3: 'ASP',
    name: 'Aspartate',
    classId: 'CHARGED_NEG',
    chiral: true,
    sideChainSmiles: 'CC(O)=O',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'OD1', element: 'O' },
      { name: 'OD2', element: 'O' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'OD1', order: 2 },
      { a: 'CG', b: 'OD2', order: 1 },
    ],
    hydropathy: -3.5,
    polarity: 'acidic',
    sideChainCharge: -1,
    freeFormula: 'C4H7NO4',
    freeMass: 133.1,
    note: 'A carboxylic acid two bonds from the backbone. Deprotonated and negatively charged at pH 7; the structure file stores the neutral acid.',
  },
  {
    code: 'E',
    code3: 'GLU',
    name: 'Glutamate',
    classId: 'CHARGED_NEG',
    chiral: true,
    sideChainSmiles: 'CCC(O)=O',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD', element: 'C' },
      { name: 'OE1', element: 'O' },
      { name: 'OE2', element: 'O' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'CD', order: 1 },
      { a: 'CD', b: 'OE1', order: 2 },
      { a: 'CD', b: 'OE2', order: 1 },
    ],
    hydropathy: -3.5,
    polarity: 'acidic',
    sideChainCharge: -1,
    freeFormula: 'C5H9NO4',
    freeMass: 147.13,
    note: 'Aspartate with one extra CH2. Longer reach, same negative charge.',
  },

  /* ---------------- CHARGED_POS ---------------- */
  {
    code: 'K',
    code3: 'LYS',
    name: 'Lysine',
    classId: 'CHARGED_POS',
    chiral: true,
    sideChainSmiles: 'CCCCN',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD', element: 'C' },
      { name: 'CE', element: 'C' },
      { name: 'NZ', element: 'N' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'CD', order: 1 },
      { a: 'CD', b: 'CE', order: 1 },
      { a: 'CE', b: 'NZ', order: 1 },
    ],
    hydropathy: -3.9,
    polarity: 'basic',
    sideChainCharge: 1,
    freeFormula: 'C6H14N2O2',
    freeMass: 146.19,
    note: 'A four-carbon chain ending in a primary amine. Protonated and positively charged at pH 7; stored here as the neutral amine.',
  },
  {
    code: 'R',
    code3: 'ARG',
    name: 'Arginine',
    classId: 'CHARGED_POS',
    chiral: true,
    sideChainSmiles: 'CCCNC(N)=N',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'CD', element: 'C' },
      { name: 'NE', element: 'N' },
      { name: 'CZ', element: 'C' },
      { name: 'NH1', element: 'N' },
      { name: 'NH2', element: 'N' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      { a: 'CG', b: 'CD', order: 1 },
      { a: 'CD', b: 'NE', order: 1 },
      { a: 'NE', b: 'CZ', order: 1 },
      { a: 'CZ', b: 'NH1', order: 2 },
      { a: 'CZ', b: 'NH2', order: 1 },
    ],
    hydropathy: -4.5,
    polarity: 'basic',
    sideChainCharge: 1,
    freeFormula: 'C6H14N4O2',
    freeMass: 174.2,
    note: 'A guanidinium group: three nitrogens around one carbon, planar and delocalised. Stays positively charged across the whole physiological pH range.',
  },
  {
    code: 'H',
    code3: 'HIS',
    name: 'Histidine',
    classId: 'CHARGED_POS',
    chiral: true,
    sideChainSmiles: 'Cc1nc[nH]c1',
    atoms: [
      { name: 'CB', element: 'C' },
      { name: 'CG', element: 'C' },
      { name: 'ND1', element: 'N' },
      { name: 'CD2', element: 'C' },
      { name: 'CE1', element: 'C' },
      { name: 'NE2', element: 'N' },
    ],
    bonds: [
      { a: 'CA', b: 'CB', order: 1 },
      { a: 'CB', b: 'CG', order: 1 },
      // Imidazole, NE2-H tautomer (the HIE form the Potts source files use).
      { a: 'CG', b: 'ND1', order: 1, aromatic: true },
      { a: 'ND1', b: 'CE1', order: 2, aromatic: true },
      { a: 'CE1', b: 'NE2', order: 1, aromatic: true },
      { a: 'NE2', b: 'CD2', order: 1, aromatic: true },
      { a: 'CD2', b: 'CG', order: 2, aromatic: true },
    ],
    hydropathy: -3.2,
    polarity: 'basic',
    sideChainCharge: 0,
    freeFormula: 'C6H9N3O2',
    freeMass: 155.15,
    note: 'An imidazole ring with a pKa near 6, so it is only partly protonated at pH 7. Drawn in the NE2-H tautomer, which is the form the source energy tables use (HIE).',
  },
];

export const RESIDUE_BY_CODE: Readonly<Record<string, ResidueTemplate>> = Object.fromEntries(
  RESIDUE_TEMPLATES.map((r) => [r.code, r]),
);

export function residueFor(code: string): ResidueTemplate {
  const found = RESIDUE_BY_CODE[code.toUpperCase()];
  if (!found) {
    throw new Error(
      `no chemical template for residue "${code}" (the six-class alphabet covers ${RESIDUE_TEMPLATES.map(
        (r) => r.code,
      ).join('')})`,
    );
  }
  return found;
}

/**
 * Every residue the given class contains, in the order the class mapping lists
 * them. The mapping in `science/alphabet` is the single source of truth for
 * that order, so this cannot drift from the optimiser's view of the alphabet.
 */
export function residuesInClass(classId: ClassName): readonly ResidueTemplate[] {
  const info = CLASS_INFO.find((c) => c.id === classId);
  if (!info) return [];
  return info.residues
    .map((code) => RESIDUE_BY_CODE[code])
    .filter((t): t is ResidueTemplate => t !== undefined);
}
