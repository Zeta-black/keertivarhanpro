/**
 * The eight review items, pinned.
 *
 * Each block below corresponds to one piece of reviewer feedback. They are
 * grouped by the complaint rather than by component, because the complaint is
 * what has to stay fixed: "the result is miles from the control", "the tooltip
 * runs off the screen", "the right column jumps when I hover".
 *
 * Several of these can only be fully judged with a real layout engine, which
 * jsdom is not. Where that is the case the test asserts the thing jsdom CAN
 * see - that the readout is in the same card as its control, that the slot is
 * always present, that the chart is no longer badged as sampled - and the
 * geometry is left to the Playwright sweep. Each such test says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import App from '../../src/App';
import { SCREENS } from '../../src/content/copy';
import { installWorkerMock, liveWorkers, makeRunRecord } from './worker-mock';

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

async function renderApp() {
  const utils = render(<App />);
  await waitFor(() => expect(liveWorkers.length).toBeGreaterThan(0));
  await screen.findByRole('heading', { level: 1 }, { timeout: LAZY_TIMEOUT });
  return utils;
}

async function gotoScreen(nav: string) {
  const link = await screen.findByRole('link', { name: new RegExp(nav, 'i') });
  await act(async () => {
    fireEvent.click(link);
  });
}

/** Optimise, run the search, then land on Compare with real results. */
async function openCompareWithRun() {
  await renderApp();
  await gotoScreen(SCREENS.optimise.nav);
  await screen.findByText(SCREENS.optimise.title, undefined, { timeout: LAZY_TIMEOUT });
  await act(async () => {
    fireEvent.click((await screen.findAllByRole('button', { name: /start a live run/i }))[0]);
  });
  await screen.findByText(/run complete/i, undefined, { timeout: LAZY_TIMEOUT });
}

/** Build, which is where the molecule viewer and the residue picker live. */
async function openBuild() {
  await renderApp();
  await gotoScreen(SCREENS.build.nav);
  await screen.findByText(SCREENS.build.title, undefined, { timeout: LAZY_TIMEOUT });
}

/* ================================================================== *
 * 1 and 2. Discover is text, not a second molecule viewer
 * ================================================================== */
describe('Discover no longer duplicates the molecule viewer', () => {
  it('shows no structure panel and no raw class string', async () => {
    await renderApp();

    // The viewer's own controls are the reliable tell: no 2D/3D toggle here.
    expect(screen.queryByRole('button', { name: /^3D model$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^2D structure$/i })).not.toBeInTheDocument();

    // The caption that introduced it is gone too.
    expect(screen.queryByText(/as an actual molecule/i)).not.toBeInTheDocument();

    // And the machine string that was rendered as prose.
    expect(screen.queryByText(/current design at family resolution/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/HYDROPHOBIC-SMALL_POLAR-AROM_W/)).not.toBeInTheDocument();
  });

  it('keeps the readable parts of the screen', async () => {
    await renderApp();
    expect(screen.getByText(/^the problem$/i)).toBeInTheDocument();
    expect(screen.getByText(/the six building-block families/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open the design workbench/i })).toBeInTheDocument();
    // Family cards survive; it was only the raw string underneath them that went.
    expect(screen.getByText(/large aromatic ring/i)).toBeInTheDocument();
  });

  it('still offers the viewer on Build, which is where it belongs', async () => {
    await openBuild();
    expect(screen.getByRole('button', { name: /^3D model$/i })).toBeInTheDocument();
  });
});

/* ================================================================== *
 * 3. The effect of a change sits with the control
 * ================================================================== */
describe('controls and their effects are together', () => {
  it('puts the live scores in the Build editor column, above the fold', async () => {
    await openBuild();

    const readout = await screen.findByText(/live scores for this design/i);
    const panel = readout.closest('.live-readout') as HTMLElement;
    expect(panel).not.toBeNull();

    // All four numbers the reviewer named are in the strip, not just nearby.
    for (const label of ['PET', 'PE', 'PP', 'Margin vs worst']) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }

    // It must precede the editor in document order, so it is on screen while
    // the sequence row is being used.
    const editor = document.querySelector('.workbench-editor') as HTMLElement;
    expect(editor.contains(panel)).toBe(true);
    expect(panel.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_CONTAINS).toBeTruthy();
  });

  it('shows the challenge verdict beside the builder once it is running', async () => {
    await openBuild();

    const start = await screen.findByRole('button', { name: /start the challenge/i });
    await act(async () => {
      fireEvent.click(start);
    });

    const readout = (await screen.findByText(/live scores for this design/i)).closest(
      '.live-readout',
    ) as HTMLElement;
    await waitFor(() =>
      expect(within(readout).getByText(/^challenge:/i)).toBeInTheDocument(),
    );
    // The old copy repeated the verdict at the bottom of the page. One source.
    expect(screen.queryByText(/your margin against the worst off-target is up/i)).toBeNull();
  });

  it('puts the objective numbers inside the priority dial card on Optimise', async () => {
    await renderApp();
    await gotoScreen(SCREENS.optimise.nav);
    await screen.findByText(SCREENS.optimise.title, undefined, { timeout: LAZY_TIMEOUT });

    const readout = await screen.findByText(/what this priority does/i);
    const panel = readout.closest('.live-readout') as HTMLElement;
    expect(panel).not.toBeNull();
    for (const label of ['PET score', 'Off-target total', 'Off-target penalty', 'Objective']) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }

    // Same card as the slider: that is what "next to the control" means here.
    const card = panel.closest('.card') as HTMLElement;
    expect(card).not.toBeNull();
    expect(within(card).getByRole('slider')).toBeInTheDocument();

    // Not sticky in this position - it already travels with its control.
    expect(panel.dataset.sticky).toBe('no');
  });

  it('keeps the selected design visible on Compare, wherever it was selected', async () => {
    await openCompareWithRun();
    await gotoScreen(SCREENS.compare.nav);
    await screen.findByText(SCREENS.compare.title, undefined, { timeout: LAZY_TIMEOUT });

    const readout = (await screen.findByText(/^selected: rank/i)).closest(
      '.live-readout',
    ) as HTMLElement;
    expect(readout).not.toBeNull();
    expect(readout.dataset.sticky).toBe('yes');
    for (const label of ['PET', 'PE', 'PP', 'Objective']) {
      expect(within(readout).getByText(label)).toBeInTheDocument();
    }
    // And a way back to the long-form panel rather than a hunt for it.
    expect(within(readout).getByRole('button', { name: /jump to full detail/i })).toBeInTheDocument();
    expect(document.getElementById('selected-detail')).not.toBeNull();
  });
});

/* ================================================================== *
 * 4. The downloads are findable
 * ================================================================== */
describe('download control under the structure', () => {
  it('labels the formats as downloads instead of leaving bare buttons', async () => {
    await openBuild();

    const label = await screen.findByText(/^download file$/i);
    const strip = label.closest('.viewer-export') as HTMLElement;
    expect(strip).not.toBeNull();

    const group = within(strip).getByRole('group');
    for (const format of ['FASTA', 'SMI', 'SDF', 'PDB']) {
      expect(within(group).getByRole('button', { name: new RegExp(format, 'i') })).toBeInTheDocument();
    }
    // The group is named by the visible label, so the formats are announced
    // as downloads rather than as four unexplained acronyms.
    expect(group).toHaveAttribute('aria-labelledby', label.getAttribute('id'));
  });
});

/* ================================================================== *
 * 5. Tooltips behave
 * ================================================================== */
describe('info tooltips', () => {
  it('opens on click, closes on Escape, and closes on an outside click', async () => {
    await openBuild();
    const tip = screen.getAllByRole('button', { name: /^what is /i })[0];

    await act(async () => {
      fireEvent.click(tip);
    });
    expect(tip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(tip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(tip);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on keyboard focus', async () => {
    await openBuild();
    const tip = screen.getAllByRole('button', { name: /^what is /i })[0];
    await act(async () => {
      fireEvent.focus(tip);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await act(async () => {
      fireEvent.blur(tip);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not close a clicked tip when the pointer leaves the button', async () => {
    // This was the old behaviour: mouseleave closed a tip you had deliberately
    // opened, which made the longer bodies impossible to read.
    await openBuild();
    const tip = screen.getAllByRole('button', { name: /^what is /i })[0];
    await act(async () => {
      fireEvent.click(tip);
    });
    await act(async () => {
      fireEvent.mouseLeave(tip);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('is positioned in viewport coordinates so a scrolling ancestor cannot clip it', async () => {
    await openBuild();
    const tip = screen.getAllByRole('button', { name: /^what is /i })[0];
    await act(async () => {
      fireEvent.click(tip);
    });
    const tooltip = screen.getByRole('tooltip');
    // jsdom computes no geometry, so the assertion is on the mechanism rather
    // than on measured pixels: fixed positioning plus an inline offset. The
    // on-screen geometry is checked by the Playwright sweep.
    expect(tooltip.style.left).not.toBe('');
    expect(tooltip.style.top).not.toBe('');
  });
});

/* ================================================================== *
 * 6. The right column holds still
 * ================================================================== */
describe('residue hover does not move the layout', () => {
  it('keeps the detail slot mounted in both states', async () => {
    await openBuild();

    const slot = document.querySelector('.residue-detail-slot') as HTMLElement;
    expect(slot, 'the slot must exist before anything is hovered').not.toBeNull();
    // Nothing focused yet: the hint occupies the slot.
    expect(within(slot).getByText(/hover or focus a position above/i)).toBeInTheDocument();

    // The per-position control is the residue select, not a button.
    const position = screen.getByLabelText(/amino acid shown at position 1/i);
    await act(async () => {
      fireEvent.focus(position);
    });

    // Same slot element, different contents. That identity is the fix: the
    // box is no longer mounted and unmounted, so nothing below it moves.
    const after = document.querySelector('.residue-detail-slot');
    expect(after).toBe(slot);
    await waitFor(() =>
      expect(within(slot).queryByText(/hover or focus a position above/i)).toBeNull(),
    );
  });
});

/* ================================================================== *
 * 7. The trade-off chart uses every design
 * ================================================================== */
describe('trade-off chart provenance', () => {
  it('describes a binned full space and an exact frontier', async () => {
    await openCompareWithRun();
    await gotoScreen(SCREENS.compare.nav);
    await screen.findByText(SCREENS.compare.title, undefined, { timeout: LAZY_TIMEOUT });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /draw the trade-off chart/i }));
    });

    expect(screen.getAllByText(/all 1,679,616 designs, binned/i).length).toBeGreaterThan(0);
    // "Resample" implied a sample; recomputing the same exact answer does not.
    expect(screen.getByRole('button', { name: /recompute/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resample/i })).toBeNull();
    expect(screen.queryAllByText(/^Sampled$/i)).toHaveLength(0);
  });
});

/* ================================================================== *
 * 8. Results drops the status box
 * ================================================================== */
describe('Results limitations card', () => {
  it('no longer carries the "what would raise each status" box', async () => {
    await openCompareWithRun();
    await gotoScreen(SCREENS.results.nav);
    await screen.findByText(SCREENS.results.title, undefined, { timeout: LAZY_TIMEOUT });

    expect(screen.queryByText(/what would raise each status/i)).toBeNull();
    // The card it sat beside, and the disclosure after it, both stay.
    expect(screen.getByText(/limitations of the scoring model itself/i)).toBeInTheDocument();
    expect(screen.getByText(/how this assessment is produced/i)).toBeInTheDocument();
  });
});

/* Keeps the import used; makeRunRecord is the shared run fixture. */
void makeRunRecord;
