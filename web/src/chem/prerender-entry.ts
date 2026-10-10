/**
 * Entry point for the build-time depiction pre-renderer.
 *
 * It exists so `scripts/prerender-depictions.mjs` can bundle exactly the
 * modules the browser uses, rather than re-implementing any of them.
 */
export { buildPeptide } from './peptide';
export { RESIDUE_TEMPLATES } from './residues';
export { CLASS_INFO } from '../science/alphabet';
