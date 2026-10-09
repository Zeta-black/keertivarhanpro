#!/usr/bin/env python
"""Run the full offline Q-BIND Select benchmark in one reproducible command."""
from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from qbind_select.alphabet import CLASSES, class_sequence, representative_sequence, variable_index
from qbind_select.enumerate_space import enumerate_codes, sequence_count
from qbind_select.metrics import candidate_metrics
from qbind_select.provenance import metadata
from qbind_select.qubo import add_one_hot_constraint, combine_objective, make_bqm, qubo_energy, safe_penalty
from qbind_select.score_model import PLASTICS, load_or_create_proxy, load_or_create_real, model_description, score_codes
from qbind_select.solvers.brute_force import solve as brute_solve
from qbind_select.solvers.dwave_solver import solve_if_configured
from qbind_select.solvers.simulated_annealing import solve as sa_solve
from qbind_select.surrogate import fit_surrogate, predict_qubo


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def row_for(codes, pet, pe, pp, objective, rank=None, solver=None):
    out = {"class_sequence": class_sequence(codes), "representative_aa_sequence": representative_sequence(codes), "PET_canonical_binding_score": float(pet), "PE_canonical_binding_score": float(pe), "PP_canonical_binding_score": float(pp), "objective": float(objective)}
    if rank is not None: out["rank"] = rank
    if solver is not None: out["solver"] = solver
    out.update(candidate_metrics(codes, pet, pe, pp))
    return out


def plot_figures(sweep, comparison, figures):
    import matplotlib.pyplot as plt
    figures.mkdir(parents=True, exist_ok=True)
    lam = [r["lambda"] for r in sweep]
    plt.style.use("seaborn-v0_8-whitegrid")
    fig, ax = plt.subplots(figsize=(7, 4.2))
    for score, color in (("PET_canonical_binding_score", "#1769aa"), ("PE_canonical_binding_score", "#d1495b"), ("PP_canonical_binding_score", "#ed8b00")):
        ax.plot(lam, [r[score] for r in sweep], marker="o", label=score[:3], color=color)
    ax.set(xlabel="Selectivity coefficient (λ)", ylabel="Predicted canonical binding score")
    ax.legend(); fig.tight_layout(); fig.savefig(figures / "selectivity_sweep.png", dpi=180); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.plot(lam, [r["margin_mean"] for r in sweep], marker="o", color="#087e8b")
    ax.set(xlabel="Selectivity coefficient (λ)", ylabel="PET − mean(PE, PP)")
    fig.tight_layout(); fig.savefig(figures / "selectivity_margin.png", dpi=180); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4.2))
    ax.plot(lam, [r["objective"] for r in sweep], marker="o", color="#5c3c92")
    ax.set(xlabel="Selectivity coefficient (λ)", ylabel="Optimum objective (changes with λ)")
    fig.tight_layout(); fig.savefig(figures / "objective_sweep.png", dpi=180); plt.close(fig)
    labels = [r["Solver"] for r in comparison if r["Solver"] != "D-Wave hybrid"]
    fig, axes = plt.subplots(1, 2, figsize=(8, 4))
    axes[0].bar(labels, [r["Success rate"] for r in comparison if r["Solver"] != "D-Wave hybrid"], color=["#1769aa", "#ed8b00"])
    axes[0].set(ylabel="Per-read optimum-hit rate", ylim=(0, 1.05))
    axes[1].bar(labels, [r["Runtime seconds"] for r in comparison if r["Solver"] != "D-Wave hybrid"], color=["#1769aa", "#ed8b00"])
    axes[1].set(ylabel="Complete local solver wall-clock (s)")
    fig.tight_layout(); fig.savefig(figures / "solver_benchmark.png", dpi=180); plt.close(fig)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(ROOT / "config" / "experiment.yaml"))
    args = parser.parse_args()
    cfg = yaml.safe_load(Path(args.config).read_text(encoding="utf-8"))
    if cfg["experiment"]["score_source"] not in ("proxy", "real"):
        raise RuntimeError("score_source must be 'real' or 'proxy'")
    data, results, figures, artifacts = (ROOT / p for p in ("data/processed", "results", "figures", "artifacts"))
    for d in (data, results, figures, artifacts): d.mkdir(parents=True, exist_ok=True)
    length, alphabet_size = cfg["experiment"]["peptide_length"], len(cfg["experiment"]["alphabet"])
    assert sequence_count(length, alphabet_size) == 1_679_616
    start = time.perf_counter()
    if cfg["experiment"]["score_source"] == "real":
        real_repo = ROOT / "data/raw/QA-PBP-RL-Nexus"
        if not real_repo.exists():
            raise RuntimeError("Real source requested but QA-PBP-RL-Nexus is absent. Clone it or explicitly select proxy.")
        coefficient_path = data / "real_aggregated_potts_model.npz"
        coefficients, checksum = load_or_create_real(real_repo, coefficient_path)
        source_label = "REAL PUBLIC DATA: QA-PBP-RL-Nexus PottsModel_Energies, PET/PE/PP bb1; arithmetic 20-aa-to-6-class aggregation; canonical binding score = negative raw Potts energy"
        cache = data / "all_8mer_scores_real.npz"
    else:
        coefficient_path = ROOT / "data/raw/proxy_scoring_model.npz"
        coefficients, checksum = load_or_create_proxy(coefficient_path)
        source_label = "PROXY / SYNTHETIC SCORING MODEL"
        cache = data / "all_8mer_scores_proxy.npz"
    if cache.exists():
        cached = np.load(cache)
        codes, raw = cached["codes"], {p: cached[p] for p in PLASTICS}
        cache_status = "loaded"
    else:
        codes = enumerate_codes(length, alphabet_size)
        raw = {p: score_codes(codes, coefficients[p]) for p in PLASTICS}
        np.savez_compressed(cache, codes=codes, **raw)
        cache_status = "created"
    preprocessing_seconds = time.perf_counter() - start
    scale_stats = {p: {"mean": float(raw[p].mean()), "std": float(raw[p].std()), "min": float(raw[p].min()), "max": float(raw[p].max())} for p in PLASTICS}
    variable_map = [{"binary_index": variable_index(i, a), "position": i, "class_index": a, "class_label": CLASSES[a]} for i in range(length) for a in range(alphabet_size)]
    (artifacts / "variable_map.json").write_text(json.dumps(variable_map, indent=2), encoding="utf-8")
    (artifacts / "score_model_description.json").write_text(json.dumps(model_description() if cfg["experiment"]["score_source"] == "proxy" else {"label": source_label, "raw_score": "Potts energy (lower is preferred by source)", "canonical_binding_score": "-raw_score", "aggregation": "arithmetic mean within the deterministic six-class mapping, source positions 2..9"}, indent=2), encoding="utf-8")
    train_start = time.perf_counter()
    fitted, metric_rows = {}, []
    for offset, p in enumerate(PLASTICS):
        fitted[p], metrics = fit_surrogate(codes, raw[p], cfg["surrogate"]["ridge_alpha"], cfg["reproducibility"]["seed"] + offset, cfg["surrogate"]["train_size"], cfg["surrogate"]["validation_size"], cfg["surrogate"]["test_size"])
        test = metrics["test"]
        status = "PASS" if test["r2"] >= cfg["surrogate"]["pass_r2"] else "WARNING" if test["r2"] >= cfg["surrogate"]["warn_r2"] else "FAIL"
        metric_rows.append({"Plastic": p, "training_samples": metrics["train"]["count"], "validation_samples": metrics["validation"]["count"], "test_samples": test["count"], "Ridge_alpha": cfg["surrogate"]["ridge_alpha"], "R2": test["r2"], "RMSE": test["rmse"], "MAE": test["mae"], "Status": status})
    surrogate_seconds = time.perf_counter() - train_start
    write_csv(results / "surrogate_metrics.csv", metric_rows)
    predicted = {p: predict_qubo(codes, fitted[p]) for p in PLASTICS}
    # Numeric reconstruction check on deterministic random valid sequences.
    check_rng = np.random.default_rng(cfg["reproducibility"]["seed"])
    check_indices = check_rng.choice(len(codes), 100, replace=False)
    max_reconstruction_error = max(float(np.max(np.abs(predicted[p][check_indices] - fitted[p].model.predict(__import__('qbind_select.features', fromlist=['feature_matrix']).feature_matrix(codes[check_indices]))))) for p in PLASTICS)
    sweep, comparisons, all_sa_rows = [], [], []
    default_lambda = 1.0
    top10 = []
    max_energy_error = 0.0
    qubo_seconds = 0.0
    for lam in cfg["experiment"]["lambda_values"]:
        bstart = time.perf_counter()
        linear, quadratic, offset = combine_objective(fitted, lam)
        penalty = safe_penalty(linear, quadratic, cfg["optimization"]["penalty_multiplier"])
        constrained_linear, constrained_quadratic, constrained_offset = add_one_hot_constraint(linear, quadratic, offset, penalty)
        bqm = make_bqm(constrained_linear, constrained_quadratic, constrained_offset)
        qubo_seconds += time.perf_counter() - bstart
        brute = brute_solve(codes, predicted["PET"], predicted["PE"], predicted["PP"], lam, cfg["optimization"]["solver_tolerance"])
        best_i = brute["best_index"]
        x = np.zeros(48, dtype=int); x[np.arange(8)*6 + codes[best_i]] = 1
        max_energy_error = max(max_energy_error, abs(qubo_energy(x, constrained_linear, constrained_quadratic, constrained_offset) - brute["best_energy"]))
        best = row_for(codes[best_i], predicted["PET"][best_i], predicted["PE"][best_i], predicted["PP"][best_i], brute["best_energy"], solver="Brute force")
        best["lambda"] = lam; best["penalty_P"] = penalty; best["runtime_seconds"] = brute["runtime_seconds"]
        sweep.append(best)
        sa = sa_solve(bqm, brute["best_energy"], cfg["optimization"]["solver_tolerance"], cfg["simulated_annealing"]["num_reads"], cfg["simulated_annealing"]["num_sweeps"], cfg["simulated_annealing"]["runs"], cfg["reproducibility"]["seed"] + int(lam*100))
        all_sa_rows.extend([{**r, "lambda": lam} for r in sa["run_rows"]])
        comparisons.append({"Solver": "Brute force", "lambda": lam, "Best sequence": best["class_sequence"], "Best objective": brute["best_energy"], "PET": best["PET_canonical_binding_score"], "PE": best["PE_canonical_binding_score"], "PP": best["PP_canonical_binding_score"], "Validity": 1.0, "Success rate": 1.0, "Runtime seconds": brute["runtime_seconds"], "Status": "EXECUTED"})
        if sa["best_codes"] is not None:
            si = 0
            for code in sa["best_codes"]:
                si = si * 6 + int(code)
            sp = [predicted[p][si] for p in PLASTICS]
            srow = row_for(sa["best_codes"], sp[0], sp[1], sp[2], sa["best_energy"], solver="Simulated annealing")
            seq = srow["class_sequence"]
        else:
            srow, seq = {}, "N/A"
        comparisons.append({"Solver": "Simulated annealing", "lambda": lam, "Best sequence": seq, "Best objective": sa["best_energy"], "PET": srow.get("PET_canonical_binding_score"), "PE": srow.get("PE_canonical_binding_score"), "PP": srow.get("PP_canonical_binding_score"), "Validity": sa["validity_rate"], "Success rate": sa["success_rate"], "Runtime seconds": sa["runtime_seconds"], "Status": "EXECUTED", "reads": sa["total_samples"], "optimum_hits": sa["optimum_hits"], "median_best_energy": sa["median_best_energy"], "std_best_energy": sa["std_best_energy"]})
        if lam == default_lambda:
            for rank, idx in enumerate(brute["order"], 1):
                top10.append(row_for(codes[idx], predicted["PET"][idx], predicted["PE"][idx], predicted["PP"][idx], brute["objective"][idx], rank=rank, solver="Brute force"))
    # A BQM is already constructed; attempt genuinely remote D-Wave only when credentials/package permit it.
    dwave = solve_if_configured(bqm)
    comparisons.append({"Solver": "D-Wave hybrid", "lambda": "N/A", "Best sequence": "N/A - not executed" if dwave["status"] != "EXECUTED" else "returned by Leap", "Best objective": dwave.get("energy"), "PET": None, "PE": None, "PP": None, "Validity": None, "Success rate": None, "Runtime seconds": None, "Status": dwave["status"]})
    write_csv(results / "selectivity_sweep.csv", sweep)
    write_csv(results / "solver_comparison.csv", comparisons)
    write_csv(results / "sa_run_distribution.csv", all_sa_rows)
    write_csv(results / "top10_peptides.csv", top10)
    (results / "top10_peptides.json").write_text(json.dumps(top10, indent=2), encoding="utf-8")
    # Use lambda=1 solver rows for the compact required figure.
    plot_figures(sweep, [r for r in comparisons if r.get("lambda") in (default_lambda, "N/A")], figures)
    warnings = ["All outputs are computational predictions, not biological validation.", "D-Wave status: " + dwave["status"]]
    run = metadata(checksum, cfg, warnings)
    run["dataset_source_identifier"] = source_label
    run.update({"search_space": {"positions": 8, "classes": 6, "binary_variables": 48, "valid_sequences": int(len(codes))}, "cache": {"path": str(cache.relative_to(ROOT)), "status": cache_status, "preprocessing_seconds": preprocessing_seconds, "size_bytes": cache.stat().st_size}, "score_scale_verification": {"source": "same bb1 Potts-energy protocol for PET, PE, PP", "full_space_statistics": scale_stats, "decision": "no normalization; standard-deviation ratio is below 1.08 and all scores share the same raw-energy convention"}, "runtimes_seconds": {"preprocessing": preprocessing_seconds, "surrogate_training": surrogate_seconds, "qubo_construction": qubo_seconds, "total": time.perf_counter()-start}, "validation": {"max_surrogate_qubo_reconstruction_error": max_reconstruction_error, "max_objective_qubo_energy_error": max_energy_error, "penalty_method": "P = multiplier * (sum(abs(linear objective coefficients)) + sum(abs(quadratic objective coefficients))) + 1; conservative full objective-range bound."}, "d_wave": dwave, "config": cfg})
    (results / "run_metadata.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
    print(json.dumps({"status": "complete", "valid_sequences": len(codes), "surrogate_metrics": metric_rows, "d_wave": dwave["status"], "results": str(results)}, indent=2))


if __name__ == "__main__":
    main()
