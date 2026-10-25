"""Exact statevector QAOA for the reduced selectivity QUBO.

This is a real gate-model variational quantum algorithm, simulated exactly on
a classical CPU. It is NOT quantum hardware and it claims NO speedup. See
`qbind_select.quantum.__init__` for the full scope statement.

Algorithm
---------
QAOA (Farhi, Goldstone, Gutmann 2014) with the standard construction:

    |psi(gamma, beta)> = prod_{l=1..p} [ U_B(beta_l) U_C(gamma_l) ] |+>^n

    U_C(gamma) = exp(-i * gamma * C_hat)   phase separator, diagonal
    U_B(beta)  = exp(-i * beta * sum_u X_u) = prod_u RX(2 * beta_u)

C is the penalised sub-QUBO cost, diagonal in the computational basis, so
U_C is an elementwise phase multiply - no matrix is ever formed.

Cost rescaling, and why it is not a fudge
-----------------------------------------
Raw energies here run to hundreds of units and the one-hot penalty to
thousands. Applied directly, exp(-i*gamma*C) wraps through many full turns for
any gamma of order 1, which leaves the optimiser searching a violently
oscillating landscape. So the phase separator uses

    C_hat = (C - mean(C)) / (max(C) - min(C))

Both operations are safe by construction, not by assumption:
  * subtracting a constant multiplies the state by a global phase, which is
    physically unobservable and cannot change any measurement probability;
  * dividing by a positive constant only redefines the units of gamma.
The *reported* energies are always in original units, computed from the
unscaled diagonal. This is standard QAOA practice for weighted problems.

Measurement
-----------
Expectation values are computed exactly from the statevector (the
infinite-shot limit). Finite-shot sampling is available separately via
`sample_counts`, seeded, so a shot-noise figure can be reported honestly
rather than conflated with the exact expectation.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .subproblem import ALPHABET_SIZE, SubProblem

# n=18 qubits is 262,144 amplitudes (4 MB complex128) and simulates in well
# under a second. n=24 would be 268 MB and minutes per optimisation; refuse it
# rather than appear to hang.
MAX_QUBITS = 20


def _require_simulable(num_qubits: int) -> None:
    if num_qubits > MAX_QUBITS:
        raise ValueError(
            f"{num_qubits} qubits exceeds the exact-simulation limit of {MAX_QUBITS}. "
            "A statevector needs 2**n complex amplitudes; this is a hard memory "
            "bound, not a tuning parameter."
        )


def cost_diagonal(linear: np.ndarray, quadratic: np.ndarray, offset: float) -> np.ndarray:
    """Diagonal of the cost Hamiltonian: C(x) for every basis state.

    Basis-state index s encodes variable u in bit u (little-endian), so
    x_u = (s >> u) & 1. This matches `sample_counts` and the circuit's qubit
    numbering; getting it inconsistent would silently permute the answer, so
    the convention is asserted by `tests/test_qaoa.py`.
    """
    n = len(linear)
    _require_simulable(n)
    size = 1 << n
    states = np.arange(size, dtype=np.int64)
    bits = ((states[:, None] >> np.arange(n, dtype=np.int64)) & 1).astype(np.float64)
    diag = np.full(size, float(offset), dtype=np.float64)
    diag += bits @ np.asarray(linear, dtype=np.float64)
    us, vs = np.nonzero(quadratic)
    for u, v in zip(us.tolist(), vs.tolist()):
        diag += float(quadratic[u, v]) * bits[:, u] * bits[:, v]
    return diag


def valid_one_hot_mask(num_qubits: int) -> np.ndarray:
    """Boolean mask of basis states that are valid one-hot per 6-variable slot."""
    _require_simulable(num_qubits)
    slots = num_qubits // ALPHABET_SIZE
    size = 1 << num_qubits
    slot_mask = (1 << ALPHABET_SIZE) - 1
    states = np.arange(size, dtype=np.int64)
    mask = np.ones(size, dtype=bool)
    for slot in range(slots):
        block = (states >> (slot * ALPHABET_SIZE)) & slot_mask
        popcount = np.zeros(size, dtype=np.int64)
        for bit in range(ALPHABET_SIZE):
            popcount += (block >> bit) & 1
        mask &= popcount == 1
    return mask


def scaled_phase_diagonal(diag: np.ndarray):
    """Return (C_hat, scale, mean) for the phase separator. See module docstring."""
    mean = float(diag.mean())
    spread = float(diag.max() - diag.min())
    scale = spread if spread > 0 else 1.0
    return (diag - mean) / scale, scale, mean


def apply_mixer(state: np.ndarray, beta: float, num_qubits: int) -> np.ndarray:
    """Apply exp(-i * beta * sum_u X_u) = prod_u RX(2*beta).

    Done qubit by qubit by reshaping the amplitude vector so that the axis for
    qubit u is isolated. Each qubit costs one pass over the state, so a mixer
    layer is O(n * 2**n) with no matrix allocation.
    """
    cos, sin = np.cos(beta), np.sin(beta)
    for u in range(num_qubits):
        low = 1 << u
        high = 1 << (num_qubits - u - 1)
        view = state.reshape(high, 2, low)
        a = view[:, 0, :].copy()
        b = view[:, 1, :].copy()
        view[:, 0, :] = cos * a - 1j * sin * b
        view[:, 1, :] = cos * b - 1j * sin * a
    return state


def qaoa_statevector(
    phase_diag: np.ndarray, gammas, betas, num_qubits: int
) -> np.ndarray:
    """Build |psi(gamma, beta)> from the uniform superposition."""
    if len(gammas) != len(betas):
        raise ValueError("gammas and betas must have the same length p")
    size = 1 << num_qubits
    if phase_diag.shape != (size,):
        raise ValueError(f"phase diagonal must have 2**{num_qubits} = {size} entries")
    state = np.full(size, 1.0 / np.sqrt(size), dtype=np.complex128)
    for gamma, beta in zip(gammas, betas):
        state *= np.exp(-1j * float(gamma) * phase_diag)
        state = apply_mixer(state, float(beta), num_qubits)
    return state


def expectation(state: np.ndarray, diag: np.ndarray) -> float:
    """<psi|C|psi> for a diagonal C: the exact, infinite-shot expectation."""
    probabilities = np.abs(state) ** 2
    return float(np.dot(probabilities, diag))


def _ramp_start(p: int) -> np.ndarray:
    """Linear-ramp initial angles: the standard QAOA warm start.

    gamma grows and beta shrinks across layers, mimicking a discretised
    adiabatic schedule. Far better than random initialisation and completely
    deterministic, so the reported run is reproducible without a seed.
    """
    layers = np.arange(1, p + 1, dtype=np.float64)
    gammas = 0.7 * layers / p
    betas = 0.7 * (1.0 - (layers - 1) / p)
    return np.concatenate([gammas, betas])


def nelder_mead(
    function,
    start: np.ndarray,
    step: float = 0.25,
    max_iterations: int = 2000,
    tolerance: float = 1e-10,
):
    """Minimise `function` with the Nelder-Mead simplex method.

    Hand-written rather than taken from SciPy for one reason: the browser
    implementation in `web/src/science/qaoa.ts` must run the identical
    algorithm, and a cross-language parity test is only meaningful if both
    sides take the same steps. `tests/test_qaoa.py` checks this implementation
    against `scipy.optimize.minimize` on the same objective.

    Standard coefficients: reflection 1, expansion 2, contraction 0.5,
    shrink 0.5.
    """
    start = np.asarray(start, dtype=np.float64)
    dimension = len(start)
    simplex = np.empty((dimension + 1, dimension), dtype=np.float64)
    simplex[0] = start
    for i in range(dimension):
        point = start.copy()
        point[i] += step
        simplex[i + 1] = point
    values = np.array([function(point) for point in simplex], dtype=np.float64)
    evaluations = dimension + 1

    for _ in range(max_iterations):
        order = np.argsort(values, kind="stable")
        simplex, values = simplex[order], values[order]
        if abs(values[-1] - values[0]) <= tolerance * (abs(values[0]) + tolerance):
            break
        centroid = simplex[:-1].mean(axis=0)
        reflected = centroid + (centroid - simplex[-1])
        reflected_value = function(reflected)
        evaluations += 1
        if reflected_value < values[0]:
            expanded = centroid + 2.0 * (centroid - simplex[-1])
            expanded_value = function(expanded)
            evaluations += 1
            if expanded_value < reflected_value:
                simplex[-1], values[-1] = expanded, expanded_value
            else:
                simplex[-1], values[-1] = reflected, reflected_value
        elif reflected_value < values[-2]:
            simplex[-1], values[-1] = reflected, reflected_value
        else:
            contracted = centroid + 0.5 * (simplex[-1] - centroid)
            contracted_value = function(contracted)
            evaluations += 1
            if contracted_value < values[-1]:
                simplex[-1], values[-1] = contracted, contracted_value
            else:
                for i in range(1, dimension + 1):
                    simplex[i] = simplex[0] + 0.5 * (simplex[i] - simplex[0])
                    values[i] = function(simplex[i])
                    evaluations += 1
    order = np.argsort(values, kind="stable")
    return simplex[order][0], float(values[order][0]), evaluations


def sample_counts(state: np.ndarray, shots: int, seed: int) -> dict:
    """Sample measurement outcomes in the computational basis.

    Separate from `expectation` on purpose: the expectation is exact, these
    counts carry shot noise, and the two must never be presented as the same
    quantity.
    """
    probabilities = np.abs(state) ** 2
    probabilities = probabilities / probabilities.sum()
    rng = np.random.default_rng(seed)
    drawn = rng.choice(len(probabilities), size=int(shots), p=probabilities)
    unique, counts = np.unique(drawn, return_counts=True)
    return {int(s): int(c) for s, c in zip(unique.tolist(), counts.tolist())}


def state_to_slot_classes(state_index: int, num_qubits: int):
    """Decode a basis state into per-slot class indices, or None if invalid."""
    slots = num_qubits // ALPHABET_SIZE
    classes = []
    for slot in range(slots):
        block = (state_index >> (slot * ALPHABET_SIZE)) & ((1 << ALPHABET_SIZE) - 1)
        set_bits = [bit for bit in range(ALPHABET_SIZE) if (block >> bit) & 1]
        if len(set_bits) != 1:
            return None
        classes.append(set_bits[0])
    return tuple(classes)


@dataclass
class QaoaResult:
    """Everything needed to report, reproduce and criticise one QAOA run."""

    depth: int
    num_qubits: int
    gammas: list
    betas: list
    expectation_penalised: float
    expectation_objective: float
    valid_probability: float
    best_valid_state: int
    best_valid_slot_classes: tuple
    best_valid_energy: float
    best_valid_probability: float
    optimum_probability: float
    found_exact_optimum: bool
    exact_best_energy: float
    exact_worst_energy: float
    uniform_mean_energy: float
    approximation_ratio: float
    random_baseline_ratio: float
    function_evaluations: int
    optimiser_iterations: int
    runtime_seconds: float
    gate_counts: dict = field(default_factory=dict)
    shots: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def optimise_qaoa(
    problem: SubProblem,
    depth: int = 3,
    exact: dict | None = None,
    shots: int = 4096,
    seed: int = 42,
    max_iterations: int = 600,
) -> QaoaResult:
    """Optimise the QAOA angles and report the run against the exact optimum.

    `exact` is the output of `subproblem.exact_slice_optimum`; it is computed
    here when not supplied. Every ratio below is measured against it, so the
    quality claim is anchored to a proven optimum rather than to another
    heuristic.
    """
    from .circuit import circuit_summary
    from .subproblem import exact_slice_optimum

    if depth < 1:
        raise ValueError("QAOA depth p must be at least 1")
    n = problem.num_qubits
    _require_simulable(n)
    if exact is None:
        exact = exact_slice_optimum(problem)

    started = time.perf_counter()

    # Penalised diagonal drives the circuit: the penalty is what makes the
    # one-hot constraint visible to the quantum optimiser at all.
    diag = cost_diagonal(problem.linear, problem.quadratic, problem.offset)
    phase_diag, scale, mean = scaled_phase_diagonal(diag)
    # Penalty-free diagonal is used for *reporting* valid-state energies, so
    # the numbers printed are comparable with the classical pipeline.
    objective_diag = cost_diagonal(
        problem.objective_only_linear,
        problem.objective_only_quadratic,
        problem.objective_only_offset,
    )
    mask = valid_one_hot_mask(n)

    evaluations = 0

    def negative_quality(angles: np.ndarray) -> float:
        nonlocal evaluations
        evaluations += 1
        half = len(angles) // 2
        state = qaoa_statevector(phase_diag, angles[:half], angles[half:], n)
        return expectation(state, diag)

    best_angles, best_value, used = nelder_mead(
        negative_quality, _ramp_start(depth), max_iterations=max_iterations
    )
    state = qaoa_statevector(phase_diag, best_angles[:depth], best_angles[depth:], n)
    probabilities = np.abs(state) ** 2

    valid_probability = float(probabilities[mask].sum())
    valid_indices = np.nonzero(mask)[0]
    valid_probs = probabilities[valid_indices]
    # "Best valid state" = the valid state the circuit is most likely to
    # return. This is what a real device would hand you, so it is the honest
    # answer to report - not the lowest-energy state in the whole spectrum.
    best_local = int(np.argmax(valid_probs))
    best_state = int(valid_indices[best_local])
    best_classes = state_to_slot_classes(best_state, n)
    best_energy = float(objective_diag[best_state])

    exact_best = float(exact["best_energy"])
    exact_worst = float(exact["worst_energy"])
    exact_mean = float(exact["mean_energy"])
    span = exact_worst - exact_best

    optimum_classes = tuple(exact["best_slot_classes"])
    optimum_state = sum(
        1 << (slot * ALPHABET_SIZE + int(a)) for slot, a in enumerate(optimum_classes)
    )
    optimum_probability = float(probabilities[optimum_state])

    # Approximation ratio on the valid subspace, renormalised: this is the
    # expected energy *given* a valid measurement, which is the quantity a
    # user of the circuit actually experiences.
    valid_expectation = (
        float(np.dot(valid_probs, objective_diag[valid_indices]) / valid_probability)
        if valid_probability > 0
        else float("nan")
    )
    ratio = (exact_worst - valid_expectation) / span if span > 0 else 1.0
    random_ratio = (exact_worst - exact_mean) / span if span > 0 else 1.0

    summary = circuit_summary(problem, depth)
    shot_counts = sample_counts(state, shots, seed) if shots else {}
    shot_report = {}
    if shot_counts:
        valid_shots = {
            s: c for s, c in shot_counts.items() if state_to_slot_classes(s, n) is not None
        }
        total = sum(shot_counts.values())
        best_shot_energy = (
            min(float(objective_diag[s]) for s in valid_shots) if valid_shots else None
        )
        shot_report = {
            "shots": total,
            "seed": seed,
            "distinct_outcomes": len(shot_counts),
            "valid_shots": sum(valid_shots.values()),
            "valid_fraction": sum(valid_shots.values()) / total if total else 0.0,
            "best_valid_energy_in_shots": best_shot_energy,
            "optimum_in_shots": int(shot_counts.get(optimum_state, 0)),
        }

    notes = [
        "Exact statevector simulation on a classical CPU. No quantum hardware was used.",
        f"Reduced sub-problem: {len(problem.free_positions)} of 8 positions free "
        f"({n} qubits). The full 48-variable problem is not simulable.",
        "No quantum speedup is claimed. Brute force over this slice is faster and exact.",
        "Expectation values are exact (infinite-shot); the shot counts are a separate, seeded sample.",
    ]

    return QaoaResult(
        depth=depth,
        num_qubits=n,
        gammas=[float(g) for g in best_angles[:depth]],
        betas=[float(b) for b in best_angles[depth:]],
        expectation_penalised=float(best_value),
        expectation_objective=valid_expectation,
        valid_probability=valid_probability,
        best_valid_state=best_state,
        best_valid_slot_classes=best_classes,
        best_valid_energy=best_energy,
        best_valid_probability=float(valid_probs[best_local]),
        optimum_probability=optimum_probability,
        found_exact_optimum=bool(best_classes == optimum_classes),
        exact_best_energy=exact_best,
        exact_worst_energy=exact_worst,
        uniform_mean_energy=exact_mean,
        approximation_ratio=float(ratio),
        random_baseline_ratio=float(random_ratio),
        function_evaluations=evaluations,
        optimiser_iterations=used,
        runtime_seconds=time.perf_counter() - started,
        gate_counts=summary.counts,
        shots=shot_report,
        notes=notes,
    )
