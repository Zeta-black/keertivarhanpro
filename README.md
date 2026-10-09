# Q-BIND Select

Searching 1,679,616 short peptide designs for the ones a published physics model
scores higher for **PET** (drink bottles) than for **PE** (bags and films) or
**PP** (tubs and caps).

Two halves, sharing one scoring model:

| | What it is | Where |
| --- | --- | --- |
| **Benchmark** | Reproducible offline Python experiment. Enumerates the full space, fits quadratic Ridge surrogates, builds and validates 48-variable QUBOs, sweeps lambda, runs exact brute force and simulated annealing, and writes CSV/JSON results plus figures. | repository root |
| **Website** | React + TypeScript app that does the same science **live in the browser** and explains it to a non-specialist. Six screens, a drag-and-drop peptide builder, a real nine-stage pipeline, honest exports. | [`web/`](./web) |

> **All outputs are computational predictions.** Nothing here has been tested in
> a laboratory. **NO QUANTUM HARDWARE EXECUTION** — the problem is written in a
> form a quantum annealer could accept, and that is the entire quantum claim.
> No peptide described here has been synthesised, and no binding, adhesion,
> plastic degradation or recycling benefit is demonstrated.

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
scripts/           run_benchmark.py, export_web_model.py, helpers
src/qbind_select/  the Python scientific core
tests/             pytest suite
web/               the website (see web/docs/)
.github/workflows/ CI, and a Pages deploy workflow that has not been run
```

## Verification status

| Gate | Result |
| --- | --- |
| Python suite | 10 passed (3 skip without the source dataset) |
| Web typecheck | clean |
| Web test suite | 816 passed across 10 files |
| Measured executed assertions | 29,464 |
| Simulated persona review | 500 scenarios, 144 environments, 4,969 checks, 0 findings |
| Accessibility | 14 axe scans clean; 100 WCAG contrast checks pass in both themes |
| Production build | passes |
| `npm audit` | 0 vulnerabilities (production and dev) |
| Public deployment | **not deployed** — no hosting credentials were available |

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
