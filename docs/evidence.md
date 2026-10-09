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
