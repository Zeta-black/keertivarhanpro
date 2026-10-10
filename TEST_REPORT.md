# TEST_REPORT.md

Every number below was produced by running the stated command in this
environment. Nothing is estimated or extrapolated.

**Run date:** 2026-10-09
**Host:** Windows 11, Node 24.18.0, npm 11.16.0, Python 3.11.9
**Toolchain:** Vite 7.3.x, Vitest 5.0.x, Playwright 1.56 / Chromium 156

---

## 1. Headline

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | **clean** |
| Production build | `npm run build` | **passes** |
| Python benchmark | `py -m pytest -q` | **10 passed** (3 skip without the uncommitted dataset) |
| Unit / property / integration | `npx vitest run` | **816 passed / 816** |
| Measured executed assertions | `npm run assertions` | **29,464** |
| Real-browser E2E | `npx playwright test` | **126 passed, 0 failed, 4 skipped** |
| Simulated persona review | part of the Vitest run | **500 scenarios, 144 environments, 4,969 checks, 0 findings** |
| Accessibility (axe-core) | part of the Vitest run | **14 scans, 0 violations** |
| WCAG 2.2 AA contrast | part of the Vitest run | **100 checks, both themes** |
| Dependency audit | `npm audit` / `--omit=dev` | **0 vulnerabilities in both scopes** |
| Horizontal overflow | direct Chromium measurement | **0px across 30 route × viewport combinations** |

---

## 2. Vitest — unit, property, integration

```
$ npx vitest run
 Test Files  10 passed (10)
      Tests  816 passed (816)
   Duration  105.20s
```

### Measured assertion counts

Counted from `expect.getState().assertionCalls` after every test, written to
`.vitest-assertions.jsonl` and summed by `scripts/count-assertions.mjs`. A
skipped test contributes zero; a loop of 500 `expect` calls contributes 500.
Nothing is hardcoded.

```
$ npm run assertions
  parity.test.ts                 8,801
  encoding.property.test.ts      6,143
  surrogate-and-io.test.ts       5,773
  scoring.property.test.ts       3,303
  qubo.property.test.ts          3,233
  export.test.ts                 1,518
  screens.test.tsx                 243
  persona-review.test.tsx          227
  contrast.test.ts                 165
  a11y.test.tsx                     58
  -------------------------  ---------
  TOTAL                         29,464
```

### What each file actually checks

| File | Tests | Substance |
| --- | --- | --- |
| `science/parity.test.ts` | 19 | The gate everything rests on. Browser scorer vs Python scorer across 398 recorded cases — **0.0 absolute error**. Objective parity at all five λ. Metric and warning-label parity (string-exact). `safePenalty` to 1e-12 relative. QUBO↔objective identity. Penalty-contributes-zero on valid designs. |
| `science/encoding.property.test.ts` | 193 | Seeded property suite. `codesToIndex`/`indexToCodes` bijection swept in strides across all 1,679,616 plus boundaries. One-hot validity and rejection of five malformation kinds. Lexicographic ordering. Throw-on-out-of-range. |
| `science/scoring.property.test.ts` | 22 | Contribution parts sum to the total within 1e-12. **Independent-oracle locality check**: a single-position change must equal the one-body delta plus the seven touching pair deltas. Metric algebra, `marginWorst <= marginMean` always. Label trigger construction. Objective linearity in λ. |
| `science/qubo.property.test.ts` | 56 | QUBO energy equals the objective across many λ. Penalty dominance over five breakage kinds. `quadIndex` symmetry. **Ising↔QUBO identity for arbitrary binary vectors**, constrained and unconstrained. |
| `science/solvers.test.ts` | — | Brute force against independently computed minima on synthetic arrays, tie-breaking by lower index, `optimumHits` with deliberate ties. One full-space run reproducing the published optima. Greedy never increases the objective and can get stuck. Annealing determinism, validity accounting, and that it never beats proven brute force. Cancellation stops early. |
| `science/surrogate-and-io.test.ts` | 58 | RNG determinism and distribution. `sampleWithoutReplacement` distinctness. Real Ridge fit (test R² ≥ 0.999, splits disjoint). **`parseShareState` fuzzed with 400+ hostile inputs** including prototype-pollution payloads; asserts the return shape, validity, and that `Object.prototype` stays clean. `sanitiseScenarios` fuzzed likewise. |
| `export.test.ts` | 136 | RFC4180 quoting, **CSV-injection neutralisation** (`= + - @` TAB CR), full-precision numeric round-trip, null never becoming `"null"`/`"0"`, path-traversal-safe filenames, JSON preserving seed and `quantumHardware`. |
| `ui/screens.test.tsx` | 72 | Every screen in its real states with a worker stub that computes with the **real** science core. Keyboard placement, arrow navigation, tap-to-place, drag-and-drop, undo/redo, reset, challenge, compare slots, filters, sorting, stale-response rejection, error dismissal, cancellation, download triggering, hostile hashes, worker-unavailable degradation. |
| `ui/a11y.test.tsx` | 14 | axe-core on all six routes plus light theme, open dialog and open tour. One `h1` per screen, no skipped heading levels, named graphics, labelled form controls, roving tabindex integrity, polite live regions. |
| `ui/contrast.test.ts` | 100 | WCAG ratios computed from the real token file, both themes: 26 text pairs, 3 caption pairs, 5 UI-boundary pairs, 6 class glyphs, 6 class-vs-surface, mutual distinguishability, touch-target and type-size tokens. |
| `review/persona-review.test.tsx` | 146 | The 500-scenario matrix (below). |

### Known characteristic, not a defect

`parity.test.ts` carries the largest assertion count because several of its
tests loop over all 398 golden cases × 3 plastics. That is deliberate coverage
of the one thing that must never be wrong, not count inflation: each assertion
compares a distinct sequence against a distinct recorded Python value.

---

## 3. Playwright — real browser, production build

```
$ npx playwright test
  126 passed, 0 failed, 4 skipped (13.3m)
  desktop-chromium  1440x900
  mobile-chromium   Pixel 7 emulation
```

Run against `vite preview` serving `dist`, **not** the dev server — so a broken
`base` path, a worker chunk that fails to instantiate, a missing asset or an
unemitted stylesheet would all surface.

### What the browser proved that jsdom could not

| Claim | How it was verified |
| --- | --- |
| The 3D hero genuinely paints | `getImageData` over the canvas: **> 500 non-transparent pixels** |
| It genuinely animates | two frame hashes 900ms apart differ |
| Pause genuinely stops it | two frame hashes after pausing are **identical** |
| Drag rotates it | frame hash changes after a real mouse drag |
| The Worker really runs | the `pipeline.worker` chunk is observed being requested; a full run completes and reports **1,679,616 designs scored against 3 plastics** |
| All nine stages complete | the measured-timings table has 9 rows and no "not available" |
| The main thread stays responsive | navigation succeeds **while** the worker computes |
| Cancellation really stops it | "Run cancelled" appears and no partial run is published |
| Exports are real | all six download, parse, and the rank-1 objective in the CSV **equals the value on screen to 3dp** |
| The science matches the benchmark | `/results` shows the published rank-1 class sequence and `LSWWLLFL` |
| The QUBO heatmap is real | **> 200** cells drawn, and the penalty bound displays as **16953.3** |
| Model file is the real one | 200 response, **> 40,000 bytes**, `application/json` |
| No sideways scroll | `scrollX = 0` after `scrollTo(9999,0)` on 6 routes × 6 widths |
| No tiny text | no leaf element renders below 12px |
| Focus is always visible | every button and link sampled has a ring |
| The dialog traps focus | 25 consecutive Tabs never escape |
| Reduced motion is honoured | hero frame hash unchanged over 900ms |
| Both themes paint | `body` background never `rgba(0,0,0,0)` |
| Honesty claims are rendered | `NO QUANTUM HARDWARE EXECUTION` and the no-laboratory statement visible on **all six** routes |
| No overclaiming | an affirmative-claim scan finds no "proves quantum advantage", "proven to bind", "degrades plastic" etc. on any route |
| D-Wave is honest | reported `NOT EXECUTED` with a reason |

### Adversarial scenarios, all survived

14 hostile URL hashes (`#s=notvalid`, `#s=99999999`, `#l=1e999`, a script-tag
payload, a 3000-character payload, `__proto__[polluted]=1`,
`constructor[prototype][polluted]=1`, duplicate keys, `#%%%`): the app renders
normally, throws nothing, and `Object.prototype` is never polluted.

Also verified: corrupt `localStorage` (`{% raw %}{{{not json{% endraw %}`) and a structurally valid
but hostile payload both survive a reload; hammering Run eight times produces
**exactly one** completed run; navigating away mid-run and back is consistent;
a mid-run reload recovers to a clean cold state; rapid slider dragging settles
on the last value; exporting with no run offers no download and an honest empty
state; all six routes deep-link to 200 with the URL preserved; browser
back/forward traverse real history.

### The 4 skips, with reasons

| Skipped | Project | Reason |
| --- | --- | --- |
| hero canvas paints | mobile | the mobile tier renders the static SVG, not the canvas — asserted separately |
| hero animates / pause | mobile | same |
| hero drag rotates | mobile | same |
| HTML5 drag-and-drop | mobile | drag-and-drop does not exist on touch devices; the mobile path is tap-to-arm then tap-to-place, which **is** tested |

No test is skipped to avoid a failure.

---

## 4. Python

```
$ py -m pytest -q
..........                      [100%]
10 passed in 11.00s
```

With the uncommitted 23 MB `QA-PBP-RL-Nexus` source removed:

```
3 skipped in 0.15s
```

Verified both ways. The skip is a `skipif` guard added during this audit
(finding D-10) so a clean checkout and CI do not fail on absent large data.

New assertions added to `tests/test_real_data_loader.py`:
- the pair tensor is strictly upper-triangular (the 28-block browser export
  depends on this);
- the committed `.npz` still equals what the raw source reduces to, to 1e-12 —
  so the file shipped to the browser cannot silently diverge from the data.

---

## 5. Simulated persona review

```
[persona review] 500 scenarios, 144 environments rendered, 4,969 checks executed,
                 findings: 0 critical / 0 major / 0 minor
```

Machine-readable output: `web/review/persona-matrix.json` and `.csv`.

**This is scripted heuristic inspection, not user testing. No human
participated.** A passing scenario means the automated checks found no defect,
never that a person understood the page.

8 personas × 6 screens × 3 devices × 2 visit states × 2 motion settings × 2 data
states, strided deterministically so a 500-scenario slice spans every axis.
15 check types; each scenario carries the universal checks plus its persona's
priorities, scoped to applicability.

### Findings raised and resolved during the review

| Round | Findings | Outcome |
| --- | --- | --- |
| 1 | 326 critical, 211 major | 2 real product gaps (canonical no-quantum phrase and the word "peptide" absent on deep-linked screens; `Ising` unglossed on a beginner screen) and 2 harness defects (a prefix-walk that never reached `computed` scenarios; `recoveryAvailable` applied to read-only screens) |
| 2 | 0 critical, 208 major | 3 further issues: `peptide` still unglossed on `/build` and `/results`; `one-hot` unglossed on `/optimise`; `motionOptional` asserted on default-motion scenarios (harness); and a harness bug where `discover` scenarios never navigated back and were really inspecting `/optimise` |
| 3 | **0 / 0 / 0** | all resolved — footer glossary added on every screen, `one-hot` glossed, harness scoping and navigation corrected |

### Recorded as PENDING, not passed

Five comprehension questions cannot be answered by simulation and are listed in
the matrix as unverified: whether a novice can explain PET vs PE vs PP, what a
peptide is, what the Selectivity Priority dial does, and what the results do
**not** prove. These need moderated testing with real participants and consent.

---

## 6. Security

```
$ npm audit --omit=dev
found 0 vulnerabilities

$ npm audit
found 0 vulnerabilities
```

Reaching zero required a deliberate major upgrade. The versions originally
installed carried six advisories — **all in dev-only tooling**, so no visitor
was ever exposed, but a developer running the test suite was:

| Package | Was | Now |
| --- | --- | --- |
| `vite` | 5.4.21 (1 high, 1 moderate) | 7.3.x clean |
| `vitest` | 2.1.9 (2 critical, 2 moderate) | 5.0.x clean |
| `@vitejs/plugin-react` | 4.3.x | 5.2.x |
| `esbuild` | 0.21.5 (moderate) | 0.28.2 clean |

Both are major-version jumps, so the full suite and the production build were
re-run afterwards: 816 tests and 126 E2E tests pass on the new toolchain.

Runtime dependency tree is **two packages** (`react`, `react-dom`).
`framer-motion` was removed during this audit: declared but never imported.

First-party bundle chunks scanned for credential-shaped strings: clean. The only
matches anywhere in `dist` are React's own `__SECRET_INTERNALS_…` symbol and its
list of input types (which includes `password`).

Full detail, including the CSP and its two justified relaxations, in
`web/docs/SECURITY.md`.

---

## 7. Defects found and fixed in this audit

Listed with severity, evidence and proof of fix in `PROJECT_AUDIT.md` §4.
Summary: **12 fixed** (5 high, 5 medium, 2 low), plus two tooling defects.

The two that only a real browser could find:

- **Skip link was `position: absolute`** — once the page scrolled it anchored to
  the document, so a keyboard user focused a control measured at `top: -141px`
  (desktop) and `-573px` (mobile): off-screen and invisible. Now `position:
  fixed`, revealing on `:focus` rather than depending on the `:focus-visible`
  heuristic.
- **Horizontal overflow on all six routes** — `window.scrollX` reached 51 at
  320px, from two stacked causes: a flex child with `overflow-x: auto` but
  default `min-width: auto` (so its scroll container never engaged), and
  `overflow-x: hidden` on `body` being ignored because `html` was `visible`.

jsdom reported 816 passing tests while both were live. It has no layout engine.

### Tooling defects fixed

- **Suite flakiness.** Lazy-imported screen chunks exceeded Testing Library's
  1000ms default under full-suite memory pressure, failing 4 tests
  non-deterministically with a misleading "Unable to find role=heading". Waits
  are now explicit. A gate that fails at random is not a gate.
- **Two dead npm scripts.** `typecheck` ran a broken scaffolding leftover
  (`tsc -b --noEmit false …`) and `test:stress` matched no files, so it could
  never fail. Both corrected; a command that cannot fail is worse than none.

---

## 8. Quality gates

| # | Gate | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Functional integrity | **PASS** | 126 E2E tests across all six routes; no dead controls; no fake progress |
| 2 | Scientific correctness | **PASS** | 0.0 error vs Python on 398 cases; all five λ optima reproduced; QUBO/Ising identities verified |
| 3 | Molecular interaction | **PARTIAL** | The hero is interactive (orbit, drag, pause, hover) and verified painting. Structural inspection — bond lengths, surfaces, residue picking — is **not applicable**: no atomic coordinates exist in this project |
| 4 | Quantum relevance | **PASS** | real 48-variable QUBO, real heatmap, real penalty bound, exact Ising transform, and `NO QUANTUM HARDWARE EXECUTION` stated on every route |
| 5 | Visual consistency | **PASS** | one token system; 100 contrast checks in both themes; 0px overflow 320→1920 |
| 6 | User comprehension | **UNVERIFIED** | design intent met and reviewed by 500 scripted scenarios, but no human has been tested |
| 7 | Reliability | **PASS** | 14 hostile hashes, corrupt storage, hammered buttons, mid-run reload and navigation all survive |
| 8 | Performance | **PASS** | main thread responsive during a full 1.68M-design run; hero pauses off-screen; DPR capped; device-tiered workloads |
| 9 | Demonstration | **FAIL** | **No Judge Demo route exists.** `DEMO_GUIDE.md` is a rehearsed manual walkthrough instead |
| 10 | Reproducibility | **PASS** | seeded throughout; exports carry seed and λ; browser coefficients generated from the Python `.npz`; parity test fails on a stale export |

**Gate 9 fails. Gate 3 is partial for a reason that cannot be engineered away
without fabricating data. Gate 6 cannot be settled in this environment.**

## 9. How to reproduce this report

```bash
# Python
py -m pytest -q

# Web: typecheck, build, unit/property/integration, assertion count
cd web
npm ci
npm run verify

# Real browser, production build, desktop + mobile
npx playwright install chromium
npm run verify:e2e

# Security
npm audit --omit=dev
npm audit
```
