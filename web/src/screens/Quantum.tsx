/**
 * The Quantum screen: run a real variational quantum circuit, live, and judge it.
 *
 * This screen exists because "what is actually quantum here?" is the first
 * question a technical evaluator asks, and the only satisfying answer is one
 * they can press a button on. So the circuit below is genuinely executed - by
 * exact statevector simulation, in this tab, on the real Potts coefficients -
 * and every number shown is produced by that run, scored against a brute-force
 * optimum computed over the identical design space.
 *
 * The three things the screen must get across, in order:
 *
 *   1. There IS a real quantum algorithm here: the Quantum Alternating
 *      Operator Ansatz, with XY mixers that enforce the one-hot constraint by
 *      construction. Its circuit, qubit map and gate cost are all derived from
 *      the coefficients, not drawn by hand.
 *   2. It is SIMULATED, not executed on hardware, and no speedup is claimed.
 *      Brute force wins on this problem and is the reference, not the rival.
 *   3. The interesting result is a COMPARISON: the penalty-QUBO encoding an
 *      annealer needs performs barely better than random guessing on this
 *      objective, and the constraint-preserving ansatz does far better. That
 *      is a finding about method, and it is measured here rather than asserted.
 */

import { useCallback, useMemo, useState } from 'react';

import { Beginner, Equation, ModeSplit, Researcher, useMode } from '../app/mode';
import { usePottsModel } from '../app/hooks';
import {
  Button,
  Card,
  Disclosure,
  ErrorState,
  InfoTip,
  LoadingState,
  Notice,
  ProvenanceBadge,
  ScreenHeader,
  Segmented,
  Stat,
  StatGroup,
  formatInt,
  formatScore,
} from '../components/primitives';
import { SCREENS } from '../content/copy';
import { QUANTUM_BENCHMARK } from '../generated/quantumBenchmark';
import { groupInt } from '../content/format';
import {
  ALPHABET_SIZE,
  CLASS_INFO,
  LENGTH,
  REPRESENTATIVES,
  classSequence,
  representativeSequence,
} from '../science/alphabet';
import {
  buildXyProblem,
  circuitCost,
  optimiseXyQaoa,
  type XyQaoaResult,
} from '../science/qaoa';
import { useStore } from '../state/store';

/** Nominal circuit width if every position were free: 8 x 6 = 48 qubits. */
const FULL_QUBITS = LENGTH * ALPHABET_SIZE;

/**
 * How many positions the live circuit may vary.
 *
 * Each free position costs 6 qubits and multiplies the simulated dimension by
 * 6. Four positions is 24 qubits over a 1,296-state subspace, which optimises
 * in a few milliseconds; six positions is 36 qubits over 46,656 states and
 * takes roughly a second. Eight is the full problem - 48 qubits, 1,679,616
 * states - which is left to the offline benchmark because it needs minutes,
 * not because it needs different physics.
 */
const WIDTH_CHOICES = [
  { value: '2', label: '2 free' },
  { value: '3', label: '3 free' },
  { value: '4', label: '4 free' },
  { value: '5', label: '5 free' },
] as const;

const DEPTH_CHOICES = [
  { value: '1', label: 'p = 1' },
  { value: '2', label: 'p = 2' },
  { value: '3', label: 'p = 3' },
  { value: '4', label: 'p = 4' },
] as const;

/**
 * Which positions the live circuit varies, for a given width.
 *
 * Fixed per width rather than chosen by the user: the point of the screen is
 * the circuit, and letting the slice wander would make successive runs
 * incomparable. The order below puts the positions that matter most first -
 * positions 1, 3 and 8 carry the largest one-body coefficient spread in the
 * real model, so a narrow slice stays a genuinely hard sub-problem rather than
 * a flat one that flatters the optimiser.
 */
const SLICE_PRIORITY = [0, 2, 7, 5, 6, 1, 3, 4] as const;

function freePositionsFor(width: number): number[] {
  return [...SLICE_PRIORITY.slice(0, width)].sort((a, b) => a - b);
}

interface LiveRun {
  readonly result: XyQaoaResult;
  readonly freePositions: readonly number[];
  readonly depth: number;
  readonly lambda: number;
  readonly contextCodes: readonly number[];
}

export function QuantumScreen(): JSX.Element {
  const { state } = useStore();
  const { researcher } = useMode();
  const { model, error, loading } = usePottsModel();

  const [width, setWidth] = useState('4');
  const [depth, setDepth] = useState('2');
  const [run, setRun] = useState<LiveRun | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const freePositions = useMemo(() => freePositionsFor(Number(width)), [width]);
  const dimension = ALPHABET_SIZE ** Number(width);
  const nominalQubits = Number(width) * ALPHABET_SIZE;

  // The clamped context is the user's current design, so the slice is a window
  // onto the peptide they have been working with rather than an abstract one.
  const contextCodes = state.draftCodes;
  const lambda = state.lambda;

  const execute = useCallback(() => {
    if (!model) return;
    setRunning(true);
    setRunError(null);
    // Yield once so the button's pressed state paints before a synchronous
    // optimisation blocks the main thread. The widest live slice is ~1s.
    window.requestAnimationFrame(() => {
      try {
        const problem = buildXyProblem(model.flat, {
          lambda,
          fixedCodes: contextCodes,
          freePositions,
        });
        const result = optimiseXyQaoa(problem, {
          depth: Number(depth),
          restarts: 2,
          maxIterations: 150,
          seed: 42,
        });
        setRun({
          result,
          freePositions,
          depth: Number(depth),
          lambda,
          contextCodes: [...contextCodes],
        });
      } catch (cause) {
        setRunError(
          cause instanceof Error ? cause.message : 'the quantum simulation failed to run',
        );
      } finally {
        setRunning(false);
      }
    });
  }, [model, lambda, contextCodes, freePositions, depth]);

  const cost = useMemo(() => {
    const slots = Number(width);
    const slotPairs = (slots * (slots - 1)) / 2;
    return circuitCost(slots, Number(depth), { coupledPairs: slotPairs * 36 });
  }, [width, depth]);

  return (
    <section className="shell stack-lg" style={{ paddingBlock: 'var(--s-7)' }}>
      <ScreenHeader
        eyebrow="Quantum method"
        title={SCREENS.quantum.title}
        purpose={SCREENS.quantum.purpose}
      />

      <Notice tone="honest" icon="!">
        <strong>Simulated, not executed on a quantum computer.</strong>
        <p style={{ marginTop: 'var(--s-1)' }}>
          The circuit below is a real variational quantum algorithm, and it really runs &mdash; by
          exact statevector simulation on your CPU. No quantum processor is contacted anywhere in
          this project. <strong>No quantum speedup is claimed or shown:</strong> on a problem this
          size, checking every design classically is faster and returns a <em>proven</em> optimum,
          which is exactly what the quantum result is scored against below.
        </p>
      </Notice>

      {/* ------------------------------------------------ what is quantum */}
      <Card>
        <h2 className="section-title">What is quantum here, precisely</h2>
        <p className="answer-lead">
          One qubit per switch. Each of the eight positions has six possible building-block
          families, so a full circuit needs {LENGTH} &times; {ALPHABET_SIZE} = {FULL_QUBITS}{' '}
          qubits, and qubit <em>u</em> being 1 means &ldquo;this position takes that family&rdquo;.
          The algorithm is the <strong>Quantum Alternating Operator Ansatz</strong> &mdash; QAOA
          with a mixer chosen so the circuit can only ever produce valid designs.
        </p>

        <ModeSplit
          beginner={
            <p className="plain-note">
              Think of it as {FULL_QUBITS} coins that can be in a blur of heads and tails at once.
              The circuit nudges the blur, in a pattern we tune, until the designs we want are the
              ones most likely to come up when we finally look. Then we look, and check the answer
              against the brute-force search that already knows the true best design.
            </p>
          }
          researcher={
            <Equation label="The ansatz. Angles are optimised classically; the state is evolved exactly.">
{`|psi(g,b)> = prod_{l=1..p} U_B(b_l) U_C(g_l) |W>^8

U_C(g)   = exp(-i g C_hat)        C = -PET + lambda (PE + PP), diagonal
U_B(b)   = exp(-i b H_XY)         H_XY = sum_i sum_{u<v in i} (X_u X_v + Y_u Y_v)

|W>      = (1/sqrt 6) sum_a |class a>      one W state per position

H_XY conserves Hamming weight inside each 6-qubit block, so the state never
leaves the one-hot feasible set: every measurement is a valid design.`}
            </Equation>
          }
        />

        <div className="quantum-claim-grid">
          <div className="quantum-claim" data-kind="yes">
            <h3>What this is</h3>
            <ul>
              <li>A real gate-model variational algorithm (QAOA / QAOA+).</li>
              <li>Run on the real six-class Potts coefficients, at your chosen lambda.</li>
              <li>
                Exactly simulated &mdash; no Trotter approximation in the mixer, no sampling error
                in the expectation value.
              </li>
              <li>Scored against a brute-force optimum over the same design space.</li>
            </ul>
          </div>
          <div className="quantum-claim" data-kind="no">
            <h3>What this is not</h3>
            <ul>
              <li>Not run on quantum hardware. No QPU, no embedding, no anneal schedule.</li>
              <li>Not a speedup. Brute force is faster here and is the reference.</li>
              <li>Not noise-modelled: no decoherence, no gate error, no readout error.</li>
              <li>
                Not biology. The optimum is a prediction of a published model, never a measured
                binding affinity.
              </li>
            </ul>
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------- the live run */}
      <Card>
        <h2 className="section-title">Run the circuit</h2>
        <p className="section-lede">
          The circuit varies the positions below and holds the rest of your current design fixed,
          so this is a window onto the peptide you have been building. Everything that appears
          after you press run was computed here, now.
        </p>

        {error ? (
          <ErrorState
            title="The scoring model could not be loaded"
            body={`${error}. Without the coefficients there is nothing honest to simulate, so no circuit is run.`}
          />
        ) : loading ? (
          <LoadingState title="Loading the scoring model" fraction={null} />
        ) : (
          <>
            <div className="quantum-controls">
              <div>
                <span className="control-label" id="qaoa-width-label">
                  Positions the circuit may vary
                  <InfoTip
                    title="Why not all eight?"
                    body="Each free position costs 6 qubits and multiplies the simulated state by 6. Four positions is a 24-qubit circuit over 1,296 states and finishes in milliseconds. All eight is the full 48-qubit circuit over 1,679,616 states; that runs in the offline benchmark, which takes minutes rather than milliseconds. Same physics, more time."
                  />
                </span>
                <Segmented
                  label="Positions the circuit may vary"
                  options={WIDTH_CHOICES}
                  value={width}
                  onChange={setWidth}
                />
              </div>
              <div>
                <span className="control-label" id="qaoa-depth-label">
                  Circuit depth p
                  <InfoTip
                    title="What depth means"
                    body="One layer is a phase separator followed by a mixer. Depth p repeats that p times and gives the optimiser 2p angles to tune. Deeper circuits can concentrate more probability on good designs, and cost proportionally more gates on real hardware."
                  />
                </span>
                <Segmented
                  label="Circuit depth p"
                  options={DEPTH_CHOICES}
                  value={depth}
                  onChange={setDepth}
                />
              </div>
            </div>

            <dl className="quantum-spec">
              <div>
                <dt>Nominal circuit width</dt>
                <dd>
                  {nominalQubits} qubits <span className="faint">({width} &times; 6)</span>
                </dd>
              </div>
              <div>
                <dt>Simulated feasible states</dt>
                <dd>
                  {groupInt(dimension)} <span className="faint">(6^{width})</span>
                </dd>
              </div>
              <div>
                <dt>Variational parameters</dt>
                <dd>{cost.variationalParameters}</dd>
              </div>
              <div>
                <dt>
                  CNOTs if run on hardware
                  <InfoTip
                    title="Lower bound"
                    body="Assumes all-to-all qubit connectivity and one Trotter step per mixer layer. Real devices have limited connectivity and need extra SWAP gates, so a real compilation would be larger. Nothing here has been executed on a device."
                  />
                </dt>
                <dd>
                  &ge; {groupInt(cost.cnotTotalLowerBound)} <span className="faint">lower bound</span>
                </dd>
              </div>
            </dl>

            <div className="row-wrap" style={{ marginTop: 'var(--s-4)' }}>
              <Button variant="primary" onClick={execute} disabled={running}>
                {running ? 'Simulating the circuit...' : 'Run the quantum circuit'}
              </Button>
              {run ? (
                <Button onClick={() => setRun(null)} disabled={running}>
                  Clear result
                </Button>
              ) : null}
            </div>

            {runError ? (
              <div style={{ marginTop: 'var(--s-4)' }}>
                <ErrorState title="The simulation failed" body={runError} />
              </div>
            ) : null}

            {!run && !running && !runError ? (
              <p className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-4)' }}>
                Nothing has been computed yet. This panel stays empty rather than showing
                placeholder numbers.
              </p>
            ) : null}
          </>
        )}

        {run ? <LiveResult run={run} researcher={researcher} /> : null}
      </Card>

      {run ? <QubitMap run={run} /> : null}
      {run ? <CircuitDiagram run={run} /> : null}

      <FullScaleResult />
      <AnsatzComparison />
      <Limitations />
    </section>
  );
}

/** The measured outcome of one live run, with the proven optimum beside it. */
function LiveResult({
  run,
  researcher,
}: {
  readonly run: LiveRun;
  readonly researcher: boolean;
}): JSX.Element {
  const { result } = run;
  const codes = [...result.mostLikelyCodes];
  const provenCodes = [...result.provenOptimumCodes];
  const matched = result.foundExactOptimum;

  return (
    <div className="stack-lg" style={{ marginTop: 'var(--s-5)' }}>
      <StatGroup provenance="computed" note="Computed in this browser by exact statevector simulation, seed 42.">
        <Stat
          label="Approximation ratio"
          value={result.approximationRatio.toFixed(4)}
          unit="0 to 1, against the proven optimum"
          direction="higher is better"
          help={`1.0 would be the proven optimum. Uniform random guessing on this slice scores ${result.randomBaselineRatio.toFixed(4)}.`}
        />
        <Stat
          label="Valid designs returned"
          value="100%"
          unit="share of measurements"
          direction="higher is better; 100% is guaranteed here"
          help="Guaranteed by the XY mixer, not by tuning. Every measurement is a real peptide; no shot is wasted on an invalid one."
        />
        <Stat
          label="Optimum found?"
          value={matched ? 'Yes' : `Rank ${formatInt(result.optimumRank)}`}
          unit="rank of the proven optimum by measurement probability"
          direction="rank 1 is best"
          help={
            matched
              ? 'The single most probable measurement outcome is the design brute force proved to be best.'
              : 'The proven optimum was not the most likely outcome at this depth. Try a deeper circuit.'
          }
        />
        <Stat
          label="Optimum enrichment"
          value={`${result.enrichmentOverUniform.toFixed(1)}x`}
          unit="multiple of uniform random sampling"
          direction="higher is better; 1x would be no better than chance"
          help="How much more likely the circuit is to return the proven optimum than blind uniform sampling over the same designs would be."
        />
      </StatGroup>

      <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
        Selectivity priority lambda = {run.lambda}; positions{' '}
        {run.freePositions.map((p) => p + 1).join(', ')} varied, the rest held at{' '}
        <span className="mono">{representativeSequence([...run.contextCodes])}</span>; depth p ={' '}
        {run.depth}; seed 42.
      </p>

      <div className="quantum-answer">
        <div>
          <h3>Most likely measurement</h3>
          <p className="mono quantum-seq">{representativeSequence(codes)}</p>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            {classSequence(codes)}
          </p>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            Objective {formatScore(result.mostLikelyEnergy, 4)} &middot; probability{' '}
            {(result.mostLikelyProbability * 100).toFixed(3)}%
          </p>
        </div>
        <div>
          <h3>Proven optimum of this slice</h3>
          <p className="mono quantum-seq">{representativeSequence(provenCodes)}</p>
          <p className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            {classSequence(provenCodes)}
          </p>
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            Objective {formatScore(result.provenOptimumEnergy, 4)} &middot; found by exhaustive
            search over {groupInt(result.dimension)} designs
          </p>
        </div>
      </div>

      {matched ? (
        <Notice tone="good" icon="=">
          The quantum circuit&rsquo;s most probable answer <strong>is</strong> the proven optimum.
          That is a correctness check on the method, not evidence of an advantage: brute force
          found the same design faster, and is how we know this one is right.
        </Notice>
      ) : (
        <Notice tone="honest" icon="!">
          At depth p = {run.depth} the proven optimum is the {formatInt(result.optimumRank)}
          th most likely outcome rather than the first. Reported as measured; a deeper circuit
          usually concentrates more probability on it.
        </Notice>
      )}

      <Researcher>
        <Disclosure summary="Optimised angles, convergence and the top of the distribution">
          <dl className="quantum-spec">
            <div>
              <dt>gamma (phase separator)</dt>
              <dd className="mono">{result.gammas.map((g) => g.toFixed(5)).join(', ')}</dd>
            </div>
            <div>
              <dt>beta (XY mixer)</dt>
              <dd className="mono">{result.betas.map((b) => b.toFixed(5)).join(', ')}</dd>
            </div>
            <div>
              <dt>Expectation value</dt>
              <dd className="mono">{result.expectation.toFixed(6)}</dd>
            </div>
            <div>
              <dt>Objective function calls</dt>
              <dd>
                {formatInt(result.functionEvaluations)} over {result.starts} restarts
              </dd>
            </div>
            <div>
              <dt>Wall clock</dt>
              <dd>{formatInt(result.runtimeMs)} ms</dd>
            </div>
            <div>
              <dt>Energy range of the slice</dt>
              <dd className="mono">
                {formatScore(result.provenOptimumEnergy, 3)} to{' '}
                {formatScore(result.worstEnergy, 3)}
              </dd>
            </div>
          </dl>

          <div className="scroll-x" style={{ marginTop: 'var(--s-4)' }}>
            <table className="table">
              <caption>
                The ten most probable measurement outcomes. Every row is a valid design.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Sequence</th>
                  <th scope="col">Probability</th>
                  <th scope="col">Objective</th>
                  <th scope="col">Optimum?</th>
                </tr>
              </thead>
              <tbody>
                {result.topDesigns.map((design) => (
                  <tr key={design.index} data-highlight={design.isExactOptimum ? 'yes' : undefined}>
                    <td>{design.rank}</td>
                    <td className="mono">{representativeSequence([...design.codes])}</td>
                    <td className="num">{(design.probability * 100).toFixed(4)}%</td>
                    <td className="num">{formatScore(design.energy, 4)}</td>
                    <td>{design.isExactOptimum ? 'yes' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      </Researcher>

      {!researcher ? (
        <Beginner>
          <p className="plain-note">
            The circuit does not hand back one answer, it hands back a set of odds. The table in
            Researcher mode lists the ten designs it was most likely to produce. What matters is
            whether the design at the top is the one the exhaustive search proved is best &mdash;
            and here it {matched ? 'is' : 'is not, at this depth'}.
          </p>
        </Beginner>
      ) : null}
    </div>
  );
}

/** Which physical choice each qubit stands for. The circuit's chemistry key. */
function QubitMap({ run }: { readonly run: LiveRun }): JSX.Element {
  return (
    <Card>
      <h2 className="section-title">What each qubit means</h2>
      <p className="section-lede">
        A circuit diagram is only interpretable next to this table. Qubit{' '}
        <span className="mono">u = slot &times; 6 + family</span>, and it reads 1 when that
        position takes that family. Positions not listed are held at your current design.
      </p>
      <div className="scroll-x">
        <table className="table">
          <caption>
            {run.freePositions.length * ALPHABET_SIZE} qubits for{' '}
            {run.freePositions.length} free positions.
          </caption>
          <thead>
            <tr>
              <th scope="col">Qubit</th>
              <th scope="col">Peptide position</th>
              <th scope="col">Building-block family</th>
              <th scope="col">Shown as</th>
            </tr>
          </thead>
          <tbody>
            {run.freePositions.flatMap((position, slot) =>
              CLASS_INFO.map((info) => (
                <tr key={`${position}-${info.index}`}>
                  <td className="mono">q{slot * ALPHABET_SIZE + info.index}</td>
                  <td>Position {position + 1}</td>
                  <td>
                    <span
                      className="class-dot"
                      style={{ background: `var(${info.token})` }}
                      aria-hidden="true"
                    />
                    {info.name}
                  </td>
                  <td className="mono">{REPRESENTATIVES[info.index]}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
        The displayed letter is the documented representative of its family, not a residue the
        optimiser chose. Optimisation happens at family resolution throughout.
      </p>
    </Card>
  );
}

/**
 * The circuit, drawn from the gate counts the coefficients imply.
 *
 * Deliberately a structural diagram rather than a fake gate-by-gate rendering:
 * at these widths an honest full diagram would be thousands of gates wide and
 * illegible, and inventing a tidier one would be a diagram that contradicts the
 * source. Every number in it comes from `circuitCost`.
 */
function CircuitDiagram({ run }: { readonly run: LiveRun }): JSX.Element {
  const slots = run.freePositions.length;
  const slotPairs = (slots * (slots - 1)) / 2;
  const cost = circuitCost(slots, run.depth, { coupledPairs: slotPairs * 36 });

  return (
    <Card>
      <h2 className="section-title">The circuit that ran</h2>
      <p className="section-lede">
        Structure and gate counts, both derived from the objective&rsquo;s own coefficients. The
        simulator applies each stage as an exact operator; the counts are what a gate-model device
        would have to execute to do the same thing.
      </p>

      <ol className="circuit-stages">
        <li>
          <span className="circuit-stage-tag">Prepare</span>
          <h3>
            One W state per position <span className="mono">|W&gt;^{slots}</span>
          </h3>
          <p>
            Puts each position into an equal superposition of its six families &mdash; the uniform
            superposition over all {groupInt(ALPHABET_SIZE ** slots)} valid designs, and nothing
            else. Starting inside the feasible set is what lets the mixer keep us there.
          </p>
          <p className="mono faint">&ge; {cost.statePrepCnot} CNOT, once</p>
        </li>
        <li>
          <span className="circuit-stage-tag">Repeat &times; {run.depth}</span>
          <h3>
            Phase separator <span className="mono">exp(-i &gamma; C)</span>
          </h3>
          <p>
            Rotates each design&rsquo;s amplitude by an angle proportional to how good that design
            is. Good designs and bad designs end up out of step with each other, which is what the
            mixer then turns into a difference in probability.
          </p>
          <p className="mono faint">
            {formatInt(cost.phaseSeparatorRz)} RZ &middot; {formatInt(cost.phaseSeparatorZz)} ZZ
            rotations &middot; &ge; {formatInt(cost.phaseSeparatorCnot)} CNOT
          </p>
        </li>
        <li>
          <span className="circuit-stage-tag">Repeat &times; {run.depth}</span>
          <h3>
            XY mixer <span className="mono">exp(-i &beta; H_XY)</span>
          </h3>
          <p>
            Moves amplitude between the six family choices <em>within</em> each position, and never
            between positions. That is the whole trick: it cannot create a design with two families
            at one position, or none, so invalid states are unreachable rather than merely
            penalised.
          </p>
          <p className="mono faint">
            {cost.xyPairTermsPerLayer} XY pair terms per layer &middot; &ge;{' '}
            {formatInt(cost.mixerCnot)} CNOT &middot; {formatInt(cost.mixerSingleQubit)} single-qubit
          </p>
        </li>
        <li>
          <span className="circuit-stage-tag">Measure</span>
          <h3>Read all {cost.qubits} qubits</h3>
          <p>
            Each shot collapses to exactly one design. Because of the mixer, that design is always
            valid, so the measured distribution is directly a ranking over real peptides.
          </p>
          <p className="mono faint">
            expectation values above are exact (infinite-shot), not sampled
          </p>
        </li>
      </ol>

      <Researcher>
        <Disclosure summary="Why the simulation is easier than the circuit looks, and what that costs in honesty">
          <p style={{ fontSize: 'var(--fs-sm)' }}>
            A {cost.qubits}-qubit statevector is 2^{cost.qubits} amplitudes. We never build it.
            Because <span className="mono">H_XY</span> conserves Hamming weight inside every
            6-qubit block, and the initial state is feasible, the evolution is confined to the
            feasible sector of dimension 6^{slots} = {groupInt(ALPHABET_SIZE ** slots)}. That
            sector is simulated exactly. This is a symmetry-sector simulation, a standard
            technique, and it is <em>not</em> an approximation of the circuit.
          </p>
          <p style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
            The cost is one real gap: we apply{' '}
            <span className="mono">exp(-i &beta; H_XY)</span> as an exact matrix exponential, which
            hardware cannot do, because the XY terms do not commute. A device would Trotterise and
            incur an error this simulation does not model &mdash; on top of gate noise, readout
            error and decoherence, none of which are modelled either. The CNOT counts above are
            lower bounds on an all-to-all device; limited connectivity would push them higher.
          </p>
        </Disclosure>
      </Researcher>
    </Card>
  );
}

/**
 * The full-size run, quoted from the offline benchmark.
 *
 * The browser runs a slice; this is the whole problem - a 48-qubit circuit
 * over all 1,679,616 designs. Numbers come from the generated module, which is
 * produced from results/quantum_*.json|csv by a script and verified against
 * those files by a test, so this panel cannot drift from the run it describes.
 */
function FullScaleResult(): JSX.Element {
  const { xyDepthSweep, searchSpace } = QUANTUM_BENCHMARK;
  const best = xyDepthSweep[xyDepthSweep.length - 1];

  return (
    <Card>
      <h2 className="section-title">The full problem: all 48 qubits, all 1,679,616 designs</h2>
      <p className="answer-lead">
        The circuit you ran above varies a few positions. This is the same algorithm given the
        whole peptide &mdash; every one of the {groupInt(Number(searchSpace.valid_designs))}{' '}
        designs, a nominal circuit width of {searchSpace.one_hot_binary_variables} qubits. It is
        simulated exactly, which is only possible because the XY mixer confines the state to the
        feasible sector. It takes about twenty minutes, so it runs offline rather than in a
        browser tab.
      </p>

      <StatGroup
        provenance="computed"
        note={`Measured by scripts/run_quantum.py, seed ${QUANTUM_BENCHMARK.seed}. Recorded in results/quantum_xy_depth_sweep.csv.`}
      >
        <Stat
          label="Approximation ratio"
          value={best.approximation_ratio.toFixed(4)}
          unit="0 to 1, against the proven optimum"
          direction="higher is better"
          help={`At depth p = ${best.depth}. Uniform random sampling over the same designs scores ${best.random_baseline_ratio.toFixed(4)}; the proven optimum is 1.0.`}
        />
        <Stat
          label="Most likely outcome"
          value={best.found_exact_optimum ? 'The proven optimum' : `Rank ${best.optimum_rank}`}
          unit="rank of the proven optimum by measurement probability"
          direction="rank 1 is best"
          help="Whether the single most probable measurement of the full circuit is the design brute force proved best over all 1,679,616."
        />
        <Stat
          label="Optimum enrichment"
          value={`${Math.round(best.enrichment_over_uniform).toLocaleString('en-GB')}x`}
          unit="multiple of uniform random sampling"
          direction="higher is better; 1x would be no better than chance"
          help="How much more likely the circuit is to return the proven optimum than uniform random sampling over the same designs."
        />
        <Stat
          label="Valid measurements"
          value={`${(best.validity_rate * 100).toFixed(0)}%`}
          unit="share of measurements"
          direction="higher is better; 100% is guaranteed here"
          help="Guaranteed by the mixer, not by penalty tuning. Every shot is a real peptide design."
        />
      </StatGroup>

      <div className="scroll-x" style={{ marginTop: 'var(--s-5)' }}>
        <table className="table">
          <caption>
            Approximation ratio against circuit depth, full problem. Deeper circuits concentrate
            more probability on the proven optimum, at proportionally more gates.
          </caption>
          <thead>
            <tr>
              <th scope="col">Depth p</th>
              <th scope="col" className="num">
                Parameters
              </th>
              <th scope="col" className="num">
                Approximation ratio
              </th>
              <th scope="col" className="num">
                Optimum probability
              </th>
              <th scope="col" className="num">
                Enrichment
              </th>
              <th scope="col">Top outcome is the optimum?</th>
            </tr>
          </thead>
          <tbody>
            {xyDepthSweep.map((row) => (
              <tr key={row.depth} data-highlight={row.depth === best.depth ? 'yes' : undefined}>
                <td>p = {row.depth}</td>
                <td className="num">{row.variational_parameters}</td>
                <td className="num">{row.approximation_ratio.toFixed(4)}</td>
                <td className="num">{(row.optimum_probability * 100).toFixed(3)}%</td>
                <td className="num">
                  {Math.round(row.enrichment_over_uniform).toLocaleString('en-GB')}x
                </td>
                <td>{row.found_exact_optimum ? 'yes' : `no - rank ${row.optimum_rank}`}</td>
              </tr>
            ))}
            <tr>
              <td className="faint">uniform random</td>
              <td className="num faint">0</td>
              <td className="num faint">{best.random_baseline_ratio.toFixed(4)}</td>
              <td className="num faint">
                {((1 / Number(searchSpace.valid_designs)) * 100).toExponential(2)}%
              </td>
              <td className="num faint">1x</td>
              <td className="faint">no</td>
            </tr>
          </tbody>
        </table>
      </div>

      <Researcher>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-4)' }}>
          A {searchSpace.one_hot_binary_variables}-qubit statevector would hold 2^
          {searchSpace.one_hot_binary_variables} amplitudes, roughly 4.5 petabytes. This
          simulation holds {groupInt(Number(searchSpace.valid_designs))} complex amplitudes
          instead &mdash; about 27 MB &mdash; because the XY mixer conserves Hamming weight inside
          every six-qubit block and the initial state is feasible, so the evolution never leaves
          that sector. It is exact within the sector, and the sector is everything the circuit can
          reach.
        </p>
      </Researcher>
    </Card>
  );
}

/**
 * The comparison that is the actual scientific contribution of this screen.
 *
 * Every number is measured by `scripts/run_quantum.py` on the real Potts model
 * and read from the generated module, never written into prose by hand.
 */
function AnsatzComparison(): JSX.Element {
  const { comparison, penaltyControl, xyDepthSweep } = QUANTUM_BENCHMARK;
  const penalty = penaltyControl[penaltyControl.length - 1];
  const xy = xyDepthSweep[xyDepthSweep.length - 1];
  const marginFactor =
    comparison.penaltyMarginOverRandom > 0
      ? comparison.xyMarginOverRandom / comparison.penaltyMarginOverRandom
      : null;

  return (
    <Card>
      <h2 className="section-title">
        Why the mixer matters more than the hardware
        <InfoTip
          title="Measured, not asserted"
          body="Both ansatze were run on the same real Potts objective and scored against an exact brute-force optimum over the same designs. Reproduce with scripts/run_quantum.py."
        />
      </h2>
      <p className="answer-lead">
        A quantum annealer needs the &ldquo;exactly one family per position&rdquo; rule written as
        an energy penalty. To be provably safe that penalty has to exceed the entire objective
        range &mdash; here <span className="mono">P = {penalty.penalty_P.toFixed(0)}</span> against
        a span of <span className="mono">{penalty.objective_span.toFixed(1)}</span>, making it{' '}
        <strong>{comparison.penaltyToSpanRatio.toFixed(1)} times larger</strong> than the
        differences the optimiser is trying to resolve. The circuit then spends nearly all of its
        rotation enforcing the rule and almost none choosing good designs.
      </p>

      <div className="scroll-x">
        <table className="table">
          <caption>
            Two ways to put the same objective on a gate-model circuit. Measured on the real Potts
            model; see <span className="mono">results/quantum_penalty_control.csv</span> and{' '}
            <span className="mono">results/quantum_xy_depth_sweep.csv</span>.
          </caption>
          <thead>
            <tr>
              <th scope="col">Encoding</th>
              <th scope="col">Constraint enforced by</th>
              <th scope="col" className="num">
                Valid measurements
              </th>
              <th scope="col" className="num">
                Margin over random
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Penalty QUBO + X mixer
                <br />
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  what an annealer takes, p = {penalty.depth}
                </span>
              </td>
              <td style={{ whiteSpace: 'normal' }}>
                An energy penalty larger than the whole objective range
              </td>
              <td className="num">{(penalty.validity_rate * 100).toFixed(1)}%</td>
              <td className="num">+{comparison.penaltyMarginOverRandom.toFixed(4)}</td>
            </tr>
            <tr data-highlight="yes">
              <td>
                One-hot blocks + XY mixer
                <br />
                <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  what this screen runs, p = {xy.depth}
                </span>
              </td>
              <td style={{ whiteSpace: 'normal' }}>
                The mixer itself &mdash; invalid states are unreachable
              </td>
              <td className="num">{(xy.validity_rate * 100).toFixed(1)}%</td>
              <td className="num">+{comparison.xyMarginOverRandom.toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {marginFactor ? (
        <Notice tone="good" icon="=">
          Same objective, same reference optimum: the constraint-preserving circuit beats random
          guessing by <strong>{Math.round(marginFactor)} times</strong> the margin the penalty
          encoding manages, and wastes none of its measurements on invalid designs.
        </Notice>
      ) : null}

      <Beginner>
        <p className="plain-note">
          In plain terms: instead of telling the machine &ldquo;picking two families for one
          position is heavily fined&rdquo;, we built a machine that physically cannot pick two.
          That frees the whole circuit to work on the question we actually care about.
        </p>
      </Beginner>

      <Researcher>
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
          This reproduces a known result from the constrained-QAOA literature &mdash; Hadfield et
          al. (2019) on the ansatz family, and the well-documented penalty-weight pathology for
          one-hot encodings &mdash; on a real scientific objective rather than a synthetic
          benchmark. It is also the honest answer to &ldquo;why not just use the annealer
          formulation?&rdquo;: the formulation that suits annealing hardware is measurably the
          wrong choice for a gate-model circuit on this problem. Note that the control runs on a
          12-qubit slice because the penalty ansatz has no feasible-subspace shortcut &mdash; it
          must carry all 2^n states, so the full 48-qubit version is not simulable at all.
        </p>
      </Researcher>

      <ProvenanceBadge
        kind="computed"
        detail={`Measured by scripts/run_quantum.py on the real Potts model, seed ${QUANTUM_BENCHMARK.seed}, recorded in results/quantum_*.csv.`}
      />
    </Card>
  );
}

function Limitations(): JSX.Element {
  return (
    <Card>
      <h2 className="section-title">What this does not establish</h2>
      <ul className="stack-sm" style={{ fontSize: 'var(--fs-sm)' }}>
        <li>
          <strong>No hardware run.</strong> Every number on this screen comes from exact classical
          simulation. No QPU was contacted, so there is no device data, no noise characterisation
          and no hardware timing to report.
        </li>
        <li>
          <strong>No speedup.</strong> Brute force solves this problem faster and exactly. The
          quantum method is measured against that optimum; it does not compete with it. A speedup
          claim would need a problem too large to enumerate, a tuned classical baseline and matched
          wall-clock budgets.
        </li>
        <li>
          <strong>An idealised mixer.</strong> The XY mixer is applied as an exact exponential.
          Hardware must Trotterise non-commuting terms; that error is not modelled, and neither is
          decoherence or gate infidelity.
        </li>
        <li>
          <strong>A small problem by design.</strong> 1,679,616 designs is enumerable, which is
          precisely why it is a good testbed: the right answer is known, so the quantum method can
          be graded. It is far below any size where quantum hardware would be interesting.
        </li>
        <li>
          <strong>Still a prediction.</strong> The objective is a published statistical model of
          peptide&ndash;plastic interaction. A low objective means the model scores that design
          well for PET over PE and PP. It is not a measurement, and nothing here has been
          synthesised or tested in a laboratory.
        </li>
      </ul>
    </Card>
  );
}
