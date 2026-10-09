/**
 * SCREEN F - Results & Export.
 *
 * The written-up version of the current run, designed to be read start to
 * finish, printed, or downloaded. Every number carries its definition and its
 * provenance. Nothing here is a placeholder: if a download is offered it
 * produces a real file built from the run on screen.
 */

import { useMemo, useState } from 'react';

import { useRouter } from '../app/router';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  InfoTip,
  KeyValue,
  Notice,
  ProvenanceBadge,
  ScreenHeader,
  Stat,
  formatInt,
  formatMs,
  formatSci,
} from '../components/primitives';
import { SequenceGlyph } from '../components/PeptideChain';
import { CANDIDATE_LABEL_HELP, HONESTY, METRIC_HELP, SCREENS } from '../content/copy';
import { CLASS_INFO } from '../science/alphabet';
import { PLASTIC_INFO } from '../science/potts';
import { encodeShareState } from '../state/persistence';
import { useStore } from '../state/store';
import { ScoreBars } from '../viz/charts';
import {
  buildExportBundle,
  toBlob,
  triggerDownload,
  type ExportArtefact,
} from '../export/index';

export function ResultsScreen(): JSX.Element {
  const { state, dispatch, startRun } = useStore();
  const { navigate } = useRouter();
  const run = state.baseline;
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const bundle = useMemo<ExportArtefact[]>(
    () => (run ? buildExportBundle(run) : []),
    [run],
  );

  if (!run) {
    return (
      <div className="screen">
        <div className="shell">
          <ScreenHeader
            eyebrow="Screen 6 of 6"
            title={SCREENS.results.title}
            purpose={SCREENS.results.purpose}
          />
          <EmptyState
            title="There is no run to write up yet"
            body="This screen summarises a completed run and turns it into downloadable files. Run the search first and everything here fills in with real numbers."
            action={
              <div className="row-wrap" style={{ justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => navigate('optimise')}>
                  Go to Optimise
                </Button>
                <Button
                  onClick={() => startRun({ lambda: state.lambda })}
                  disabled={state.status === 'idle' || state.status === 'loadingModel'}
                >
                  Run it from here
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const winner = run.candidates[0];
  const runnerUp = run.candidates[1] ?? null;
  const exactSolver = run.solvers.find((s) => s.exact) ?? null;
  const heuristic = run.solvers.find((s) => !s.exact && s.status === 'EXECUTED') ?? null;

  const shareUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${window.location.pathname}${encodeShareState(
          winner.codes,
          run.config.lambda,
        )}`;

  const download = (artefact: ExportArtefact) => {
    setDownloadError(null);
    const ok = triggerDownload(artefact.filename, toBlob(artefact.text, artefact.mime));
    if (ok) {
      setDownloaded(artefact.filename);
      window.setTimeout(() => setDownloaded(null), 2600);
    } else {
      setDownloadError(
        `Your browser blocked the download of ${artefact.filename}. You can still copy the contents from the preview below.`,
      );
    }
  };

  return (
    <div className="screen">
      <div className="shell">
        <ScreenHeader
          eyebrow="Screen 6 of 6"
          title={SCREENS.results.title}
          purpose={SCREENS.results.purpose}
          actions={
            <>
              <Button variant="primary" onClick={() => window.print()}>
                Print or save as PDF
              </Button>
              <Button
                onClick={() => {
                  navigator.clipboard?.writeText(shareUrl).catch(() => {});
                  setDownloaded('link');
                  window.setTimeout(() => setDownloaded(null), 2200);
                }}
              >
                {downloaded === 'link' ? 'Link copied' : 'Copy a link to this design'}
              </Button>
              <Button variant="ghost" onClick={() => navigate('compare')}>
                Back to Compare
              </Button>
            </>
          }
        />

        {/* ---------------- HEADLINE ---------------- */}
        <Card raised style={{ borderColor: 'var(--success)' }}>
          <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-4)' }}>
            <div>
              <p className="eyebrow" style={{ color: 'var(--success)' }}>
                Selected candidate &middot; proven optimum at &lambda; = {run.config.lambda}
              </p>
              <h2 style={{ fontSize: 'var(--fs-2xl)', marginBlock: 'var(--s-2)' }}>
                <code style={{ fontSize: 'inherit', background: 'none', padding: 0 }}>
                  {winner.representative}
                </code>
              </h2>
              <p className="mono muted" style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>
                {winner.classSequence}
              </p>
            </div>
            <div style={{ flex: 'none' }}>
              <SequenceGlyph codes={winner.codes} showResidues />
            </div>
          </div>

          <Notice tone="honest" icon="!">
            <strong>Read this before the numbers.</strong> {winner.representative} is a pattern
            of amino-acid <em>families</em>, not a peptide sequence. {HONESTY.classNotResidue}
          </Notice>
        </Card>

        {/* ---------------- THE EIGHT POSITIONS ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">The eight positions, named in full</h2>
          <Card style={{ padding: 0, marginTop: 'var(--s-3)' }}>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">
                  Each position of the selected design with its family name and members
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Family (full name)</th>
                    <th scope="col">Symbol</th>
                    <th scope="col">Shown as</th>
                    <th scope="col">Members of this family</th>
                  </tr>
                </thead>
                <tbody>
                  {winner.codes.map((code, i) => {
                    const info = CLASS_INFO[code];
                    return (
                      <tr key={i}>
                        <td className="num">{i + 1}</td>
                        <td data-class={info.id}>
                          <span className="row" style={{ gap: 'var(--s-2)' }}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                background: 'var(--block-colour)',
                                flex: 'none',
                              }}
                            />
                            {info.name}
                          </span>
                        </td>
                        <td className="mono">{info.symbol}</td>
                        <td className="mono">{info.representative}</td>
                        <td className="mono">{info.residues.join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* ---------------- WHY IT RANKED FIRST ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">Why it ranked first</h2>
          <Card>
            <p className="prose">
              At a Selectivity Priority of {run.config.lambda}, the search minimises{' '}
              <span className="mono">
                &minus;PET + {run.config.lambda} &times; (PE + PP)
              </span>
              . This design reached{' '}
              <strong className="num">{winner.objective.toFixed(3)}</strong>, the lowest value of
              any of the {formatInt(run.searchSpace.validSequences)} possible designs. Because
              every design was evaluated, that is a proof for this model rather than a best
              guess.
            </p>

            {runnerUp ? (
              <p className="prose" style={{ marginTop: 'var(--s-3)' }}>
                The margin over second place is narrow:{' '}
                <code>{runnerUp.representative}</code> reached{' '}
                <span className="num">{runnerUp.objective.toFixed(3)}</span>, a difference of
                only{' '}
                <span className="num">
                  {Math.abs(winner.objective - runnerUp.objective).toFixed(3)}
                </span>
                . A gap that small means the ranking at the top is sensitive: a slightly
                different aggregation rule or backbone could reorder these two.
              </p>
            ) : null}

            <div className="grid-auto" style={{ marginTop: 'var(--s-5)' }}>
              <Stat
                label={METRIC_HELP.petScore.label}
                value={winner.scores.PET.toFixed(3)}
                unit={METRIC_HELP.petScore.unit}
                direction={METRIC_HELP.petScore.direction}
                help={METRIC_HELP.petScore.plain}
                tone="pet"
                provenance="computed"
              />
              <Stat
                label={METRIC_HELP.worstOffTarget.label}
                value={winner.metrics.worstOffTarget.toFixed(3)}
                unit={METRIC_HELP.worstOffTarget.unit}
                direction={METRIC_HELP.worstOffTarget.direction}
                help={METRIC_HELP.worstOffTarget.plain}
                tone="warn"
                provenance="computed"
              />
              <Stat
                label={METRIC_HELP.marginWorst.label}
                value={winner.metrics.marginWorst.toFixed(3)}
                unit={METRIC_HELP.marginWorst.unit}
                direction={METRIC_HELP.marginWorst.direction}
                help={METRIC_HELP.marginWorst.plain}
                tone={winner.metrics.marginWorst > 0 ? 'good' : 'warn'}
                provenance="computed"
              />
              <Stat
                label={METRIC_HELP.objective.label}
                value={winner.objective.toFixed(3)}
                unit={METRIC_HELP.objective.unit}
                direction={METRIC_HELP.objective.direction}
                help={METRIC_HELP.objective.plain}
                provenance="computed"
              />
            </div>

            <div style={{ marginTop: 'var(--s-5)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--s-3)' }}>
                The three scores side by side
              </h3>
              <ScoreBars
                rows={PLASTIC_INFO.map((info) => ({
                  label: `${info.id} (${info.everyday.toLowerCase()})`,
                  value: winner.scores[info.id],
                  colour: `var(--c-${info.id.toLowerCase()})`,
                  direction: info.role === 'target' ? ('higher' as const) : ('lower' as const),
                }))}
                digits={3}
              />
            </div>

            <Disclosure summary="How selectivity is defined here" defaultOpen>
              <div className="stack-sm">
                <p>
                  <strong>Margin against the worst case</strong> is the honest measure:{' '}
                  <span className="mono">PET &minus; max(PE, PP)</span>. For this design that is{' '}
                  <span className="num">{winner.scores.PET.toFixed(3)}</span> &minus;{' '}
                  <span className="num">{winner.metrics.worstOffTarget.toFixed(3)}</span> ={' '}
                  <span className="num">{winner.metrics.marginWorst.toFixed(3)}</span>.
                </p>
                <p>
                  <strong>Margin against the average</strong> uses{' '}
                  <span className="mono">PET &minus; mean(PE, PP)</span> and is always the more
                  flattering of the two, because averaging hides whichever off-target scores
                  highest. Here it is{' '}
                  <span className="num">{winner.metrics.marginMean.toFixed(3)}</span>.
                </p>
                <p className="faint">
                  Both are dimensionless differences of model scores. A positive margin means
                  the model prefers PET; its size has no physical unit and should not be read as
                  a binding-strength ratio.
                </p>
              </div>
            </Disclosure>
          </Card>
        </section>

        {/* ---------------- SENSITIVITY ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">How sensitive is this answer?</h2>
          <Card style={{ padding: 0 }}>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">
                  The winning design at each priority value in the sweep
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Priority &lambda;
                    </th>
                    <th scope="col">Winner at that priority</th>
                    <th scope="col" className="num">
                      PET
                    </th>
                    <th scope="col" className="num">
                      Margin vs worst
                    </th>
                    <th scope="col" className="num">
                      Ties
                      <InfoTip
                        title="Ties"
                        body="Designs reaching exactly the same objective within the 1e-8 tolerance. More than one means the optimum is not unique."
                      />
                    </th>
                    <th scope="col">Same as the selected design?</th>
                  </tr>
                </thead>
                <tbody>
                  {run.sweep.map((point) => {
                    const same = point.best.classSequence === winner.classSequence;
                    return (
                      <tr key={point.lambda}>
                        <td className="num">{point.lambda}</td>
                        <td>
                          <span className="row" style={{ gap: 'var(--s-2)' }}>
                            <SequenceGlyph codes={point.best.codes} size="sm" />
                            <code style={{ fontSize: 'var(--fs-xs)' }}>
                              {point.best.representative}
                            </code>
                          </span>
                        </td>
                        <td className="num">{point.best.scores.PET.toFixed(2)}</td>
                        <td className="num">{point.best.metrics.marginWorst.toFixed(2)}</td>
                        <td className="num">{point.optimumHits}</td>
                        <td>
                          <span
                            className={`badge badge-prov ${same ? 'prov-computed' : 'prov-illustrative'}`}
                          >
                            {same ? 'yes' : 'no - different winner'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Notice tone="honest" icon="!">
            <strong>The winner depends on the dial you chose.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              The Selectivity Priority is not measured from anything; it encodes how much you
              care about avoiding the other plastics. Because the winner changes with it, no
              single design here is &ldquo;the&rdquo; answer. Reporting a candidate without its
              priority value would be meaningless.
            </p>
          </Notice>
        </section>

        {/* ---------------- CONFIDENCE ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">Confidence and limitations</h2>
          <div className="grid-auto">
            <Card>
              <h3 style={{ fontSize: 'var(--fs-md)' }}>What was checked</h3>
              <div style={{ marginTop: 'var(--s-3)' }}>
                {run.verify ? (
                  <>
                    <KeyValue
                      label="Matrix vs direct score"
                      value={formatSci(run.verify.maxQuboObjectiveError)}
                      help="Two independent code paths for the same objective, compared on sampled designs. Should be near zero."
                    />
                    <KeyValue
                      label="Penalty leakage on valid designs"
                      value={formatSci(run.verify.maxPenaltyResidue)}
                      help="A valid design picks exactly one block per position. The penalty that enforces that rule must contribute exactly nothing to a design which already obeys it."
                    />
                    <KeyValue
                      label="Encoding round-trips"
                      value={`${run.verify.encodeDecodeRoundTrips} / ${run.verify.sampleSize}`}
                    />
                    <KeyValue
                      label="Invalid designs correctly penalised"
                      value={`${run.verify.invalidCorrectlyPenalised} / ${run.verify.invalidTested}`}
                    />
                    <KeyValue
                      label="Penalty bound P"
                      value={run.verify.penaltyBound.toFixed(1)}
                      help={METRIC_HELP.penalty.plain}
                    />
                  </>
                ) : (
                  <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                    Verification did not run for this record.
                  </p>
                )}
              </div>
              <div style={{ marginTop: 'var(--s-3)' }}>
                <ProvenanceBadge kind="sampled" />
              </div>
            </Card>

            <Card>
              <h3 style={{ fontSize: 'var(--fs-md)' }}>What this does not establish</h3>
              <ul
                className="stack-sm"
                style={{ marginTop: 'var(--s-3)', fontSize: 'var(--fs-sm)' }}
              >
                <li>{HONESTY.noLab}</li>
                <li>{HONESTY.noDegradation}</li>
                <li>{HONESTY.noBinding}</li>
                <li>
                  <strong>{HONESTY.noQuantum}.</strong> Recorded in this run as{' '}
                  <code>{run.quantumHardware}</code>.
                </li>
              </ul>
              <Button
                variant="ghost"
                size="sm"
                style={{ marginTop: 'var(--s-3)' }}
                onClick={() => navigate('understand')}
              >
                Read the full honesty section
              </Button>
            </Card>
          </div>

          <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
            {winner.metrics.warnings.split(';').map((label) => {
              const help = CANDIDATE_LABEL_HELP[label];
              return (
                <span
                  key={label}
                  className="badge"
                  style={
                    label === 'BALANCED'
                      ? { borderColor: 'var(--success)', color: 'var(--success)' }
                      : { borderColor: 'var(--attention)', color: 'var(--attention)' }
                  }
                >
                  {help?.title ?? label}
                  {help ? <InfoTip title={help.title} body={help.plain} /> : null}
                </span>
              );
            })}
          </div>
        </section>

        {/* ---------------- RUN CONFIGURATION ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">Exactly how this run was configured</h2>
          <div className="grid-auto">
            <Card>
              <h3 style={{ fontSize: 'var(--fs-md)' }}>Settings</h3>
              <div style={{ marginTop: 'var(--s-3)' }}>
                <KeyValue label="Selectivity Priority (lambda)" value={run.config.lambda} />
                <KeyValue label="Random seed" value={run.config.seed} />
                <KeyValue label="Penalty multiplier" value={run.config.penaltyMultiplier} />
                <KeyValue label="Solver tolerance" value={formatSci(run.config.tolerance)} />
                <KeyValue
                  label="Sweep values"
                  value={run.config.sweepLambdas.join(', ')}
                />
                <KeyValue
                  label="Annealing"
                  value={
                    run.config.annealing.enabled
                      ? `${run.config.annealing.runs} runs x ${run.config.annealing.reads} reads x ${run.config.annealing.sweeps} sweeps`
                      : 'disabled'
                  }
                />
                <KeyValue
                  label="Surrogate splits"
                  value={
                    run.config.surrogate.enabled
                      ? `${formatInt(run.config.surrogate.trainSize)} / ${formatInt(run.config.surrogate.validationSize)} / ${formatInt(run.config.surrogate.testSize)}`
                      : 'disabled'
                  }
                />
              </div>
            </Card>

            <Card>
              <h3 style={{ fontSize: 'var(--fs-md)' }}>Method and environment</h3>
              <div style={{ marginTop: 'var(--s-3)' }}>
                <KeyValue
                  label="Search"
                  value={exactSolver ? exactSolver.solver : 'not recorded'}
                  mono={false}
                />
                <KeyValue
                  label="Designs evaluated"
                  value={formatInt(run.searchSpace.validSequences)}
                />
                <KeyValue label="Binary variables" value={run.searchSpace.binaryVariables} />
                <KeyValue label="Total wall-clock" value={formatMs(run.totalMs)} />
                <KeyValue
                  label="Logical cores"
                  value={run.environment.hardwareConcurrency || 'unknown'}
                />
                <KeyValue
                  label="Device memory"
                  value={
                    run.environment.deviceMemoryGb
                      ? `~${run.environment.deviceMemoryGb} GB`
                      : 'not reported'
                  }
                />
                <KeyValue label="Started" value={run.startedAtIso} mono />
              </div>
              <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
                Timings were measured in your browser on this device and are not comparable with
                another machine or with the Python benchmark.
              </p>
            </Card>
          </div>

          <Disclosure summary="Data provenance in full">
            <div className="stack-sm">
              <p>
                <strong>Scoring model.</strong>{' '}
                <code style={{ overflowWrap: 'anywhere' }}>{run.modelSource}</code>
              </p>
              <p>
                The coefficient file the browser downloaded is generated by{' '}
                <code>scripts/export_web_model.py</code> from{' '}
                <code>data/processed/real_aggregated_potts_model.npz</code>, the same file the
                Python benchmark uses. The automated test suite checks the browser scorer
                against 398 recorded Python values to within 1e-9.
              </p>
              <div className="row-wrap">
                <ProvenanceBadge kind="computed" />
                <ProvenanceBadge kind="sampled" />
                <ProvenanceBadge kind="estimate" />
                <ProvenanceBadge kind="illustrative" />
                <ProvenanceBadge kind="unavailable" />
              </div>
              <p className="faint">
                Those five badges appear throughout the site. Hover any of them to see exactly
                what it promises.
              </p>
            </div>
          </Disclosure>
        </section>

        {/* ---------------- SOLVERS SUMMARY ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">Search methods used</h2>
          <Card style={{ padding: 0 }}>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">Solvers run for this record</caption>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Best objective
                    </th>
                    <th scope="col" className="num">
                      Runtime
                    </th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {run.solvers.map((solver) => (
                    <tr key={solver.solver}>
                      <td>{solver.solver}</td>
                      <td>
                        <span
                          className={`badge badge-prov ${
                            solver.status === 'EXECUTED' ? 'prov-computed' : 'prov-unavailable'
                          }`}
                        >
                          {solver.status}
                        </span>
                      </td>
                      <td className="num">
                        {solver.bestObjective === null
                          ? 'not available'
                          : solver.bestObjective.toFixed(3)}
                      </td>
                      <td className="num">{formatMs(solver.runtimeMs)}</td>
                      <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>
                        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                          {solver.note}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {heuristic && exactSolver && heuristic.bestObjective !== null && exactSolver.bestObjective !== null ? (
            <Notice>
              <strong>How close did the heuristic get?</strong>
              <p style={{ marginTop: 'var(--s-1)' }}>
                {heuristic.solver} reached{' '}
                <span className="num">{heuristic.bestObjective.toFixed(2)}</span> against the
                proven optimum of{' '}
                <span className="num">{exactSolver.bestObjective.toFixed(2)}</span>, a gap of{' '}
                <span className="num">
                  {Math.abs(heuristic.bestObjective - exactSolver.bestObjective).toFixed(2)}
                </span>{' '}
                (
                {(
                  (Math.abs(heuristic.bestObjective - exactSolver.bestObjective) /
                    Math.abs(exactSolver.bestObjective)) *
                  100
                ).toFixed(1)}
                % of the optimum). It was given deliberately small settings to keep this page
                responsive, so this is a statement about that budget, not about annealing in
                general.
              </p>
            </Notice>
          ) : null}
        </section>

        {/* ---------------- DOWNLOADS ---------------- */}
        <section style={{ marginTop: 'var(--s-7) ' }} className="no-print">
          <h2 className="section-title">Download this run</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Every file is built from the run shown above, with the same seed and priority. There
            is no server: the files are assembled in your browser.
          </p>

          {downloadError ? (
            <Notice tone="honest" icon="!">
              {downloadError}
            </Notice>
          ) : null}

          <div className="grid-auto">
            {bundle.map((artefact) => (
              <Card key={artefact.filename}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <code
                      style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere', display: 'block' }}
                    >
                      {artefact.filename}
                    </code>
                    <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {(artefact.text.length / 1024).toFixed(1)} KB &middot;{' '}
                      {artefact.text.split('\n').length} lines
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={downloaded === artefact.filename ? 'primary' : 'secondary'}
                    onClick={() => download(artefact)}
                  >
                    {downloaded === artefact.filename ? 'Saved' : 'Download'}
                  </Button>
                </div>
                <Disclosure summary="Preview the first few lines">
                  <pre
                    className="mono scroll-x"
                    style={{
                      fontSize: 10,
                      background: 'var(--surface)',
                      padding: 'var(--s-2)',
                      borderRadius: 'var(--r-sm)',
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}
                  >
                    {artefact.text.split('\n').slice(0, 14).join('\n')}
                  </pre>
                </Disclosure>
              </Card>
            ))}
          </div>

          <Notice>
            <strong>Printing.</strong> Use the Print button at the top of this screen to produce
            a PDF. The page has dedicated print styles: navigation, download buttons and
            animations are removed, colours become print-safe, and tables avoid page breaks.
            The printed report carries the same seed, priority and date as the run above.
          </Notice>

          <Notice>
            <strong>Privacy.</strong> Nothing on this screen was uploaded anywhere. The link
            button encodes your design into the address bar so you can keep or send it; it
            contains only the eight family choices and the priority value, and it points at this
            same static site. Your saved scenarios and preferences live in your own browser
            storage.
            <div className="row-wrap" style={{ marginTop: 'var(--s-3)' }}>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  dispatch({ type: 'RESET_ALL' });
                  navigate('discover');
                }}
              >
                Reset everything and start over
              </Button>
            </div>
          </Notice>
        </section>

        {/* Print-only footer so a PDF is self-describing. */}
        <div className="print-only" style={{ marginTop: 'var(--s-6)' }}>
          <hr />
          <p style={{ fontSize: 11 }}>
            QBind Select &mdash; computational selectivity proxy. Run {run.runId}, priority
            &lambda; = {run.config.lambda}, seed {run.config.seed}, started {run.startedAtIso}.
            Model: {run.modelSource}. {HONESTY.noLab} {HONESTY.noQuantum}.
          </p>
        </div>
      </div>
    </div>
  );
}
