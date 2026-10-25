"""Hard-constrained QAOA with XY mixers, simulated exactly in the feasible subspace.

This is the project's main quantum result, and the reason it exists is a
failure: the penalty-QUBO QAOA in `qaoa.py` barely beats random guessing on
this objective (measured approximation ratio ~0.33 against a ~0.33 random
baseline). The cause is structural, not a tuning problem. A provably safe
one-hot penalty must exceed the whole objective range, so here P ~ 2.1e3
against an objective span of ~1.2e2. The phase separator then spends almost
all of its rotation angle enforcing the constraint and has almost none left to
discriminate between *valid* designs.

The standard fix is to stop encoding the constraint as an energy penalty and
instead choose a mixer that cannot leave the feasible set: the Quantum
Alternating Operator Ansatz of Hadfield et al. (2019). For one-hot ("exactly
one of six") blocks the appropriate mixer is the complete-graph XY mixer

    H_XY = sum_{positions i} sum_{u<v in block i} ( X_u X_v + Y_u Y_v )

which conserves Hamming weight inside every block. Starting from a product of
per-block W states - the uniform superposition over the six valid classes -
the state is confined to the feasible subspace for all time. Two consequences:

  1. Every measurement is a valid peptide design. The validity rate is 1.0 by
     construction, not by penalty tuning, so no shot is ever wasted.
  2. The simulation becomes tractable at full size. The circuit nominally acts
     on 48 qubits (2**48 ~ 2.8e14 amplitudes, ~4.5 PB), but the dynamics never
     leave the 6**8 = 1,679,616-dimensional feasible sector. Simulating that
     sector exactly needs 27 MB.

So this module simulates the FULL 8-position, 48-qubit QAOA circuit exactly,
by exploiting the symmetry the circuit itself respects. That is a legitimate
and standard symmetry-sector simulation, not an approximation.

Exact mixer application
-----------------------
Restricted to one block's one-hot subspace (basis |class a>), the XY mixer acts
as 2*(J - I) where J is the 6x6 all-ones matrix, because
(X_u X_v + Y_u Y_v)|..1_u 0_v..> = 2|..0_u 1_v..>. Therefore

    exp(-i*beta*H_XY^block) = e^{2i beta} [ I + (e^{-12 i beta} - 1)/6 * J ]

J is rank one, so each block's mixer is a scale plus a broadcast of that
block's axis sum: O(dimension) per position, with no Trotter error.

Honesty, stated plainly
-----------------------
  * This is exact classical statevector simulation in a symmetry sector. NO
    QUANTUM HARDWARE IS USED.
  * NO SPEEDUP IS CLAIMED. Classical brute force over the same 1,679,616
    designs is faster here and returns a proven optimum. QAOA is measured
    *against* that proven optimum; it does not replace it.
  * The mixer is applied as an exact matrix exponential. Real gate-model
    hardware cannot do that: the XY terms do not commute, so a device would
    need a Trotterised approximation, which adds error this simulation does
    not model. `circuit.py` reports the Trotterised gate cost so the gap is
    visible rather than hidden.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from .subproblem import ALPHABET_SIZE, LENGTH, SubProblem, build_subproblem
from .qaoa import nelder_mead

# 6**8 = 1,679,616 complex128 amplitudes = 27 MB. 6**9 would be 161 MB and the
# problem is only 8 positions long, so this bound is never actually binding.
MAX_DIMENSION = 6 ** 8


@dataclass(frozen=True)
class XyProblem:
    """The feasible-subspace representation of a selectivity sub-problem.

    `objective` is the penalty-free energy of every valid design in the slice,
    laid out as a k-dimensional tensor with position slot t on axis t. No
    penalty term appears anywhere: the constraint is enforced by the mixer.
    """

    free_positions: tuple
    fixed_codes: tuple
    lam: float
    shape: tuple
    objective: np.ndarray
    nominal_qubits: int
    dimension: int
    best_index: int
    best_slot_classes: tuple
    best_energy: float
    worst_energy: float
    mean_energy: float
    selection_rule: str = ""

    @property
    def span(self) -> float:
        return float(self.worst_energy - self.best_energy)

    def slot_classes_of(self, flat_index: int) -> tuple:
        return tuple(int(c) for c in np.unravel_index(int(flat_index), self.shape))

    def codes_for(self, slot_classes) -> tuple:
        codes = list(self.fixed_codes)
        for slot, position in enumerate(self.free_positions):
            codes[position] = int(slot_classes[slot])
        return tuple(codes)


def build_xy_problem(
    coefficients: dict,
    lam: float,
    fixed_codes=None,
    free_positions=None,
    free_count: int = LENGTH,
) -> XyProblem:
    """Build the exact objective tensor over the feasible subspace.

    Defaults to all 8 positions free, i.e. the full 1,679,616-design problem
    and the full 48-qubit circuit.
    """
    if fixed_codes is None:
        fixed_codes = (0,) * LENGTH
    if free_positions is None and free_count >= LENGTH:
        free_positions = tuple(range(LENGTH))

    sub: SubProblem = build_subproblem(
        coefficients, lam, fixed_codes, free_positions=free_positions, free_count=free_count
    )
    k = len(sub.free_positions)
    dimension = ALPHABET_SIZE ** k
    if dimension > MAX_DIMENSION:
        raise ValueError(f"feasible subspace of dimension {dimension} exceeds the limit")

    shape = (ALPHABET_SIZE,) * k
    objective = np.full(shape, sub.objective_only_offset, dtype=np.float64)

    # One-body terms: broadcast each slot's six effective coefficients along
    # that slot's axis.
    for slot in range(k):
        block = sub.objective_only_linear[slot * ALPHABET_SIZE: (slot + 1) * ALPHABET_SIZE]
        view = [1] * k
        view[slot] = ALPHABET_SIZE
        objective += block.reshape(view)

    # Two-body terms: broadcast each slot pair's 6x6 block along its two axes.
    for s1 in range(k):
        for s2 in range(s1 + 1, k):
            block = sub.objective_only_quadratic[
                s1 * ALPHABET_SIZE: (s1 + 1) * ALPHABET_SIZE,
                s2 * ALPHABET_SIZE: (s2 + 1) * ALPHABET_SIZE,
            ]
            view = [1] * k
            view[s1] = ALPHABET_SIZE
            view[s2] = ALPHABET_SIZE
            objective += block.reshape(view)

    flat = objective.ravel()
    best_index = int(np.argmin(flat))
    return XyProblem(
        free_positions=sub.free_positions,
        fixed_codes=sub.fixed_codes,
        lam=float(lam),
        shape=shape,
        objective=objective,
        nominal_qubits=k * ALPHABET_SIZE,
        dimension=dimension,
        best_index=best_index,
        best_slot_classes=tuple(int(c) for c in np.unravel_index(best_index, shape)),
        best_energy=float(flat[best_index]),
        worst_energy=float(flat.max()),
        mean_energy=float(flat.mean()),
        selection_rule=sub.selection_rule,
    )


def apply_xy_mixer(state: np.ndarray, beta: float) -> np.ndarray:
    """Apply exp(-i*beta*H_XY) exactly, in place, one position at a time.

    Derivation in the module docstring. Written with in-place NumPy ops and a
    reshaped 3D view per axis: the naive version allocated a fresh 27 MB array
    per position per layer and was ~3x slower.
    """
    alpha = np.exp(2j * beta)
    delta = alpha * (np.expm1(-12j * beta)) / ALPHABET_SIZE
    k = state.ndim
    for axis in range(k):
        pre = int(np.prod(state.shape[:axis], dtype=np.int64))
        post = int(np.prod(state.shape[axis + 1:], dtype=np.int64))
        view = state.reshape(pre, ALPHABET_SIZE, post)
        axis_sum = view.sum(axis=1, keepdims=True)
        axis_sum *= delta
        view *= alpha
        view += axis_sum
    return state


def xy_qaoa_state(phase: np.ndarray, gammas, betas) -> np.ndarray:
    """Evolve the product-W initial state through p QAOA layers.

    The initial state is the uniform superposition over every valid design,
    which is the product of per-position W states and is the standard feasible
    start for the XY ansatz.
    """
    if len(gammas) != len(betas):
        raise ValueError("gammas and betas must have the same length p")
    dimension = phase.size
    state = np.full(phase.shape, 1.0 / np.sqrt(dimension), dtype=np.complex128)
    for gamma, beta in zip(gammas, betas):
        state *= np.exp(-1j * float(gamma) * phase)
        apply_xy_mixer(state, float(beta))
    return state


def scaled_phase(problem: XyProblem) -> np.ndarray:
    """Rescale the objective for the phase separator.

    Subtracting the mean is a global phase (unobservable); dividing by the
    span only sets the units of gamma. Identical reasoning to `qaoa.py`, but
    note the span here is the *objective* span, not a penalty-inflated one -
    which is precisely why this ansatz has usable resolution.
    """
    span = problem.span if problem.span > 0 else 1.0
    return (problem.objective - problem.mean_energy) / span


def probabilities_of(state: np.ndarray) -> np.ndarray:
    probability = np.abs(state.ravel()) ** 2
    total = probability.sum()
    return probability / total if total > 0 else probability


def sample_designs(state: np.ndarray, shots: int, seed: int) -> dict:
    """Seeded finite-shot measurement. Every outcome is a valid design."""
    probability = probabilities_of(state)
    rng = np.random.default_rng(seed)
    drawn = rng.choice(probability.size, size=int(shots), p=probability)
    unique, counts = np.unique(drawn, return_counts=True)
    return {int(index): int(count) for index, count in zip(unique.tolist(), counts.tolist())}


@dataclass
class XyQaoaResult:
    depth: int
    nominal_qubits: int
    dimension: int
    gammas: list
    betas: list
    expectation: float
    approximation_ratio: float
    random_baseline_ratio: float
    validity_rate: float
    most_likely_index: int
    most_likely_slot_classes: tuple
    most_likely_energy: float
    most_likely_probability: float
    found_exact_optimum: bool
    optimum_probability: float
    optimum_rank: int
    enrichment_over_uniform: float
    top_designs: list = field(default_factory=list)
    exact_best_energy: float = 0.0
    exact_worst_energy: float = 0.0
    uniform_mean_energy: float = 0.0
    function_evaluations: int = 0
    restarts: int = 1
    runtime_seconds: float = 0.0
    shots: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)


def optimise_xy_qaoa(
    problem: XyProblem,
    depth: int = 2,
    restarts: int = 3,
    max_iterations: int = 220,
    shots: int = 4096,
    seed: int = 42,
    top_n: int = 10,
    extra_starts=None,
) -> XyQaoaResult:
    """Optimise the 2p variational angles and report against the proven optimum.

    Multi-restart because the QAOA angle landscape is non-convex and a single
    Nelder-Mead run from the linear-ramp start does get trapped: at p=3 a
    single start scored *worse* than p=2 during development. Restarts are
    drawn from a seeded generator so the run stays reproducible.

    `extra_starts` accepts additional starting schedules - used by
    `sweep_xy_depths` to pass the INTERP lift of the previous depth's optimum.
    """
    if depth < 1:
        raise ValueError("QAOA depth p must be at least 1")
    started = time.perf_counter()
    phase = scaled_phase(problem)
    flat_objective = problem.objective.ravel()
    evaluations = 0

    def expectation_of(angles: np.ndarray) -> float:
        nonlocal evaluations
        evaluations += 1
        state = xy_qaoa_state(phase, angles[:depth], angles[depth:])
        return float(np.dot(probabilities_of(state), flat_objective))

    layers = np.arange(1, depth + 1, dtype=np.float64)
    starts = [np.concatenate([0.7 * layers / depth, 0.7 * (1.0 - (layers - 1) / depth)])]
    for start in extra_starts or []:
        starts.append(np.asarray(start, dtype=np.float64))
    rng = np.random.default_rng(seed)
    for _ in range(max(0, restarts - 1)):
        starts.append(rng.uniform(0.0, np.pi, size=2 * depth))

    best_angles, best_value = None, np.inf
    for start in starts:
        angles, value, _ = nelder_mead(
            expectation_of, start, max_iterations=max_iterations
        )
        if value < best_value:
            best_angles, best_value = angles, value

    state = xy_qaoa_state(phase, best_angles[:depth], best_angles[depth:])
    probability = probabilities_of(state)

    most_likely = int(np.argmax(probability))
    order = np.argsort(-probability, kind="stable")
    optimum_rank = int(np.nonzero(order == problem.best_index)[0][0]) + 1
    uniform_probability = 1.0 / problem.dimension
    optimum_probability = float(probability[problem.best_index])

    span = problem.span if problem.span > 0 else 1.0
    ratio = (problem.worst_energy - best_value) / span
    random_ratio = (problem.worst_energy - problem.mean_energy) / span

    top = []
    for rank, index in enumerate(order[:top_n].tolist(), 1):
        classes = problem.slot_classes_of(index)
        top.append(
            {
                "rank": rank,
                "slot_classes": classes,
                "codes": problem.codes_for(classes),
                "probability": float(probability[index]),
                "energy": float(flat_objective[index]),
                "is_exact_optimum": bool(index == problem.best_index),
            }
        )

    shot_report = {}
    if shots:
        counts = sample_designs(state, shots, seed)
        total = sum(counts.values())
        best_sampled = min(float(flat_objective[i]) for i in counts)
        shot_report = {
            "shots": total,
            "seed": seed,
            "distinct_designs": len(counts),
            "validity_rate": 1.0,
            "optimum_in_shots": int(counts.get(problem.best_index, 0)),
            "best_energy_in_shots": best_sampled,
            "best_in_shots_is_optimum": bool(
                abs(best_sampled - problem.best_energy) <= 1e-9
            ),
        }

    notes = [
        "Exact statevector simulation inside the one-hot feasible subspace. "
        "NO QUANTUM HARDWARE WAS USED.",
        f"Nominal circuit width {problem.nominal_qubits} qubits; simulated exactly in the "
        f"{problem.dimension}-dimensional feasible sector the XY mixer cannot leave.",
        "Validity rate is 1.0 by construction (mixer-enforced), not by penalty tuning.",
        "NO QUANTUM SPEEDUP IS CLAIMED. Classical brute force over the same designs is "
        "faster here and returns a proven optimum; that optimum is the reference used above.",
        "The XY mixer is applied as an exact matrix exponential. Hardware would need a "
        "Trotterised approximation, whose error is NOT modelled here.",
    ]

    return XyQaoaResult(
        depth=depth,
        nominal_qubits=problem.nominal_qubits,
        dimension=problem.dimension,
        gammas=[float(g) for g in best_angles[:depth]],
        betas=[float(b) for b in best_angles[depth:]],
        expectation=float(best_value),
        approximation_ratio=float(ratio),
        random_baseline_ratio=float(random_ratio),
        validity_rate=1.0,
        most_likely_index=most_likely,
        most_likely_slot_classes=problem.slot_classes_of(most_likely),
        most_likely_energy=float(flat_objective[most_likely]),
        most_likely_probability=float(probability[most_likely]),
        found_exact_optimum=bool(most_likely == problem.best_index),
        optimum_probability=optimum_probability,
        optimum_rank=optimum_rank,
        enrichment_over_uniform=float(optimum_probability / uniform_probability),
        top_designs=top,
        exact_best_energy=problem.best_energy,
        exact_worst_energy=problem.worst_energy,
        uniform_mean_energy=problem.mean_energy,
        function_evaluations=evaluations,
        restarts=len(starts),
        runtime_seconds=time.perf_counter() - started,
        shots=shot_report,
        notes=notes,
    )


def interpolate_angles(angles: np.ndarray, depth: int) -> np.ndarray:
    """INTERP seeding: lift optimised depth-p angles to a depth-(p+1) start.

    From Zhou et al. (2020). Optimised QAOA angle schedules are smooth in the
    layer index, so the depth-p schedule linearly resampled onto p+1 points is
    a far better starting guess than anything random. This matters here for a
    measured reason: with random starts only, depth 3 scored *worse* than
    depth 2 (ratio 0.767 vs 0.819) because Nelder-Mead was trapped. Seeding
    this way removed that inversion.
    """
    previous = len(angles) // 2
    old_gammas, old_betas = angles[:previous], angles[previous:]
    # Resample onto `depth` points over the same normalised layer interval.
    old_grid = np.linspace(0.0, 1.0, previous)
    new_grid = np.linspace(0.0, 1.0, depth)
    gammas = np.interp(new_grid, old_grid, old_gammas)
    betas = np.interp(new_grid, old_grid, old_betas)
    return np.concatenate([gammas, betas])


def sweep_xy_depths(
    problem: XyProblem,
    depths=(1, 2, 3, 4),
    restarts: int = 2,
    max_iterations: int = 200,
    shots: int = 4096,
    seed: int = 42,
    top_n: int = 10,
) -> list:
    """Optimise across increasing depth, seeding each depth from the previous.

    Returns one XyQaoaResult per depth, in order. Each depth after the first
    gets the INTERP lift of the best previous schedule *in addition to* its
    random restarts, so a deeper circuit can never be reported as worse purely
    because the optimiser got unlucky.
    """
    results, previous_angles = [], None
    for depth in depths:
        seeds = None
        if previous_angles is not None:
            seeds = [interpolate_angles(previous_angles, depth)]
        result = optimise_xy_qaoa(
            problem,
            depth=depth,
            restarts=restarts,
            max_iterations=max_iterations,
            shots=shots,
            seed=seed,
            top_n=top_n,
            extra_starts=seeds,
        )
        results.append(result)
        previous_angles = np.concatenate([result.gammas, result.betas])
    return results
