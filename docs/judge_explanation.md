# Judge explanation

We reduced peptide design to eight positions, where each position chooses one of
six amino-acid classes. That is 1.68 million valid peptides—not 2^48 arbitrary
binary strings. The model predicts PET, PE, and PP binding scores for each
candidate. We reward PET binding and penalize PE/PP binding by a tunable lambda.
Because the reduced space is enumerable, brute force gives the exact surrogate
optimum. Simulated annealing and a D-Wave-compatible BQM are measured against
that same answer. This validates formulation and solver recovery; it does not
claim quantum advantage or experimental peptide binding.
