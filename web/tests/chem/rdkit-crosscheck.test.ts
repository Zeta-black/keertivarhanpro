// @vitest-environment node
/**
 * Independent cross-check of this project's chemistry against RDKit.
 *
 * The molecule builder in `src/chem` computes the connection table, molecular
 * formula, mass, ring count and stereochemistry itself. This file hands the
 * SMILES it produces to RDKit - a separate, widely used cheminformatics
 * toolkit - and requires RDKit to agree. If a residue template were wrong,
 * our own arithmetic would be wrong in exactly the same way, so the only
 * useful check is an external one.
 *
 * The RDKit build used is the same WebAssembly artefact the browser loads from
 * `public/rdkit`, so this also verifies the file the site actually ships.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildPeptide } from '../../src/chem/peptide';
import { RESIDUE_TEMPLATES } from '../../src/chem/residues';

interface RDKitMol {
  is_valid(): boolean;
  get_descriptors(): string;
  get_stereo_tags(): string;
  get_svg(width: number, height: number): string;
  get_json(): string;
  delete(): void;
}

interface RDKitModule {
  version(): string;
  get_mol(smiles: string): RDKitMol | null;
}

let RDKit: RDKitModule;
let version = '';

/** Expected CIP descriptor at the alpha carbon of each L-amino acid. */
const EXPECTED_CA_CIP: Readonly<Record<string, string | null>> = {
  G: null, // no stereocentre
  C: '(R)', // L-cysteine is (R): sulfur outranks the carboxyl carbon
  W: '(S)',
  F: '(S)',
  Y: '(S)',
  A: '(S)',
  V: '(S)',
  L: '(S)',
  I: '(S)',
  M: '(S)',
  S: '(S)',
  T: '(S)',
  N: '(S)',
  Q: '(S)',
  D: '(S)',
  E: '(S)',
  K: '(S)',
  R: '(S)',
  H: '(S)',
};

/** Expected CIP descriptor at the beta carbon, for the two residues that have one. */
const EXPECTED_CB_CIP: Readonly<Record<string, string>> = {
  I: '(S)', // L-isoleucine is (2S,3S)
  T: '(R)', // L-threonine is (2S,3R)
};

function descriptors(smiles: string): {
  readonly descriptors: Record<string, number>;
  readonly cip: [number, string][];
  readonly formula: string;
  readonly svg: string;
} {
  const mol = RDKit.get_mol(smiles);
  if (!mol || !mol.is_valid()) throw new Error(`RDKit rejected SMILES: ${smiles}`);
  try {
    const desc = JSON.parse(mol.get_descriptors()) as Record<string, number>;
    const stereo = JSON.parse(mol.get_stereo_tags()) as { CIP_atoms?: [number, string][] };
    const json = JSON.parse(mol.get_json()) as {
      defaults?: { atom?: { z?: number; impHs?: number } };
      molecules: { atoms: { z?: number; impHs?: number; nHs?: number }[] }[];
    };
    // Hill-notation formula counted off RDKit's own atom list. rdkitjson omits
    // any field equal to the document default, and the default element is
    // carbon, so an atom with no `z` is a carbon.
    const defaultZ = json.defaults?.atom?.z ?? 6;
    const defaultH = json.defaults?.atom?.impHs ?? 0;
    const counts = new Map<number, number>();
    let hydrogens = 0;
    for (const atom of json.molecules[0].atoms) {
      const z = atom.z ?? defaultZ;
      counts.set(z, (counts.get(z) ?? 0) + 1);
      hydrogens += atom.impHs ?? atom.nHs ?? defaultH;
    }
    const symbols: Record<number, string> = { 1: 'H', 6: 'C', 7: 'N', 8: 'O', 16: 'S' };
    counts.set(1, (counts.get(1) ?? 0) + hydrogens);
    let formula = '';
    for (const z of [6, 1, 7, 8, 16]) {
      const n = counts.get(z);
      if (!n) continue;
      formula += symbols[z] + (n > 1 ? String(n) : '');
    }
    return {
      descriptors: desc,
      cip: stereo.CIP_atoms ?? [],
      formula,
      svg: mol.get_svg(220, 180),
    };
  } finally {
    mol.delete();
  }
}

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const dir = resolve(import.meta.dirname, '..', '..', 'public', 'rdkit');
  const jsPath = resolve(dir, 'RDKit_minimal.js');
  const wasmPath = resolve(dir, 'RDKit_minimal.wasm');

  // RDKit MinimalLib is an Emscripten UMD bundle. Vitest's module runner does
  // not give it the CommonJS `module` object it looks for, so it is evaluated
  // directly with one supplied. This is the same artefact the browser loads
  // from /rdkit, read straight off disk.
  const container = { exports: {} as Record<string, unknown> };
  const evaluate = new Function(
    'module',
    'exports',
    'require',
    '__filename',
    '__dirname',
    readFileSync(jsPath, 'utf8'),
  );
  evaluate(container, container.exports, require, jsPath, dir);
  const factory = (container.exports.default ?? container.exports) as (
    options: unknown,
  ) => Promise<RDKitModule>;
  if (typeof factory !== 'function') {
    throw new Error('public/rdkit/RDKit_minimal.js did not export a module factory');
  }

  RDKit = await factory({
    locateFile: () => wasmPath,
    wasmBinary: readFileSync(wasmPath),
  });
  version = RDKit.version();
}, 120_000);

describe('RDKit agrees with our chemistry', () => {
  it('loads the WebAssembly build the site ships', () => {
    expect(version).toMatch(/^\d{4}\.\d{2}/);
  });

  it('accepts the SMILES of every residue as a valid molecule', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const smiles = buildPeptide([template.code]).smiles;
      const mol = RDKit.get_mol(smiles);
      expect(mol, `${template.code3} ${smiles}`).not.toBeNull();
      expect(mol?.is_valid(), `${template.code3} ${smiles}`).toBe(true);
      mol?.delete();
    }
  });

  it('computes the same molecular formula as we do, for every residue', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const peptide = buildPeptide([template.code]);
      const result = descriptors(peptide.smiles);
      expect(result.formula, `${template.code3}`).toBe(peptide.formula);
      expect(result.formula, `${template.code3} vs published`).toBe(template.freeFormula);
    }
  });

  it('computes the same average and monoisotopic mass as we do', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const peptide = buildPeptide([template.code]);
      const result = descriptors(peptide.smiles);
      // RDKit's internal table still carries the pre-2009 sulfur weight
      // (32.066) where this project uses the current IUPAC value (32.06), so
      // the two agree to 0.05 rather than exactly for Met and Cys.
      expect(result.descriptors.amw, `${template.code3} amw`).toBeCloseTo(peptide.mass.average, 1);
      expect(result.descriptors.exactmw, `${template.code3} exactmw`).toBeCloseTo(
        peptide.mass.monoisotopic,
        3,
      );
      expect(result.descriptors.amw, `${template.code3} vs published`).toBeCloseTo(
        template.freeMass,
        1,
      );
    }
  });

  it('confirms the alpha carbon of every residue is the L configuration', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const peptide = buildPeptide([template.code]);
      const { cip } = descriptors(peptide.smiles);
      const alpha = cip.find(([index]) => index === 1);
      const expected = EXPECTED_CA_CIP[template.code];
      if (expected === null) {
        expect(alpha, `${template.code3} should have no stereocentre`).toBeUndefined();
      } else {
        expect(alpha, `${template.code3} alpha carbon`).toBeDefined();
        expect(alpha?.[1], `${template.code3} alpha carbon`).toBe(expected);
      }
    }
  });

  it('confirms the second stereocentre of isoleucine and threonine', () => {
    for (const [code, expected] of Object.entries(EXPECTED_CB_CIP)) {
      const peptide = buildPeptide([code]);
      const { cip, descriptors: desc } = descriptors(peptide.smiles);
      expect(desc.NumAtomStereoCenters, `${code} stereocentre count`).toBe(2);
      expect(desc.NumUnspecifiedAtomStereoCenters, `${code} unspecified`).toBe(0);
      const beta = cip.find(([index]) => index !== 1);
      expect(beta?.[1], `${code} beta carbon`).toBe(expected);
    }
  });

  it('finds exactly one unspecified stereocentre in no residue at all', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const peptide = buildPeptide([template.code]);
      const { descriptors: desc } = descriptors(peptide.smiles);
      expect(desc.NumUnspecifiedAtomStereoCenters, template.code3).toBe(0);
    }
  });

  it('agrees on ring counts, including the fused indole system', () => {
    const cases: [string, number, number][] = [
      // sequence, total rings, aromatic rings
      ['F', 1, 1],
      ['Y', 1, 1],
      ['W', 2, 2],
      ['H', 1, 1],
      ['WW', 4, 4],
      ['WFH', 4, 4],
    ];
    for (const [sequence, rings, aromatic] of cases) {
      const peptide = buildPeptide(sequence.split(''));
      const { descriptors: desc } = descriptors(peptide.smiles);
      expect(desc.NumRings, `${sequence} rings`).toBe(rings);
      expect(desc.NumAromaticRings, `${sequence} aromatic rings`).toBe(aromatic);
      expect(peptide.rings, `${sequence} our ring count`).toBe(rings);
    }
  });

  it('agrees on formula, mass and heavy-atom count for whole peptides', () => {
    const sequences = ['GG', 'LSWWLLFL', 'WFLSEK', 'ACDEFGHIKLMNQRSTVWY', 'YYIITTNNRRHH'];
    for (const sequence of sequences) {
      const peptide = buildPeptide(sequence.split(''));
      const result = descriptors(peptide.smiles);
      expect(result.formula, `${sequence} formula`).toBe(peptide.formula);
      expect(result.descriptors.amw, `${sequence} amw`).toBeCloseTo(peptide.mass.average, 1);
      expect(result.descriptors.exactmw, `${sequence} exactmw`).toBeCloseTo(
        peptide.mass.monoisotopic,
        3,
      );
      expect(result.descriptors.NumHeavyAtoms, `${sequence} heavy atoms`).toBe(peptide.heavyAtoms);
      expect(result.descriptors.NumRings, `${sequence} rings`).toBe(peptide.rings);
    }
  });

  it('counts one amide stereocentre-free L centre per chiral residue in a peptide', () => {
    const peptide = buildPeptide('LSWWLLFL'.split(''));
    const { descriptors: desc, cip } = descriptors(peptide.smiles);
    expect(desc.NumAtomStereoCenters).toBe(8);
    expect(desc.NumUnspecifiedAtomStereoCenters).toBe(0);
    expect(cip.every(([, tag]) => tag === '(S)')).toBe(true);
  });

  it('renders a depiction with real drawn bonds for every residue', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const peptide = buildPeptide([template.code]);
      const { svg } = descriptors(peptide.smiles);
      expect(svg, template.code3).toContain('<svg');
      // A depiction is made of path elements; a blank canvas has none.
      const paths = svg.match(/<path/g) ?? [];
      expect(paths.length, `${template.code3} drawn paths`).toBeGreaterThan(4);
    }
  });

  it('renders the eight-residue design with at least one path per bond', () => {
    const peptide = buildPeptide('LSWWLLFL'.split(''));
    const mol = RDKit.get_mol(peptide.smiles);
    const svg = mol?.get_svg(900, 520) ?? '';
    mol?.delete();
    const paths = (svg.match(/<path/g) ?? []).length;
    expect(paths).toBeGreaterThanOrEqual(peptide.bondCount);
  });
});
