#!/usr/bin/env python
"""Run the gate-model quantum benchmark and write reproducible results.

Produces, from the real public Potts data:

  1. XY-mixer QAOA (Quantum Alternating Operator Ansatz) on the FULL
     8-position problem - a 48-qubit circuit, simulated exactly inside the
     1,679,616-dimensional one-hot feasible sector, swept over circuit depth.
  2. Penalty-QUBO QAOA with the standard X mixer on a 2-position slice
     (12 qubits), as the head-to-head control that shows why the mixer choice
     matters.
  3. Exact brute force over the identical design space, which supplies the
     proven optimum every ratio above is measured against.

Writes results/quantum_*.csv|json and figures/qaoa_*.png.

NO QUANTUM HARDWARE IS CONTACTED. Nothing here claims a quantum speedup;
brute force is faster on this problem and is used as the reference.

Usage:
    py scripts/run_quantum.py                 # full run, ~15 minutes
    py scripts/run_quantum.py --quick         # reduced depths, ~2 minutes
    py scripts/run_quantum.py --score-source proxy
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from qbind_select.alphabet import CLASSES, class_sequence, representative_sequence
from qbind_select.provenance import metadata
from qbind_select.quantum.circuit import circuit_summary, xy_circuit_cost
from qbind_select.quantum.qaoa import optimise_qaoa
from qbind_select.quantum.subproblem import build_subproblem, exact_slice_optimum
from qbind_select.quantum.xy_qaoa import build_xy_problem, sweep_xy_depths
from qbind_select.score_model import load_or_create_proxy, load_or_create_real


def write_csv(path: Path, rows: list) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def plot_depth_sweep(rows: list, figures: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figures.mkdir(parents=True, exist_ok=True)
    depths = [row["depth"] for row in rows]
    plt.style.use("seaborn-v0_8-whitegrid")

    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.plot(depths, [row["approximation_ratio"] for row in rows], marker="o",
            color="#1769aa", label="XY-mixer QAOA (simulated)")
    ax.axhline(rows[0]["random_baseline_ratio"], linestyle="--", color="#8a8f98",
               label="Uniform random baseline")
    ax.axhline(1.0, linestyle=":", color="#087e8b", label="Proven optimum (brute force)")
    ax.set(xlabel="QAOA circuit depth p", ylabel="Approximation ratio",
           ylim=(0, 1.05), xticks=depths)
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(figures / "qaoa_depth_sweep.png", dpi=180)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.2))
    enrichment = [row["enrichment_over_uniform"] for row in rows]
    ax.bar([str(d) for d in depths], enrichment, color="#5c3c92")
    ax.axhline(1.0, linestyle="--", color="#8a8f98", label="Uniform sampling")
    ax.set(xlabel="QAOA circuit depth p",
           ylabel="Optimum probability / uniform probability")
    ax.set_yscale("log")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(figures / "qaoa_optimum_enrichment.png", dpi=180)
    plt.close(fig)


def plot_ansatz_comparison(xy_row: dict, penalty_row: dict, figures: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = ["Penalty QUBO\n+ X mixer", "One-hot constraint\n+ XY mixer"]
    fig, axes = plt.subplots(1, 2, figsize=(8, 4))
    axes[0].bar(labels, [penalty_row["approximation_ratio"], xy_row["approximation_ratio"]],
                color=["#d1495b", "#1769aa"])
    axes[0].axhline(penalty_row["random_baseline_ratio"], linestyle="--", color="#8a8f98")
    axes[0].set(ylabel="Approximation ratio", ylim=(0, 1.05))
    axes[0].tick_params(axis="x", labelsize=8)
    axes[1].bar(labels, [penalty_row["validity_rate"], xy_row["validity_rate"]],
                color=["#d1495b", "#1769aa"])
    axes[1].set(ylabel="Probability a measurement is a valid design", ylim=(0, 1.05))
    axes[1].tick_params(axis="x", labelsize=8)
    fig.tight_layout()
    fig.savefig(figures / "qaoa_ansatz_comparison.png", dpi=180)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lambda-value", type=float, default=1.0)
    parser.add_argument("--score-source", choices=("real", "proxy"), default="real")
    parser.add_argument("--depths", default="1,2,3")
    parser.add_argument("--restarts", type=int, default=2)
    parser.add_argument("--iterations", type=int, default=150)
    parser.add_argument("--shots", type=int, default=8192)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--quick", action="store_true",
                        help="depths 1,2 with fewer iterations, for a fast check")
    args = parser.parse_args()

    depths = tuple(int(d) for d in args.depths.split(","))
    iterations = args.iterations
    if args.quick:
        depths, iterations = (1, 2), 60

    results_dir, figures_dir = ROOT / "results", ROOT / "figures"
    results_dir.mkdir(parents=True, exist_ok=True)

    if args.score_source == "real":
        repo = ROOT / "data/raw/QA-PBP-RL-Nexus"
        if not repo.exists():
            raise RuntimeError(
                "Real source requested but QA-PBP-RL-Nexus is absent. "
                "Clone it, or pass --score-source proxy."
            )
        coefficients, checksum = load_or_create_real(
            repo, ROOT / "data/processed/real_aggregated_potts_model.npz"
        )
        source_label = (
            "REAL PUBLIC DATA: QA-PBP-RL-Nexus PottsModel_Energies, PET/PE/PP bb1; "
            "arithmetic 20-aa-to-6-class aggregation; canonical binding score = "
            "negative raw Potts energy"
        )
    else:
        coefficients, checksum = load_or_create_proxy(ROOT / "data/raw/proxy_scoring_model.npz")
        source_label = "PROXY / SYNTHETIC SCORING MODEL"

    started = time.perf_counter()
    lam = args.lambda_value

    # ---------------------------------------------------------------- full XY
    print(f"[1/3] building full 8-position feasible subspace (lambda={lam})", flush=True)
    problem = build_xy_problem(coefficients, lam)
    print(
        f"      nominal qubits={problem.nominal_qubits} "
        f"feasible dimension={problem.dimension} "
        f"proven optimum={problem.best_energy:.6f} "
        f"({representative_sequence(np.array(problem.best_slot_classes))})",
        flush=True,
    )

    print(f"[2/3] XY-mixer QAOA depth sweep {depths}", flush=True)
    sweep = sweep_xy_depths(
        problem,
        depths=depths,
        restarts=args.restarts,
        max_iterations=iterations,
        shots=args.shots,
        seed=args.seed,
    )

    xy_rows = []
    for result in sweep:
        codes = np.array(problem.codes_for(result.most_likely_slot_classes))
        xy_rows.append(
            {
                "ansatz": "XY mixer (feasible subspace)",
                "depth": result.depth,
                "nominal_qubits": result.nominal_qubits,
                "simulated_dimension": result.dimension,
                "variational_parameters": 2 * result.depth,
                "expectation": result.expectation,
                "approximation_ratio": result.approximation_ratio,
                "random_baseline_ratio": result.random_baseline_ratio,
                "validity_rate": result.validity_rate,
                "most_likely_class_sequence": class_sequence(codes),
                "most_likely_representative_sequence": representative_sequence(codes),
                "most_likely_energy": result.most_likely_energy,
                "most_likely_probability": result.most_likely_probability,
                "found_exact_optimum": result.found_exact_optimum,
                "optimum_probability": result.optimum_probability,
                "optimum_rank": result.optimum_rank,
                "enrichment_over_uniform": result.enrichment_over_uniform,
                "proven_optimum_energy": result.exact_best_energy,
                "function_evaluations": result.function_evaluations,
                "restarts": result.restarts,
                "runtime_seconds": result.runtime_seconds,
                "shots": result.shots.get("shots"),
                "optimum_in_shots": result.shots.get("optimum_in_shots"),
                "best_energy_in_shots": result.shots.get("best_energy_in_shots"),
            }
        )
        print(
            f"      p={result.depth} ratio={result.approximation_ratio:.4f} "
            f"(random {result.random_baseline_ratio:.4f}) "
            f"optimum_rank={result.optimum_rank} "
            f"enrichment={result.enrichment_over_uniform:.0f}x "
            f"found_optimum={result.found_exact_optimum} "
            f"t={result.runtime_seconds:.1f}s",
            flush=True,
        )

    # ------------------------------------------------- penalty-QUBO control
    print("[3/3] penalty-QUBO QAOA control on a 2-position slice", flush=True)
    context = problem.codes_for(sweep[-1].most_likely_slot_classes)
    slice_problem = build_subproblem(coefficients, lam, context, free_count=2)
    exact = exact_slice_optimum(slice_problem)
    penalty_rows = []
    for depth in depths:
        result = optimise_qaoa(
            slice_problem, depth=depth, exact=exact, shots=args.shots, seed=args.seed
        )
        penalty_rows.append(
            {
                "ansatz": "Penalty QUBO + X mixer",
                "depth": result.depth,
                "nominal_qubits": result.num_qubits,
                "simulated_dimension": 1 << result.num_qubits,
                "variational_parameters": 2 * result.depth,
                "penalty_P": slice_problem.penalty,
                "objective_span": exact["worst_energy"] - exact["best_energy"],
                "penalty_to_span_ratio": slice_problem.penalty
                / max(exact["worst_energy"] - exact["best_energy"], 1e-12),
                "expectation": result.expectation_objective,
                "approximation_ratio": result.approximation_ratio,
                "random_baseline_ratio": result.random_baseline_ratio,
                "validity_rate": result.valid_probability,
                "most_likely_energy": result.best_valid_energy,
                "found_exact_optimum": result.found_exact_optimum,
                "optimum_probability": result.optimum_probability,
                "proven_optimum_energy": result.exact_best_energy,
                "function_evaluations": result.function_evaluations,
                "runtime_seconds": result.runtime_seconds,
                "cnot_lower_bound": result.gate_counts.get("cnot_lower_bound"),
            }
        )
        print(
            f"      p={depth} ratio={result.approximation_ratio:.4f} "
            f"(random {result.random_baseline_ratio:.4f}) "
            f"valid_probability={result.valid_probability:.4f} "
            f"t={result.runtime_seconds:.1f}s",
            flush=True,
        )

    write_csv(results_dir / "quantum_xy_depth_sweep.csv", xy_rows)
    write_csv(results_dir / "quantum_penalty_control.csv", penalty_rows)

    try:
        plot_depth_sweep(xy_rows, figures_dir)
        plot_ansatz_comparison(xy_rows[-1], penalty_rows[-1], figures_dir)
        figures_written = [
            "qaoa_depth_sweep.png",
            "qaoa_optimum_enrichment.png",
            "qaoa_ansatz_comparison.png",
        ]
    except Exception as exc:  # pragma: no cover - plotting is not the science
        figures_written = []
        print(f"      figure generation skipped: {exc}", flush=True)

    best = sweep[-1]
    gate_cost = xy_circuit_cost(
        num_positions=len(problem.free_positions),
        depth=best.depth,
        coupled_pairs=1008,  # 28 position pairs x 6 x 6 class-pair couplings
    )
    control_circuit = circuit_summary(slice_problem, best.depth, emit_gates=False)

    report = metadata(checksum, {
        "experiment": {"normalization": "none"},
        "reproducibility": {"seed": args.seed},
    }, [
        "All outputs are computational predictions, not biological validation.",
        "NO QUANTUM HARDWARE EXECUTION. Exact classical statevector simulation only.",
        "NO QUANTUM SPEEDUP IS CLAIMED OR DEMONSTRATED.",
    ])
    report["dataset_source_identifier"] = source_label
    report.update(
        {
            "method": {
                "primary": "Quantum Alternating Operator Ansatz (QAOA with complete-graph "
                           "XY mixers) on the one-hot feasible subspace",
                "reference": "Hadfield et al. 2019 (QAOA ansatz family); "
                             "Farhi et al. 2014 (QAOA); Zhou et al. 2020 (INTERP seeding)",
                "control": "Penalty-QUBO QAOA with the standard transverse-field X mixer",
                "classical_reference": "exact brute force over the same design space",
                "lambda": lam,
                "optimiser": "Nelder-Mead simplex, multi-restart with INTERP depth seeding",
                "seed": args.seed,
            },
            "simulation": {
                "engine": "NumPy exact statevector, float64/complex128",
                "hardware": "classical CPU",
                "quantum_hardware_executed": False,
                "nominal_circuit_width_qubits": problem.nominal_qubits,
                "naive_statevector_amplitudes": f"2**{problem.nominal_qubits}",
                "simulated_feasible_dimension": problem.dimension,
                "why_tractable": (
                    "The complete-graph XY mixer conserves Hamming weight inside every "
                    "one-hot block, so a feasible initial state confines the dynamics to "
                    "the 6**8 = 1,679,616-dimensional feasible sector. That sector is "
                    "simulated exactly in 27 MB. This is a symmetry-sector simulation, "
                    "not an approximation of the circuit."
                ),
                "unmodelled_error": (
                    "The XY mixer is applied as an exact matrix exponential. Gate-model "
                    "hardware must Trotterise non-commuting XY terms; that Trotter error, "
                    "and all device noise, are NOT modelled."
                ),
            },
            "search_space": {
                "positions": 8,
                "classes": len(CLASSES),
                "one_hot_binary_variables": 48,
                "valid_designs": problem.dimension,
                "proven_optimum_energy": problem.best_energy,
                "proven_optimum_class_sequence": class_sequence(
                    np.array(problem.best_slot_classes)
                ),
                "proven_optimum_representative_sequence": representative_sequence(
                    np.array(problem.best_slot_classes)
                ),
                "uniform_mean_energy": problem.mean_energy,
                "worst_energy": problem.worst_energy,
            },
            "headline": {
                "best_depth": best.depth,
                "approximation_ratio": best.approximation_ratio,
                "random_baseline_ratio": best.random_baseline_ratio,
                "validity_rate": best.validity_rate,
                "found_proven_optimum_as_most_likely_outcome": best.found_exact_optimum,
                "optimum_probability": best.optimum_probability,
                "enrichment_over_uniform_sampling": best.enrichment_over_uniform,
                "optimum_rank_by_probability": best.optimum_rank,
            },
            "penalty_control": {
                "free_positions": list(slice_problem.free_positions),
                "clamped_context_class_sequence": class_sequence(np.array(context)),
                "penalty_P": slice_problem.penalty,
                "objective_span": exact["worst_energy"] - exact["best_energy"],
                "interpretation": (
                    "A provably safe one-hot penalty must exceed the whole objective "
                    "range, so P dwarfs the span the optimiser needs to resolve. This is "
                    "why the penalty encoding, which an annealer requires, is a poor fit "
                    "for a gate-model variational circuit."
                ),
                "circuit": control_circuit.counts,
            },
            "hardware_cost_if_executed": gate_cost,
            "top_designs_at_best_depth": [
                {
                    **design,
                    "class_sequence": class_sequence(np.array(design["codes"])),
                    "representative_sequence": representative_sequence(
                        np.array(design["codes"])
                    ),
                }
                for design in best.top_designs
            ],
            "notes": best.notes,
            "figures": figures_written,
            "total_runtime_seconds": time.perf_counter() - started,
        }
    )
    (results_dir / "quantum_run_metadata.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "status": "complete",
                "source": args.score_source,
                "nominal_qubits": problem.nominal_qubits,
                "feasible_dimension": problem.dimension,
                "headline": report["headline"],
                "runtime_seconds": report["total_runtime_seconds"],
            },
            indent=2,
            default=str,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
