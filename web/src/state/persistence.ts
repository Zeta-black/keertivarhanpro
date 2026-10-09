/**
 * Preference persistence.
 *
 * Deliberately narrow: only small, non-identifying settings are stored, in the
 * viewer's own browser. No run data, no large arrays, no analytics, no cookies,
 * nothing sent to a server. Every access is wrapped because localStorage throws
 * outright in some contexts (private windows, blocked site data, previews).
 */

import { isValidCodes } from '../science/alphabet';
import type {
  ExplanationMode,
  FavouriteEntry,
  MotionChoice,
  ScenarioSnapshot,
  ThemeChoice,
} from './types';

const KEY = 'qbind-select:prefs:v1';

export interface Preferences {
  mode: ExplanationMode;
  theme: ThemeChoice;
  motion: MotionChoice;
  tourSeen: boolean;
  favourites: FavouriteEntry[];
  scenarios: ScenarioSnapshot[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'beginner',
  theme: 'system',
  motion: 'system',
  tourSeen: false,
  favourites: [],
  scenarios: [],
};

function isMode(v: unknown): v is ExplanationMode {
  return v === 'beginner' || v === 'researcher';
}
function isTheme(v: unknown): v is ThemeChoice {
  return v === 'system' || v === 'dark' || v === 'light';
}
function isMotion(v: unknown): v is MotionChoice {
  return v === 'system' || v === 'reduced';
}

function sanitiseFavourites(input: unknown): FavouriteEntry[] {
  if (!Array.isArray(input)) return [];
  const out: FavouriteEntry[] = [];
  for (const raw of input.slice(0, 40)) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Partial<FavouriteEntry>;
    if (!isValidCodes(f.codes)) continue;
    if (typeof f.lambda !== 'number' || !Number.isFinite(f.lambda)) continue;
    if (typeof f.objective !== 'number' || !Number.isFinite(f.objective)) continue;
    const s = f.scores;
    if (
      !s ||
      typeof s.PET !== 'number' ||
      typeof s.PE !== 'number' ||
      typeof s.PP !== 'number'
    ) {
      continue;
    }
    out.push({
      classSequence: String(f.classSequence ?? '').slice(0, 200),
      codes: [...f.codes],
      lambda: f.lambda,
      objective: f.objective,
      scores: { PET: s.PET, PE: s.PE, PP: s.PP },
      addedAtIso: String(f.addedAtIso ?? '').slice(0, 40),
    });
  }
  return out;
}

export function sanitiseScenarios(input: unknown): ScenarioSnapshot[] {
  if (!Array.isArray(input)) return [];
  const out: ScenarioSnapshot[] = [];
  for (const raw of input.slice(0, 30)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Partial<ScenarioSnapshot>;
    if (!isValidCodes(s.codes)) continue;
    if (typeof s.lambda !== 'number' || !Number.isFinite(s.lambda)) continue;
    if (s.lambda < 0 || s.lambda > 5) continue;
    out.push({
      id: String(s.id ?? `imported-${out.length}`).slice(0, 80),
      name: String(s.name ?? 'Untitled scenario').slice(0, 60),
      codes: [...s.codes],
      lambda: s.lambda,
      savedAtIso: String(s.savedAtIso ?? '').slice(0, 40),
    });
  }
  return out;
}

export function loadPreferences(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      mode: isMode(parsed.mode) ? parsed.mode : DEFAULT_PREFERENCES.mode,
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_PREFERENCES.theme,
      motion: isMotion(parsed.motion) ? parsed.motion : DEFAULT_PREFERENCES.motion,
      tourSeen: parsed.tourSeen === true,
      favourites: sanitiseFavourites(parsed.favourites),
      scenarios: sanitiseScenarios(parsed.scenarios),
    };
  } catch {
    // A corrupt or unreadable value must never break the first paint.
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(prefs: Preferences): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({
        mode: prefs.mode,
        theme: prefs.theme,
        motion: prefs.motion,
        tourSeen: prefs.tourSeen,
        favourites: prefs.favourites.slice(-40),
        scenarios: prefs.scenarios.slice(-30),
      }),
    );
  } catch {
    // Storage is a convenience here; failing to write is not an error worth
    // interrupting the user for.
  }
}

export function clearPreferences(): void {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/** ---------------- Shareable URL state ---------------- */

/**
 * Encode the current peptide and lambda into a hash fragment. Everything stays
 * local: this is a link the user can keep or send, not an upload.
 */
export function encodeShareState(codes: number[], lambda: number): string {
  if (!isValidCodes(codes)) return '';
  return `#s=${codes.join('')}&l=${lambda}`;
}

export interface ParsedShareState {
  codes: number[] | null;
  lambda: number | null;
  errors: string[];
}

/** Parse a hash fragment defensively. Untrusted input: validate, never trust. */
export function parseShareState(hash: string): ParsedShareState {
  const errors: string[] = [];
  let codes: number[] | null = null;
  let lambda: number | null = null;
  try {
    const text = hash.startsWith('#') ? hash.slice(1) : hash;
    if (!text) return { codes: null, lambda: null, errors };
    const params = new URLSearchParams(text);

    const s = params.get('s');
    if (s !== null) {
      if (!/^[0-5]{8}$/.test(s)) {
        errors.push('The sequence in the link is not eight digits from 0 to 5, so it was ignored.');
      } else {
        const parsed = s.split('').map((d) => Number(d));
        if (isValidCodes(parsed)) codes = parsed;
      }
    }

    const l = params.get('l');
    if (l !== null) {
      const value = Number(l);
      if (!Number.isFinite(value) || value < 0 || value > 5) {
        errors.push('The selectivity priority in the link is outside 0 to 5, so it was ignored.');
      } else {
        lambda = value;
      }
    }
  } catch {
    errors.push('The link could not be read, so the defaults were used.');
  }
  return { codes, lambda, errors };
}
