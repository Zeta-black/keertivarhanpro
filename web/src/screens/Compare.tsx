/**
 * SCREEN D - Compare.
 *
 * Candidate podium, sortable table, lambda sweep, exact Pareto trade-off and the
 * solver comparison. This is where the old Peptides / Sweep / Solvers tabs live.
 *
 * The solver comparison only ever reports measured numbers. D-Wave is listed
 * because the published pipeline targets it, and it is listed as NOT EXECUTED
 * with the reason, which is the honest presentation.
 */

import { useMemo, useState } from 'react';

import { useRouter } from '../app/router';
import { LiveReadout } from '../components/LiveReadout';
import {
  Button,
  Card,
  Disclosure,
  EmptyState,
  InfoTip,
  Notice,
  ProvenanceBadge,
  ScreenHeader,
  formatInt,
  formatMs,
  formatScore,
} from '../components/primitives';
import { SequenceGlyph } from '../components/PeptideChain';
import { Beginner, PlainNote, Researcher, useMode } from '../app/mode';
import { CANDIDATE_LABEL_HELP, METRIC_HELP, SCREENS } from '../content/copy';
import { groupInt } from '../content/format';
import { defaultResidues, residueDegeneracy } from '../chem/peptide';
import { MoleculeViewer } from '../viz/MoleculeViewer';
import { CLASS_INFO } from '../science/alphabet';
import { BENCHMARK_LAMBDAS } from '../science/objective';
import { PLASTIC_INFO } from '../science/potts';
import { useStore } from '../state/store';
import { BarChart, LineChart, ScatterChart, ScoreBars } from '../viz/charts';
import type { CandidateRecord } from '../workers/protocol';

type SortKey = 'rank' | 'objective' | 'PET' | 'marginWorst' | 'worstOffTarget';

export function CompareScreen(): JSX.Element {
  const { state, dispatch, send, startRun } = useStore();
  const { navigate } = useRouter();
  const run = state.baseline;

  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [filter, setFilter] = useState('');
  const [onlyFavourites, setOnlyFavourites] = useState(false);

  const favouriteKeys = useMemo(
    () => new Set(state.favourites.map((f) => f.codes.join(','))),
    [state.favourites],
  );

  const candidates = useMemo(() => {
    if (!run) return [];
    let rows = [...run.candidates];
    if (filter.trim()) {
      const needle = filter.trim().toUpperCase();
      rows = rows.filter(
        (c) =>
          c.classSequence.includes(needle) ||
          c.representative.toUpperCase().includes(needle) ||
          c.metrics.warnings.includes(needle),
      );
    }
    if (onlyFavourites) rows = rows.filter((c) => favouriteKeys.has(c.codes.join(',')));
    const sorters: Record<SortKey, (a: CandidateRecord, b: CandidateRecord) => number> = {
      rank: (a, b) => a.rank - b.rank,
      objective: (a, b) => a.objective - b.objective,
      PET: (a, b) => b.scores.PET - a.scores.PET,
      marginWorst: (a, b) => b.metrics.marginWorst - a.metrics.marginWorst,
      worstOffTarget: (a, b) => a.metrics.worstOffTarget - b.metrics.worstOffTarget,
    };
    return rows.sort(sorters[sortKey]);
  }, [run, filter, onlyFavourites, favouriteKeys, sortKey]);

  if (!run) {
    return (
      <div className="screen">
        <div className="shell">
          <ScreenHeader
            eyebrow="Screen 4 of 6"
            title={SCREENS.compare.title}
            purpose={SCREENS.compare.purpose}
          />
          <EmptyState
            title="There are no results to compare yet"
            body="This screen shows the top designs, how the winner shifts with the priority dial, and how each search method performed. All of that needs a run first."
            action={
              <div className="row-wrap" style={{ justifyContent: 'center' }}>
                <Button variant="primary" onClick={() => navigate('optimise')}>
                  Go to Optimise and run the search
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
          <Beginner>
            <p className="plain-note">
              Once a run finishes you will see the ten best designs in order, a chart showing how
              the winner changes as you move the priority dial, and a picture of the actual
              molecule for whichever design you select.
            </p>
          </Beginner>
          <Researcher>
            <p className="section-lede" style={{ marginTop: 'var(--s-4)' }}>
              After a run this screen carries: the top-N candidate table with objective, all
              three plastic scores, both margins, composition flags and the lexicographic
              sequence index; the exact lambda sweep (each point re-solved over the full space,
              never interpolated); the exact Pareto front of PET against worst off-target over
              every design, on a density background; and
              the solver comparison with validity rate, gap to the proven optimum and wall-clock
              timings measured on this device.
            </p>
          </Researcher>
        </div>
      </div>
    );
  }

  const podium = run.candidates.slice(0, 3);
  const sweep = state.sweep ?? run.sweep;
  const { researcher } = useMode();
  const selected = state.selectedCandidate ?? run.candidates[0];
  // The molecule shown for a ranked candidate uses the documented
  // representative of each class, because a class sequence is not a molecule.
  const selectedResidues = useMemo(() => defaultResidues(selected.codes), [selected.codes]);

  return (
    <div className="screen">
      <div className="shell">
        <ScreenHeader
          eyebrow="Screen 4 of 6"
          title={SCREENS.compare.title}
          purpose={SCREENS.compare.purpose}
          actions={
            <>
              <ProvenanceBadge kind="computed" />
              <span className="badge num">
                priority &lambda; = {run.config.lambda} &middot; seed {run.config.seed}
              </span>
              <Button onClick={() => navigate('results')}>Open the written report</Button>
            </>
          }
        />

        {/* Follows the selection wherever it is made - podium, table or
            chart - so the three controls spread down this page all have their
            effect visible. "Selected design in detail" lower down keeps the
            full position table, metric definitions and structure. */}
        <LiveReadout
          caption={`Selected: rank ${selected.rank} of ${run.candidates.length} · ${selected.representative}`}
          items={[
            { label: 'PET', value: formatScore(selected.scores.PET), tone: 'pet' as const },
            { label: 'PE', value: formatScore(selected.scores.PE), tone: 'pe' as const },
            { label: 'PP', value: formatScore(selected.scores.PP), tone: 'pp' as const },
            {
              label: 'Margin vs worst',
              value: formatScore(selected.metrics.marginWorst),
              tone: selected.metrics.marginWorst > 0 ? ('good' as const) : ('warn' as const),
            },
            { label: 'Objective', value: formatScore(selected.objective) },
          ]}
          note={
            <span className="live-readout-actions">
              <span className="mono">{selected.classSequence}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  document
                    .getElementById('selected-detail')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                Jump to full detail
              </Button>
            </span>
          }
        />

        {/* ---------------- PODIUM ---------------- */}
        <section>
          <h2 className="section-title">The top three designs</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Ranked by the objective at &lambda; = {run.config.lambda}: lower is better. Because
            every design was checked, rank 1 is proven for this model, not a best guess.
          </p>
          <div className="grid-auto">
            {podium.map((candidate, index) => {
              const isFavourite = favouriteKeys.has(candidate.codes.join(','));
              return (
                <Card
                  key={candidate.index}
                  raised={index === 0}
                  interactive
                  selected={selected.index === candidate.index}
                  style={index === 0 ? { borderColor: 'var(--success)' } : undefined}
                >
                  <div className="spread" style={{ marginBottom: 'var(--s-3)' }}>
                    <span
                      className="badge"
                      style={
                        index === 0
                          ? {
                              borderColor: 'var(--success)',
                              color: 'var(--success)',
                              background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                            }
                          : undefined
                      }
                    >
                      Rank {candidate.rank}
                      {index === 0 ? ' - proven best' : ''}
                    </span>
                    <span className="num faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      objective {candidate.objective.toFixed(2)}
                    </span>
                  </div>

                  <SequenceGlyph codes={candidate.codes} showResidues />
                  <p
                    className="mono"
                    style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)', overflowWrap: 'anywhere' }}
                  >
                    {candidate.classSequence}
                  </p>

                  <div style={{ marginTop: 'var(--s-4)' }}>
                    <ScoreBars
                      rows={PLASTIC_INFO.map((info) => ({
                        label: info.id,
                        value: candidate.scores[info.id],
                        colour: `var(--c-${info.id.toLowerCase()})`,
                        direction:
                          info.role === 'target' ? ('higher' as const) : ('lower' as const),
                      }))}
                    />
                  </div>

                  <div className="row-wrap" style={{ marginTop: 'var(--s-3)' }}>
                    {candidate.metrics.warnings.split(';').map((label) => {
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

                  <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
                    <Button
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'SET_DRAFT', codes: candidate.codes });
                        navigate('build');
                      }}
                    >
                      Open in the builder
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dispatch({ type: 'SELECT_CANDIDATE', index: candidate.index })}
                    >
                      {selected.index === candidate.index ? 'Selected' : 'Select'}
                    </Button>
                    <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      {isFavourite ? 'starred' : ''}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* ---------------- TABLE ---------------- */}
        <section className="section">
          <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
            <div>
              <h2 className="section-title">All {run.candidates.length} top candidates</h2>
          <Beginner>
            <p className="plain-note">
              Ranked by the objective, so row 1 is the best design the search found at the current
              priority. &ldquo;Margin&rdquo; is the gap between the PET score and whichever
              unwanted plastic scored highest &mdash; bigger is better, and negative means the
              design prefers the wrong plastic.
            </p>
          </Beginner>
          <Researcher>
            <p className="section-lede">
              Sorted client-side; the underlying values are the exact solver output. PE and PP
              columns and the lexicographic sequence index are shown in this mode. Objective =
              -PET + lambda(PE + PP) at lambda = {run.config.lambda}.
            </p>
          </Researcher>
              <p className="screen-purpose">
                Sort, search and select. Selecting a row updates the charts below.
              </p>
            </div>
            <div className="row-wrap">
              <label className="sr-only" htmlFor="candidate-filter">
                Search candidates by class name, residue letters or warning label
              </label>
              <input
                id="candidate-filter"
                type="search"
                placeholder="Search e.g. AROM_W or LSWW"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                style={{
                  minHeight: 'var(--touch-min)',
                  padding: '0 var(--s-3)',
                  borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-sunken)',
                  color: 'var(--text)',
                }}
              />
              <Button
                size="sm"
                aria-pressed={onlyFavourites}
                onClick={() => setOnlyFavourites((v) => !v)}
                disabled={state.favourites.length === 0}
                title={
                  state.favourites.length === 0
                    ? 'You have not starred any designs yet'
                    : undefined
                }
              >
                Starred only ({state.favourites.length})
              </Button>
            </div>
          </div>

          {candidates.length === 0 ? (
            <EmptyState
              title="Nothing matches that filter"
              body={`No candidate matches "${filter}"${onlyFavourites ? ' among your starred designs' : ''}. Clear the filter to see all ${run.candidates.length}.`}
              action={
                <Button
                  onClick={() => {
                    setFilter('');
                    setOnlyFavourites(false);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <Card style={{ padding: 0, marginTop: 'var(--s-4)' }}>
              <div className="scroll-x">
                <table className="table">
                  <caption className="sr-only">
                    Top candidate designs with their scores and selectivity margins
                  </caption>
                  <thead>
                    <tr>
                      {(
                        [
                          ['rank', 'Rank', false],
                          ['objective', 'Objective', true],
                          ['PET', 'PET', true],
                          ['worstOffTarget', 'Worst off-target', true],
                          ['marginWorst', 'Margin vs worst', true],
                        ] as const
                      ).map(([key, label, numeric]) => (
                        <th
                          key={key}
                          scope="col"
                          className={numeric ? 'num' : undefined}
                          aria-sort={sortKey === key ? 'ascending' : 'none'}
                        >
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ minHeight: 28, padding: '2px 6px' }}
                            onClick={() => setSortKey(key)}
                          >
                            {label}
                            {sortKey === key ? ' *' : ''}
                          </button>
                        </th>
                      ))}
                      {researcher ? (
                        <>
                          <th scope="col" className="num">
                            PE
                          </th>
                          <th scope="col" className="num">
                            PP
                          </th>
                        </>
                      ) : null}
                      <th scope="col">Design</th>
                      {researcher ? (
                        <th scope="col" className="num">
                          Index
                        </th>
                      ) : null}
                      <th scope="col">Notes</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr
                        key={candidate.index}
                        aria-selected={selected.index === candidate.index}
                      >
                        <td className="num">{candidate.rank}</td>
                        <td className="num">{candidate.objective.toFixed(2)}</td>
                        <td className="num" style={{ color: 'var(--c-pet)' }}>
                          {candidate.scores.PET.toFixed(2)}
                        </td>
                        <td className="num" style={{ color: 'var(--attention)' }}>
                          {candidate.metrics.worstOffTarget.toFixed(2)}
                        </td>
                        <td
                          className="num"
                          style={{
                            color:
                              candidate.metrics.marginWorst > 0
                                ? 'var(--success)'
                                : 'var(--danger)',
                          }}
                        >
                          {candidate.metrics.marginWorst.toFixed(2)}
                        </td>
                        {researcher ? (
                          <>
                            <td className="num" style={{ color: 'var(--c-pe)' }}>
                              {candidate.scores.PE.toFixed(3)}
                            </td>
                            <td className="num" style={{ color: 'var(--c-pp)' }}>
                              {candidate.scores.PP.toFixed(3)}
                            </td>
                          </>
                        ) : null}
                        <td>
                          <span className="row" style={{ gap: 'var(--s-2)' }}>
                            <SequenceGlyph codes={candidate.codes} size="sm" />
                            <code style={{ fontSize: 'var(--fs-xs)' }}>
                              {candidate.representative}
                            </code>
                          </span>
                        </td>
                        {researcher ? (
                          <td className="num faint">{candidate.index}</td>
                        ) : null}
                        <td>
                          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                            {candidate.metrics.warnings
                              .split(';')
                              .map((l) => CANDIDATE_LABEL_HELP[l]?.title ?? l)
                              .join(', ')}
                          </span>
                        </td>
                        <td>
                          <span className="row" style={{ gap: 4 }}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                dispatch({ type: 'SELECT_CANDIDATE', index: candidate.index })
                              }
                            >
                              Select
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                dispatch({ type: 'SET_DRAFT', codes: candidate.codes });
                                navigate('build');
                              }}
                            >
                              Edit
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </section>

        {/* ---------------- SWEEP ---------------- */}
        <section className="section">
          <h2 className="section-title">How the winner changes with the priority dial</h2>
          <PlainNote>
            As the dial rises, designs that also stick to the other two plastics get pushed down
            the ranking. Where the line steps, the best design has changed to a different one.
          </PlainNote>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Each point is solved exactly over all {formatInt(run.searchSpace.validSequences)}{' '}
            designs at that priority. Nothing here is interpolated.
          </p>
          <div className="grid-auto" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <LineChart
              title="Winning design's three scores, across priorities"
              subtitle="The best design at each priority, then its PET / PE / PP scores"
              xLabel="Selectivity Priority (lambda)"
              yLabel="Canonical binding score (dimensionless)"
              highlightX={state.lambda}
              series={PLASTIC_INFO.map((info) => ({
                id: info.id,
                label: `${info.id} score`,
                colour: `var(--c-${info.id.toLowerCase()})`,
                points: sweep.map((p) => ({ x: p.lambda, y: p.best.scores[info.id] })),
              }))}
              footer="Higher is better for PET; lower is better for PE and PP. As the priority rises the optimiser accepts a lower PET score in exchange for pushing PE and PP down."
            />
            <LineChart
              title="Selectivity margin, across priorities"
              subtitle="PET score minus the worst off-target score. Higher is better."
              xLabel="Selectivity Priority (lambda)"
              yLabel="Margin (dimensionless)"
              highlightX={state.lambda}
              series={[
                {
                  id: 'marginWorst',
                  label: 'Margin vs worst off-target',
                  colour: 'var(--success)',
                  points: sweep.map((p) => ({ x: p.lambda, y: p.best.metrics.marginWorst })),
                },
                {
                  id: 'marginMean',
                  label: 'Margin vs average off-target',
                  colour: 'var(--accent)',
                  dashed: true,
                  points: sweep.map((p) => ({ x: p.lambda, y: p.best.metrics.marginMean })),
                },
              ]}
              footer="Notice this is not simply increasing. Pushing the priority higher does not automatically buy more selectivity, because the objective rewards lowering PE and PP even when that also lowers PET."
            />
          </div>

          <Card style={{ marginTop: 'var(--s-4)', padding: 0 }}>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">
                  The exact winning design at each priority value
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Priority
                    </th>
                    <th scope="col">Winning design</th>
                    <th scope="col" className="num">
                      PET
                    </th>
                    <th scope="col" className="num">
                      PE
                    </th>
                    <th scope="col" className="num">
                      PP
                    </th>
                    <th scope="col" className="num">
                      Objective
                    </th>
                    <th scope="col" className="num">
                      Ties
                      <InfoTip
                        title="Ties"
                        body="How many designs reach exactly the same objective value, within the 1e-8 solver tolerance. More than one means the optimum is not unique."
                      />
                    </th>
                    <th scope="col" className="num">
                      Solve time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sweep.map((point) => (
                    <tr key={point.lambda}>
                      <td className="num">
                        {point.lambda}
                        {BENCHMARK_LAMBDAS.includes(
                          point.lambda as (typeof BENCHMARK_LAMBDAS)[number],
                        )
                          ? ''
                          : ' (yours)'}
                      </td>
                      <td>
                        <span className="row" style={{ gap: 'var(--s-2)' }}>
                          <SequenceGlyph codes={point.best.codes} size="sm" />
                          <code style={{ fontSize: 'var(--fs-xs)' }}>
                            {point.best.representative}
                          </code>
                        </span>
                      </td>
                      <td className="num">{point.best.scores.PET.toFixed(2)}</td>
                      <td className="num">{point.best.scores.PE.toFixed(2)}</td>
                      <td className="num">{point.best.scores.PP.toFixed(2)}</td>
                      <td className="num">{point.best.objective.toFixed(2)}</td>
                      <td className="num">{point.optimumHits}</td>
                      <td className="num">{formatMs(point.runtimeMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* ---------------- TRADE-OFF ---------------- */}
        <section className="section">
          <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-3)' }}>
            <div>
              <h2 className="section-title">The trade-off, drawn out</h2>
              <p className="screen-purpose">
                We want to be far right (high PET) and far down (low worst off-target). The
                shading counts how many designs land in each part of the space; the green
                staircase is the best that can be achieved.
              </p>
            </div>
            <Button onClick={() => send({ kind: 'pareto', lambda: state.lambda })}>
              {state.pareto ? 'Recompute' : 'Draw the trade-off chart'}
            </Button>
          </div>

          {state.pareto ? (
            <div style={{ marginTop: 'var(--s-4)' }}>
              <ScatterChart
                title="PET score against worst off-target score"
                subtitle={`All ${formatInt(state.pareto.evaluated)} designs, binned; the exact frontier is ${formatInt(state.pareto.frontier.length)} designs`}
                xLabel="PET score (higher is better)"
                yLabel="Worst off-target score (lower is better)"
                points={state.pareto.frontier.map((point) => ({
                  index: point.index,
                  x: point.pet,
                  y: point.worstOff,
                  onFrontier: point.onFrontier,
                }))}
                density={state.pareto.density}
                densityMax={state.pareto.maxCount}
                densityBinSize={state.pareto.binSize}
                densityLabel="designs per cell (log shading)"
                selectedIndex={selected.index}
                onSelect={(index) => dispatch({ type: 'SELECT_CANDIDATE', index })}
                footer={
                  <>
                    <ProvenanceBadge
                      kind="computed"
                      detail={`Every one of the ${formatInt(state.pareto.evaluated)} valid designs was used. The frontier is exact - not a frontier of a sample - and the shading is a real count per bin on a ${state.pareto.bins.x} by ${state.pareto.bins.y} grid. Computed in ${formatInt(state.pareto.computeMs)} ms.`}
                    />{' '}
                    Shading is a log scale because the counts span several orders of magnitude.
                    Scores are a selectivity proxy, not measured affinities.
                  </>
                }
              />
            </div>
          ) : (
            <EmptyState
              title="Trade-off chart not drawn yet"
              body="Plotting 1.68 million individual dots would be unreadable, so this bins every design into a density grid and computes the exact frontier over all of them. Press the button to compute it."
            />
          )}
        </section>

        {/* ---------------- SOLVERS ---------------- */}
        <section className="section">
          <h2 className="section-title">How the search methods compared</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            All of these were given the same objective and the same constraints. Brute force is
            the reference because it checked everything.
          </p>

          <Notice tone="honest" icon="!">
            <strong>Read the environment before comparing times.</strong>
            <p style={{ marginTop: 'var(--s-1)' }}>
              These runtimes were measured in your browser on this device (
              {run.environment.hardwareConcurrency || 'unknown'} logical cores
              {run.environment.deviceMemoryGb ? `, ~${run.environment.deviceMemoryGb} GB` : ''}).
              They are not comparable with the Python benchmark&rsquo;s times, or with another
              machine, or with published hardware results.
            </p>
          </Notice>

          <Card style={{ marginTop: 'var(--s-4)', padding: 0 }}>
            <div className="scroll-x">
              <table className="table">
                <caption className="sr-only">Solver comparison on the same objective</caption>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Best objective
                    </th>
                    <th scope="col" className="num">
                      Valid samples
                      <InfoTip
                        title="Valid samples"
                        body="Annealing works in raw binary space, so it can produce assignments where a position has zero or two blocks selected. Those are invalid and are discarded. This is the fraction that came back valid."
                      />
                    </th>
                    <th scope="col" className="num">
                      Hit the optimum
                    </th>
                    <th scope="col" className="num">
                      Runtime
                    </th>
                    <th scope="col" className="num">
                      Seed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {run.solvers.map((solver) => (
                    <tr key={solver.solver}>
                      <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>
                        <strong>{solver.solver}</strong>
                        {solver.exact ? (
                          <span
                            className="badge"
                            style={{
                              marginLeft: 6,
                              borderColor: 'var(--success)',
                              color: 'var(--success)',
                            }}
                          >
                            exact
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`badge badge-prov ${
                            solver.status === 'EXECUTED'
                              ? 'prov-computed'
                              : 'prov-unavailable'
                          }`}
                        >
                          {solver.status}
                        </span>
                      </td>
                      <td className="num">{formatScore(solver.bestObjective)}</td>
                      <td className="num">
                        {solver.validityRate === null
                          ? 'not available'
                          : `${(solver.validityRate * 100).toFixed(1)}%`}
                      </td>
                      <td className="num">
                        {solver.successRate === null
                          ? 'not available'
                          : `${(solver.successRate * 100).toFixed(1)}%`}
                      </td>
                      <td className="num">{formatMs(solver.runtimeMs)}</td>
                      <td className="num">{solver.seed ?? 'n/a'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid-auto" style={{ marginTop: 'var(--s-4)' }}>
            <BarChart
              title="Best objective reached"
              subtitle="Lower is better. Methods that did not run show as 'not run' rather than zero."
              yLabel="Best objective found"
              bars={run.solvers.map((s) => ({
                label: s.solver.split(' (')[0],
                value: s.bestObjective === null ? null : Math.abs(s.bestObjective),
                colour: s.exact ? 'var(--success)' : 'var(--optimise)',
                note: s.status === 'NOT EXECUTED' ? s.note : undefined,
              }))}
              valueFormatter={(v) => `-${v.toFixed(0)}`}
              footer="Absolute values are plotted because the objective is negative here; the label shows the real signed value."
            />
            <BarChart
              title="Measured runtime on this device"
              subtitle="Wall-clock inside the browser worker"
              yLabel="Runtime (milliseconds)"
              bars={run.solvers.map((s) => ({
                label: s.solver.split(' (')[0],
                value: s.runtimeMs,
                colour: s.exact ? 'var(--success)' : 'var(--optimise)',
                note: s.status === 'NOT EXECUTED' ? s.note : undefined,
              }))}
              valueFormatter={(v) => `${Math.round(v)}`}
            />
          </div>

          <div style={{ marginTop: 'var(--s-4)' }} className="stack-sm">
            {run.solvers.map((solver) => (
              <Disclosure key={solver.solver} summary={`About ${solver.solver}`}>
                <p>{solver.note}</p>
                {solver.medianBestEnergy !== null ? (
                  <p className="num" style={{ marginTop: 'var(--s-2)' }}>
                    median best energy per run {solver.medianBestEnergy.toFixed(2)}
                    {solver.stdBestEnergy !== null
                      ? `, standard deviation ${solver.stdBestEnergy.toFixed(2)}`
                      : ''}
                  </p>
                ) : null}
              </Disclosure>
            ))}
          </div>

          <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
            Every runtime here was measured on this device, in this browser. The quantum-annealer
            row is a formulation, not an execution; what that does and does not establish is set
            out in the scientific-validity assessment at the bottom of Results.
          </p>
        </section>

        {/* ---------------- SELECTED DETAIL ---------------- */}
        <section className="section">
          <header className="section-head">
            <h2 className="section-title" id="selected-detail">
              Selected design in detail
            </h2>
            <p className="section-lede">
              Composition, metrics and the molecule this class sequence stands for when each
              family is read as its documented representative.
            </p>
          </header>
          <div className="compare-detail">
            <Card>
              <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s-4)' }}>
                <div style={{ minWidth: 0 }}>
                  <SequenceGlyph codes={selected.codes} showResidues />
                  <p className="mono" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
                    {selected.classSequence}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    dispatch({ type: 'SET_DRAFT', codes: selected.codes });
                    navigate('build');
                  }}
                >
                  Open in the builder
                </Button>
              </div>

            <div className="scroll-x" style={{ marginTop: 'var(--s-4)' }}>
              <table className="table">
                <caption className="sr-only">
                  Position-by-position composition of the selected design
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Family</th>
                    <th scope="col">Property</th>
                    <th scope="col">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.codes.map((code, i) => {
                    const info = CLASS_INFO[code];
                    return (
                      <tr key={i}>
                        <td className="num">{i + 1}</td>
                        <td>
                          <span className="row" style={{ gap: 'var(--s-2)' }} data-class={info.id}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                background: 'var(--block-colour)',
                              }}
                            />
                            {info.name}
                          </span>
                        </td>
                        <td style={{ whiteSpace: 'normal' }}>{info.property}</td>
                        <td className="mono">{info.residues.join(' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
              The right-hand column lists every amino acid in each family. The optimiser chose the
              family, not the member.
            </p>

            <div className="grid-auto" style={{ marginTop: 'var(--s-4)' }}>
              {(
                [
                  ['marginMean', selected.metrics.marginMean],
                  ['marginWorst', selected.metrics.marginWorst],
                  ['meanOffTarget', selected.metrics.meanOffTarget],
                  ['worstOffTarget', selected.metrics.worstOffTarget],
                ] as const
              ).map(([key, value]) => {
                const help = METRIC_HELP[key];
                return (
                  <div className="stat" key={key}>
                    <div className="stat-label">
                      {help.label}
                      <InfoTip title={help.label} body={help.plain} />
                    </div>
                    <div className="stat-value">{value.toFixed(2)}</div>
                    <div className="stat-unit">
                      {help.unit} - {help.direction}
                    </div>
                  </div>
                );
              })}
              </div>
            </Card>

            <div>
              <MoleculeViewer
                residues={selectedResidues}
                variant="workbench"
                height={330}
                initialMode="2d"
                exportLabel={`qbindselect-rank${selected.rank}`}
              />
              <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
                One class sequence stands for {groupInt(residueDegeneracy(selected.codes))}{' '}
                distinct molecules. This is the one built from the documented representative of
                each family; choose other members in the builder. The optimiser ranked the family
                sequence, not this molecule.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
