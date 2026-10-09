/**
 * Six-class reduced amino-acid alphabet and the 48-variable one-hot encoding.
 *
 * Mirrors `src/qbind_select/alphabet.py` and
 * `config/amino_acid_class_mapping.yaml` in the Python benchmark. Optimisation
 * happens at CLASS resolution, never at individual-residue resolution: a
 * displayed residue letter is a representative only.
 */

export const LENGTH = 8;
export const ALPHABET_SIZE = 6;
export const BINARY_VARIABLES = LENGTH * ALPHABET_SIZE; // 48
export const VALID_SEQUENCES = ALPHABET_SIZE ** LENGTH; // 1,679,616

export const CLASSES = [
  'AROM_W',
  'AROM_FY',
  'HYDROPHOBIC',
  'SMALL_POLAR',
  'CHARGED_NEG',
  'CHARGED_POS',
] as const;

export type ClassName = (typeof CLASSES)[number];

/** Representative residue per class - display only, matches Python REPRESENTATIVES. */
export const REPRESENTATIVES = ['W', 'F', 'L', 'S', 'E', 'K'] as const;

export interface ClassInfo {
  readonly index: number;
  readonly id: ClassName;
  /** Plain-English name a non-specialist can read. */
  readonly name: string;
  /** Short chip symbol used in the sequence blocks. */
  readonly symbol: string;
  readonly representative: string;
  /** One-letter codes of every residue folded into this class. */
  readonly residues: readonly string[];
  /** Three-letter codes, as used by the Potts source files. */
  readonly residues3: readonly string[];
  /** One sentence, no jargon. */
  readonly plain: string;
  /** Physical property phrase for tooltips. */
  readonly property: string;
  /** CSS custom property holding this class's colour. */
  readonly token: string;
}

export const CLASS_INFO: readonly ClassInfo[] = [
  {
    index: 0,
    id: 'AROM_W',
    name: 'Large aromatic ring',
    symbol: 'Ar+',
    representative: 'W',
    residues: ['W'],
    residues3: ['TRP'],
    plain: 'One big flat ring-shaped building block. Flat rings can stack against flat plastic surfaces.',
    property: 'Bulky, flat, water-avoiding ring',
    token: '--c-arom-w',
  },
  {
    index: 1,
    id: 'AROM_FY',
    name: 'Medium aromatic ring',
    symbol: 'Ar',
    representative: 'F',
    residues: ['F', 'Y'],
    residues3: ['PHE', 'TYR'],
    plain: 'Smaller flat ring-shaped building blocks. Also stack well, but take up less room.',
    property: 'Flat, water-avoiding ring',
    token: '--c-arom-fy',
  },
  {
    index: 2,
    id: 'HYDROPHOBIC',
    name: 'Greasy / water-avoiding',
    symbol: 'Hyd',
    representative: 'L',
    residues: ['A', 'V', 'I', 'L', 'M', 'C'],
    residues3: ['ALA', 'VAL', 'ILE', 'LEU', 'MET', 'CYS'],
    plain: 'Oily building blocks that avoid water. They cling to greasy surfaces like plastic bags.',
    property: 'Non-polar, oily side chain',
    token: '--c-hydrophobic',
  },
  {
    index: 3,
    id: 'SMALL_POLAR',
    name: 'Small water-friendly',
    symbol: 'Pol',
    representative: 'S',
    residues: ['G', 'S', 'T', 'N', 'Q'],
    residues3: ['GLY', 'SER', 'THR', 'ASN', 'GLN'],
    plain: 'Small building blocks that get along with water. Often used as flexible spacers.',
    property: 'Small, polar, water-friendly',
    token: '--c-small-polar',
  },
  {
    index: 4,
    id: 'CHARGED_NEG',
    name: 'Negatively charged',
    symbol: 'Neg',
    representative: 'E',
    residues: ['D', 'E'],
    residues3: ['ASP', 'GLU'],
    plain: 'Carries a negative electrical charge. Attracted to positive charges, pushed away by other negatives.',
    property: 'Acidic, negatively charged',
    token: '--c-charged-neg',
  },
  {
    index: 5,
    id: 'CHARGED_POS',
    name: 'Positively charged',
    symbol: 'Pos',
    representative: 'K',
    residues: ['K', 'R', 'H'],
    residues3: ['ARG', 'LYS', 'HIE'],
    plain: 'Carries a positive electrical charge. Attracted to negative charges, pushed away by other positives.',
    property: 'Basic, positively charged',
    token: '--c-charged-pos',
  },
];

export type Codes = readonly number[];

export function isValidCodes(codes: unknown): codes is number[] {
  return (
    Array.isArray(codes) &&
    codes.length === LENGTH &&
    codes.every((c) => Number.isInteger(c) && c >= 0 && c < ALPHABET_SIZE)
  );
}

export function assertCodes(codes: Codes): void {
  if (!isValidCodes(codes)) {
    throw new Error(
      `expected an ${LENGTH}-position sequence of class indices 0..${ALPHABET_SIZE - 1}`,
    );
  }
}

/** Binary variable index for (position, class) - matches Python variable_index. */
export function variableIndex(position: number, classIndex: number): number {
  return position * ALPHABET_SIZE + classIndex;
}

/** Class sequence to 48-length one-hot vector. */
export function encode(codes: Codes): Uint8Array {
  assertCodes(codes);
  const x = new Uint8Array(BINARY_VARIABLES);
  for (let i = 0; i < LENGTH; i += 1) x[variableIndex(i, codes[i])] = 1;
  return x;
}

/** 48-length one-hot vector to class sequence. Throws when not exactly-one-of-six. */
export function decode(x: ArrayLike<number>): number[] {
  if (!isValidOneHot(x)) throw new Error('invalid one-hot encoding');
  const codes: number[] = [];
  for (let i = 0; i < LENGTH; i += 1) {
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      if (x[variableIndex(i, a)] === 1) codes.push(a);
    }
  }
  return codes;
}

export function isValidOneHot(x: ArrayLike<number>): boolean {
  if (x.length !== BINARY_VARIABLES) return false;
  for (let i = 0; i < LENGTH; i += 1) {
    let sum = 0;
    for (let a = 0; a < ALPHABET_SIZE; a += 1) {
      const v = x[variableIndex(i, a)];
      if (v !== 0 && v !== 1) return false;
      sum += v;
    }
    if (sum !== 1) return false;
  }
  return true;
}

/** Which positions violate exactly-one-of-six. Used by the teaching views. */
export function oneHotViolations(x: ArrayLike<number>): number[] {
  const bad: number[] = [];
  for (let i = 0; i < LENGTH; i += 1) {
    let sum = 0;
    for (let a = 0; a < ALPHABET_SIZE; a += 1) sum += x[variableIndex(i, a)] ?? 0;
    if (sum !== 1) bad.push(i);
  }
  return bad;
}

/** "HYDROPHOBIC-SMALL_POLAR-..." - the canonical identifier used in results CSVs. */
export function classSequence(codes: Codes): string {
  assertCodes(codes);
  return codes.map((i) => CLASSES[i]).join('-');
}

/** "LSWWLLFL" - representative residues, display only. */
export function representativeSequence(codes: Codes): string {
  assertCodes(codes);
  return codes.map((i) => REPRESENTATIVES[i]).join('');
}

export function parseClassSequence(text: string): number[] {
  const parts = text.trim().split('-');
  const codes = parts.map((p) => CLASSES.indexOf(p.trim().toUpperCase() as ClassName));
  if (codes.length !== LENGTH || codes.some((c) => c < 0)) {
    throw new Error(`cannot parse class sequence: ${text}`);
  }
  return codes;
}

/**
 * Lexicographic index of a sequence in the enumeration used by Python
 * `enumerate_codes` (position 0 is the most significant digit).
 */
export function codesToIndex(codes: Codes): number {
  assertCodes(codes);
  let n = 0;
  for (let i = 0; i < LENGTH; i += 1) n = n * ALPHABET_SIZE + codes[i];
  return n;
}

export function indexToCodes(index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= VALID_SEQUENCES) {
    throw new Error(`sequence index out of range: ${index}`);
  }
  const codes = new Array<number>(LENGTH);
  let v = index;
  for (let i = LENGTH - 1; i >= 0; i -= 1) {
    codes[i] = v % ALPHABET_SIZE;
    v = (v - codes[i]) / ALPHABET_SIZE;
  }
  return codes;
}

/** The 28 unordered position pairs, in the order the Potts model stores them. */
export const PAIR_ORDER: readonly (readonly [number, number])[] = (() => {
  const pairs: [number, number][] = [];
  for (let i = 0; i < LENGTH; i += 1) {
    for (let j = i + 1; j < LENGTH; j += 1) pairs.push([i, j]);
  }
  return pairs;
})();

export const PAIR_COUNT = PAIR_ORDER.length; // 28
