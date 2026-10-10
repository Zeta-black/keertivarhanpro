#!/usr/bin/env node
/**
 * Copies the RDKit MinimalLib runtime out of node_modules into `public/rdkit`.
 *
 * RDKit-JS ships an Emscripten module plus a 7 MB WebAssembly binary. Bundling
 * the binary through Vite is neither necessary nor desirable - it is a static
 * asset that should be cached by URL - so it is served from `public/` and
 * loaded on demand by `src/viz/rdkit.ts`. The copy is generated rather than
 * committed, which keeps the repository free of a vendored binary and keeps the
 * served version pinned to whatever package-lock.json resolves.
 *
 * Runs automatically from `predev` and `prebuild`.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('@rdkit/rdkit'));
const target = resolve(import.meta.dirname, '..', 'public', 'rdkit');

mkdirSync(target, { recursive: true });

const files = ['RDKit_minimal.js', 'RDKit_minimal.wasm'];
for (const file of files) {
  const from = resolve(source, file);
  const to = resolve(target, file);
  copyFileSync(from, to);
  const size = statSync(to).size;
  console.log(`sync-rdkit: ${file} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

// Record which RDKit release is being served so the UI can state it rather
// than claiming an unverifiable version.
const pkg = JSON.parse(
  readFileSync(resolve(source, '..', 'package.json'), 'utf8'),
);
writeFileSync(
  resolve(target, 'version.json'),
  `${JSON.stringify({ version: pkg.version, library: 'RDKit MinimalLib (WebAssembly)' }, null, 2)}\n`,
  'utf8',
);
console.log(`sync-rdkit: pinned RDKit ${pkg.version}`);
