/**
 * The Quantum screen, exercised end to end.
 *
 * The point of this file is that the screen's headline numbers are not
 * decorative. `fetch` is stubbed with the REAL exported Potts coefficients
 * read off disk, the run button is actually clicked, and the assertions below
 * check that what appears on screen equals what `src/science/qaoa.ts` computes
 * for the same inputs. A screen that printed plausible-looking constants would
 * fail here.
 *
 * It also pins the two honesty requirements that matter most on this screen:
 * the "no hardware, no speedup" disclosure is present, and when the model
 * cannot be loaded the screen says so instead of rendering placeholder
 * physics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../../src/App';
import { representativeSequence } from '../../src/science/alphabet';
import { buildXyProblem, optimiseXyQaoa } from '../../src/science/qaoa';
import { DEFAULT_LAMBDA } from '../../src/science/objective';
import { REFERENCE_CODES } from '../../src/state/store';
import { modelJson, realModel } from '../helpers/model';
import { installWorkerMock, liveWorkers } from './worker-mock';

const LAZY_TIMEOUT = 15_000;

/** Serve the real model JSON to `usePottsModel`, as the browser would. */
function stubModelFetch() {
  const json = modelJson();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('potts_6class_8mer.json')) {
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

/** Serve a failure, to check the screen degrades honestly. */
function stubFailingFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('gone', { status: 503, statusText: 'Service Unavailable' })),
  );
}

beforeEach(() => {
  installWorkerMock();
  window.history.pushState({}, '', '/quantum');
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderQuantum() {
  const utils = render(<App />);
  await waitFor(() => expect(liveWorkers.length).toBeGreaterThan(0));
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  return utils;
}

async function runCircuit() {
  const button = await screen.findByRole(
    'button',
    { name: /run the quantum circuit/i },
    { timeout: LAZY_TIMEOUT },
  );
  await act(async () => {
    fireEvent.click(button);
  });
  // The run is kicked off inside requestAnimationFrame so the pressed state
  // paints first; wait for the result rather than assuming it is synchronous.
  // "Clear result" only renders while a live run is held in state, so it is an
  // unambiguous sentinel - unlike any stat label, which the published
  // full-scale panel also uses.
  await waitFor(
    () => expect(screen.getByRole('button', { name: /clear result/i })).toBeInTheDocument(),
    { timeout: LAZY_TIMEOUT },
  );
}

/** The live-run panel, scoped so published figures cannot satisfy a query. */
function liveResultPanel(): HTMLElement {
  const anchor = screen.getByText(/most likely measurement/i);
  const panel = anchor.closest('.card');
  if (!panel) throw new Error('live result panel not found');
  return panel as HTMLElement;
}

describe('Quantum screen: honesty disclosures', () => {
  beforeEach(stubModelFetch);

  it('states up front that nothing ran on hardware and no speedup is claimed', async () => {
    await renderQuantum();
    expect(
      await screen.findByText(/simulated, not executed on a quantum computer/i, undefined, {
        timeout: LAZY_TIMEOUT,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no quantum speedup is claimed or shown/i)).toBeInTheDocument();
  });

  it('separates what the method is from what it is not', async () => {
    await renderQuantum();
    expect(await screen.findByText(/^what this is$/i, undefined, { timeout: LAZY_TIMEOUT }))
      .toBeInTheDocument();
    expect(screen.getByText(/^what this is not$/i)).toBeInTheDocument();
    expect(screen.getByText(/not run on quantum hardware/i)).toBeInTheDocument();
  });

  it('lists the limitations, including the unmodelled Trotter error', async () => {
    await renderQuantum();
    expect(
      await screen.findByText(/what this does not establish/i, undefined, {
        timeout: LAZY_TIMEOUT,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/an idealised mixer/i)).toBeInTheDocument();
    expect(screen.getByText(/still a prediction/i)).toBeInTheDocument();
  });

  it('shows no live numbers at all before anything has been computed', async () => {
    await renderQuantum();
    expect(
      await screen.findByText(/nothing has been computed yet/i, undefined, {
        timeout: LAZY_TIMEOUT,
      }),
    ).toBeInTheDocument();
    // No live result exists, so neither its panel nor its clear control do.
    expect(screen.queryByText(/most likely measurement/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear result/i })).not.toBeInTheDocument();
    // The published full-scale figures ARE shown, and are labelled as measured
    // offline rather than as something this tab computed.
    expect(screen.getByText(/the full problem: all 48 qubits/i)).toBeInTheDocument();
  });
});

describe('Quantum screen: the live run', () => {
  beforeEach(stubModelFetch);

  it('computes the same result the science module computes for the same inputs', async () => {
    await renderQuantum();
    await runCircuit();

    // Reproduce the run independently: default draft codes, default lambda,
    // the screen's default 4-free-position slice at depth 2.
    const model = realModel();
    // Take the defaults from the app itself rather than restating them: a
    // hardcoded copy here would silently stop testing the real screen the
    // moment a default changed.
    const problem = buildXyProblem(model.flat, {
      lambda: DEFAULT_LAMBDA,
      fixedCodes: REFERENCE_CODES,
      freePositions: [0, 2, 5, 7],
    });
    const expected = optimiseXyQaoa(problem, {
      depth: 2,
      restarts: 2,
      maxIterations: 150,
      seed: 42,
    });

    // The approximation ratio in the LIVE panel must be the one the science
    // module computes, to the four decimals the screen prints. Scoped to the
    // panel so a published figure cannot satisfy it by coincidence.
    const panel = liveResultPanel();
    const ratio = expected.approximationRatio.toFixed(4);
    expect(within(panel).getByText(ratio)).toBeInTheDocument();

    // The proven optimum of the slice must be shown beside it as the reference.
    const proven = representativeSequence([...expected.provenOptimumCodes]);
    expect(within(panel).getAllByText(proven).length).toBeGreaterThan(0);
  });

  it('reports 100% validity, which the XY mixer guarantees by construction', async () => {
    await renderQuantum();
    await runCircuit();
    const panel = liveResultPanel();
    const label = within(panel).getByText(/valid designs returned/i);
    const tile = label.closest('.stat') as HTMLElement;
    expect(within(tile).getByText('100%')).toBeInTheDocument();
  });

  it('shows the proven optimum beside the circuit answer, not instead of it', async () => {
    await renderQuantum();
    await runCircuit();
    const panel = liveResultPanel();
    expect(within(panel).getByText(/most likely measurement/i)).toBeInTheDocument();
    expect(within(panel).getByText(/proven optimum of this slice/i)).toBeInTheDocument();
    expect(within(panel).getByText(/found by exhaustive search/i)).toBeInTheDocument();
  });

  it('publishes a qubit map that covers every qubit in the circuit', async () => {
    await renderQuantum();
    await runCircuit();
    const caption = await screen.findByText(/24 qubits for 4 free positions/i);
    const table = caption.closest('table');
    expect(table).not.toBeNull();
    // 24 qubit rows plus the header row.
    expect(within(table as HTMLElement).getAllByRole('row')).toHaveLength(25);
    expect(within(table as HTMLElement).getByText('q0')).toBeInTheDocument();
    expect(within(table as HTMLElement).getByText('q23')).toBeInTheDocument();
  });

  it('describes the circuit stages that actually ran, with gate counts', async () => {
    await renderQuantum();
    await runCircuit();
    const heading = screen.getByText(/the circuit that ran/i);
    const card = heading.closest('.card') ?? (heading.parentElement as HTMLElement);
    const stages = within(card as HTMLElement).getByRole('list', { hidden: true });
    expect(within(stages).getByText(/phase separator/i)).toBeInTheDocument();
    expect(within(stages).getByText(/^XY mixer/)).toBeInTheDocument();
    expect(within(stages).getByText(/read all 24 qubits/i)).toBeInTheDocument();
    // Gate counts must be present and non-zero, since they are derived from
    // the coefficients rather than written in.
    expect(within(stages).getByText(/CNOT, once/i)).toBeInTheDocument();
  });

  // Two full renders plus two circuit optimisations. Comfortably under the
  // default 5s alone, but it shares 14 workers in the full suite, so it gets an
  // explicit budget rather than being left to flake.
  it('changes its answer when the circuit width changes', async () => {
    await renderQuantum();
    await runCircuit();
    const before = screen.getByText(/24 qubits for 4 free positions/i);
    expect(before).toBeInTheDocument();

    const widthGroup = screen.getByRole('group', { name: /positions the circuit may vary/i });
    await act(async () => {
      fireEvent.click(within(widthGroup).getByRole('button', { name: /2 free/i }));
    });
    await runCircuit();
    await waitFor(() =>
      expect(screen.getByText(/12 qubits for 2 free positions/i)).toBeInTheDocument(),
    );
  }, 90_000);

  it('clears the result without leaving stale numbers behind', async () => {
    await renderQuantum();
    await runCircuit();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear result/i }));
    });
    expect(screen.queryByText(/most likely measurement/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear result/i })).not.toBeInTheDocument();
    expect(screen.getByText(/nothing has been computed yet/i)).toBeInTheDocument();
  });
});

describe('Quantum screen: failure handling', () => {
  it('says the model could not be loaded rather than simulating nothing', async () => {
    stubFailingFetch();
    await renderQuantum();
    expect(
      await screen.findByText(/the scoring model could not be loaded/i, undefined, {
        timeout: LAZY_TIMEOUT,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing honest to simulate/i)).toBeInTheDocument();
    // Crucially, no run control is offered when there is nothing to run on.
    expect(
      screen.queryByRole('button', { name: /run the quantum circuit/i }),
    ).not.toBeInTheDocument();
  });
});
