/**
 * EXPORT GATE. The download buttons are the only way a visitor can take the
 * numbers away with them, so a corrupt export is an honesty failure, not a
 * cosmetic one.
 *
 * What is actually checked here:
 *  - header names match the published Python artefacts byte-for-byte
 *  - every number survives a CSV round trip with full float64 precision
 *  - nulls become EMPTY cells, never "null", "undefined" or a placeholder 0
 *  - free text cannot smuggle a formula into a spreadsheet, and cannot break
 *    out of its own field with a comma, a quote or a newline
 *  - filenames cannot escape the downloads folder
 *  - the honesty statements and the reproduction recipe are in the report
 *
 * The CSV parser below is written from the RFC by hand ON PURPOSE: reusing the
 * writer's own escaping logic to read the file back would make the round-trip
 * tests circular and they would pass even if both halves were wrong.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_CSV_HEADER,
  CSV_EOL,
  CSV_MIME,
  FORMULA_LEAD_CHARS,
  JSON_MIME,
  MARKDOWN_MIME,
  MAX_FILENAME_LENGTH,
  NOT_AVAILABLE,
  SOLVER_CSV_HEADER,
  SURROGATE_CSV_HEADER,
  SVG_NS,
  SWEEP_CSV_HEADER,
  XLINK_NS,
  buildExportBundle,
  candidateSolverLabel,
  candidatesToCsv,
  csvCell,
  csvRow,
  msToSeconds,
  neutraliseFormula,
  numberToCell,
  quoteCsvField,
  runToJson,
  runToMarkdownReport,
  safeFilename,
  sanitiseFilename,
  solversToCsv,
  surrogatesToCsv,
  svgToString,
  sweepToCsv,
  toBlob,
  toCsv,
  triggerDownload,
} from '../src/export/index';
import { HONESTY, METRIC_HELP } from '../src/content/copy';
import { STAGES } from '../src/workers/protocol';
import type {
  CandidateRecord,
  RunConfig,
  RunRecord,
  SolverRecord,
  SurrogateReport,
  SweepPoint,
} from '../src/workers/protocol';

/* ------------------------------------------------------------------ *
 * Honest assertion count, printed at the end of the run.
 * ------------------------------------------------------------------ */

let assertionTotal = 0;
afterEach(() => {
  const state = expect.getState() as unknown as { assertionCalls?: number };
  assertionTotal += state.assertionCalls ?? 0;
});
afterAll(() => {
  // eslint-disable-next-line no-console
  console.log(`[export.test] executed expect() calls: ${assertionTotal}`);
});

/* ------------------------------------------------------------------ *
 * An independent RFC4180 reader (see file header for why).
 * ------------------------------------------------------------------ */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && text.charAt(i + 1) === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Splits the document into [header, ...dataRows]. */
function table(csv: string): { header: string[]; rows: string[][] } {
  const parsed = parseCsv(csv);
  return { header: parsed[0] ?? [], rows: parsed.slice(1) };
}

function column(header: readonly string[], name: string): number {
  const index = header.indexOf(name);
  if (index === -1) throw new Error(`column ${name} is missing from the header`);
  return index;
}

/* ------------------------------------------------------------------ *
 * Synthetic but TYPE-CORRECT fixture.
 *
 * The numbers are deliberately awkward (irrational decimals, denormal-ish
 * exponents, integers past 2^53 precision boundaries) so a rounding bug in the
 * writer cannot hide. The warning strings are deliberately hostile.
 * ------------------------------------------------------------------ */

/** Free-text warning labels, one per candidate, each hostile in its own way. */
const WARNING_CASES: readonly string[] = [
  'BALANCED',
  'HIGH_CHARGE,LOW_SELECTIVITY',
  'model says "greasy"',
  'first line\nsecond line',
  '  leading and trailing  ',
  '=HYPERLINK("http://evil.example","click")',
  '+1 very charged',
  '-1 selectivity',
  '@SUM(A1:A9)',
  '\tTAB_LED',
];

/** The exact cell each warning must produce. Written out by hand, not derived. */
const WARNING_EXPECTED_CELL: readonly string[] = [
  'BALANCED',
  '"HIGH_CHARGE,LOW_SELECTIVITY"',
  '"model says ""greasy"""',
  '"first line\nsecond line"',
  '"  leading and trailing  "',
  '"\'=HYPERLINK(""http://evil.example"",""click"")"',
  "'+1 very charged",
  "'-1 selectivity",
  "'@SUM(A1:A9)",
  "'\tTAB_LED",
];

const PRECISION_SEEDS: readonly number[] = [
  -39.71991114030531,
  0.1 + 0.2,
  1 / 3,
  -1234.5678901234567,
  1e-7,
  5e-324,
  2 ** 53 + 2,
  -0.30000000000000004,
  123456789.123456789,
  -1e21,
];

function makeCandidate(i: number): CandidateRecord {
  const base = PRECISION_SEEDS[i % PRECISION_SEEDS.length];
  return {
    index: 1000 + i,
    codes: [i % 6, (i + 1) % 6, (i + 2) % 6, (i + 3) % 6, (i + 4) % 6, (i + 5) % 6, i % 6, 0],
    classSequence: `CLASS_${i}-HYDROPHOBIC-SMALL_POLAR-AROM_W-AROM_W-HYDROPHOBIC-AROM_FY-CHARGED_NEG`,
    representative: `LSWWLLF${'ABCDEFGHIJ'.charAt(i)}`,
    scores: {
      PET: base,
      PE: base - 162.87915547215372,
      PP: base * -3.3333333333333335,
    },
    objective: base * 7 - 383.48736099604986,
    rank: i + 1,
    metrics: {
      meanOffTarget: base / 7,
      worstOffTarget: base / 11,
      marginMean: 171.8837249278723 + i / 3,
      marginWorst: 162.8791554721537 - i / 9,
      aromaticFraction: i / 8,
      hydrophobicFraction: (8 - i) / 8,
      polarFraction: 0.125,
      netChargeClassBalance: (i % 3) - 1 === 0 ? 0 : ((i % 3) - 1) / 8,
      warnings: WARNING_CASES[i],
    },
  };
}

const CANDIDATES: CandidateRecord[] = Array.from({ length: 10 }, (_, i) => makeCandidate(i));

const SWEEP: SweepPoint[] = [0, 0.5, 1, 2, 5].map((lambda, i) => ({
  lambda,
  best: makeCandidate(i),
  penalty: 4775.078957067153 + i,
  runtimeMs: 726.4297000001534 * (i + 1),
  optimumHits: i * 3,
}));

const SOLVERS: SolverRecord[] = [
  {
    solver: 'Brute force',
    lambda: 1,
    status: 'EXECUTED',
    bestObjective: -383.48736099604986,
    classSequence: 'HYDROPHOBIC-SMALL_POLAR-AROM_W-AROM_W-HYDROPHOBIC-HYDROPHOBIC-AROM_FY-HYDROPHOBIC',
    validityRate: 1,
    successRate: 1,
    runtimeMs: 726.4297000001534,
    seed: null,
    reads: null,
    medianBestEnergy: null,
    stdBestEnergy: null,
    note: 'Exhaustive over all 1,679,616 valid sequences, so the optimum is proven.',
    exact: true,
  },
  {
    solver: 'Simulated annealing',
    lambda: 1,
    status: 'EXECUTED',
    bestObjective: -377.076055501180235,
    classSequence: 'AROM_W-HYDROPHOBIC-CHARGED_NEG-CHARGED_POS-CHARGED_NEG-HYDROPHOBIC-AROM_W-AROM_W',
    validityRate: 1,
    successRate: 0,
    runtimeMs: 1861.8858000008913,
    seed: 42,
    reads: 1500,
    medianBestEnergy: -34.39016662834911,
    stdBestEnergy: 1.4214462645750976,
    note: '-2 runs ended on a tie; see median_best_energy',
    exact: false,
  },
  {
    solver: 'Quantum annealer (D-Wave)',
    lambda: 1,
    status: 'NOT EXECUTED',
    bestObjective: null,
    classSequence: null,
    validityRate: null,
    successRate: null,
    runtimeMs: null,
    seed: null,
    reads: null,
    medianBestEnergy: null,
    stdBestEnergy: null,
    note: 'NO QUANTUM HARDWARE EXECUTION. The QUBO is in an acceptable form; nothing was submitted.',
    exact: false,
  },
  {
    solver: 'Random search',
    lambda: 1,
    status: 'SKIPPED',
    bestObjective: null,
    classSequence: null,
    validityRate: null,
    successRate: null,
    runtimeMs: null,
    seed: 7,
    reads: 0,
    medianBestEnergy: null,
    stdBestEnergy: null,
    note: '\rSkipped on a low-power device, note begins with a carriage return',
    exact: false,
  },
];

const SURROGATES: SurrogateReport[] = ['PET', 'PE', 'PP'].map((plastic, i) => ({
  plastic,
  alpha: 1e-6,
  seed: 42,
  train: {
    count: 12000 + i,
    r2: 1,
    rmse: 4.9887034010630905e-8 + i,
    mae: 3.9283306786472295e-8,
    maxAbsError: 1.4901161193847656e-7,
  },
  validation: {
    count: 3000 + i,
    r2: 0.9999999999999999,
    rmse: 3.89464328089218e-8,
    mae: 3.0770042299963864e-8,
    maxAbsError: 1.1920928955078125e-7,
  },
  test: {
    count: 3000 + i,
    r2: 1,
    rmse: 5.0000000000000004e-8,
    mae: 3.141592653589793e-8,
    maxAbsError: 2.220446049250313e-16,
  },
  splitsDisjoint: i !== 2,
  fitMs: 812.3456789012345 * (i + 1),
}));

const CONFIG: RunConfig = {
  lambda: 0.5,
  seed: 1337,
  sweepLambdas: [0, 0.5, 1, 2, 5],
  topN: 10,
  surrogate: { alpha: 1e-6, trainSize: 12000, validationSize: 3000, testSize: 3000, enabled: true },
  annealing: { reads: 40, sweeps: 120, runs: 3, enabled: true },
  penaltyMultiplier: 2,
  tolerance: 1e-8,
};

const RECORD: RunRecord = {
  runId: 'run-2026-abc',
  config: CONFIG,
  mode: 'live',
  candidates: CANDIDATES,
  sweep: SWEEP,
  solvers: SOLVERS,
  surrogates: SURROGATES,
  verify: {
    sampleSize: 500,
    seed: 1337,
    maxQuboObjectiveError: 7.275957614183426e-12,
    maxPenaltyResidue: 9.094947017729282e-13,
    encodeDecodeRoundTrips: 500,
    invalidTested: 120,
    invalidCorrectlyPenalised: 120,
    penaltyBound: 5667.724205981706,
    lambda: 0.5,
    runtimeMs: 134.5,
  },
  stats: {
    PET: { mean: -120.5, std: 44.25, min: -301.125, max: 41.00083330563526 },
    objective: { mean: -200.75, std: 60.5, min: -383.48736099604986, max: 10.5 },
  },
  searchSpace: { positions: 8, classes: 6, binaryVariables: 48, validSequences: 1679616 },
  timings: { enumeration: 310.5, scoring: 1204.25, solving: 726.4297000001534 },
  totalMs: 4096.5,
  environment: {
    userAgent: 'Mozilla/5.0 (Test, rv:1.0) Vitest/2, jsdom',
    hardwareConcurrency: 8,
    deviceMemoryGb: null,
  },
  quantumHardware: 'NO QUANTUM HARDWARE EXECUTION',
  modelSource: 'QA-PBP-RL-Nexus potts_6class_8mer.json',
  startedAtIso: '2026-10-09T08:15:30.250Z',
};

/** A second record exercising every "nothing ran" path. */
const EMPTY_RECORD: RunRecord = {
  ...RECORD,
  runId: 'run-empty',
  config: { ...CONFIG, lambda: 0, seed: 0 },
  candidates: [],
  sweep: [],
  solvers: [],
  surrogates: [],
  verify: null,
  timings: {},
  environment: { userAgent: '', hardwareConcurrency: 1, deviceMemoryGb: null },
};

/* ------------------------------------------------------------------ *
 * Fixture integrity
 * ------------------------------------------------------------------ */

describe('fixture', () => {
  it('is shaped the way the rest of the suite assumes', () => {
    expect(RECORD.candidates).toHaveLength(10);
    expect(RECORD.sweep).toHaveLength(5);
    expect(RECORD.solvers).toHaveLength(4);
    expect(RECORD.surrogates).toHaveLength(3);
    expect(WARNING_CASES).toHaveLength(WARNING_EXPECTED_CELL.length);
    expect(RECORD.verify).not.toBeNull();
    expect(EMPTY_RECORD.verify).toBeNull();
    expect(EMPTY_RECORD.candidates).toHaveLength(0);
  });

  it('carries at least one hostile string per injection lead character', () => {
    const leads = new Set(
      [...WARNING_CASES, ...SOLVERS.map((s) => s.note)].map((t) => t.charAt(0)),
    );
    for (const ch of FORMULA_LEAD_CHARS) {
      expect(leads.has(ch), `no fixture text begins with ${JSON.stringify(ch)}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * CSV primitives
 * ------------------------------------------------------------------ */

describe('neutraliseFormula', () => {
  it('prefixes every dangerous lead character', () => {
    for (const ch of FORMULA_LEAD_CHARS) {
      expect(neutraliseFormula(`${ch}payload`)).toBe(`'${ch}payload`);
    }
  });

  it('leaves safe text untouched', () => {
    const safe = ['BALANCED', 'a=b', 'x+y', '0.5', 'Brute force', '"quoted"', ' leading space'];
    for (const text of safe) expect(neutraliseFormula(text)).toBe(text);
  });

  it('does not touch the empty string', () => {
    expect(neutraliseFormula('')).toBe('');
  });

  it('prefixes only once, at the front', () => {
    const out = neutraliseFormula('=1+1');
    expect(out).toBe("'=1+1");
    expect(out.split("'")).toHaveLength(2);
    expect(neutraliseFormula(out)).toBe(out);
  });
});

describe('quoteCsvField', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['plain', 'plain'],
    ['has,comma', '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ['two""quotes', '"two""""quotes"'],
    ['line\nbreak', '"line\nbreak"'],
    ['carriage\rreturn', '"carriage\rreturn"'],
    ['crlf\r\nhere', '"crlf\r\nhere"'],
    [' leading', '" leading"'],
    ['trailing ', '"trailing "'],
    ['\ttab-led', '"\ttab-led"'],
    ['mid dle', 'mid dle'],
    ['', ''],
    ['-1.5', '-1.5'],
    ['BALANCED', 'BALANCED'],
  ];

  it.each(cases)('quotes %j correctly', (input, expected) => {
    expect(quoteCsvField(input)).toBe(expected);
  });

  it('round-trips every case through the independent parser', () => {
    for (const [input] of cases) {
      const parsed = parseCsv(`${quoteCsvField(input)}${CSV_EOL}`);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveLength(1);
      expect(parsed[0][0]).toBe(input);
    }
  });
});

describe('csvCell', () => {
  it('turns null and undefined into an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).not.toBe('null');
    expect(csvCell(undefined)).not.toBe('undefined');
    expect(csvCell(null)).not.toBe('0');
    expect(csvCell(null)).not.toBe(NOT_AVAILABLE);
  });

  it('writes booleans as true/false, not 1/0', () => {
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
    expect(csvCell(false)).not.toBe('');
    expect(csvCell(false)).not.toBe('0');
  });

  it('writes numbers at full float64 precision and never prefixes them', () => {
    for (const n of PRECISION_SEEDS) {
      const cell = csvCell(n);
      expect(cell).toBe(String(n));
      expect(cell.startsWith("'")).toBe(false);
      expect(Number(cell)).toBe(n);
    }
  });

  it('keeps a negative number parseable rather than neutralising it', () => {
    expect(csvCell(-1)).toBe('-1');
    expect(Number(csvCell(-1))).toBe(-1);
    expect(csvCell(-0)).toBe('0');
  });

  it('preserves non-finite numbers honestly instead of zeroing them', () => {
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('Infinity');
    expect(csvCell(Number.NEGATIVE_INFINITY)).toBe('-Infinity');
    expect(csvCell(Number.NaN)).toBe('NaN');
    expect(Number(csvCell(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(Number(csvCell(Number.NaN)))).toBe(true);
  });

  it('neutralises then quotes hostile text', () => {
    for (let i = 0; i < WARNING_CASES.length; i += 1) {
      expect(csvCell(WARNING_CASES[i]), `warning case ${i}`).toBe(WARNING_EXPECTED_CELL[i]);
    }
  });

  it('matches numberToCell for every numeric input', () => {
    for (const n of [0, 1, -1, 0.5, 1e-7, 1e21, 2 ** 53]) {
      expect(csvCell(n)).toBe(numberToCell(n));
    }
  });
});

describe('csvRow and toCsv', () => {
  it('joins cells with commas', () => {
    expect(csvRow(['a', 1, true, null, undefined])).toBe('a,1,true,,');
  });

  it('terminates every record with CRLF, including the last', () => {
    const csv = toCsv(['a', 'b'], [[1, 2], [3, 4]]);
    expect(csv).toBe(`a,b${CSV_EOL}1,2${CSV_EOL}3,4${CSV_EOL}`);
    expect(csv.endsWith(CSV_EOL)).toBe(true);
    expect(csv.split(CSV_EOL)).toHaveLength(4);
  });

  it('emits a header-only document for no rows', () => {
    const csv = toCsv(['only'], []);
    expect(csv).toBe(`only${CSV_EOL}`);
    expect(table(csv).rows).toHaveLength(0);
  });

  it('throws on a ragged row rather than shipping shifted columns', () => {
    expect(() => toCsv(['a', 'b'], [[1]])).toThrow(/row 0 has 1 cells but the header has 2/);
    expect(() => toCsv(['a', 'b'], [[1, 2], [1, 2, 3]])).toThrow(/row 1 has 3 cells/);
    expect(() => toCsv(['a', 'b'], [[1, 2]])).not.toThrow();
  });
});

describe('msToSeconds', () => {
  it('converts without rounding and preserves missing values', () => {
    expect(msToSeconds(1000)).toBe(1);
    expect(msToSeconds(726.4297000001534)).toBe(0.7264297000001534);
    expect(msToSeconds(0)).toBe(0);
    expect(msToSeconds(null)).toBeNull();
    expect(msToSeconds(undefined)).toBeNull();
    expect(msToSeconds(null)).not.toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * candidatesToCsv
 * ------------------------------------------------------------------ */

const CANDIDATE_NUMERIC: ReadonlyArray<[string, (c: CandidateRecord) => number]> = [
  ['PET_canonical_binding_score', (c) => c.scores.PET],
  ['PE_canonical_binding_score', (c) => c.scores.PE],
  ['PP_canonical_binding_score', (c) => c.scores.PP],
  ['objective', (c) => c.objective],
  ['rank', (c) => c.rank],
  ['mean_offtarget', (c) => c.metrics.meanOffTarget],
  ['worst_offtarget', (c) => c.metrics.worstOffTarget],
  ['margin_mean', (c) => c.metrics.marginMean],
  ['margin_worst', (c) => c.metrics.marginWorst],
  ['aromatic_fraction', (c) => c.metrics.aromaticFraction],
  ['hydrophobic_fraction', (c) => c.metrics.hydrophobicFraction],
  ['polar_fraction', (c) => c.metrics.polarFraction],
  ['net_charge_class_balance', (c) => c.metrics.netChargeClassBalance],
];

describe('candidatesToCsv', () => {
  const csv = candidatesToCsv(RECORD);
  const parsed = table(csv);

  it('uses exactly the published Python header, in order', () => {
    expect(parsed.header).toEqual([...CANDIDATE_CSV_HEADER]);
    expect(parsed.header).toHaveLength(17);
  });

  it('matches the header line of results/top10_peptides.csv character for character', () => {
    const published = readFileSync(
      resolve(__dirname, '..', '..', 'results', 'top10_peptides.csv'),
      'utf8',
    );
    const firstLine = published.split(/\r?\n/)[0];
    expect(firstLine).toBe(CANDIDATE_CSV_HEADER.join(','));
    expect(firstLine.split(',')).toEqual([...CANDIDATE_CSV_HEADER]);
    expect(csv.startsWith(`${firstLine}${CSV_EOL}`)).toBe(true);
  });

  it('names every column exactly once', () => {
    for (const name of CANDIDATE_CSV_HEADER) {
      expect(parsed.header.filter((h) => h === name), name).toHaveLength(1);
    }
  });

  it('writes one row per candidate and nothing else', () => {
    expect(parsed.rows).toHaveLength(RECORD.candidates.length);
    for (const row of parsed.rows) expect(row).toHaveLength(CANDIDATE_CSV_HEADER.length);
    expect(candidatesToCsv(EMPTY_RECORD)).toBe(`${CANDIDATE_CSV_HEADER.join(',')}${CSV_EOL}`);
  });

  it('round-trips every numeric cell back to the identical float64', () => {
    for (let r = 0; r < RECORD.candidates.length; r += 1) {
      const candidate = RECORD.candidates[r];
      for (const [name, pick] of CANDIDATE_NUMERIC) {
        const cell = parsed.rows[r][column(parsed.header, name)];
        expect(Number(cell), `${name} row ${r}`).toBe(pick(candidate));
      }
    }
  });

  it('writes the first row with no loss of digits', () => {
    const candidate = RECORD.candidates[0];
    for (const [name, pick] of CANDIDATE_NUMERIC) {
      const cell = parsed.rows[0][column(parsed.header, name)];
      expect(cell, name).toBe(String(pick(candidate)));
    }
  });

  it('carries the class sequence and representative unchanged', () => {
    const seq = column(parsed.header, 'class_sequence');
    const rep = column(parsed.header, 'representative_aa_sequence');
    for (let r = 0; r < RECORD.candidates.length; r += 1) {
      expect(parsed.rows[r][seq]).toBe(RECORD.candidates[r].classSequence);
      expect(parsed.rows[r][rep]).toBe(RECORD.candidates[r].representative);
    }
  });

  it('neutralises and quotes every warning field, and the parser gets the text back', () => {
    const warn = column(parsed.header, 'warnings');
    const rawLines = csv.slice(0, -CSV_EOL.length).split(CSV_EOL);
    for (let r = 0; r < WARNING_CASES.length; r += 1) {
      const expectedCell = WARNING_EXPECTED_CELL[r];
      expect(parsed.rows[r][warn], `parsed warning ${r}`).toBe(
        expectedCell.startsWith('"')
          ? expectedCell.slice(1, -1).replace(/""/g, '"')
          : expectedCell,
      );
      expect(csv.includes(expectedCell), `raw cell ${r} present`).toBe(true);
    }
    // The newline inside candidate 3's warning must stay INSIDE its quoted
    // field: the document has exactly 11 CRLF-terminated records, but more
    // physical lines than that, because of the embedded LF.
    expect(rawLines).toHaveLength(RECORD.candidates.length + 1);
    expect(csv.split('\n').length).toBeGreaterThan(RECORD.candidates.length + 1);
    expect(csv.split('\n')).toHaveLength(RECORD.candidates.length + 3);
  });

  it('never lets a formula reach the spreadsheet unprefixed', () => {
    const warn = column(parsed.header, 'warnings');
    for (const row of parsed.rows) {
      const cell = row[warn];
      for (const ch of FORMULA_LEAD_CHARS) {
        expect(cell.startsWith(ch), `cell ${JSON.stringify(cell)} starts with ${JSON.stringify(ch)}`).toBe(
          false,
        );
      }
    }
  });

  it('reports the exact solver that produced the ranking, and never invents one', () => {
    const solverCol = column(parsed.header, 'solver');
    expect(candidateSolverLabel(RECORD)).toBe('Brute force');
    for (const row of parsed.rows) expect(row[solverCol]).toBe('Brute force');

    const noExact: RunRecord = {
      ...RECORD,
      solvers: RECORD.solvers.filter((s) => !s.exact),
    };
    expect(candidateSolverLabel(noExact)).toBe('');
    const noExactRows = table(candidatesToCsv(noExact)).rows;
    for (const row of noExactRows) expect(row[solverCol]).toBe('');

    const notRun: RunRecord = {
      ...RECORD,
      solvers: [{ ...RECORD.solvers[0], status: 'SKIPPED' }],
    };
    expect(candidateSolverLabel(notRun)).toBe('');
    expect(candidateSolverLabel(EMPTY_RECORD)).toBe('');
  });

  it('writes no stringified null, undefined or placeholder zero', () => {
    expect(csv).not.toMatch(/(^|,)null(,|\r)/);
    expect(csv).not.toMatch(/(^|,)undefined(,|\r)/);
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain(NOT_AVAILABLE);
  });
});

/* ------------------------------------------------------------------ *
 * sweepToCsv
 * ------------------------------------------------------------------ */

const SWEEP_NUMERIC: ReadonlyArray<[string, (p: SweepPoint) => number]> = [
  ['lambda', (p) => p.lambda],
  ['PET_canonical_binding_score', (p) => p.best.scores.PET],
  ['PE_canonical_binding_score', (p) => p.best.scores.PE],
  ['PP_canonical_binding_score', (p) => p.best.scores.PP],
  ['objective', (p) => p.best.objective],
  ['mean_offtarget', (p) => p.best.metrics.meanOffTarget],
  ['worst_offtarget', (p) => p.best.metrics.worstOffTarget],
  ['margin_mean', (p) => p.best.metrics.marginMean],
  ['margin_worst', (p) => p.best.metrics.marginWorst],
  ['penalty_P', (p) => p.penalty],
  ['runtime_seconds', (p) => p.runtimeMs / 1000],
  ['optimum_hits', (p) => p.optimumHits],
];

describe('sweepToCsv', () => {
  const csv = sweepToCsv(RECORD);
  const parsed = table(csv);

  it('declares the sweep header the task specifies', () => {
    expect(parsed.header).toEqual([...SWEEP_CSV_HEADER]);
    expect(parsed.header).toHaveLength(14);
    for (const required of [
      'lambda',
      'class_sequence',
      'PET_canonical_binding_score',
      'PE_canonical_binding_score',
      'PP_canonical_binding_score',
      'objective',
      'margin_mean',
      'margin_worst',
      'penalty_P',
      'runtime_seconds',
      'optimum_hits',
    ]) {
      expect(parsed.header, required).toContain(required);
    }
  });

  it('shares its score column names with the candidate export', () => {
    for (const name of [
      'class_sequence',
      'representative_aa_sequence',
      'PET_canonical_binding_score',
      'PE_canonical_binding_score',
      'PP_canonical_binding_score',
      'objective',
      'mean_offtarget',
      'worst_offtarget',
      'margin_mean',
      'margin_worst',
    ]) {
      expect(CANDIDATE_CSV_HEADER, name).toContain(name);
      expect(SWEEP_CSV_HEADER, name).toContain(name);
    }
  });

  it('writes one row per sweep point', () => {
    expect(parsed.rows).toHaveLength(RECORD.sweep.length);
    for (const row of parsed.rows) expect(row).toHaveLength(SWEEP_CSV_HEADER.length);
    expect(table(sweepToCsv(EMPTY_RECORD)).rows).toHaveLength(0);
  });

  it('round-trips every numeric cell exactly', () => {
    for (let r = 0; r < RECORD.sweep.length; r += 1) {
      const point = RECORD.sweep[r];
      for (const [name, pick] of SWEEP_NUMERIC) {
        const cell = parsed.rows[r][column(parsed.header, name)];
        expect(Number(cell), `${name} row ${r}`).toBe(pick(point));
      }
    }
  });

  it('reports runtime in seconds, converted not rounded', () => {
    const runtime = column(parsed.header, 'runtime_seconds');
    for (let r = 0; r < RECORD.sweep.length; r += 1) {
      const cell = parsed.rows[r][runtime];
      expect(cell).toBe(String(RECORD.sweep[r].runtimeMs / 1000));
      expect(cell).not.toBe(String(RECORD.sweep[r].runtimeMs));
      expect(Number(cell) * 1000).toBeCloseTo(RECORD.sweep[r].runtimeMs, 9);
    }
  });

  it('names the winning design for each lambda', () => {
    const lam = column(parsed.header, 'lambda');
    const seq = column(parsed.header, 'class_sequence');
    for (let r = 0; r < RECORD.sweep.length; r += 1) {
      expect(parsed.rows[r][lam]).toBe(String(RECORD.sweep[r].lambda));
      expect(parsed.rows[r][seq]).toBe(RECORD.sweep[r].best.classSequence);
    }
  });
});

/* ------------------------------------------------------------------ *
 * solversToCsv
 * ------------------------------------------------------------------ */

describe('solversToCsv', () => {
  const csv = solversToCsv(RECORD);
  const parsed = table(csv);

  it('declares the solver header including status and note', () => {
    expect(parsed.header).toEqual([...SOLVER_CSV_HEADER]);
    expect(parsed.header).toHaveLength(14);
    expect(parsed.header).toContain('status');
    expect(parsed.header).toContain('note');
    expect(parsed.header).toContain('exact');
  });

  it('keeps one row per solver, including the ones that did not run', () => {
    expect(parsed.rows).toHaveLength(RECORD.solvers.length);
    const solver = column(parsed.header, 'solver');
    const status = column(parsed.header, 'status');
    for (let r = 0; r < RECORD.solvers.length; r += 1) {
      expect(parsed.rows[r][solver]).toBe(RECORD.solvers[r].solver);
      expect(parsed.rows[r][status]).toBe(RECORD.solvers[r].status);
    }
    expect(parsed.rows.map((r) => r[status])).toEqual([
      'EXECUTED',
      'EXECUTED',
      'NOT EXECUTED',
      'SKIPPED',
    ]);
  });

  it('writes measured values for the solvers that ran', () => {
    const obj = column(parsed.header, 'best_objective');
    const validity = column(parsed.header, 'validity_rate');
    const success = column(parsed.header, 'success_rate');
    const runtime = column(parsed.header, 'runtime_seconds');
    const reads = column(parsed.header, 'reads');
    const median = column(parsed.header, 'median_best_energy');
    const std = column(parsed.header, 'std_best_energy');
    const seed = column(parsed.header, 'seed');

    expect(Number(parsed.rows[0][obj])).toBe(RECORD.solvers[0].bestObjective);
    expect(Number(parsed.rows[0][validity])).toBe(1);
    expect(Number(parsed.rows[0][success])).toBe(1);
    expect(parsed.rows[0][runtime]).toBe(String(726.4297000001534 / 1000));
    expect(parsed.rows[0][reads]).toBe('');
    expect(parsed.rows[0][seed]).toBe('');

    expect(Number(parsed.rows[1][obj])).toBe(RECORD.solvers[1].bestObjective);
    expect(parsed.rows[1][success]).toBe('0');
    expect(Number(parsed.rows[1][reads])).toBe(1500);
    expect(Number(parsed.rows[1][median])).toBe(-34.39016662834911);
    expect(Number(parsed.rows[1][std])).toBe(1.4214462645750976);
    expect(parsed.rows[1][seed]).toBe('42');
  });

  it('leaves every missing measurement EMPTY, never null/undefined/0', () => {
    const nullable = [
      'best_objective',
      'class_sequence',
      'validity_rate',
      'success_rate',
      'runtime_seconds',
      'seed',
      'reads',
      'median_best_energy',
      'std_best_energy',
    ];
    const notRun = parsed.rows[2];
    for (const name of nullable) {
      const cell = notRun[column(parsed.header, name)];
      expect(cell, name).toBe('');
      expect(cell, name).not.toBe('null');
      expect(cell, name).not.toBe('undefined');
      expect(cell, name).not.toBe('0');
      expect(cell, name).not.toBe(NOT_AVAILABLE);
    }
    // A real zero must still be written as a zero, not confused with missing.
    expect(parsed.rows[3][column(parsed.header, 'reads')]).toBe('0');
    expect(parsed.rows[3][column(parsed.header, 'seed')]).toBe('7');
    expect(parsed.rows[3][column(parsed.header, 'best_objective')]).toBe('');
  });

  it('writes the exact flag as a boolean word', () => {
    const exact = column(parsed.header, 'exact');
    expect(parsed.rows[0][exact]).toBe('true');
    expect(parsed.rows[1][exact]).toBe('false');
    expect(parsed.rows[2][exact]).toBe('false');
    expect(parsed.rows[3][exact]).toBe('false');
  });

  it('carries the note text and neutralises a note that starts with CR', () => {
    const note = column(parsed.header, 'note');
    expect(parsed.rows[0][note]).toBe(RECORD.solvers[0].note);
    expect(parsed.rows[0][note]).toContain('1,679,616');
    expect(csv).toContain('"Exhaustive over all 1,679,616 valid sequences, so the optimum is proven."');

    expect(parsed.rows[1][note]).toBe("'-2 runs ended on a tie; see median_best_energy");
    expect(parsed.rows[1][note].startsWith('-')).toBe(false);

    expect(parsed.rows[2][note]).toContain('NO QUANTUM HARDWARE EXECUTION');

    expect(parsed.rows[3][note].startsWith("'\r")).toBe(true);
    expect(csv).toContain('"\'\rSkipped on a low-power device');
  });

  it('keeps the no-quantum row in the file so the absence is on the record', () => {
    const solver = column(parsed.header, 'solver');
    const quantum = parsed.rows.find((r) => r[solver].includes('Quantum'));
    expect(quantum).toBeDefined();
    expect(quantum?.[column(parsed.header, 'status')]).toBe('NOT EXECUTED');
    expect(quantum?.[column(parsed.header, 'best_objective')]).toBe('');
  });

  it('emits a header-only document when no solver ran', () => {
    expect(solversToCsv(EMPTY_RECORD)).toBe(`${SOLVER_CSV_HEADER.join(',')}${CSV_EOL}`);
  });
});

/* ------------------------------------------------------------------ *
 * surrogatesToCsv
 * ------------------------------------------------------------------ */

const SURROGATE_NUMERIC: ReadonlyArray<[string, (s: SurrogateReport) => number]> = [
  ['ridge_alpha', (s) => s.alpha],
  ['seed', (s) => s.seed],
  ['train_samples', (s) => s.train.count],
  ['train_r2', (s) => s.train.r2],
  ['train_rmse', (s) => s.train.rmse],
  ['train_mae', (s) => s.train.mae],
  ['train_max_abs_error', (s) => s.train.maxAbsError],
  ['validation_samples', (s) => s.validation.count],
  ['validation_r2', (s) => s.validation.r2],
  ['validation_rmse', (s) => s.validation.rmse],
  ['validation_mae', (s) => s.validation.mae],
  ['validation_max_abs_error', (s) => s.validation.maxAbsError],
  ['test_samples', (s) => s.test.count],
  ['test_r2', (s) => s.test.r2],
  ['test_rmse', (s) => s.test.rmse],
  ['test_mae', (s) => s.test.mae],
  ['test_max_abs_error', (s) => s.test.maxAbsError],
  ['fit_seconds', (s) => s.fitMs / 1000],
];

describe('surrogatesToCsv', () => {
  const csv = surrogatesToCsv(RECORD);
  const parsed = table(csv);

  it('declares the surrogate header with the three splits kept apart', () => {
    expect(parsed.header).toEqual([...SURROGATE_CSV_HEADER]);
    expect(parsed.header).toHaveLength(20);
    for (const split of ['train', 'validation', 'test']) {
      for (const metric of ['samples', 'r2', 'rmse', 'mae', 'max_abs_error']) {
        expect(parsed.header, `${split}_${metric}`).toContain(`${split}_${metric}`);
      }
    }
  });

  it('writes one row per plastic', () => {
    expect(parsed.rows).toHaveLength(3);
    const plastic = column(parsed.header, 'plastic');
    expect(parsed.rows.map((r) => r[plastic])).toEqual(['PET', 'PE', 'PP']);
    for (const row of parsed.rows) expect(row).toHaveLength(SURROGATE_CSV_HEADER.length);
  });

  it('round-trips every numeric diagnostic exactly', () => {
    for (let r = 0; r < RECORD.surrogates.length; r += 1) {
      const report = RECORD.surrogates[r];
      for (const [name, pick] of SURROGATE_NUMERIC) {
        const cell = parsed.rows[r][column(parsed.header, name)];
        expect(Number(cell), `${name} row ${r}`).toBe(pick(report));
      }
    }
  });

  it('keeps tiny exponents in exponential form rather than flattening them to 0', () => {
    const rmse = column(parsed.header, 'train_rmse');
    expect(parsed.rows[0][rmse]).toBe('4.9887034010630905e-8');
    expect(Number(parsed.rows[0][rmse])).toBeGreaterThan(0);
    const maxAbs = column(parsed.header, 'test_max_abs_error');
    expect(Number(parsed.rows[0][maxAbs])).toBe(2.220446049250313e-16);
    expect(parsed.rows[0][maxAbs]).not.toBe('0');
  });

  it('writes splits_disjoint as a boolean per row', () => {
    const disjoint = column(parsed.header, 'splits_disjoint');
    expect(parsed.rows[0][disjoint]).toBe('true');
    expect(parsed.rows[1][disjoint]).toBe('true');
    expect(parsed.rows[2][disjoint]).toBe('false');
  });

  it('emits a header-only document when the surrogate stage was skipped', () => {
    expect(surrogatesToCsv(EMPTY_RECORD)).toBe(`${SURROGATE_CSV_HEADER.join(',')}${CSV_EOL}`);
  });
});

/* ------------------------------------------------------------------ *
 * runToJson
 * ------------------------------------------------------------------ */

describe('runToJson', () => {
  const json = runToJson(RECORD);
  const back = JSON.parse(json) as RunRecord;

  it('is pretty-printed and parseable', () => {
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  "runId"');
    expect(json.endsWith('\n')).toBe(true);
    expect(json.split('\n').length).toBeGreaterThan(50);
  });

  it('preserves the provenance fields verbatim', () => {
    expect(back.runId).toBe('run-2026-abc');
    expect(back.quantumHardware).toBe('NO QUANTUM HARDWARE EXECUTION');
    expect(back.modelSource).toBe(RECORD.modelSource);
    expect(back.startedAtIso).toBe('2026-10-09T08:15:30.250Z');
    expect(back.mode).toBe('live');
    expect(back.totalMs).toBe(4096.5);
    expect(back.environment.userAgent).toBe(RECORD.environment.userAgent);
    expect(back.environment.hardwareConcurrency).toBe(8);
    expect(back.environment.deviceMemoryGb).toBeNull();
  });

  it('preserves the seed and the lambda', () => {
    expect(back.config.seed).toBe(1337);
    expect(back.config.lambda).toBe(0.5);
    expect(back.config.sweepLambdas).toEqual([0, 0.5, 1, 2, 5]);
    expect(back.config.tolerance).toBe(1e-8);
    expect(back.config.penaltyMultiplier).toBe(2);
    expect(back.config.surrogate.alpha).toBe(1e-6);
    expect(back.config.annealing.sweeps).toBe(120);
  });

  it('preserves the timings map, missing stages included', () => {
    expect(back.timings.enumeration).toBe(310.5);
    expect(back.timings.scoring).toBe(1204.25);
    expect(back.timings.solving).toBe(726.4297000001534);
    expect(back.timings.surrogate).toBeUndefined();
    expect(Object.keys(back.timings)).toHaveLength(3);
  });

  it('round-trips every candidate number bit-for-bit', () => {
    expect(back.candidates).toHaveLength(RECORD.candidates.length);
    for (let i = 0; i < RECORD.candidates.length; i += 1) {
      const a = RECORD.candidates[i];
      const b = back.candidates[i];
      expect(b.scores.PET).toBe(a.scores.PET);
      expect(b.scores.PE).toBe(a.scores.PE);
      expect(b.scores.PP).toBe(a.scores.PP);
      expect(b.objective).toBe(a.objective);
      expect(b.rank).toBe(a.rank);
      expect(b.codes).toEqual(a.codes);
      expect(b.metrics.warnings).toBe(a.metrics.warnings);
    }
  });

  it('round-trips the whole record deeply', () => {
    expect(back).toEqual(RECORD);
    expect(back.sweep).toHaveLength(5);
    expect(back.solvers).toHaveLength(4);
    expect(back.surrogates).toHaveLength(3);
    expect(back.verify?.sampleSize).toBe(500);
    expect(back.verify?.penaltyBound).toBe(5667.724205981706);
    expect(back.stats.PET.max).toBe(41.00083330563526);
    expect(back.searchSpace.validSequences).toBe(1679616);
  });

  it('keeps a null as a null rather than inventing a value', () => {
    const emptyBack = JSON.parse(runToJson(EMPTY_RECORD)) as RunRecord;
    expect(emptyBack.verify).toBeNull();
    expect(emptyBack.candidates).toEqual([]);
    expect(emptyBack.solvers).toEqual([]);
    expect(emptyBack.environment.deviceMemoryGb).toBeNull();
    expect(emptyBack.config.seed).toBe(0);
    expect(emptyBack.config.lambda).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * runToMarkdownReport
 * ------------------------------------------------------------------ */

describe('runToMarkdownReport', () => {
  const md = runToMarkdownReport(RECORD);

  it('has the sections a reader needs', () => {
    expect(md.startsWith('# QBind Select - run report')).toBe(true);
    for (const heading of [
      '## Provenance',
      '### Stage timings',
      '## What this is not',
      '## What each number means',
      '## Search space',
      '## Top candidates',
      '## Selectivity priority sweep',
      '## Solver comparison',
      '## Surrogate model checks',
      '## Verification checks',
      '## How to reproduce this run',
    ]) {
      expect(md, heading).toContain(heading);
    }
  });

  it('states the provenance without inventing anything', () => {
    expect(md).toContain('run-2026-abc');
    expect(md).toContain('2026-10-09T08:15:30.250Z');
    expect(md).toContain('QA-PBP-RL-Nexus potts_6class_8mer.json');
    expect(md).toContain('Mozilla/5.0 (Test, rv:1.0) Vitest/2, jsdom');
    expect(md).toContain('| Total runtime (seconds) | 4.0965 |');
    expect(md).toContain(`| Device memory (GB) | ${NOT_AVAILABLE} |`);
  });

  it('carries every honesty statement verbatim', () => {
    for (const [key, text] of Object.entries(HONESTY)) {
      expect(md, key).toContain(text);
    }
    expect(md).toContain('NO QUANTUM HARDWARE EXECUTION');
    expect(md).toContain(HONESTY.noQuantumDetail);
    expect(md).toContain(HONESTY.noLab);
    expect(md).toContain('Nothing here has been tested in a laboratory');
  });

  it('defines every metric with its direction', () => {
    for (const metric of Object.values(METRIC_HELP)) {
      expect(md, metric.label).toContain(metric.label);
      expect(md, metric.label).toContain(metric.plain);
      expect(md, metric.label).toContain(`| ${metric.label} | ${metric.direction} |`);
    }
    expect(md).toContain('higher is better');
    expect(md).toContain('lower is better');
    expect(md).toContain('it is MINIMISED');
  });

  it('names every pipeline stage and marks the untimed ones NOT AVAILABLE', () => {
    for (const stage of STAGES) {
      expect(md, stage.title).toContain(stage.title);
      expect(md, stage.pythonRef).toContain(stage.pythonRef);
    }
    expect(md).toContain('| 2 | List every possible design |');
    expect(md).toContain('0.3105');
    expect(md).toContain(`| ${NOT_AVAILABLE} |`);
    const untimed = STAGES.filter((s) => RECORD.timings[s.id] === undefined);
    expect(untimed.length).toBe(STAGES.length - 3);
  });

  it('shows the real search space, not a rounded one', () => {
    expect(md).toContain('| Valid sequences | 1679616 |');
    expect(md).toContain('| Binary variables | 48 |');
    expect(md).toContain('| Positions | 8 |');
    expect(md).toContain('| Classes per position | 6 |');
  });

  it('escapes table-hostile text instead of breaking the table', () => {
    expect(md).not.toContain('first line\nsecond line');
    expect(md).toContain('first line second line');
    const tableLines = md.split('\n').filter((l) => l.startsWith('|'));
    for (const line of tableLines) expect(line.endsWith('|')).toBe(true);
    expect(tableLines.length).toBeGreaterThan(40);
  });

  it('lists the candidates with their ranks and labels', () => {
    for (const c of RECORD.candidates) {
      expect(md, c.classSequence).toContain(c.classSequence);
      expect(md, c.representative).toContain(c.representative);
    }
    expect(md).toContain('Ranking solver: Brute force.');
    expect(md).toContain('BALANCED');
  });

  it('warns that objectives at different lambda are not comparable', () => {
    expect(md).toContain('NOT comparable');
    expect(md).toContain('| Penalty P | Seconds | Optimum hits |');
    expect(md).toContain('4775.078957067153');
  });

  it('reports solver status and notes, including the one that never ran', () => {
    expect(md).toContain('| Brute force | 1 | EXECUTED |');
    expect(md).toContain('Quantum annealer (D-Wave)');
    expect(md).toContain('| NOT EXECUTED |');
    expect(md).toContain('SKIPPED');
  });

  it('names the seed and the lambda in the reproduction recipe', () => {
    const section = md.slice(md.indexOf('## How to reproduce this run'));
    expect(section).toContain('| Random seed | 1337 |');
    expect(section).toContain('| Selectivity priority (lambda) | 0.5 |');
    expect(section).toContain('| Swept lambda values | 0 0.5 1 2 5 |');
    expect(section).toContain('set the seed to `1337`');
    expect(section).toContain('set the selectivity priority (lambda) to `0.5`');
    expect(section).toContain('QA-PBP-RL-Nexus potts_6class_8mer.json');
    expect(section).toContain('NO QUANTUM HARDWARE EXECUTION');
    expect(section).toContain('| Surrogate train / validation / test sizes | 12000 / 3000 / 3000 |');
    expect(section).toContain('| Annealing reads / sweeps / runs | 40 / 120 / 3 |');
    expect(section).toContain('| Comparison tolerance | 1e-8 |');
  });

  it('reports the verification pass when there is one', () => {
    expect(md).toContain('| Sampled sequences | 500 |');
    expect(md).toContain('| Encode/decode round trips | 500 |');
    expect(md).toContain('| Invalid assignments correctly penalised | 120 |');
    expect(md).toContain('| Penalty bound P | 5667.724205981706 |');
    expect(md).toContain('7.275957614183426e-12');
  });

  it('says plainly when a section has nothing to report', () => {
    const empty = runToMarkdownReport(EMPTY_RECORD);
    expect(empty).toContain(`${NOT_AVAILABLE}: no verification pass was run for this record.`);
    expect(empty).toContain(`${NOT_AVAILABLE}: the surrogate stage did not run in this session.`);
    expect(empty).toContain('| Random seed | 0 |');
    expect(empty).toContain('NO QUANTUM HARDWARE EXECUTION');
    expect(empty).toContain(HONESTY.noLab);
    // An empty candidate table must still have a row, saying it is empty.
    expect(empty).toContain(`| ${NOT_AVAILABLE} | ${NOT_AVAILABLE} |`);
    expect(empty).not.toContain('undefined');
  });

  it('never writes the word undefined', () => {
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('| null |');
    expect(md.endsWith('\n')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * svgToString
 * ------------------------------------------------------------------ */

describe('svgToString', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function buildSvg(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('width', '100');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', '10');
    rect.setAttribute('height', '20');
    svg.appendChild(rect);
    const text = document.createElementNS(SVG_NS, 'text');
    text.textContent = 'PET score';
    svg.appendChild(text);
    return svg;
  }

  it('returns null for null and undefined', () => {
    expect(svgToString(null)).toBeNull();
    expect(svgToString(undefined)).toBeNull();
  });

  it('serialises a real SVG with an xmlns and an XML declaration', () => {
    const out = svgToString(buildSvg());
    expect(out).not.toBeNull();
    const text = out as string;
    expect(text).toContain('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    expect(text).toContain(`xmlns="${SVG_NS}"`);
    expect(text).toContain('viewBox="0 0 100 40"');
    expect(text).toContain('<rect');
    expect(text).toContain('PET score');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('declares xmlns exactly once', () => {
    const text = svgToString(buildSvg()) as string;
    const matches = text.match(/xmlns="/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('does not mutate the live DOM node', () => {
    const svg = buildSvg();
    svgToString(svg);
    expect(svg.getAttribute('xmlns')).toBeNull();
    expect(svg.getAttribute('xmlns:xlink')).toBeNull();
    expect(svg.childNodes).toHaveLength(2);
  });

  it('adds the namespace when the serialiser omits it', () => {
    class BareSerializer {
      serializeToString(): string {
        return '<svg width="10"><rect width="1"/></svg>';
      }
    }
    vi.stubGlobal('XMLSerializer', BareSerializer);
    const text = svgToString(buildSvg()) as string;
    expect(text).toContain(`<svg xmlns="${SVG_NS}" width="10">`);
    expect(text).toContain('<rect width="1"/>');
    expect((text.match(/xmlns="/g) ?? [])).toHaveLength(1);
  });

  it('adds xmlns:xlink only when the markup uses xlink', () => {
    class XlinkSerializer {
      serializeToString(): string {
        return '<svg width="10"><use xlink:href="#a"/></svg>';
      }
    }
    vi.stubGlobal('XMLSerializer', XlinkSerializer);
    const withXlink = svgToString(buildSvg()) as string;
    expect(withXlink).toContain(`xmlns:xlink="${XLINK_NS}"`);
    expect(withXlink).toContain(`xmlns="${SVG_NS}"`);

    vi.unstubAllGlobals();
    const plain = svgToString(buildSvg()) as string;
    expect(plain).not.toContain('xmlns:xlink');
  });

  it('leaves an existing xmlns alone', () => {
    class NamespacedSerializer {
      serializeToString(): string {
        return `<svg xmlns="${SVG_NS}" width="10"/>`;
      }
    }
    vi.stubGlobal('XMLSerializer', NamespacedSerializer);
    const text = svgToString(buildSvg()) as string;
    expect((text.match(/xmlns="/g) ?? [])).toHaveLength(1);
    expect(text).toContain(`<svg xmlns="${SVG_NS}" width="10"/>`);
  });
});

/* ------------------------------------------------------------------ *
 * sanitiseFilename and safeFilename
 * ------------------------------------------------------------------ */

describe('sanitiseFilename', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['report.csv', 'report.csv'],
    ['top candidates', 'top-candidates'],
    ['a/b/c', 'a-b-c'],
    ['a\\b\\c', 'a-b-c'],
    ['../secret', 'secret'],
    ['..\\..\\windows\\system32', 'windows-system32'],
    ['....//....//etc/passwd', 'etc-passwd'],
    ['.hidden', 'hidden'],
    ['...dots', 'dots'],
    ['trailing...', 'trailing'],
    ['caf\u00e9', 'caf'],
    ['\u6f22\u5b57', ''],
    ['tab\there', 'tab-here'],
    ['new\nline', 'new-line'],
    ['null\u0000byte', 'null-byte'],
    ['semi;colon', 'semi-colon'],
    ['quote"mark', 'quote-mark'],
    ['star*and?mark', 'star-and-mark'],
    ['colon:name', 'colon-name'],
    ['pipe|name', 'pipe-name'],
    ['', ''],
    ['____', ''],
    ['already-safe_NAME.1', 'already-safe_NAME.1'],
  ];

  it.each(cases)('sanitises %j', (input, expected) => {
    expect(sanitiseFilename(input)).toBe(expected);
  });

  it('never leaves a path separator, a parent sequence or a leading dot', () => {
    for (const [input] of cases) {
      const out = sanitiseFilename(input);
      expect(out, input).not.toContain('/');
      expect(out, input).not.toContain('\\');
      expect(out, input).not.toContain('..');
      expect(out, input).not.toContain(' ');
      expect(out.startsWith('.'), input).toBe(false);
      expect(/^[A-Za-z0-9._-]*$/.test(out), input).toBe(true);
    }
  });
});

describe('safeFilename', () => {
  it('carries the lambda and the seed', () => {
    expect(safeFilename('top candidates', RECORD, 'csv')).toBe(
      'top-candidates_lambda0.5_seed1337.csv',
    );
    expect(safeFilename('run-record', RECORD, 'json')).toBe('run-record_lambda0.5_seed1337.json');
    expect(safeFilename('report', EMPTY_RECORD, 'md')).toBe('report_lambda0_seed0.md');
  });

  it('works without an extension', () => {
    const name = safeFilename('bundle', RECORD);
    expect(name).toBe('bundle_lambda0.5_seed1337');
    expect(name).not.toContain('.csv');
  });

  it('reflects a changed lambda or seed', () => {
    const other: RunRecord = { ...RECORD, config: { ...CONFIG, lambda: 2, seed: 7 } };
    expect(safeFilename('x', other, 'csv')).toBe('x_lambda2_seed7.csv');
    const fractional: RunRecord = { ...RECORD, config: { ...CONFIG, lambda: 1 / 3, seed: 42 } };
    expect(safeFilename('x', fractional, 'csv')).toBe(
      `x_lambda${String(1 / 3)}_seed42.csv`.replace('+', ''),
    );
  });

  it('keeps a negative lambda readable and filename-safe', () => {
    const negative: RunRecord = { ...RECORD, config: { ...CONFIG, lambda: -1.5, seed: -9 } };
    const name = safeFilename('x', negative, 'csv');
    expect(name).toBe('x_lambdaneg1.5_seedneg9.csv');
    expect(name.startsWith('-')).toBe(false);
    expect(/^[A-Za-z0-9._-]+$/.test(name)).toBe(true);
  });

  it('rejects traversal in every spelling', () => {
    const hostile = [
      '../../etc/passwd',
      '..\\..\\Windows\\System32\\config',
      '/absolute/path',
      'C:\\Users\\User\\secret',
      './relative',
      '....//....//escape',
      'name/../../other',
      '..',
      '.',
      '...',
    ];
    for (const base of hostile) {
      const name = safeFilename(base, RECORD, 'csv');
      expect(name, base).not.toContain('..');
      expect(name, base).not.toContain('/');
      expect(name, base).not.toContain('\\');
      expect(name, base).not.toContain(':');
      expect(name.startsWith('.'), base).toBe(false);
      expect(name.endsWith('.csv'), base).toBe(true);
      expect(/^[A-Za-z0-9._-]+$/.test(name), base).toBe(true);
    }
  });

  it('falls back to a usable stem when the base sanitises away', () => {
    for (const base of ['', '..', '///', '\u6f22\u5b57', '____', '...']) {
      const name = safeFilename(base, RECORD, 'csv');
      expect(name, base).toContain('lambda0.5');
      expect(name, base).toContain('seed1337');
      expect(name.length, base).toBeGreaterThan(10);
      expect(name.startsWith('_'), base).toBe(false);
    }
    expect(safeFilename('', RECORD, 'csv')).toBe('qbind-export_lambda0.5_seed1337.csv');
  });

  it('strips spaces and unicode out of the stem', () => {
    const name = safeFilename('  my \u00e9xport  file \u2014 2026  ', RECORD, 'csv');
    expect(name).not.toContain(' ');
    expect(name).not.toContain('\u00e9');
    expect(name).not.toContain('\u2014');
    expect(name).toBe('my-xport-file-2026_lambda0.5_seed1337.csv');
  });

  it('caps a very long name without losing the lambda, the seed or the extension', () => {
    const name = safeFilename('x'.repeat(5000), RECORD, 'csv');
    expect(name.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(name.endsWith('_lambda0.5_seed1337.csv')).toBe(true);
    expect(name.startsWith('xxx')).toBe(true);
    expect(/^[A-Za-z0-9._-]+$/.test(name)).toBe(true);

    const longExt = safeFilename('data', RECORD, 'c'.repeat(300));
    expect(longExt.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
  });

  it('produces a distinct name per artefact of the same run', () => {
    const names = buildExportBundle(RECORD).map((a) => a.filename);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toContain('_lambda0.5_seed1337.');
      expect(name.length, name).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Blobs and the single DOM side effect
 * ------------------------------------------------------------------ */

describe('toBlob', () => {
  it('uses the mime type it is given', () => {
    expect(toBlob('a,b\r\n', CSV_MIME).type).toBe(CSV_MIME);
    expect(toBlob('{}', JSON_MIME).type).toBe(JSON_MIME);
    expect(toBlob('# hi', MARKDOWN_MIME).type).toBe(MARKDOWN_MIME);
    expect(toBlob('plain').type).toBe('text/plain;charset=utf-8');
  });

  /** jsdom's Blob has no `.text()`, so read it the way a browser without it would. */
  function readBlobText(blob: Blob): Promise<string> {
    if (typeof blob.text === 'function') return blob.text();
    return new Promise<string>((resolveText, rejectText) => {
      const reader = new FileReader();
      reader.onload = () => resolveText(String(reader.result));
      reader.onerror = () => rejectText(reader.error ?? new Error('FileReader failed'));
      reader.readAsText(blob);
    });
  }

  it('writes the exact bytes, with no byte-order mark', async () => {
    const csv = candidatesToCsv(RECORD);
    const blob = toBlob(csv, CSV_MIME);
    const text = await readBlobText(blob);
    expect(text).toBe(csv);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(blob.size).toBe(new TextEncoder().encode(csv).byteLength);
  });

  it('handles an empty string', () => {
    const blob = toBlob('', CSV_MIME);
    expect(blob.size).toBe(0);
  });
});

describe('triggerDownload', () => {
  const original = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = original;
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevoke;
  });

  it('reports false when the environment cannot create an object URL', () => {
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined;
    expect(triggerDownload('x.csv', toBlob('a', CSV_MIME))).toBe(false);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('clicks a hidden anchor with a sanitised download name and cleans up', () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;

    let seen: { name: string; href: string; attached: boolean; display: string } | null = null;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        seen = {
          name: this.download,
          href: this.getAttribute('href') ?? '',
          attached: document.body.contains(this),
          display: this.style.display,
        };
      });

    const blob = toBlob(candidatesToCsv(RECORD), CSV_MIME);
    const ok = triggerDownload('../../top candidates.csv', blob);

    expect(ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(seen).not.toBeNull();
    const captured = seen as unknown as {
      name: string;
      href: string;
      attached: boolean;
      display: string;
    };
    expect(captured.name).toBe('top-candidates.csv');
    expect(captured.name).not.toContain('..');
    expect(captured.name).not.toContain('/');
    expect(captured.name).not.toContain(' ');
    expect(captured.href).toBe('blob:fake-url');
    expect(captured.attached).toBe(true);
    expect(captured.display).toBe('none');

    // The anchor must not survive the call.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);

    // The object URL is released on the next tick, not synchronously.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('falls back to a usable name when the filename sanitises away', () => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:x');
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    let name = 'unset';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    expect(triggerDownload('..', toBlob('a'))).toBe(true);
    expect(name).toBe('download');
    vi.advanceTimersByTime(1);
  });
});

/* ------------------------------------------------------------------ *
 * buildExportBundle
 * ------------------------------------------------------------------ */

describe('buildExportBundle', () => {
  const bundle = buildExportBundle(RECORD);

  it('produces one artefact per export format', () => {
    expect(bundle).toHaveLength(6);
    expect(bundle.map((a) => a.mime)).toEqual([
      CSV_MIME,
      CSV_MIME,
      CSV_MIME,
      CSV_MIME,
      JSON_MIME,
      MARKDOWN_MIME,
    ]);
  });

  it('matches what the individual builders return', () => {
    expect(bundle[0].text).toBe(candidatesToCsv(RECORD));
    expect(bundle[1].text).toBe(sweepToCsv(RECORD));
    expect(bundle[2].text).toBe(solversToCsv(RECORD));
    expect(bundle[3].text).toBe(surrogatesToCsv(RECORD));
    expect(bundle[4].text).toBe(runToJson(RECORD));
    expect(bundle[5].text).toBe(runToMarkdownReport(RECORD));
  });

  it('is deterministic for the same record', () => {
    const again = buildExportBundle(RECORD);
    for (let i = 0; i < bundle.length; i += 1) {
      expect(again[i].filename).toBe(bundle[i].filename);
      expect(again[i].text).toBe(bundle[i].text);
    }
  });

  it('gives every artefact a non-empty body ending in a newline', () => {
    for (const artefact of bundle) {
      expect(artefact.text.length, artefact.filename).toBeGreaterThan(0);
      expect(artefact.text.endsWith('\n'), artefact.filename).toBe(true);
      expect(artefact.filename, artefact.filename).not.toContain(' ');
    }
  });

  it('still produces every artefact for a run with nothing in it', () => {
    const empty = buildExportBundle(EMPTY_RECORD);
    expect(empty).toHaveLength(6);
    for (const artefact of empty) {
      expect(artefact.text.length, artefact.filename).toBeGreaterThan(0);
      expect(artefact.filename, artefact.filename).toContain('_lambda0_seed0.');
    }
  });
});
