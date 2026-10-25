#!/usr/bin/env python
"""Export a golden fixture pinning the browser QAOA to the Python QAOA.

`web/src/science/qaoa.ts` re-implements the XY-mixer ansatz in TypeScript so
the site can run it live. A second implementation is a second chance to be
wrong, so this script records what the Python implementation produces for
fixed, hard-coded angles, and `web/tests/science/qaoa-parity.test.ts` requires
the TypeScript side to reproduce it to 1e-9.

Angles are FIXED here rather than optimised. Cross-language parity of an
iterative optimiser is not a meaningful target - floating-point summation order
differs, so the two Nelder-Mead runs legitimately take different paths. What
must agree is the physics: the objective tensor, the statevector the circuit
produces for given angles, and every quantity derived from it.

Usage:
    py scripts/export_qaoa_fixture.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from qbind_select.quantum.circuit import xy_circuit_cost
from qbind_select.quantum.subproblem import build_subproblem
from qbind_select.quantum.xy_qaoa import (
    build_xy_problem,
    probabilities_of,
    scaled_phase,
    xy_qaoa_state,
)
from qbind_select.score_model import load_or_create_real

# Context sequence: the published lambda=1 optimum (LSWWLLFL) as class codes.
CONTEXT = (2, 3, 0, 0, 2, 2, 1, 2)

# Two slice widths, so the fixture exercises both the single-axis mixer path
# and the multi-axis one, and both the 18- and 24-qubit nominal widths.
CASES = (
    {"name": "three-slot", "free_positions": [0, 2, 7], "lambda": 1.0},
    {"name": "four-slot", "free_positions": [0, 2, 5, 7], "lambda": 2.0},
)

# Deliberately irregular angles: a round number could hide a factor-of-two
# error in the mixer that an asymmetric one exposes.
ANGLE_SETS = (
    {"gammas": [], "betas": []},
    {"gammas": [0.37], "betas": [0.81]},
    {"gammas": [0.37, 1.13], "betas": [0.81, 0.29]},
    {"gammas": [2.4, -0.7, 1.9], "betas": [0.15, 1.27, -0.63]},
)


def main() -> None:
    repo = ROOT / "data/raw/QA-PBP-RL-Nexus"
    coefficient_path = ROOT / "data/processed/real_aggregated_potts_model.npz"
    if not coefficient_path.exists() and not repo.exists():
        raise RuntimeError(
            "Need either the cached real_aggregated_potts_model.npz or the "
            "QA-PBP-RL-Nexus source to build the fixture."
        )
    coefficients, checksum = load_or_create_real(repo, coefficient_path)

    cases = []
    for case in CASES:
        # Build the reduction once and derive both the effective coefficients
        # (so a TypeScript mismatch can be localised to the reduction) and the
        # feasible-subspace problem the circuit runs on.
        sub = build_subproblem(
            coefficients,
            case["lambda"],
            CONTEXT,
            free_positions=case["free_positions"],
        )
        problem = build_xy_problem(
            coefficients,
            case["lambda"],
            CONTEXT,
            free_positions=case["free_positions"],
        )
        phase = scaled_phase(problem)
        flat = problem.objective.ravel()

        runs = []
        for angles in ANGLE_SETS:
            state = xy_qaoa_state(phase, angles["gammas"], angles["betas"])
            probability = probabilities_of(state)
            order = np.argsort(-probability, kind="stable")
            runs.append(
                {
                    "gammas": angles["gammas"],
                    "betas": angles["betas"],
                    "norm": float(np.linalg.norm(state)),
                    "expectation": float(np.dot(probability, flat)),
                    # Top outcomes pin the full distribution shape, not just a
                    # scalar that several wrong states could coincidentally share.
                    "topIndices": [int(i) for i in order[:8]],
                    "topProbabilities": [float(probability[i]) for i in order[:8]],
                    "optimumProbability": float(probability[problem.best_index]),
                    # A checksum over every amplitude: catches a permutation
                    # that leaves the top-8 intact.
                    "probabilitySquaredSum": float(np.dot(probability, probability)),
                }
            )

        cases.append(
            {
                "name": case["name"],
                "lambda": case["lambda"],
                "freePositions": case["free_positions"],
                "fixedCodes": list(CONTEXT),
                "slots": len(case["free_positions"]),
                "dimension": problem.dimension,
                "nominalQubits": problem.nominal_qubits,
                "contextConstant": sub.context_constant,
                "effectiveLinear": [float(v) for v in sub.objective_only_linear],
                "objective": {
                    "best": problem.best_energy,
                    "worst": problem.worst_energy,
                    "mean": problem.mean_energy,
                    "bestIndex": problem.best_index,
                    "bestSlotClasses": list(problem.best_slot_classes),
                    "checksum": float(np.dot(flat, flat)),
                    # Spot values at fixed indices: a cheap way to catch an
                    # axis-order mistake that totals would not reveal.
                    "sampleIndices": [0, 1, 7, 37, problem.dimension - 1],
                    "sampleEnergies": [
                        float(flat[i]) for i in (0, 1, 7, 37, problem.dimension - 1)
                    ],
                },
                "circuitCost": xy_circuit_cost(
                    len(case["free_positions"]),
                    2,
                    coupled_pairs=(
                        len(case["free_positions"]) * (len(case["free_positions"]) - 1) // 2
                    )
                    * 36,
                ),
                "runs": runs,
            }
        )

    fixture = {
        "schema": "qbind-select/qaoa-golden/1",
        "generatedBy": "scripts/export_qaoa_fixture.py",
        "source": "data/processed/real_aggregated_potts_model.npz",
        "sourceChecksumSha256": checksum,
        "tolerance": 1e-9,
        "warning": (
            "Exact classical statevector simulation inside the one-hot feasible "
            "subspace. NO QUANTUM HARDWARE. No speedup claimed."
        ),
        "note": (
            "Angles are fixed, not optimised: cross-language parity of an "
            "iterative optimiser is not meaningful, but the physics for given "
            "angles must match exactly."
        ),
        "cases": cases,
    }

    out = ROOT / "web/tests/fixtures/qaoa_golden.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "written",
                "path": str(out.relative_to(ROOT)),
                "cases": len(cases),
                "runs_per_case": len(ANGLE_SETS),
                "bytes": out.stat().st_size,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
