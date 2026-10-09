from __future__ import annotations

import time
import numpy as np

from ..alphabet import decode, is_valid_one_hot


def solve(bqm, brute_energy, tolerance, reads, sweeps, runs, seed_base):
    from dwave.samplers import SimulatedAnnealingSampler
    sampler = SimulatedAnnealingSampler()
    run_rows, all_valid_energies = [], []
    best_codes = None
    best_energy = np.inf
    total_samples = total_valid = optimum_hits = 0
    started = time.perf_counter()
    for run in range(runs):
        sample_set = sampler.sample(bqm, num_reads=reads, num_sweeps=sweeps, seed=seed_base+run)
        run_energies = []
        for sample, energy in sample_set.data(fields=["sample", "energy"]):
            x = np.array([sample[i] for i in range(48)], dtype=int)
            total_samples += 1
            if is_valid_one_hot(x):
                total_valid += 1
                run_energies.append(float(energy))
                all_valid_energies.append(float(energy))
                if energy < best_energy:
                    best_energy, best_codes = float(energy), decode(x)
                if abs(float(energy) - brute_energy) <= tolerance:
                    optimum_hits += 1
        run_rows.append({"run": run, "best_valid_energy": float(min(run_energies)) if run_energies else None, "valid_samples": len(run_energies), "total_samples": reads})
    elapsed = time.perf_counter()-started
    return {"best_energy": None if best_codes is None else best_energy, "best_codes": best_codes, "total_samples": total_samples, "valid_samples": total_valid, "invalid_samples": total_samples-total_valid, "validity_rate": total_valid/total_samples if total_samples else 0.0, "optimum_hits": optimum_hits, "success_rate": optimum_hits/total_samples if total_samples else 0.0, "runtime_seconds": elapsed, "run_rows": run_rows, "mean_best_energy": float(np.mean([r["best_valid_energy"] for r in run_rows if r["best_valid_energy"] is not None])) if all_valid_energies else None, "std_best_energy": float(np.std([r["best_valid_energy"] for r in run_rows if r["best_valid_energy"] is not None])) if all_valid_energies else None, "median_best_energy": float(np.median([r["best_valid_energy"] for r in run_rows if r["best_valid_energy"] is not None])) if all_valid_energies else None}
