/**
 * Export layer: turns a finished {@link RunRecord} into real, downloadable
 * artefacts (CSV, JSON, Markdown, SVG).
 *
 * Design rules, all of them load-bearing:
 *
 *  - PURE. Every builder here is a string/Blob function of its arguments.
 *    {@link triggerDownload} is the single function that touches the DOM.
 *  - NOTHING IS INVENTED. A `null` field is written as an empty CSV cell or as
 *    the literal string {@link NOT_AVAILABLE} in prose. No placeholder zero, no
 *    "n/a" number, no guessed solver name, no made-up runtime.
 *  - NO ROUNDING. Numbers are written with `String(value)`, which is the
 *    shortest decimal string that round-trips to the same float64. Readability
 *    is never traded for precision inside a data file.
 *  - CSV column names mirror the published Python artefacts in `results/*.csv`,
 *    so a browser export and the benchmark output can be diffed
 *    column-for-column.
 *
 * The CSVs and the Markdown report differ deliberately in how they spell
 * "missing": a CSV cell is left EMPTY (what every spreadsheet and parser reads
 * as missing), while the report says {@link NOT_AVAILABLE} in words, because a
 * blank in prose looks like an oversight rather than a fact.
 */

import { HONESTY, METRIC_HELP } from '../content/copy';
import { STAGES } from '../workers/protocol';
import type {
  CandidateRecord,
  RunRecord,
  SolverRecord,
  SurrogateReport,
  SweepPoint,
} from '../workers/protocol';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/**
 * RFC4180 terminates records with CRLF, and the published Python artefacts in
 * `results/` are written by `csv.writer`, which also emits CRLF. Matching it
 * keeps a byte-level diff between the two meaningful.
 */
export const CSV_EOL = '\r\n';

/** Written in prose wherever a value genuinely does not exist. */
export const NOT_AVAILABLE = 'NOT AVAILABLE';

export const CSV_MIME = 'text/csv;charset=utf-8';
export const JSON_MIME = 'application/json;charset=utf-8';
export const MARKDOWN_MIME = 'text/markdown;charset=utf-8';
export const SVG_MIME = 'image/svg+xml;charset=utf-8';
export const TEXT_MIME = 'text/plain;charset=utf-8';

/** The SVG namespace a standalone `.svg` file must declare. */
export const SVG_NS = 'http://www.w3.org/2000/svg';
/** Declared only when the markup actually uses an `xlink:` attribute. */
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Hard cap on a generated filename: well under the 255-byte limit of every
 * common filesystem, and short enough to survive a browser appending " (1)".
 */
export const MAX_FILENAME_LENGTH = 120;

/**
 * Leading characters a spreadsheet may read as the start of a formula. TAB and
 * CR are included because Excel strips them and then re-reads the first
 * surviving character.
 */
export const FORMULA_LEAD_CHARS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

const FORMULA_LEAD = new Set(FORMULA_LEAD_CHARS);

/* ------------------------------------------------------------------ *
 * CSV primitives
 * ------------------------------------------------------------------ */

/** Anything a CSV cell can be built from. */
export type CsvValue = string | number | boolean | null | undefined;

/**
 * CSV injection defence.
 *
 * If free text begins with `=`, `+`, `-`, `@`, TAB or CR, a spreadsheet may
 * execute it as a formula (`=HYPERLINK(...)`, `+cmd|...`). Prefixing a single
 * quote makes the cell inert; the quote is visible in the cell but the payload
 * never runs. This matters here because warning labels and solver notes are
 * free text.
 *
 * Applied to TEXT ONLY. Numbers never pass through here: a float64 literal is
 * not a formula, and prefixing `-39.7` would destroy the exact numeric
 * round-trip that downstream analysis depends on.
 *
 * @param text raw text destined for a CSV cell
 * @returns the same text, prefixed with `'` when it starts dangerously
 */
export function neutraliseFormula(text: string): string {
  if (text.length === 0) return text;
  return FORMULA_LEAD.has(text.charAt(0)) ? `'${text}` : text;
}

/**
 * RFC4180 quoting.
 *
 * Wraps the field in double quotes when it contains a comma, a double quote,
 * CR or LF, or has leading/trailing whitespace (which a parser is free to trim
 * when the field is bare). Embedded double quotes are escaped by doubling.
 *
 * @param text text that has ALREADY been through {@link neutraliseFormula} if
 *   it is free text
 * @returns a valid RFC4180 field
 */
export function quoteCsvField(text: string): string {
  const mustQuote =
    text.includes(',') ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    /^\s/.test(text) ||
    /\s$/.test(text);
  if (!mustQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Full-precision decimal for a number. `String` emits the shortest string that
 * parses back to the identical float64, so this is lossless and never rounds.
 * Non-finite values are written `NaN` / `Infinity` / `-Infinity`, which
 * `Number()` also round-trips, rather than being silently turned into 0.
 */
export function numberToCell(value: number): string {
  return String(value);
}

/**
 * Renders one value as a finished CSV cell.
 *
 * - `null` / `undefined` -> empty cell (never `"null"`, `"undefined"` or `0`)
 * - `number` -> full precision, no formula prefix
 * - `boolean` -> `true` / `false`
 * - `string` -> injection-neutralised, then RFC4180-quoted
 */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return quoteCsvField(numberToCell(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return quoteCsvField(neutraliseFormula(value));
}

/** Joins one record's cells with commas. */
export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',');
}

/**
 * Builds a complete CSV document: the header record, one record per row, each
 * terminated by {@link CSV_EOL} (including the last, as `csv.writer` does).
 *
 * @throws Error if a row is not exactly as wide as the header. A ragged CSV is
 *   a corrupt export, and failing loudly beats shipping a file whose columns
 *   silently shift halfway down.
 */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const out: string[] = [csvRow(header)];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row.length !== header.length) {
      throw new Error(
        `export: row ${i} has ${row.length} cells but the header has ${header.length}`,
      );
    }
    out.push(csvRow(row));
  }
  return `${out.join(CSV_EOL)}${CSV_EOL}`;
}

/** Milliseconds to seconds, preserving `null`. A unit change, not a rounding. */
export function msToSeconds(ms: number | null | undefined): number | null {
  if (ms === null || ms === undefined) return null;
  return ms / 1000;
}

/* ------------------------------------------------------------------ *
 * CSV headers (mirroring results/*.csv)
 * ------------------------------------------------------------------ */

/**
 * Exactly the header of the published `results/top10_peptides.csv`, in the same
 * order, so the browser export and the Python export are comparable cell by
 * cell.
 */
export const CANDIDATE_CSV_HEADER: readonly string[] = [
  'class_sequence',
  'representative_aa_sequence',
  'PET_canonical_binding_score',
  'PE_canonical_binding_score',
  'PP_canonical_binding_score',
  'objective',
  'rank',
  'solver',
  'mean_offtarget',
  'worst_offtarget',
  'margin_mean',
  'margin_worst',
  'aromatic_fraction',
  'hydrophobic_fraction',
  'polar_fraction',
  'net_charge_class_balance',
  'warnings',
];

/** One row per swept lambda; names follow `results/selectivity_sweep.csv`. */
export const SWEEP_CSV_HEADER: readonly string[] = [
  'lambda',
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
  'penalty_P',
  'runtime_seconds',
  'optimum_hits',
];

/** One row per solver; names follow `results/solver_comparison.csv`. */
export const SOLVER_CSV_HEADER: readonly string[] = [
  'solver',
  'lambda',
  'status',
  'best_objective',
  'class_sequence',
  'validity_rate',
  'success_rate',
  'runtime_seconds',
  'seed',
  'reads',
  'median_best_energy',
  'std_best_energy',
  'exact',
  'note',
];

/** One row per fitted surrogate; names follow `results/surrogate_metrics.csv`. */
export const SURROGATE_CSV_HEADER: readonly string[] = [
  'plastic',
  'ridge_alpha',
  'seed',
  'train_samples',
  'train_r2',
  'train_rmse',
  'train_mae',
  'train_max_abs_error',
  'validation_samples',
  'validation_r2',
  'validation_rmse',
  'validation_mae',
  'validation_max_abs_error',
  'test_samples',
  'test_r2',
  'test_rmse',
  'test_mae',
  'test_max_abs_error',
  'splits_disjoint',
  'fit_seconds',
];

/* ------------------------------------------------------------------ *
 * CSV builders
 * ------------------------------------------------------------------ */

/**
 * The name of the solver that produced the candidate ranking.
 *
 * The ranking comes from the exhaustive search, so this reports the first
 * solver in the record flagged `exact` AND actually `EXECUTED`. If no such
 * solver is present the cell is left EMPTY - the name "Brute force" is never
 * invented just to fill a column.
 */
export function candidateSolverLabel(record: RunRecord): string {
  const exact = record.solvers.find((s) => s.exact && s.status === 'EXECUTED');
  return exact ? exact.solver : '';
}

function candidateRow(c: CandidateRecord, solver: string): CsvValue[] {
  return [
    c.classSequence,
    c.representative,
    c.scores.PET,
    c.scores.PE,
    c.scores.PP,
    c.objective,
    c.rank,
    solver,
    c.metrics.meanOffTarget,
    c.metrics.worstOffTarget,
    c.metrics.marginMean,
    c.metrics.marginWorst,
    c.metrics.aromaticFraction,
    c.metrics.hydrophobicFraction,
    c.metrics.polarFraction,
    c.metrics.netChargeClassBalance,
    c.metrics.warnings,
  ];
}

/**
 * CSV of `record.candidates`, one row per candidate, in the order they appear
 * in the record. This does not re-sort: a different order here could disagree
 * with the ranking the screen showed.
 *
 * Header: {@link CANDIDATE_CSV_HEADER}, identical to
 * `results/top10_peptides.csv`.
 */
export function candidatesToCsv(record: RunRecord): string {
  const solver = candidateSolverLabel(record);
  return toCsv(
    CANDIDATE_CSV_HEADER,
    record.candidates.map((c) => candidateRow(c, solver)),
  );
}

function sweepRow(p: SweepPoint): CsvValue[] {
  const b = p.best;
  return [
    p.lambda,
    b.classSequence,
    b.representative,
    b.scores.PET,
    b.scores.PE,
    b.scores.PP,
    b.objective,
    b.metrics.meanOffTarget,
    b.metrics.worstOffTarget,
    b.metrics.marginMean,
    b.metrics.marginWorst,
    p.penalty,
    msToSeconds(p.runtimeMs),
    p.optimumHits,
  ];
}

/**
 * CSV of the selectivity-priority sweep: one row per {@link SweepPoint},
 * carrying the lambda, the winning class sequence and its representative, the
 * three canonical binding scores, the objective, both margins and both
 * off-target summaries, the constraint penalty P, the measured runtime in
 * seconds and the optimum-hit count.
 *
 * Header: {@link SWEEP_CSV_HEADER}.
 */
export function sweepToCsv(record: RunRecord): string {
  return toCsv(SWEEP_CSV_HEADER, record.sweep.map(sweepRow));
}

function solverRow(s: SolverRecord): CsvValue[] {
  return [
    s.solver,
    s.lambda,
    s.status,
    s.bestObjective,
    s.classSequence,
    s.validityRate,
    s.successRate,
    msToSeconds(s.runtimeMs),
    s.seed,
    s.reads,
    s.medianBestEnergy,
    s.stdBestEnergy,
    s.exact,
    s.note,
  ];
}

/**
 * CSV of the solver comparison, one row per {@link SolverRecord}.
 *
 * `status` (`EXECUTED` / `NOT EXECUTED` / `SKIPPED`) and the free-text `note`
 * are both included: a solver that did not run keeps its row and says so,
 * rather than quietly disappearing from the comparison. Every nullable
 * measurement of a solver that did not run is an EMPTY cell.
 *
 * Header: {@link SOLVER_CSV_HEADER}.
 */
export function solversToCsv(record: RunRecord): string {
  return toCsv(SOLVER_CSV_HEADER, record.solvers.map(solverRow));
}

function surrogateRow(s: SurrogateReport): CsvValue[] {
  return [
    s.plastic,
    s.alpha,
    s.seed,
    s.train.count,
    s.train.r2,
    s.train.rmse,
    s.train.mae,
    s.train.maxAbsError,
    s.validation.count,
    s.validation.r2,
    s.validation.rmse,
    s.validation.mae,
    s.validation.maxAbsError,
    s.test.count,
    s.test.r2,
    s.test.rmse,
    s.test.mae,
    s.test.maxAbsError,
    s.splitsDisjoint,
    msToSeconds(s.fitMs),
  ];
}

/**
 * CSV of the surrogate fit diagnostics, one row per plastic, with train,
 * validation and test splits kept in separate columns so the honest held-out
 * error can never be confused with the training error.
 *
 * Header: {@link SURROGATE_CSV_HEADER}.
 */
export function surrogatesToCsv(record: RunRecord): string {
  return toCsv(SURROGATE_CSV_HEADER, record.surrogates.map(surrogateRow));
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

/**
 * Pretty-printed JSON of the WHOLE record: config (seed, lambda, swept
 * lambdas, surrogate and annealing settings), candidates, sweep, solvers,
 * surrogates, verification, stats, search space, per-stage timings, totalMs,
 * environment, modelSource, `quantumHardware` and `startedAtIso`.
 *
 * Nothing is dropped, renamed or reformatted, so `JSON.parse` returns an object
 * structurally identical to the record (within JSON's own limits: a non-finite
 * number would become `null`, which the scientific core never produces for
 * these fields).
 *
 * @returns 2-space-indented JSON terminated by a newline
 */
export function runToJson(record: RunRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/* ------------------------------------------------------------------ *
 * Markdown report
 * ------------------------------------------------------------------ */

/** Renders a value for prose: missing becomes {@link NOT_AVAILABLE}, in words. */
function prose(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  if (typeof value === 'number') return numberToCell(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return value.length === 0 ? NOT_AVAILABLE : value;
}

/** Renders a value inside a Markdown table cell (pipes and newlines escaped). */
function mdCell(value: string | number | boolean | null | undefined): string {
  return prose(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

type MdValue = string | number | boolean | null | undefined;

function mdTable(header: readonly string[], rows: readonly (readonly MdValue[])[]): string[] {
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.map(mdCell).join(' | ')} |`);
  if (rows.length === 0) lines.push(`| ${header.map(() => NOT_AVAILABLE).join(' | ')} |`);
  return lines;
}

/** `noQuantumDetail` -> `No quantum detail`. Used only for section labels. */
function humaniseKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * A readable Markdown report of the whole run.
 *
 * Contains, in order: a provenance section (run id, start time, model source,
 * environment, and the standing `NO QUANTUM HARDWARE EXECUTION` statement),
 * every honesty statement from `HONESTY` verbatim, a definition and a DIRECTION
 * ("higher is better" / "lower is better") for every metric in `METRIC_HELP`,
 * the result tables, and a "how to reproduce" section naming the exact seed and
 * the exact lambda.
 *
 * Missing values are written {@link NOT_AVAILABLE}; no number is invented to
 * fill a gap, and an absent section says why it is absent.
 */
export function runToMarkdownReport(record: RunRecord): string {
  const cfg = record.config;
  const lines: string[] = [];

  lines.push('# QBind Select - run report');
  lines.push('');
  lines.push(
    `Run \`${record.runId}\`, started ${prose(record.startedAtIso)}. Every number below was produced by the computational model described here, in this browser.`,
  );
  lines.push('');

  /* -- provenance -- */
  lines.push('## Provenance');
  lines.push('');
  lines.push(
    ...mdTable(
      ['Field', 'Value'],
      [
        ['Run id', record.runId],
        ['Started (ISO 8601)', record.startedAtIso],
        ['Mode', record.mode],
        ['Model source', record.modelSource],
        ['Quantum hardware', record.quantumHardware],
        ['Selectivity priority (lambda)', cfg.lambda],
        ['Random seed', cfg.seed],
        ['Total runtime (seconds)', msToSeconds(record.totalMs)],
        ['Browser user agent', record.environment.userAgent],
        ['Logical CPU cores', record.environment.hardwareConcurrency],
        ['Device memory (GB)', record.environment.deviceMemoryGb],
      ],
    ),
  );
  lines.push('');
  lines.push('### Stage timings');
  lines.push('');
  lines.push(
    ...mdTable(
      ['#', 'Stage', 'Python reference', 'Seconds'],
      STAGES.map((s) => [s.ordinal, s.title, s.pythonRef, msToSeconds(record.timings[s.id])]),
    ),
  );
  lines.push('');
  lines.push(
    `A stage showing ${NOT_AVAILABLE} was not timed in this run. The blank is a missing measurement, not a zero.`,
  );
  lines.push('');

  /* -- honesty -- */
  lines.push('## What this is not');
  lines.push('');
  for (const [key, text] of Object.entries(HONESTY)) {
    lines.push(`- **${humaniseKey(key)}.** ${text}`);
  }
  lines.push('');

  /* -- metric definitions -- */
  lines.push('## What each number means');
  lines.push('');
  lines.push(
    'The objective is `-PET + lambda * (PE + PP)` and it is MINIMISED, so a lower objective is better. A canonical binding score is the negative of the raw Potts energy, so a higher score means a stronger predicted interaction. Each score is the sum of 8 one-body terms and 28 two-body terms.',
  );
  lines.push('');
  lines.push(
    ...mdTable(
      ['Metric', 'Direction', 'Unit', 'Definition'],
      Object.values(METRIC_HELP).map((m) => [m.label, m.direction, m.unit, m.plain]),
    ),
  );
  lines.push('');

  /* -- search space -- */
  lines.push('## Search space');
  lines.push('');
  lines.push(
    ...mdTable(
      ['Quantity', 'Value'],
      [
        ['Positions', record.searchSpace.positions],
        ['Classes per position', record.searchSpace.classes],
        ['Binary variables', record.searchSpace.binaryVariables],
        ['Valid sequences', record.searchSpace.validSequences],
      ],
    ),
  );
  lines.push('');

  /* -- candidates -- */
  lines.push('## Top candidates');
  lines.push('');
  lines.push(
    ...mdTable(
      [
        'Rank',
        'Class sequence',
        'Representative',
        'PET',
        'PE',
        'PP',
        'Objective',
        'Margin vs worst',
        'Labels',
      ],
      record.candidates.map((c) => [
        c.rank,
        c.classSequence,
        c.representative,
        c.scores.PET,
        c.scores.PE,
        c.scores.PP,
        c.objective,
        c.metrics.marginWorst,
        c.metrics.warnings,
      ]),
    ),
  );
  lines.push('');
  lines.push(`Ranking solver: ${prose(candidateSolverLabel(record))}.`);
  lines.push('');
  lines.push(HONESTY.classNotResidue);
  lines.push('');

  /* -- sweep -- */
  lines.push('## Selectivity priority sweep');
  lines.push('');
  lines.push(
    ...mdTable(
      [
        'lambda',
        'Winning class sequence',
        'PET',
        'PE',
        'PP',
        'Objective',
        'Penalty P',
        'Seconds',
        'Optimum hits',
      ],
      record.sweep.map((p) => [
        p.lambda,
        p.best.classSequence,
        p.best.scores.PET,
        p.best.scores.PE,
        p.best.scores.PP,
        p.best.objective,
        p.penalty,
        msToSeconds(p.runtimeMs),
        p.optimumHits,
      ]),
    ),
  );
  lines.push('');
  lines.push(
    'Objectives at different lambda values are NOT comparable with each other: changing lambda changes the quantity being minimised.',
  );
  lines.push('');

  /* -- solvers -- */
  lines.push('## Solver comparison');
  lines.push('');
  lines.push(
    ...mdTable(
      [
        'Solver',
        'lambda',
        'Status',
        'Best objective',
        'Validity',
        'Success rate',
        'Seconds',
        'Note',
      ],
      record.solvers.map((s) => [
        s.solver,
        s.lambda,
        s.status,
        s.bestObjective,
        s.validityRate,
        s.successRate,
        msToSeconds(s.runtimeMs),
        s.note,
      ]),
    ),
  );
  lines.push('');

  /* -- surrogate -- */
  lines.push('## Surrogate model checks');
  lines.push('');
  if (record.surrogates.length === 0) {
    lines.push(`${NOT_AVAILABLE}: the surrogate stage did not run in this session.`);
  } else {
    lines.push(
      ...mdTable(
        [
          'Plastic',
          'Ridge alpha',
          'Train n',
          'Test n',
          'Test R2',
          'Test RMSE',
          'Test max abs error',
          'Splits disjoint',
        ],
        record.surrogates.map((s) => [
          s.plastic,
          s.alpha,
          s.train.count,
          s.test.count,
          s.test.r2,
          s.test.rmse,
          s.test.maxAbsError,
          s.splitsDisjoint,
        ]),
      ),
    );
    lines.push('');
    lines.push(HONESTY.surrogateR2);
  }
  lines.push('');

  /* -- verification -- */
  lines.push('## Verification checks');
  lines.push('');
  if (record.verify === null) {
    lines.push(`${NOT_AVAILABLE}: no verification pass was run for this record.`);
  } else {
    const v = record.verify;
    lines.push(
      ...mdTable(
        ['Check', 'Value'],
        [
          ['Sampled sequences', v.sampleSize],
          ['Verification seed', v.seed],
          ['lambda', v.lambda],
          ['Max |QUBO energy - objective|', v.maxQuboObjectiveError],
          ['Max penalty residue on valid designs', v.maxPenaltyResidue],
          ['Encode/decode round trips', v.encodeDecodeRoundTrips],
          ['Invalid assignments tested', v.invalidTested],
          ['Invalid assignments correctly penalised', v.invalidCorrectlyPenalised],
          ['Penalty bound P', v.penaltyBound],
          ['Runtime (seconds)', msToSeconds(v.runtimeMs)],
        ],
      ),
    );
  }
  lines.push('');

  /* -- reproduce -- */
  lines.push('## How to reproduce this run');
  lines.push('');
  lines.push(
    'Every random choice in this run came from one seeded generator. Re-running with the SAME seed and the SAME selectivity priority reproduces these numbers exactly; the exhaustive search does not depend on the seed at all.',
  );
  lines.push('');
  lines.push(
    ...mdTable(
      ['Setting', 'Value'],
      [
        ['Random seed', cfg.seed],
        ['Selectivity priority (lambda)', cfg.lambda],
        ['Swept lambda values', cfg.sweepLambdas.join(' ')],
        ['Candidates kept (topN)', cfg.topN],
        ['Penalty multiplier', cfg.penaltyMultiplier],
        ['Comparison tolerance', cfg.tolerance],
        ['Surrogate enabled', cfg.surrogate.enabled],
        ['Surrogate ridge alpha', cfg.surrogate.alpha],
        [
          'Surrogate train / validation / test sizes',
          `${cfg.surrogate.trainSize} / ${cfg.surrogate.validationSize} / ${cfg.surrogate.testSize}`,
        ],
        ['Annealing enabled', cfg.annealing.enabled],
        [
          'Annealing reads / sweeps / runs',
          `${cfg.annealing.reads} / ${cfg.annealing.sweeps} / ${cfg.annealing.runs}`,
        ],
        ['Model source', record.modelSource],
      ],
    ),
  );
  lines.push('');
  lines.push(
    `Steps: load the same coefficient file (\`${record.modelSource}\`), set the seed to \`${cfg.seed}\`, set the selectivity priority (lambda) to \`${cfg.lambda}\`, then run the pipeline. ${record.quantumHardware}.`,
  );
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * SVG
 * ------------------------------------------------------------------ */

function serialiseElement(element: SVGElement): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(element);
  }
  return element.outerHTML;
}

function ensureRootAttribute(markup: string, attribute: string, value: string): string {
  const close = markup.indexOf('>');
  if (close === -1) return markup;
  const head = markup.slice(0, close);
  if (new RegExp(`\\s${attribute}\\s*=`).test(head)) return markup;
  const tag = /^<([A-Za-z_][\w:.-]*)/.exec(markup);
  if (!tag) return markup;
  return `<${tag[1]} ${attribute}="${value}"${markup.slice(tag[0].length)}`;
}

/**
 * Serialises an SVG element to a standalone document string.
 *
 * An on-screen `<svg>` normally relies on the host HTML document for its
 * namespace, so a naive `outerHTML` produces a file no viewer will open. This
 * guarantees an `xmlns` on the root element (and `xmlns:xlink` only when the
 * markup actually uses an `xlink:` attribute) and prefixes an XML declaration,
 * so the result can be written straight to a `.svg` file.
 *
 * The input element is NOT mutated: the namespace is added to the serialised
 * string, never to the live DOM node.
 *
 * @returns the serialised document, or `null` if given `null`/`undefined`
 */
export function svgToString(svgElement: SVGElement | null | undefined): string | null {
  if (svgElement === null || svgElement === undefined) return null;
  let markup = serialiseElement(svgElement);
  markup = ensureRootAttribute(markup, 'xmlns', SVG_NS);
  if (/xlink:/.test(markup)) markup = ensureRootAttribute(markup, 'xmlns:xlink', XLINK_NS);
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${markup}\n`;
}

/* ------------------------------------------------------------------ *
 * Filenames
 * ------------------------------------------------------------------ */

/**
 * Reduces any string to a safe filename COMPONENT.
 *
 * Everything outside `[A-Za-z0-9._-]` becomes `-`, which removes path
 * separators, spaces, control characters and all non-ASCII text. Runs of dots
 * collapse to a single dot, so no parent-directory sequence can survive, and
 * leading/trailing separators are trimmed so the result is never a dotfile.
 * Interior dots are kept, so an extension passes through intact.
 *
 * @returns the sanitised component, possibly the empty string
 */
export function sanitiseFilename(name: string): string {
  return String(name ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-_]+/, '')
    .replace(/[.\-_]+$/, '');
}

/** Filename-safe token for a number; a leading minus becomes `neg`. */
function numberToken(value: number): string {
  const raw = String(value);
  const unsigned = raw.startsWith('-') ? `neg${raw.slice(1)}` : raw;
  return unsigned.replace(/[^A-Za-z0-9._]/g, '-');
}

/**
 * Builds the download filename for one artefact of a run.
 *
 * The lambda and the seed are baked into the name, because the quickest way to
 * corrupt a results folder is to collect files from several settings under one
 * name. The result contains no spaces, no path separator, no parent-directory
 * sequence, no leading dot and nothing outside `[A-Za-z0-9._-]`, and is capped
 * at {@link MAX_FILENAME_LENGTH} characters.
 *
 * @param base human description of the artefact, e.g. `"top candidates"`
 * @param record the run the artefact came from
 * @param extension optional extension WITHOUT the dot, e.g. `"csv"`
 */
export function safeFilename(base: string, record: RunRecord, extension?: string): string {
  const stem = sanitiseFilename(base) || 'qbind-export';
  const suffix = `_lambda${numberToken(record.config.lambda)}_seed${numberToken(record.config.seed)}`;
  const ext = extension ? `.${sanitiseFilename(extension)}` : '';
  const budget = MAX_FILENAME_LENGTH - suffix.length - ext.length;
  let head = stem;
  if (budget <= 0) head = '';
  else if (head.length > budget) head = head.slice(0, budget).replace(/[.\-_]+$/, '');
  const name = `${head}${suffix}${ext}`.replace(/^[.\-_]+/, '');
  return name.slice(0, MAX_FILENAME_LENGTH);
}

/* ------------------------------------------------------------------ *
 * Blobs and the one DOM side effect
 * ------------------------------------------------------------------ */

/**
 * Wraps text in a Blob of the given media type. UTF-8 is the Blob default and
 * no byte-order mark is added, so the bytes are exactly the string.
 */
export function toBlob(text: string, mime: string = TEXT_MIME): Blob {
  return new Blob([text], { type: mime });
}

/**
 * The ONLY function in this module that touches the DOM.
 *
 * Creates an object URL, clicks a hidden anchor, removes it, and releases the
 * URL on the next tick (releasing it synchronously can cancel the download in
 * some browsers).
 *
 * @param filename passed through {@link sanitiseFilename}, so a hostile or
 *   accidental path can never escape the downloads folder
 * @param blob the bytes to save, usually from {@link toBlob}
 * @returns `true` if a download was started, `false` in an environment with no
 *   document or no `URL.createObjectURL` (a worker, or SSR), so the caller can
 *   fall back to showing the text instead of failing silently
 */
export function triggerDownload(filename: string, blob: Blob): boolean {
  if (typeof document === 'undefined') return false;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitiseFilename(filename) || 'download';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  }, 0);
  return true;
}

/* ------------------------------------------------------------------ *
 * Convenience bundle
 * ------------------------------------------------------------------ */

/** One ready-to-download artefact. */
export interface ExportArtefact {
  readonly filename: string;
  readonly mime: string;
  readonly text: string;
}

/**
 * Builds every text artefact for a run, already named with the lambda and the
 * seed. Pure: nothing is downloaded until the caller passes an entry through
 * {@link toBlob} and {@link triggerDownload}.
 */
export function buildExportBundle(record: RunRecord): ExportArtefact[] {
  return [
    {
      filename: safeFilename('top-candidates', record, 'csv'),
      mime: CSV_MIME,
      text: candidatesToCsv(record),
    },
    {
      filename: safeFilename('selectivity-sweep', record, 'csv'),
      mime: CSV_MIME,
      text: sweepToCsv(record),
    },
    {
      filename: safeFilename('solver-comparison', record, 'csv'),
      mime: CSV_MIME,
      text: solversToCsv(record),
    },
    {
      filename: safeFilename('surrogate-metrics', record, 'csv'),
      mime: CSV_MIME,
      text: surrogatesToCsv(record),
    },
    {
      filename: safeFilename('run-record', record, 'json'),
      mime: JSON_MIME,
      text: runToJson(record),
    },
    {
      filename: safeFilename('run-report', record, 'md'),
      mime: MARKDOWN_MIME,
      text: runToMarkdownReport(record),
    },
  ];
}
