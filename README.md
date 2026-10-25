# Q-BIND Select

Searching 1,679,616 short peptide designs for the ones a published physics model
scores higher for **PET** (drink bottles) than for **PE** (bags and films) or
**PP** (tubs and caps).

Two halves, sharing one scoring model:

| | What it is | Where |
| --- | --- | --- |
| **Benchmark** | Reproducible offline Python experiment. Enumerates the full space, fits quadratic Ridge surrogates, builds and validates 48-variable QUBOs, sweeps lambda, runs exact brute force and simulated annealing, and writes CSV/JSON results plus figures. | repository root |
| **Quantum** | A real gate-model variational quantum algorithm — XY-mixer QAOA — run on the same objective by **exact statevector simulation**. 48 nominal qubits, no hardware, no speedup claimed. | [`src/qbind_select/quantum/`](./src/qbind_select/quantum) |
| **Website** | React + TypeScript app that does the same science **live in the browser** and explains it to a non-specialist. Seven screens, a drag-and-drop peptide builder, a real nine-stage pipeline, a runnable quantum circuit, honest exports. | [`web/`](./web) |

> **All outputs are computational predictions.** Nothing here has been tested in
> a laboratory. **NO QUANTUM HARDWARE EXECUTION** — the quantum algorithm is a
> real gate-model circuit, run by exact statevector simulation on a classical
> CPU. **No quantum speedup is claimed:** brute force over the same 1,679,616
> designs is faster here, and is the proven reference every quantum result is
> scored against. No peptide described here has been synthesised, and no
> binding, adhesion, plastic degradation or recycling benefit is demonstrated.

---

## The science in one paragraph

Eight positions, each holding one of six amino-acid *families*, gives
`6^8 = 1,679,616` valid designs — small enough to check exhaustively, which is
what makes the answer provable rather than merely plausible. A six-class Potts
model (aggregated from the public QA-PBP-RL-Nexus `PottsModel_Energies` data for
PET/PE/PP, backbone `bb1`) scores every design against all three plastics. The
search minimises

```
objective = -PET + lambda * (PE + PP)
```

over the valid space. `lambda` — presented in the UI as **Selectivity
Priority** — is a weight the user chooses, not a measured quantity. The one-hot
constraint (exactly one family per position) is enforced with a penalty `P`
bounded above the whole objective range, so the 48-variable binary form is
exactly equivalent to the class-space problem.

## The quantum method, and what it is honestly worth

Writing the problem as a QUBO is a *translation*, not a result — any problem of
this shape can be written that way. So the project also runs a real gate-model
quantum algorithm on the objective, and then measures how well it does against
an answer that is already proven.

The algorithm is the **Quantum Alternating Operator Ansatz** (Hadfield et al.
2019) with complete-graph **XY mixers** over the one-hot blocks. The mixer

```
H_XY = sum_positions sum_{u<v in that position} ( X_u X_v + Y_u Y_v )
```

conserves the number of 1s inside each position's six-qubit block, so starting
from a product of W states the circuit **cannot** produce an invalid design.
Two consequences:

1. **Validity is 1.0 by construction**, not by tuning a penalty weight. Every
   shot is a real peptide.
2. **A 48-qubit circuit becomes simulable.** `2^48` amplitudes is ~4.5 PB, but
   the dynamics never leave the feasible sector of dimension `6^8 = 1,679,616`
   — 27 MB. That sector is simulated **exactly**. It is a symmetry-sector
   simulation, not an approximation of the circuit.

Measured on the real Potts data at lambda = 1 (`results/quantum_xy_depth_sweep.csv`):

| p | Approximation ratio | Optimum probability | Enrichment vs uniform | Top outcome is the proven optimum? |
| --- | --- | --- | --- | --- |
| 1 | 0.7428 | 0.066% | 1,104x | yes |
| 2 | 0.8193 | 0.246% | 4,137x | yes |
| 3 | **0.8550** | 0.465% | **7,812x** | **yes** |

Uniform random sampling over the same designs scores `0.4326`. At every depth,
the single most probable measurement is `LSWWLLFL` — the design brute force
*proves* is optimal over all 1,679,616.

### The finding worth reporting

The penalty formulation that a quantum **annealer** requires is measurably the
wrong choice for a gate-model circuit on this problem. A provably safe one-hot
penalty must exceed the whole objective range, which here makes it **16.5x
larger** than the energy differences being resolved:

| Encoding | Valid measurements | Margin over random guessing |
| --- | --- | --- |
| Penalty QUBO + standard X mixer | 44.6% | **+0.0021** |
| One-hot blocks + XY mixer | **100%** | **+0.4224** |

Same objective, same proven reference optimum: roughly **205x** the margin, and
no wasted shots.

> **No quantum hardware. No speedup.** Exhaustive classical search over the same
> space is faster and returns a *proven* optimum — which is precisely why it is
> used as the reference rather than the rival. The XY mixer is applied as an
> exact matrix exponential; hardware must Trotterise, and that error, along with
> all device noise, is **not modelled**. Full statement and gate-cost accounting
> in [`SCIENTIFIC_METHOD.md`](./SCIENTIFIC_METHOD.md) section 8b.

```bash
py scripts/run_quantum.py --depths 1,2,3   # ~20 min, writes results/quantum_*
py -m pytest tests/test_quantum_qaoa.py -q # 42 tests, seconds
```

The browser runs the same algorithm live on a smaller slice, on the **Quantum**
screen. `web/src/science/qaoa.ts` is pinned to the Python implementation to 1e-9
by `web/tests/science/qaoa-parity.test.ts` against a golden fixture, so the two
cannot drift.

## Molecular chemistry: depiction is separate from optimisation

The optimiser searches amino-acid **classes**. A class is not a molecule, so a
class sequence cannot be drawn as one without first choosing a member of each
class. That choice is made explicitly, by the user or by the documented
representative, and `src/chem` is structurally unable to influence a score:
nothing in `src/science` imports from it.

From a chosen residue sequence the chemistry layer builds a real connection
table — every heavy atom with its standard PDB name, every bond with an
explicit Kekule order — and from that derives the SMILES, the molecular
formula, the average and monoisotopic mass, the ring and rotatable-bond counts,
and a 3D conformer. The conformer is built by the Natural Extension Reference
Frame construction from tabulated equilibrium bond lengths and angles, with
textbook backbone torsions, exact planar templates for the aromatic rings, and
a short steric-relief minimisation. It is an **idealised generated conformer**:
not an experimental structure, not a molecular-dynamics result, not a docking
pose, and every surface that shows it says so.

| Library | Role | Loaded |
| --- | --- | --- |
| [RDKit](https://www.rdkit.org/) MinimalLib (WebAssembly) | 2D structure depiction, and the independent check on our own chemistry | On demand; the landing-page diagram is pre-rendered at build time by the same engine |
| [3Dmol.js](https://3dmol.csb.pitt.edu/) | 3D molecular viewer, standard CPK element colouring | On demand, only when the 3D view is opened |

Correctness is not asserted, it is checked. `tests/chem/chemistry.test.ts`
verifies the published molecular formula and mass of all nineteen free amino
acids, the condensation identity `sum(residues) - (n-1) H2O` for whole
peptides, neutral valence at every atom, L handedness at every alpha carbon,
planarity and bond lengths of every aromatic ring, trans peptide bonds, and the
absence of steric clashes. `tests/chem/rdkit-crosscheck.test.ts` then hands the
same molecules to RDKit and requires it to agree on formula, both masses, ring
counts and the CIP descriptor at every stereocentre — including the (2S,3S)
isoleucine and (2S,3R) threonine centres, one of which this cross-check caught
being wrong.

```bash
cd web
npx vitest run tests/chem     # the chemistry layer and the RDKit cross-check
```

## Running the benchmark

```bash
py scripts/run_benchmark.py --config config/experiment.yaml
py -m pytest -q
```

Results land in `results/`, figures in `figures/`. The default run uses the real
public Potts data; `score_source: proxy` in the config switches to a clearly
labelled synthetic fallback.

The QA-PBP-RL-Nexus source files (~23 MB) are not committed. Three tests skip
automatically when they are absent; the rest of the suite runs regardless.

## Running the website

```bash
cd web
npm install
npm run dev          # http://localhost:5173
npm run verify       # build + full test suite + measured assertion count
```

See [`web/docs/DEPLOYMENT.md`](./web/docs/DEPLOYMENT.md) for hosting and
[`web/docs/SECURITY.md`](./web/docs/SECURITY.md) for the dependency and CSP
review.

## How the two halves stay in agreement

The browser cannot be allowed to drift from the published benchmark, so it does
not get its own copy of the science:

```bash
py scripts/export_web_model.py
```

This generates both the coefficients the browser scores with
(`web/public/model/potts_6class_8mer.json`) and a 398-case golden fixture
(`web/tests/fixtures/python_golden.json`) from the same `.npz` the Python
pipeline uses. `web/tests/science/parity.test.ts` then asserts the TypeScript
scorer matches the Python scorer to within 1e-9 on every case, and that all five
published lambda optima reproduce the same winning class sequences. A stale
export fails the suite rather than quietly shipping wrong numbers.

Measured agreement: **0.0 absolute error** between the two exact scorers, and
`6.8e-10` relative on the sweep objectives — the residual being the documented
Ridge surrogate RMSE (~5e-8), since `results/*.csv` records surrogate
predictions while the site shows exact model values.

## Repository layout

```
config/            experiment and class-mapping YAML
data/raw/          QA-PBP-RL-Nexus source data (not committed)
data/processed/     cached reduced model + full-space score cache
docs/              methodology, evidence, judge explanation
results/           CSV/JSON output of the last benchmark run
figures/           matplotlib output
scripts/           run_benchmark.py, run_quantum.py, export_web_model.py, helpers
src/qbind_select/  the Python scientific core
src/qbind_select/quantum/  gate-model QAOA (XY mixer), exactly simulated
tests/             pytest suite
web/               the website (see web/docs/)
.github/workflows/ CI, and a Pages deploy workflow that has not been run
```

## Verification status

| Gate | Result |
| --- | --- |
| Python suite | 51 passed (3 skip without the source dataset) |
| Web typecheck | clean |
| Web test suite | 984 passed across 16 files |
| Measured executed assertions | 36,228 (single clean run) |
| Simulated persona review | 500 scenarios, 144 environments, 4,969 checks, **0 critical / 105 major** (all pre-existing — see below) |
| Python/TypeScript QAOA parity | 56 cases, agreement to 1e-9 on the real Potts model |
| Quantum benchmark reproducibility | `results/quantum_*` regenerated from seed 42; generated web summary verified against them |
| Accessibility | 14 axe scans clean; 100 WCAG contrast checks pass in both themes |
| Production build | passes |
| `npm audit` | 0 vulnerabilities (production and dev) |
| Public deployment | **not deployed** — no hosting credentials were available |

> **The persona figure was re-measured, and it is not zero.** Earlier revisions
> of this file recorded "0 findings". A full run on the current tree reports
> **0 critical / 105 major / 0 minor** across 4,969 checks. Both finding
> classes were verified against the committed tree and are **pre-existing, not
> introduced by the quantum or layout work**:
>
> - **84 x `onePurpose` on Discover.** The check wants the screen's
>   one-sentence purpose in the rendered text, with an exemption for Discover
>   if the literal strings `The problem.` and `What this does.` appear. The hero
>   renders those as `<dt>` labels with no trailing full stop, so
>   `textContent` yields `The problemRecycling works far better...` and the
>   exemption never matches. `git show HEAD` confirms the same period-less
>   markup, and that `SCREENS.discover.purpose` has never been rendered on that
>   screen.
> - **21 x `jargonExplained` on Results.** A bare lambda symbol appears without
>   the plain-language name in some cold-data scenarios. `Results.tsx` is
>   byte-identical to the committed version for that term, and the card removed
>   from `ScientificValidity.tsx` contained neither a lambda nor the phrase, so
>   that edit cannot have caused it.
>
> The suite still passes because it gates on **critical** findings, of which
> there are none. The 105 majors are recorded in
> `web/review/persona-matrix.json` as open, which is where they should be:
> visible, attributed, and not silently relabelled as zero.

The executed-assertion figure is **36,228**, measured on a single clean run
(`rm web/.vitest-assertions.jsonl && npx vitest run && npm run assertions`).

That measurement needs the `rm`. `tests/setup.ts` *appends* each worker's
total to the log file, and `npm run assertions` sums whatever it finds, so
running the suite repeatedly without clearing it silently adds the runs
together. An earlier draft of this file reported 433,637 from exactly that
mistake - several accumulated runs, plus entries from throwaway probe files -
and it has been corrected rather than left standing. The previous figure of
29,464 was a smaller suite; the rise to 36,228 is the 183 tests added for the
quantum layer and the layout review.

The counter itself was checked against a controlled probe: ten tests with
three assertions each reported exactly 30.

The persona review is **scripted heuristic inspection, not user testing**. No
human participated. Whether a novice can actually explain PET vs PE vs PP, what
a peptide is, or what the results do not prove remains **unverified** and would
need moderated testing with real participants.

## Sources

Please cite the original work rather than this repository.

- Dhoriyani et al. (2025), *PNAS Nexus* — biophysical modelling, quantum
  computing and AI for plastic-binding peptides.
- PEESEgroup, **QA-PBP-RL-Nexus** — Potts energy data and quantum-annealing
  code. Shallow-cloned at `cd63b7ef2f4be2725971fe86d5510090d54242e5`.
- Jain et al. (2025), *Chemical Science* — AI-driven plastic-binding peptide
  design.
- PEESEgroup, LSTM-SA — PET/PE/PP 12-mer datasets (related, not used directly).
- D-Wave Ocean documentation — defines the QUBO/BQM format used.
