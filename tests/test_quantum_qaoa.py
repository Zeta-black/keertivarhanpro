"""Tests for the gate-model quantum layer.

These run on the committed proxy scoring model, so they need no external
dataset, and on small slices, so the whole file finishes in seconds. The
expensive full-size (48-qubit) run lives in `scripts/run_quantum.py`.

The checks that matter most are the cross-validations: the reduction, the QUBO
form, the Ising form and the class-space tensor are four different code paths
to the same energy, and each is checked against `score_codes`, which the
classical pipeline already relies on.
"""

import numpy as np
import pytest

from qbind_select.alphabet import encode
from qbind_select.score_model import PLASTICS, _coefficients, score_codes
from qbind_select.quantum.circuit import (
    circuit_summary,
    ising_energy,
    qubo_to_ising,
    xy_circuit_cost,
)
from qbind_select.quantum.qaoa import (
    apply_mixer,
    cost_diagonal,
    expectation,
    nelder_mead,
    optimise_qaoa,
    qaoa_statevector,
    sample_counts,
    scaled_phase_diagonal,
    state_to_slot_classes,
    valid_one_hot_mask,
)
from qbind_select.quantum.subproblem import (
    ALPHABET_SIZE,
    build_subproblem,
    combine_class_coefficients,
    exact_slice_optimum,
    slice_energy,
)
from qbind_select.quantum.xy_qaoa import (
    apply_xy_mixer,
    build_xy_problem,
    interpolate_angles,
    optimise_xy_qaoa,
    probabilities_of,
    scaled_phase,
    sweep_xy_depths,
    xy_qaoa_state,
)

LAMBDA = 1.0
CONTEXT = (2, 3, 0, 0, 2, 2, 1, 2)


@pytest.fixture(scope="module")
def coefficients():
    return _coefficients()


@pytest.fixture(scope="module")
def two_slot(coefficients):
    return build_subproblem(coefficients, LAMBDA, CONTEXT, free_count=2)


# --------------------------------------------------------------------------
# The reduction is the riskiest piece: it folds clamped-context interactions
# into effective one-body terms. If it is wrong, everything downstream is
# wrong but still self-consistent. So check it against score_codes directly.
# --------------------------------------------------------------------------


def _reference_objective(codes, coefficients, lam=LAMBDA):
    """Objective computed the way the classical pipeline computes it."""
    codes = np.asarray(codes, dtype=np.int64).reshape(1, -1)
    scores = {p: float(score_codes(codes, coefficients[p])[0]) for p in PLASTICS}
    return -scores["PET"] + lam * (scores["PE"] + scores["PP"])


def test_reduction_matches_full_scoring(two_slot, coefficients):
    """Every assignment in the slice must reproduce the full-model objective."""
    worst = 0.0
    for a in range(ALPHABET_SIZE):
        for b in range(ALPHABET_SIZE):
            codes = two_slot.codes_for((a, b))
            worst = max(worst, abs(slice_energy(two_slot, (a, b)) - _reference_objective(codes, coefficients)))
    assert worst < 1e-9, f"reduction drifts from score_codes by {worst}"


def test_combine_class_coefficients_matches_scoring(coefficients):
    """The combined class-space objective must equal -PET + lam*(PE+PP)."""
    linear, pair, intercept = combine_class_coefficients(coefficients, LAMBDA)
    rng = np.random.default_rng(7)
    for _ in range(20):
        codes = rng.integers(0, ALPHABET_SIZE, size=8)
        energy = intercept + sum(float(linear[i, codes[i]]) for i in range(8))
        for i in range(8):
            for j in range(i + 1, 8):
                energy += float(pair[i, j, codes[i], codes[j]])
        assert abs(energy - _reference_objective(codes, coefficients)) < 1e-9


def test_full_width_reduction_is_the_whole_problem(coefficients):
    """With all 8 positions free the slice is the entire search space."""
    problem = build_subproblem(coefficients, LAMBDA, CONTEXT, free_positions=range(8))
    assert problem.num_qubits == 48
    assert problem.coefficient_report["clamped_positions"] == []
    rng = np.random.default_rng(11)
    for _ in range(10):
        codes = tuple(int(c) for c in rng.integers(0, ALPHABET_SIZE, size=8))
        assert abs(slice_energy(problem, codes) - _reference_objective(codes, coefficients)) < 1e-9


def test_reduction_rejects_bad_input(coefficients):
    with pytest.raises(ValueError):
        build_subproblem(coefficients, LAMBDA, (0, 0, 0), free_count=2)
    with pytest.raises(ValueError):
        build_subproblem(coefficients, LAMBDA, CONTEXT, free_positions=[0, 0])
    with pytest.raises(ValueError):
        build_subproblem(coefficients, LAMBDA, CONTEXT, free_positions=[0, 9])
    with pytest.raises(ValueError):
        build_subproblem(coefficients, LAMBDA, (9,) * 8, free_count=2)


# --------------------------------------------------------------------------
# Cost Hamiltonian: bit convention, QUBO/Ising equivalence, penalty validity
# --------------------------------------------------------------------------


def test_cost_diagonal_bit_convention(two_slot):
    """Basis-state index s must encode variable u in bit u."""
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    n = two_slot.num_qubits
    rng = np.random.default_rng(3)
    for _ in range(40):
        state = int(rng.integers(0, 1 << n))
        bits = np.array([(state >> u) & 1 for u in range(n)], dtype=float)
        expected = (
            two_slot.offset
            + float(np.dot(two_slot.linear, bits))
            + float(sum(
                two_slot.quadratic[u, v] * bits[u] * bits[v]
                for u, v in zip(*np.nonzero(two_slot.quadratic))
            ))
        )
        assert abs(diag[state] - expected) < 1e-9


def test_qubo_and_ising_forms_agree(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    h, j, constant = qubo_to_ising(two_slot.linear, two_slot.quadratic, two_slot.offset)
    rng = np.random.default_rng(5)
    for _ in range(50):
        state = int(rng.integers(0, 1 << two_slot.num_qubits))
        bits = [(state >> u) & 1 for u in range(two_slot.num_qubits)]
        assert abs(ising_energy(bits, h, j, constant) - diag[state]) < 1e-7


def test_penalty_makes_the_ground_state_feasible(two_slot):
    """The safe penalty must force the QUBO optimum to be one-hot valid."""
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    ground = int(np.argmin(diag))
    classes = state_to_slot_classes(ground, two_slot.num_qubits)
    assert classes is not None, "penalised ground state is not one-hot valid"
    assert classes == exact_slice_optimum(two_slot)["best_slot_classes"]


def test_valid_mask_counts_feasible_states(two_slot):
    mask = valid_one_hot_mask(two_slot.num_qubits)
    slots = two_slot.num_qubits // ALPHABET_SIZE
    assert int(mask.sum()) == ALPHABET_SIZE ** slots


def test_objective_diagonal_matches_slice_energy(two_slot):
    diag = cost_diagonal(
        two_slot.objective_only_linear,
        two_slot.objective_only_quadratic,
        two_slot.objective_only_offset,
    )
    mask = valid_one_hot_mask(two_slot.num_qubits)
    for state in np.nonzero(mask)[0]:
        classes = state_to_slot_classes(int(state), two_slot.num_qubits)
        assert abs(diag[state] - slice_energy(two_slot, classes)) < 1e-9


def test_exact_slice_optimum_is_the_minimum(two_slot):
    exact = exact_slice_optimum(two_slot)
    assert exact["evaluated"] == ALPHABET_SIZE ** 2
    assert exact["best_energy"] <= exact["mean_energy"] <= exact["worst_energy"]
    assert exact["best_energy"] == min(energy for _, energy in exact["ranked"])


# --------------------------------------------------------------------------
# X-mixer QAOA simulator
# --------------------------------------------------------------------------


def test_mixer_is_unitary():
    n = 8
    rng = np.random.default_rng(13)
    state = rng.normal(size=1 << n) + 1j * rng.normal(size=1 << n)
    state /= np.linalg.norm(state)
    for beta in (0.0, 0.3, 1.1, -0.9, np.pi):
        evolved = apply_mixer(state.copy(), beta, n)
        assert abs(np.linalg.norm(evolved) - 1.0) < 1e-12


def test_mixer_at_zero_is_identity():
    n = 6
    rng = np.random.default_rng(17)
    state = rng.normal(size=1 << n) + 1j * rng.normal(size=1 << n)
    assert np.max(np.abs(apply_mixer(state.copy(), 0.0, n) - state)) < 1e-15


def test_mixer_flips_a_single_qubit_at_quarter_turn():
    """beta = pi/2 maps |0..0> to a state with all amplitude on |1..1>.

    exp(-i*(pi/2)*X) = -i*X up to phase, so every qubit flips. This pins the
    sign and factor conventions, which a norm check alone would not catch.
    """
    n = 3
    state = np.zeros(1 << n, dtype=np.complex128)
    state[0] = 1.0
    evolved = apply_mixer(state, np.pi / 2, n)
    probability = np.abs(evolved) ** 2
    assert probability[(1 << n) - 1] > 1 - 1e-12


def test_zero_depth_expectation_is_the_uniform_mean(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    phase, _, _ = scaled_phase_diagonal(diag)
    state = qaoa_statevector(phase, [], [], two_slot.num_qubits)
    assert abs(np.linalg.norm(state) - 1.0) < 1e-12
    assert abs(expectation(state, diag) - diag.mean()) < 1e-9


def test_statevector_stays_normalised(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    phase, _, _ = scaled_phase_diagonal(diag)
    state = qaoa_statevector(phase, [0.3, 0.9], [0.5, 0.2], two_slot.num_qubits)
    assert abs(np.linalg.norm(state) - 1.0) < 1e-11


def test_statevector_rejects_mismatched_angles(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    phase, _, _ = scaled_phase_diagonal(diag)
    with pytest.raises(ValueError):
        qaoa_statevector(phase, [0.1, 0.2], [0.3], two_slot.num_qubits)


def test_phase_rescaling_is_mean_zero_unit_span(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    phase, scale, mean = scaled_phase_diagonal(diag)
    assert abs(phase.mean()) < 1e-12
    assert abs((phase.max() - phase.min()) - 1.0) < 1e-12
    assert np.max(np.abs(phase * scale + mean - diag)) < 1e-9


def test_sampling_is_seeded_and_sums_to_shots(two_slot):
    diag = cost_diagonal(two_slot.linear, two_slot.quadratic, two_slot.offset)
    phase, _, _ = scaled_phase_diagonal(diag)
    state = qaoa_statevector(phase, [0.4], [0.6], two_slot.num_qubits)
    first = sample_counts(state, 512, seed=1)
    assert sum(first.values()) == 512
    assert first == sample_counts(state, 512, seed=1)
    assert first != sample_counts(state, 512, seed=2)


def test_penalty_qaoa_runs_and_reports_honestly(two_slot):
    exact = exact_slice_optimum(two_slot)
    result = optimise_qaoa(two_slot, depth=1, exact=exact, shots=256, seed=42)
    assert result.num_qubits == 12
    assert 0.0 <= result.valid_probability <= 1.0
    assert result.exact_best_energy == exact["best_energy"]
    assert result.shots["shots"] == 256
    # The penalty encoding leaks probability onto infeasible states; that is
    # the defect the XY ansatz exists to remove, so it must stay visible.
    assert result.valid_probability < 1.0
    assert any("NO QUANTUM" in note.upper() for note in result.notes)


def test_xy_ansatz_beats_the_penalty_encoding_on_the_same_slice(coefficients, two_slot):
    """Head-to-head on one objective: the central claim of the quantum layer.

    Both solvers get the identical two-position slice. The penalty encoding
    must spend its angles enforcing one-hot validity, so its margin over the
    random baseline should be clearly smaller than the XY ansatz's margin -
    and its validity rate should be below 1 while XY's is exactly 1.

    Asserted as a *relative* comparison, not an absolute threshold: the
    penalty-to-objective scale ratio differs between the proxy model used here
    and the real Potts model used in `scripts/run_quantum.py`, so an absolute
    cut-off would be a model artefact rather than a property of the method.
    """
    exact = exact_slice_optimum(two_slot)
    penalty_result = optimise_qaoa(two_slot, depth=2, exact=exact, shots=0, seed=42)
    penalty_margin = penalty_result.approximation_ratio - penalty_result.random_baseline_ratio

    xy_problem = build_xy_problem(
        coefficients, LAMBDA, CONTEXT, free_positions=two_slot.free_positions
    )
    assert xy_problem.best_energy == pytest.approx(exact["best_energy"], abs=1e-9)
    xy_result = optimise_xy_qaoa(
        xy_problem, depth=2, restarts=2, max_iterations=150, shots=0, seed=42
    )
    xy_margin = xy_result.approximation_ratio - xy_result.random_baseline_ratio

    assert xy_result.validity_rate == 1.0
    assert penalty_result.valid_probability < 1.0
    assert xy_margin > penalty_margin, (
        f"XY margin {xy_margin:.4f} did not beat penalty margin {penalty_margin:.4f}"
    )


def test_qaoa_rejects_zero_depth(two_slot):
    with pytest.raises(ValueError):
        optimise_qaoa(two_slot, depth=0)


# --------------------------------------------------------------------------
# Nelder-Mead, validated against SciPy
# --------------------------------------------------------------------------


def test_nelder_mead_matches_scipy():
    scipy_optimize = pytest.importorskip("scipy.optimize")

    def rosenbrock(v):
        return float((1 - v[0]) ** 2 + 100 * (v[1] - v[0] ** 2) ** 2)

    start = np.array([-1.2, 1.0])
    mine, my_value, _ = nelder_mead(rosenbrock, start, max_iterations=4000, tolerance=1e-14)
    theirs = scipy_optimize.minimize(
        rosenbrock, start, method="Nelder-Mead", options={"xatol": 1e-10, "fatol": 1e-12}
    )
    assert my_value < 1e-8
    assert np.allclose(mine, theirs.x, atol=1e-3)


def test_nelder_mead_is_deterministic():
    def quadratic(v):
        return float(np.sum((v - np.array([0.3, -0.7, 1.1])) ** 2))

    start = np.zeros(3)
    first = nelder_mead(quadratic, start)
    second = nelder_mead(quadratic, start)
    assert np.array_equal(first[0], second[0])
    assert first[1] == second[1]


# --------------------------------------------------------------------------
# XY-mixer QAOA in the feasible subspace
# --------------------------------------------------------------------------


@pytest.fixture(scope="module")
def xy_small(coefficients):
    """Three free positions: 216-dimensional subspace, 18 nominal qubits."""
    return build_xy_problem(coefficients, LAMBDA, CONTEXT, free_count=3)


def test_xy_objective_tensor_matches_scoring(xy_small, coefficients):
    """Independent check of the broadcast tensor construction."""
    worst = 0.0
    for index in range(xy_small.dimension):
        classes = xy_small.slot_classes_of(index)
        codes = xy_small.codes_for(classes)
        worst = max(worst, abs(xy_small.objective.ravel()[index] - _reference_objective(codes, coefficients)))
    assert worst < 1e-9, f"XY tensor drifts from score_codes by {worst}"


def test_xy_problem_reports_the_true_optimum(xy_small):
    flat = xy_small.objective.ravel()
    assert xy_small.best_energy == float(flat.min())
    assert xy_small.worst_energy == float(flat.max())
    assert xy_small.best_index == int(np.argmin(flat))
    assert xy_small.nominal_qubits == 18
    assert xy_small.dimension == ALPHABET_SIZE ** 3


def test_xy_mixer_is_unitary(xy_small):
    rng = np.random.default_rng(23)
    state = (
        rng.normal(size=xy_small.shape) + 1j * rng.normal(size=xy_small.shape)
    ).astype(np.complex128)
    state /= np.linalg.norm(state)
    for beta in (0.0, 0.21, 1.4, -2.3, np.pi):
        evolved = apply_xy_mixer(state.copy(), beta)
        assert abs(np.linalg.norm(evolved) - 1.0) < 1e-11


def test_xy_mixer_at_zero_is_identity(xy_small):
    rng = np.random.default_rng(29)
    state = (
        rng.normal(size=xy_small.shape) + 1j * rng.normal(size=xy_small.shape)
    ).astype(np.complex128)
    assert np.max(np.abs(apply_xy_mixer(state.copy(), 0.0) - state)) < 1e-15


def test_xy_mixer_preserves_uniform_superposition(xy_small):
    """The product-W state is an eigenvector: the mixer may only rephase it."""
    state = np.full(xy_small.shape, 1.0 / np.sqrt(xy_small.dimension), dtype=np.complex128)
    evolved = apply_xy_mixer(state.copy(), 0.37)
    ratio = evolved.ravel() / state.ravel()
    assert np.max(np.abs(ratio - ratio[0])) < 1e-12
    assert abs(abs(ratio[0]) - 1.0) < 1e-12


def test_xy_zero_depth_expectation_is_the_uniform_mean(xy_small):
    state = xy_qaoa_state(scaled_phase(xy_small), [], [])
    assert abs(np.linalg.norm(state) - 1.0) < 1e-12
    energy = float(np.dot(probabilities_of(state), xy_small.objective.ravel()))
    assert abs(energy - xy_small.mean_energy) < 1e-9


def test_xy_statevector_stays_normalised(xy_small):
    state = xy_qaoa_state(scaled_phase(xy_small), [0.4, 0.8], [0.6, 0.3])
    assert abs(np.linalg.norm(state) - 1.0) < 1e-11


def test_xy_statevector_rejects_mismatched_angles(xy_small):
    with pytest.raises(ValueError):
        xy_qaoa_state(scaled_phase(xy_small), [0.1], [0.2, 0.3])


def test_xy_qaoa_beats_random_and_is_always_feasible(xy_small):
    result = optimise_xy_qaoa(xy_small, depth=2, restarts=2, max_iterations=120, shots=512, seed=42)
    assert result.validity_rate == 1.0
    assert result.approximation_ratio > result.random_baseline_ratio
    assert result.shots["validity_rate"] == 1.0
    assert result.shots["shots"] == 512
    # Every sampled design must decode to a real 8-position sequence.
    for design in result.top_designs:
        assert len(design["codes"]) == 8
        assert all(0 <= c < ALPHABET_SIZE for c in design["codes"])
    assert any("NO QUANTUM HARDWARE" in note.upper() for note in result.notes)


def test_xy_qaoa_concentrates_on_the_proven_optimum(xy_small):
    """The optimum must be far more likely than under uniform sampling."""
    result = optimise_xy_qaoa(xy_small, depth=3, restarts=2, max_iterations=150, shots=0, seed=42)
    assert result.enrichment_over_uniform > 2.0
    assert result.optimum_rank <= 5
    assert result.exact_best_energy == xy_small.best_energy


def test_xy_qaoa_is_reproducible(xy_small):
    first = optimise_xy_qaoa(xy_small, depth=2, restarts=2, max_iterations=80, shots=128, seed=7)
    second = optimise_xy_qaoa(xy_small, depth=2, restarts=2, max_iterations=80, shots=128, seed=7)
    assert first.gammas == second.gammas
    assert first.betas == second.betas
    assert first.expectation == second.expectation
    assert first.shots == second.shots


def test_xy_qaoa_rejects_zero_depth(xy_small):
    with pytest.raises(ValueError):
        optimise_xy_qaoa(xy_small, depth=0)


def test_interpolate_angles_lifts_schedule_length():
    angles = np.array([0.2, 0.6, 0.9, 0.5])  # p=2
    lifted = interpolate_angles(angles, 3)
    assert len(lifted) == 6
    assert lifted[0] == pytest.approx(0.2)
    assert lifted[2] == pytest.approx(0.6)
    assert lifted[3] == pytest.approx(0.9)
    assert lifted[5] == pytest.approx(0.5)


def test_depth_sweep_does_not_regress(xy_small):
    """INTERP seeding exists to stop deeper circuits scoring worse. Verify it."""
    results = sweep_xy_depths(
        xy_small, depths=(1, 2, 3), restarts=1, max_iterations=120, shots=0
    )
    assert [r.depth for r in results] == [1, 2, 3]
    ratios = [r.approximation_ratio for r in results]
    for shallower, deeper in zip(ratios, ratios[1:]):
        assert deeper >= shallower - 1e-6, f"depth sweep regressed: {ratios}"


# --------------------------------------------------------------------------
# Circuit accounting
# --------------------------------------------------------------------------


def test_circuit_counts_match_the_emitted_gate_list(two_slot):
    summary = circuit_summary(two_slot, depth=2)
    kinds = {}
    for gate in summary.gates:
        kinds[gate.kind] = kinds.get(gate.kind, 0) + 1
    assert kinds["H"] == summary.counts["hadamard"]
    assert kinds["RZZ"] == summary.counts["rzz"]
    assert kinds["RX"] == summary.counts["rx"]
    assert summary.counts["cnot_lower_bound"] == 2 * kinds["RZZ"]
    assert summary.counts["variational_parameters"] == 4


def test_circuit_qubit_labels_cover_every_qubit(two_slot):
    summary = circuit_summary(two_slot, depth=1)
    labels = summary.qubit_labels
    assert len(labels) == two_slot.num_qubits
    assert sorted(entry["qubit"] for entry in labels) == list(range(two_slot.num_qubits))
    for entry in labels:
        assert entry["position"] in two_slot.free_positions


def test_circuit_gate_angles_are_nonzero(two_slot):
    """A gate list full of zero-angle rotations would be a diagram, not a circuit."""
    summary = circuit_summary(two_slot, depth=1)
    rzz = [gate for gate in summary.gates if gate.kind == "RZZ"]
    assert rzz and all(abs(gate.coefficient) > 0 for gate in rzz)


def test_xy_circuit_cost_scales_with_depth_and_trotter():
    one = xy_circuit_cost(8, 1, 1008)
    two = xy_circuit_cost(8, 2, 1008)
    trotterised = xy_circuit_cost(8, 1, 1008, trotter_steps=3)
    assert one["qubits"] == 48
    assert two["phase_separator_cnot"] == 2 * one["phase_separator_cnot"]
    assert trotterised["mixer_cnot"] == 3 * one["mixer_cnot"]
    assert one["xy_pair_terms_per_layer"] == 8 * 15
    assert any("NOT EXECUTED" in caveat.upper() for caveat in one["caveats"])
