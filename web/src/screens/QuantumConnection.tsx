/**
 * "What exactly is quantum about this project?"
 *
 * This section exists because that is the first question a technical judge
 * asks, and a vague answer is worse than no answer. It walks the actual
 * pipeline stage by stage and marks, for each stage, what ran and on what.
 * The honest summary is short:
 *
 *   The search problem is encoded in the input format a quantum annealer
 *   accepts, AND a real gate-model quantum algorithm is run on it by exact
 *   statevector simulation (see the Quantum screen). Nothing was executed on
 *   quantum hardware. The optimum reported on Results was found classically,
 *   by exhaustion, and is therefore proven rather than sampled.
 *
 * Both modes get the same answer. Beginner mode gets it in plain words;
 * Researcher mode additionally gets the algebra and the constraint handling.
 */

import { Beginner, Equation, ModeSplit, Researcher, useMode } from '../app/mode';
import { Card, Disclosure, InfoTip } from '../components/primitives';
import { groupInt } from '../content/format';
import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  LENGTH,
  VALID_SEQUENCES,
} from '../science/alphabet';
import { useStore } from '../state/store';

type Hardware = 'classical' | 'formulation' | 'simulated' | 'none';

interface Stage {
  readonly n: number;
  readonly title: string;
  readonly plain: string;
  readonly technical: string;
  readonly hardware: Hardware;
}

const HARDWARE_META: Readonly<
  Record<Hardware, { readonly label: string; readonly token: string }>
> = {
  classical: { label: 'Ran classically, in your browser', token: 'var(--accent)' },
  formulation: { label: 'Quantum-compatible format', token: 'var(--optimise)' },
  simulated: { label: 'Real quantum algorithm, exactly simulated', token: 'var(--success)' },
  none: { label: 'Did not run', token: 'var(--danger)' },
};

const STAGES: readonly Stage[] = [
  {
    n: 1,
    title: 'Define the search space',
    plain: `Eight positions, each holding one of six families of amino acid. That is ${groupInt(
      VALID_SEQUENCES,
    )} possible designs - a large number, but a countable one.`,
    technical: `Class space of cardinality ${ALPHABET_SIZE}^${LENGTH} = ${groupInt(
      VALID_SEQUENCES,
    )}. Optimisation is at class resolution throughout; residue identity is a display concern only.`,
    hardware: 'classical',
  },
  {
    n: 2,
    title: 'Score every design',
    plain:
      'A published physics model gives each design three numbers: how well it is predicted to stick to PET, to PE and to PP.',
    technical:
      'Six-class Potts model aggregated from the QA-PBP-RL-Nexus PottsModel_Energies tables (backbone bb1). Score = intercept + 8 one-body terms + 28 two-body terms. The canonical binding score is the negative of the Potts energy.',
    hardware: 'classical',
  },
  {
    n: 3,
    title: 'Write down what "good" means',
    plain:
      'We want a high PET score and low PE and PP scores. One dial decides how strongly the other two count against a design.',
    technical:
      'objective(x) = -PET(x) + lambda * (PE(x) + PP(x)), minimised. Lambda is a user-chosen weight, not a measured quantity.',
    hardware: 'classical',
  },
  {
    n: 4,
    title: 'Fit a surrogate in the required form',
    plain:
      'An optimiser of this kind can only read a goal written as a sum of switch terms, so the goal is re-expressed in exactly that shape.',
    technical:
      'Ridge regression over the one-hot and pairwise feature basis. The basis can represent the Potts model exactly, so the fit is exact to numerical precision - a consistency check on the encoding, not a claim about biology.',
    hardware: 'classical',
  },
  {
    n: 5,
    title: 'Encode it as a QUBO',
    plain: `The goal becomes ${BINARY_VARIABLES} on/off switches - one per position-and-family pair - plus a rule that each position must pick exactly one family. This is the exact format a quantum annealer takes as input.`,
    technical: `Q over ${BINARY_VARIABLES} binary variables with x[i*6+a] = 1 iff position i takes class a. The exactly-one-of-six constraint is enforced by a penalty P chosen above the whole objective range, so the constrained binary problem and the class-space problem have identical minimisers.`,
    hardware: 'formulation',
  },
  {
    n: 6,
    title: 'Solve it — classically, two ways',
    plain:
      'One method checks every single design and is therefore guaranteed correct. The other wanders the space the way an annealer would, and we measure how close it gets.',
    technical:
      'Exact brute-force minimisation over the full class space gives a proven optimum. Simulated annealing on the 48-variable QUBO gives a sampled one; its validity rate, best objective and gap to the proven optimum are all reported.',
    hardware: 'classical',
  },
  {
    n: 7,
    title: 'Run a real quantum algorithm on it — simulated',
    plain:
      'A genuine quantum circuit is built for this objective and run, by simulating every amplitude exactly on an ordinary processor. See the Quantum screen, where you can run it yourself.',
    technical:
      'Quantum Alternating Operator Ansatz with complete-graph XY mixers over the one-hot blocks (Hadfield et al. 2019). Nominal width 48 qubits; simulated exactly inside the 6^8 = 1,679,616-dimensional feasible sector the mixer cannot leave. Scored against the brute-force optimum: no speedup claimed.',
    hardware: 'simulated',
  },
  {
    n: 8,
    title: 'Run it on a quantum processor',
    plain:
      'This step was not performed. No quantum computer was used at any point, here or in the Python benchmark behind this site.',
    technical:
      'No QPU submission, no embedding, no chain strength, no anneal schedule, no raw sample distribution. The run record stores quantumHardware = "NO QUANTUM HARDWARE EXECUTION". The XY mixer is also applied as an exact exponential, which hardware cannot do; a device would Trotterise, and that error is not modelled.',
    hardware: 'none',
  },
];

export function QuantumConnection(): JSX.Element {
  const { state } = useStore();
  const { researcher } = useMode();
  const run = state.baseline;
  const quantumRow = run?.solvers.find((s) => s.status === 'NOT EXECUTED') ?? null;

  return (
    <section className="stack-lg">
      <Card>
        <h2 className="section-title">What exactly is quantum about this project?</h2>

        <p className="answer-lead">
          Two separate things, and they are worth keeping apart. First, this search problem is
          written in the input format a quantum annealer accepts &mdash; that is a formulation,
          not a result. Second, a real gate-model quantum algorithm is actually run on it, by
          exact statevector simulation, on the <strong>Quantum</strong> screen.{' '}
          <strong>No quantum hardware was used in either case</strong>, and the answer on the
          Results page was found classically &mdash; by checking every design, which makes it
          proven rather than estimated.
        </p>

        <ModeSplit
          beginner={
            <p className="plain-note">
              An annealer is a machine that looks for the lowest point in a landscape of on/off
              switches. To ask one a question, you first have to rewrite your question as that
              landscape. This project does the rewriting, and checks that the rewritten version is
              the same question. It then answers it with ordinary computers, because the rewritten
              question is small enough to answer exactly.
            </p>
          }
          researcher={
            <>
              <Equation label="The objective, and its binary encoding. Both forms are evaluated in the browser and compared; the Verify panel reports the largest disagreement.">
{`minimise   f(c) = -PET(c) + lambda * ( PE(c) + PP(c) )
           over c in {0..5}^8

encode     x[6i + a] = 1  iff  position i takes class a,   x in {0,1}^48

QUBO       E(x) = sum_u  Q[u,u] x_u  +  sum_{u<v} Q[u,v] x_u x_v
                  + P * sum_i ( 1 - sum_a x[6i+a] )^2

           with P > range(f), so every one-hot-valid x has E(x) = f(decode(x))
           and every invalid x is strictly worse than the best valid one.`}
              </Equation>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
                An Ising form follows by the substitution s = 2x - 1, which is what annealing
                hardware actually takes. Both forms are generated on the Understand screen from
                the live coefficients at the selected lambda.
              </p>
            </>
          }
        />
      </Card>

      <div>
        <h3 className="section-title" style={{ fontSize: 'var(--fs-lg)' }}>
          The pipeline, stage by stage
        </h3>
        <p className="section-lede">
          What ran, and on what. Every stage below is in the repository and executes when you run
          the search.
        </p>
        <ol className="quantum-stages">
          {STAGES.map((stage) => {
            const meta = HARDWARE_META[stage.hardware];
            return (
              <li key={stage.n} data-hardware={stage.hardware}>
                <div className="quantum-stage-head">
                  <span className="quantum-stage-n" aria-hidden="true">
                    {stage.n}
                  </span>
                  <h4>{stage.title}</h4>
                  <span
                    className="quantum-stage-tag"
                    style={{ ['--chip' as string]: meta.token }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="quantum-stage-body">
                  {researcher ? stage.technical : stage.plain}
                </p>
              </li>
            );
          })}
        </ol>
      </div>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-md)' }}>
          Why a QUBO is not a speedup
          <InfoTip
            title="Format versus performance"
            body="Writing a problem in the form a machine accepts says nothing about how fast that machine would solve it, or whether it would solve it better than a classical method. Those are separate questions and this project answers neither."
          />
        </h3>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
          Converting an optimisation problem into QUBO form is a modelling exercise, not a result.
          Any problem of this shape can be written that way. A speedup claim would require running
          on hardware, reporting the embedding and the anneal schedule, and comparing against a
          well-tuned classical baseline on matched problem sizes. None of that was done here, so
          none of it is claimed.
        </p>
        <Beginner>
          <p className="plain-note">
            Put simply: a QUBO is a translation, not an achievement. The honest headline for{' '}
            <em>this</em> page is &ldquo;annealer-ready formulation&rdquo;. The quantum algorithm
            that genuinely runs is on the Quantum screen, and it is simulated rather than executed
            on a machine &mdash; which is also stated plainly there.
          </p>
        </Beginner>
        {quantumRow ? (
          <p className="faint mono" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
            Recorded in your run: {quantumRow.solver} &mdash; {quantumRow.status}. {quantumRow.note}
          </p>
        ) : (
          <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
            Run the search and this paragraph will also show the solver row your own run recorded
            for the quantum annealer.
          </p>
        )}
      </Card>

      <Researcher>
        <Disclosure summary="What it would take to make a quantum claim here" defaultOpen>
          <ul className="stack-sm" style={{ fontSize: 'var(--fs-sm)' }}>
            <li>
              Submit the {BINARY_VARIABLES}-variable QUBO to annealing hardware and report the
              minor embedding, the chain strength, the annealing time and the number of reads.
            </li>
            <li>
              Publish the raw sample distribution, not just the best sample, together with the
              fraction of samples satisfying the one-hot constraint.
            </li>
            <li>
              Compare against the proven optimum this project already computes, and against a
              tuned classical solver given equal wall-clock time on stated hardware.
            </li>
            <li>
              State the problem sizes at which any observed advantage holds, and whether it
              survives as the class alphabet or the peptide length grows.
            </li>
          </ul>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
            At {BINARY_VARIABLES} variables the problem is far below the size where annealing
            hardware would be expected to be interesting; the exhaustive search finishes in
            milliseconds. The formulation is a demonstration of method, not a candidate workload.
          </p>
        </Disclosure>
      </Researcher>
    </section>
  );
}
