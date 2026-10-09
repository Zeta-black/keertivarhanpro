import numpy as np
from qbind_select.alphabet import encode
from qbind_select.enumerate_space import enumerate_codes
from qbind_select.qubo import add_one_hot_constraint, combine_objective, qubo_energy, safe_penalty
from qbind_select.score_model import _coefficients, score_codes
from qbind_select.surrogate import fit_surrogate


def _fitted():
    codes = enumerate_codes()[:12000]
    co = _coefficients()
    return {p: fit_surrogate(codes, score_codes(codes, co[p]), 1e-6, 4+i, 7000, 2000, 2000)[0] for i,p in enumerate(("PET","PE","PP"))}


def test_valid_energy_equals_objective():
    fitted = _fitted()
    linear, quadratic, offset = combine_objective(fitted, 1.0)
    l, q, c = add_one_hot_constraint(linear, quadratic, offset, safe_penalty(linear, quadratic))
    x = encode(np.array([0, 1, 2, 3, 4, 5, 0, 1]))
    expected = offset + np.dot(linear, x) + sum(v*x[a]*x[b] for (a,b),v in quadratic.items())
    assert abs(qubo_energy(x, l, q, c) - expected) < 1e-8
