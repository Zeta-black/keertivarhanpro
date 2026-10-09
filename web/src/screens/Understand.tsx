/**
 * SCREEN E - Understand.
 *
 * Absorbs the legacy QUBO, Scale (P1), Verify, About and Honesty tabs.
 * Layered: beginner gets a clickable story, researcher gets the equations,
 * coefficients and measured validation numbers.
 */

import { useEffect, useMemo, useState } from 'react';

import { useRouter } from '../app/router';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  InfoTip,
  Notice,
  ProvenanceBadge,
  ScreenHeader,
  Stat,
  formatInt,
  formatMs,
  formatSci,
} from '../components/primitives';
import {
  ACCESSIBILITY_STATEMENT,
  HONESTY,
  JARGON,
  LEGAL,
  METRIC_HELP,
  MIGRATION_MAP,
  SCREENS,
  SOURCES,
} from '../content/copy';
import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  CLASS_INFO,
  LENGTH,
  PAIR_COUNT,
  VALID_SEQUENCES,
  variableIndex,
} from '../science/alphabet';
import { useStore } from '../state/store';
import { Heatmap, LineChart } from '../viz/charts';

type Section = 'switches' | 'qubo' | 'scale' | 'verify' | 'about' | 'honesty';

const SECTIONS: { id: Section; label: string; legacy: string }[] = [
  { id: 'switches', label: 'Why 48 switches?', legacy: 'QUBO' },
  { id: 'qubo', label: 'The puzzle matrix', legacy: 'QUBO' },
  { id: 'scale', label: 'Scale and limits', legacy: 'Scale (P1)' },
  { id: 'verify', label: 'Confidence centre', legacy: 'Verify' },
  { id: 'about', label: 'About this project', legacy: 'About' },
  { id: 'honesty', label: 'What this does not show', legacy: 'Honesty' },
];

export function UnderstandScreen(): JSX.Element {
  const { state, send } = useStore();
  const { navigate } = useRouter();
  const [section, setSection] = useState<Section>('switches');
  const researcher = state.mode === 'researcher';

  // Fetch the real QUBO for the current priority when the matrix is on screen.
  useEffect(() => {
    if (section !== 'qubo' && section !== 'scale') return;
    if (state.qubo && Math.abs(state.qubo.lambda - state.lambda) < 1e-9) return;
    if (state.status === 'idle' || state.status === 'loadingModel') return;
    send({ kind: 'quboAt', lambda: state.lambda, penaltyMultiplier: 2.0 });
  }, [section, state.qubo, state.lambda, state.status, send]);

  useEffect(() => {
    if (section !== 'verify') return;
    if (state.verify) return;
    if (state.status === 'idle' || state.status === 'loadingModel') return;
    send({ kind: 'verify', seed: state.config.seed, sampleSize: 400 });
  }, [section, state.verify, state.status, state.config.seed, send]);

  return (
    <div className="screen">
      <div className="shell">
        <ScreenHeader
          eyebrow="Screen 5 of 6"
          title={SCREENS.understand.title}
          purpose={SCREENS.understand.purpose}
        />

        <nav aria-label="Sections of this screen" style={{ marginBottom: 'var(--s-5)' }}>
          <ul className="row-wrap" style={{ listStyle: 'none', padding: 0, gap: 'var(--s-2)' }}>
            {SECTIONS.map((item) => (
              <li key={item.id}>
                <Button
                  size="sm"
                  variant={section === item.id ? 'primary' : 'secondary'}
                  aria-pressed={section === item.id}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </Button>
              </li>
            ))}
          </ul>
        </nav>

        {section === 'switches' ? <SwitchesSection researcher={researcher} /> : null}
        {section === 'qubo' ? <QuboSection researcher={researcher} /> : null}
        {section === 'scale' ? <ScaleSection researcher={researcher} /> : null}
        {section === 'verify' ? <VerifySection /> : null}
        {section === 'about' ? <AboutSection onNavigate={navigate} /> : null}
        {section === 'honesty' ? <HonestySection /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Why 48 switches - the interactive 8 x 6 grid
 * ------------------------------------------------------------------ */
function SwitchesSection({ researcher }: { readonly researcher: boolean }): JSX.Element {
  const { state, dispatch } = useStore();
  const [broken, setBroken] = useState<Set<number>>(new Set());

  // The grid mirrors the real draft sequence; "break" lets the user turn on an
  // extra switch to see what the constraint is for.
  const on = useMemo(() => {
    const set = new Set<number>();
    state.draftCodes.forEach((c, i) => set.add(variableIndex(i, c)));
    broken.forEach((v) => set.add(v));
    return set;
  }, [state.draftCodes, broken]);

  const violations = useMemo(() => {
    const bad: number[] = [];
    for (let i = 0; i < LENGTH; i += 1) {
      let count = 0;
      for (let a = 0; a < ALPHABET_SIZE; a += 1) if (on.has(variableIndex(i, a))) count += 1;
      if (count !== 1) bad.push(i);
    }
    return bad;
  }, [on]);

  return (
    <section className="stack-lg">
      <Card>
        <h2 className="section-title">Why are there 48 switches?</h2>
        <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
          An optimiser of this kind does not understand &ldquo;position 3 is a greasy
          block&rdquo;. It only understands switches that are on or off. So we give every
          combination of position and family its own switch.
        </p>
        <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
          <strong>{LENGTH} positions</strong> &times; <strong>{ALPHABET_SIZE} families</strong> ={' '}
          <strong>{BINARY_VARIABLES} switches</strong>. A valid design has exactly one switch on
          in each row. Click any cell below to turn its switch on and see what happens when that
          rule breaks.
        </p>

        <div className="scroll-x" style={{ marginTop: 'var(--s-5)' }}>
          <table className="table" style={{ minWidth: 560 }}>
            <caption className="sr-only">
              The 48 binary variables, arranged as 8 positions by 6 families. Exactly one per row
              must be on.
            </caption>
            <thead>
              <tr>
                <th scope="col">Position</th>
                {CLASS_INFO.map((info) => (
                  <th key={info.id} scope="col" style={{ textAlign: 'center' }}>
                    <span data-class={info.id} className="row" style={{ gap: 4, justifyContent: 'center' }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: 'var(--block-colour)',
                        }}
                      />
                      {info.symbol}
                    </span>
                  </th>
                ))}
                <th scope="col" style={{ textAlign: 'center' }}>
                  Sum
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: LENGTH }, (_, i) => {
                const rowCount = CLASS_INFO.filter((info) =>
                  on.has(variableIndex(i, info.index)),
                ).length;
                const bad = rowCount !== 1;
                return (
                  <tr key={i}>
                    <th scope="row" className="num">
                      {i + 1}
                    </th>
                    {CLASS_INFO.map((info) => {
                      const v = variableIndex(i, info.index);
                      const isOn = on.has(v);
                      const isChosen = state.draftCodes[i] === info.index;
                      return (
                        <td key={info.id} style={{ textAlign: 'center', padding: 4 }}>
                          <button
                            type="button"
                            data-class={info.id}
                            aria-label={`Switch ${v}: position ${i + 1}, ${info.name}. Currently ${isOn ? 'on' : 'off'}.`}
                            aria-pressed={isOn}
                            onClick={() => {
                              if (isChosen) {
                                // Choosing the already-chosen cell is a no-op;
                                // clicking a different one changes the design.
                                return;
                              }
                              setBroken((previous) => {
                                const next = new Set(previous);
                                if (next.has(v)) next.delete(v);
                                else next.add(v);
                                return next;
                              });
                            }}
                            style={{
                              width: 34,
                              height: 34,
                              borderRadius: 'var(--r-sm)',
                              border: `1.5px solid ${isOn ? 'var(--block-colour)' : 'var(--border)'}`,
                              background: isOn
                                ? 'var(--block-colour)'
                                : 'var(--surface-sunken)',
                              color: 'var(--text-on-block)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {isOn ? '1' : '0'}
                          </button>
                        </td>
                      );
                    })}
                    <td
                      className="num"
                      style={{
                        textAlign: 'center',
                        color: bad ? 'var(--danger)' : 'var(--success)',
                        fontWeight: 700,
                      }}
                    >
                      {rowCount}
                      {bad ? ' X' : ' OK'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {violations.length > 0 ? (
          <Notice tone="honest" icon="!">
            <strong>
              {violations.length} position{violations.length === 1 ? '' : 's'} now break the rule.
            </strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              Position{violations.length === 1 ? '' : 's'}{' '}
              {violations.map((v) => v + 1).join(', ')} do not have exactly one switch on. That
              is not a peptide at all, so the puzzle has to make it unattractive. It does that
              by adding a large penalty, P, for every broken row. P is set deliberately larger
              than the entire score range, so no amount of good scoring can ever pay for a
              broken rule.
            </p>
            <Button size="sm" style={{ marginTop: 'var(--s-2)' }} onClick={() => setBroken(new Set())}>
              Fix the rule
            </Button>
          </Notice>
        ) : (
          <Notice tone="good">
            <strong>Every row has exactly one switch on.</strong> This is a valid design, so the
            penalty contributes exactly zero and the objective is purely the score comparison.
          </Notice>
        )}

        {researcher ? (
          <Disclosure summary="Advanced: the constraint, expanded" defaultOpen>
            <pre
              className="mono scroll-x"
              style={{
                background: 'var(--surface-sunken)',
                padding: 'var(--s-3)',
                borderRadius: 'var(--r-sm)',
                fontSize: 'var(--fs-xs)',
              }}
            >
{`penalty = P * sum_i ( sum_a x[i,a] - 1 )^2

expanded into QUBO terms:
  linear[i,a]            -=  P        (for every variable)
  quadratic[(i,a),(i,b)] += 2P        (for every a < b within position i)
  offset                 +=  P        (once per position)

variable index: v(i,a) = i * ${ALPHABET_SIZE} + a,  so v in [0, ${BINARY_VARIABLES})`}
            </pre>
            <p style={{ marginTop: 'var(--s-2)' }}>
              For a valid assignment the three contributions cancel exactly, which is checked
              numerically in the Confidence centre.
            </p>
          </Disclosure>
        ) : null}
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>
          From switches back to a peptide
          <InfoTip title={JARGON.oneHot.term} body={JARGON.oneHot.more} />
        </h3>
        <p className="prose" style={{ marginTop: 'var(--s-2)' }}>
          Decoding is simply reading which switch is on in each row. Switch{' '}
          {variableIndex(2, 0)} on, for example, means position 3 holds the{' '}
          {CLASS_INFO[0].name.toLowerCase()} family.
        </p>
        <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
          <Button onClick={() => dispatch({ type: 'RESET_DRAFT' })}>
            Reset to the reference design
          </Button>
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The real QUBO matrix
 * ------------------------------------------------------------------ */
function QuboSection({ researcher }: { readonly researcher: boolean }): JSX.Element {
  const { state } = useStore();
  const qubo = state.qubo;

  const matrix = useMemo(() => {
    if (!qubo) return null;
    const dense = new Float64Array(BINARY_VARIABLES * BINARY_VARIABLES);
    for (const [u, v, value] of qubo.quadratic) {
      dense[u * BINARY_VARIABLES + v] = value;
      dense[v * BINARY_VARIABLES + u] = value;
    }
    for (let i = 0; i < BINARY_VARIABLES; i += 1) {
      dense[i * BINARY_VARIABLES + i] = qubo.linear[i];
    }
    return dense;
  }, [qubo]);

  const maxAbs = qubo?.maxAbsCoefficient ?? 0;

  const labelFor = (index: number) => {
    const position = Math.floor(index / ALPHABET_SIZE);
    const classIndex = index % ALPHABET_SIZE;
    return `pos ${position + 1} / ${CLASS_INFO[classIndex].name}`;
  };

  return (
    <section className="stack-lg">
      <Card>
        <h2 className="section-title">
          The puzzle, as a matrix
          <InfoTip title={JARGON.qubo.term} body={JARGON.qubo.more} />
        </h2>
        <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
          This is the actual objective at your current Selectivity Priority (&lambda; ={' '}
          {state.lambda}), drawn directly from the coefficients the solver uses. The diagonal
          holds the single-switch costs; everything off the diagonal is a cost that applies only
          when <em>both</em> switches are on. Those off-diagonal terms are the whole reason this
          is a hard problem rather than eight independent choices.
        </p>

        {!qubo || !matrix ? (
          <EmptyState
            title="Building the matrix"
            body="The coefficients are assembled in the worker from the published scoring model. If this does not resolve, the model may have failed to load."
          />
        ) : (
          <>
            <div style={{ marginTop: 'var(--s-5)' }}>
              <Heatmap
                size={BINARY_VARIABLES}
                valueAt={(r, c) => matrix[r * BINARY_VARIABLES + c]}
                maxAbs={maxAbs}
                title={`Objective coefficients at lambda = ${state.lambda}`}
                subtitle="48 x 48. Labels along the edges are the eight positions; each position is a 6-wide block."
                rowLabel="Switch (position / family)"
                colLabel="Switch (position / family)"
                cellTitle={(r, c, value) =>
                  r === c
                    ? `Single-switch cost for ${labelFor(r)}: ${value.toFixed(4)}`
                    : `Pair cost, ${labelFor(r)} with ${labelFor(c)}: ${value.toFixed(4)}`
                }
                footer={
                  <>
                    <ProvenanceBadge kind="computed" /> Blank cells are exactly zero: two
                    switches in the SAME position never have a pair term, which is why the
                    six-wide diagonal blocks are empty off their own diagonal.
                  </>
                }
              />
            </div>

            <div className="grid-auto" style={{ marginTop: 'var(--s-5)' }}>
              <Stat
                label="Binary variables"
                value={String(BINARY_VARIABLES)}
                unit="8 positions x 6 families"
                provenance="computed"
              />
              <Stat
                label="Non-zero pair terms"
                value={formatInt(qubo.quadratic.length)}
                unit={`of a possible ${formatInt(PAIR_COUNT * ALPHABET_SIZE * ALPHABET_SIZE)}`}
                help="One term for every (position pair, family pair) combination that the scoring model gives a non-zero coupling."
                provenance="computed"
              />
              <Stat
                label={METRIC_HELP.penalty.label}
                value={qubo.penalty.toFixed(1)}
                unit={METRIC_HELP.penalty.unit}
                help={METRIC_HELP.penalty.plain}
                provenance="computed"
              />
              <Stat
                label="Largest coefficient"
                value={maxAbs.toFixed(3)}
                unit="absolute value"
                help="Used to scale the colour ramp above. The penalty P is far larger than this, by design."
                provenance="computed"
              />
            </div>

            {researcher ? (
              <Disclosure summary="Advanced: coefficient mass and the Ising form" defaultOpen>
                <div className="stack-sm">
                  <p className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
                    sum |linear| = {qubo.linearMass.toFixed(3)}
                    <br />
                    sum |quadratic| = {qubo.quadraticMass.toFixed(3)}
                    <br />
                    P = 2 x ({qubo.linearMass.toFixed(3)} + {qubo.quadraticMass.toFixed(3)}) + 1 ={' '}
                    {qubo.penalty.toFixed(3)}
                    <br />
                    offset = {qubo.offset.toFixed(6)}
                  </p>
                  <p>
                    <strong>
                      Ising form
                      <InfoTip title={JARGON.ising.term} body={JARGON.ising.more} />
                    </strong>{' '}
                    via x = (s + 1) / 2:
                  </p>
                  <p className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
                    h in [{qubo.ising.hMin.toFixed(3)}, {qubo.ising.hMax.toFixed(3)}]
                    <br />
                    J in [{qubo.ising.jMin.toFixed(3)}, {qubo.ising.jMax.toFixed(3)}]
                    <br />
                    constant = {qubo.ising.constant.toFixed(3)}
                  </p>
                  <p>
                    The Ising form matters because annealing hardware works with spins rather
                    than binary variables. It is an exact algebraic rewrite, verified in the test
                    suite for arbitrary binary vectors, not only valid ones. It is relevant here
                    only as a format: <strong>{HONESTY.noQuantum}</strong>.
                  </p>
                </div>
              </Disclosure>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Scale and limits
 * ------------------------------------------------------------------ */
function ScaleSection({ researcher }: { readonly researcher: boolean }): JSX.Element {
  const { state } = useStore();
  const run = state.baseline;

  // Derived COUNTS, not measured runtimes. Labelled as such.
  const growth = useMemo(() => {
    const points: { length: number; sequences: number; variables: number }[] = [];
    for (let n = 2; n <= 14; n += 1) {
      points.push({
        length: n,
        sequences: ALPHABET_SIZE ** n,
        variables: n * ALPHABET_SIZE,
      });
    }
    return points;
  }, []);

  return (
    <section className="stack-lg">
      <Card>
        <h2 className="section-title">How big does this get?</h2>
        <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
          The reason this project can prove its answer is that it deliberately kept the problem
          small enough to check completely. That choice has a cost, and this section is about
          both sides of it.
        </p>

        <div className="grid-auto" style={{ marginTop: 'var(--s-5)' }}>
          <Stat
            label="This study"
            value={formatInt(VALID_SEQUENCES)}
            unit="8 positions, 6 families"
            help="Small enough to enumerate exhaustively, which is what makes the optimum provable."
            provenance="computed"
          />
          <Stat
            label="With all 20 amino acids"
            value="25,600,000,000"
            unit="20^8, derived count"
            help="20 to the power 8. Four orders of magnitude larger, and no longer checkable by brute force on a laptop."
            provenance="estimate"
          />
          <Stat
            label="A 12-mer, 6 families"
            value={formatInt(ALPHABET_SIZE ** 12)}
            unit="6^12, derived count"
            help="The source dataset is a 12-position model. Extending to its full length multiplies the space by 1,296."
            provenance="estimate"
          />
          <Stat
            label="Binary variables here"
            value={String(BINARY_VARIABLES)}
            unit="8 x 6"
            help="Small by quantum-annealing standards. Current hardware handles thousands of variables, though connectivity, not count, is usually the real constraint."
            provenance="computed"
          />
        </div>

        <div style={{ marginTop: 'var(--s-5)' }}>
          <LineChart
            title="Search-space size against peptide length"
            subtitle="Derived counts (6^n), not measured runtimes"
            xLabel="Peptide length (positions)"
            yLabel="log10 of the number of valid designs"
            series={[
              {
                id: 'sequences',
                label: 'log10(valid designs)',
                colour: 'var(--optimise)',
                points: growth.map((p) => ({ x: p.length, y: Math.log10(p.sequences) })),
              },
              {
                id: 'variables',
                label: 'log10(binary variables)',
                colour: 'var(--accent)',
                dashed: true,
                points: growth.map((p) => ({ x: p.length, y: Math.log10(p.variables) })),
              },
            ]}
            highlightX={LENGTH}
            footer={
              <>
                <ProvenanceBadge
                  kind="estimate"
                  detail="These are exact arithmetic counts (6^n and 6n), not timings. No runtime is being predicted here."
                />{' '}
                The dashed line is why QUBO formulations are attractive: the number of variables
                grows linearly while the number of designs grows exponentially.
              </>
            }
          />
        </div>

        <Notice tone="honest" icon="!">
          <strong>What the reduced alphabet costs us.</strong>
          <p style={{ marginTop: 'var(--s-1)' }}>
            Grouping 20 amino acids into 6 families is what makes the space enumerable, but it
            means the answer is a <em>family pattern</em>, not a specific peptide. Two real
            peptides that this model scores identically could behave very differently in
            reality. Any follow-up would have to pick specific residues within each family and
            re-score at full resolution, which this project does not do.
          </p>
        </Notice>

        {run && researcher ? (
          <Disclosure summary="Advanced: measured timings from your run" defaultOpen>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">Measured stage timings from the current run</caption>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col" className="num">
                      Measured
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(run.timings).map(([stage, ms]) => (
                    <tr key={stage}>
                      <td>{stage}</td>
                      <td className="num">{formatMs(ms as number)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>total</strong>
                    </td>
                    <td className="num">
                      <strong>{formatMs(run.totalMs)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ marginTop: 'var(--s-2)' }}>
              Measured in your browser on this device ({run.environment.hardwareConcurrency || '?'}{' '}
              logical cores). Not comparable to another machine or to the Python benchmark.
            </p>
          </Disclosure>
        ) : null}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Confidence centre (legacy Verify)
 * ------------------------------------------------------------------ */
function VerifySection(): JSX.Element {
  const { state, send } = useStore();
  const verify = state.verify;
  const run = state.baseline;

  return (
    <section className="stack-lg">
      <Card>
        <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
          <div>
            <h2 className="section-title">Confidence centre</h2>
            <p className="screen-purpose">
              What has actually been checked, with the measured numbers rather than a claim that
              it was checked.
            </p>
          </div>
          <Button
            onClick={() => send({ kind: 'verify', seed: state.config.seed, sampleSize: 400 })}
          >
            Re-run the checks
          </Button>
        </div>

        {!verify ? (
          <EmptyState
            title="Checks not run yet"
            body="These checks re-derive the key identities in your browser on randomly drawn sequences. Press the button to run them."
          />
        ) : (
          <>
            <div className="grid-auto" style={{ marginTop: 'var(--s-4)' }}>
              <Stat
                label="Encoding round-trips"
                value={`${verify.encodeDecodeRoundTrips} / ${verify.sampleSize}`}
                unit="must be all of them"
                help="Each sampled design was encoded to 48 switches and decoded back. Any mismatch would mean the encoding is lossy."
                tone={verify.encodeDecodeRoundTrips === verify.sampleSize ? 'good' : 'warn'}
                provenance="sampled"
              />
              <Stat
                label="Matrix vs direct score"
                value={formatSci(verify.maxQuboObjectiveError)}
                unit="largest absolute difference"
                direction="should be near zero"
                help="The objective computed from the 48-variable matrix, compared with the objective computed directly from the three plastic scores. These are two independent code paths, so agreement is meaningful."
                tone={verify.maxQuboObjectiveError < 1e-8 ? 'good' : 'warn'}
                provenance="sampled"
              />
              <Stat
                label="Penalty leakage"
                value={formatSci(verify.maxPenaltyResidue)}
                unit="largest absolute difference"
                direction="should be near zero"
                help="For a valid design the one-hot penalty must contribute exactly nothing. This is how much it actually contributed, which is pure floating-point noise against a penalty of around 1e4."
                tone={verify.maxPenaltyResidue < 1e-7 ? 'good' : 'warn'}
                provenance="sampled"
              />
              <Stat
                label="Invalid designs penalised"
                value={`${verify.invalidCorrectlyPenalised} / ${verify.invalidTested}`}
                unit="must be all of them"
                help="For each sampled design an extra switch was turned on to break the rule, then the energy was checked to confirm the broken version really is worse."
                tone={
                  verify.invalidCorrectlyPenalised === verify.invalidTested ? 'good' : 'warn'
                }
                provenance="sampled"
              />
            </div>

            <Notice tone="good">
              <strong>What these four numbers mean together.</strong>
              <p style={{ marginTop: 'var(--s-1)' }}>
                The encoding is lossless, the matrix form and the direct form agree to{' '}
                {formatSci(verify.maxQuboObjectiveError)}, the constraint does not quietly
                distort valid designs, and breaking the constraint is always punished. That is
                the formulation being correct. It says nothing about whether the underlying
                scoring model reflects real chemistry.
              </p>
            </Notice>

            <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
              {verify.sampleSize} designs sampled with seed {verify.seed} at &lambda; ={' '}
              {verify.lambda}; penalty bound P = {verify.penaltyBound.toFixed(1)}. Took{' '}
              {formatMs(verify.runtimeMs)}.
            </p>
          </>
        )}
      </Card>

      {/* Surrogate methodology */}
      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>
          The stand-in model, and why its score looks too good
          <InfoTip title={JARGON.surrogate.term} body={JARGON.surrogate.more} />
        </h3>

        {run && run.surrogates.length > 0 ? (
          <>
            <div className="scroll-x" style={{ marginTop: 'var(--s-4)' }}>
              <table className="table">
                <caption className="sr-only">
                  Surrogate fit quality per plastic, on held-out test data
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Plastic</th>
                    <th scope="col" className="num">
                      Train
                    </th>
                    <th scope="col" className="num">
                      Validation
                    </th>
                    <th scope="col" className="num">
                      Test R&sup2;
                    </th>
                    <th scope="col" className="num">
                      Test RMSE
                    </th>
                    <th scope="col" className="num">
                      Max error
                    </th>
                    <th scope="col">Splits disjoint</th>
                  </tr>
                </thead>
                <tbody>
                  {run.surrogates.map((s) => (
                    <tr key={s.plastic}>
                      <td>{s.plastic}</td>
                      <td className="num">{formatInt(s.train.count)}</td>
                      <td className="num">{formatInt(s.validation.count)}</td>
                      <td className="num">{s.test.r2.toFixed(8)}</td>
                      <td className="num">{formatSci(s.test.rmse)}</td>
                      <td className="num">{formatSci(s.test.maxAbsError)}</td>
                      <td>
                        <span
                          className={`badge badge-prov ${s.splitsDisjoint ? 'prov-computed' : 'prov-illustrative'}`}
                        >
                          {s.splitsDisjoint ? 'yes - no leakage' : 'NO - leakage possible'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Notice tone="honest" icon="!">
              <strong>An R&sup2; of 1.0 is normally a red flag. Here it is expected.</strong>
              <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.surrogateR2}</p>
            </Notice>
          </>
        ) : (
          <EmptyState
            title="No surrogate fitted in this session"
            body="The surrogate is fitted as stage 5 of a Live Run. Run the pipeline on the Optimise screen and its measured train, validation and test numbers will appear here."
          />
        )}
      </Card>

      {/* Reproducibility */}
      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>Reproducibility</h3>
        <ul className="stack-sm" style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)' }}>
          <li>
            Every random draw comes from a seeded generator. The same seed gives the same run,
            in any browser.
          </li>
          <li>
            The browser scorer is checked against the Python scorer on 398 recorded cases to
            within 1e-9, as part of the automated test suite.
          </li>
          <li>
            The exact winning design at each of the five published priority values is
            reproduced, and the test suite asserts the class sequences match exactly.
          </li>
          <li>
            Published CSV values come from the Ridge surrogate and differ from the exact model
            by about 5e-8. The site shows exact values and says so rather than quietly matching
            the looser numbers.
          </li>
          <li>
            The coefficient file the browser downloads is generated by{' '}
            <code>scripts/export_web_model.py</code> from the same <code>.npz</code> the Python
            benchmark uses, so the two cannot drift apart silently.
          </li>
        </ul>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * About, migration map and sources
 * ------------------------------------------------------------------ */
function AboutSection({
  onNavigate,
}: {
  readonly onNavigate: (screen: 'discover' | 'build' | 'optimise' | 'compare' | 'understand' | 'results') => void;
}): JSX.Element {
  const { state } = useStore();
  return (
    <section className="stack-lg">
      <Card>
        <h2 className="section-title">About this project</h2>
        <div className="prose stack" style={{ marginTop: 'var(--s-3)' }}>
          <p>
            <strong>The problem.</strong> Mixed plastic waste is hard to separate, and separation
            is what makes recycling economic. A molecule that could recognise one polymer and
            ignore chemically similar ones would be a useful tool. Whether peptides can do that
            well enough to matter is an open research question.
          </p>
          <p>
            <strong>What this is.</strong> A reproducible computational benchmark, wrapped in an
            interface that a non-specialist can actually use. It takes a published Potts energy
            model for PET, PE and PP, reduces it to six amino-acid families over eight
            positions, and searches the resulting 1,679,616 designs exhaustively for the ones
            that score best for PET relative to the other two.
          </p>
          <p>
            <strong>Who it is for.</strong> Students meeting optimisation or peptide design for
            the first time, reviewers who want to audit the method, and anyone curious enough to
            click. Beginner mode hides the mathematics; Researcher mode shows the equations,
            coefficients and measured validation numbers.
          </p>
          <p>
            <strong>Why brute force.</strong> Because it makes the result checkable. With the
            whole space enumerable, the best design is proven rather than asserted, which gives
            every other method a reference to be measured against. That is the scientific point
            of keeping the problem small.
          </p>
          <p>
            <strong>The pipeline.</strong> Nine stages, from building the 48-variable map
            through scoring, sampling, fitting the surrogate, assembling the QUBO, solving,
            analysing and packaging. They are listed with their real timings on the Optimise
            screen and mirror <code>scripts/run_benchmark.py</code> one for one.
          </p>
        </div>
        <Notice>
          <strong>Team.</strong> This site intentionally lists no authors or affiliations. Adding
          names, institutions or credentials that have not been verified would be worse than
          leaving the space empty.
        </Notice>
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>Where each part of the original tool lives now</h3>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
          The earlier interface was organised as a row of technical tabs. Nothing was dropped in
          the redesign; this table is the map, and it is generated from the same constant the
          build uses.
        </p>
        <div className="scroll-x" style={{ marginTop: 'var(--s-4)' }}>
          <table className="table">
            <caption className="sr-only">
              Mapping from the original tabs to the new screens
            </caption>
            <thead>
              <tr>
                <th scope="col">Original tab</th>
                <th scope="col">Now on</th>
                <th scope="col">Section</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {MIGRATION_MAP.map((row) => (
                <tr key={row.legacy + row.section}>
                  <td>
                    <strong>{row.legacy}</strong>
                    <br />
                    <code className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {row.legacySource}
                    </code>
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => onNavigate(row.screen)}>
                      {row.screen}
                    </Button>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{row.section}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                    <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {row.note}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>Sources</h3>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
          Please cite the original work, not this website.
        </p>
        <ul className="stack-sm" style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)' }}>
          {SOURCES.map((source) => (
            <li key={source.label}>
              <strong>{source.label}</strong>
              <br />
              <span className="muted">{source.detail}</span>
              <br />
              <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                {source.role}
              </span>
            </li>
          ))}
        </ul>
        {state.modelSource ? (
          <Disclosure summary="The exact model string this site loaded">
            <code style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>
              {state.modelSource}
            </code>
            <p className="faint" style={{ marginTop: 'var(--s-2)' }}>
              Orientation: {state.modelOrientation}
            </p>
          </Disclosure>
        ) : null}
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>{ACCESSIBILITY_STATEMENT.title}</h3>
        <div className="stack-sm" style={{ marginTop: 'var(--s-3)' }}>
          {ACCESSIBILITY_STATEMENT.body.map((paragraph) => (
            <p key={paragraph} className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {paragraph}
            </p>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Honesty
 * ------------------------------------------------------------------ */
function HonestySection(): JSX.Element {
  const { state } = useStore();
  const run = state.baseline;

  return (
    <section className="stack-lg">
      <Card style={{ borderColor: 'var(--attention)' }}>
        <h2 className="section-title">What this does and does not show</h2>
        <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
          This section exists because the easiest way to oversell computational work is to let
          the reader assume more than was done. Here is the full list of things this project
          does not establish.
        </p>

        <div className="stack" style={{ marginTop: 'var(--s-5)' }}>
          <Notice tone="honest" icon="!">
            <strong>No quantum hardware. {HONESTY.noQuantum}.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noQuantumDetail}</p>
            {run ? (
              <p className="mono faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
                Your run recorded: quantumHardware = &ldquo;{run.quantumHardware}&rdquo;
              </p>
            ) : null}
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>No laboratory validation.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              {HONESTY.noLab} No peptide here has been synthesised, purified, or exposed to any
              plastic. There is no measured binding constant, no adhesion test, no microscopy
              and no spectroscopy anywhere in this project.
            </p>
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>Not a model of degradation or recycling.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.noDegradation}</p>
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>A ranking score, not an affinity.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              {HONESTY.noBinding} {HONESTY.proxyScore}
            </p>
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>Families, not amino acids.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.classNotResidue}</p>
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>Every molecular picture on this site is a diagram.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{HONESTY.conceptualVisual}</p>
          </Notice>

          <Notice tone="honest" icon="!">
            <strong>The scoring model inherits its own limits.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              The energies come from one backbone conformation (bb1) of a published model, with
              20 amino acids averaged into 6 families by arithmetic mean. Averaging discards
              real chemical differences inside each family. A different backbone, a different
              aggregation rule, or the full 20-letter alphabet could all change which design
              wins. The result is a statement about this model, not about peptides.
            </p>
          </Notice>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>What it does show</h3>
        <ul className="stack-sm" style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)' }}>
          <li>
            A complete, reproducible search of a well-defined 1,679,616-design space, with the
            optimum <em>proven</em> rather than estimated.
          </li>
          <li>
            An exact mapping from that search onto a 48-variable QUBO, numerically verified in
            your own browser, in the form quantum and classical annealers accept.
          </li>
          <li>
            An honest measurement of how close a heuristic sampler gets to a known answer, with
            its validity rate and seed reported.
          </li>
          <li>
            A demonstration that the trade-off between target and off-target scores is real and
            has a shape you can see and interrogate.
          </li>
        </ul>
      </Card>

      <Card>
        <h3 style={{ fontSize: 'var(--fs-lg)' }}>{LEGAL.title}</h3>
        <div className="stack-sm" style={{ marginTop: 'var(--s-3)' }}>
          {LEGAL.body.map((paragraph) => (
            <p key={paragraph} className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {paragraph}
            </p>
          ))}
        </div>
      </Card>
    </section>
  );
}
