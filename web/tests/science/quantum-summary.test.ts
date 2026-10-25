/**
 * The published quantum numbers must still describe a real run.
 *
 * `src/generated/quantumBenchmark.ts` is written by
 * `scripts/export_quantum_summary.py` from `results/quantum_*.json|csv`, and
 * the Quantum screen quotes it. This file re-reads those result files and
 * requires the generated module to agree, so a stale export fails the suite
 * rather than shipping figures that no longer match any run.
 *
 * It also pins the honesty invariants that must hold whatever the numbers are:
 * no hardware execution, validity exactly 1 for the XY ansatz, and every
 * approximation ratio measured against a proven optimum.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { QUANTUM_BENCHMARK } from '../../src/generated/quantumBenchmark';

const REPO = resolve(__dirname, '..', '..', '..');

function readCsv(name: string): Record<string, string>[] {
  const text = readFileSync(resolve(REPO, 'results', name), 'utf8').trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const fields = header.split(',');
  return lines.map((line) => {
    // The result CSVs contain no quoted commas, so a plain split is correct
    // here; a quoted field would show up as a column-count mismatch below.
    const cells = line.split(',');
    expect(cells.length).toBe(fields.length);
    return Object.fromEntries(fields.map((field, index) => [field, cells[index]]));
  });
}

const metadata = JSON.parse(
  readFileSync(resolve(REPO, 'results', 'quantum_run_metadata.json'), 'utf8'),
) as Record<string, unknown>;

describe('generated quantum summary is in sync with results/', () => {
  it('declares its schema and provenance', () => {
    expect(QUANTUM_BENCHMARK.schema).toBe('qbind-select/quantum-benchmark/1');
    expect(QUANTUM_BENCHMARK.generatedBy).toBe('scripts/export_quantum_summary.py');
    expect(QUANTUM_BENCHMARK.sourceChecksumSha256).toBe(metadata.source_checksum);
    expect(QUANTUM_BENCHMARK.seed).toBe(metadata.random_seed);
  });

  it('matches the XY depth sweep CSV row for row', () => {
    const rows = readCsv('quantum_xy_depth_sweep.csv');
    expect(QUANTUM_BENCHMARK.xyDepthSweep).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      const generated = QUANTUM_BENCHMARK.xyDepthSweep[index];
      expect(generated.depth).toBe(Number(row.depth));
      expect(generated.nominal_qubits).toBe(Number(row.nominal_qubits));
      expect(generated.simulated_dimension).toBe(Number(row.simulated_dimension));
      expect(generated.approximation_ratio).toBeCloseTo(Number(row.approximation_ratio), 12);
      expect(generated.random_baseline_ratio).toBeCloseTo(Number(row.random_baseline_ratio), 12);
      expect(generated.validity_rate).toBeCloseTo(Number(row.validity_rate), 12);
      expect(generated.optimum_rank).toBe(Number(row.optimum_rank));
      expect(generated.enrichment_over_uniform).toBeCloseTo(
        Number(row.enrichment_over_uniform),
        6,
      );
      expect(generated.found_exact_optimum).toBe(row.found_exact_optimum === 'True');
      expect(generated.proven_optimum_energy).toBeCloseTo(Number(row.proven_optimum_energy), 9);
    });
  });

  it('matches the penalty control CSV row for row', () => {
    const rows = readCsv('quantum_penalty_control.csv');
    expect(QUANTUM_BENCHMARK.penaltyControl).toHaveLength(rows.length);
    rows.forEach((row, index) => {
      const generated = QUANTUM_BENCHMARK.penaltyControl[index];
      expect(generated.depth).toBe(Number(row.depth));
      expect(generated.nominal_qubits).toBe(Number(row.nominal_qubits));
      expect(generated.penalty_P).toBeCloseTo(Number(row.penalty_P), 9);
      expect(generated.objective_span).toBeCloseTo(Number(row.objective_span), 9);
      expect(generated.approximation_ratio).toBeCloseTo(Number(row.approximation_ratio), 12);
      expect(generated.validity_rate).toBeCloseTo(Number(row.validity_rate), 12);
    });
  });

  it('recomputes the derived comparison figures the UI shows', () => {
    const { comparison, xyDepthSweep, penaltyControl } = QUANTUM_BENCHMARK;
    const bestXy = xyDepthSweep.reduce((a, b) =>
      b.approximation_ratio > a.approximation_ratio ? b : a,
    );
    const bestPenalty = penaltyControl.reduce((a, b) =>
      b.approximation_ratio > a.approximation_ratio ? b : a,
    );
    expect(comparison.xyMarginOverRandom).toBeCloseTo(
      bestXy.approximation_ratio - bestXy.random_baseline_ratio,
      12,
    );
    expect(comparison.penaltyMarginOverRandom).toBeCloseTo(
      bestPenalty.approximation_ratio - bestPenalty.random_baseline_ratio,
      12,
    );
    expect(comparison.penaltyToSpanRatio).toBeCloseTo(
      bestPenalty.penalty_P / bestPenalty.objective_span,
      9,
    );
  });

  it('agrees with the run metadata headline', () => {
    const headline = metadata.headline as Record<string, unknown>;
    const best = QUANTUM_BENCHMARK.xyDepthSweep.reduce((a, b) =>
      b.approximation_ratio > a.approximation_ratio ? b : a,
    );
    expect(best.depth).toBe(headline.best_depth);
    expect(best.approximation_ratio).toBeCloseTo(Number(headline.approximation_ratio), 12);
    expect(best.found_exact_optimum).toBe(
      headline.found_proven_optimum_as_most_likely_outcome,
    );
  });
});

describe('honesty invariants, whatever the numbers are', () => {
  it('records that no quantum hardware was executed', () => {
    expect(QUANTUM_BENCHMARK.quantumHardwareExecuted).toBe(false);
    expect(QUANTUM_BENCHMARK.simulation.quantum_hardware_executed).toBe(false);
    expect(QUANTUM_BENCHMARK.simulation.engine).toMatch(/statevector/i);
    expect(QUANTUM_BENCHMARK.simulation.hardware).toMatch(/classical/i);
  });

  it('carries an explicit no-speedup warning', () => {
    const text = [...QUANTUM_BENCHMARK.warnings, ...QUANTUM_BENCHMARK.notes]
      .join(' ')
      .toUpperCase();
    expect(text).toMatch(/NO QUANTUM SPEEDUP|NO SPEEDUP/);
    expect(text).toMatch(/NO QUANTUM HARDWARE/);
  });

  it('names the unmodelled Trotter error rather than omitting it', () => {
    expect(QUANTUM_BENCHMARK.simulation.unmodelled_error).toMatch(/trotter/i);
  });

  it('keeps the XY ansatz validity rate at exactly 1', () => {
    for (const row of QUANTUM_BENCHMARK.xyDepthSweep) {
      expect(row.validity_rate).toBe(1);
    }
  });

  it('leaves the penalty ansatz validity below 1, which is the point of the control', () => {
    for (const row of QUANTUM_BENCHMARK.penaltyControl) {
      expect(row.validity_rate).toBeLessThan(1);
      expect(row.validity_rate).toBeGreaterThan(0);
    }
  });

  it('measures every ratio against a proven optimum over the stated design space', () => {
    const space = QUANTUM_BENCHMARK.searchSpace;
    expect(space.valid_designs).toBe(1_679_616);
    expect(space.one_hot_binary_variables).toBe(48);
    expect(space.positions).toBe(8);
    for (const row of QUANTUM_BENCHMARK.xyDepthSweep) {
      expect(row.simulated_dimension).toBe(space.valid_designs);
      expect(row.nominal_qubits).toBe(space.one_hot_binary_variables);
      expect(row.proven_optimum_energy).toBeCloseTo(
        Number(space.proven_optimum_energy),
        9,
      );
      // A ratio outside [0, 1] would mean the reference optimum is not actually
      // the optimum, or the span is wrong.
      expect(row.approximation_ratio).toBeGreaterThan(0);
      expect(row.approximation_ratio).toBeLessThanOrEqual(1);
      expect(row.approximation_ratio).toBeGreaterThan(row.random_baseline_ratio);
    }
  });

  it('reports the hardware gate cost as a lower bound that was never executed', () => {
    const cost = QUANTUM_BENCHMARK.hardwareCostIfExecuted;
    expect(cost.qubits).toBe(48);
    expect(cost.cnot_total_lower_bound).toBeGreaterThan(0);
    expect(cost.caveats.join(' ').toUpperCase()).toMatch(/NOT EXECUTED/);
    expect(cost.caveats.join(' ').toUpperCase()).toMatch(/LOWER BOUND/);
  });
});
