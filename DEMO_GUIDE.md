# DEMO_GUIDE.md

A three-minute demonstration of QBind Select.

> **There is no dedicated Judge Demo route.** The brief specified one (§11) with
> timed stages, skip, replay and prev/next controls. It was **not built** —
> recorded as finding A-02 in `PROJECT_AUDIT.md`, and Quality Gate 9 therefore
> fails. What follows is a **manually driven** walkthrough using the six real
> screens. It has been rehearsed against the production build; every step below
> was performed and the stated outcome observed.

---

## Before you start

```bash
cd web
npm install
npm run build
npm run preview          # http://localhost:4173
```

Then, in the browser, press the **?** button once and close it — this marks the
first-run tour as seen so it does not interrupt the demo. Alternatively let the
tour run; it is five steps with a visible Skip.

**Fallback if the build is unavailable:** `npm run dev` serves the same app.
There is no backend, no API key and no network dependency, so the demo cannot
fail because a service is down. The only external fetch is the app's own 49 KB
coefficient file, served from the same origin.

**Projector note:** the app is dark by default. If the room is bright, click the
sun/moon button in the header for the light theme; contrast was verified to WCAG
2.2 AA in both.

---

## 0:00–0:25 — The problem (`/`)

**Say:** "Recycling works much better when plastics are separated, and
separating them is still hard. We ask whether a short peptide could stick to one
plastic and ignore the others."

**Show:** the headline, then the three plastic cards.

**Point at:** the cards. PET is *drink bottles* and is the target; PE is *bags
and films* and PP is *tubs and caps*, both to be avoided. Everyday objects, not
abbreviations.

**Expect:** a rotating 3D peptide on the right, badged **Illustrative**.

**Say explicitly:** "That structure is a drawing, not chemistry. This project
has no atomic coordinates, so nothing here is a docking result."

---

## 0:25–0:50 — The design space (`/` → scroll)

**Say:** "Eight positions, each one of six amino-acid *families*. That is
1,679,616 possible designs — small enough to check every single one, which is
the whole point."

**Show:** the 30-second summary card with `1,679,616` and `48`.

**Point at:** the three how-it-works steps: generate → score → compare.

**If asked why six families and not twenty amino acids:** 20^8 is 25.6 billion
and cannot be enumerated; six families makes the optimum *provable*. The cost is
that the answer is a family pattern, not a specific peptide — and the interface
says so wherever a sequence appears.

---

## 0:50–1:20 — Build and score a design (`/build`)

**Do:** drag the **Large aromatic ring** family from the palette onto
**position 1**. (On a touch screen: tap the family, then tap the position. With
a keyboard: focus a position and press `1`–`6`.)

**Expect:** all three scores change immediately, and a plain-language sentence
appears — *"This edit means the PET score increased by …, the PE score increased
by … Overall this is more/less selective for PET."*

**Point at:** the delta chips. They know which direction is an improvement:
higher is better for PET, lower is better for PE and PP.

**Say:** "Every one of those numbers is computed from the published energy
model, in the browser, on every keystroke. Eight single-position terms plus
twenty-eight pair terms, three times over."

**Optional (10s):** press **Start the challenge**, make an edit, and show that
beating the optimiser by hand is hard.

---

## 1:20–1:50 — The optimisation (`/optimise`)

**Do:** drag the **Selectivity Priority** slider from 1 to 5, then back to 1.

**Say:** "This is lambda, renamed. It decides how hard the search avoids the
other two plastics. It is a weight we choose — not measured from anything."

**Point at:** the objective written out beneath it:
`reward PET + avoid the others = total`, with the live numbers.

**Do:** press **Start a Live Run**.

**Expect:** nine stages light up in sequence and complete in a few seconds, then
*"1,679,616 designs scored against 3 plastics in … on this device."*

**Point at:** the stages that say *"This stage has no measurable progress, so
elapsed time is shown rather than a percentage."*

**Say:** "Those are real worker messages. Four of the nine stages genuinely
cannot report a percentage, so they do not pretend to. The page stayed
responsive because the work is in a Web Worker."

**If a judge asks whether it is really computing:** open the Optimise screen's
stage table — it shows measured milliseconds per stage — or press **Cancel**
mid-run and show that it actually stops and keeps no partial numbers.

---

## 1:50–2:15 — Results and solver comparison (`/compare`)

**Expect:** a podium with **rank 1 marked "proven best"**.

**Say:** "Because every design was checked, rank 1 is proven for this model, not
a best guess. At lambda = 1 it is `LSWWLLFL` — which is exactly what the
published Python benchmark reports."

**Scroll to:** the solver comparison table.

**Point at:** three rows —
- *Brute force (exact)* — the reference, 1,679,616 evaluated;
- *Simulated annealing* — got close, with its **validity rate** shown because
  it samples in binary space and can produce invalid assignments;
- *D-Wave quantum annealer* — **NOT EXECUTED**.

**Say, unprompted:** "**No quantum hardware ran, anywhere in this project.**
This row is the annealer path, and it reports NOT EXECUTED because we had no
credentials. Writing the problem as a QUBO is a translation, not a result —
so let me show you the part that actually is a quantum algorithm."

**Point at:** the banner above the table warning that runtimes are
device-specific and not comparable to any other machine.

---

## 2:15–2:45 — Run the quantum circuit (`/quantum`)

This is the beat that answers "what is actually quantum here?", so do not rush
it and do not skip the disclaimer — leading with the limitation is what makes
the rest credible.

**Do:** open `/quantum`. Leave the defaults (4 free positions, p = 2).

**Say while it loads:** "One qubit per switch — eight positions times six
families is 48 qubits. The algorithm is QAOA with an XY mixer, and the mixer is
the interesting choice: it physically cannot produce a design with two families
at one position, so every measurement is a valid peptide."

**Do:** press **Run the quantum circuit**. It finishes in well under a second.

**Point at:** the four stat tiles, in this order —
- *Approximation ratio* — "1.0 would be the proven optimum; random guessing on
  this slice is the number in the tooltip";
- *Valid designs returned: 100%* — "guaranteed by the mixer, not by tuning";
- *Optimum found* — "the single most likely measurement is the design brute
  force proved is best";
- *Optimum enrichment* — "versus blind sampling of the same designs".

**Say, unprompted, before anyone asks:** "This is **simulated**, not run on a
quantum computer. Every amplitude is computed on this CPU. And **I am not
claiming a speedup** — brute force solves this faster and gives a *proven*
answer, which is exactly why I use it as the reference rather than the rival."

**Scroll to:** *The full problem: all 48 qubits*.

**Say:** "The browser runs a slice so it is instant. Offline we run the whole
thing — all 1,679,616 designs, the full 48-qubit circuit, simulated exactly.
Approximation ratio 0.855 at depth 3 against a 0.433 random baseline, and the
most likely measurement is the proven optimum. Twenty minutes, so it is not a
live demo."

**If a judge asks how 48 qubits is possible** (this is the good question):
"It should not be — 2^48 amplitudes is four and a half petabytes. The XY mixer
conserves the number of 1s inside each position's block, so starting from a
valid state the circuit can never leave the valid set. That is a subspace of
dimension 6^8, about 1.7 million, which is 27 megabytes. We simulate that
exactly. It is a symmetry-sector simulation, not an approximation."

**Scroll to:** *Why the mixer matters more than the hardware*.

**Say:** "This is the finding I would actually defend. The penalty formulation
an annealer needs is measurably the wrong choice for a gate circuit here. A
provably safe penalty has to be bigger than the whole objective range, which
makes it sixteen times larger than the differences we are trying to resolve. It
beats random guessing by 0.002. The mixer version beats it by 0.42 — about two
hundred times the margin — and wastes none of its shots."

---

## 2:45–3:00 — Limits (`/understand`, `/results`)

**Do:** open `/understand` → **Confidence centre** → **Re-run the checks**.

**Expect:** four measured numbers, errors in scientific notation near zero —
matrix-vs-direct agreement, penalty leakage, encoding round-trips, and invalid
designs correctly penalised.

**Say:** "Those are re-derived in your browser, right now, not quoted from a
file."

**Do:** open `/understand` → **What this does not show**.

**Say:** "This is the part I would want a reviewer to read. No laboratory work.
No binding measurement. No degradation modelling. No quantum hardware. Families
rather than specific amino acids. One backbone conformation, one aggregation
rule."

**Do:** open `/results` and download **one** CSV.

**Say:** "Everything on screen exports with the seed and the priority value, so
the run can be repeated."

---

## Questions to expect, and the honest answer

| Question | Answer |
| --- | --- |
| "Did you use a quantum computer?" | No. NO QUANTUM HARDWARE EXECUTION. But we do run a real gate-model quantum algorithm — XY-mixer QAOA — by exact statevector simulation. Simulated means every amplitude is computed on an ordinary CPU. Nothing was submitted to a QPU. |
| "Then what is quantum about it?" | The algorithm. A 48-qubit QAOA circuit, simulated exactly inside the feasible subspace the XY mixer cannot leave. At p=3 it reaches approximation ratio 0.855 against a 0.433 random baseline, and its most likely measurement is the design brute force proves is optimal. Run it yourself on the Quantum screen. |
| "Is it faster than classical?" | No, and we do not claim it. Brute force over the same 1,679,616 designs is faster and returns a *proven* optimum — which is exactly why we use it as the reference rather than the rival. |
| "Is the 3D molecule real?" | No. It is an illustration. There are no atomic coordinates in this project at all. |
| "Does this peptide bind PET?" | Unknown. Nothing was synthesised or tested. The score is a dimensionless ranking quantity inside one model. |
| "Why is the surrogate R² exactly 1.0? That looks like leakage." | The feature basis exactly spans the Potts model, so Ridge recovers it to numerical precision. Splits are verified disjoint, and the Confidence centre shows that check. |
| "Can I verify the optimiser?" | Yes — brute force enumerates all 1,679,616, and the test suite checks the browser scorer against 398 recorded Python values at 0.0 error, plus all five published λ optima. |
| "Is it deployed?" | No. Hosting configs and CI are committed and the production build is verified locally, but no credentials were available, so nothing is live. |
| "What is the weakest part?" | Scientifically: the 20→6 class aggregation, which means the answer is a family pattern rather than a peptide. Product-wise: there is no dedicated judge-demo route, and no real person has yet been tested for comprehension. |

## What can go wrong live, and what to do

| Risk | Mitigation |
| --- | --- |
| A full run fails to allocate on a weak machine | The worker reports it explicitly; the rest of the site still works. Demo `/build` and `/understand`, which need no run. |
| Projector is bright and dark theme washes out | Toggle to light theme in the header; contrast verified in both. |
| Narrow or mirrored display | Verified 0px horizontal overflow from 320px to 1920px on every route. |
| Motion sensitivity in the room | Header → **?** → Accessibility → Reduce animation. The hero swaps to a still illustration. |
| No network | Nothing is fetched after load except the app's own model file. Load the page once before presenting. |
| Someone asks for a feature that is absent | Say so. `FEATURE_MATRIX.md` lists every gap with the reason. |
