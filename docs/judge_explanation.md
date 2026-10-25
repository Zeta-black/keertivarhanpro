# Judge explanation and technical Q&A

Honest answers, with the file or result file that backs each one. Where the
answer is "we have not shown that", it says so.

---

## The project in five sentences

We reduced peptide design to eight positions, each choosing one of six
amino-acid **classes**, giving `6^8 = 1,679,616` valid designs — small enough to
enumerate, which is what makes the answer provable rather than plausible. A
six-class Potts model, aggregated from the published QA-PBP-RL-Nexus energy
tables, scores every design against PET, PE and PP. We search for designs that
score high for PET and low for PE and PP, trading those off with a user-chosen
weight lambda. We then run a **real gate-model quantum algorithm** on that same
objective, by exact statevector simulation, and grade it against the
brute-force optimum. Nothing was run on quantum hardware, nothing was
synthesised, and no speedup is claimed.

---

## 1. What exact problem are you solving?

**Short:** Given a short peptide, predict whether it is scored as sticking more
strongly to PET than to PE or PP — and search for the peptide with the biggest
such gap.

**Technical:** Minimise `f(c) = -PET(c) + lambda * (PE(c) + PP(c))` over
`c ∈ {0..5}^8`, where each score is a Potts energy sum
`intercept + Σ_i linear[i, c_i] + Σ_{i<j} pair[i,j,c_i,c_j]`.

**Evidence:** `src/qbind_select/score_model.py`, `config/experiment.yaml`,
`SCIENTIFIC_METHOD.md` §4–5.

## 2. Why does the problem matter?

**Short:** Mixed plastic waste is hard to sort. A molecule that preferentially
binds one polymer is a building block for selective sorting, sensing or
enzyme-targeting.

**Honest limit:** That is the *motivation*, not a result. We have not
demonstrated sorting, sensing, binding, adhesion or any recycling benefit. We
have ranked designs under a published scoring model.

## 3. Why quantum computing at all?

**Short:** Because the problem has exactly the shape quantum optimisers are
designed for — a quadratic objective over binary choices with a hard
"exactly one per position" constraint — and because the answer here is already
known, so we can *grade* the quantum method instead of guessing at it.

**Technical:** The one-hot encoded objective is a QUBO over 48 binary
variables, directly expressible as a cost Hamiltonian. Because the space is
enumerable, we have a proven optimum to measure approximation ratio against —
which is exactly what a problem large enough to need quantum computing would
not give you.

## 4. What is *actually* quantum in your implementation?

**Short:** A real variational quantum circuit — QAOA with XY mixers — that we
run by exact statevector simulation. You can press a button and run it on the
Quantum screen.

**Technical:** Quantum Alternating Operator Ansatz (Hadfield et al. 2019):

```
|psi(g,b)> = Π_{l=1..p} U_B(b_l) U_C(g_l) |W>^8
U_C(g) = exp(-i g C)        cost Hamiltonian, diagonal
U_B(b) = exp(-i b H_XY)     H_XY = Σ_i Σ_{u<v ∈ block i} (X_u X_v + Y_u Y_v)
```

Nominal width 48 qubits (8 positions × 6 classes).

**Evidence:** `src/qbind_select/quantum/xy_qaoa.py`,
`web/src/science/qaoa.ts`, `results/quantum_xy_depth_sweep.csv`.

**Honest limit, stated before being asked:** this is *simulated*, not executed
on hardware. No QPU was contacted anywhere in this project.

## 5. Which part is classical?

Everything that produces the headline answer. The scoring model, the
exhaustive search, the Ridge surrogate, the simulated annealing, the parameter
optimisation of the quantum circuit (Nelder-Mead), and the statevector
simulation itself all run on a classical CPU. The quantum part is the
*algorithm* being simulated, not the machine doing the simulating.

## 6. How can you simulate 48 qubits? That should be impossible.

This is the question worth preparing for, because the naive objection is
correct: `2^48` amplitudes is about 4.5 petabytes.

**Short:** The circuit never visits most of those states, so we never store
them.

**Technical:** `H_XY` conserves Hamming weight *inside each six-qubit block*.
Starting from a product of per-block W states — the uniform superposition over
the six classes at each position — the state is confined for all time to the
feasible subspace of dimension `6^8 = 1,679,616`, which is 27 MB in complex128.
We simulate that sector **exactly**. This is a standard symmetry-sector
simulation, not an approximation of the circuit: the sector is everything the
circuit can reach.

**Evidence:** derivation in the `xy_qaoa.py` module docstring; the mixer is
applied in closed form because restricted to a block's one-hot subspace
`H_XY = 2(J − I)`, so
`exp(-i b H_XY) = e^{2ib}[I + (e^{-12ib} − 1)/6 · J]` — rank-one, hence `O(N)`.

Verified: mixer unitarity to 1e-11 for arbitrary beta, identity at beta = 0,
and the product-W state confirmed as an eigenvector
(`tests/test_quantum_qaoa.py`).

## 7. What are the inputs and outputs?

**Input:** an 8-position class sequence (and lambda, and circuit depth).
**Output:** three predicted binding scores, the objective value, and — for the
quantum run — a probability distribution over valid designs, its approximation
ratio, and whether its most likely outcome is the proven optimum.

## 8. How do you represent the scientific data?

20 amino acids are aggregated into 6 classes by arithmetic mean of their Potts
energies (`config/amino_acid_class_mapping.yaml`). Positions 2..9 of the
source's 12-position model are used, avoiding its terminal residue encodings.
Canonical binding score is the **negative** of raw Potts energy, because the
source minimises energy and we wanted "higher = stronger".

**Honest limit:** class aggregation loses residue-level resolution. A displayed
letter (e.g. `L` for HYDROPHOBIC) is a documented *representative*, not a
residue the optimiser chose. `src/chem/` cannot influence a score — nothing in
`src/science/` imports it.

## 9. Why this algorithm rather than another?

Because the constraint structure selects it. We tried the obvious thing first —
the penalty-QUBO formulation an annealer requires — and **measured it failing**,
then fixed it. See Q10.

## 10. What baseline did you use, and what did the comparison show?

Three baselines: exhaustive brute force (the proven optimum), uniform random
sampling, and the penalty-QUBO QAOA with a standard transverse-field X mixer.

A provably safe one-hot penalty must exceed the whole objective range. Here:

```
P = 2059.3     objective span = 125.2     ratio = 16.5x
```

So the phase separator spends nearly all its rotation enforcing the constraint.
Measured on the identical objective:

| Encoding | Valid measurements | Margin over random |
| --- | --- | --- |
| Penalty QUBO + X mixer | 44.6% | **+0.0021** |
| One-hot blocks + XY mixer | **100%** | **+0.4224** |

About **205× the margin**, and no wasted shots. Full problem, by depth:

| p | Approximation ratio | Enrichment vs uniform | Top outcome is the proven optimum? |
| --- | --- | --- | --- |
| 1 | 0.7428 | 1,104× | yes |
| 2 | 0.8193 | 4,137× | yes |
| 3 | **0.8550** | **7,812×** | **yes** |

Random baseline 0.4326; proven optimum 1.0.

**Evidence:** `results/quantum_xy_depth_sweep.csv`,
`results/quantum_penalty_control.csv`, `SCIENTIFIC_METHOD.md` §8b.

## 11. How do you know the result is correct?

Because the right answer is independently known, and because four separate code
paths are required to agree:

| Check | Agreement |
| --- | --- |
| Reduction vs `score_codes` | < 1e-9 |
| QUBO cost diagonal vs direct evaluation | < 1e-9 |
| Ising form vs QUBO form | < 1e-7 |
| XY objective tensor vs the independently cached full-space scores | **2.8e-13** |
| Browser TypeScript vs Python, 56 cases | < 1e-9 |

The last two matter most. The objective tensor is compared against
`data/processed/all_8mer_scores_real.npz`, built by a completely separate code
path; and the browser implementation is pinned to Python by a golden fixture, so
the two cannot drift.

Also: the penalised QUBO's ground state is verified to be one-hot valid *and*
equal to the brute-force optimum — so the penalty bound is not merely asserted.

## 12. What would constitute quantum advantage here, and do you claim it?

**We do not claim it, and at this size it is not claimable.** 1,679,616 designs
is enumerable; brute force is faster and returns a proven optimum. A credible
advantage claim would need: a problem too large to enumerate, execution on real
hardware with the embedding and schedule reported, the full sample distribution
published, and a *tuned* classical solver given matched wall-clock time. None of
that was done.

What we *do* claim: the objective can be expressed as a cost Hamiltonian, a
constraint-preserving ansatz solves it to a measured approximation ratio of
0.855 with 100% feasibility, and the annealer-shaped encoding measurably does
not.

## 13. Have you tested on unseen data?

For the Ridge surrogate, yes: disjoint train/validation/test splits of 12,000 /
3,000 / 3,000 sequences, test R² reported in `results/surrogate_metrics.csv`.

For the quantum results, the question does not apply in the same way — there is
no fitted model being generalised. The quantum circuit is evaluated against the
exact optimum of the same objective it is given, which is a correctness
measurement rather than a generalisation one.

**The real limitation is upstream:** there is no held-out *experimental* data at
all, because there are no experimental measurements in this project. See Q16.

## 14. How does this relate to signal processing or image processing?

**Honestly: it does not, and we did not bolt it on.**

This is a discrete sequence-optimisation problem. There is no time series, no
sampled waveform, no spectrum and no image anywhere in the data. Adding an FFT
or a segmentation step would have been decoration, so we did not add one.

What *is* genuinely shared with an ECE background is the mathematical
machinery, and it is worth naming precisely:

- **Quadratic forms over binary variables.** The QUBO/Ising transform
  (`x = (1 − Z)/2`) is the same change of variables used throughout
  spin-glass and coding problems.
- **Operator exponentials and symmetry.** The mixer is applied in closed form
  by diagonalising a rank-one perturbation (`J − I` on a 6-state space) — the
  eigendecomposition argument an ECE student already knows from LTI systems,
  used here to get an exact matrix exponential.
- **A phase separator is literally phase modulation.** `exp(-i γ C)` imprints a
  phase proportional to a signal (the objective value); the mixer then converts
  phase differences into amplitude differences. That interference mechanism is
  the whole algorithm, and it is the same idea as coherent detection.
- **Variational parameter optimisation** under a measured objective, with
  reproducible seeding.

If experimental data did exist — AFM images of peptide-coated films, QCM-D
binding curves, FTIR or Raman spectra — then image and signal processing would
become directly relevant, and that is written up as future work rather than
claimed as done.

## 15. What is the biological significance of the output?

**Short:** A ranked shortlist of candidate peptide *families* worth
synthesising first.

**Honest limit:** the output is a model score, not an affinity. The optimum
`LSWWLLFL` is aromatic- and hydrophobic-rich, which is chemically plausible for
aromatic stacking against PET's benzene rings — but plausibility is not
evidence. No binding has been measured.

## 16. What evidence supports the predictions, and what is still hypothesis?

| Status | What |
| --- | --- |
| **Measured** (reproducible computation) | All scores, optima, approximation ratios, solver comparisons, parity figures |
| **Hypothesis** | That any of these peptides actually binds PET; that the ranking survives experiment; that class-level resolution is sufficient |
| **No evidence either way** | Synthesis feasibility, stability, toxicity, cost, real-world sorting performance |

Nothing in the repository has laboratory backing. Every surface in the UI says
so.

## 17. What would need to happen before real-world use?

1. Expand classes back to residues and re-rank at residue resolution.
2. Validate the Potts model against measured binding for a held-out set.
3. Synthesise the top candidates and measure binding (QCM-D, SPR or ITC) on
   real PET, PE and PP films.
4. Test selectivity on mixed and weathered plastics, not pristine film.
5. Only then consider whether the optimisation needs quantum hardware at all —
   at this problem size, it does not.

## 18. What is the most important remaining limitation?

**The scoring model is unvalidated against experiment for this task.** Every
number in this project is downstream of it. If the Potts aggregation does not
rank real PET selectivity correctly, then the optimisation is exact, the
quantum circuit is correct, the software is tested — and the answer is still
not useful. That is the honest top risk, and it is a wet-lab problem, not a
computational one.

---

## Questions we would ask if we were judging

**"Your circuit is simulated. Isn't that just classical computing with extra
steps?"** For *performance*, yes — and we say so. For *method*, no: the
algorithm, its gate decomposition, its resource cost and its failure modes are
all real and inspectable, and the simulation is exact rather than approximate.
What simulation cannot tell you is how it behaves under noise.

**"Why should I believe the 0.855?"** Because it is measured against a proven
optimum, reproducible from seed 42, written to a CSV in the repository, and the
generated copy the website displays is verified against that CSV by a test.

**"What is the weakest part of the quantum work?"** That the XY mixer is applied
as an exact exponential. Hardware must Trotterise non-commuting terms, and we
do not model that error — so our approximation ratios are optimistic relative
to any real device. `circuit.xy_circuit_cost` reports the gate count a device
would pay (≥ 4,592 CNOTs at p=2, all-to-all, lower bound) so the gap is at
least quantified.
