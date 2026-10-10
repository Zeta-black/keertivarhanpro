/**
 * Three-dimensional conformer generation.
 *
 * WHAT THIS IS. The backbone is built by the Natural Extension Reference Frame
 * construction (the standard internal-coordinate chain build used by
 * PeptideBuilder and by every protein-geometry package) from tabulated
 * equilibrium bond lengths and angles and a chosen set of phi/psi/omega
 * torsions. Side chains are extended from CB with hybridisation-derived bond
 * angles and staggered torsions; planar aromatic ring systems are placed from
 * exact in-plane ring templates rather than being approximated. A short
 * steric-relief minimisation then removes residual clashes while bond lengths
 * and angles are restrained to their ideal values.
 *
 * WHAT THIS IS NOT. It is not an experimental structure, not a
 * molecular-dynamics trajectory, not a docking pose, and not a prediction of
 * the conformation this peptide adopts in solution or on a surface. It is an
 * idealised generated conformer: correct chemistry (connectivity, valence,
 * chirality, bond geometry) in one plausible arrangement. Every surface that
 * displays it says so.
 */

import { ELEMENT_INFO, bondLength, type BondFlavour } from './elements';
import { adjacency, findRings, type Bond, type Molecule } from './molecule';
import type { PeptideStructure } from './peptide';

export type Vec3 = readonly [number, number, number];

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Vector helpers
 * ------------------------------------------------------------------ */

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n < 1e-12 ? [0, 0, 0] : scale(a, 1 / n);
}

/**
 * Natural Extension Reference Frame: the position of D, given A-B-C and the
 * internal coordinates of D relative to them.
 *
 * `angle` is B-C-D and `torsion` is the dihedral A-B-C-D, both in degrees.
 */
export function nerf(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  bond: number,
  angle: number,
  torsion: number,
): Vec3 {
  const theta = angle * DEG;
  // Negated so that `torsion` is the IUPAC-signed dihedral A-B-C-D, matching
  // `dihedral()` below. Verified both ways in tests/chem/chemistry.test.ts.
  const phi = -torsion * DEG;
  const bc = unit(sub(c, b));
  let n = cross(sub(b, a), bc);
  if (norm(n) < 1e-9) {
    // A, B and C are collinear: any perpendicular gives a well-defined frame.
    n = cross(bc, Math.abs(bc[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  }
  n = unit(n);
  const m = cross(n, bc);
  const d: Vec3 = [
    -bond * Math.cos(theta),
    bond * Math.sin(theta) * Math.cos(phi),
    bond * Math.sin(theta) * Math.sin(phi),
  ];
  return [
    c[0] + bc[0] * d[0] + m[0] * d[1] + n[0] * d[2],
    c[1] + bc[1] * d[0] + m[1] * d[1] + n[1] * d[2],
    c[2] + bc[2] * d[0] + m[2] * d[1] + n[2] * d[2],
  ];
}

/** Signed dihedral A-B-C-D in degrees, in the IUPAC convention. */
export function dihedral(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const m = cross(n1, unit(b2));
  return Math.atan2(dot(m, n2), dot(n1, n2)) / DEG;
}

/** Bond angle A-B-C in degrees. */
export function angleBetween(a: Vec3, b: Vec3, c: Vec3): number {
  const u = unit(sub(a, b));
  const v = unit(sub(c, b));
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) / DEG;
}

/**
 * Handedness at CA. For every L-amino acid
 * `(N - CA) x (C - CA) . (CB - CA)` is positive; the mirror-image D form is
 * negative. Used as a chirality assertion rather than a comment.
 */
export function caHandedness(n: Vec3, ca: Vec3, c: Vec3, cb: Vec3): number {
  return dot(cross(sub(n, ca), sub(c, ca)), sub(cb, ca));
}

/* ------------------------------------------------------------------ *
 * Standard protein geometry
 * ------------------------------------------------------------------ */

/** Equilibrium backbone geometry (Engh & Huber style averages). */
export const BACKBONE = {
  N_CA: 1.458,
  CA_C: 1.525,
  C_N: 1.329,
  C_O: 1.231,
  CA_CB: 1.53,
  C_OXT: 1.25,
  ANGLE_N_CA_C: 111.2,
  ANGLE_CA_C_N: 116.2,
  ANGLE_C_N_CA: 121.7,
  ANGLE_CA_C_O: 120.8,
  ANGLE_N_CA_CB: 110.5,
  /** Dihedral N-C-CA-CB. The sign is what makes the centre L rather than D. */
  DIHEDRAL_N_C_CA_CB: -122.6,
} as const;

export interface SecondaryStructure {
  readonly id: 'extended' | 'helix' | 'polyproline';
  readonly label: string;
  readonly phi: number;
  readonly psi: number;
  readonly omega: number;
  readonly description: string;
}

/**
 * The three backbone torsion sets offered. All three are textbook
 * secondary-structure values, not fitted or predicted ones.
 */
export const SECONDARY_STRUCTURES: readonly SecondaryStructure[] = [
  {
    id: 'extended',
    label: 'Extended (beta-strand)',
    phi: -139,
    psi: 135,
    omega: 180,
    description:
      'Antiparallel beta-strand torsions. The chain runs nearly straight, so every residue and side chain is visible at once.',
  },
  {
    id: 'helix',
    label: 'Alpha-helix',
    phi: -57,
    psi: -47,
    omega: 180,
    description:
      'Right-handed alpha-helix torsions, 3.6 residues per turn. Compact, with side chains projecting radially.',
  },
  {
    id: 'polyproline',
    label: 'Polyproline II',
    phi: -75,
    psi: 145,
    omega: 180,
    description:
      'A left-handed extended helix common in short unstructured peptides in water.',
  },
];

/** Staggered side-chain torsions, applied in order of depth from CB. */
const SIDE_CHAIN_TORSIONS = [-65, 180, 180, 180, 180];

/** Ring bond length by ring size; aromatic carbon-carbon is 1.39 A. */
function ringBondLength(size: number): number {
  return size === 5 ? 1.375 : 1.39;
}

/* ------------------------------------------------------------------ *
 * Hybridisation, used for bond angles
 * ------------------------------------------------------------------ */

type Hybridisation = 'sp' | 'sp2' | 'sp3';

function hybridisationOf(mol: Molecule, index: number): Hybridisation {
  let maxOrder = 1;
  let aromatic = false;
  for (const bond of mol.bonds) {
    if (bond.a !== index && bond.b !== index) continue;
    if (bond.aromatic) aromatic = true;
    if (bond.order > maxOrder) maxOrder = bond.order;
  }
  if (aromatic || maxOrder === 2) return 'sp2';
  if (maxOrder === 3) return 'sp';
  // A nitrogen bonded to a carbonyl carbon is a planar amide nitrogen.
  if (mol.atoms[index].element === 'N') {
    for (const bond of mol.bonds) {
      const other = bond.a === index ? bond.b : bond.b === index ? bond.a : null;
      if (other === null) continue;
      if (mol.atoms[other].element !== 'C') continue;
      for (const second of mol.bonds) {
        if (second.order !== 2) continue;
        const far = second.a === other ? second.b : second.b === other ? second.a : null;
        if (far !== null && mol.atoms[far].element === 'O') return 'sp2';
      }
    }
  }
  return 'sp3';
}

function idealAngle(h: Hybridisation): number {
  if (h === 'sp') return 180;
  if (h === 'sp2') return 120;
  return 109.5;
}

function bondFlavour(mol: Molecule, bond: Bond): BondFlavour {
  if (bond.aromatic) return 'ar';
  if (bond.order === 2) return '2';
  const a = mol.atoms[bond.a];
  const b = mol.atoms[bond.b];
  const pair = [a.element, b.element].sort().join('');
  if (pair === 'CN' && hybridisationOf(mol, a.element === 'N' ? bond.a : bond.b) === 'sp2') {
    return 'amide';
  }
  if (pair === 'CO') {
    const carbon = a.element === 'C' ? bond.a : bond.b;
    // A single C-O bond on a carbon that also carries a C=O is a carboxyl O-H.
    for (const other of mol.bonds) {
      if (other.order !== 2) continue;
      const far = other.a === carbon ? other.b : other.b === carbon ? other.a : null;
      if (far !== null && mol.atoms[far].element === 'O') return 'carboxyl';
    }
  }
  return '1';
}

/* ------------------------------------------------------------------ *
 * Planar ring-system templates
 * ------------------------------------------------------------------ */

interface RingSystem {
  /** All atom indices in the fused system. */
  readonly atoms: number[];
  /** Each ring in connectivity order. */
  readonly rings: number[][];
}

function ringSystems(mol: Molecule): RingSystem[] {
  const rings = findRings(mol);
  const systems: RingSystem[] = [];
  for (const ring of rings) {
    const touching = systems.filter((s) => ring.some((a) => s.atoms.includes(a)));
    if (touching.length === 0) {
      systems.push({ atoms: [...ring], rings: [ring] });
      continue;
    }
    // Merge every system this ring touches into the first of them.
    const target = touching[0];
    for (const atom of ring) if (!target.atoms.includes(atom)) target.atoms.push(atom);
    target.rings.push(ring);
    for (const other of touching.slice(1)) {
      for (const atom of other.atoms) if (!target.atoms.includes(atom)) target.atoms.push(atom);
      target.rings.push(...other.rings);
      systems.splice(systems.indexOf(other), 1);
    }
  }
  return systems;
}

/**
 * In-plane coordinates for one fused ring system, as exact regular polygons
 * sharing their fused bonds. Returns a map from atom index to a 2D point.
 */
function ringTemplate(system: RingSystem): Map<number, readonly [number, number]> {
  const placed = new Map<number, readonly [number, number]>();
  const pending = [...system.rings].sort((a, b) => a.length - b.length);

  // First ring: a regular polygon centred on the origin.
  const first = pending.shift();
  if (!first) return placed;
  const l0 = ringBondLength(first.length);
  const r0 = l0 / (2 * Math.sin(Math.PI / first.length));
  first.forEach((atom, i) => {
    const t = (2 * Math.PI * i) / first.length;
    placed.set(atom, [r0 * Math.cos(t), r0 * Math.sin(t)]);
  });

  // Remaining rings share a bond with something already placed.
  let guard = pending.length * pending.length + 4;
  while (pending.length > 0 && guard > 0) {
    guard -= 1;
    const index = pending.findIndex((ring) => ring.filter((a) => placed.has(a)).length >= 2);
    if (index < 0) break;
    const ring = pending.splice(index, 1)[0];
    const k = ring.length;
    const l = ringBondLength(k);
    const r = l / (2 * Math.sin(Math.PI / k));
    // Find an adjacent pair in ring order that is already placed.
    let seam = -1;
    for (let i = 0; i < k; i += 1) {
      if (placed.has(ring[i]) && placed.has(ring[(i + 1) % k])) {
        seam = i;
        break;
      }
    }
    if (seam < 0) continue;
    const pA = placed.get(ring[seam]) as readonly [number, number];
    const pB = placed.get(ring[(seam + 1) % k]) as readonly [number, number];
    const mid: [number, number] = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
    const edge: [number, number] = [pB[0] - pA[0], pB[1] - pA[1]];
    const edgeLen = Math.hypot(edge[0], edge[1]) || l;
    const perp: [number, number] = [-edge[1] / edgeLen, edge[0] / edgeLen];
    const half = edgeLen / 2;
    const h = Math.sqrt(Math.max(0, r * r - half * half));
    // Choose the side of the seam that points away from the already-placed atoms.
    const others = [...placed.entries()].filter(([atom]) => !ring.includes(atom));
    let centroid: readonly [number, number] = mid;
    if (others.length > 0) {
      let sx = 0;
      let sy = 0;
      for (const [, p] of others) {
        sx += p[0];
        sy += p[1];
      }
      centroid = [sx / others.length, sy / others.length];
    }
    const candidate1: [number, number] = [mid[0] + perp[0] * h, mid[1] + perp[1] * h];
    const candidate2: [number, number] = [mid[0] - perp[0] * h, mid[1] - perp[1] * h];
    const d1 = Math.hypot(candidate1[0] - centroid[0], candidate1[1] - centroid[1]);
    const d2 = Math.hypot(candidate2[0] - centroid[0], candidate2[1] - centroid[1]);
    const centre2d = d1 >= d2 ? candidate1 : candidate2;

    const angleOf = (p: readonly [number, number]) =>
      Math.atan2(p[1] - centre2d[1], p[0] - centre2d[0]);
    const thetaA = angleOf(pA);
    let step = angleOf(pB) - thetaA;
    while (step > Math.PI) step -= 2 * Math.PI;
    while (step < -Math.PI) step += 2 * Math.PI;
    step = Math.sign(step) * ((2 * Math.PI) / k);
    for (let j = 0; j < k; j += 1) {
      const atom = ring[(seam + j) % k];
      if (placed.has(atom)) continue;
      const t = thetaA + step * j;
      placed.set(atom, [centre2d[0] + r * Math.cos(t), centre2d[1] + r * Math.sin(t)]);
    }
  }
  return placed;
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

export interface EmbedOptions {
  readonly structure?: SecondaryStructure['id'];
  /** Chi2-equivalent rotation of aromatic ring planes, degrees. */
  readonly ringTwist?: number;
  /** Steric-relief iterations. Zero skips minimisation entirely. */
  readonly relaxIterations?: number;
}

export interface EmbedReport {
  readonly structure: SecondaryStructure;
  readonly relaxIterations: number;
  /** Worst remaining non-bonded overlap, angstrom. 0 means no clash. */
  readonly worstClash: number;
  /** Largest deviation of any bond from its ideal length, angstrom. */
  readonly maxBondDeviation: number;
  /** Signed handedness at every CA; all positive means every centre is L. */
  readonly handedness: readonly number[];
}

/**
 * Writes 3D coordinates into `structure.molecule` and returns a report the UI
 * can show. The molecule is mutated in place and `hasCoordinates` is set.
 */
export function embed3D(structure: PeptideStructure, options: EmbedOptions = {}): EmbedReport {
  const mol = structure.molecule;
  const chosen =
    SECONDARY_STRUCTURES.find((s) => s.id === (options.structure ?? 'extended')) ??
    SECONDARY_STRUCTURES[0];
  const ringTwist = options.ringTwist ?? 90;
  const positions = new Map<number, Vec3>();

  /* ---- backbone ---- */
  const first = structure.residues[0];
  positions.set(first.backbone.N, [0, 0, 0]);
  positions.set(first.backbone.CA, [BACKBONE.N_CA, 0, 0]);
  {
    const theta = BACKBONE.ANGLE_N_CA_C * DEG;
    const ca = positions.get(first.backbone.CA) as Vec3;
    positions.set(first.backbone.C, [
      ca[0] - BACKBONE.CA_C * Math.cos(theta),
      ca[1] + BACKBONE.CA_C * Math.sin(theta),
      0,
    ]);
  }

  structure.residues.forEach((residue, i) => {
    const n = positions.get(residue.backbone.N) as Vec3;
    const ca = positions.get(residue.backbone.CA) as Vec3;
    const c = positions.get(residue.backbone.C) as Vec3;

    // Carbonyl oxygen: anti to the psi direction, which keeps the amide planar.
    positions.set(
      residue.backbone.O,
      nerf(n, ca, c, BACKBONE.C_O, BACKBONE.ANGLE_CA_C_O, chosen.psi + 180),
    );

    const next = structure.residues[i + 1];
    if (next) {
      const nextN = nerf(n, ca, c, BACKBONE.C_N, BACKBONE.ANGLE_CA_C_N, chosen.psi);
      positions.set(next.backbone.N, nextN);
      const nextCA = nerf(ca, c, nextN, BACKBONE.N_CA, BACKBONE.ANGLE_C_N_CA, chosen.omega);
      positions.set(next.backbone.CA, nextCA);
      positions.set(
        next.backbone.C,
        nerf(c, nextN, nextCA, BACKBONE.CA_C, BACKBONE.ANGLE_N_CA_C, chosen.phi),
      );
    } else {
      // C-terminal hydroxyl, in the carboxyl plane and anti to the carbonyl O.
      const oxt = residue.atoms.find((index) => mol.atoms[index].name === 'OXT');
      if (oxt !== undefined) {
        positions.set(
          oxt,
          nerf(n, ca, c, BACKBONE.C_OXT, BACKBONE.ANGLE_CA_C_O, chosen.psi),
        );
      }
    }
  });

  /* ---- side chains ---- */
  const adj = adjacency(mol);
  const systems = ringSystems(mol);
  const systemOf = new Map<number, RingSystem>();
  for (const system of systems) for (const atom of system.atoms) systemOf.set(atom, system);

  for (const residue of structure.residues) {
    if (residue.sideChain.length === 0) continue;
    const n = positions.get(residue.backbone.N) as Vec3;
    const ca = positions.get(residue.backbone.CA) as Vec3;
    const c = positions.get(residue.backbone.C) as Vec3;

    const cb = residue.sideChain.find((index) => mol.atoms[index].name === 'CB');
    if (cb === undefined) continue;
    positions.set(
      cb,
      nerf(n, c, ca, BACKBONE.CA_CB, BACKBONE.ANGLE_N_CA_CB, BACKBONE.DIHEDRAL_N_C_CA_CB),
    );

    // Breadth-first walk outward from CB. Each atom is placed from its parent,
    // grandparent and great-grandparent, except ring systems, which are placed
    // as whole rigid planar fragments when their attachment atom comes up.
    const parent = new Map<number, number>([[cb, residue.backbone.CA]]);
    const grandparent = new Map<number, number>([[cb, residue.backbone.N]]);
    const queue: number[] = [cb];
    const siblingTorsion = new Map<number, number>();

    while (queue.length > 0) {
      const current = queue.shift() as number;
      const system = systemOf.get(current);
      if (system && !positions.has(system.atoms[0])) {
        placeRingSystem(mol, system, current, positions, parent, ringTwist);
      }
      const depth = depthFrom(cb, current, parent);
      const parentOf = parent.get(current) as number;
      const grandOf = grandparent.get(current) ?? parentOf;
      let childIndex = 0;
      for (const child of adj[current]) {
        if (child === parentOf) continue;
        if (positions.has(child)) {
          // Already placed (a ring neighbour); still record its lineage so its
          // own substituents can be placed from it.
          if (!parent.has(child)) {
            parent.set(child, current);
            grandparent.set(child, parentOf);
            queue.push(child);
          }
          continue;
        }
        const h = hybridisationOf(mol, current);
        const angle = idealAngle(h);
        const base = SIDE_CHAIN_TORSIONS[Math.min(depth, SIDE_CHAIN_TORSIONS.length - 1)];
        const previous = siblingTorsion.get(current);
        const offset = h === 'sp2' ? 180 : 120;
        const torsion =
          previous === undefined ? (h === 'sp2' ? 180 : base) : previous + offset * (childIndex % 2 === 1 ? 1 : -1);
        siblingTorsion.set(current, torsion);
        const bond = mol.bonds.find(
          (b) => (b.a === current && b.b === child) || (b.b === current && b.a === child),
        ) as Bond;
        const length = bondLength(
          mol.atoms[current].element,
          mol.atoms[child].element,
          bondFlavour(mol, bond),
        );
        positions.set(
          child,
          nerf(
            positions.get(grandOf) as Vec3,
            positions.get(parentOf) as Vec3,
            positions.get(current) as Vec3,
            length,
            angle,
            torsion,
          ),
        );
        parent.set(child, current);
        grandparent.set(child, parentOf);
        queue.push(child);
        childIndex += 1;
      }
    }
  }

  // Anything still unplaced would be a template bug; fail loudly rather than
  // writing a molecule with atoms stacked at the origin.
  const missing = mol.atoms.filter((atom) => !positions.has(atom.index));
  if (missing.length > 0) {
    throw new Error(
      `conformer generation missed ${missing.length} atom(s): ${missing
        .slice(0, 6)
        .map((a) => `${a.residueName}${a.residueSeq}:${a.name}`)
        .join(', ')}`,
    );
  }

  for (const atom of mol.atoms) {
    const p = positions.get(atom.index) as Vec3;
    atom.x = p[0];
    atom.y = p[1];
    atom.z = p[2];
  }
  mol.hasCoordinates = true;

  const iterations = options.relaxIterations ?? 220;
  if (iterations > 0) relax(mol, iterations);

  return {
    structure: chosen,
    relaxIterations: iterations,
    worstClash: worstClash(mol),
    maxBondDeviation: maxBondDeviation(mol),
    handedness: structure.residues.map((residue) => {
      const cb = residue.sideChain.find((index) => mol.atoms[index].name === 'CB');
      if (cb === undefined) return 0;
      return caHandedness(
        vecOf(mol, residue.backbone.N),
        vecOf(mol, residue.backbone.CA),
        vecOf(mol, residue.backbone.C),
        vecOf(mol, cb),
      );
    }),
  };
}

function vecOf(mol: Molecule, index: number): Vec3 {
  const atom = mol.atoms[index];
  return [atom.x, atom.y, atom.z];
}

function depthFrom(root: number, atom: number, parent: Map<number, number>): number {
  let depth = 0;
  let cursor = atom;
  while (cursor !== root && depth < 64) {
    const next = parent.get(cursor);
    if (next === undefined) break;
    cursor = next;
    depth += 1;
  }
  return depth;
}

/**
 * Places a whole fused aromatic system as a rigid planar fragment.
 *
 * `anchor` is the ring atom bonded to the rest of the side chain; its position
 * is already known. The ring plane contains the anchor's exocyclic bond axis,
 * and `twist` rotates the plane about that axis, which is the chi2 degree of
 * freedom.
 */
function placeRingSystem(
  mol: Molecule,
  system: RingSystem,
  anchor: number,
  positions: Map<number, Vec3>,
  parent: Map<number, number>,
  twist: number,
): void {
  const template = ringTemplate(system);
  const anchor2d = template.get(anchor);
  if (!anchor2d) return;

  const ringNeighbours = mol.bonds
    .filter((b) => b.a === anchor || b.b === anchor)
    .map((b) => (b.a === anchor ? b.b : b.a))
    .filter((index) => system.atoms.includes(index));
  if (ringNeighbours.length < 2) return;

  // In-plane direction from the anchor into the ring, in template space.
  const toward = ringNeighbours
    .map((index) => template.get(index))
    .filter((p): p is readonly [number, number] => p !== undefined)
    .reduce(
      (acc, p) => {
        const dx = p[0] - anchor2d[0];
        const dy = p[1] - anchor2d[1];
        const len = Math.hypot(dx, dy) || 1;
        return [acc[0] + dx / len, acc[1] + dy / len] as [number, number];
      },
      [0, 0] as [number, number],
    );
  const towardLen = Math.hypot(toward[0], toward[1]) || 1;
  const fx = toward[0] / towardLen;
  const fy = toward[1] / towardLen;

  const anchorPos = positions.get(anchor) as Vec3;
  const parentPos = positions.get(parent.get(anchor) as number) as Vec3;
  const grandPos = positions.get(parent.get(parent.get(anchor) as number) as number) ?? parentPos;

  // u: the exocyclic bond axis, which the ring plane must contain.
  const u = unit(sub(anchorPos, parentPos));
  // r: the twist = 0 reference, the grandparent direction made perpendicular to u.
  const raw = sub(grandPos, parentPos);
  let r = sub(raw, scale(u, dot(raw, u)));
  if (norm(r) < 1e-6) r = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  r = unit(r);
  const s = unit(cross(u, r));
  const t = twist * DEG;
  const p: Vec3 = add(scale(r, Math.cos(t)), scale(s, Math.sin(t)));

  for (const [atom, point] of template) {
    if (atom === anchor) continue;
    const dx = point[0] - anchor2d[0];
    const dy = point[1] - anchor2d[1];
    // Rotate the template so its in-plane forward direction lies along u.
    const along = dx * fx + dy * fy;
    const across = -dx * fy + dy * fx;
    positions.set(atom, add(anchorPos, add(scale(u, along), scale(p, across))));
  }

  // In-plane substituents on the ring (the tyrosine hydroxyl, for example).
  for (const ringAtom of system.atoms) {
    const ringPos = positions.get(ringAtom);
    if (!ringPos) continue;
    const ringNbrs = mol.bonds
      .filter((b) => b.a === ringAtom || b.b === ringAtom)
      .map((b) => (b.a === ringAtom ? b.b : b.a));
    const inRing = ringNbrs.filter((index) => system.atoms.includes(index));
    if (inRing.length < 2) continue;
    const outward = unit(
      scale(
        inRing
          .map((index) => unit(sub(positions.get(index) as Vec3, ringPos)))
          .reduce((acc, v) => add(acc, v), [0, 0, 0] as Vec3),
        -1,
      ),
    );
    for (const nbr of ringNbrs) {
      if (system.atoms.includes(nbr) || positions.has(nbr)) continue;
      const bond = mol.bonds.find(
        (b) => (b.a === ringAtom && b.b === nbr) || (b.b === ringAtom && b.a === nbr),
      ) as Bond;
      const length = bondLength(
        mol.atoms[ringAtom].element,
        mol.atoms[nbr].element,
        bondFlavour(mol, bond),
      );
      positions.set(nbr, add(ringPos, scale(outward, length)));
      parent.set(nbr, ringAtom);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Steric relief
 * ------------------------------------------------------------------ */

interface Restraint {
  readonly i: number;
  readonly j: number;
  readonly target: number;
  readonly k: number;
}

/** Topological distance up to 3 bonds, so 1-2, 1-3 and 1-4 pairs are excluded. */
function closePairs(mol: Molecule): Set<string> {
  const adj = adjacency(mol);
  const near = new Set<string>();
  for (let i = 0; i < mol.atoms.length; i += 1) {
    const seen = new Map<number, number>([[i, 0]]);
    const queue = [i];
    while (queue.length > 0) {
      const v = queue.shift() as number;
      const d = seen.get(v) as number;
      if (d >= 3) continue;
      for (const w of adj[v]) {
        if (seen.has(w)) continue;
        seen.set(w, d + 1);
        queue.push(w);
      }
    }
    for (const w of seen.keys()) if (w > i) near.add(`${i}-${w}`);
  }
  return near;
}

/**
 * Steepest-descent relief of non-bonded overlaps, with every bond length and
 * bond angle restrained to its ideal value. Because the starting geometry is
 * already ideal, this only moves atoms that are genuinely clashing.
 */
function relax(mol: Molecule, iterations: number): void {
  const bondRestraints: Restraint[] = mol.bonds.map((bond) => ({
    i: bond.a,
    j: bond.b,
    target: bondLength(mol.atoms[bond.a].element, mol.atoms[bond.b].element, bondFlavour(mol, bond)),
    k: 40,
  }));

  // 1-3 distances encode the bond angles, which keeps the maths to one term type.
  const adj = adjacency(mol);
  const angleRestraints: Restraint[] = [];
  for (let b = 0; b < mol.atoms.length; b += 1) {
    const nbrs = adj[b];
    const h = idealAngle(hybridisationOf(mol, b));
    for (let p = 0; p < nbrs.length; p += 1) {
      for (let q = p + 1; q < nbrs.length; q += 1) {
        const i = nbrs[p];
        const j = nbrs[q];
        const bondI = mol.bonds.find(
          (x) => (x.a === b && x.b === i) || (x.b === b && x.a === i),
        ) as Bond;
        const bondJ = mol.bonds.find(
          (x) => (x.a === b && x.b === j) || (x.b === b && x.a === j),
        ) as Bond;
        const li = bondLength(mol.atoms[b].element, mol.atoms[i].element, bondFlavour(mol, bondI));
        const lj = bondLength(mol.atoms[b].element, mol.atoms[j].element, bondFlavour(mol, bondJ));
        const theta = h * DEG;
        const target = Math.sqrt(li * li + lj * lj - 2 * li * lj * Math.cos(theta));
        angleRestraints.push({ i, j, target, k: 14 });
      }
    }
  }

  const excluded = closePairs(mol);
  const n = mol.atoms.length;
  const grad = new Float64Array(n * 3);
  const step = 0.012;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    grad.fill(0);

    const applyPair = (i: number, j: number, target: number, k: number, repulsiveOnly: boolean) => {
      const dx = mol.atoms[j].x - mol.atoms[i].x;
      const dy = mol.atoms[j].y - mol.atoms[i].y;
      const dz = mol.atoms[j].z - mol.atoms[i].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      if (repulsiveOnly && d >= target) return;
      const f = (k * (d - target)) / d;
      grad[i * 3] -= f * dx;
      grad[i * 3 + 1] -= f * dy;
      grad[i * 3 + 2] -= f * dz;
      grad[j * 3] += f * dx;
      grad[j * 3 + 1] += f * dy;
      grad[j * 3 + 2] += f * dz;
    };

    for (const r of bondRestraints) applyPair(r.i, r.j, r.target, r.k, false);
    for (const r of angleRestraints) applyPair(r.i, r.j, r.target, r.k, false);

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (excluded.has(`${i}-${j}`)) continue;
        const target =
          0.82 * (ELEMENT_INFO[mol.atoms[i].element].vdw + ELEMENT_INFO[mol.atoms[j].element].vdw);
        const dx = mol.atoms[j].x - mol.atoms[i].x;
        if (Math.abs(dx) > target) continue;
        const dy = mol.atoms[j].y - mol.atoms[i].y;
        if (Math.abs(dy) > target) continue;
        const dz = mol.atoms[j].z - mol.atoms[i].z;
        if (Math.abs(dz) > target) continue;
        applyPair(i, j, target, 6, true);
      }
    }

    for (let i = 0; i < n; i += 1) {
      mol.atoms[i].x -= step * grad[i * 3];
      mol.atoms[i].y -= step * grad[i * 3 + 1];
      mol.atoms[i].z -= step * grad[i * 3 + 2];
    }
  }
}

/** Largest non-bonded overlap left in the structure, in angstrom. */
export function worstClash(mol: Molecule): number {
  const excluded = closePairs(mol);
  let worst = 0;
  for (let i = 0; i < mol.atoms.length; i += 1) {
    for (let j = i + 1; j < mol.atoms.length; j += 1) {
      if (excluded.has(`${i}-${j}`)) continue;
      const limit =
        0.75 * (ELEMENT_INFO[mol.atoms[i].element].vdw + ELEMENT_INFO[mol.atoms[j].element].vdw);
      const d = Math.hypot(
        mol.atoms[i].x - mol.atoms[j].x,
        mol.atoms[i].y - mol.atoms[j].y,
        mol.atoms[i].z - mol.atoms[j].z,
      );
      if (d < limit) worst = Math.max(worst, limit - d);
    }
  }
  return worst;
}

/** Largest deviation of any bond from its tabulated equilibrium length. */
export function maxBondDeviation(mol: Molecule): number {
  let worst = 0;
  for (const bond of mol.bonds) {
    const target = bondLength(
      mol.atoms[bond.a].element,
      mol.atoms[bond.b].element,
      bondFlavour(mol, bond),
    );
    const d = Math.hypot(
      mol.atoms[bond.a].x - mol.atoms[bond.b].x,
      mol.atoms[bond.a].y - mol.atoms[bond.b].y,
      mol.atoms[bond.a].z - mol.atoms[bond.b].z,
    );
    worst = Math.max(worst, Math.abs(d - target));
  }
  return worst;
}
