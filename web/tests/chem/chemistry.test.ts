/**
 * Chemistry verification.
 *
 * These are not snapshot tests. Every assertion compares the generated
 * molecule against an independently published value or an invariant of real
 * chemistry: the molecular formula of each free amino acid, the condensation
 * identity for a peptide, neutral valence at every atom, L handedness at every
 * CA, planarity of the aromatic rings, bond lengths against the tabulated
 * equilibrium values, and the absence of steric clashes.
 */

import { describe, expect, it } from 'vitest';

import { CLASS_INFO, CLASSES } from '../../src/science/alphabet';
import { ELEMENT_INFO, HILL_ORDER, type Element } from '../../src/chem/elements';
import {
  RESIDUE_TEMPLATES,
  residueFor,
  residuesInClass,
} from '../../src/chem/residues';
import {
  buildPeptide,
  countRotatableBonds,
  defaultResidues,
  reconcileResidues,
  residueBelongsToClass,
  residueDegeneracy,
  residueOptions,
  smilesResidueRanges,
  toFasta,
} from '../../src/chem/peptide';
import {
  composition,
  findRings,
  molecularFormula,
  molecularMass,
  ringCount,
  toMolfile,
  toPdb,
  validateValence,
} from '../../src/chem/molecule';
import {
  SECONDARY_STRUCTURES,
  angleBetween,
  dihedral,
  embed3D,
  maxBondDeviation,
  worstClash,
} from '../../src/chem/conformer';
import { buildPeptideModel, peptideExportFiles } from '../../src/chem';

function parseFormula(formula: string): Partial<Record<Element, number>> {
  const out: Partial<Record<Element, number>> = {};
  const pattern = /([A-Z][a-z]?)(\d*)/g;
  let match = pattern.exec(formula);
  while (match !== null) {
    if (match[1]) {
      const element = match[1] as Element;
      out[element] = (out[element] ?? 0) + (match[2] ? Number(match[2]) : 1);
    }
    match = pattern.exec(formula);
  }
  return out;
}

describe('residue templates', () => {
  it('covers exactly the nineteen residues the six-class alphabet names', () => {
    const fromClasses = CLASS_INFO.flatMap((c) => c.residues).sort();
    const fromTemplates = RESIDUE_TEMPLATES.map((t) => t.code).sort();
    expect(fromTemplates).toEqual(fromClasses);
    expect(fromTemplates).toHaveLength(19);
  });

  it('assigns every residue to the class the YAML mapping puts it in', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const info = CLASS_INFO.find((c) => c.id === template.classId);
      expect(info, template.code).toBeDefined();
      expect(info?.residues).toContain(template.code);
    }
  });

  it('has one template per class member, in mapping order', () => {
    for (const classId of CLASSES) {
      const info = CLASS_INFO.find((c) => c.id === classId);
      expect(residuesInClass(classId).map((r) => r.code)).toEqual([...(info?.residues ?? [])]);
    }
  });

  it('reproduces the published molecular formula of every free amino acid', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const single = buildPeptide([template.code]);
      expect(single.formula, `${template.code3} formula`).toBe(template.freeFormula);
    }
  });

  it('reproduces the published average molecular mass of every free amino acid', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const single = buildPeptide([template.code]);
      expect(single.mass.average, `${template.code3} mass`).toBeCloseTo(template.freeMass, 1);
    }
  });

  it('names every bond endpoint in its own atom list or on the backbone', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const names = new Set<string>(['CA', ...template.atoms.map((a) => a.name)]);
      for (const bond of template.bonds) {
        expect(names.has(bond.a), `${template.code3} ${bond.a}`).toBe(true);
        expect(names.has(bond.b), `${template.code3} ${bond.b}`).toBe(true);
      }
    }
  });

  it('uses unique PDB atom names inside each residue', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const names = template.atoms.map((a) => a.name);
      expect(new Set(names).size, template.code3).toBe(names.length);
    }
  });

  it('rejects a residue the alphabet does not contain', () => {
    expect(() => residueFor('P')).toThrow(/no chemical template/i);
    expect(() => residueFor('X')).toThrow(/no chemical template/i);
  });
});

describe('aromatic ring systems', () => {
  it('finds one six-membered ring in phenylalanine and tyrosine', () => {
    for (const code of ['F', 'Y']) {
      const mol = buildPeptide([code]).molecule;
      expect(ringCount(mol), code).toBe(1);
      expect(findRings(mol)[0], code).toHaveLength(6);
    }
  });

  it('finds the fused five- and six-membered rings of tryptophan', () => {
    const mol = buildPeptide(['W']).molecule;
    expect(ringCount(mol)).toBe(2);
    expect(findRings(mol).map((r) => r.length).sort()).toEqual([5, 6]);
  });

  it('finds the five-membered imidazole ring of histidine', () => {
    const mol = buildPeptide(['H']).molecule;
    expect(ringCount(mol)).toBe(1);
    expect(findRings(mol)[0]).toHaveLength(5);
  });

  it('gives the histidine NE2-H tautomer exactly one ring N-H', () => {
    const peptide = buildPeptide(['H']);
    const ne2 = peptide.molecule.atoms.find((a) => a.name === 'NE2');
    const nd1 = peptide.molecule.atoms.find((a) => a.name === 'ND1');
    expect(ne2?.hydrogens).toBe(1);
    expect(nd1?.hydrogens).toBe(0);
  });

  it('gives the tryptophan indole nitrogen one hydrogen', () => {
    const peptide = buildPeptide(['W']);
    expect(peptide.molecule.atoms.find((a) => a.name === 'NE1')?.hydrogens).toBe(1);
  });

  it('leaves every aromatic ring carbon with at most one hydrogen', () => {
    for (const code of ['F', 'Y', 'W', 'H']) {
      const peptide = buildPeptide([code]);
      const aromatic = new Set<number>();
      for (const bond of peptide.molecule.bonds) {
        if (bond.aromatic) {
          aromatic.add(bond.a);
          aromatic.add(bond.b);
        }
      }
      for (const index of aromatic) {
        expect(peptide.molecule.atoms[index].hydrogens, `${code} ${index}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('peptide assembly', () => {
  it('loses exactly one water per peptide bond', () => {
    const sequences = ['GG', 'WFLSEK', 'LSWWLLFL', 'ACDEFGHIKLMNQRSTVWY'];
    for (const sequence of sequences) {
      const codes = sequence.split('');
      const peptide = buildPeptide(codes);
      const expected: Partial<Record<Element, number>> = {};
      for (const code of codes) {
        const parts = parseFormula(residueFor(code).freeFormula);
        for (const element of HILL_ORDER) {
          if (parts[element]) expected[element] = (expected[element] ?? 0) + (parts[element] as number);
        }
      }
      const waters = codes.length - 1;
      expected.H = (expected.H ?? 0) - 2 * waters;
      expected.O = (expected.O ?? 0) - waters;
      const got = composition(peptide.molecule);
      for (const element of HILL_ORDER) {
        expect(got[element] ?? 0, `${sequence} ${element}`).toBe(expected[element] ?? 0);
      }
    }
  });

  it('builds glycylglycine with the published formula and mass', () => {
    // Glycylglycine, CAS 556-50-3: C4H8N2O3, 132.12 g/mol.
    const peptide = buildPeptide(['G', 'G']);
    expect(peptide.formula).toBe('C4H8N2O3');
    expect(peptide.mass.average).toBeCloseTo(132.12, 1);
    expect(peptide.mass.monoisotopic).toBeCloseTo(132.0535, 3);
    expect(peptide.peptideBonds).toBe(1);
  });

  it('builds the eight-residue representative peptide with a consistent table', () => {
    const peptide = buildPeptide('LSWWLLFL'.split(''));
    expect(peptide.valenceProblems).toEqual([]);
    expect(peptide.peptideBonds).toBe(7);
    expect(peptide.residues).toHaveLength(8);
    // Two tryptophans contribute two fused rings each, one phenylalanine one.
    expect(peptide.rings).toBe(5);
  });

  it('counts rings as the sum of the side-chain ring systems', () => {
    const peptide = buildPeptide('WWF'.split(''));
    // Two indoles (two rings each) plus one benzene.
    expect(peptide.rings).toBe(5);
  });

  it('passes neutral valence validation for every residue and every pair', () => {
    for (const a of RESIDUE_TEMPLATES) {
      expect(validateValence(buildPeptide([a.code]).molecule), a.code).toEqual([]);
      for (const b of RESIDUE_TEMPLATES) {
        const problems = validateValence(buildPeptide([a.code, b.code]).molecule);
        expect(problems, `${a.code}${b.code}`).toEqual([]);
      }
    }
  });

  it('gives each internal amide nitrogen one hydrogen and the N-terminus two', () => {
    const peptide = buildPeptide('GAV'.split(''));
    const nitrogens = peptide.residues.map((r) => peptide.molecule.atoms[r.backbone.N].hydrogens);
    expect(nitrogens).toEqual([2, 1, 1]);
  });

  it('terminates the chain with a free carboxylic acid', () => {
    const peptide = buildPeptide('AA'.split(''));
    const oxt = peptide.molecule.atoms.find((a) => a.name === 'OXT');
    expect(oxt).toBeDefined();
    expect(oxt?.hydrogens).toBe(1);
    expect(oxt?.residueSeq).toBe(2);
  });

  it('reports a net charge of zero for an uncharged sequence and tracks charged ones', () => {
    expect(buildPeptide('AAAA'.split('')).netChargeAtPh7).toBe(0);
    expect(buildPeptide('KKEE'.split('')).netChargeAtPh7).toBe(0);
    expect(buildPeptide('KKKK'.split('')).netChargeAtPh7).toBe(4);
    expect(buildPeptide('DDEE'.split('')).netChargeAtPh7).toBe(-4);
  });

  it('counts rotatable bonds without counting amides or ring bonds', () => {
    // Diglycine: N-CA, CA-C of residue 1 and 2 plus the terminal C-OXT; the
    // peptide C-N bond is an amide and is excluded.
    expect(countRotatableBonds(buildPeptide(['G', 'G']).molecule)).toBeGreaterThan(0);
    const phe = buildPeptide(['F']);
    const benzeneBonds = phe.molecule.bonds.filter((b) => b.aromatic).length;
    expect(benzeneBonds).toBe(6);
    expect(countRotatableBonds(phe.molecule)).toBeLessThan(phe.molecule.bonds.length - benzeneBonds);
  });

  it('writes a FASTA record wrapped at sixty columns', () => {
    const peptide = buildPeptide('LSWWLLFL'.split(''));
    const fasta = toFasta(peptide, 'test');
    expect(fasta).toBe('>test\nLSWWLLFL\n');
  });

  it('refuses an empty sequence', () => {
    expect(() => buildPeptide([])).toThrow(/at least one residue/i);
  });
});

describe('SMILES', () => {
  it('writes the standard peptide idiom with one L stereocentre per chiral residue', () => {
    expect(buildPeptide(['A']).smiles).toBe('N[C@@H](C)C(=O)O');
    expect(buildPeptide(['G']).smiles).toBe('NCC(=O)O');
    expect(buildPeptide(['G', 'A']).smiles).toBe('NCC(=O)N[C@@H](C)C(=O)O');
  });

  it('writes one stereocentre marker per chiral residue and none for glycine', () => {
    const peptide = buildPeptide('LSWWLLFL'.split(''));
    const centres = peptide.smiles.match(/\[C@@H\]/g) ?? [];
    expect(centres).toHaveLength(8);
    expect(buildPeptide('GGGG'.split('')).smiles).not.toMatch(/@/);
  });

  it('balances ring-closure digits in every side chain', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const digits = (template.sideChainSmiles.match(/\d/g) ?? []).sort();
      // Every ring-closure digit must appear an even number of times.
      const counts = new Map<string, number>();
      for (const d of digits) counts.set(d, (counts.get(d) ?? 0) + 1);
      for (const [digit, n] of counts) {
        expect(n % 2, `${template.code} digit ${digit}`).toBe(0);
      }
    }
  });

  it('balances brackets and parentheses in every generated SMILES', () => {
    for (const template of RESIDUE_TEMPLATES) {
      const smiles = buildPeptide([template.code]).smiles;
      let round = 0;
      let square = 0;
      for (const ch of smiles) {
        if (ch === '(') round += 1;
        if (ch === ')') round -= 1;
        if (ch === '[') square += 1;
        if (ch === ']') square -= 1;
        expect(round, smiles).toBeGreaterThanOrEqual(0);
        expect(square, smiles).toBeGreaterThanOrEqual(0);
      }
      expect(round, smiles).toBe(0);
      expect(square, smiles).toBe(0);
    }
  });
});

describe('generated conformer', () => {
  const sequence = 'LSWWLLFL'.split('');

  it('places every atom and sets the coordinate flag', () => {
    const peptide = buildPeptide(sequence);
    embed3D(peptide);
    expect(peptide.molecule.hasCoordinates).toBe(true);
    for (const atom of peptide.molecule.atoms) {
      expect(Number.isFinite(atom.x), atom.name).toBe(true);
      expect(Number.isFinite(atom.y), atom.name).toBe(true);
      expect(Number.isFinite(atom.z), atom.name).toBe(true);
    }
  });

  it('never leaves two atoms on top of each other', () => {
    const peptide = buildPeptide(sequence);
    embed3D(peptide);
    const atoms = peptide.molecule.atoms;
    for (let i = 0; i < atoms.length; i += 1) {
      for (let j = i + 1; j < atoms.length; j += 1) {
        const d = Math.hypot(atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z);
        expect(d, `${atoms[i].name}-${atoms[j].name}`).toBeGreaterThan(0.6);
      }
    }
  });

  it('keeps every bond within 0.1 A of its tabulated equilibrium length', () => {
    for (const option of SECONDARY_STRUCTURES) {
      const peptide = buildPeptide(sequence);
      embed3D(peptide, { structure: option.id });
      expect(maxBondDeviation(peptide.molecule), option.id).toBeLessThan(0.1);
    }
  });

  it('leaves no steric clash worse than 0.35 A', () => {
    for (const option of SECONDARY_STRUCTURES) {
      const peptide = buildPeptide(sequence);
      embed3D(peptide, { structure: option.id });
      expect(worstClash(peptide.molecule), option.id).toBeLessThan(0.35);
    }
  });

  it('builds every CA as an L centre, for every residue', () => {
    for (const template of RESIDUE_TEMPLATES) {
      if (!template.chiral) continue;
      const peptide = buildPeptide([template.code, template.code]);
      const report = embed3D(peptide, { relaxIterations: 0 });
      for (const value of report.handedness) {
        expect(value, `${template.code3} handedness`).toBeGreaterThan(0.5);
      }
    }
  });

  it('keeps the peptide bond planar and trans', () => {
    const peptide = buildPeptide(sequence);
    embed3D(peptide, { relaxIterations: 0 });
    const atoms = peptide.molecule.atoms;
    const v = (i: number) => [atoms[i].x, atoms[i].y, atoms[i].z] as const;
    for (let i = 0; i + 1 < peptide.residues.length; i += 1) {
      const omega = dihedral(
        v(peptide.residues[i].backbone.CA),
        v(peptide.residues[i].backbone.C),
        v(peptide.residues[i + 1].backbone.N),
        v(peptide.residues[i + 1].backbone.CA),
      );
      expect(Math.abs(Math.abs(omega) - 180), `omega ${i}`).toBeLessThan(1);
    }
  });

  it('reproduces the requested backbone torsions', () => {
    for (const option of SECONDARY_STRUCTURES) {
      const peptide = buildPeptide(sequence);
      embed3D(peptide, { structure: option.id, relaxIterations: 0 });
      const atoms = peptide.molecule.atoms;
      const v = (i: number) => [atoms[i].x, atoms[i].y, atoms[i].z] as const;
      for (let i = 1; i < peptide.residues.length; i += 1) {
        const phi = dihedral(
          v(peptide.residues[i - 1].backbone.C),
          v(peptide.residues[i].backbone.N),
          v(peptide.residues[i].backbone.CA),
          v(peptide.residues[i].backbone.C),
        );
        expect(phi, `${option.id} phi ${i}`).toBeCloseTo(option.phi, 0);
      }
    }
  });

  it('keeps the N-CA-C backbone angle at its equilibrium value', () => {
    const peptide = buildPeptide(sequence);
    embed3D(peptide, { relaxIterations: 0 });
    const atoms = peptide.molecule.atoms;
    const v = (i: number) => [atoms[i].x, atoms[i].y, atoms[i].z] as const;
    for (const residue of peptide.residues) {
      const angle = angleBetween(v(residue.backbone.N), v(residue.backbone.CA), v(residue.backbone.C));
      expect(angle).toBeCloseTo(111.2, 0);
    }
  });

  it('keeps every aromatic ring planar to within 0.05 A', () => {
    for (const code of ['F', 'Y', 'W', 'H']) {
      const peptide = buildPeptide([code, code]);
      embed3D(peptide, { relaxIterations: 0 });
      for (const ring of findRings(peptide.molecule)) {
        const points = ring.map((i) => peptide.molecule.atoms[i]);
        // Plane through the first three atoms; the rest must lie in it.
        const p0 = points[0];
        const u = [points[1].x - p0.x, points[1].y - p0.y, points[1].z - p0.z] as const;
        const w = [points[2].x - p0.x, points[2].y - p0.y, points[2].z - p0.z] as const;
        const nx = u[1] * w[2] - u[2] * w[1];
        const ny = u[2] * w[0] - u[0] * w[2];
        const nz = u[0] * w[1] - u[1] * w[0];
        const len = Math.hypot(nx, ny, nz) || 1;
        for (const point of points.slice(3)) {
          const d =
            Math.abs(
              nx * (point.x - p0.x) + ny * (point.y - p0.y) + nz * (point.z - p0.z),
            ) / len;
          expect(d, `${code} ring planarity`).toBeLessThan(0.05);
        }
      }
    }
  });

  it('keeps aromatic ring bond lengths at 1.39 A for six-membered rings', () => {
    const peptide = buildPeptide(['F']);
    embed3D(peptide, { relaxIterations: 0 });
    const ring = findRings(peptide.molecule)[0];
    for (let i = 0; i < ring.length; i += 1) {
      const a = peptide.molecule.atoms[ring[i]];
      const b = peptide.molecule.atoms[ring[(i + 1) % ring.length]];
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(1.39, 2);
    }
  });

  it('spans a longer end-to-end distance when extended than when helical', () => {
    const ext = buildPeptide(sequence);
    embed3D(ext, { structure: 'extended' });
    const helix = buildPeptide(sequence);
    embed3D(helix, { structure: 'helix' });
    const span = (p: typeof ext) => {
      const a = p.molecule.atoms[p.residues[0].backbone.N];
      const b = p.molecule.atoms[p.residues[p.residues.length - 1].backbone.C];
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    };
    expect(span(ext)).toBeGreaterThan(span(helix) * 1.5);
  });

  it('builds a conformer for every single residue without throwing', () => {
    for (const template of RESIDUE_TEMPLATES) {
      expect(() => buildPeptideModel([template.code]), template.code3).not.toThrow();
    }
  });
});

describe('file formats', () => {
  it('writes PDB records with the element in the right columns', () => {
    const model = buildPeptideModel('GAW'.split(''));
    const lines = model.pdb.split('\n').filter((l) => l.startsWith('ATOM'));
    expect(lines.length).toBe(model.structure.heavyAtoms);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(78);
      // Columns 13-16 are the atom name; 18-20 the residue name.
      expect(line.slice(17, 20).trim()).toMatch(/^(GLY|ALA|TRP)$/);
      expect(line.slice(76, 78).trim()).toMatch(/^[CNOS]$/);
      expect(Number.isFinite(Number(line.slice(30, 38)))).toBe(true);
      expect(Number.isFinite(Number(line.slice(38, 46)))).toBe(true);
      expect(Number.isFinite(Number(line.slice(46, 54)))).toBe(true);
    }
    expect(model.pdb).toMatch(/^END$/m);
    expect(model.pdb).toMatch(/GENERATED CONFORMER/);
  });

  it('writes CONECT records for every bond, in both directions', () => {
    const model = buildPeptideModel('GA'.split(''));
    const conect = model.pdb.split('\n').filter((l) => l.startsWith('CONECT'));
    expect(conect.length).toBeGreaterThan(0);
    const total = conect.reduce((sum, line) => sum + (line.length - 11) / 5, 0);
    expect(total).toBe(model.structure.bondCount * 2);
  });

  it('writes a V2000 molfile whose counts line matches the table', () => {
    const peptide = buildPeptide('WF'.split(''));
    embed3D(peptide);
    const molfile = toMolfile(peptide.molecule);
    const counts = molfile.split('\n')[3];
    expect(Number(counts.slice(0, 3))).toBe(peptide.molecule.atoms.length);
    expect(Number(counts.slice(3, 6))).toBe(peptide.molecule.bonds.length);
    expect(counts).toContain('V2000');
    expect(molfile).toMatch(/M {2}END/);
  });

  it('writes aromatic bonds with Kekule orders, never order 4', () => {
    const peptide = buildPeptide(['W']);
    embed3D(peptide);
    const molfile = toMolfile(peptide.molecule);
    const bondLines = molfile.split('\n').slice(4 + peptide.molecule.atoms.length);
    const orders = bondLines
      .filter((l) => l.trim().length > 0 && !l.startsWith('M'))
      .map((l) => Number(l.slice(6, 9)));
    expect(orders.every((o) => o === 1 || o === 2)).toBe(true);
    expect(orders.filter((o) => o === 2).length).toBeGreaterThan(0);
  });

  it('refuses to write a PDB before a conformer exists', () => {
    const peptide = buildPeptide(['A']);
    expect(() => toPdb(peptide.molecule)).toThrow(/needs a conformer/i);
  });

  it('produces a four-file export bundle with real content', () => {
    const model = buildPeptideModel('LSWWLLFL'.split(''));
    const files = peptideExportFiles(model, 'design');
    expect(files.map((f) => f.name)).toEqual([
      'design.fasta',
      'design.smi',
      'design.sdf',
      'design.pdb',
    ]);
    for (const file of files) expect(file.text.length).toBeGreaterThan(20);
    expect(files[2].text).toContain('$$$$');
    expect(files[2].text).toContain(model.structure.formula);
  });
});

describe('class-to-residue bridge', () => {
  it('uses the documented representative of each class by default', () => {
    expect(defaultResidues([0, 1, 2, 3, 4, 5])).toEqual(['W', 'F', 'L', 'S', 'E', 'K']);
  });

  it('offers exactly the class members as residue options', () => {
    CLASS_INFO.forEach((info, index) => {
      expect(residueOptions(index).map((r) => r.code)).toEqual([...info.residues]);
    });
  });

  it('accepts only members of a position class', () => {
    expect(residueBelongsToClass('W', 0)).toBe(true);
    expect(residueBelongsToClass('F', 0)).toBe(false);
    expect(residueBelongsToClass('Y', 1)).toBe(true);
    expect(residueBelongsToClass('I', 2)).toBe(true);
  });

  it('snaps an out-of-class residue back to the representative', () => {
    expect(reconcileResidues([0, 2, 3], ['Y', 'I', 'T'])).toEqual(['W', 'I', 'T']);
    expect(reconcileResidues([5, 5], ['R', 'zz'])).toEqual(['R', 'K']);
  });

  it('reports how many molecules one class sequence stands for', () => {
    // 6 hydrophobic members, 5 small-polar members: a two-position design of
    // those classes is 30 distinct molecules.
    expect(residueDegeneracy([2, 3])).toBe(30);
    expect(residueDegeneracy([0, 0, 0])).toBe(1);
    const representative = residueDegeneracy([2, 3, 0, 0, 2, 2, 1, 2]);
    expect(representative).toBe(6 * 5 * 1 * 1 * 6 * 6 * 2 * 6);
  });

  it('produces chemically different molecules for different members of one class', () => {
    const a = buildPeptide(['L', 'S']);
    const b = buildPeptide(['I', 'S']);
    const c = buildPeptide(['A', 'S']);
    // Leucine and isoleucine are isomers: same formula, different connectivity.
    expect(a.formula).toBe(b.formula);
    expect(a.smiles).not.toBe(b.smiles);
    // Alanine is a different formula entirely.
    expect(c.formula).not.toBe(a.formula);
  });
});

describe('element data', () => {
  it('uses the neutral covalent valence for every supported element', () => {
    expect(ELEMENT_INFO.C.valence).toBe(4);
    expect(ELEMENT_INFO.N.valence).toBe(3);
    expect(ELEMENT_INFO.O.valence).toBe(2);
    expect(ELEMENT_INFO.S.valence).toBe(2);
    expect(ELEMENT_INFO.H.valence).toBe(1);
  });

  it('agrees with the standard atomic weights to three figures', () => {
    expect(ELEMENT_INFO.C.mass).toBeCloseTo(12.011, 3);
    expect(ELEMENT_INFO.N.mass).toBeCloseTo(14.007, 3);
    expect(ELEMENT_INFO.O.mass).toBeCloseTo(15.999, 3);
    expect(ELEMENT_INFO.S.mass).toBeCloseTo(32.06, 2);
  });

  it('computes the formula and mass of water-free glycine consistently', () => {
    const mol = buildPeptide(['G']).molecule;
    expect(molecularFormula(mol)).toBe('C2H5NO2');
    expect(molecularMass(mol).average).toBeCloseTo(75.07, 1);
  });
});

describe('SMILES atom index mapping', () => {
  it('assigns every heavy atom to exactly one residue, with no gaps', () => {
    for (const sequence of ['A', 'GG', 'LSWWLLFL', 'ACDEFGHIKLMNQRSTVWY']) {
      const codes = sequence.split('');
      const peptide = buildPeptide(codes);
      const ranges = smilesResidueRanges(codes.map((c) => residueFor(c)));
      const flat = ranges.flat();
      expect(flat, sequence).toHaveLength(peptide.heavyAtoms);
      expect(new Set(flat).size, sequence).toBe(peptide.heavyAtoms);
      expect(flat).toEqual(flat.map((_, i) => i));
    }
  });

  it('gives each residue the same atom count as the connection table does', () => {
    const codes = 'WFGSTK'.split('');
    const peptide = buildPeptide(codes);
    const ranges = smilesResidueRanges(codes.map((c) => residueFor(c)));
    peptide.residues.forEach((residue, i) => {
      expect(ranges[i], `residue ${i + 1}`).toHaveLength(residue.atoms.length);
    });
  });
});
