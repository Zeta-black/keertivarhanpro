import numpy as np
from qbind_select.qubo import add_one_hot_constraint, qubo_energy


def test_invalid_position_gets_penalty():
    linear = np.zeros(48); quadratic = {}; offset = 0.; penalty = 13.
    l, q, c = add_one_hot_constraint(linear, quadratic, offset, penalty)
    valid = np.zeros(48); valid[[0, 6, 12, 18, 24, 30, 36, 42]] = 1
    invalid = valid.copy(); invalid[1] = 1
    assert abs(qubo_energy(valid,l,q,c)) < 1e-9
    assert abs(qubo_energy(invalid,l,q,c) - penalty) < 1e-9
