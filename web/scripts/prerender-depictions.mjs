#!/usr/bin/env node
/**
 * Pre-renders the structure diagrams that must appear instantly.
 *
 * The RDKit runtime is 7 MB and is fetched on demand, which is right for a
 * workbench the user has chosen to open but wrong for the first thing on the
 * landing page. So the handful of structures that are shown before the user
 * does anything are rendered HERE, at build time, by the same RDKit build the
 * browser would use. They are identical drawings, just produced earlier.
 *
 * Anything the user then edits is rendered live in the browser. There is no
 * second drawing engine and no approximation anywhere.
 *
 * Output: `src/generated/depictions.ts`.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from 'esbuild';

/**
 * The chemistry layer is TypeScript with extensionless imports, which Node
 * cannot load directly. esbuild (already present as Vite's bundler) compiles
 * it to one temporary ES module, so the script runs the exact source the app
 * ships rather than a duplicate.
 */
const bundlePath = resolve(tmpdir(), `qbind-chem-${process.pid}.mjs`);
await build({
  entryPoints: [resolve(import.meta.dirname, '..', 'src', 'chem', 'prerender-entry.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  logLevel: 'warning',
});
const { buildPeptide, RESIDUE_TEMPLATES, CLASS_INFO } = await import(
  pathToFileURL(bundlePath).href
);

/** The class sequence the Python benchmark reports as rank 1 at lambda = 1. */
const REFERENCE_CODES = [2, 3, 0, 0, 2, 2, 1, 2];

const require = createRequire(import.meta.url);
const rdkitDir = resolve(import.meta.dirname, '..', 'public', 'rdkit');
const jsPath = resolve(rdkitDir, 'RDKit_minimal.js');
const wasmPath = resolve(rdkitDir, 'RDKit_minimal.wasm');

const container = { exports: {} };
const evaluate = new Function(
  'module',
  'exports',
  'require',
  '__filename',
  '__dirname',
  readFileSync(jsPath, 'utf8'),
);
evaluate(container, container.exports, require, jsPath, rdkitDir);
const factory = container.exports.default ?? container.exports;

const RDKit = await factory({
  locateFile: () => wasmPath,
  wasmBinary: readFileSync(wasmPath),
});
try {
  RDKit.prefer_coordgen(true);
} catch {
  // Older builds lay rings out with the default algorithm, which is still correct.
}

/** Same post-processing the browser applies, so the two outputs are identical. */
function themeDepiction(svg) {
  return svg
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/#000000/gi, 'currentColor')
    .replace(/#FFFFFF00/gi, 'none');
}

function depict(smiles, width, height) {
  const mol = RDKit.get_mol(smiles);
  if (!mol || !mol.is_valid()) throw new Error(`RDKit rejected ${smiles}`);
  try {
    mol.set_new_coords(true);
    mol.normalize_depiction(1);
    mol.straighten_depiction(true);
    return themeDepiction(
      mol.get_svg_with_highlights(
        JSON.stringify({
          width,
          height,
          bondLineWidth: 1.6,
          fixedBondLength: 0,
          addStereoAnnotation: false,
          explicitMethyl: false,
          backgroundColour: [1, 1, 1, 0],
          atoms: [],
          bonds: [],
        }),
      ),
    );
  } finally {
    mol.delete();
  }
}

const entries = [];

// 1. The reference design, at the width the landing-page panel uses.
const referenceResidues = REFERENCE_CODES.map((c) => CLASS_INFO[c].representative);
const reference = buildPeptide(referenceResidues);
entries.push([`peptide:${reference.sequence}`, depict(reference.smiles, 720, 330)]);

// Nothing else is pre-rendered. Every other structure in the app is one the
// user asked for by editing a design, by which point the live RDKit runtime is
// already loading, so baking more diagrams into the bundle would only add
// weight for no gain.
void RESIDUE_TEMPLATES;

const out = resolve(import.meta.dirname, '..', 'src', 'generated', 'depictions.ts');
mkdirSync(dirname(out), { recursive: true });

const body = entries
  .map(([key, svg]) => `  ${JSON.stringify(key)}: ${JSON.stringify(svg)},`)
  .join('\n');

writeFileSync(
  out,
  `/* GENERATED FILE - do not edit.
 *
 * Written by scripts/prerender-depictions.mjs with RDKit ${RDKit.version()}.
 * These are the structure diagrams shown before the RDKit runtime has
 * finished loading in the browser. They are produced by the same engine, from
 * the same SMILES, so the drawing never changes when the live engine takes
 * over - it just stops waiting.
 */

export const RDKIT_VERSION = ${JSON.stringify(RDKit.version())};

export const PRERENDERED: Readonly<Record<string, string>> = {
${body}
};

/** Key for a whole peptide, by one-letter sequence. */
export function peptideKey(sequence: string): string {
  return \`peptide:\${sequence}\`;
}
`,
  'utf8',
);

rmSync(bundlePath, { force: true });

const bytes = readFileSync(out).length;
console.log(
  `prerender-depictions: ${entries.length} diagrams, ${(bytes / 1024).toFixed(0)} kB, RDKit ${RDKit.version()}`,
);
process.exit(0);
