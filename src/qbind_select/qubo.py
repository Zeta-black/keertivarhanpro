from __future__ import annotations

import numpy as np

from .alphabet import encode


def combine_objective(surrogates: dict, lam: float):
    """Return E=-PET+lambda*(PE+PP), before one-hot penalty."""
    linear = -surrogates["PET"].linear + lam * (surrogates["PE"].linear + surrogates["PP"].linear)
    quadratic = {}
    keys = set().union(*(s.quadratic for s in surrogates.values()))
    for key in keys:
        quadratic[key] = (-surrogates["PET"].quadratic.get(key, 0.0) + lam * (surrogates["PE"].quadratic.get(key, 0.0) + surrogates["PP"].quadratic.get(key, 0.0)))
    offset = -surrogates["PET"].model.intercept_ + lam * (surrogates["PE"].model.intercept_ + surrogates["PP"].model.intercept_)
    return linear, quadratic, float(offset)


def safe_penalty(linear: np.ndarray, quadratic: dict, multiplier: float = 2.0) -> float:
    """Conservative bound: larger than the full nonconstant objective range."""
    return float(multiplier * (np.abs(linear).sum() + sum(abs(x) for x in quadratic.values())) + 1.0)


def add_one_hot_constraint(linear, quadratic, offset, penalty: float, length: int = 8, alphabet_size: int = 6):
    linear, quadratic = linear.copy(), quadratic.copy()
    for position in range(length):
        vars_ = [position * alphabet_size + a for a in range(alphabet_size)]
        for u in vars_:
            linear[u] += -penalty
        for ai, u in enumerate(vars_):
            for v in vars_[ai + 1:]:
                quadratic[(u, v)] = quadratic.get((u, v), 0.0) + 2.0 * penalty
        offset += penalty
    return linear, quadratic, float(offset)


def qubo_energy(x, linear, quadratic, offset=0.0) -> float:
    x = np.asarray(x, dtype=float)
    return float(offset + np.dot(linear, x) + sum(value * x[u] * x[v] for (u, v), value in quadratic.items()))


def objective_energy(codes, surrogates, lam: float) -> float:
    x = encode(codes)
    values = {p: surrogates[p].model.intercept_ + np.dot(surrogates[p].linear, x) + sum(c * x[u] * x[v] for (u, v), c in surrogates[p].quadratic.items()) for p in surrogates}
    return float(-values["PET"] + lam * (values["PE"] + values["PP"]))


def make_bqm(linear, quadratic, offset):
    import dimod
    return dimod.BinaryQuadraticModel(linear, quadratic, offset, dimod.BINARY)
