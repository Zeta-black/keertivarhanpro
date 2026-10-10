/**
 * Lazy loader for RDKit MinimalLib (WebAssembly), used as the 2D chemical
 * depiction engine.
 *
 * Why RDKit rather than a hand-rolled drawing: a structure diagram has to get
 * ring templates, kekulisation, hetero-atom labelling, bond wedges and
 * double-bond placement right, and RDKit is the reference implementation the
 * rest of cheminformatics checks itself against. The depiction on screen is
 * therefore the same drawing a chemist would get from RDKit at a terminal.
 *
 * The runtime is a 7 MB wasm binary, so it is NEVER on the critical path. It is
 * fetched on demand, once per session, from `/rdkit` (synced out of
 * node_modules by `scripts/sync-rdkit.mjs`). Callers get an explicit loading
 * state and an explicit failure state; nothing silently falls back to a
 * drawing that is not real chemistry.
 */

export interface RDKitMol {
  is_valid(): boolean;
  get_svg(width: number, height: number): string;
  get_svg_with_highlights(details: string): string;
  get_descriptors(): string;
  get_molblock(): string;
  get_smiles(): string;
  get_inchi(): string;
  set_new_coords(useCoordGen: boolean): boolean;
  normalize_depiction(canonicalize: number): number;
  straighten_depiction(minimizeRotation: boolean): void;
  get_substruct_match(query: RDKitMol): string;
  delete(): void;
}

export interface RDKitModule {
  version(): string;
  prefer_coordgen(prefer: boolean): void;
  get_mol(smiles: string, detailsJson?: string): RDKitMol | null;
  get_qmol(smarts: string): RDKitMol | null;
}

type Factory = (options: {
  locateFile: (file: string) => string;
}) => Promise<RDKitModule>;

declare global {
  interface Window {
    initRDKitModule?: Factory;
  }
}

/** Status of the depiction engine, for the UI to report honestly. */
export type EngineStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'failed'; readonly reason: string };

const BASE = import.meta.env.BASE_URL || '/';
const SCRIPT_URL = `${BASE.replace(/\/$/, '')}/rdkit/RDKit_minimal.js`;
const WASM_URL = `${BASE.replace(/\/$/, '')}/rdkit/RDKit_minimal.wasm`;

let pending: Promise<RDKitModule> | null = null;
let loaded: RDKitModule | null = null;

/** The module, if it has already finished loading. Never triggers a load. */
export function rdkitIfReady(): RDKitModule | null {
  return loaded;
}

export function rdkitVersion(): string | null {
  return loaded ? loaded.version() : null;
}

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.initRDKitModule) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-rdkit="true"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('the RDKit script failed to load')),
        { once: true },
      );
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.rdkit = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`could not fetch ${SCRIPT_URL}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
}

/**
 * Loads RDKit, at most once per page. Repeat callers share the same promise.
 */
export async function loadRdkit(): Promise<RDKitModule> {
  if (loaded) return loaded;
  if (pending) return pending;
  pending = (async () => {
    await injectScript();
    const factory = window.initRDKitModule;
    if (!factory) throw new Error('the RDKit script loaded but defined no module factory');
    const module = await factory({ locateFile: () => WASM_URL });
    // CoordGen produces the ring layouts a chemist expects (clean hexagons,
    // correctly fused bicyclics) rather than RDKit's older default algorithm.
    try {
      module.prefer_coordgen(true);
    } catch {
      // Older builds do not expose this; the default layout is still correct.
    }
    loaded = module;
    return module;
  })();
  try {
    return await pending;
  } catch (error) {
    pending = null;
    throw error;
  }
}

export interface DepictionOptions {
  readonly width: number;
  readonly height: number;
  /** Atom indices to highlight, usually one residue's worth. */
  readonly highlightAtoms?: readonly number[];
  readonly highlightBonds?: readonly number[];
  /** Highlight colour as RGB in 0..1, which is what RDKit's drawer expects. */
  readonly highlightColour?: readonly [number, number, number];
  /** Draw on a transparent background so the page's surface shows through. */
  readonly transparent?: boolean;
  readonly addStereoAnnotation?: boolean;
  readonly bondLineWidth?: number;
}

/**
 * Makes an RDKit depiction theme-aware.
 *
 * RDKit paints the carbon skeleton in pure black and gives each hetero atom
 * its element colour. Swapping only the black for `currentColor` keeps the
 * element colouring a chemist expects while letting the page's text colour
 * drive the skeleton, so the same drawing is legible in both themes. The XML
 * prolog is dropped because an HTML document has no use for it.
 */
export function themeDepiction(svg: string): string {
  return svg
    .replace(/<\?xml[^>]*\?>\s*/i, '')
    .replace(/#000000/gi, 'currentColor')
    .replace(/#FFFFFF00/gi, 'none');
}

/**
 * Renders an SVG depiction of a SMILES string.
 *
 * Returns `null` when RDKit cannot parse the SMILES, which the caller must
 * treat as an error rather than drawing something approximate instead.
 */
export function depictSmiles(
  module: RDKitModule,
  smiles: string,
  options: DepictionOptions,
): string | null {
  const mol = module.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return null;
  }
  try {
    // A fresh CoordGen layout, normalised and straightened, is what makes a
    // long peptide read left-to-right instead of spiralling.
    mol.set_new_coords(true);
    mol.normalize_depiction(1);
    mol.straighten_depiction(true);

    const highlightColour = options.highlightColour ?? [0.18, 0.78, 0.86];
    const details: Record<string, unknown> = {
      width: Math.max(80, Math.round(options.width)),
      height: Math.max(80, Math.round(options.height)),
      bondLineWidth: options.bondLineWidth ?? 1.6,
      fixedBondLength: 0,
      addStereoAnnotation: options.addStereoAnnotation ?? false,
      explicitMethyl: false,
      backgroundColour: options.transparent ? [1, 1, 1, 0] : [1, 1, 1, 1],
      atoms: [...(options.highlightAtoms ?? [])],
      bonds: [...(options.highlightBonds ?? [])],
      highlightColour,
      highlightRadius: 0.38,
      highlightBondWidthMultiplier: 18,
    };
    return themeDepiction(mol.get_svg_with_highlights(JSON.stringify(details)));
  } finally {
    mol.delete();
  }
}

/** Numeric descriptors RDKit computes for a molecule, for the researcher view. */
export interface RdkitDescriptors {
  readonly amw: number;
  readonly exactmw: number;
  readonly tpsa: number;
  readonly clogp: number;
  readonly hbd: number;
  readonly hba: number;
  readonly heavyAtoms: number;
  readonly rings: number;
  readonly aromaticRings: number;
  readonly rotatableBonds: number;
  readonly stereocentres: number;
  readonly unspecifiedStereocentres: number;
  readonly fractionCsp3: number;
}

export function describeSmiles(
  module: RDKitModule,
  smiles: string,
): RdkitDescriptors | null {
  const mol = module.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete();
    return null;
  }
  try {
    const d = JSON.parse(mol.get_descriptors()) as Record<string, number>;
    return {
      amw: d.amw,
      exactmw: d.exactmw,
      tpsa: d.tpsa,
      clogp: d.CrippenClogP,
      hbd: d.NumHBD,
      hba: d.NumHBA,
      heavyAtoms: d.NumHeavyAtoms,
      rings: d.NumRings,
      aromaticRings: d.NumAromaticRings,
      rotatableBonds: d.NumRotatableBonds,
      stereocentres: d.NumAtomStereoCenters,
      unspecifiedStereocentres: d.NumUnspecifiedAtomStereoCenters,
      fractionCsp3: d.FractionCSP3,
    };
  } finally {
    mol.delete();
  }
}

/**
 * Atom indices of a substructure match, used to highlight one residue inside
 * the whole-peptide depiction.
 */
export function matchAtoms(
  module: RDKitModule,
  smiles: string,
  smarts: string,
): number[][] {
  const mol = module.get_mol(smiles);
  const query = module.get_qmol(smarts);
  if (!mol || !query || !mol.is_valid()) {
    mol?.delete();
    query?.delete();
    return [];
  }
  try {
    const raw = mol.get_substruct_match(query);
    const parsed = JSON.parse(raw || '{}') as { atoms?: number[] };
    return parsed.atoms ? [parsed.atoms] : [];
  } catch {
    return [];
  } finally {
    mol.delete();
    query.delete();
  }
}
