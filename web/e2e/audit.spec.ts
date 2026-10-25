/**
 * Adversarial end-to-end audit, in a real browser, against the production build.
 *
 * Written from the position that nothing works until observed. Every assertion
 * here is something jsdom could not prove: that the canvas actually paints,
 * that the Web Worker actually starts and scores 1,679,616 sequences, that the
 * exported numbers match what is on screen, that nothing logs a console error,
 * and that the app survives being abused.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const ROUTES = [
  '/',
  '/build',
  '/optimise',
  '/compare',
  '/quantum',
  '/understand',
  '/results',
] as const;

/** Console noise that is expected and not a defect. */
const BENIGN = [
  /Download the React DevTools/i,
  /\[vite\]/i,
];

interface Collected {
  errors: string[];
  warnings: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/** Attach listeners that fail the test on any genuine error. */
function collect(page: Page): Collected {
  const out: Collected = { errors: [], warnings: [], pageErrors: [], failedRequests: [] };
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (BENIGN.some((r) => r.test(text))) return;
    if (message.type() === 'error') out.errors.push(text);
    if (message.type() === 'warning') out.warnings.push(text);
  });
  page.on('pageerror', (error) => out.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    out.failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText}`);
  });
  return out;
}

/** Dismiss the first-run tour if it appears. */
async function skipTour(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /^skip$/i });
  try {
    await skip.waitFor({ state: 'visible', timeout: 3000 });
    await skip.click();
  } catch {
    // Already seen, or this scenario does not show it.
  }
}

/** Run the full pipeline and wait for genuine completion. */
async function runPipeline(page: Page): Promise<void> {
  await page.goto('/optimise');
  await skipTour(page);
  await page.getByRole('button', { name: /start a live run/i }).first().click();
  await expect(page.getByText(/run complete/i)).toBeVisible({ timeout: 90_000 });
}

/* ================================================================== *
 * 1. Does it even load, in a real browser, with no errors?
 * ================================================================== */
test.describe('startup and route coverage', () => {
  for (const route of ROUTES) {
    test(`${route} renders with no console or network errors`, async ({ page }) => {
      const log = collect(page);
      const response = await page.goto(route);
      expect(response?.status(), `${route} HTTP status`).toBe(200);

      // A real h1 must be painted, not merely present in the DOM.
      const h1 = page.locator('h1');
      await expect(h1).toHaveCount(1);
      await expect(h1).toBeVisible();

      await skipTour(page);
      // Give lazy chunks and the worker handshake time to settle.
      await page.waitForLoadState('networkidle');

      expect(log.pageErrors, `${route} uncaught exceptions`).toEqual([]);
      expect(log.errors, `${route} console errors`).toEqual([]);
      expect(log.failedRequests, `${route} failed requests`).toEqual([]);
    });
  }

  // Six widths across seven routes is 42 full navigations; the default
  // per-test timeout is not meant for a sweep this size.
  test('the page body never scrolls sideways at any viewport', async ({ page }) => {
    test.setTimeout(300_000);
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(route);
        await skipTour(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} at ${width}px overflows by ${overflow}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('no element renders text below 12px', async ({ page }) => {
    await page.goto('/');
    await skipTour(page);
    const tooSmall = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!(el instanceof HTMLElement)) continue;
        if (!el.textContent?.trim()) continue;
        // Only leaf-ish nodes carry their own text.
        if (el.children.length > 0) continue;
        // Chemical subscripts and superscripts are notation: the smaller size
        // is what distinguishes C58 from C58. They are exempt from the body
        // minimum, but nothing else is.
        if (el.tagName === 'SUB' || el.tagName === 'SUP') continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size > 0 && size < 12) {
          bad.push(`${el.tagName}.${el.className} = ${size}px: ${el.textContent.slice(0, 40)}`);
        }
      }
      return bad;
    });
    expect(tooSmall).toEqual([]);
  });
});

/* ================================================================== *
 * 2. Are the molecular structures real? jsdom could never answer this.
 *
 * The 2D depiction is produced by RDKit (WebAssembly) and the 3D model by
 * 3Dmol.js (WebGL). Neither runs under jsdom, so these are the only tests
 * that can prove a visitor actually sees a chemical structure rather than a
 * loading state.
 * ================================================================== */
test.describe('molecular structure rendering', () => {
  /** Counts the drawn vector paths inside the RDKit depiction. */
  async function depictionPaths(page: import('@playwright/test').Page) {
    return page.evaluate(
      () => document.querySelectorAll('.struct2d-figure svg path').length,
    );
  }

  test('the landing page shows a real chemical structure, with no fake animation', async ({
    page,
  }) => {
    const log = collect(page);
    await page.goto('/');
    await skipTour(page);

    // The old illustrative canvas and its controls must be gone for good.
    await expect(page.getByRole('button', { name: /pause rotation/i })).toHaveCount(0);
    await expect(page.getByText(/drag to rotate/i)).toHaveCount(0);
    await expect(page.getByText(/^illustrative$/i)).toHaveCount(0);

    // A peptide structure diagram: eight residues give a lot of bonds, and a
    // blank or placeholder drawing has none.
    const figure = page.locator('.struct2d-figure svg').first();
    await expect(figure).toBeVisible({ timeout: 30_000 });
    expect(await depictionPaths(page), 'drawn bonds and atom labels').toBeGreaterThan(60);

    const box = await figure.boundingBox();
    expect(box?.width ?? 0, 'depiction width').toBeGreaterThan(200);
    expect(box?.height ?? 0, 'depiction height').toBeGreaterThan(120);

    // The structure identifies itself with its real composition.
    await expect(page.getByText(/C58H80N10O10/).first()).toBeVisible();
    await expect(page.getByText(/heavy atoms/i).first()).toBeVisible();

    expect(log.pageErrors).toEqual([]);
    expect(log.errors).toEqual([]);
  });

  test('the 3D model renders a real scene that responds to the controls', async ({ page }) => {
    const log = collect(page);
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });

    await page.getByRole('button', { name: /3D model/i }).first().click();
    const canvas = page.locator('.struct3d-host canvas').first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0, 'viewer width').toBeGreaterThan(200);
    expect(box?.height ?? 0, 'viewer height').toBeGreaterThan(180);
    await page.waitForTimeout(1500);

    // 3Dmol owns the WebGL context, so the page cannot read it back with
    // getContext. Comparing rendered frames is a stronger check in any case:
    // it proves the viewer is drawing the molecule it was handed.
    const ballAndStick = await canvas.screenshot();
    expect(ballAndStick.byteLength, 'a blank canvas compresses to almost nothing').toBeGreaterThan(
      3000,
    );

    await page.getByLabel(/representation/i).selectOption('spaceFill');
    await page.waitForTimeout(1200);
    const spaceFilling = await canvas.screenshot();
    expect(
      spaceFilling.equals(ballAndStick),
      'changing the representation must change what is drawn',
    ).toBe(false);

    await page.getByLabel(/backbone torsions/i).selectOption('helix');
    await page.waitForTimeout(1200);
    const helix = await canvas.screenshot();
    expect(
      helix.equals(spaceFilling),
      'changing the backbone torsions must change the conformer',
    ).toBe(false);

    // The conformer must describe itself honestly, right under the viewer.
    await expect(page.getByText(/generated conformer/i).first()).toBeVisible();
    await expect(page.getByText(/not an experimental structure/i).first()).toBeVisible();

    expect(log.pageErrors).toEqual([]);
  });

  test('the structure follows the residues chosen in the workbench', async ({ page }) => {
    const log = collect(page);
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });

    const formula = page.locator('.viewer-formula').first();
    await expect(formula).toContainText('C58');
    const before = await depictionPaths(page);

    // Position 2 is the small-polar family: swap serine for glutamine, which
    // is a bigger molecule, and the drawing must change with it.
    const select = page.getByLabel(/amino acid shown at position 2/i);
    await select.selectOption('Q');

    await expect(formula).toContainText('C60', { timeout: 30_000 });
    await expect
      .poll(async () => depictionPaths(page), { timeout: 30_000 })
      .not.toBe(before);

    expect(log.pageErrors).toEqual([]);
  });

  test('the 3D viewer responds to dragging and scrolling', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /3D model/i }).first().click();
    const canvas = page.locator('.struct3d-host canvas').first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);

    const box = (await canvas.boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    const before = await canvas.screenshot();

    // Drag to rotate.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 150, centre.y + 60, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
    const rotated = await canvas.screenshot();
    expect(rotated.equals(before), 'dragging must rotate the molecule').toBe(false);

    // Scroll to zoom.
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(900);
    const zoomed = await canvas.screenshot();
    expect(zoomed.equals(rotated), 'scrolling must zoom the molecule').toBe(false);
  });

  test('switching the displayed residue leaves every score untouched', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });

    // Read the four score tiles before the change.
    const scores = page.locator('.stat .stat-value');
    await expect(scores.first()).toBeVisible({ timeout: 30_000 });
    const before = await scores.allInnerTexts();
    expect(before.length).toBeGreaterThan(3);

    await page.getByLabel(/amino acid shown at position 2/i).selectOption('T');
    await page.waitForTimeout(1200);

    // Depiction is residue-level; optimisation is class-level. The molecule
    // changes, the class sequence does not, so no score may move.
    await expect(page.locator('.viewer-formula').first()).toContainText('C59');
    expect(await scores.allInnerTexts()).toEqual(before);
  });

  test('the guided tour runs end to end and can be restarted', async ({ page }) => {
    await page.goto('/');
    // Nothing opens on its own.
    await expect(page.getByRole('dialog', { name: /quick tour/i })).toHaveCount(0);

    await page.getByRole('button', { name: /take the guided tour/i }).first().click();
    const dialog = page.getByRole('dialog', { name: /quick tour/i });
    await expect(dialog).toBeVisible();

    // Walk every step; the final button finishes rather than advancing.
    for (let i = 0; i < 12; i += 1) {
      const next = dialog.getByRole('button', { name: /next|start exploring/i });
      if (!(await next.count())) break;
      const label = (await next.innerText()).toLowerCase();
      await next.click();
      if (label.includes('start exploring')) break;
      await page.waitForTimeout(150);
    }
    await expect(dialog).toHaveCount(0);

    // It can be reopened afterwards.
    await page.getByRole('button', { name: /take the guided tour/i }).first().click();
    await expect(page.getByRole('dialog', { name: /quick tour/i })).toBeVisible();
    await page.getByRole('button', { name: /^skip$/i }).click();
    await expect(page.getByRole('dialog', { name: /quick tour/i })).toHaveCount(0);
  });

  test('every exported structure file downloads with real content', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });

    for (const format of ['FASTA', 'SMI', 'SDF', 'PDB']) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: new RegExp(`^${format}$`) }).first().click(),
      ]);
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      expect(text.length, `${format} file size`).toBeGreaterThan(20);
      if (format === 'PDB') {
        expect(text, 'PDB must contain ATOM records').toMatch(/^ATOM {2}/m);
        expect(text).toMatch(/GENERATED CONFORMER/);
      }
      if (format === 'SDF') expect(text).toContain('V2000');
      if (format === 'FASTA') expect(text).toMatch(/^>/);
      if (format === 'SMI') expect(text).toMatch(/\[C@@H\]/);
    }
  });
});

/* ================================================================== *
 * 3. The worker: does it really score 1,679,616 sequences?
 * ================================================================== */
test.describe('computation pipeline in a real browser', () => {
  test('a full live run completes and reports the real search-space size', async ({ page }) => {
    const log = collect(page);
    const started = Date.now();
    await runPipeline(page);
    const elapsed = Date.now() - started;

    // The summary must name the real space, not a rounded marketing number.
    await expect(page.getByText(/1,679,616 designs scored against 3 plastics/i)).toBeVisible();

    // Every one of the nine stages must have finished.
    const stageTable = page.getByRole('table', { name: /measured time per pipeline stage/i });
    await expect(stageTable).toBeVisible();
    const rows = stageTable.locator('tbody tr');
    await expect(rows).toHaveCount(9);
    // No stage may report "not available" after a successful run.
    await expect(stageTable.getByText(/not available/i)).toHaveCount(0);

    expect(log.pageErrors, 'uncaught exceptions during the run').toEqual([]);
    expect(log.errors, 'console errors during the run').toEqual([]);
    // Sanity: a real full-space run is not instantaneous and not forever.
    expect(elapsed, 'run wall-clock').toBeGreaterThan(300);
    expect(elapsed).toBeLessThan(90_000);
  });

  test('the worker chunk is actually fetched over the network', async ({ page }) => {
    const workerRequests: string[] = [];
    page.on('request', (r) => {
      if (/pipeline\.worker/.test(r.url())) workerRequests.push(r.url());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(workerRequests.length, 'the worker script must be requested').toBeGreaterThan(0);
  });

  test('the model JSON is fetched and is the real 49 KB coefficient file', async ({ page }) => {
    let size = 0;
    let status = 0;
    page.on('response', async (r) => {
      if (/potts_6class_8mer\.json/.test(r.url())) {
        status = r.status();
        size = (await r.body().catch(() => Buffer.alloc(0))).length;
      }
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(status, 'model fetch status').toBe(200);
    expect(size, 'model byte size').toBeGreaterThan(40_000);
  });

  test('the main thread stays responsive while the worker computes', async ({ page }) => {
    await page.goto('/optimise');
    await skipTour(page);
    await page.getByRole('button', { name: /start a live run/i }).first().click();

    // While it runs, the UI must still respond to input. If scoring were on the
    // main thread this click would be queued behind seconds of computation.
    const cancel = page.getByRole('button', { name: /cancel the run/i });
    await expect(cancel).toBeVisible({ timeout: 10_000 });

    const t0 = Date.now();
    await page.getByRole('link', { name: /understand/i }).click();
    await expect(page.getByText(/how the maths works/i)).toBeVisible({ timeout: 15_000 });
    const navMs = Date.now() - t0;
    expect(navMs, 'navigation while the worker computes').toBeLessThan(15_000);
  });

  test('cancelling a run really stops it and says so', async ({ page }) => {
    await page.goto('/optimise');
    await skipTour(page);
    await page.getByRole('button', { name: /start a live run/i }).first().click();
    await page.getByRole('button', { name: /cancel the run/i }).click();
    await expect(page.getByText(/run cancelled/i)).toBeVisible({ timeout: 20_000 });
    // And no partial run must have been published.
    await expect(page.getByText(/run complete/i)).toHaveCount(0);
  });
});

/* ================================================================== *
 * 4. Scientific agreement: screen vs export vs published benchmark
 *
 * NOTE: results live in memory for the session only, by design - a reload
 * deliberately returns to a cold state rather than resurrecting a run whose
 * inputs the user can no longer see. These tests therefore navigate by
 * clicking links, as a user does, instead of calling page.goto().
 * ================================================================== */
test.describe('scientific correctness, observed in the browser', () => {
  test('the winning design at lambda=1 matches the published Python benchmark', async ({ page }) => {
    await runPipeline(page);
    await page.getByRole('link', { name: /results/i }).click();

    // results/selectivity_sweep.csv rank 1 at lambda = 1.
    const PUBLISHED = 'HYDROPHOBIC-SMALL_POLAR-AROM_W-AROM_W-HYDROPHOBIC-HYDROPHOBIC-AROM_FY-HYDROPHOBIC';
    await expect(page.getByText(PUBLISHED).first()).toBeVisible();
    await expect(page.getByText('LSWWLLFL').first()).toBeVisible();
  });

  test('the downloaded CSV contains the same numbers shown on screen', async ({ page }) => {
    await runPipeline(page);
    await page.getByRole('link', { name: /results/i }).click();

    // Read the objective the UI displays for the winner.
    const shown = await page
      .locator('.stat', { hasText: /^Objective/i })
      .locator('.stat-value')
      .first()
      .innerText();

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /^download$/i }).first().click(),
    ]).then(([d]) => d);

    const path = await download.path();
    expect(path, 'download path').toBeTruthy();
    const fs = await import('node:fs');
    const csv = fs.readFileSync(path!, 'utf8');

    expect(download.suggestedFilename()).toMatch(/top-candidates.*\.csv$/);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length, 'header + 10 candidates').toBe(11);
    expect(lines[0]).toContain('class_sequence');
    expect(lines[0]).toContain('PET_canonical_binding_score');

    // The rank-1 row's objective must round to the displayed value.
    const rank1 = lines[1].split(',');
    const objectiveIndex = lines[0].split(',').indexOf('objective');
    const exported = Number(rank1[objectiveIndex]);
    expect(Number.isFinite(exported), 'exported objective is numeric').toBe(true);
    expect(exported.toFixed(3)).toBe(Number(shown).toFixed(3));
  });

  test('all six exports download real, non-empty, correctly-typed files', async ({ page }) => {
    await runPipeline(page);
    await page.getByRole('link', { name: /results/i }).click();
    await expect(page.getByRole('button', { name: /^download$/i })).toHaveCount(6);

    // Each card is addressed by its own filename. Indexing the /^download$/
    // list would be wrong: a clicked button relabels itself to "Saved", which
    // shrinks the list and shifts every later index.
    const filenames = await page
      .locator('code')
      .filter({ hasText: /_lambda.*_seed.*\.(csv|json|md)$/ })
      .allInnerTexts();
    expect(filenames, 'six export filenames must be listed').toHaveLength(6);

    const fs = await import('node:fs');
    const seen: string[] = [];
    for (const filename of filenames) {
      const card = page.locator('.card').filter({ hasText: filename });
      const download = await Promise.all([
        page.waitForEvent('download'),
        card.getByRole('button', { name: /^download$|^saved$/i }).click(),
      ]).then(([d]) => d);
      const path = await download.path();
      const text = fs.readFileSync(path!, 'utf8');
      const name = download.suggestedFilename();
      seen.push(name);
      expect(text.length, `${name} must not be empty`).toBeGreaterThan(50);
      // No placeholder text may reach a delivered file.
      expect(text, `${name} contains a placeholder`).not.toMatch(/TODO|FIXME|lorem ipsum|undefined,|,NaN/i);
      if (name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        expect(parsed.quantumHardware).toBe('NO QUANTUM HARDWARE EXECUTION');
        expect(parsed.config.seed).toBeDefined();
      }
    }
    expect(new Set(seen).size, 'filenames must be distinct').toBe(6);
  });

  test('the QUBO heatmap renders real coefficients and the stated penalty', async ({ page }) => {
    await page.goto('/understand');
    await skipTour(page);
    await page.getByRole('button', { name: /the puzzle matrix/i }).click();
    await expect(page.getByText(/the puzzle, as a matrix/i)).toBeVisible();

    // The heatmap must actually draw rects, not an empty SVG.
    const rects = page.locator('figure svg rect');
    const count = await rects.count();
    expect(count, 'heatmap cells drawn').toBeGreaterThan(200);

    // The penalty bound for lambda=1 from the Python model is 16953.26...
    await expect(page.getByText(/16953\.3/)).toBeVisible();
  });

  test('the confidence centre reports measured errors near zero', async ({ page }) => {
    await page.goto('/understand');
    await skipTour(page);
    await page.getByRole('button', { name: /confidence centre/i }).click();
    await page.getByRole('button', { name: /re-run the checks/i }).click();

    await expect(page.getByText(/encoding round-trips/i)).toBeVisible();
    // Errors must be reported in scientific notation near zero, not as 0.00.
    const matrixError = await page
      .locator('.stat', { hasText: /matrix vs direct score/i })
      .locator('.stat-value')
      .innerText();
    expect(matrixError).toMatch(/e-\d+|^0$/);
  });
});

/* ================================================================== *
 * 5. The flagship interaction, with a real mouse and real keyboard
 * ================================================================== */
test.describe('peptide builder', () => {
  test('keyboard placement changes the sequence and rescores', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);

    const first = page.getByRole('button', { name: /^position 1 of 8/i });
    await first.focus();
    await page.keyboard.press('5');

    await expect(page.getByText(/^CHARGED_NEG-/)).toBeVisible({ timeout: 15_000 });
    // And the explanation of the edit must appear with real numbers.
    await expect(page.getByText(/what your last edit did/i)).toBeVisible();
    await expect(page.getByText(/this edit means/i)).toBeVisible();
  });

  test('arrow keys move focus across all eight positions', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.getByRole('button', { name: /^position 1 of 8/i }).focus();
    for (let i = 2; i <= 8; i += 1) {
      await page.keyboard.press('ArrowRight');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
      expect(focused, `focus should be on position ${i}`).toMatch(new RegExp(`^Position ${i} of 8`));
    }
  });

  test('real drag and drop from the palette onto a position works', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'mobile-chromium',
      'HTML5 drag-and-drop does not exist on touch devices; the mobile path is ' +
        'tap-to-arm then tap-to-place, covered by its own test below.',
    );
    await page.goto('/build');
    await skipTour(page);
    const seq = () => page.locator('code').filter({ hasText: /^[A-Z_]+-/ }).first().innerText();
    const before = await seq();
    // Position 1 holds HYDROPHOBIC in the reference design, so dropping the
    // large aromatic ring there is a genuine change rather than a no-op.
    expect(before.split('-')[0]).toBe('HYDROPHOBIC');

    const source = page.getByRole('button', { name: /large aromatic ring, family/i });
    const target = page.getByRole('button', { name: /^position 1 of 8/i });
    await source.dragTo(target);

    await expect(async () => {
      const after = await seq();
      expect(after).not.toBe(before);
      expect(after.split('-')[0]).toBe('AROM_W');
    }).toPass({ timeout: 15_000 });
  });

  test('the drop handler accepts a genuine DragEvent payload', async ({ page }) => {
    // Belt-and-braces: exercise the handler with a real DataTransfer, which is
    // exactly what the browser delivers during a native drag. This proves the
    // handler itself works independently of synthetic-mouse translation.
    await page.goto('/build');
    await skipTour(page);
    const seq = () => page.locator('code').filter({ hasText: /^[A-Z_]+-/ }).first().innerText();
    const payload = await page.evaluate(() => {
      const source = [...document.querySelectorAll('.palette-item')].find((el) =>
        /positively charged/i.test(el.getAttribute('aria-label') ?? ''),
      ) as HTMLElement;
      const target = [...document.querySelectorAll('.chain button')][4] as HTMLElement;
      const dt = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      target.dispatchEvent(
        new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
      target.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
      );
      return dt.getData('text/plain');
    });
    expect(payload, 'dragstart must put the class index on the DataTransfer').toBe('5');
    await expect(async () => {
      expect((await seq()).split('-')[4]).toBe('CHARGED_POS');
    }).toPass({ timeout: 15_000 });
  });

  test('tap-to-arm then tap-to-place works (the touch path)', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.getByRole('button', { name: /positively charged, family/i }).click();
    await page.getByRole('button', { name: /^position 7 of 8/i }).click();
    await expect(async () => {
      const seq = await page.locator('code').filter({ hasText: /^[A-Z_]+-/ }).first().innerText();
      expect(seq.split('-')[6]).toBe('CHARGED_POS');
    }).toPass({ timeout: 15_000 });
  });

  test('undo and redo restore the exact previous sequences', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    const seqOf = () => page.locator('code').filter({ hasText: /^[A-Z_]+-/ }).first().innerText();
    const original = await seqOf();

    await page.getByRole('button', { name: /^position 2 of 8/i }).focus();
    await page.keyboard.press('1');
    await expect(async () => expect(await seqOf()).not.toBe(original)).toPass();
    const edited = await seqOf();

    await page.getByRole('button', { name: /^undo$/i }).click();
    await expect(async () => expect(await seqOf()).toBe(original)).toPass();

    await page.getByRole('button', { name: /^redo$/i }).click();
    await expect(async () => expect(await seqOf()).toBe(edited)).toPass();
  });

  test('a shared link restores the exact design it encodes', async ({ page }) => {
    await page.goto('/build#s=45012345&l=2');
    await skipTour(page);
    await expect(
      page.getByText('CHARGED_NEG-CHARGED_POS-AROM_W-AROM_FY-HYDROPHOBIC-SMALL_POLAR-CHARGED_NEG-CHARGED_POS'),
    ).toBeVisible({ timeout: 15_000 });
  });
});

/* ================================================================== *
 * 6. Adversarial: try to break it
 * ================================================================== */
test.describe('adversarial scenarios', () => {
  const HOSTILE_HASHES = [
    '#s=notvalid',
    '#s=99999999',
    '#s=1234567',
    '#s=123456789',
    '#l=-1',
    '#l=99',
    '#l=NaN',
    '#l=1e999',
    '#s=<script>alert(1)</script>',
    '#__proto__[polluted]=1',
    '#constructor[prototype][polluted]=1',
    `#s=${'A'.repeat(3000)}`,
    '#%%%',
    '#s=0&s=5&l=1&l=4',
  ];

  for (const hash of HOSTILE_HASHES) {
    test(`survives a hostile URL hash: ${hash.slice(0, 32)}`, async ({ page }) => {
      const log = collect(page);
      await page.goto(`/build${hash}`);
      await skipTour(page);
      // The app must still render its heading rather than white-screening.
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText(/build a peptide/i)).toBeVisible();
      expect(log.pageErrors, 'hostile hash must not throw').toEqual([]);

      const polluted = await page.evaluate(
        () => ({}) as Record<string, unknown>,
      ).then(() => page.evaluate(() => Object.prototype.hasOwnProperty('polluted')));
      expect(polluted, 'Object.prototype must not be polluted').toBe(false);
    });
  }

  test('corrupted localStorage does not break the first paint', async ({ page }) => {
    const log = collect(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('qbind-select:prefs:v1', '{{{not json at all');
    });
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(log.pageErrors).toEqual([]);

    // And a structurally valid but semantically hostile payload.
    await page.evaluate(() => {
      localStorage.setItem(
        'qbind-select:prefs:v1',
        JSON.stringify({
          mode: 'hacker',
          theme: 'rainbow',
          motion: 42,
          tourSeen: 'yes',
          favourites: [{ codes: [9, 9, 9], lambda: 'x' }, null, 7],
          scenarios: Array.from({ length: 200 }, () => ({ codes: [1, 2], lambda: 999 })),
        }),
      );
    });
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(log.pageErrors).toEqual([]);
  });

  test('hammering the Run button does not launch duplicate runs', async ({ page }) => {
    const log = collect(page);
    await page.goto('/optimise');
    await skipTour(page);
    const run = page.getByRole('button', { name: /start a live run/i }).first();
    // Click as fast as the browser allows.
    for (let i = 0; i < 8; i += 1) {
      await run.click({ force: true, timeout: 2000 }).catch(() => {});
    }
    await expect(page.getByText(/run complete/i)).toBeVisible({ timeout: 90_000 });
    // Exactly one completed run summary may exist.
    await expect(page.getByText(/designs scored against 3 plastics/i)).toHaveCount(1);
    expect(log.pageErrors).toEqual([]);
  });

  test('navigating away mid-run and back leaves a consistent state', async ({ page }) => {
    const log = collect(page);
    await page.goto('/optimise');
    await skipTour(page);
    await page.getByRole('button', { name: /start a live run/i }).first().click();
    await page.getByRole('link', { name: /compare/i }).click();
    await page.getByRole('link', { name: /results/i }).click();
    await page.getByRole('link', { name: /optimise/i }).click();
    // Either it finished or it is still going; neither may throw.
    await page.waitForTimeout(3000);
    await expect(page.locator('h1')).toBeVisible();
    expect(log.pageErrors).toEqual([]);
  });

  test('a mid-run reload recovers to a clean cold state', async ({ page }) => {
    const log = collect(page);
    await page.goto('/optimise');
    await skipTour(page);
    await page.getByRole('button', { name: /start a live run/i }).first().click();
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    // Results are session-only, so after a reload there must be no stale run.
    await expect(page.getByText(/nothing has been computed/i).first()).toBeVisible({
      timeout: 20_000,
    });
    expect(log.pageErrors).toEqual([]);
  });

  test('rapid slider dragging does not error or desynchronise', async ({ page }) => {
    const log = collect(page);
    await page.goto('/optimise');
    await skipTour(page);
    const slider = page.getByRole('slider');
    for (const value of ['0', '5', '0.5', '3.25', '1', '4.8', '2']) {
      await slider.fill(value);
    }
    await page.waitForTimeout(600);
    // The committed value must match the last one set.
    await expect(page.getByText('λ = 2.00')).toBeVisible();
    expect(log.pageErrors).toEqual([]);
  });

  test('exporting with no run produces no download and an honest empty state', async ({ page }) => {
    await page.goto('/results');
    await skipTour(page);
    await expect(page.getByText(/no run to write up yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^download$/i })).toHaveCount(0);
  });

  test('deep-linking every route directly serves the app, not a 404 page', async ({ page }) => {
    for (const route of ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), `${route}`).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
      // The SPA fallback must not leave the URL rewritten.
      expect(new URL(page.url()).pathname).toBe(route);
    }
  });

  test('browser back and forward traverse the real history', async ({ page }) => {
    await page.goto('/');
    await skipTour(page);
    await page.getByRole('link', { name: /build & explore/i }).click();
    await expect(page.getByText(/build a peptide/i)).toBeVisible();
    await page.getByRole('link', { name: /understand/i }).click();
    await expect(page.getByText(/how the maths works/i)).toBeVisible();

    await page.goBack();
    await expect(page.getByText(/build a peptide/i)).toBeVisible();
    await page.goBack();
    await expect(page.getByText(/one plastic from another/i)).toBeVisible();
    await page.goForward();
    await expect(page.getByText(/build a peptide/i)).toBeVisible();
  });
});

/* ================================================================== *
 * 7. Accessibility and preferences, in a real engine
 * ================================================================== */
test.describe('accessibility in a real browser', () => {
  test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    // Seed the tour as already seen. On a genuine first visit the tour dialog
    // autofocuses itself and legitimately owns the first Tab; the skip link is
    // the first stop for every visit after that, which is the case under test.
    // (The first-visit focus hand-off is covered by its own test below.)
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem(
        'qbind-select:prefs:v1',
        JSON.stringify({
          mode: 'beginner',
          theme: 'system',
          motion: 'system',
          tourSeen: true,
          favourites: [],
          scenarios: [],
        }),
      );
    });
    await page.reload();
    await page.locator('h1').waitFor();
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(label).toMatch(/skip to main content/i);
    // The link must actually become visible when focused, not merely exist.
    // It slides in over 220ms and that transition can begin after a React
    // re-render, so poll for the settled position rather than sleeping.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const el = document.querySelector('.skip-link');
            return el ? Math.round(el.getBoundingClientRect().top) : -9999;
          }),
        { message: 'skip link should slide into view when focused', timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(0);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    // Read the hash from the document: page.url() lags in-page hash changes.
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe('#main');
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId, 'focus must land on the main landmark').toBe('main');
  });

  test('dismissing the tour hands focus to the main landmark', async ({ page }) => {
    await page.goto('/');
    // The tour is opt-in: nothing opens over the page on its own.
    await expect(page.getByRole('dialog', { name: /quick tour/i })).toHaveCount(0);
    await page.getByRole('button', { name: /take the guided tour/i }).first().click();
    const skip = page.getByRole('button', { name: /^skip$/i });
    await skip.waitFor({ state: 'visible', timeout: 10_000 });
    await skip.click();
    // Focus must land somewhere predictable, not on a removed node.
    await expect
      .poll(async () => page.evaluate(() => document.activeElement?.id ?? ''), {
        message: 'focus should move to #main when the tour closes',
        timeout: 5000,
      })
      .toBe('main');
    // The skip link sits before the navigation in DOM order, so going backwards
    // from main passes through the header first. Walk back until it is reached,
    // which confirms it is still in the tab order rather than orphaned.
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      await page.keyboard.press('Shift+Tab');
      reached = await page.evaluate(() =>
        document.activeElement?.classList.contains('skip-link') ?? false,
      );
    }
    expect(reached, 'the skip link must remain reachable backwards from main').toBe(true);
    // And when it is focused it must actually be on screen.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const el = document.querySelector('.skip-link');
          return el ? Math.round(el.getBoundingClientRect().top) : -9999;
        }),
      )
      .toBeGreaterThanOrEqual(0);
  });

  test('every interactive control shows a visible focus indicator', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    const offenders = await page.evaluate(() => {
      const bad: string[] = [];
      const nodes = [...document.querySelectorAll('button:not([disabled]), a[href]')].slice(0, 60);
      for (const el of nodes) {
        (el as HTMLElement).focus();
        const style = getComputedStyle(el);
        const hasRing =
          style.boxShadow !== 'none' ||
          style.outlineStyle !== 'none' ||
          style.outlineWidth !== '0px';
        if (!hasRing) bad.push((el as HTMLElement).outerHTML.slice(0, 90));
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });

  test('nothing on the landing page animates by itself', async ({ browser }) => {
    // The hero was an animated canvas, then a chemical structure panel. It is
    // now plain type: the molecule viewer lives on Build & Explore, where its
    // residues can be changed. So the assertion is simply that the landing
    // page holds still - under reduced motion or otherwise.
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const p = await context.newPage();
    await p.goto('/');
    await p.getByRole('heading', { level: 1 }).waitFor({ timeout: 30_000 });

    const shot = async () => (await p.locator('.hero').screenshot()).toString('base64');
    const first = await shot();
    await p.waitForTimeout(1200);
    expect(await shot(), 'the hero must hold still').toBe(first);

    // And no element is running an infinite animation on the landing page.
    const animated = await p.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('main *')) {
        const style = getComputedStyle(el);
        if (style.animationName !== 'none' && style.animationIterationCount === 'infinite') {
          bad.push(`${el.tagName}.${el.className}: ${style.animationName}`);
        }
      }
      return bad;
    });
    expect(animated).toEqual([]);
    await context.close();
  });
});

/* ================================================================== *
 * 8. Honesty gate: the claims must be visible, in the browser
 * ================================================================== */
test.describe('scientific honesty, as rendered', () => {
  for (const route of ROUTES) {
    test(`${route} states the no-quantum and no-lab position`, async ({ page }) => {
      await page.goto(route);
      await skipTour(page);
      // Every screen carries the one-line disclosure; the full assessment is
      // a section at the bottom of Results and appears nowhere else.
      await expect(page.getByText(/no quantum hardware was used/i).first()).toBeVisible();
      await expect(page.getByText(/no laboratory validation/i).first()).toBeVisible();
      await expect(
        page.getByRole('link', { name: /scientific-validity assessment/i }).first(),
      ).toBeVisible();
    });
  }

  test('no page claims proven binding, docking or degradation', async ({ page }) => {
    const FORBIDDEN = [
      /experimentally verified binding/i,
      /proven to bind/i,
      /molecular docking result/i,
      /degrades plastic/i,
      // Match only affirmative claims; the site's own disclaimers negate these
      // ("No quantum speedup is measured", "never claim quantum advantage").
      /(?<!no )(?<!not )(?<!without )quantum speedup is (?:achieved|demonstrated|shown)/i,
      /(?:achieves|demonstrates|shows|proves) quantum advantage/i,
      /we (?:used|ran) a quantum (?:computer|processor|annealer)/i,
    ];
    for (const route of ROUTES) {
      await page.goto(route);
      await skipTour(page);
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      for (const pattern of FORBIDDEN) {
        expect(body, `${route} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test('the generated conformer is labelled as generated, not experimental', async ({ page }) => {
    await page.goto('/build');
    await skipTour(page);
    await page.locator('.struct2d-figure svg').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /3D model/i }).first().click();
    await expect(page.getByText(/generated conformer/i).first()).toBeVisible();
    await expect(page.getByText(/not an experimental structure/i).first()).toBeVisible();
    await expect(page.getByText(/not a binding pose/i).first()).toBeVisible();
  });

  test('the validity assessment is on Results and on no other screen', async ({ page }) => {
    for (const route of ['/', '/build', '/optimise', '/compare', '/quantum', '/understand']) {
      await page.goto(route);
      await skipTour(page);
      await expect(
        page.locator('#scientific-validity'),
        `${route} must not repeat the assessment`,
      ).toHaveCount(0);
      // Every screen still carries the one-line disclosure.
      await expect(page.getByText(/no quantum hardware was used/i).first()).toBeVisible();
    }
    await runPipeline(page);
    await page.getByRole('link', { name: /results/i }).click();
    const assessment = page.locator('#scientific-validity');
    await expect(assessment).toBeVisible({ timeout: 30_000 });
    await expect(
      assessment.getByRole('heading', { name: /scientific validity assessment/i }),
    ).toBeVisible();
    // No invented percentage anywhere in it.
    await expect(assessment.getByText(/honesty score/i)).toHaveCount(0);
    await expect(assessment.getByText(/[0-9]+ ?% (honest|valid|confiden)/i)).toHaveCount(0);
  });

  test('D-Wave is reported as NOT EXECUTED, with a reason', async ({ page }) => {
    await runPipeline(page);
    await page.getByRole('link', { name: /compare/i }).click();
    await expect(page.getByText(/D-Wave quantum annealer/).first()).toBeVisible();
    await expect(page.getByText(/NOT EXECUTED/).first()).toBeVisible();
  });
});
