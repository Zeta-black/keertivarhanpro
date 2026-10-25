"""Reduce the 48-variable selectivity QUBO to a simulable sub-problem.

Why a reduction is unavoidable
------------------------------
The full problem has 8 positions x 6 classes = 48 binary variables. An exact
statevector simulator stores 2**48 complex amplitudes (~4.5 petabytes), so the
full problem cannot be simulated; it cannot be run on hardware either, because
no available gate-model device holds 48 qubits at the circuit depth QAOA needs
with usable fidelity. Any honest gate-model demonstration on this objective is
therefore a demonstration on a sub-problem.

What the reduction is
---------------------
Choose k "free" positions. Clamp the other 8-k positions to a fixed class
assignment (the context). The free positions keep every term that involves
them, including their interaction with the clamped context, which is folded
into their effective one-body coefficients. Nothing is discarded and nothing
is invented: the sub-problem is the exact restriction of the real objective to
a k-dimensional slice through the 1,679,616-point search space.

That makes the comparison airtight. Brute force over the same slice costs 6**k
evaluations, so the slice has a *proven* optimum and the QAOA answer can be
scored against it exactly.

Variable layout
---------------
Free position slot t (0 <= t < k) and class a (0 <= a < 6) map to binary
variable u = t * 6 + a, matching the full problem's `position * 6 + class`
convention. Qubit u of the circuit carries variable u.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from ..alphabet import CLASSES

ALPHABET_SIZE = len(CLASSES)
LENGTH = 8


def combine_class_coefficients(coefficients: dict, lam: float):
    """Fold the three per-plastic Potts models into one class-space objective.

    Returns (linear[8,6], pair[8,8,6,6], intercept) for

        E(codes) = -PET(codes) + lam * (PE(codes) + PP(codes))

    the same objective `qubo.combine_objective` builds, except that this works
    on the *exact* Potts coefficients rather than on a fitted Ridge surrogate.
    Both are quadratic in the one-hot variables, so for exact coefficients the
    mapping is lossless and no surrogate error enters.
    """
    weights = {"PET": -1.0, "PE": float(lam), "PP": float(lam)}
    linear = np.zeros((LENGTH, ALPHABET_SIZE), dtype=np.float64)
    pair = np.zeros((LENGTH, LENGTH, ALPHABET_SIZE, ALPHABET_SIZE), dtype=np.float64)
    intercept = 0.0
    for plastic, weight in weights.items():
        linear += weight * np.asarray(coefficients[plastic]["linear"], dtype=np.float64)
        pair += weight * np.asarray(coefficients[plastic]["pair"], dtype=np.float64)
        intercept += weight * float(coefficients[plastic].get("intercept", 0.0))
    return linear, pair, intercept


@dataclass(frozen=True)
class SubProblem:
    """A QUBO over `6 * len(free_positions)` binary variables.

    `linear` and `quadratic` describe the objective *including* the one-hot
    penalty, so the ground state of this QUBO is the valid optimum of the
    slice. `objective_only_*` keep the penalty-free version, which is what the
    approximation ratio is measured on: a penalty-inflated energy range would
    flatter the result by making invalid states look arbitrarily bad.
    """

    free_positions: tuple[int, ...]
    fixed_codes: tuple[int, ...]
    lam: float
    num_qubits: int
    linear: np.ndarray
    quadratic: np.ndarray  # dense upper-triangular [n, n]
    offset: float
    penalty: float
    objective_only_linear: np.ndarray
    objective_only_quadratic: np.ndarray
    objective_only_offset: float
    context_constant: float
    selection_rule: str = ""
    coefficient_report: dict = field(default_factory=dict)

    def codes_for(self, slot_classes) -> tuple[int, ...]:
        """Expand a per-slot class choice back to a full 8-position sequence."""
        codes = list(self.fixed_codes)
        for slot, position in enumerate(self.free_positions):
            codes[position] = int(slot_classes[slot])
        return tuple(codes)


def _pair_value(pair: np.ndarray, i: int, j: int, a: int, b: int) -> float:
    """Read the i-j interaction regardless of which index is larger.

    The Potts arrays are stored upper-triangular (only i<j is populated), so a
    naive `pair[i, j]` silently returns zero when i>j. This is the most likely
    place for a reduction bug to hide, hence a named helper used everywhere.
    """
    return float(pair[i, j, a, b]) if i < j else float(pair[j, i, b, a])


def choose_free_positions(linear: np.ndarray, count: int):
    """Pick the `count` most decisive positions, deterministically.

    "Decisive" means largest spread (max - min) of the one-body objective
    coefficients at that position. A position whose six classes score almost
    identically contributes little, so reducing onto it would produce a
    trivially flat sub-problem and make QAOA look better than it is. Ties break
    to the lower position index.
    """
    spread = linear.max(axis=1) - linear.min(axis=1)
    order = sorted(range(LENGTH), key=lambda i: (-spread[i], i))
    chosen = tuple(sorted(order[:count]))
    rule = (
        f"the {count} positions with the largest one-body coefficient spread "
        "(max-min) in the combined objective; spreads="
        + ", ".join(f"p{i}:{spread[i]:.3f}" for i in range(LENGTH))
    )
    return chosen, rule


def safe_penalty(linear: np.ndarray, quadratic: np.ndarray, multiplier: float = 2.0) -> float:
    """Penalty strictly above the total objective range.

    Same conservative bound as `qubo.safe_penalty`: when P exceeds the sum of
    all coefficient magnitudes, no constraint violation can be paid for by an
    objective gain, so every optimum of the penalised QUBO is one-hot valid.
    """
    return float(multiplier * (np.abs(linear).sum() + np.abs(quadratic).sum()) + 1.0)


def build_subproblem(
    coefficients: dict,
    lam: float,
    fixed_codes,
    free_positions=None,
    free_count: int = 2,
    penalty_multiplier: float = 2.0,
) -> SubProblem:
    """Restrict the real selectivity objective to `free_positions`.

    `fixed_codes` is a full 8-position class assignment. Its entries at the
    free positions are ignored by the optimisation (they only set the starting
    display sequence); its entries elsewhere form the clamped context.
    """
    linear_full, pair_full, intercept = combine_class_coefficients(coefficients, lam)

    if free_positions is None:
        free_positions, rule = choose_free_positions(linear_full, free_count)
    else:
        free_positions = tuple(sorted(int(p) for p in free_positions))
        rule = "explicitly supplied by the caller"
    if not free_positions:
        raise ValueError("at least one free position is required")
    if len(set(free_positions)) != len(free_positions):
        raise ValueError("free positions must be distinct")
    if any(p < 0 or p >= LENGTH for p in free_positions):
        raise ValueError(f"free positions must lie in 0..{LENGTH - 1}")

    fixed_codes = tuple(int(c) for c in fixed_codes)
    if len(fixed_codes) != LENGTH:
        raise ValueError(f"fixed_codes must have {LENGTH} entries")
    if any(c < 0 or c >= ALPHABET_SIZE for c in fixed_codes):
        raise ValueError(f"fixed class indices must lie in 0..{ALPHABET_SIZE - 1}")

    free = list(free_positions)
    clamped = [p for p in range(LENGTH) if p not in free_positions]
    k = len(free)
    n = k * ALPHABET_SIZE

    # Constant: every term involving no free position. It shifts all energies
    # equally and so changes no ranking, but it must be carried for reported
    # energies to stay comparable with full-problem scores.
    context = intercept
    for i in clamped:
        context += float(linear_full[i, fixed_codes[i]])
    for idx, i in enumerate(clamped):
        for j in clamped[idx + 1:]:
            context += _pair_value(pair_full, i, j, fixed_codes[i], fixed_codes[j])

    # Effective one-body term for a free position: its own one-body
    # coefficient plus every interaction it has with the clamped context.
    lin = np.zeros(n, dtype=np.float64)
    for slot, i in enumerate(free):
        for a in range(ALPHABET_SIZE):
            value = float(linear_full[i, a])
            for j in clamped:
                value += _pair_value(pair_full, i, j, a, fixed_codes[j])
            lin[slot * ALPHABET_SIZE + a] = value

    # Free-free interactions survive unchanged.
    quad = np.zeros((n, n), dtype=np.float64)
    for s1, i in enumerate(free):
        for s2, j in enumerate(free[s1 + 1:], s1 + 1):
            for a in range(ALPHABET_SIZE):
                for b in range(ALPHABET_SIZE):
                    u = s1 * ALPHABET_SIZE + a
                    v = s2 * ALPHABET_SIZE + b
                    quad[u, v] = _pair_value(pair_full, i, j, a, b)

    penalty = safe_penalty(lin, quad, penalty_multiplier)

    # One-hot penalty P * sum_t (sum_a x[t,a] - 1)**2, expanded as:
    #   -P on each linear term, +2P on each within-slot pair, +P per slot.
    pen_lin = lin.copy()
    pen_quad = quad.copy()
    pen_offset = context
    for slot in range(k):
        variables = [slot * ALPHABET_SIZE + a for a in range(ALPHABET_SIZE)]
        for u in variables:
            pen_lin[u] -= penalty
        for ai, u in enumerate(variables):
            for v in variables[ai + 1:]:
                pen_quad[u, v] += 2.0 * penalty
        pen_offset += penalty

    report = {
        "free_positions": list(free),
        "clamped_positions": clamped,
        "context_constant": context,
        "linear_abs_sum": float(np.abs(lin).sum()),
        "quadratic_abs_sum": float(np.abs(quad).sum()),
        "coupled_pairs": int(np.count_nonzero(pen_quad)),
    }
    return SubProblem(
        free_positions=tuple(free),
        fixed_codes=fixed_codes,
        lam=float(lam),
        num_qubits=n,
        linear=pen_lin,
        quadratic=pen_quad,
        offset=pen_offset,
        penalty=penalty,
        objective_only_linear=lin,
        objective_only_quadratic=quad,
        objective_only_offset=context,
        context_constant=context,
        selection_rule=rule,
        coefficient_report=report,
    )


def slice_energy(problem: SubProblem, slot_classes) -> float:
    """Penalty-free objective energy of one valid class assignment."""
    energy = problem.objective_only_offset
    for slot, a in enumerate(slot_classes):
        energy += float(problem.objective_only_linear[slot * ALPHABET_SIZE + int(a)])
    for s1, a in enumerate(slot_classes):
        for s2, b in enumerate(slot_classes[s1 + 1:], s1 + 1):
            u = s1 * ALPHABET_SIZE + int(a)
            v = s2 * ALPHABET_SIZE + int(b)
            energy += float(problem.objective_only_quadratic[u, v])
    return float(energy)


def exact_slice_optimum(problem: SubProblem) -> dict:
    """Brute force the slice: all 6**k valid class assignments.

    This is the reference the quantum result is scored against. It is exact,
    so "QAOA found the optimum" becomes a checkable statement, not a guess.
    """
    k = len(problem.free_positions)
    rows = []
    for index in range(ALPHABET_SIZE ** k):
        slot_classes, rest = [], index
        for _ in range(k):
            slot_classes.append(rest % ALPHABET_SIZE)
            rest //= ALPHABET_SIZE
        slot_classes.reverse()
        rows.append((tuple(slot_classes), slice_energy(problem, slot_classes)))
    rows.sort(key=lambda row: (row[1], row[0]))
    energies = np.array([row[1] for row in rows], dtype=np.float64)
    return {
        "best_slot_classes": rows[0][0],
        "best_energy": float(rows[0][1]),
        "worst_energy": float(energies.max()),
        "mean_energy": float(energies.mean()),
        "evaluated": len(rows),
        "ranked": rows,
    }
