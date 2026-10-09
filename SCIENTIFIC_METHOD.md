# SCIENTIFIC_METHOD.md

What this project actually computes, from what data, under what assumptions, and
what it does not establish. Written from the implementation, not from intent.

---

## 1. The problem as posed

Mixed plastic waste is easier to recycle when separated. A molecule that
recognises one polymer and ignores chemically similar ones would be useful for
sorting. This project asks a narrow, tractable version of that question:

> Among all short peptide designs in a reduced alphabet, which ones does a
> published energy model score **higher for PET than for PE or PP**?

It is a search-and-ranking problem inside one model. It is not a binding study.

## 2. Design space

| Quantity | Value | Source |
| --- | --- | --- |
| Positions | 8 | `config/experiment.yaml: peptide_length` |
| Classes per position | 6 | `config/experiment.yaml: alphabet` |
| Valid designs | 6^8 = **1,679,616** | `enumerate_space.sequence_count` |
| Binary variables | 8 × 6 = **48** | `alphabet.variable_index` |
| Position pairs | C(8,2) = **28** | `alphabet.PAIR_ORDER` |

### The six classes

Twenty amino acids are collapsed into six families by shared chemistry
(`config/amino_acid_class_mapping.yaml`):

| Class | Members | Representative shown in UI |
| --- | --- | --- |
| `AROM_W` | W | W |
| `AROM_FY` | F, Y | F |
| `HYDROPHOBIC` | A, V, I, L, M, C | L |
| `SMALL_POLAR` | G, S, T, N, Q | S |
| `CHARGED_NEG` | D, E | E |
| `CHARGED_POS` | K, R, H | K |

**This is the project's most consequential assumption.** It makes the space
enumerable (1.68M instead of 20^8 ≈ 2.56 × 10^10) and therefore makes the
optimum *provable*. The cost is that an answer is a **family pattern, not a
peptide sequence**. Two real peptides this model scores identically could behave
very differently. The displayed letter on each block is one representative
member, for readability only; the optimisation never distinguishes members
within a family.

## 3. Data provenance

**Source:** PEESEgroup `QA-PBP-RL-Nexus`, `Data Folder/PottsModel_Energies/`,
shallow-cloned at commit `cd63b7ef2f4be2725971fe86d5510090d54242e5`.

**Used:** the `bb1` backbone, files `SingleEnergy.txt` and
`PairwiseEnergy.txt`, for PET, PE and PP.

**Reduction** (`score_model.real_potts_coefficients`):

1. The source is a **12-position, 19-residue** Potts energy model.
2. Source positions **2..9** are taken, avoiding its terminal residue encodings.
3. Within each of the six classes, one-body and two-body energies are
   aggregated by **arithmetic mean** over the member residues.
4. The source **minimises** raw Potts energy, so the canonical binding score is
   defined as `-raw_energy`. Higher canonical score = stronger *predicted*
   binding.

Result cached at `data/processed/real_aggregated_potts_model.npz`
(SHA-256 recorded in `results/run_metadata.json`).

**No normalisation is applied.** Full-space standard deviations are PET 52.79,
PE 50.55, PP 54.22 — a ratio below 1.08 — and all three use the same raw-energy
convention, so rescaling would add an unjustified transform. Decision recorded
in `run_metadata.json: score_scale_verification`.

## 4. Scoring function

For a design `c = (c_0 … c_7)` and plastic `p`:

```
score_p(c) = intercept_p
           + sum_{i=0..7}        linear_p[i][c_i]
           + sum_{0<=i<j<=7}     pair_p[i][j][c_i][c_j]
```

`intercept_p = 0` for all three plastics. 8 one-body + 28 two-body terms per
evaluation. The pair terms are what make this a genuinely **quadratic** problem
rather than eight independent lookups — and therefore what makes a QUBO
formulation meaningful rather than decorative.

Units: **dimensionless model score**. Not kcal/mol, not a dissociation
constant, not comparable to any measured quantity.

## 5. Objective

```
objective(c, lambda) = -score_PET(c) + lambda * ( score_PE(c) + score_PP(c) )
```

**Minimised.** Lower is better.

- The leading minus sign means a higher PET score lowers the objective.
- `lambda >= 0` weights avoidance of the off-targets.
- `lambda` is presented in the UI as **Selectivity Priority**. It is a weight
  the user chooses. It is **not measured, derived or fitted** from anything.

Because the winner changes with `lambda`, **no single design is "the" answer**.
Reporting a candidate without stating its `lambda` would be meaningless. The
Results screen shows the winner at every sweep point for this reason.

Benchmark values run: `0, 0.5, 1, 2, 5` (`config/experiment.yaml`). The web app
re-solves **exactly** at any value in `[0, 5]`; it does not interpolate.

### Derived metrics

```
meanOffTarget  = (PE + PP) / 2
worstOffTarget = max(PE, PP)                  the off-target that would cause errors
marginMean     = PET - meanOffTarget          higher is better
marginWorst    = PET - worstOffTarget         higher is better; the strict test
```

`marginWorst <= marginMean` always. Composition labels
(`BALANCED`, `HIGH_HYDROPHOBICITY`, `HIGH_CHARGE`, `LOW_SELECTIVITY`) follow
`metrics.candidate_metrics` exactly; `LOW_SELECTIVITY` fires when
`PET - meanOffTarget <= 0`, i.e. the design does not actually prefer PET.

## 6. Surrogate model

The optimiser needs the objective expressed in switch terms, so a quadratic
Ridge regression is fitted over exactly that basis (`surrogate.py`,
`features.py`):

| Property | Value |
| --- | --- |
| Features | 48 one-hot + 28 × 36 = 1008 class-pair = **1056** |
| Non-zero per row | 36 (8 one-body + 28 two-body) |
| Regulariser | Ridge, `alpha = 1e-6` |
| Splits | disjoint, drawn without replacement from the full space |
| Python run | 12000 / 3000 / 3000 |
| Browser run | 4000 / 1000 / 1000 (scaled down on weak devices) |

**Reported test R² = 1.0, RMSE ≈ 5e-8.**

This normally indicates data leakage and should be challenged. It is expected
here for a structural reason: **the feature basis exactly spans the Potts
model**, so Ridge is not approximating a hard function — it is recovering a
known quadratic form to numerical precision. It is a consistency check on the
encoding, not evidence that the scoring model is biologically correct.

Splits are verified disjoint in code (`splitsDisjoint`) and surfaced in the UI
next to the number, so a reviewer is not left to guess.

## 7. QUBO / Ising formulation

Objective QUBO (`qubo.combine_objective`):

```
linear[i*6+a]                 = -PET.linear[i][a] + lambda*(PE.linear[i][a] + PP.linear[i][a])
quadratic[(i*6+a),(j*6+b)]    = -PET.pair[i][j][a][b] + lambda*(PE.pair[...] + PP.pair[...])
```

Exactly-one-of-six per position is enforced by adding
`P * sum_i ( sum_a x[i,a] - 1 )^2`, expanded as:

```
linear[i,a]            -=  P        for every variable
quadratic[(i,a),(i,b)] += 2P        for every a < b within position i
offset                 +=  P        once per position
```

**Penalty bound** (`qubo.safe_penalty`):

```
P = multiplier * ( sum|linear| + sum|quadratic| ) + 1,     multiplier = 2.0
```

This deliberately exceeds the whole objective range, so a constraint violation
can never be bought by objective gain. At `lambda = 1`, `P = 16953.26`.
For a valid assignment the three contributions cancel to exactly zero.

**Ising form** via `x = (s+1)/2`:

```
h[i]      = linear[i]/2 + sum_{j != i} J_full[i][j]/4
J[i][j]   = quadratic[i][j]/4
constant  = offset + sum_i linear[i]/2 + sum_{i<j} quadratic[i][j]/4
```

Provided because annealing hardware is an Ising machine. Verified to hold for
**arbitrary** binary vectors, not only valid ones.

## 8. Solvers

| Solver | Status | What it establishes |
| --- | --- | --- |
| **Exact brute force** | runs, Python and browser | Enumerates all 1,679,616. Returns the **proven** optimum for this model. The reference every other method is measured against. |
| **Simulated annealing** | runs, Python (`dwave-samplers`) and browser (own Metropolis) | Samples in the 48-variable **binary** space, so it can produce invalid non-one-hot assignments; the validity rate is reported, not hidden. |
| Class-space annealing | implemented, browser | Moves only between valid designs, so needs no penalty. Shown as a contrast to explain what the penalty costs. |
| Greedy descent, random search | implemented, browser | Honest baselines: they show how much of the result is the optimiser and how much is "looked at a lot of options". |
| **D-Wave quantum annealer** | **NOT EXECUTED** | Nothing. No credentials were available; `solve_if_configured` returns a non-executed status with a reason, and the UI reports it as `NOT EXECUTED`. |

### NO QUANTUM HARDWARE EXECUTION

No quantum processor was used at any point, in the website or in the Python
benchmark. The problem is written in a form a quantum annealer would accept.
**That is the entire quantum claim.** No quantum speedup or advantage is
measured, implied or available here.

Runtimes measured in a browser are device-specific and are **not** comparable
with the Python benchmark, another machine, or any published hardware result.
The UI states this above the comparison table.

## 9. Verification

| Check | Method | Result |
| --- | --- | --- |
| Browser scorer vs Python scorer | 398 recorded exact cases | **0.0 absolute error** |
| Five published λ optima | class-sequence identity | all **identical** |
| Sweep objectives vs `results/*.csv` | relative error | **6.8e-10** — attributable to the documented Ridge RMSE (~5e-8), since the CSVs record surrogate predictions while the site shows exact values |
| QUBO energy vs direct objective | two independent code paths | agree < **1e-9** |
| Penalty contribution on valid designs | should be exactly zero | < **1e-8** (float cancellation of a ~1.7e4 penalty) |
| Invalid assignments penalised | 5 kinds of breakage | always worse than the best valid |
| Ising ↔ QUBO identity | arbitrary binary vectors | agree < **1e-8** |
| Encode/decode | round-trip | lossless on every case |
| Cached `.npz` vs source data | re-derived from raw files | matches to 1e-12 |

The browser's coefficients are **generated** from the same `.npz` the Python
pipeline uses (`scripts/export_web_model.py`), and a parity test fails if the
export goes stale. The two halves cannot drift apart silently.

## 10. What this does not establish

1. **No laboratory validation.** No peptide here has been synthesised,
   purified, or exposed to any plastic. There is no measured binding constant,
   no adhesion test, no microscopy, no spectroscopy.
2. **No binding prediction.** A high score is not a measured affinity. It is a
   dimensionless ranking quantity inside one model.
3. **No degradation or recycling claim.** Enzymatic breakdown, depolymerisation
   and recycling chemistry are not modelled at all.
4. **No molecular geometry.** There are **no atomic coordinates in this
   project**. Therefore no bond lengths, bond angles, contact distances,
   binding pockets, hydrogen bonds, molecular surfaces or docking poses are
   computed or claimed. Every molecular picture on the site is an explicitly
   labelled illustration.
5. **No quantum result.** See §8.
6. **A family pattern, not a sequence.** See §2.
7. **One backbone, one aggregation rule.** The energies come from `bb1` with
   arithmetic-mean class aggregation. A different backbone or rule could change
   which design wins. The result is a statement about *this model*.

## 11. Reproducing

```bash
py scripts/run_benchmark.py --config config/experiment.yaml   # seed 42
py -m pytest -q
py scripts/export_web_model.py                                 # regenerate browser model
cd web && npm run verify                                       # build + tests + assertion count
```

Every stochastic step draws from a seeded generator. `results/run_metadata.json`
records the seed, the dataset identifier, the source checksum, software
versions, per-stage runtimes, the validation errors and the D-Wave status.

## 12. Sources

Cite the original work, not this repository.

- Dhoriyani et al. (2025), *PNAS Nexus* — biophysical modelling, quantum
  computing and AI for plastic-binding peptides.
- PEESEgroup, **QA-PBP-RL-Nexus** — the Potts energy data used here.
- Jain et al. (2025), *Chemical Science* — AI-driven plastic-binding peptide design.
- PEESEgroup, LSTM-SA — PET/PE/PP 12-mer datasets (related, not used directly).
- D-Wave Ocean documentation — defines the QUBO/BQM format.
