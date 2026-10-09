# FEATURE_MATRIX.md

Every major feature, its real data source, how it was tested, and what it does
not do. "Tested" names the suite that actually exercises it.

Legend — **Status**: `shipped` works and is tested · `partial` works with a
stated limitation · `absent` specified but not built · `n/a` not applicable to
this project's data.

---

## Core science

| Feature | Status | Data source | Tested by | Limitations |
| --- | --- | --- | --- | --- |
| Exact six-class Potts scorer | shipped | `data/processed/real_aggregated_potts_model.npz`, exported to `web/public/model/potts_6class_8mer.json` by `scripts/export_web_model.py` | `parity.test.ts` (398 cases, **0.0 error** vs Python), `scoring.property.test.ts` | Dimensionless model score. One backbone (`bb1`), arithmetic-mean class aggregation. |
| Objective `-PET + λ(PE+PP)` | shipped | derived from the scorer | `parity.test.ts` (all 5 λ), `scoring.property.test.ts` (linearity in λ) | λ is a chosen weight, not measured. |
| Candidate metrics, margins, warning labels | shipped | computed | `parity.test.ts` (string-exact label parity with Python) | `marginWorst <= marginMean` always; composition labels are heuristics. |
| 48-variable QUBO construction | shipped | computed from the scorer | `qubo.property.test.ts`, `parity.test.ts` | — |
| One-hot penalty bound `P = 2Σ\|c\|+1` | shipped | computed | `qubo.property.test.ts` (5 breakage kinds), `parity.test.ts` (matches Python to 1e-12 relative) | Deliberately conservative; not tuned. |
| Ising transformation | shipped | computed | `qubo.property.test.ts` (identity holds for **arbitrary** binary vectors) | Format only. No hardware. |
| Exact brute force over 1,679,616 | shipped | full enumeration | `solvers.test.ts`, E2E `a full live run completes` | Proven optimum **for this model**. |
| Simulated annealing (binary space) | shipped | own Metropolis implementation | `solvers.test.ts` (determinism, validity, cannot beat brute force) | Small browser budget by design; validity rate reported, not hidden. |
| Class-space annealing, greedy descent, random search | shipped | computed | `solvers.test.ts` | Baselines for honesty, not headline results. |
| Live Ridge surrogate fit (1056 features, Cholesky) | shipped | fitted in-browser from the exact scorer | `surrogate-and-io.test.ts` (R² ≥ 0.999, splits disjoint) | R² = 1.0 is **expected** — the basis spans the model exactly. |
| Seeded RNG, reproducibility | shipped | `mulberry32` | `surrogate-and-io.test.ts` (determinism, distribution, sampling without replacement) | Not cryptographic; never used for security. |
| **D-Wave quantum execution** | **absent** | — | — | **NO QUANTUM HARDWARE EXECUTION.** No credentials available. Reported as `NOT EXECUTED` with a reason everywhere it appears. |

## Screens

| Feature | Status | Tested by | Limitations |
| --- | --- | --- | --- |
| Discover — 30-second framing, plastics, how-it-works, honesty | shipped | `screens.test.tsx`, E2E route coverage, persona review | Comprehension by a real novice is **unverified**. |
| Build — drag / tap / keyboard editor, live rescoring, before-after explanation, A/B slots, guided challenge | shipped | `screens.test.tsx` (14 tests), E2E (keyboard, arrows, real `dragTo`, native `DragEvent`, tap-to-place, undo/redo) | HTML5 drag is desktop-only; mobile uses tap-to-place (separately tested). |
| Optimise — Selectivity Priority slider, 9-stage live pipeline, cancel | shipped | `screens.test.tsx`, E2E (full run, cancel, stale-drop, main-thread responsiveness) | Exact re-solve needs a completed run; the screen says so before one exists. |
| Compare — podium, sortable table, λ sweep, Pareto, solver comparison | shipped | `screens.test.tsx`, E2E | Pareto is **sampled** (1200 of 1.68M) and badged `Sampled`. |
| Understand — 48 switches, QUBO heatmap, scale, confidence centre, about, honesty | shipped | `screens.test.tsx`, E2E (heatmap draws >200 cells, penalty value correct) | Scale curves are **derived counts**, badged `Model estimate`, not runtimes. |
| Results — written report, provenance, six downloads, print styles | shipped | `screens.test.tsx`, E2E (all six download, parse, match on-screen values) | Results are session-only; a reload returns to cold state by design. |
| **Judge Demo route (3-minute guided demonstration)** | **absent** | — | Specified in the brief §11. Not built. **Quality Gate 9 fails.** |
| Scroll-driven cinematic storytelling (6 pinned scenes) | absent | — | Not built. The hero is interactive but there is no scroll-linked camera timeline. |

## Visualisation

| Feature | Status | Data source | Tested by | Limitations |
| --- | --- | --- | --- | --- |
| 3D peptide hero (canvas, real 3D math, depth sorting, drag-to-rotate, pause) | shipped | **illustrative geometry**; colours from the real class sequence | E2E (canvas paints >500 px, animates, pause genuinely stops it, drag rotates) | **Not chemistry.** An alpha-helix-like curve chosen because it reads as a protein. No atomic coordinates. Labelled illustrative wherever shown. |
| Static SVG fallback | shipped | same | E2E reduced-motion project | Used on reduced-motion and low-tier devices. |
| Conceptual binding diagram | shipped | the **only** quantitative input is each position's real per-position contribution difference between the target and the other two plastics | `screens.test.tsx`, E2E (`not molecular docking` label visible) | Explicitly "not docking, not a simulation, not an observed pose". Markers below 0.25 difference are omitted. |
| QUBO coefficient heatmap | shipped | the real 48×48 matrix at the selected λ | E2E (cell count, penalty value) | Upper-triangular + diagonal; zeros blank. |
| Line / scatter / bar charts, score bars | shipped | computed | `screens.test.tsx` | Hand-written SVG; axes, units, legends and a text summary on every chart. |
| Plastic object illustrations | shipped | drawn | `screens.test.tsx` | Line drawings of everyday objects, not chemistry. |
| **Mol\* / PDB structural viewer, representation modes (cartoon, surface, space-filling), bond-length and angle measurement, atom/residue picking, residue↔3D linking, pick-and-place docking** | **n/a** | — | — | **There are no atomic coordinates in this repository.** The scientific input is an energy model over amino-acid *classes*. Building a molecular viewer would require inventing coordinates, which §Rule 3 of the brief forbids and which would be the most serious possible misrepresentation here. Stated plainly in `PROJECT_AUDIT.md` A-03. |

## Interaction, state and platform

| Feature | Status | Tested by | Limitations |
| --- | --- | --- | --- |
| Single typed source of truth, stale-response rejection by `runId` | shipped | `screens.test.tsx` (stale run dropped), E2E (hammered Run → one run) | — |
| Undo / redo / reset, A-B compare, favourites, saved scenarios | shipped | `screens.test.tsx`, E2E | 50-step history cap; scenarios capped at 30. |
| Beginner / Researcher detail modes | shipped | `screens.test.tsx` | Same underlying computation in both. |
| Theme (system/dark/light), motion control | shipped | E2E (both themes painted; reduced motion stops the hero) | — |
| Share link via URL hash | shipped | `screens.test.tsx`, E2E (restores exact design; 14 hostile hashes survive) | Encodes only 8 digits + λ. Local only. |
| localStorage preferences | shipped | `surrogate-and-io.test.ts` fuzz, E2E (corrupt + hostile payloads) | Re-validated on every read; one key; clearable from the UI. |
| Web Worker computation, cancel, device-aware workload | shipped | E2E (worker fetched, cancel works, UI responsive during run) | Allocates ~40 MB for a full run; failure is explained, not silent. |
| Keyboard operation throughout, roving tabindex, focus trap, skip link | shipped | `a11y.test.tsx`, E2E (focus ring on every control, dialog traps focus, skip link reveals) | — |
| axe accessibility | shipped | `a11y.test.tsx` — 14 scans, 0 violations | `color-contrast` and `target-size` cannot run in jsdom; covered below. |
| WCAG 2.2 AA contrast | shipped | `contrast.test.ts` — 100 checks from the real tokens, both themes | Computed from tokens, not from rendered pixels. |
| Responsive 320→1920, no horizontal overflow | shipped | E2E measured on 6 routes × 6 widths, `scrollX = 0` | Fixed during this audit (D-01). |
| CSV / JSON / Markdown export | shipped | `export.test.ts` (1,518 assertions: RFC4180 quoting, CSV-injection neutralisation, numeric round-trip, traversal-safe names), E2E (real downloads parsed) | — |
| SVG chart export | partial | — | `svgToString` exists and is unit-tested; no UI button wires it up yet. |
| **FASTA export** | absent | — | Deliberate: a FASTA record implies a specific residue sequence. The result is a *class pattern*; emitting `LSWWLLFL` as FASTA would misrepresent it. |
| PDF report | partial | E2E not asserted | Delivered via browser print with dedicated print styles, not a generated PDF. |
| Print styles | shipped | — | Navigation/controls removed, print-safe colours, run metadata footer. |
| SPA deep links, browser back/forward | shipped | E2E (all 6 routes direct, back/forward traversal) | — |
| CSP, security headers, 0 vulnerabilities | shipped | `npm audit` both scopes; `web/docs/SECURITY.md` | `style-src 'unsafe-inline'` required by inline chart geometry; GitHub Pages cannot set headers. |
| CI workflow | shipped | — | Committed; never executed here (no CI runner). |
| **Public deployment** | **absent** | — | Configs for Netlify/Vercel/Pages committed, production preview verified locally. No credentials, so nothing is live and `pages.yml` has never run. |

## Verification totals

| Suite | Count | Status |
| --- | --- | --- |
| Python (pytest) | 10 tests | pass (3 skip without the uncommitted 23 MB dataset) |
| Vitest unit / property / integration | 816 tests across 10 files | pass |
| Measured executed assertions | **29,464** | counted from `expect.assertionCalls`, per-file breakdown via `npm run assertions` |
| Simulated persona review | 500 scenarios, 144 environments, 4,969 checks | 0 findings |
| axe scans | 14 | 0 violations |
| WCAG contrast checks | 100 | pass, both themes |
| Playwright E2E (real Chromium, production build, desktop + mobile) | see `TEST_REPORT.md` | — |
| `npm audit` | production and dev | **0 vulnerabilities** |
| Production build | — | passes |

## Honest summary of what is missing

1. **Judge Demo route** — specified, not built. Gate 9 fails.
2. **Molecular viewer with real structures** — impossible with this data without fabrication.
3. **Scroll-driven cinematic sequence** — not built.
4. **Public deployment** — configured, not executed.
5. **Real-user comprehension testing** — not possible in this environment.
6. **SVG export button, generated PDF, FASTA** — partial or deliberately omitted, reasons above.
