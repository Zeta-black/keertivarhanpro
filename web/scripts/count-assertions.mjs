#!/usr/bin/env node
/**
 * Sums the real executed-assertion counts that tests/setup.ts recorded.
 * Reports per-file and total. No estimates, no extrapolation.
 *
 * IMPORTANT: the log is APPEND-ONLY. tests/setup.ts adds a line per worker on
 * teardown, so running the suite twice without clearing the file makes this
 * script report the sum of both runs - and deleted test files keep
 * contributing until the file is removed. For a figure you intend to publish:
 *
 *   rm -f web/.vitest-assertions.jsonl && npx vitest run && npm run assertions
 *
 * Passing --clean removes the log after reporting, which is the other way to
 * stay honest.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const file = resolve(import.meta.dirname, '..', '.vitest-assertions.jsonl');
if (!existsSync(file)) {
  console.error('No assertion log found. Run `npm test` first.');
  process.exit(1);
}

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const byFile = new Map();
for (const row of rows) {
  const key = basename(row.file ?? 'unknown');
  byFile.set(key, (byFile.get(key) ?? 0) + row.assertions);
}

const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
let total = 0;
const width = Math.max(...sorted.map(([k]) => k.length), 20);
console.log('Executed assertions by test file:');
for (const [name, count] of sorted) {
  total += count;
  console.log(`  ${name.padEnd(width)}  ${count.toLocaleString().padStart(9)}`);
}
console.log(`  ${'-'.repeat(width)}  ${'-'.repeat(9)}`);
console.log(`  ${'TOTAL'.padEnd(width)}  ${total.toLocaleString().padStart(9)}`);

if (process.argv.includes('--clean')) rmSync(file);
