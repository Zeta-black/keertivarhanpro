#!/usr/bin/env python
"""Export the exact Potts coefficients and a golden parity fixture for the web app.

The website scores peptides in the browser. To keep that honest rather than
hand-copied, both artefacts it depends on are generated from the same Python
model the benchmark uses:

  web/public/model/potts_6class_8mer.json   coefficients the browser scores with
  web/tests/fixtures/python_golden.json     exact expected values, used as a
                                            protected baseline by `npm test`

Run after any change to the scoring model or the class mapping:

    py scripts/export_web_model.py

Note: the values written here come from the EXACT Potts model, not from the
Ridge surrogate. `results/*.csv` records surrogate predictions, which differ by
roughly 5e-8 (the documented surrogate RMSE).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from qbind_select.alphabet import CLASSES, class_sequence, representative_sequence  # noqa: E402
from qbind_select.metrics import candidate_metrics  # noqa: E402
from qbind_select.qubo import safe_penalty  # noqa: E402
from qbind_select.score_model import PLASTICS, load_or_create_real, score_codes  # noqa: E402

LAMBDAS = (0.0, 0.5, 1.0, 2.0, 5.0)
FIXTURE_SEED = 20261008
RANDOM_CASES = 390


def load_model() -> dict:
    return load_or_create_real(
        ROOT / "data/raw/QA-PBP-RL-Nexus",
        ROOT / "data/processed/real_aggregated_potts_model.npz",
    )[0]


def write_coefficients(model: dict) -> Path:
    """Flatten (8,8,6,6) pair tensors to the 28 upper-triangular blocks the browser indexes."""
    pair_order = [[i, j] for i in range(8) for j in range(i + 1, 8)]
    out = {
        "schema": "qbind-potts-6class-8mer/1",
        "source": (
            "QA-PBP-RL-Nexus PottsModel_Energies, backbone bb1, source positions 2..9, "
            "arithmetic mean 20aa->6class aggregation; canonical binding score = -raw Potts energy"
        ),
        "orientation": "higher canonical binding score = stronger predicted binding",
        "positions": 8,
        "classes": list(CLASSES),
        "intercept": 0.0,
        "pairOrder": pair_order,
    }
    for plastic in PLASTICS:
        linear = model[plastic]["linear"]
        pair = model[plastic]["pair"]
        out[plastic] = {
            "linear": [[float(v) for v in row] for row in linear],
            "pair": [
                [[float(pair[i, j, a, b]) for b in range(6)] for a in range(6)]
                for i, j in pair_order
            ],
        }
    path = ROOT / "web/public/model/potts_6class_8mer.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    print(f"{path.relative_to(ROOT)}  {len(text)} bytes  sha256={hashlib.sha256(text.encode()).hexdigest()[:16]}")
    return path


def fixture_sequences() -> np.ndarray:
    """Six uniform sequences, two ordered ones, then deterministic random coverage."""
    seqs = [[a] * 8 for a in range(6)]
    seqs.append(list(range(6)) + [0, 1])
    seqs.append(list(reversed(range(6))) + [5, 4])
    rng = np.random.default_rng(FIXTURE_SEED)
    seqs.extend(rng.integers(0, 6, size=(RANDOM_CASES, 8)).tolist())
    return np.array(seqs, dtype=int)


def exact_penalties(model: dict) -> dict[str, float]:
    """safe_penalty computed on the EXACT model coefficients, per lambda."""
    penalties = {}
    for lam in LAMBDAS:
        linear = (
            -model["PET"]["linear"] + lam * (model["PE"]["linear"] + model["PP"]["linear"])
        ).reshape(-1)
        quadratic = {}
        for i in range(8):
            for j in range(i + 1, 8):
                for a in range(6):
                    for b in range(6):
                        quadratic[(i * 6 + a, j * 6 + b)] = float(
                            -model["PET"]["pair"][i, j, a, b]
                            + lam
                            * (model["PE"]["pair"][i, j, a, b] + model["PP"]["pair"][i, j, a, b])
                        )
        penalties[str(lam)] = float(safe_penalty(linear, quadratic, 2.0))
    return penalties


def write_golden(model: dict) -> Path:
    cases = []
    for row in fixture_sequences():
        scores = {p: float(score_codes(row.reshape(1, -1), model[p])[0]) for p in PLASTICS}
        met = candidate_metrics(row, scores["PET"], scores["PE"], scores["PP"])
        cases.append(
            {
                "codes": [int(v) for v in row],
                "classSequence": class_sequence(row),
                "representative": representative_sequence(row),
                "scores": scores,
                "objectives": {
                    str(lam): float(-scores["PET"] + lam * (scores["PE"] + scores["PP"]))
                    for lam in LAMBDAS
                },
                "metrics": {
                    "meanOffTarget": met["mean_offtarget"],
                    "worstOffTarget": met["worst_offtarget"],
                    "marginMean": met["margin_mean"],
                    "marginWorst": met["margin_worst"],
                    "aromaticFraction": met["aromatic_fraction"],
                    "hydrophobicFraction": met["hydrophobic_fraction"],
                    "polarFraction": met["polar_fraction"],
                    "netChargeClassBalance": met["net_charge_class_balance"],
                    "warnings": met["warnings"],
                },
            }
        )
    golden = {
        "generated_by": "scripts/export_web_model.py; exact Potts model, NOT the Ridge surrogate",
        "model_source": "data/processed/real_aggregated_potts_model.npz",
        "note": (
            "Published results/*.csv values come from the Ridge surrogate and differ by ~5e-8; "
            "these are the exact model values."
        ),
        "lambdas": list(LAMBDAS),
        "safePenalty": exact_penalties(model),
        "cases": cases,
    }
    path = ROOT / "web/tests/fixtures/python_golden.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(golden, indent=1)
    path.write_text(text, encoding="utf-8")
    print(f"{path.relative_to(ROOT)}  {len(cases)} cases  sha256={hashlib.sha256(text.encode()).hexdigest()[:16]}")
    return path


def main() -> None:
    model = load_model()
    write_coefficients(model)
    write_golden(model)
    print("done")


if __name__ == "__main__":
    main()
