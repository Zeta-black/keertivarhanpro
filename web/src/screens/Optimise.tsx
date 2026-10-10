/**
 * SCREEN C - Optimise.
 *
 * Two things live here: the Selectivity Priority control (lambda, renamed) and
 * the nine-stage live pipeline.
 *
 * Honesty constraints this screen must respect:
 *  - The slider is CONTINUOUS and every value is genuinely recomputed. It is
 *    not interpolated between precomputed points. Exact re-solving needs a
 *    completed run (the full-space scores), so before that the slider changes
 *    only the scored view of YOUR design, and the screen says so.
 *  - Stage progress comes from real worker messages. Stages that cannot report
 *    a fraction show activity and elapsed time, never a fake percentage.
 *  - When the winner does not change between two priorities, that is stated
 *    explicitly along with the terms that DID change.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from '../app/router';
import { Beginner, PlainNote, Researcher } from '../app/mode';
import { useDraftScoring } from '../app/hooks';
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
  StatGroup,
  formatInt,
  formatMs,
  formatScore,
} from '../components/primitives';
import { SequenceGlyph } from '../components/PeptideChain';
import { JARGON, METRIC_HELP, SCREENS, describeLambda } from '../content/copy';
import { BENCHMARK_LAMBDAS, LAMBDA_MAX, LAMBDA_MIN } from '../science/objective';
import { VALID_SEQUENCES } from '../science/alphabet';
import { tunedWorkload } from '../state/capability';
import { useStore } from '../state/store';
import { DEFAULT_RUN_CONFIG, STAGES, type StageId } from '../workers/protocol';
import { groupInt } from '../content/format';

export function OptimiseScreen(): JSX.Element {
  const { state, dispatch, startRun, cancelRun, send } = useStore();
  const { navigate } = useRouter();
  useDraftScoring();

  const [sliderValue, setSliderValue] = useState(state.lambda);
  // Researcher-mode run parameters. They start at the device-tuned defaults
  // and are passed straight through to the worker, so changing one genuinely
  // changes the computation rather than only the readout.
  const defaults = tunedWorkload(state.capability);
  const [seed, setSeed] = useState(DEFAULT_RUN_CONFIG.seed);
  const [reads, setReads] = useState(defaults.annealing.reads);
  const [sweeps, setSweeps] = useState(defaults.annealing.sweeps);
  const [penaltyMultiplier, setPenaltyMultiplier] = useState(
    DEFAULT_RUN_CONFIG.penaltyMultiplier,
  );
  const commitTimer = useRef<number | null>(null);

  useEffect(() => setSliderValue(state.lambda), [state.lambda]);

  // The slider updates its own label instantly but commits (and triggers
  // recomputation) only after the user settles, so dragging stays smooth.
  const onSlide = (value: number) => {
    setSliderValue(value);
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      dispatch({ type: 'SET_LAMBDA', lambda: value });
    }, 140);
  };

  useEffect(
    () => () => {
      if (commitTimer.current) window.clearTimeout(commitTimer.current);
    },
    [],
  );

  const lambdaText = describeLambda(sliderValue);
  const run = state.baseline;
  const score = state.draftScore;
  const scoreMatches = score?.codes.join(',') === state.draftCodes.join(',');

  // When a run exists, re-solve exactly at the chosen priority.
  const lastSolved = useRef<number | null>(null);
  useEffect(() => {
    if (!run || state.status === 'running') return;
    if (lastSolved.current === state.lambda) return;
    lastSolved.current = state.lambda;
    send({ kind: 'solveAt', lambda: state.lambda, topN: 10 });
  }, [run, state.lambda, state.status, send]);

  // Compare the winner at this priority against the winner at the run's own
  // priority, so "what changed?" is answerable.
  const sweepHere = useMemo(
    () => state.sweep?.find((p) => Math.abs(p.lambda - state.lambda) < 1e-9) ?? null,
    [state.sweep, state.lambda],
  );
  const sweepBaseline = useMemo(
    () => state.sweep?.find((p) => Math.abs(p.lambda - 1) < 1e-9) ?? null,
    [state.sweep],
  );

  const workload = tunedWorkload(state.capability);

  return (
    <div className="screen">
      <div className="shell">
        <ScreenHeader
          eyebrow="Screen 3 of 6"
          title={SCREENS.optimise.title}
          purpose={SCREENS.optimise.purpose}
        />

        {/* ---------------- PRIORITY CONTROL ---------------- */}
        <Card raised data-tour="tour-priority">
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 'var(--s-4)' }}>
            <div style={{ maxWidth: '64ch' }}>
              <h2 style={{ fontSize: 'var(--fs-lg)' }}>
                Selectivity Priority
                <InfoTip title={JARGON.lambda.term} body={JARGON.lambda.more} />
              </h2>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
                How strongly should the optimiser avoid selecting peptides that also score well
                for PE or PP?
              </p>
            </div>
            <span className="badge num" style={{ fontSize: 'var(--fs-md)', padding: '4px 12px' }}>
              &lambda; = {sliderValue.toFixed(2)}
            </span>
          </div>

          <div className="slider-wrap">
            <label htmlFor="lambda-slider" className="sr-only">
              Selectivity priority, from 0 (ignore the other plastics) to 5 (avoid them above all)
            </label>
            <input
              id="lambda-slider"
              className="slider"
              type="range"
              min={LAMBDA_MIN}
              max={LAMBDA_MAX}
              step={0.05}
              value={sliderValue}
              onChange={(event) => onSlide(Number(event.target.value))}
              aria-valuetext={`${sliderValue.toFixed(2)}. ${lambdaText.headline}`}
              style={{
                ['--slider-pct' as string]: `${((sliderValue - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * 100}%`,
              }}
            />
            <div className="slider-ends">
              <span>
                <strong style={{ color: 'var(--c-pet)' }}>0 &mdash; Chase PET only</strong>
                <br />
                Ignore the other plastics completely
              </span>
              <span style={{ textAlign: 'right' }}>
                <strong style={{ color: 'var(--optimise)' }}>5 &mdash; Avoid the others</strong>
                <br />
                Staying off PE and PP dominates
              </span>
            </div>
            {/* Each marker sits at its own position on the linear scale.
                Spacing them evenly would put lambda = 0.5 at the quarter mark,
                which misrepresents the axis the slider actually has. */}
            <div className="slider-ticks" role="group" aria-label="Benchmark priority values">
              {BENCHMARK_LAMBDAS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="slider-tick"
                  aria-pressed={Math.abs(sliderValue - value) < 1e-9}
                  style={{
                    left: `${((value - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * 100}%`,
                  }}
                  onClick={() => {
                    setSliderValue(value);
                    dispatch({ type: 'SET_LAMBDA', lambda: value });
                  }}
                  title={`${value} - one of the five values the published benchmark ran`}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
              The five marked values are the ones the published Python benchmark ran. Any value
              in between is recomputed exactly here, not interpolated.
            </p>
            <PlainNote>
              Think of this as &ldquo;how fussy should the search be?&rdquo;. At the far left it
              only cares about sticking to bottles. At the far right it would rather stick to
              nothing than risk sticking to bags and tubs.
            </PlainNote>
          </div>

          <Notice tone={sliderValue === 0 ? 'honest' : 'plain'}>
            <strong>{lambdaText.headline}.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>{lambdaText.detail}</p>
          </Notice>
        </Card>

        {/* ---------------- OBJECTIVE BREAKDOWN ---------------- */}
        <section className="section">
          <h2 className="section-title">What that priority does to the numbers</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            {run
              ? 'The exact best design at this priority, re-solved over the whole space.'
              : 'Shown for your current design. Run the search below to find the best design at this priority.'}
          </p>

          {scoreMatches && score ? (
            <>
              <StatGroup
                provenance="computed"
                note="Calculated exactly in this browser from the published scoring model."
              >
                <Stat
                  label="PET model score"
                  value={formatScore(score.scores.PET)}
                  unit={METRIC_HELP.petScore.unit}
                  direction="higher is better"
                  help={METRIC_HELP.petScore.plain}
                  tone="pet"
                />
                <Stat
                  label="Off-target total (PE + PP)"
                  value={formatScore(score.objectiveParts.offTargetSum)}
                  unit="dimensionless, before the priority weight"
                  direction="lower is better"
                  help="The two unwanted scores added together. The priority dial multiplies this number."
                  tone="warn"
                />
                <Stat
                  label="Off-target penalty"
                  value={formatScore(score.objectiveParts.penaltyTerm)}
                  unit={`= ${sliderValue.toFixed(2)} x off-target total`}
                  direction="lower is better"
                  help="The priority dial multiplied by the off-target total. This is the part of the objective the dial controls."
                />
                <Stat
                  label={METRIC_HELP.objective.label}
                  value={formatScore(score.objective)}
                  unit={METRIC_HELP.objective.unit}
                  direction={METRIC_HELP.objective.direction}
                  help={METRIC_HELP.objective.plain}
                />
              </StatGroup>

              <Card style={{ marginTop: 'var(--s-4)' }}>
                <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--s-3)' }}>
                  The objective, written out
                </h3>
                <div
                  className="scroll-x mono"
                  style={{
                    background: 'var(--surface-sunken)',
                    padding: 'var(--s-4)',
                    borderRadius: 'var(--r-md)',
                    fontSize: 'var(--fs-sm)',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-faint)' }}>reward PET</span>
                    {'   '}
                    <span style={{ color: 'var(--text-faint)' }}>avoid the others</span>
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{ color: 'var(--c-pet)' }}>
                      {score.objectiveParts.targetTerm.toFixed(3)}
                    </span>
                    {'  +  '}
                    <span style={{ color: 'var(--optimise)' }}>
                      {score.objectiveParts.penaltyTerm.toFixed(3)}
                    </span>
                    {'  =  '}
                    <strong>{score.objective.toFixed(3)}</strong>
                  </div>
                </div>
                <Disclosure summary="Advanced maths">
                  <p className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
                    E(x) = &minus;PET(x) + &lambda; &middot; (PE(x) + PP(x))
                  </p>
                  <p style={{ marginTop: 'var(--s-2)' }}>
                    Minimised over x in the valid one-hot space (exactly one block chosen per position). The leading minus sign is why a
                    higher PET score lowers the objective. Because every term is a sum of
                    one-body and two-body indicator features, E is exactly a quadratic form in
                    the 48 binary variables, which is what makes a QUBO formulation possible at
                    all. See the Understand screen for the matrix itself.
                  </p>
                </Disclosure>
              </Card>
            </>
          ) : (
            <EmptyState
              title="No scored design yet"
              body="The scoring model is still loading, or scoring is unavailable in this browser."
              action={
                <Button onClick={() => navigate('build')}>Go to Build &amp; Explore</Button>
              }
            />
          )}
        </section>

        {/* ---------------- WHAT CHANGED ---------------- */}
        {run && sweepHere ? (
          <section className="section">
            <h2 className="section-title">What changed when you moved the dial</h2>
            <Card>
              {sweepBaseline &&
              sweepHere.best.classSequence === sweepBaseline.best.classSequence ? (
                <Notice>
                  <strong>The winning design did not change.</strong>
                  <p style={{ marginTop: 'var(--s-1)' }}>
                    At &lambda; = {sweepHere.lambda} the best design is still{' '}
                    <code>{sweepHere.best.representative}</code>, the same one as at &lambda; = 1.
                    The numbers behind it did move: the objective went from{' '}
                    <span className="num">{sweepBaseline.best.objective.toFixed(2)}</span> to{' '}
                    <span className="num">{sweepHere.best.objective.toFixed(2)}</span>, because
                    the off-target total is multiplied by a different weight. A design only loses
                    its place when some rival gains more from the new weighting than it does.
                  </p>
                </Notice>
              ) : (
                <Notice tone="good">
                  <strong>A different design now wins.</strong>
                  <p style={{ marginTop: 'var(--s-1)' }}>
                    At &lambda; = {sweepHere.lambda} the best design is{' '}
                    <code>{sweepHere.best.representative}</code> with an objective of{' '}
                    <span className="num">{sweepHere.best.objective.toFixed(2)}</span>.
                  </p>
                </Notice>
              )}
              <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
                <SequenceGlyph codes={sweepHere.best.codes} showResidues />
                <code style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>
                  {sweepHere.best.classSequence}
                </code>
              </div>
            </Card>
          </section>
        ) : null}

        {/* ---------------- RUN PARAMETERS (RESEARCHER) ----------------
            Real controls, not a readout: the values set here are the ones
            handed to the worker. Beginners get the tuned defaults for their
            device and never see this panel. */}
        <Researcher>
          <section className="section">
            <header className="section-head">
              <h2 className="section-title">Run parameters</h2>
              <p className="section-lede">
                These are the values passed to the worker when you start a run. The defaults are
                tuned to this device&rsquo;s reported core count and memory so the page stays
                responsive; raising them costs time, not correctness, because the exhaustive
                search is exact either way.
              </p>
            </header>
            <Card>
              <div className="param-grid">
                <label className="param">
                  <span>Random seed</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={seed}
                    onChange={(event) => setSeed(Math.max(0, Number(event.target.value) || 0))}
                  />
                  <small>Controls the surrogate split and the annealing trajectory.</small>
                </label>
                <label className="param">
                  <span>Annealing reads</span>
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    step={1}
                    value={reads}
                    onChange={(event) =>
                      setReads(Math.min(2000, Math.max(1, Number(event.target.value) || 1)))
                    }
                  />
                  <small>Independent samples drawn from the 48-variable QUBO.</small>
                </label>
                <label className="param">
                  <span>Sweeps per read</span>
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    step={1}
                    value={sweeps}
                    onChange={(event) =>
                      setSweeps(Math.min(5000, Math.max(1, Number(event.target.value) || 1)))
                    }
                  />
                  <small>Monte-Carlo sweeps in each annealing run.</small>
                </label>
                <label className="param">
                  <span>Penalty multiplier</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    step={0.5}
                    value={penaltyMultiplier}
                    onChange={(event) =>
                      setPenaltyMultiplier(
                        Math.min(10, Math.max(1, Number(event.target.value) || 1)),
                      )
                    }
                  />
                  <small>
                    P = multiplier x (|linear| + |quadratic|) + 1, which keeps every one-hot
                    violation strictly worse than any valid assignment.
                  </small>
                </label>
              </div>
              <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
                Device defaults for this machine: {workload.annealing.reads} reads,{' '}
                {workload.annealing.sweeps} sweeps, {workload.annealing.runs} runs,{' '}
                {formatInt(workload.surrogate.trainSize)} surrogate training rows.{' '}
                {state.capability.reason}
                <Button
                  size="sm"
                  variant="ghost"
                  style={{ marginLeft: 'var(--s-2)' }}
                  onClick={() => {
                    setSeed(DEFAULT_RUN_CONFIG.seed);
                    setReads(workload.annealing.reads);
                    setSweeps(workload.annealing.sweeps);
                    setPenaltyMultiplier(DEFAULT_RUN_CONFIG.penaltyMultiplier);
                  }}
                >
                  Reset to device defaults
                </Button>
              </p>
            </Card>
          </section>
        </Researcher>

        {/* ---------------- PIPELINE ---------------- */}
        <section className="section">
          <div
            className="spread"
            style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--s-4)' }}
          >
            <div>
              <h2 className="section-title">The nine stages, for real</h2>
              <Researcher>
                <p className="section-lede">
                  Stage progress comes from worker messages, not from a timer. A stage that
                  cannot report a fraction shows elapsed time rather than a synthetic
                  percentage. The run parameters are below.
                </p>
              </Researcher>
              <Beginner>
                <p className="plain-note">
                  These are the real steps the computation takes. Nothing here is a decorative
                  progress animation.
                </p>
              </Beginner>
            </div>
            <div className="row-wrap">
              {state.status === 'running' ? (
                <Button variant="danger" onClick={cancelRun}>
                  Cancel the run
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() =>
                    startRun({
                      lambda: state.lambda,
                      seed,
                      penaltyMultiplier,
                      surrogate: { alpha: 1e-6, ...workload.surrogate },
                      annealing: { ...workload.annealing, reads, sweeps },
                    })
                  }
                  disabled={state.status === 'idle' || state.status === 'loadingModel'}
                >
                  {run ? 'Run again' : 'Start a Live Run'}
                </Button>
              )}
              {run ? (
                <Button onClick={() => navigate('compare')}>See the results</Button>
              ) : null}
            </div>
          </div>

          {state.status === 'idle' || state.status === 'loadingModel' ? (
            <Notice>Loading the scoring model. The run button will enable in a moment.</Notice>
          ) : null}

          {state.status === 'cancelled' ? (
            <Notice tone="honest" icon="!">
              <strong>Run cancelled.</strong> The worker stopped where it was and no partial
              numbers were kept. Start a new run whenever you are ready.
            </Notice>
          ) : null}

          {state.error && !state.error.fatal ? (
            <Notice tone="honest" icon="!">
              <strong>That step could not finish.</strong>
              <p style={{ marginTop: 'var(--s-1)' }}>{state.error.message}</p>
              <Button
                size="sm"
                style={{ marginTop: 'var(--s-2)' }}
                onClick={() => dispatch({ type: 'DISMISS_ERROR' })}
              >
                Dismiss
              </Button>
            </Notice>
          ) : null}

          <ol
            className="stack-sm"
            style={{ listStyle: 'none', padding: 0, marginTop: 'var(--s-4)' }}
          >
            {STAGES.map((stage) => (
              <StageRow
                key={stage.id}
                id={stage.id}
                ordinal={stage.ordinal}
                title={stage.title}
                plain={stage.plain}
                technical={stage.technical}
                pythonRef={stage.pythonRef}
                measurable={stage.measurable}
                researcher={state.mode === 'researcher'}
              />
            ))}
          </ol>

          {run ? (
            <Card style={{ marginTop: 'var(--s-5)' }}>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
                <div>
                  <h3 style={{ fontSize: 'var(--fs-md)' }}>Run complete</h3>
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-1)' }}
                  >
                    {formatInt(run.searchSpace.validSequences)} designs scored against 3 plastics
                    in {formatMs(run.totalMs)} on this device. Seed {run.config.seed}.
                  </p>
                </div>
                <div className="row-wrap">
                  <ProvenanceBadge kind="computed" />
                  <Button onClick={() => navigate('results')}>Open the written report</Button>
                </div>
              </div>
              <div className="scroll-x" style={{ marginTop: 'var(--s-4)' }}>
                <table className="table">
                  <caption className="sr-only">Measured time per pipeline stage</caption>
                  <thead>
                    <tr>
                      <th scope="col">Stage</th>
                      <th scope="col" className="num">
                        Measured time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map((stage) => (
                      <tr key={stage.id}>
                        <td style={{ whiteSpace: 'normal' }}>
                          {stage.ordinal}. {stage.title}
                        </td>
                        <td className="num">{formatMs(run.timings[stage.id] ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <EmptyState
              title="Nothing has been computed yet"
              body={`A Live Run scores all ${groupInt(VALID_SEQUENCES)} designs against three plastics in your browser. On a typical laptop that takes a few seconds; the page stays responsive because the work happens in a background worker.`}
              action={
                <Button
                  variant="primary"
                  onClick={() =>
                    startRun({
                      lambda: state.lambda,
                      seed,
                      penaltyMultiplier,
                      surrogate: { alpha: 1e-6, ...workload.surrogate },
                      annealing: { ...workload.annealing, reads, sweeps },
                    })
                  }
                  disabled={state.status === 'idle' || state.status === 'loadingModel'}
                >
                  Run it now
                </Button>
              }
            />
          )}
        </section>
      </div>
    </div>
  );
}

function StageRow({
  id,
  ordinal,
  title,
  plain,
  technical,
  pythonRef,
  measurable,
  researcher,
}: {
  readonly id: StageId;
  readonly ordinal: number;
  readonly title: string;
  readonly plain: string;
  readonly technical: string;
  readonly pythonRef: string;
  readonly measurable: boolean;
  readonly researcher: boolean;
}): JSX.Element {
  const { state } = useStore();
  const stage = state.stages[id];
  const active = stage.status === 'active';
  const done = stage.status === 'done';

  const colour = done ? 'var(--success)' : active ? 'var(--optimise)' : 'var(--border-strong)';

  return (
    <li>
      <div
        className="card"
        style={{
          padding: 'var(--s-3) var(--s-4)',
          borderColor: active ? 'var(--optimise)' : 'var(--border-subtle)',
          background: active
            ? 'color-mix(in srgb, var(--optimise) 7%, var(--surface))'
            : 'var(--surface)',
          transition: 'border-color var(--dur-base), background var(--dur-base)',
        }}
      >
        <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
          <span
            aria-hidden="true"
            style={{
              flex: 'none',
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              border: `2px solid ${colour}`,
              color: colour,
              background: done ? colour : 'transparent',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {done ? (
              <svg width="13" height="13" viewBox="0 0 16 16">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  stroke="var(--text-on-accent)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              ordinal
            )}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="spread" style={{ gap: 'var(--s-3)', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 'var(--fs-sm)' }}>{title}</strong>
              <span className="faint num" style={{ fontSize: 'var(--fs-xs)' }}>
                {done && stage.elapsedMs > 0
                  ? formatMs(stage.elapsedMs)
                  : active
                    ? measurable && stage.fraction !== null
                      ? `${(stage.fraction * 100).toFixed(0)}%`
                      : `working, ${formatMs(stage.elapsedMs)} elapsed`
                    : 'waiting'}
              </span>
            </div>

            {active || done ? (
              <div
                className={`progress ${active && !measurable ? 'progress-indeterminate' : ''}`}
                style={{ marginTop: 'var(--s-2)', height: 5 }}
                role="progressbar"
                aria-valuenow={
                  stage.fraction !== null ? Math.round(stage.fraction * 100) : undefined
                }
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${title} progress`}
              >
                <div
                  className="progress-fill"
                  style={{
                    width: done ? '100%' : stage.fraction !== null ? `${stage.fraction * 100}%` : undefined,
                  }}
                />
              </div>
            ) : null}

            <p
              className="muted"
              style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}
            >
              {stage.note || plain}
            </p>

            {researcher ? (
              <p className="faint mono" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
                {technical}
                <br />
                <span style={{ opacity: 0.75 }}>{pythonRef}</span>
              </p>
            ) : null}

            {!measurable ? (
              <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-1)' }}>
                This stage has no measurable progress, so elapsed time is shown rather than a
                percentage.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
