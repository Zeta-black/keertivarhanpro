"""Gate-model quantum optimisation on the Q-BIND Select selectivity objective.

Scope and honesty, stated once, here, because it governs every module below:

  * Everything in this package is EXACT STATEVECTOR SIMULATION executed on a
    classical CPU with NumPy. No quantum processor is contacted. There is no
    quantum hardware anywhere in this repository.
  * QAOA is run on a REDUCED sub-problem, not the full 48-variable QUBO. The
    full problem needs 48 qubits (2**48 amplitudes, ~4.5 PB) which no
    statevector simulator can hold. The reduction is explicit, documented in
    `subproblem.py`, and derived from the same real Potts coefficients the rest
    of the pipeline uses.
  * NO QUANTUM SPEEDUP OR ADVANTAGE IS CLAIMED OR DEMONSTRATED. On a
    sub-problem small enough to simulate, classical brute force is strictly
    faster and returns a proven optimum. What is demonstrated is that the
    selectivity objective can be expressed as a cost Hamiltonian and solved by
    a variational quantum algorithm to a measurable approximation ratio.

What the package therefore *is* good for: it makes the quantum claim concrete
and inspectable instead of hypothetical. The circuit that runs is derived from
the real objective coefficients, the gate counts in `circuit.py` are counted
from that circuit, and the approximation ratio is measured against an exact
optimum over the identical sub-problem.
"""

from .subproblem import SubProblem, build_subproblem, combine_class_coefficients
from .qaoa import QaoaResult, cost_diagonal, optimise_qaoa, qaoa_statevector, sample_counts
from .circuit import CircuitSummary, circuit_summary, qubo_to_ising, ising_energy, xy_circuit_cost
from .xy_qaoa import (
    XyProblem,
    XyQaoaResult,
    build_xy_problem,
    apply_xy_mixer,
    xy_qaoa_state,
    optimise_xy_qaoa,
    sweep_xy_depths,
)

__all__ = [
    "SubProblem",
    "build_subproblem",
    "combine_class_coefficients",
    "QaoaResult",
    "cost_diagonal",
    "optimise_qaoa",
    "qaoa_statevector",
    "sample_counts",
    "CircuitSummary",
    "circuit_summary",
    "qubo_to_ising",
    "ising_energy",
    "xy_circuit_cost",
    "XyProblem",
    "XyQaoaResult",
    "build_xy_problem",
    "apply_xy_mixer",
    "xy_qaoa_state",
    "optimise_xy_qaoa",
    "sweep_xy_depths",
]
