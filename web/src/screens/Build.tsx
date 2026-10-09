/**
 * SCREEN B - Build & Explore.
 *
 * The flagship interaction. Every edit calls the real scorer and the before/after
 * comparison is computed from two real scored states, never estimated.
 *
 * If the worker cannot score (model still loading, or a worker failure), only
 * the score-dependent panels are disabled and they say why. The builder itself
 * keeps working, because editing a sequence does not require the model.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useRouter } from '../app/router';
import { useDraftScoring, useReducedMotion } from '../app/hooks';
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
  formatScore,
  formatInt,
} from '../components/primitives';
import { ClassPalette, PeptideChain, SequenceGlyph } from '../components/PeptideChain';
import {
  CANDIDATE_LABEL_HELP,
  CHALLENGE,
  HONESTY,
  METRIC_HELP,
  SCREENS,
  describeScoreChange,
} from '../content/copy';
import { CLASS_INFO, LENGTH, classSequence } from '../science/alphabet';
import { PLASTIC_INFO, type Plastic } from '../science/potts';
import { REFERENCE_CODES, useStore } from '../state/store';
import { encodeShareState } from '../state/persistence';
import { BindingConcept } from '../viz/BindingConcept';
import { ScoreBars } from '../viz/charts';
import { groupInt } from '../content/format';

export function BuildScreen(): JSX.Element {
  const { state, dispatch } = useStore();
  const { navigate } = useRouter();
  const reducedMotion = useReducedMotion();
  useDraftScoring();

  const [armed, setArmed] = useState<number | null>(null);
  const [surface, setSurface] = useState<Plastic>('PET');
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

  const onPlace = useCallback(
    (position: number, classIndex: number) => {
      dispatch({ type: 'SET_POSITION', position, classIndex });
    },
    [dispatch],
  );

  // Reset-to-reference, undo/redo and challenge tracking all operate on real
  // scored values, so the challenge cannot be "won" by a rounding artefact.
  useEffect(() => {
    if (challengeStart === null && scoreMatchesDraft && score) {
      // nothing to do; the challenge is armed explicitly by the user
    }
  }, [challengeStart, scoreMatchesDraft, score]);

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
              <Button onClick={() => dispatch({ type: 'RESET_DRAFT' })}>
                Reset to reference design
              </Button>
              <Button
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(shareUrl)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                  window.setTimeout(() => setCopied(false), 2200);
                }}
              >
                {copied ? 'Link copied' : 'Copy a link to this design'}
              </Button>
            </>
          }
        />

        {/* ---------------- BUILDER ---------------- */}
        <Card raised>
          <div className="spread" style={{ alignItems: 'flex-start', marginBottom: 'var(--s-4)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--fs-lg)' }}>Your design</h2>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-1)' }}>
                Eight positions. Drag a family from below, or tap a family then a position, or
                focus a position and press <kbd>1</kbd>&ndash;<kbd>6</kbd>.
              </p>
            </div>
            <ProvenanceBadge kind="computed" />
          </div>

          <div style={{ padding: 'var(--s-4) 0' }}>
            <PeptideChain
              codes={state.draftCodes}
              onChange={onPlace}
              changedPositions={changedPositions}
              armedClass={armed}
              onConsumeArmed={() => setArmed(null)}
            />
          </div>

          <div
            className="row-wrap"
            style={{ justifyContent: 'space-between', marginTop: 'var(--s-3)' }}
          >
            <code
              style={{
                fontSize: 'var(--fs-xs)',
                background: 'var(--surface-sunken)',
                padding: '4px 8px',
                borderRadius: 'var(--r-sm)',
                overflowWrap: 'anywhere',
              }}
            >
              {classSequence(state.draftCodes)}
            </code>
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
              {changedPositions.length === 0
                ? 'Identical to the reference design'
                : `${changedPositions.length} of ${LENGTH} positions changed from the reference`}
            </span>
          </div>

          <div style={{ marginTop: 'var(--s-5)' }}>
            <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--s-1)' }}>
              Building-block families
            </h3>
            <p
              className="muted"
              style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-3)' }}
            >
              {armed === null
                ? 'Select a family to arm it, then tap a position. Or drag it straight onto a position.'
                : `${CLASS_INFO[armed].name} is armed. Now tap a position to place it.`}
            </p>
            <ClassPalette armedClass={armed} onArm={setArmed} />
          </div>
        </Card>

        {/* ---------------- SCORES ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">What the model says about this design</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Recomputed exactly on every edit, from the published scoring model.
          </p>

          {!scoreMatchesDraft ? (
            state.status === 'error' ? (
              <Notice tone="honest" icon="!">
                <strong>Scoring is unavailable, so these panels are switched off.</strong>
                <p style={{ marginTop: 'var(--s-1)' }}>
                  {state.error?.message ??
                    'The scoring model could not be loaded in this browser.'}{' '}
                  You can still build and share designs; the numbers will fill in if scoring
                  recovers.
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
                  provenance="computed"
                />
                <Stat
                  label={METRIC_HELP.peScore.label}
                  value={formatScore(score.scores.PE)}
                  unit={METRIC_HELP.peScore.unit}
                  direction={METRIC_HELP.peScore.direction}
                  help={METRIC_HELP.peScore.plain}
                  tone="pe"
                  delta={deltas ? { value: deltas.PE, betterWhen: 'lower' } : null}
                  provenance="computed"
                />
                <Stat
                  label={METRIC_HELP.ppScore.label}
                  value={formatScore(score.scores.PP)}
                  unit={METRIC_HELP.ppScore.unit}
                  direction={METRIC_HELP.ppScore.direction}
                  help={METRIC_HELP.ppScore.plain}
                  tone="pp"
                  delta={deltas ? { value: deltas.PP, betterWhen: 'lower' } : null}
                  provenance="computed"
                />
                <Stat
                  label={METRIC_HELP.marginWorst.label}
                  value={formatScore(score.metrics.marginWorst)}
                  unit={METRIC_HELP.marginWorst.unit}
                  direction={METRIC_HELP.marginWorst.direction}
                  help={METRIC_HELP.marginWorst.plain}
                  tone={score.metrics.marginWorst > 0 ? 'good' : 'warn'}
                  delta={deltas ? { value: deltas.marginWorst, betterWhen: 'higher' } : null}
                  provenance="computed"
                />
              </div>

              <Card style={{ marginTop: 'var(--s-4)' }}>
                <ScoreBars
                  rows={PLASTIC_INFO.map((info) => ({
                    label: `${info.id} (${info.everyday.toLowerCase()})`,
                    value: score.scores[info.id],
                    colour: `var(--c-${info.id.toLowerCase()})`,
                    direction: info.role === 'target' ? ('higher' as const) : ('lower' as const),
                  }))}
                />
              </Card>

              {deltas ? (
                <Notice
                  tone={deltas.marginWorst > 0 ? 'good' : deltas.marginWorst < 0 ? 'honest' : 'plain'}
                  icon={deltas.marginWorst > 0 ? '+' : deltas.marginWorst < 0 ? '-' : '='}
                >
                  <strong>What your last edit did.</strong>
                  <p style={{ marginTop: 'var(--s-1)' }}>
                    {describeScoreChange(
                      deltas.PET,
                      deltas.PE,
                      deltas.PP,
                      deltas.marginWorst,
                    )}
                  </p>
                </Notice>
              ) : (
                <Notice>
                  Make an edit and a plain-language before/after explanation appears here.
                </Notice>
              )}

              {/* Composition warnings */}
              <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
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

              {/* Researcher detail */}
              <div style={{ marginTop: 'var(--s-4)' }}>
                <Disclosure summary="Advanced: where each number comes from">
                  <div className="stack-sm">
                    <p>
                      The objective at the current Selectivity Priority (&lambda; ={' '}
                      {state.lambda}) is built from the three scores:
                    </p>
                    <pre
                      className="mono scroll-x"
                      style={{
                        background: 'var(--surface)',
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
                      For PET those contribute {score.contributions.PET.linearTotal.toFixed(3)}{' '}
                      and {score.contributions.PET.pairTotal.toFixed(3)} respectively. The pair
                      terms are what make this a genuinely quadratic optimisation problem rather
                      than a per-position lookup.
                    </p>
                  </div>
                </Disclosure>
              </div>
            </>
          )}
        </section>

        {/* ---------------- CHALLENGE ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <Card
            style={{
              borderColor: 'var(--optimise)',
              background:
                'linear-gradient(135deg, color-mix(in srgb, var(--optimise) 8%, var(--surface)), var(--surface))',
            }}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
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
                {challengeStart !== null && score && scoreMatchesDraft ? (
                  <Notice
                    tone={score.metrics.marginWorst > challengeStart ? 'good' : 'plain'}
                  >
                    {score.metrics.marginWorst > challengeStart ? (
                      <>
                        <strong>Improved.</strong> Your margin against the worst off-target is
                        up {(score.metrics.marginWorst - challengeStart).toFixed(2)} from where
                        you started the challenge.
                      </>
                    ) : score.metrics.marginWorst < challengeStart ? (
                      <>
                        <strong>Down so far.</strong> The margin is{' '}
                        {(challengeStart - score.metrics.marginWorst).toFixed(2)} lower than your
                        starting point. Try swapping a greasy block for a flat-ring one.
                      </>
                    ) : (
                      <>No change yet from your starting margin of {challengeStart.toFixed(2)}.</>
                    )}
                  </Notice>
                ) : null}
              </div>
              <div className="stack-sm" style={{ flex: 'none' }}>
                <Button
                  variant="primary"
                  disabled={!scoreMatchesDraft}
                  onClick={() =>
                    setChallengeStart(score ? score.metrics.marginWorst : null)
                  }
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
            <Disclosure summary="Need a hint?">
              <p>{CHALLENGE.hint}</p>
            </Disclosure>
          </Card>
        </section>

        {/* ---------------- COMPARE A/B ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">Compare two designs side by side</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Park the current design in a slot, change it, then park the new one. Both slots stay
            scored at the same priority setting, so the comparison is fair.
          </p>
          <div className="grid-auto">
            {(['A', 'B'] as const).map((slot) => {
              const codes = slot === 'A' ? state.compareA : state.compareB;
              return (
                <Card key={slot}>
                  <div className="spread" style={{ marginBottom: 'var(--s-3)' }}>
                    <h3 style={{ fontSize: 'var(--fs-md)' }}>Slot {slot}</h3>
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
                        <span className="badge" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
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

        {/* ---------------- BINDING CONCEPT ---------------- */}
        <section style={{ marginTop: 'var(--s-6)' }}>
          <h2 className="section-title">How this design meets each surface</h2>
          <p className="screen-purpose" style={{ marginBottom: 'var(--s-4)' }}>
            Switch surfaces to see which positions the model prefers for which plastic.
          </p>
          <Card>
            <div className="row-wrap" style={{ marginBottom: 'var(--s-4)' }}>
              {PLASTIC_INFO.map((info) => (
                <Button
                  key={info.id}
                  size="sm"
                  variant={surface === info.id ? 'primary' : 'secondary'}
                  onClick={() => setSurface(info.id)}
                  aria-pressed={surface === info.id}
                >
                  {info.id} &mdash; {info.everyday.toLowerCase()}
                </Button>
              ))}
            </div>
            <BindingConcept
              codes={state.draftCodes}
              perPosition={
                scoreMatchesDraft
                  ? {
                      PET: score.contributions.PET.positions,
                      PE: score.contributions.PE.positions,
                      PP: score.contributions.PP.positions,
                    }
                  : null
              }
              surface={surface}
              reducedMotion={reducedMotion}
            />
          </Card>
        </section>

        {/* ---------------- NEXT ---------------- */}
        <section style={{ marginTop: 'var(--s-7)' }}>
          <Card>
            <div className="spread" style={{ gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontSize: 'var(--fs-lg)' }}>Ready to let the optimiser try?</h2>
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-1)' }}>
                  Set the Selectivity Priority and run the real search over all{' '}
                  {groupInt(6 ** 8)} designs.
                </p>
              </div>
              <div className="row-wrap">
                <Button variant="ghost" onClick={() => navigate('discover')}>
                  Back to the start
                </Button>
                <Button variant="primary" onClick={() => navigate('optimise')}>
                  Go to Optimise
                </Button>
              </div>
            </div>
          </Card>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-4)' }}>
            {HONESTY.proxyScore}
          </p>
        </section>
      </div>
    </div>
  );
}
