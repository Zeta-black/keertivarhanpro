import numpy as np
from qbind_select.solvers.brute_force import solve


def test_ground_truth_is_minimum_and_lambda_sweep_runs():
    codes = np.array([[0]*8, [1]*8, [2]*8], dtype=np.uint8)
    pet, pe, pp = np.array([4., 3., 2.]), np.array([2., 1., 4.]), np.array([1., 3., 2.])
    for lam in (0., .5, 1., 2., 5.):
        output = solve(codes, pet, pe, pp, lam)
        direct = -pet + lam*(pe+pp)
        assert output["best_energy"] == direct.min()
        assert output["best_index"] == int(direct.argmin())
