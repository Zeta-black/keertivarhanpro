# Q-BIND Select 8-mer benchmark methodology

This is a controlled computational benchmark: eight positions each choose one of
six amino-acid classes, giving `6^8 = 1,679,616` valid sequences. The one-hot
encoding has 48 binary variables. `binding_score` has one convention throughout:
higher means stronger *predicted* binding.

## Data and score model

The default source is the public QA-PBP-RL-Nexus `PottsModel_Energies` data for
PET, PE, and PP, backbone `bb1` (commit `cd63b7e`). That source is a 12-position
19-amino-acid Potts energy model. This 8-mer experiment deterministically uses
its central source positions 2–9, avoiding terminal residue encodings. Each
one-body term and each pair term is aggregated by arithmetic mean over the
residues in the supplied six-class map. The source minimizes raw Potts energy;
the canonical binding score is `-raw_energy`, so larger means stronger predicted
binding. PET/PE/PP all use the same `bb1` protocol; their full-space score
standard deviations are 52.79, 50.55, and 54.22 (ratio below 1.08), so no
normalization is applied. The generated reduced real model is saved as
`data/processed/real_aggregated_potts_model.npz`.

`score_source: proxy` remains available only as a labelled fallback. It is not
used in the reported default run.

## Surrogate and QUBO

Ridge regression learns one-hot position and all inter-position class-pair
features. The fitted intercept, linear features, and pair features map directly
to a binary quadratic model. The minimized objective is
`-PET + lambda * (PE + PP) + P * sum_i(sum_a x[i,a]-1)^2`.

`P` is an automated conservative bound: twice the sum of absolute
nonconstant objective coefficients plus one. It exceeds the modeled objective
range, making the one-hot violation penalty dominate a tested invalid assignment.
For valid sequences, the expanded constraint is exactly zero.

Lambda means: `0` cares only about grabbing PET; increasing lambda increasingly
punishes candidates predicted to bind PE or PP too. It is an optimization weight,
not a biological measurement.

## Solver interpretation

Brute force enumerates valid class sequences only, yielding the exact surrogate
optimum for this deliberately small benchmark. Simulated annealing and the
D-Wave-compatible BQM receive the same constrained objective. Leap is only
marked executed when the API actually returns a sample; otherwise the saved BQM
path is ready but status is unavailable.

A gate-model quantum algorithm is additionally run on the same objective:
XY-mixer QAOA (the Quantum Alternating Operator Ansatz), by exact statevector
simulation inside the one-hot feasible subspace. See `SCIENTIFIC_METHOD.md`
section 8b and `results/quantum_*.csv`.

**No quantum advantage is inferred, from any solver.** No quantum hardware was
executed. Every quantum approximation ratio is measured against the exact
brute-force optimum over the identical design space, which is faster to obtain
and is used as the reference rather than as a competitor.
