/**
 * SCREEN 2 - Build & Explore. The design workbench.
 *
 * Two things are on screen at once and they are deliberately different kinds
 * of object:
 *
 *   LEFT   the eight-position CLASS sequence, which is what the optimiser
 *          searches and what every score on this page is computed from.
 *   RIGHT  a real MOLECULE, built from one concrete amino acid per position,
 *          drawn by RDKit in 2D and by 3Dmol.js in 3D.
 *
 * Changing a class re-scores the design. Changing which member of a class is
 * displayed rebuilds the molecule and changes no score at all - that is
 * enforced by the reducer, not by convention, and the page says so once.
 */

import { useCallback, useMemo, useState } from 'react';

import { useRouter } from '../app/router';
import { useDraftScoring } from '../app/hooks';
import { Beginner, Equation, PlainNote, Researcher, useMode } from '../app/mode';
import { LiveReadout } from '../components/LiveReadout';
import {
  Button,
  Card,
  Disclosure,
  InfoTip,
  LoadingState,
  Notice,
  ProvenanceBadge,
  ScreenHeader,
  Stat,
  formatInt,
  formatScore,
} from '../components/primitives';
import { ClassPalette, PeptideChain, SequenceGlyph } from '../components/PeptideChain';
import { ResiduePicker, ResidueSequenceReadout } from '../components/ResiduePicker';
import {
  CANDIDATE_LABEL_HELP,
  CHALLENGE,
  METRIC_HELP,
  SCREENS,
  describeScoreChange,
} from '../content/copy';
import { groupInt } from '../content/format';
import { buildPeptide, residueDegeneracy } from '../chem/peptide';
import { residueFor } from '../chem/residues';
import { CLASS_INFO, LENGTH, classSequence } from '../science/alphabet';
import { PLASTIC_INFO } from '../science/potts';
import { encodeShareState } from '../state/persistence';
import { REFERENCE_CODES, useStore } from '../state/store';
import { ContributionChart } from '../viz/ContributionChart';
import { MoleculeViewer } from '../viz/MoleculeViewer';
import { ScoreBars } from '../viz/charts';

export function BuildScreen(): JSX.Element {
  const { state, dispatch } = useStore();
  const { navigate } = useRouter();
  const { researcher } = useMode();
  useDraftScoring();

  const [armed, setArmed] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [challengeStart, setChallengeStart] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const score = state.draftScore;
  const previous = state.previousScore;
  const scoreMatchesDraft =
    score !== null && score.codes.join(',') === state.draftCodes.join(',');

  const comparison = state.baselineCodes ?? REFERENCE_CODES;
  const changedPositions = useMemo(
    () => state.draftCodes.map((c, i) => (c === comparison[i] ? -1 : i)).filter((i) => i >= 0),
    [state.draftCodes, comparison],
  );

  const peptide = useMemo(() => {
    try {
      return buildPeptide(state.draftResidues);
    } catch {
      return null;
    }
  }, [state.draftResidues]);

  const degeneracy = useMemo(
    () => residueDegeneracy(state.draftCodes),
    [state.draftCodes],
  );

  const onPlace = useCallback(
    (position: number, classIndex: number) => {
      dispatch({ type: 'SET_POSITION', position, classIndex });
    },
    [dispatch],
  );

  const onResidue = useCallback(
    (position: number, residue: string) => {
      dispatch({ type: 'SET_RESIDUE', position, residue });
    },
    [dispatch],
  );

  const shareUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}${window.location.pathname}${encodeShareState(
          state.draftCodes,
          state.lambda,
        )}`;

  const deltas =
    score && previous && scoreMatchesDraft
      ? {
          PET: score.scores.PET - previous.scores.PET,
          PE: score.scores.PE - previous.scores.PE,
          PP: score.scores.PP - previous.scores.PP,
          marginWorst: score.metrics.marginWorst - previous.metrics.marginWorst,
          objective: score.objective - previous.objective,
        }
      : null;

  const perPosition = scoreMatchesDraft
    ? {
        PET: score.contributions.PET.positions,
        PE: score.contributions.PE.positions,
        PP: score.contributions.PP.positions,
      }
    : null;

  return (
    <div className="screen">
      <div className="shell">
        <ScreenHeader
          eyebrow="Screen 2 of 6"
          title={SCREENS.build.title}
          purpose={SCREENS.build.purpose}
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => dispatch({ type: 'UNDO' })}
                disabled={state.history.length === 0}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </Button>
              <Button
                variant="ghost"
                onClick={() => dispatch({ type: 'REDO' })}
                disabled={state.future.length === 0}
                title="Redo (Ctrl+Shift+Z)"
              >
                Redo
              </Button>
              <Button onClick={() => dispatch({ type: 'RESET_DRAFT' })}>Reset</Button>
              <Button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(shareUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                  window.setTimeout(() => setCopied(false), 2200);
                }}
              >
                {copied ? 'Link copied' : 'Copy link'}
              </Button>
            </>
          }
        />

        {/* ================= WORKBENCH ================= */}
        <div className="workbench">
          {/* ---- Editor column ---- */}
          <div className="workbench-editor">
            {/* Sticky, and first in the column, so the effect of an edit is
                never off-screen while editing. The full tiles with units and
                provenance are still in "What the model says" below. */}
            <LiveReadout
              caption="Live scores for this design"
              pending={!scoreMatchesDraft}
              items={
                score
                  ? [
                      {
                        label: 'PET',
                        value: formatScore(score.scores.PET),
                        tone: 'pet' as const,
                        delta: deltas ? { value: deltas.PET, betterWhen: 'higher' as const } : null,
                      },
                      {
                        label: 'PE',
                        value: formatScore(score.scores.PE),
                        tone: 'pe' as const,
                        delta: deltas ? { value: deltas.PE, betterWhen: 'lower' as const } : null,
                      },
                      {
                        label: 'PP',
                        value: formatScore(score.scores.PP),
                        tone: 'pp' as const,
                        delta: deltas ? { value: deltas.PP, betterWhen: 'lower' as const } : null,
                      },
                      {
                        label: 'Margin vs worst',
                        value: formatScore(score.metrics.marginWorst),
                        tone: score.metrics.marginWorst > 0 ? ('good' as const) : ('warn' as const),
                        delta: deltas
                          ? { value: deltas.marginWorst, betterWhen: 'higher' as const }
                          : null,
                      },
                    ]
                  : [
                      { label: 'PET', value: '--' },
                      { label: 'PE', value: '--' },
                      { label: 'PP', value: '--' },
                      { label: 'Margin vs worst', value: '--' },
                    ]
              }
              note={
                challengeStart !== null && score && scoreMatchesDraft ? (
                  <span className="challenge-live">
                    <strong
                      style={{
                        color:
                          score.metrics.marginWorst > challengeStart
                            ? 'var(--success)'
                            : score.metrics.marginWorst < challengeStart
                              ? 'var(--attention)'
                              : 'var(--text-muted)',
                      }}
                    >
                      {score.metrics.marginWorst > challengeStart
                        ? 'Challenge: improved'
                        : score.metrics.marginWorst < challengeStart
                          ? 'Challenge: down so far'
                          : 'Challenge: no change yet'}
                    </strong>{' '}
                    {score.metrics.marginWorst === challengeStart
                      ? `Starting margin ${challengeStart.toFixed(2)}.`
                      : `${Math.abs(score.metrics.marginWorst - challengeStart).toFixed(2)} ${
                          score.metrics.marginWorst > challengeStart ? 'above' : 'below'
                        } your starting margin of ${challengeStart.toFixed(2)}.`}
                  </span>
                ) : state.status === 'error' ? (
                  <>Scoring is unavailable, so these values are switched off. Editing still works.</>
                ) : null
              }
            />

            <Card raised style={{ marginTop: 'var(--s-4)' }}>
              <div className="panel-head">
                <h2>Class sequence</h2>
                <p>
                  What the optimiser searches. Drag a family onto a position, tap a family then a
                  position, or focus a position and press <kbd>1</kbd>&ndash;<kbd>6</kbd>.
                </p>
              </div>

              <div style={{ padding: 'var(--s-3) 0' }}>
                <PeptideChain
                  codes={state.draftCodes}
                  onChange={onPlace}
                  changedPositions={changedPositions}
                  armedClass={armed}
                  onConsumeArmed={() => setArmed(null)}
                />
              </div>

              <PlainNote>
                Each of the eight boxes holds one <em>family</em> of amino acid, not one amino
                acid. The optimiser chooses families because that makes the whole space small
                enough to check completely.
              </PlainNote>

              <div className="panel-meta">
                <code>{classSequence(state.draftCodes)}</code>
                <span>
                  {changedPositions.length === 0
                    ? 'Identical to the reference design'
                    : `${changedPositions.length} of ${LENGTH} positions changed from the reference`}
                </span>
              </div>

              <div style={{ marginTop: 'var(--s-5)' }}>
                <h3 className="panel-subhead">
                  Building-block families
                  <span className="panel-subhead-note">
                    {armed === null
                      ? 'Select one, then choose a position'
                      : `${CLASS_INFO[armed].name} armed — now choose a position`}
                  </span>
                </h3>
                <ClassPalette armedClass={armed} onArm={setArmed} />
              </div>
            </Card>

            <Card style={{ marginTop: 'var(--s-4)' }}>
              <div className="panel-head">
                <h2>Residues shown in the structure</h2>
                <p>
                  A family is not one amino acid. Pick which member of each family the molecule on
                  the right is built from. This changes the chemistry drawn and{' '}
                  <strong>changes none of the scores</strong>, because the model only ever sees the
                  family.
                </p>
              </div>
              <ResiduePicker
                codes={state.draftCodes}
                residues={state.draftResidues}
                onChange={onResidue}
                focusPosition={focus}
                onFocusPosition={setFocus}
              />
              <div className="panel-meta" style={{ marginTop: 'var(--s-3)' }}>
                <ResidueSequenceReadout residues={state.draftResidues} />
                <span>
                  This class sequence stands for {groupInt(degeneracy)} distinct molecules
                  <InfoTip
                    title="Why more than one molecule?"
                    body="Each of the eight positions is a family of amino acids, so one class sequence corresponds to the product of the family sizes. The optimiser scores the family sequence; the structure needs one specific member per position."
                  />
                </span>
              </div>
            </Card>
          </div>

          {/* ---- Structure column ---- */}
          <div className="workbench-structure">
            <MoleculeViewer
              residues={state.draftResidues}
              variant="workbench"
              height={400}
              highlightResidue={focus === null ? null : focus + 1}
              exportLabel={`qbindselect-${state.draftResidues.join('')}`}
            />

            {peptide ? (
              <Card style={{ marginTop: 'var(--s-4)' }}>
                <h3 className="panel-subhead">Molecular properties</h3>
                <dl className="prop-grid">
                  <div>
                    <dt>Formula</dt>
                    <dd className="mono">{peptide.formula}</dd>
                  </div>
                  <div>
                    <dt>Average mass</dt>
                    <dd className="mono">{peptide.mass.average.toFixed(2)} g/mol</dd>
                  </div>
                  <div>
                    <dt>Monoisotopic</dt>
                    <dd className="mono">{peptide.mass.monoisotopic.toFixed(4)} Da</dd>
                  </div>
                  <div>
                    <dt>Heavy atoms</dt>
                    <dd className="mono">{peptide.heavyAtoms}</dd>
                  </div>
                  <div>
                    <dt>Rotatable bonds</dt>
                    <dd className="mono">{peptide.rotatableBonds}</dd>
                  </div>
                  <div>
                    <dt>Rings</dt>
                    <dd className="mono">{peptide.rings}</dd>
                  </div>
                  <div>
                    <dt>
                      Net charge
                      <InfoTip
                        title="Net charge at pH 7"
                        body="Counted from the termini and the charged side chains: a protonated N-terminal amine (+1), a deprotonated C-terminal carboxyl (-1), plus +1 per Lys or Arg and -1 per Asp or Glu. The structure file itself stores the neutral forms."
                      />
                    </dt>
                    <dd className="mono">
                      {peptide.netChargeAtPh7 > 0 ? '+' : ''}
                      {peptide.netChargeAtPh7}
                    </dd>
                  </div>
                  <div>
                    <dt>Valence check</dt>
                    <dd
                      className="mono"
                      style={{
                        color:
                          peptide.valenceProblems.length === 0
                            ? 'var(--success)'
                            : 'var(--danger)',
                      }}
                    >
                      {peptide.valenceProblems.length === 0
                        ? 'passed'
                        : `${peptide.valenceProblems.length} problems`}
                    </dd>
                  </div>
                </dl>
                <Researcher>
                  <Disclosure summary="Chemical identifiers for this molecule">
                    <dl className="identifier-list">
                      <div>
                        <dt>Isomeric SMILES</dt>
                        <dd className="mono">{peptide.smiles}</dd>
                      </div>
                      <div>
                        <dt>Sequence (N to C)</dt>
                        <dd className="mono">
                          {peptide.residues.map((r) => r.template.code3).join('-')}
                        </dd>
                      </div>
                      <div>
                        <dt>Bonds / peptide bonds</dt>
                        <dd className="mono">
                          {peptide.bondCount} / {peptide.peptideBonds}
                        </dd>
                      </div>
                      <div>
                        <dt>Monoisotopic mass</dt>
                        <dd className="mono">{peptide.mass.monoisotopic.toFixed(4)} Da</dd>
                      </div>
                    </dl>
                    <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                      The connection table is built from explicit per-residue templates and
                      checked for neutral covalent valence at every atom. The same molecules are
                      cross-checked against RDKit in the test suite.
                    </p>
                  </Disclosure>
                </Researcher>

                {/* The slot is always present and always the same height, so
                    hovering a position swaps its contents without moving
                    anything below it. This used to mount and unmount, which
                    resized the card and pushed the whole right column down on
                    every hover. */}
                <div className="residue-detail-slot">
                  {focus !== null ? (
                    <div className="residue-detail">
                      <h4>
                        Position {focus + 1} &middot;{' '}
                        {residueFor(state.draftResidues[focus]).name} (
                        {residueFor(state.draftResidues[focus]).code3})
                      </h4>
                      <p>{residueFor(state.draftResidues[focus]).note}</p>
                      <p className="mono">
                        Kyte-Doolittle hydropathy{' '}
                        {residueFor(state.draftResidues[focus]).hydropathy.toFixed(1)} &middot;{' '}
                        {residueFor(state.draftResidues[focus]).polarity} &middot; family{' '}
                        {CLASS_INFO[state.draftCodes[focus]].name}
                      </p>
                    </div>
                  ) : (
                    <p className="residue-detail-hint">
                      Hover or focus a position above to highlight that residue in both structure
                      views and read its chemistry.
                    </p>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>

        {/* ================= SCORES ================= */}
        <section className="section">
          <header className="section-head">
            <div className="spread" style={{ alignItems: 'baseline', gap: 'var(--s-3)' }}>
              <h2 className="section-title">What the model says about this design</h2>
              {/* One provenance marker for the whole section rather than one on
                  every statistic: the source is the same for all of them. */}
              <ProvenanceBadge kind="computed" />
            </div>
            <p className="section-lede">
              Recomputed exactly on every class edit, from the published scoring model, in this
              browser.
            </p>
            <PlainNote>
              Three numbers, one per plastic. They are model scores on an arbitrary scale, so a
              single value means little on its own &mdash; what matters is the gap between the
              PET score and the other two, which is the last tile below.
            </PlainNote>
            <Equation label="The quantity the optimiser minimises, at the Selectivity Priority currently set.">
{`objective(c) = -PET(c) + lambda * ( PE(c) + PP(c) )

PET(c) = intercept + sum_i  h_PET[i, c_i]  +  sum_{i<j}  J_PET[i, j, c_i, c_j]
                     (8 one-body terms)        (28 two-body terms)`}
            </Equation>
          </header>

          {!scoreMatchesDraft ? (
            state.status === 'error' ? (
              <Notice tone="honest" icon="!">
                <strong>Scoring is unavailable, so these panels are switched off.</strong>
                <p style={{ marginTop: 'var(--s-1)' }}>
                  {state.error?.message ?? 'The scoring model could not be loaded in this browser.'}{' '}
                  Editing, the structure views and the exports all still work.
                </p>
              </Notice>
            ) : (
              <LoadingState
                title="Scoring your design"
                body="Evaluating 8 single-position terms and 28 pair terms for each of the three plastics."
                fraction={null}
              />
            )
          ) : (
            <>
              <div className="grid-auto">
                <Stat
                  label={METRIC_HELP.petScore.label}
                  value={formatScore(score.scores.PET)}
                  unit={METRIC_HELP.petScore.unit}
                  direction={METRIC_HELP.petScore.direction}
                  help={METRIC_HELP.petScore.plain}
                  tone="pet"
                  delta={deltas ? { value: deltas.PET, betterWhen: 'higher' } : null}
                />
                <Stat
                  label={METRIC_HELP.peScore.label}
                  value={formatScore(score.scores.PE)}
                  unit={METRIC_HELP.peScore.unit}
                  direction={METRIC_HELP.peScore.direction}
                  help={METRIC_HELP.peScore.plain}
                  tone="pe"
                  delta={deltas ? { value: deltas.PE, betterWhen: 'lower' } : null}
                />
                <Stat
                  label={METRIC_HELP.ppScore.label}
                  value={formatScore(score.scores.PP)}
                  unit={METRIC_HELP.ppScore.unit}
                  direction={METRIC_HELP.ppScore.direction}
                  help={METRIC_HELP.ppScore.plain}
                  tone="pp"
                  delta={deltas ? { value: deltas.PP, betterWhen: 'lower' } : null}
                />
                <Stat
                  label={METRIC_HELP.marginWorst.label}
                  value={formatScore(score.metrics.marginWorst)}
                  unit={METRIC_HELP.marginWorst.unit}
                  direction={METRIC_HELP.marginWorst.direction}
                  help={METRIC_HELP.marginWorst.plain}
                  tone={score.metrics.marginWorst > 0 ? 'good' : 'warn'}
                  delta={deltas ? { value: deltas.marginWorst, betterWhen: 'higher' } : null}
                />
              </div>

              <div className="score-row">
                <Card>
                  <ScoreBars
                    rows={PLASTIC_INFO.map((info) => ({
                      label: `${info.id} (${info.everyday.toLowerCase()})`,
                      value: score.scores[info.id],
                      colour: `var(--c-${info.id.toLowerCase()})`,
                      direction:
                        info.role === 'target' ? ('higher' as const) : ('lower' as const),
                    }))}
                  />
                </Card>
                <Card>
                  {deltas ? (
                    <>
                      <h3 className="panel-subhead">What your last edit did</h3>
                      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                        {describeScoreChange(
                          deltas.PET,
                          deltas.PE,
                          deltas.PP,
                          deltas.marginWorst,
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <h3 className="panel-subhead">Before and after</h3>
                      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                        Change a family above and a plain-language comparison of the two scored
                        states appears here.
                      </p>
                    </>
                  )}
                  <div className="row-wrap" style={{ marginTop: 'var(--s-3)' }}>
                    {score.metrics.warnings.split(';').map((label) => {
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
                    {score.rankInSpace !== null ? (
                      <span className="badge">
                        Rank {formatInt(score.rankInSpace)} of 1,679,616
                        <InfoTip
                          title={METRIC_HELP.rankInSpace.label}
                          body={METRIC_HELP.rankInSpace.plain}
                        />
                      </span>
                    ) : (
                      <span className="badge prov-unavailable badge-prov">
                        Rank unknown until a full run has been done
                      </span>
                    )}
                  </div>
                </Card>
              </div>

              <div style={{ marginTop: 'var(--s-4)' }}>
                <Disclosure
                  summary="Advanced: where each number comes from"
                  defaultOpen={researcher}
                >
                  <div className="stack-sm">
                    <p>
                      The objective at the current Selectivity Priority (&lambda; = {state.lambda})
                      is built from the three scores:
                    </p>
                    <pre
                      className="mono scroll-x"
                      style={{
                        background: 'var(--surface-sunken)',
                        padding: 'var(--s-3)',
                        borderRadius: 'var(--r-sm)',
                        fontSize: 'var(--fs-xs)',
                      }}
                    >
{`objective = -(PET) + lambda * (PE + PP)
          = -(${score.scores.PET.toFixed(6)}) + ${state.lambda} * (${score.scores.PE.toFixed(6)} + ${score.scores.PP.toFixed(6)})
          = ${score.objectiveParts.targetTerm.toFixed(6)} + ${score.objectiveParts.penaltyTerm.toFixed(6)}
          = ${score.objective.toFixed(6)}`}
                    </pre>
                    <p className="faint">
                      Each plastic score is the sum of 8 single-position terms and 28 pair terms.
                      For PET those contribute {score.contributions.PET.linearTotal.toFixed(3)} and{' '}
                      {score.contributions.PET.pairTotal.toFixed(3)} respectively. The pair terms
                      are what make this a genuinely quadratic optimisation problem rather than a
                      per-position lookup.
                    </p>
                  </div>
                </Disclosure>
              </div>
            </>
          )}
        </section>

        {/* ================= PER-POSITION CONTRIBUTIONS ================= */}
        <section className="section">
          <header className="section-head">
            <h2 className="section-title">Which position is doing the work</h2>
            <p className="section-lede">
              The one-body term each position contributes to each plastic. Select a bar group to
              highlight that residue in the structure views above.
            </p>
            <Beginner>
              <p className="plain-note">
                Tall teal bars are good: that position is helping the design prefer PET. Where an
                amber or violet bar is taller than the teal one, that position is working against
                you.
              </p>
            </Beginner>
            <Researcher>
              <p className="section-lede">
                These are the diagonal <code>h[i, c_i]</code> terms only. The 28{' '}
                <code>J[i, j, c_i, c_j]</code> pair terms are not decomposable per position and
                are summarised in the totals under &ldquo;where each number comes from&rdquo;
                above; the full coefficient matrix is on the Understand screen.
              </p>
            </Researcher>
          </header>
          <Card>
            {perPosition ? (
              <ContributionChart
                codes={state.draftCodes}
                perPosition={perPosition}
                residues={state.draftResidues.map((code) => residueFor(code))}
                focusPosition={focus}
                onFocusPosition={setFocus}
              />
            ) : (
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                The per-position breakdown appears once the design has been scored.
              </p>
            )}
          </Card>
        </section>

        {/* ================= A/B SLOTS ================= */}
        <section className="section">
          <header className="section-head">
            <h2 className="section-title">Park two designs and compare them</h2>
            <p className="section-lede">
              Both slots stay scored at the same Selectivity Priority, so the comparison is fair.
              For a full ranked comparison across a finished run, use{' '}
              <button type="button" className="link-button" onClick={() => navigate('compare')}>
                Compare
              </button>
              .
            </p>
          </header>
          <div className="grid-auto">
            {(['A', 'B'] as const).map((slot) => {
              const codes = slot === 'A' ? state.compareA : state.compareB;
              return (
                <Card key={slot}>
                  <div className="spread" style={{ marginBottom: 'var(--s-3)' }}>
                    <h3 className="panel-subhead" style={{ margin: 0 }}>
                      Slot {slot}
                    </h3>
                    <div className="row" style={{ gap: 'var(--s-2)' }}>
                      <Button
                        size="sm"
                        onClick={() =>
                          dispatch({ type: 'SET_COMPARE', slot, codes: state.draftCodes })
                        }
                      >
                        Store current
                      </Button>
                      {codes ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dispatch({ type: 'SET_DRAFT', codes })}
                          >
                            Load
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => dispatch({ type: 'SET_COMPARE', slot, codes: null })}
                            aria-label={`Clear slot ${slot}`}
                          >
                            Clear
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {codes ? (
                    <div className="stack-sm">
                      <SequenceGlyph codes={codes} showResidues />
                      <code style={{ fontSize: 'var(--fs-xs)', overflowWrap: 'anywhere' }}>
                        {classSequence(codes)}
                      </code>
                      {codes.join(',') === state.draftCodes.join(',') ? (
                        <span
                          className="badge"
                          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                        >
                          This is your current design
                        </span>
                      ) : (
                        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                          {codes.filter((c, i) => c !== state.draftCodes[i]).length} positions
                          differ from your current design. Load it to see its scores.
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                      Empty. Store the current design here to start a comparison.
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </section>

        {/* ================= CHALLENGE ================= */}
        <section className="section">
          <Card>
            <div className="spread" style={{ alignItems: 'flex-start', gap: 'var(--s-5)' }}>
              <div style={{ maxWidth: '62ch' }}>
                <p className="eyebrow" style={{ color: 'var(--optimise)' }}>
                  Guided challenge
                </p>
                <h2 style={{ fontSize: 'var(--fs-lg)', marginBlock: 'var(--s-2)' }}>
                  {CHALLENGE.title}
                </h2>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  {CHALLENGE.brief}
                </p>
                {challengeStart !== null ? (
                  <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
                    Running from a starting margin of {challengeStart.toFixed(2)}. Your progress
                    is in the live scores beside the builder, so you can see it while you edit.
                  </p>
                ) : null}
                <Disclosure summary="Need a hint?">
                  <p>{CHALLENGE.hint}</p>
                </Disclosure>
              </div>
              <div className="stack-sm" style={{ flex: 'none' }}>
                <Button
                  variant="primary"
                  disabled={!scoreMatchesDraft}
                  onClick={() => setChallengeStart(score ? score.metrics.marginWorst : null)}
                >
                  {challengeStart === null ? 'Start the challenge' : 'Restart from here'}
                </Button>
                {challengeStart !== null ? (
                  <Button variant="ghost" onClick={() => setChallengeStart(null)}>
                    End challenge
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        </section>

        {/* ================= NEXT ================= */}
        <section className="section">
          <Card>
            <div className="spread" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              <div style={{ maxWidth: '60ch' }}>
                <h2 style={{ fontSize: 'var(--fs-lg)' }}>Let the optimiser try</h2>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)' }}>
                  Set the Selectivity Priority and run the exhaustive search over all{' '}
                  {groupInt(6 ** 8)} class sequences.
                </p>
              </div>
              <div className="row-wrap">
                <Button variant="ghost" onClick={() => navigate('discover')}>
                  Back
                </Button>
                <Button variant="primary" onClick={() => navigate('optimise')}>
                  Go to Optimise
                </Button>
              </div>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
