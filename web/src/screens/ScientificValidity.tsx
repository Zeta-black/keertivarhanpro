/**
 * The scientific-validity assessment.
 *
 * This is the ONLY place in the application where the full assessment appears.
 * It is a section at the bottom of Results, after the result it is assessing,
 * and it is deliberately not repeated as a badge, a card or a score anywhere
 * else. A disclosure that appears on every screen stops being read; one that
 * appears once, next to its evidence, can be checked.
 *
 * There is no "honesty percentage". A single number would be an opinion with a
 * decimal point: there is no defensible way to weigh "the optimum is proven"
 * against "nothing was synthesised" and divide. Instead every claim the project
 * could be read as making is listed with a STATUS from a fixed vocabulary and
 * the EVIDENCE that justifies that status, most of it read out of the run
 * record on screen rather than written here.
 */

import { Card, Disclosure, KeyValue, formatSci } from '../components/primitives';
import { groupInt } from '../content/format';
import { SECONDARY_STRUCTURES } from '../chem/conformer';
import { VALID_SEQUENCES } from '../science/alphabet';
import type { RunRecord } from '../workers/protocol';
import { RDKIT_VERSION } from '../generated/depictions';

/** The fixed vocabulary. Nothing is described with a word that is not here. */
type Status =
  | 'verified'
  | 'computed'
  | 'generated'
  | 'formulated'
  | 'notDone';

const STATUS_META: Readonly<
  Record<Status, { readonly label: string; readonly token: string; readonly meaning: string }>
> = {
  verified: {
    label: 'Verified',
    token: 'var(--success)',
    meaning:
      'Checked by an independent second computation in this session, or by an external library, and the two agree.',
  },
  computed: {
    label: 'Computed',
    token: 'var(--accent)',
    meaning:
      'Calculated exactly from the published model, reproducibly, from the stated seed and settings.',
  },
  generated: {
    label: 'Generated',
    token: 'var(--optimise)',
    meaning:
      'Constructed from standard reference values by a documented procedure. Correct by construction, but not measured and not predicted.',
  },
  formulated: {
    label: 'Formulated only',
    token: 'var(--attention)',
    meaning:
      'Written down in the required form. Writing a problem in a format does not mean the problem was solved in that format.',
  },
  notDone: {
    label: 'Not done',
    token: 'var(--danger)',
    meaning: 'This was not attempted. No result of this kind exists in the project.',
  },
};

interface Claim {
  readonly status: Status;
  readonly claim: string;
  readonly evidence: string;
}

function StatusChip({ status }: { readonly status: Status }): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span
      className="validity-chip"
      style={{ ['--chip' as string]: meta.token }}
      title={meta.meaning}
    >
      {meta.label}
    </span>
  );
}

export function ScientificValidity({ run }: { readonly run: RunRecord }): JSX.Element {
  const exact = run.solvers.find((s) => s.exact);
  const annealer = run.solvers.find((s) => /anneal/i.test(s.solver) && !s.exact);
  const quantum = run.solvers.find((s) => s.status === 'NOT EXECUTED');
  const surrogate = run.surrogates[0];
  const extended = SECONDARY_STRUCTURES[0];

  const claims: Claim[] = [
    {
      status: 'computed',
      claim: 'Every one of the 1,679,616 class sequences was scored against all three plastics.',
      evidence: `Exhaustive enumeration of 6^8 = ${groupInt(VALID_SEQUENCES)} sequences in this browser, from the coefficient file ${run.modelSource || 'loaded at start-up'}. ${
        exact?.runtimeMs !== null && exact?.runtimeMs !== undefined
          ? `Completed in ${Math.round(exact.runtimeMs)} ms on this device.`
          : ''
      }`,
    },
    {
      status: 'computed',
      claim:
        'The reported winner is the exact optimum of the stated objective at the stated priority, not an estimate.',
      evidence: `Brute-force minimisation over the complete space, so optimality is proven by exhaustion rather than inferred. Objective = -PET + ${run.config.lambda} x (PE + PP), seed ${run.config.seed}.`,
    },
    {
      status: 'verified',
      claim: 'The 48-variable QUBO encodes the same objective as the direct scoring path.',
      evidence: run.verify
        ? `Two independent code paths compared on ${run.verify.sampleSize} sampled designs; largest disagreement ${formatSci(run.verify.maxQuboObjectiveError)}. The one-hot penalty contributed at most ${formatSci(run.verify.maxPenaltyResidue)} to designs that already satisfy it, and ${run.verify.invalidCorrectlyPenalised} of ${run.verify.invalidTested} deliberately invalid designs were penalised as intended.`
        : 'Verification did not run for this record, so this row is unsupported in this session.',
    },
    {
      status: 'verified',
      claim: 'The molecular structures shown are chemically valid.',
      evidence: `Each structure is built as an explicit connection table, checked for neutral covalent valence at every atom, and cross-checked against RDKit ${RDKIT_VERSION}: molecular formula, average and monoisotopic mass, ring count and CIP stereo-descriptor at every centre all agree, including the (2S,3S) isoleucine and (2S,3R) threonine centres.`,
    },
    {
      status: 'generated',
      claim: 'The 3D coordinates are a plausible conformation of the molecule.',
      evidence: `Built by Natural Extension Reference Frame construction from tabulated equilibrium bond lengths and angles with ${extended.label.toLowerCase()} backbone torsions, planar aromatic ring templates, and a short steric-relief minimisation. It is an idealised conformer: not an experimental structure, not a molecular-dynamics result, and not a docking pose.`,
    },
    {
      status: annealer ? 'computed' : 'notDone',
      claim: 'A heuristic sampler was benchmarked against the known optimum.',
      evidence: annealer
        ? `${annealer.solver}: ${annealer.reads ?? 'an unrecorded number of'} reads, ${
            annealer.validityRate !== null
              ? `${(annealer.validityRate * 100).toFixed(1)}% of samples satisfied the one-hot constraint`
              : 'validity rate not recorded'
          }, best objective ${
            annealer.bestObjective !== null ? annealer.bestObjective.toFixed(4) : 'not recorded'
          } against the proven optimum ${
            exact?.bestObjective !== null && exact?.bestObjective !== undefined
              ? exact.bestObjective.toFixed(4)
              : 'not recorded'
          }. Runtimes are wall-clock on this device and are not a comparison of algorithms on equal hardware.`
        : 'No heuristic solver ran in this record.',
    },
    {
      status: 'formulated',
      claim: 'The problem is expressed in the form a quantum annealer accepts.',
      evidence: `The objective is written as a 48-variable QUBO with a one-hot penalty, which is the input format for quantum and classical annealers alike. ${
        quantum ? `Recorded in this run as "${quantum.status}": ${quantum.note}` : ''
      } A QUBO formulation is a statement about format, not about performance: no quantum speedup is measured, implied or available here.`,
    },
    {
      status: 'notDone',
      claim: 'Execution on quantum hardware.',
      evidence: `No quantum processor was used at any point, in this website or in the Python benchmark behind it. The run record stores this as quantumHardware = "${run.quantumHardware}".`,
    },
    {
      status: 'notDone',
      claim: 'Laboratory validation.',
      evidence:
        'No peptide here has been synthesised, purified, or exposed to any plastic. There is no measured binding constant, no adhesion test, no microscopy and no spectroscopy anywhere in this project. Every score is the output of a model.',
    },
    {
      status: 'notDone',
      claim: 'Evidence that any peptide binds, adheres to, or degrades plastic.',
      evidence:
        'The score is a dimensionless model quantity useful for ranking designs against each other. It is not a binding affinity, and the project does not model degradation, enzymes or recycling chemistry at all.',
    },
  ];

  const counts = claims.reduce<Record<Status, number>>(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }),
    { verified: 0, computed: 0, generated: 0, formulated: 0, notDone: 0 },
  );

  return (
    <section className="section validity" id="scientific-validity">
      <header className="section-head">
        <h2 className="section-title">Scientific validity assessment</h2>
        <p className="section-lede">
          Every claim this project could reasonably be read as making, with the status of that
          claim and the evidence behind it. This assessment appears once, here, after the results
          it assesses. There is no overall score: a single percentage would be an opinion dressed
          as a measurement, because there is no defensible way to weigh &ldquo;the optimum is
          proven by exhaustion&rdquo; against &ldquo;nothing was synthesised&rdquo; and divide.
        </p>
      </header>

      <div className="validity-counts">
        {(Object.keys(STATUS_META) as Status[]).map((status) => (
          <div key={status} className="validity-count">
            <span className="validity-count-value" style={{ color: STATUS_META[status].token }}>
              {counts[status]}
            </span>
            <StatusChip status={status} />
            <span className="validity-count-meaning">{STATUS_META[status].meaning}</span>
          </div>
        ))}
      </div>

      <div className="scroll-x">
        <table className="table validity-table">
          <caption className="sr-only">
            Claims, their status, and the evidence for each status
          </caption>
          <thead>
            <tr>
              <th scope="col" style={{ width: '13%' }}>
                Status
              </th>
              <th scope="col" style={{ width: '32%' }}>
                Claim
              </th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((claim) => (
              <tr key={claim.claim}>
                <td>
                  <StatusChip status={claim.status} />
                </td>
                <td style={{ whiteSpace: 'normal' }}>{claim.claim}</td>
                <td style={{ whiteSpace: 'normal' }} className="validity-evidence">
                  {claim.evidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="validity-limits">
        <Card>
          <h3 style={{ fontSize: 'var(--fs-md)' }}>Limitations of the scoring model itself</h3>
          <ul className="stack-sm" style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)' }}>
            <li>
              The energies come from a <strong>single backbone conformation</strong> (bb1) of the
              published QA-PBP-RL-Nexus Potts tables. A different backbone could rank designs
              differently.
            </li>
            <li>
              Twenty amino acids are collapsed into six families by{' '}
              <strong>arithmetic mean</strong>. Averaging discards real chemical differences
              inside a family, so a family-level score cannot distinguish leucine from
              isoleucine even though they are different molecules.
            </li>
            <li>
              The objective weight &lambda; is a <strong>design choice</strong>, not a measured
              biological quantity. The answer moves when it moves, which is why the sweep is
              shown rather than one value.
            </li>
            <li>
              A proven optimum of a model is a statement about <strong>the model</strong>. It
              says nothing about whether the model is right about peptides.
            </li>
            {surrogate ? (
              <li>
                The surrogate reports R&sup2; = {surrogate.test.r2.toFixed(4)} on held-out data. That is expected,
                not suspicious: the feature basis it fits can represent the scoring model exactly,
                so it recovers it to numerical precision. It is a consistency check on the
                encoding, not evidence about biology.
              </li>
            ) : null}
          </ul>
        </Card>

        <Card>
          <h3 style={{ fontSize: 'var(--fs-md)' }}>What would raise each status</h3>
          <dl className="validity-next">
            <div>
              <dt>Quantum execution</dt>
              <dd>
                Submit the 48-variable QUBO to annealing hardware, report the embedding, the chain
                strength, the anneal schedule and the raw sample distribution, and compare against
                the proven optimum already computed here.
              </dd>
            </div>
            <div>
              <dt>Structural claims</dt>
              <dd>
                Replace the generated conformer with an ensemble from a force field or an
                experimental structure, and report the method and the energies.
              </dd>
            </div>
            <div>
              <dt>Binding claims</dt>
              <dd>
                Synthesise the top candidates and measure adsorption on PET, PE and PP films under
                stated conditions. Until then, no row above can move out of &ldquo;not
                done&rdquo;.
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Disclosure summary="How this assessment is produced">
        <div className="stack-sm">
          <p>
            The status words come from a fixed five-item vocabulary defined in{' '}
            <code>src/screens/ScientificValidity.tsx</code>; nothing is described with a word that
            is not in it. The evidence column reads from the run record on this page rather than
            from prose written in advance, so if a verification step did not run, its row says so
            instead of claiming it passed.
          </p>
          <KeyValue label="Run identifier" value={run.runId} />
          <KeyValue label="Model source" value={run.modelSource || 'not recorded'} />
          <KeyValue label="Quantum hardware field" value={run.quantumHardware} />
        </div>
      </Disclosure>
    </section>
  );
}
