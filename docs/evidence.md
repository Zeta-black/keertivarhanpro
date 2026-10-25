# Evidence and provenance

The Q-BIND master report supplied by the user lists relevant public sources:

- Jain et al. (2025), Chemical Science: AI-driven plastic-binding peptide design.
- PEESEgroup, LSTM-SA repository: PET/PE/PP 12-mer datasets.
- Dhoriyani et al. (2025), PNAS Nexus: biophysical modeling, quantum computing,
  and AI for plastic-binding peptides.
- PEESEgroup, QA-PBP-RL-Nexus: Potts energy data and quantum-annealing code.
- D-Wave Ocean documentation.

The public QA-PBP-RL-Nexus repository was shallow-cloned at commit
`cd63b7ef2f4be2725971fe86d5510090d54242e5`. Its PET/PE/PP `bb1` one-body and
pairwise Potts energy files are the default model input. The exact aggregated
coefficient checksum and run settings are recorded in `results/run_metadata.json`.

## Quantum method provenance

The gate-model layer implements published algorithms rather than inventing one:

- Farhi, Goldstone & Gutmann (2014), *A Quantum Approximate Optimization
  Algorithm* — the QAOA construction.
- Hadfield, Wang, O'Gorman, Rieffel, Venturelli & Biswas (2019), *From the
  Quantum Approximate Optimization Algorithm to a Quantum Alternating Operator
  Ansatz*, Algorithms 12(2):34 — the constrained ansatz and the XY mixer used
  for one-hot blocks.
- Zhou, Wang, Choi, Pichler & Lukin (2020), *Quantum Approximate Optimization
  Algorithm: Performance, Mechanism, and Implementation on Near-Term Devices*,
  Phys. Rev. X 10:021067 — the INTERP depth-seeding strategy.

Run settings, coefficient checksum, gate-cost accounting and the full honesty
statement for this layer are recorded in `results/quantum_run_metadata.json`.
Nothing was executed on quantum hardware.
