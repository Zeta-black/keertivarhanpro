#!/usr/bin/env python
"""Publish the offline quantum benchmark numbers into the web app.

The Quantum screen quotes results from the full-size run - the 48-qubit
circuit over all 1,679,616 designs - which takes about twenty minutes and so
cannot happen in a browser tab. Rather than let a human retype those numbers
into a React component, where they would rot silently, this script generates
them from `results/quantum_run_metadata.json` and the two result CSVs.

`web/tests/science/quantum-summary.test.ts` then re-reads the same result files
and requires the generated module to match, so a stale export fails the suite
instead of shipping numbers that no longer describe any run.

Usage:
    py scripts/export_quantum_summary.py
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
OUT = ROOT / "web/src/generated/quantumBenchmark.ts"


def read_rows(name: str) -> list[dict]:
    path = RESULTS / name
    if not path.exists():
        raise RuntimeError(f"missing {path.relative_to(ROOT)}; run scripts/run_quantum.py first")
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def number(value: str):
    if value in ("", "None"):
        return None
    if value in ("True", "False"):
        return value == "True"
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def main() -> None:
    metadata_path = RESULTS / "quantum_run_metadata.json"
    if not metadata_path.exists():
        raise RuntimeError("run scripts/run_quantum.py before exporting the summary")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))

    xy_rows = read_rows("quantum_xy_depth_sweep.csv")
    penalty_rows = read_rows("quantum_penalty_control.csv")

    def project(rows: list[dict], fields: tuple[str, ...]) -> list[dict]:
        return [{field: number(row[field]) for field in fields} for row in rows]

    xy = project(
        xy_rows,
        (
            "depth",
            "nominal_qubits",
            "simulated_dimension",
            "variational_parameters",
            "approximation_ratio",
            "random_baseline_ratio",
            "validity_rate",
            "most_likely_representative_sequence",
            "most_likely_energy",
            "found_exact_optimum",
            "optimum_probability",
            "optimum_rank",
            "enrichment_over_uniform",
            "proven_optimum_energy",
            "runtime_seconds",
        ),
    )
    penalty = project(
        penalty_rows,
        (
            "depth",
            "nominal_qubits",
            "variational_parameters",
            "penalty_P",
            "objective_span",
            "approximation_ratio",
            "random_baseline_ratio",
            "validity_rate",
            "runtime_seconds",
        ),
    )

    payload = {
        "schema": "qbind-select/quantum-benchmark/1",
        "generatedBy": "scripts/export_quantum_summary.py",
        "source": metadata.get("dataset_source_identifier", ""),
        "sourceChecksumSha256": metadata.get("source_checksum", ""),
        "seed": metadata.get("random_seed"),
        "gitCommit": metadata.get("git_commit"),
        "timestampUtc": metadata.get("timestamp_utc"),
        "quantumHardwareExecuted": False,
        "method": metadata.get("method", {}),
        "simulation": metadata.get("simulation", {}),
        "searchSpace": metadata.get("search_space", {}),
        "headline": metadata.get("headline", {}),
        "hardwareCostIfExecuted": metadata.get("hardware_cost_if_executed", {}),
        "xyDepthSweep": xy,
        "penaltyControl": penalty,
        "warnings": metadata.get("warnings", []),
        "notes": metadata.get("notes", []),
    }

    # Derived comparison figures the UI shows, computed here so the component
    # cannot compute them differently.
    best_xy = max(xy, key=lambda row: row["approximation_ratio"])
    best_penalty = max(penalty, key=lambda row: row["approximation_ratio"])
    payload["comparison"] = {
        "xyMarginOverRandom": best_xy["approximation_ratio"] - best_xy["random_baseline_ratio"],
        "penaltyMarginOverRandom": (
            best_penalty["approximation_ratio"] - best_penalty["random_baseline_ratio"]
        ),
        "penaltyToSpanRatio": best_penalty["penalty_P"] / best_penalty["objective_span"],
        "xyValidityRate": best_xy["validity_rate"],
        "penaltyValidityRate": best_penalty["validity_rate"],
        "xyBestDepth": best_xy["depth"],
        "penaltyBestDepth": best_penalty["depth"],
    }

    body = json.dumps(payload, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        '/* GENERATED FILE - do not edit.\n'
        ' *\n'
        ' * Written by scripts/export_quantum_summary.py from results/quantum_*.json|csv.\n'
        ' * These are the measured numbers from the FULL-SIZE offline run: a 48-qubit\n'
        ' * XY-mixer QAOA circuit over all 1,679,616 valid designs, simulated exactly\n'
        ' * inside the one-hot feasible subspace, plus the penalty-QUBO control.\n'
        ' *\n'
        ' * NO QUANTUM HARDWARE WAS USED. No speedup is claimed: the reference every\n'
        ' * ratio below is measured against is an exact brute-force optimum over the\n'
        ' * same design space.\n'
        ' *\n'
        ' * Regenerate with:  py scripts/export_quantum_summary.py\n'
        ' * Kept honest by:   web/tests/science/quantum-summary.test.ts\n'
        ' */\n\n'
        f'export const QUANTUM_BENCHMARK = {body} as const;\n\n'
        'export type QuantumBenchmark = typeof QUANTUM_BENCHMARK;\n',
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "status": "written",
                "path": str(OUT.relative_to(ROOT)),
                "depths": [row["depth"] for row in xy],
                "best_ratio": best_xy["approximation_ratio"],
                "penalty_margin": payload["comparison"]["penaltyMarginOverRandom"],
                "xy_margin": payload["comparison"]["xyMarginOverRandom"],
                "bytes": OUT.stat().st_size,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
