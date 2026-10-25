/**
 * UI / integration coverage: every screen, in its real states.
 *
 * These render the actual App with a stubbed Worker, because jsdom has no
 * module-worker support. The stub speaks the REAL protocol and computes with
 * the REAL science core, so what the screens receive is genuine model output
 * rather than invented fixtures. That makes these tests able to catch a wiring
 * bug (wrong field, stale response, missing state) rather than only a crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../../src/App';
import { NAV_ORDER, SCREENS } from '../../src/content/copy';
import { CLASS_INFO, classSequence } from '../../src/science/alphabet';
import { scoreAll } from '../../src/science/potts';
import { combineObjective, safePenalty } from '../../src/science/qubo';
import { STAGES } from '../../src/workers/protocol';
import { installWorkerMock, liveWorkers, makeRunRecord, model } from './worker-mock';

/**
 * Every screen is a separate lazily-imported chunk, so a first render has to
 * await a real dynamic import. Under full-suite load that can exceed Testing
 * Library's 1000ms default, which would show up as a confusing
 * "Unable to find role=heading" rather than as the timeout it is.
 */
const LAZY_TIMEOUT = 15_000;

beforeEach(() => {
  installWorkerMock();
  window.history.pushState({}, '', '/');
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

/** Render the app and wait for the model-ready reply to land. */
async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(liveWorkers.length).toBeGreaterThan(0));
  // Screens are lazily imported; wait for the first one to actually mount.
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  return utils;
}

/**
 * The tour is opt-in and never opens itself, so nothing normally needs
 * dismissing. Kept as a guard so the call sites still read as "make sure no
 * overlay is in the way".
 */
async function skipTour() {
  const skip = screen.queryByRole('button', { name: /^skip$/i });
  if (skip) {
    await act(async () => {
      fireEvent.click(skip);
    });
  }
}

/** Opens the opt-in tour from the header. */
async function openTour() {
  const open = await screen.findByRole(
    'button',
    { name: /take the guided tour/i },
    { timeout: LAZY_TIMEOUT },
  );
  await act(async () => {
    fireEvent.click(open);
  });
  return screen.findByRole('dialog', { name: /quick tour/i });
}

async function gotoScreen(nav: string) {
  const link = await screen.findByRole('link', { name: new RegExp(nav, 'i') });
  await act(async () => {
    fireEvent.click(link);
  });
}

/* ================================================================== *
 * Shell, navigation and global state
 * ================================================================== */
describe('shell and navigation', () => {
  it('renders the landing screen with the problem, the promise and the next action', async () => {
    await renderApp();
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
    // The 30-second test: problem, what it does, what is next, all present.
    expect(screen.getByText(/one plastic from another/i)).toBeInTheDocument();
    expect(screen.getByText(/^the problem$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1,679,616/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /open the design workbench/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /run the exhaustive search/i }),
    ).toBeInTheDocument();
  });

  it('exposes a skip link as an early tab stop', async () => {
    await renderApp();
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main');
  });

  it('lists every screen in the main navigation', async () => {
    await renderApp();
    const nav = screen.getByRole('navigation', { name: /main/i });
    for (const id of NAV_ORDER) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(SCREENS[id].nav, 'i') }),
        `nav link for ${id}`,
      ).toBeInTheDocument();
    }
  });

  it.each(NAV_ORDER.filter((id) => id !== 'discover'))(
    'navigates to %s without crashing, before any computation exists',
    async (id) => {
      await renderApp();
      await skipTour();
      await gotoScreen(SCREENS[id].nav);
      // Each screen must show its own plain-English title. The timeout is the
      // lazy-chunk one: these screens are code-split and the workbench chunk
      // carries the chemistry layer with it.
      expect(
        await screen.findByText(SCREENS[id].title, undefined, { timeout: LAZY_TIMEOUT }),
      ).toBeInTheDocument();
    },
  );

  it('marks the active screen with aria-current', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.understand.nav);
    const nav = screen.getByRole('navigation', { name: /main/i });
    const current = within(nav).getByRole('link', { current: 'page' });
    expect(current).toHaveTextContent(new RegExp(SCREENS.understand.nav, 'i'));
  });

  it('supports browser back navigation', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.compare.nav);
    expect(await screen.findByText(SCREENS.compare.title)).toBeInTheDocument();
    await act(async () => {
      window.history.back();
      // jsdom dispatches popstate asynchronously.
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
  });

  it('switches between Beginner and Researcher detail levels', async () => {
    await renderApp();
    await skipTour();
    const researcher = screen.getByRole('button', { name: /^researcher$/i });
    expect(researcher).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(researcher);
    });
    expect(screen.getByRole('button', { name: /^researcher$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('toggles the theme and records it on the document root', async () => {
    await renderApp();
    await skipTour();
    const toggle = screen.getByRole('button', { name: /switch to (dark|light) theme/i });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(['dark', 'light']).toContain(document.documentElement.getAttribute('data-theme'));
  });

  it('opens the help dialog with the FAQ, shortcuts and accessibility tabs', async () => {
    await renderApp();
    await skipTour();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /help, shortcuts/i }));
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/was a quantum computer used/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /shortcuts/i }));
    });
    expect(within(dialog).getByText(/undo the last edit/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /accessibility/i }));
    });
    expect(within(dialog).getByText(/WCAG 2.2 AA/i)).toBeInTheDocument();
  });

  it('closes the help dialog with Escape', async () => {
    await renderApp();
    await skipTour();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /help, shortcuts/i }));
    });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('states plainly that nothing has been computed yet', async () => {
    await renderApp();
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });

  it('terminates the worker on unmount', async () => {
    const { unmount } = await renderApp();
    const worker = liveWorkers[0];
    unmount();
    expect(worker.terminated).toBe(true);
  });
});

/* ================================================================== *
 * First-run tour
 * ================================================================== */
describe('first-run tour', () => {
  it('never opens itself, and opens from the header when asked', async () => {
    await renderApp();
    // A dialog over the first thing a visitor looks at costs more than it
    // teaches, so the tour must not appear unprompted.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /quick tour/i })).not.toBeInTheDocument(),
    );
    await openTour();
    const skip = await screen.findByRole('button', { name: /^skip$/i }, { timeout: 3000 });
    expect(screen.getByRole('dialog', { name: /quick tour/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(skip);
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /quick tour/i })).not.toBeInTheDocument(),
    );
  });

  it('advances through every step and finishes', async () => {
    await renderApp();
    await openTour();
    await screen.findByRole('button', { name: /^skip$/i }, { timeout: 3000 });
    for (let i = 0; i < 10; i += 1) {
      const next = screen.queryByRole('button', { name: /next|start exploring/i });
      if (!next) break;
      const label = next.textContent ?? '';
      await act(async () => {
        fireEvent.click(next);
      });
      if (/start exploring/i.test(label)) break;
    }
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /quick tour/i })).not.toBeInTheDocument(),
    );
  });
});

/* ================================================================== *
 * Build screen - the flagship interaction
 * ================================================================== */
describe('Build screen', () => {
  async function openBuild() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title);
  }

  it('renders eight position buttons and six palette families', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    expect(positions).toHaveLength(8);
    for (const info of CLASS_INFO) {
      expect(
        screen.getByRole('button', { name: new RegExp(`${info.name}, family`, 'i') }),
        `palette entry for ${info.id}`,
      ).toBeInTheDocument();
    }
  });

  it('scores the initial design with real model numbers', async () => {
    await openBuild();
    // The reference design's real PET score, to 2dp, must appear on screen.
    const scores = scoreAll([2, 3, 0, 0, 2, 2, 1, 2], model.flat);
    // Each score appears in both the stat tile and the score-bar row, so the
    // assertion is "present at least once" rather than "exactly once".
    await waitFor(() =>
      expect(screen.getAllByText(scores.PET.toFixed(2)).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(scores.PE.toFixed(2)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(scores.PP.toFixed(2)).length).toBeGreaterThan(0);
  });

  it('places a family with the keyboard and rescores', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '5' });
    });
    const edited = [4, 3, 0, 0, 2, 2, 1, 2];
    const scores = scoreAll(edited, model.flat);
    await waitFor(
      () => expect(screen.getAllByText(scores.PET.toFixed(2)).length).toBeGreaterThan(0),
      { timeout: 3000 },
    );
    expect(screen.getByText(classSequence(edited))).toBeInTheDocument();
  });

  it('moves focus between positions with the arrow keys', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: 'ArrowRight' });
    });
    expect(document.activeElement).toBe(positions[1]);
    await act(async () => {
      fireEvent.keyDown(positions[1], { key: 'ArrowLeft' });
    });
    expect(document.activeElement).toBe(positions[0]);
    await act(async () => {
      fireEvent.keyDown(positions[0], { key: 'End' });
    });
    expect(document.activeElement).toBe(positions[7]);
  });

  it('supports tap-to-arm then tap-to-place (the touch path)', async () => {
    await openBuild();
    const palette = screen.getByRole('button', { name: /negatively charged, family/i });
    await act(async () => {
      fireEvent.click(palette);
    });
    expect(screen.getByRole('button', { name: /negatively charged, family/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      fireEvent.click(positions[2]);
    });
    const edited = [2, 3, 4, 0, 2, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('supports drag and drop onto a position', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(key: string, value: string) {
        this.data[key] = value;
      },
      getData(key: string) {
        return this.data[key] ?? '';
      },
      dropEffect: '',
      effectAllowed: '',
    };
    dataTransfer.setData('text/plain', '1');
    await act(async () => {
      fireEvent.dragOver(positions[4], { dataTransfer });
      fireEvent.drop(positions[4], { dataTransfer });
    });
    const edited = [2, 3, 0, 0, 1, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('undoes and redoes an edit', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '6' });
    });
    const edited = [5, 3, 0, 0, 2, 2, 1, 2];
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
    });
    await waitFor(() => expect(screen.getByText(classSequence(edited))).toBeInTheDocument());
  });

  it('disables undo when there is no history', async () => {
    await openBuild();
    expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
  });

  it('resets to the reference design', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[3].focus();
      fireEvent.keyDown(positions[3], { key: '5' });
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 4, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    });
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
  });

  it('explains the before/after effect of an edit in plain language', async () => {
    await openBuild();
    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[0].focus();
      fireEvent.keyDown(positions[0], { key: '1' });
    });
    await waitFor(() => expect(screen.getByText(/what your last edit did/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText(/this edit means/i)).toBeInTheDocument();
  });

  it('states that families are not individual amino acids', async () => {
    await openBuild();
    expect(
      screen.getAllByText(/FAMILY of amino acids|not one amino acid/i).length,
    ).toBeGreaterThan(0);
  });

  it('lets a residue be chosen from the members of its position class', async () => {
    await openBuild();
    // Position 2 of the reference design is SMALL_POLAR: G, S, T, N, Q.
    const select = (await screen.findByLabelText(
      /amino acid shown at position 2.*small water-friendly/i,
    )) as HTMLSelectElement;
    expect(select.value).toBe('S');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['G', 'S', 'T', 'N', 'Q']);
  });

  it('keeps the class-level scores unchanged when the displayed residue changes', async () => {
    await openBuild();
    const readScores = () =>
      screen
        .getAllByText(/dimensionless model score/i)
        .map((node) => node.parentElement?.textContent ?? '')
        .join('|');
    await waitFor(() => expect(readScores()).toMatch(/-?\d+\.\d+/), { timeout: LAZY_TIMEOUT });
    const before = readScores();

    const select = (await screen.findByLabelText(
      /amino acid shown at position 2.*small water-friendly/i,
    )) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'T' } });
    });

    // The class sequence is untouched, so every score must be identical:
    // depiction is residue-level, optimisation is class-level.
    expect(select.value).toBe('T');
    expect(screen.getAllByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2])).length).toBeGreaterThan(0);
    expect(readScores()).toBe(before);
  });

  it('runs the guided challenge and tracks the margin', async () => {
    await openBuild();
    await screen.findByText(/can you beat the optimiser/i);
    const start = screen.getByRole('button', { name: /start the challenge/i });
    await waitFor(() => expect(start).not.toBeDisabled(), { timeout: 3000 });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(screen.getByRole('button', { name: /end challenge/i })).toBeInTheDocument();
  });

  it('stores and clears a comparison slot', async () => {
    await openBuild();
    const storeButtons = screen.getAllByRole('button', { name: /store current/i });
    await act(async () => {
      fireEvent.click(storeButtons[0]);
    });
    expect(await screen.findByText(/this is your current design/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear slot a/i }));
    });
    await waitFor(() =>
      expect(screen.getAllByText(/empty\. store the current design/i).length).toBe(2),
    );
  });

  it('shows the real per-position contribution chart, not a conceptual drawing', async () => {
    await openBuild();
    const chart = await screen.findByRole(
      'img',
      { name: /one-body score contribution by position/i },
      { timeout: LAZY_TIMEOUT },
    );
    // The description carries the actual numbers, so the chart is readable
    // without sight and cannot drift away from the model.
    const description = chart.querySelector('desc')?.textContent ?? '';
    expect(description).toMatch(/position 1 \(.+?\): PET -?\d/);
    expect(description).toMatch(/position 8/);
  });

  it('offers a keyboard-reachable control for every position beside the chart', async () => {
    await openBuild();
    await screen.findByRole(
      'img',
      { name: /one-body score contribution by position/i },
      { timeout: LAZY_TIMEOUT },
    );
    const group = screen.getByRole('group', { name: /inspect one position/i });
    expect(within(group).getAllByRole('button')).toHaveLength(8);
  });

  it('reports the molecular formula and mass of the structure it draws', async () => {
    await openBuild();
    // LSWWLLFL built by condensation; cross-checked against RDKit in tests/chem.
    await waitFor(() => expect(screen.getAllByText(/C58H80N10O10/).length).toBeGreaterThan(0), {
      timeout: LAZY_TIMEOUT,
    });
    expect(screen.getAllByText(/1077\.3/).length).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * Optimise screen
 * ================================================================== */
describe('Optimise screen', () => {
  async function openOptimise() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
  }

  it('renames lambda to Selectivity Priority but keeps the symbol available', async () => {
    await openOptimise();
    expect(screen.getAllByText(/selectivity priority/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('explains both ends of the slider in plain words', async () => {
    await openOptimise();
    expect(screen.getByText(/chase PET only/i)).toBeInTheDocument();
    expect(screen.getAllByText(/avoid the others/i).length).toBeGreaterThan(0);
  });

  it('moves the slider and updates the explanation', async () => {
    await openOptimise();
    const slider = screen.getByRole('slider');
    await act(async () => {
      fireEvent.change(slider, { target: { value: '5' } });
    });
    expect(await screen.findByText(/avoiding the others dominates everything/i)).toBeInTheDocument();
  });

  it('offers the five benchmark values as discrete steps', async () => {
    await openOptimise();
    const group = screen.getByRole('group', { name: /benchmark priority values/i });
    for (const value of ['0', '0.5', '1', '2', '5']) {
      expect(within(group).getByRole('button', { name: value })).toBeInTheDocument();
    }
  });

  it('shows all nine real pipeline stages, waiting before a run', async () => {
    await openOptimise();
    for (const stage of STAGES) {
      expect(screen.getByText(stage.title), `stage ${stage.id}`).toBeInTheDocument();
    }
    expect(screen.getAllByText(/waiting/i).length).toBeGreaterThan(0);
  });

  it('labels unmeasurable stages honestly instead of faking a percentage', async () => {
    await openOptimise();
    expect(
      screen.getAllByText(/no measurable progress, so elapsed time is shown/i).length,
    ).toBeGreaterThan(0);
  });

  it('runs the pipeline and reports completion with real timings', async () => {
    await openOptimise();
    const start = (await screen.findAllByRole('button', { name: /start a live run/i }))[0];
    await act(async () => {
      fireEvent.click(start);
    });
    expect(await screen.findByText(/run complete/i)).toBeInTheDocument();
    // The sentence is assembled from several nodes, so assert on the text of
    // the paragraph that contains it rather than on a single text node.
    const summary = screen.getByText(/designs scored against/i);
    expect(summary.textContent).toMatch(/1,679,616/);
    expect(summary.textContent).toMatch(/3 plastics/i);
    expect(summary.textContent).toMatch(/Seed 42/i);
  });

  it('cancels a run that is in flight', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    // Hold the reply so the run stays in flight.
    liveWorkers[0].autoRespond = false;
    const start = (await screen.findAllByRole('button', { name: /start a live run/i }))[0];
    await act(async () => {
      fireEvent.click(start);
    });
    const cancel = await screen.findByRole('button', { name: /cancel the run/i });
    liveWorkers[0].autoRespond = true;
    await act(async () => {
      fireEvent.click(cancel);
    });
    expect(await screen.findByText(/run cancelled/i)).toBeInTheDocument();
  });

  it('drops a stale run reply after a newer run supersedes it', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    const worker = liveWorkers[0];

    // A reply tagged with a runId the app is not waiting for must be ignored.
    await act(async () => {
      worker.emit({
        kind: 'run',
        runId: 'run-does-not-exist',
        record: makeRunRecord('run-does-not-exist', 1, 999),
      });
    });
    expect(screen.queryByText(/run complete/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no run yet/i)).toBeInTheDocument();
  });

  it('surfaces a non-fatal worker error and lets it be dismissed', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      liveWorkers[0].emit({
        kind: 'error',
        runId: 'x',
        message: 'simulated allocation failure',
        stage: 'scoring',
        fatal: false,
      });
    });
    expect(await screen.findByText(/simulated allocation failure/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^dismiss$/i }));
    });
    await waitFor(() =>
      expect(screen.queryByText(/simulated allocation failure/i)).not.toBeInTheDocument(),
    );
  });
});

/* ================================================================== *
 * Compare screen
 * ================================================================== */
describe('Compare screen', () => {
  async function openCompareWithRun() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.compare.nav);
    await screen.findByText(SCREENS.compare.title);
  }

  it('shows a useful empty state before any run', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.compare.nav);
    expect(await screen.findByText(/no results to compare yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go to optimise/i })).toBeInTheDocument();
  });

  it('renders the podium, the table and the solver comparison after a run', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/top three designs/i)).toBeInTheDocument();
    expect(screen.getByText(/rank 1 - proven best/i)).toBeInTheDocument();
    expect(screen.getByText(/how the search methods compared/i)).toBeInTheDocument();
  });

  it('reports D-Wave as NOT EXECUTED rather than inventing a result', async () => {
    await openCompareWithRun();
    expect(screen.getAllByText(/D-Wave quantum annealer/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NOT EXECUTED/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NO QUANTUM HARDWARE EXECUTION/i).length).toBeGreaterThan(0);
  });

  it('warns that runtimes are device-specific before comparing them', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/read the environment before comparing times/i)).toBeInTheDocument();
  });

  it('filters candidates and shows an empty state when nothing matches', async () => {
    await openCompareWithRun();
    const search = screen.getByRole('searchbox');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'ZZZZ_NO_MATCH' } });
    });
    expect(await screen.findByText(/nothing matches that filter/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    });
    await waitFor(() => expect(screen.queryByText(/nothing matches/i)).not.toBeInTheDocument());
  });

  it('sorts the candidate table by a different column', async () => {
    await openCompareWithRun();
    const header = screen.getByRole('button', { name: /^PET/i });
    await act(async () => {
      fireEvent.click(header);
    });
    expect(screen.getByRole('button', { name: /PET \*/i })).toBeInTheDocument();
  });

  it('draws the trade-off chart only when asked, over the whole space', async () => {
    await openCompareWithRun();
    expect(screen.getByText(/trade-off chart not drawn yet/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /draw the trade-off chart/i }));
    });
    expect(
      (await screen.findAllByText(/PET score against worst off-target/i)).length,
    ).toBeGreaterThan(0);
    // The chart used to plot 1,200 random designs and was badged "Sampled".
    // It now bins every design and computes the exact frontier, so the
    // provenance must say Computed and the sampled badge must be gone.
    expect(screen.queryAllByText(/^Sampled$/i)).toHaveLength(0);
    expect(screen.getAllByText(/^Computed$/i).length).toBeGreaterThan(0);
    // The subtitle must name the full space, not a sample size.
    expect(screen.getAllByText(/all 1,679,616 designs, binned/i).length).toBeGreaterThan(0);
  });

  it('opens a candidate in the builder', async () => {
    await openCompareWithRun();
    const open = screen.getAllByRole('button', { name: /open in the builder/i })[0];
    await act(async () => {
      fireEvent.click(open);
    });
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Understand screen
 * ================================================================== */
describe('Understand screen', () => {
  async function openUnderstand(section?: RegExp) {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.understand.nav);
    await screen.findByText(SCREENS.understand.title, undefined, { timeout: LAZY_TIMEOUT });
    // The screen opens on "What is quantum here?", because that is the first
    // question anyone asks. Tests that want another section say so.
    if (section) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: section }));
      });
    }
  }

  it('answers "why 48 switches" with an interactive 8 x 6 grid', async () => {
    await openUnderstand(/why 48 switches/i);
    expect(screen.getByText(/why are there 48 switches/i)).toBeInTheDocument();
    const switches = screen.getAllByRole('button', { name: /^switch \d+: position/i });
    expect(switches).toHaveLength(48);
  });

  it('shows the constraint being violated when an extra switch is turned on', async () => {
    await openUnderstand(/why 48 switches/i);
    // Position 1's chosen family is index 2; turning on index 0 breaks the row.
    const extra = screen.getByRole('button', {
      name: /^switch 0: position 1, large aromatic ring/i,
    });
    await act(async () => {
      fireEvent.click(extra);
    });
    expect(await screen.findByText(/break the rule/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fix the rule/i }));
    });
    expect(await screen.findByText(/every row has exactly one switch on/i)).toBeInTheDocument();
  });

  it('renders the real QUBO heatmap with its coefficient statistics', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /the puzzle matrix/i }));
    });
    expect(await screen.findByText(/the puzzle, as a matrix/i)).toBeInTheDocument();
    const base = combineObjective(model.flat, 1);
    expect(
      await screen.findByText(safePenalty(base).toFixed(1)),
      'the real penalty bound must be displayed',
    ).toBeInTheDocument();
  });

  it('explains the scale trade-off and labels derived counts as estimates', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /scale and limits/i }));
    });
    expect(await screen.findByText(/how big does this get/i)).toBeInTheDocument();
    expect(screen.getByText(/25,600,000,000/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Model estimate$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/what the reduced alphabet costs us/i)).toBeInTheDocument();
  });

  it('runs the confidence checks and shows measured errors', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confidence centre/i }));
    });
    expect(await screen.findByRole('heading', { name: /confidence centre/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /re-run the checks/i }));
    });
    expect(await screen.findByText(/encoding round-trips/i)).toBeInTheDocument();
    expect(screen.getByText(/matrix vs direct score/i)).toBeInTheDocument();
  });

  it('explains why an R-squared of 1.0 is expected rather than hiding it', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.understand.nav);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /confidence centre/i }));
    });
    expect(
      await screen.findByText(/is normally a red flag/i),
    ).toBeInTheDocument();
  });

  it('publishes the legacy-tab migration map', async () => {
    await openUnderstand();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /about this project/i }));
    });
    expect(await screen.findByText(/where each part of the original tool lives now/i)).toBeInTheDocument();
    for (const legacy of ['Pipeline', 'Peptides', 'Sweep', 'Solvers', 'QUBO', 'Verify', 'Export', 'About', 'Honesty']) {
      expect(screen.getAllByText(legacy).length, `migration row for ${legacy}`).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Scale \(P1\)/)).toBeInTheDocument();
  });

  it('no longer carries a dedicated honesty tab, and says where it went', async () => {
    await openUnderstand();
    // The assessment is consolidated at the bottom of Results; a panel shown on
    // every screen stops being read.
    expect(screen.queryByRole('button', { name: /what this does not show/i })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /about this project/i }));
    });
    expect(await screen.findByText(/Scientific validity assessment/i)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Results screen
 * ================================================================== */
describe('Results screen', () => {
  async function openResultsWithRun() {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title);
    await act(async () => {
      fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
    });
    await screen.findByText(/run complete/i);
    await gotoScreen(SCREENS.results.nav);
    await screen.findByText(SCREENS.results.title);
  }

  it('shows a useful empty state before any run', async () => {
    await renderApp();
    await skipTour();
    await gotoScreen(SCREENS.results.nav);
    expect(await screen.findByText(/no run to write up yet/i)).toBeInTheDocument();
  });

  it('writes up the winner with all eight families named in full', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/the eight positions, named in full/i)).toBeInTheDocument();
    const table = screen.getByRole('table', {
      name: /each position of the selected design/i,
    });
    expect(within(table).getAllByRole('row')).toHaveLength(9); // header + 8
  });

  it('explains why the winner ranked first', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/why it ranked first/i)).toBeInTheDocument();
    expect(screen.getByText(/lowest value of any of the/i)).toBeInTheDocument();
  });

  it('defines selectivity and gives both margin variants', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/margin against the worst case/i)).toBeInTheDocument();
    expect(screen.getByText(/margin against the average/i)).toBeInTheDocument();
  });

  it('shows sensitivity to the priority dial', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/how sensitive is this answer/i)).toBeInTheDocument();
    expect(screen.getByText(/the winner depends on the dial you chose/i)).toBeInTheDocument();
  });

  it('records the run configuration including the seed', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/exactly how this run was configured/i)).toBeInTheDocument();
    expect(screen.getByText(/random seed/i)).toBeInTheDocument();
  });

  it('offers six real downloads, each with a non-empty preview', async () => {
    await openResultsWithRun();
    const buttons = screen.getAllByRole('button', { name: /^download$/i });
    expect(buttons).toHaveLength(6);
    expect(screen.getAllByText(/\.csv$/i).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/\.json$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\.md$/i).length).toBeGreaterThanOrEqual(1);
  });

  it('actually produces a file when a download is clicked', async () => {
    await openResultsWithRun();
    const clicked: string[] = [];
    const originalCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag);
      if (tag === 'a') {
        (element as HTMLAnchorElement).click = () => {
          clicked.push((element as HTMLAnchorElement).download);
        };
      }
      return element;
    });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => {},
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^download$/i })[0]);
    });
    expect(clicked.length, 'a download must have been triggered').toBeGreaterThan(0);
    expect(clicked[0]).toMatch(/top-candidates.*\.csv$/);
    spy.mockRestore();
  });

  it('states the privacy position and offers a full reset', async () => {
    await openResultsWithRun();
    expect(screen.getByText(/nothing on this screen was uploaded anywhere/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset everything and start over/i }));
    });
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Shared-link handling (untrusted input reaching the UI)
 * ================================================================== */
describe('shared links', () => {
  it('applies a valid design from the URL hash', async () => {
    window.history.pushState({}, '', '/build#s=45012345&l=2');
    await renderApp();
    await skipTour();
    await screen.findByText(SCREENS.build.title);
    await waitFor(() =>
      expect(screen.getByText(classSequence([4, 5, 0, 1, 2, 3, 4, 5]))).toBeInTheDocument(),
    );
  });

  it('ignores a malformed hash without crashing', async () => {
    window.history.pushState({}, '', '/build#s=notvalid&l=999');
    await renderApp();
    await skipTour();
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
    // Falls back to the reference design rather than erroring.
    await waitFor(() =>
      expect(screen.getByText(classSequence([2, 3, 0, 0, 2, 2, 1, 2]))).toBeInTheDocument(),
    );
  });

  it('ignores an out-of-range class digit in the hash', async () => {
    window.history.pushState({}, '', '/build#s=99999999');
    await renderApp();
    await skipTour();
    expect(await screen.findByText(SCREENS.build.title)).toBeInTheDocument();
  });
});

/* ================================================================== *
 * Worker-unavailable degradation
 * ================================================================== */
describe('degradation when the worker cannot start', () => {
  it('keeps the site readable and says why scoring is off', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker is blocked in this environment');
        }
      },
    );
    render(<App />);
    // The site must stay readable; only computation is lost.
    expect(
      await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/could not start the computation worker/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Worker is blocked in this environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload the page/i })).toBeInTheDocument();
  });
});
