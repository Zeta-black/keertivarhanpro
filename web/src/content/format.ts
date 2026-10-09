/**
 * Locale-stable number formatting.
 *
 * `Number.prototype.toLocaleString()` with no locale follows the visitor's
 * system locale. In an en-IN environment 1679616 renders as "16,79,616"
 * (lakh grouping), while this site's own prose and the published Python
 * results both say "1,679,616". A page that disagrees with itself about the
 * size of its own search space is a real defect, not a cosmetic one, so
 * grouping is pinned here and every display path uses these helpers.
 *
 * This is a deliberate choice to match the scientific record rather than the
 * reader's locale. Dates are not formatted here: run records carry ISO 8601
 * strings, which are unambiguous everywhere.
 */

/** The locale every number on this site is grouped with. */
export const DISPLAY_LOCALE = 'en-US';

const INTEGER = new Intl.NumberFormat(DISPLAY_LOCALE, { maximumFractionDigits: 0 });

/** Thousands-grouped integer, identical for every visitor. */
export function groupInt(value: number): string {
  if (!Number.isFinite(value)) return 'not available';
  return INTEGER.format(Math.round(value));
}

/** Fixed-decimal number, identical for every visitor. */
export function fixed(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'not available';
  return value.toFixed(digits);
}
