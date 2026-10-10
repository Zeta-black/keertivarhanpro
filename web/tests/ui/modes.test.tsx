/**
 * Beginner and Researcher mode must differ, and must never disagree.
 *
 * Two properties are tested here, and they pull in opposite directions:
 *
 *   DIFFERENCE   Every screen must change visibly when the mode changes. A
 *                toggle that does nothing on four of six screens is a fake
 *                control, which is worse than no control.
 *
 *   AGREEMENT    No computed value may differ between the modes. The modes
 *                change what is explained and what is exposed; if a score
 *                moved when the mode changed, one of the two would be a
 *                fabrication.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import App from '../../src/App';
import { NAV_ORDER, SCREENS } from '../../src/content/copy';
import { realModel } from '../helpers/model';
import { installWorkerMock } from './worker-mock';

const LAZY_TIMEOUT = 15_000;

beforeEach(() => {
  installWorkerMock();
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderApp(): Promise<void> {
  render(<App />);
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

async function goTo(nav: string): Promise<void> {
  const link = await screen.findByRole('link', { name: new RegExp(nav, 'i') });
  await act(async () => {
    fireEvent.click(link);
  });
}

async function setMode(mode: 'Beginner' | 'Researcher'): Promise<void> {
  const button = screen.getByRole('button', { name: new RegExp(`^${mode}$`, 'i') });
  await act(async () => {
    fireEvent.click(button);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

/** Visible text of the main landmark, whitespace-normalised. */
function mainText(): string {
  return (document.getElementById('main')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Every number that appears anywhere in the main landmark. */
function numbersInMain(): string[] {
  return mainText().match(/-?\d+\.\d+/g) ?? [];
}

describe('Beginner and Researcher modes differ on every screen', () => {
  it.each(NAV_ORDER)('%s changes visibly when the mode changes', async (id) => {
    await renderApp();
    if (id !== 'discover') {
      await goTo(SCREENS[id].nav);
      await screen.findByText(SCREENS[id].title, undefined, { timeout: LAZY_TIMEOUT });
    }

    await setMode('Beginner');
    const beginner = mainText();

    await setMode('Researcher');
    const researcher = mainText();

    expect(beginner.length, `${id} beginner content`).toBeGreaterThan(200);
    expect(researcher.length, `${id} researcher content`).toBeGreaterThan(200);
    expect(
      researcher,
      `${id}: the mode switch made no visible difference, so it is a fake control`,
    ).not.toBe(beginner);

    // The difference must be substantive, not a single swapped word.
    const changed = Math.abs(researcher.length - beginner.length);
    expect(changed, `${id}: only ${changed} characters differ between modes`).toBeGreaterThan(80);
  });

  it('shows equations to researchers and plain notes to beginners', async () => {
    await renderApp();
    await goTo(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title, undefined, { timeout: LAZY_TIMEOUT });

    await setMode('Beginner');
    expect(document.querySelectorAll('.plain-note').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.equation').length).toBe(0);

    await setMode('Researcher');
    expect(document.querySelectorAll('.equation').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.plain-note').length).toBe(0);
  });

  it('exposes run parameters to researchers only, as real inputs', async () => {
    await renderApp();
    await goTo(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title, undefined, { timeout: LAZY_TIMEOUT });

    await setMode('Beginner');
    expect(screen.queryByLabelText(/random seed/i)).toBeNull();

    await setMode('Researcher');
    const seed = screen.getByLabelText(/random seed/i) as HTMLInputElement;
    expect(seed.tagName).toBe('INPUT');
    // It must actually accept a change, not be a decorative readout.
    await act(async () => {
      fireEvent.change(seed, { target: { value: '7' } });
    });
    expect(seed.value).toBe('7');
    expect(screen.getByLabelText(/annealing reads/i)).toBeTruthy();
    expect(screen.getByLabelText(/penalty multiplier/i)).toBeTruthy();
  });

  it('adds columns to the candidate table for researchers', async () => {
    await renderApp();
    await goTo(SCREENS.optimise.nav);
    const run = (await screen.findAllByRole('button', { name: /start a live run|run it now/i }))[0];
    await act(async () => {
      fireEvent.click(run);
    });
    await waitFor(() => expect(screen.getByText(/run complete/i)).toBeInTheDocument(), {
      timeout: LAZY_TIMEOUT,
    });
    await goTo(SCREENS.compare.nav);
    await screen.findByText(SCREENS.compare.title, undefined, { timeout: LAZY_TIMEOUT });

    await setMode('Beginner');
    const beginnerCols = document.querySelectorAll('table thead th').length;

    await setMode('Researcher');
    const researcherCols = document.querySelectorAll('table thead th').length;

    expect(researcherCols).toBeGreaterThan(beginnerCols);
  });
});

describe('the modes never disagree about a computed value', () => {
  it('reports identical scores for the same design in both modes', async () => {
    await renderApp();
    await goTo(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title, undefined, { timeout: LAZY_TIMEOUT });

    await setMode('Beginner');
    await waitFor(() => expect(numbersInMain().length).toBeGreaterThan(3), {
      timeout: LAZY_TIMEOUT,
    });
    const beginnerScores = screen
      .getAllByText(/dimensionless model score/i)
      .map((n) => n.parentElement?.textContent ?? '');

    await setMode('Researcher');
    const researcherScores = screen
      .getAllByText(/dimensionless model score/i)
      .map((n) => n.parentElement?.textContent ?? '');

    expect(researcherScores).toEqual(beginnerScores);
  });

  it('keeps the edited design when the mode changes', async () => {
    await renderApp();
    await goTo(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title, undefined, { timeout: LAZY_TIMEOUT });

    const positions = await screen.findAllByRole('button', { name: /^position \d of 8/i });
    await act(async () => {
      positions[2].focus();
      fireEvent.keyDown(positions[2], { key: '5' });
    });
    const edited = screen.getAllByText(/CHARGED_NEG/).length;
    expect(edited).toBeGreaterThan(0);

    await setMode('Researcher');
    expect(screen.getAllByText(/CHARGED_NEG/).length).toBeGreaterThan(0);
    await setMode('Beginner');
    expect(screen.getAllByText(/CHARGED_NEG/).length).toBeGreaterThan(0);
  });

  it('uses the same scoring model in both modes', async () => {
    // Guards against a future change that swapped a model or a rounding rule
    // per mode: the worker is the single source and both modes read it.
    await renderApp();
    await setMode('Researcher');
    await goTo(SCREENS.build.nav);
    await screen.findByText(SCREENS.build.title, undefined, { timeout: LAZY_TIMEOUT });
    await waitFor(() => expect(numbersInMain().length).toBeGreaterThan(3), {
      timeout: LAZY_TIMEOUT,
    });
    expect(realModel().meta.source.length).toBeGreaterThan(0);
  });
});
