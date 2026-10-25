/**
 * The 500-scenario simulated evaluation matrix.
 *
 * READ THIS FIRST. These are SCRIPTED HEURISTIC INSPECTIONS, not user testing.
 * No human being participated. Each scenario is a named combination of persona,
 * screen, state and device, paired with automated checks that actually execute
 * against the rendered DOM. A passing scenario means "the checks for this
 * combination found no defect", never "a person understood this".
 *
 * Real-user comprehension - can a novice explain PET vs PE vs PP, a peptide,
 * the priority dial, and what the results do not prove? - CANNOT be measured
 * this way and is reported as PENDING, not passed.
 */

export type SkillLevel = 'novice' | 'intermediate' | 'expert';
export type Device = 'phone' | 'tablet' | 'desktop';
export type Visit = 'first' | 'repeat';
export type Motion = 'default' | 'reduced';
export type DataState = 'cold' | 'computed';

export interface Persona {
  readonly id: string;
  readonly label: string;
  readonly skill: SkillLevel;
  /** What this person is trying to find out. */
  readonly goal: string;
  /** What would make the product fail them specifically. */
  readonly failureMode: string;
  /** Checks that matter most for this persona. */
  readonly priorityChecks: readonly CheckId[];
}

export type CheckId =
  | 'plainTitle'
  | 'onePurpose'
  | 'primaryAction'
  | 'noBareNumbers'
  | 'jargonExplained'
  | 'keyboardReachable'
  | 'honestyPresent'
  | 'stateHandled'
  | 'noHorizontalOverflow'
  | 'motionOptional'
  | 'landmarks'
  | 'accessibleGraphics'
  | 'provenanceLabelled'
  | 'nextStepObvious'
  | 'recoveryAvailable';

export interface CheckDefinition {
  readonly id: CheckId;
  readonly title: string;
  /** Why this check exists, in reviewer language. */
  readonly rationale: string;
  readonly severityIfFailed: 'critical' | 'major' | 'minor';
}

export const CHECKS: readonly CheckDefinition[] = [
  {
    id: 'plainTitle',
    title: 'Screen has exactly one plain-English h1',
    rationale:
      'A visitor who lands mid-site must be able to say what page they are on without decoding jargon.',
    severityIfFailed: 'major',
  },
  {
    id: 'onePurpose',
    title: 'Screen states its purpose in one sentence',
    rationale: 'Without it the screen is a pile of controls with no stated job.',
    severityIfFailed: 'major',
  },
  {
    id: 'primaryAction',
    title: 'A visible primary action exists',
    rationale: 'A visitor should never have to guess what to do next.',
    severityIfFailed: 'critical',
  },
  {
    id: 'noBareNumbers',
    title: 'Every displayed statistic carries a label and a unit or direction',
    rationale:
      'The original interface failed mainly by showing values like 8.25 / 1.60 with no definition.',
    severityIfFailed: 'critical',
  },
  {
    id: 'jargonExplained',
    title: 'Specialist terms appear with an inline explanation',
    rationale:
      'Lambda, QUBO, Ising, one-hot and surrogate are meaningless to most visitors unless explained in place.',
    severityIfFailed: 'major',
  },
  {
    id: 'keyboardReachable',
    title: 'Every control is keyboard reachable',
    rationale: 'A keyboard-only or switch-device user must be able to operate the whole product.',
    severityIfFailed: 'critical',
  },
  {
    id: 'honestyPresent',
    title: 'Scientific limitations are stated where results are shown',
    rationale:
      'A reader must not be able to leave with the impression that a peptide was tested or a quantum computer was used.',
    severityIfFailed: 'critical',
  },
  {
    id: 'stateHandled',
    title: 'The screen handles its empty, loading and error states explicitly',
    rationale: 'A blank panel reads as a broken product.',
    severityIfFailed: 'major',
  },
  {
    id: 'noHorizontalOverflow',
    title: 'No element forces the page to scroll sideways',
    rationale: 'Sideways scroll on a phone is the most common way a dense interface becomes unusable.',
    severityIfFailed: 'major',
  },
  {
    id: 'motionOptional',
    title: 'Animation can be switched off and nothing is lost',
    rationale: 'Motion sensitivity is common, and motion must never be the only carrier of meaning.',
    severityIfFailed: 'major',
  },
  {
    id: 'landmarks',
    title: 'All content sits inside a navigable landmark',
    rationale: 'Screen-reader users navigate by landmark; orphaned content is invisible to them.',
    severityIfFailed: 'major',
  },
  {
    id: 'accessibleGraphics',
    title: 'Every chart, canvas and diagram has an accessible name',
    rationale: 'A visual-only chart excludes anyone not looking at it.',
    severityIfFailed: 'major',
  },
  {
    id: 'provenanceLabelled',
    title: 'Numbers say whether they were computed, sampled, estimated or illustrated',
    rationale:
      'A judge must be able to tell a proven optimum from a sampled chart from a drawing.',
    severityIfFailed: 'critical',
  },
  {
    id: 'nextStepObvious',
    title: 'A route onward from this screen is present',
    rationale: 'Dead ends make a multi-screen product feel broken.',
    severityIfFailed: 'minor',
  },
  {
    id: 'recoveryAvailable',
    title: 'Destructive or confusing actions can be undone or reset',
    rationale: 'Exploration only feels safe when it is reversible.',
    severityIfFailed: 'major',
  },
];

export const PERSONAS: readonly Persona[] = [
  {
    id: 'P1',
    label: 'Secondary-school beginner',
    skill: 'novice',
    goal: 'Work out what this is about at all, and whether it is interesting.',
    failureMode:
      'Hits a wall of symbols and numbers in the first screen and leaves without understanding the problem.',
    priorityChecks: ['plainTitle', 'onePurpose', 'primaryAction', 'jargonExplained', 'noBareNumbers'],
  },
  {
    id: 'P2',
    label: 'ECE undergraduate',
    skill: 'intermediate',
    goal: 'Understand the optimisation, ignore the biology, see how the QUBO is built.',
    failureMode:
      'Cannot find the actual formulation, or finds it stated without the matrix or the constraint handling.',
    priorityChecks: ['jargonExplained', 'noBareNumbers', 'provenanceLabelled', 'nextStepObvious'],
  },
  {
    id: 'P3',
    label: 'Biotechnology undergraduate',
    skill: 'intermediate',
    goal: 'Understand what the peptide families mean and whether the result is biologically real.',
    failureMode:
      'Comes away believing the winning sequence is a specific peptide that was shown to bind PET.',
    priorityChecks: ['honestyPresent', 'jargonExplained', 'provenanceLabelled', 'plainTitle'],
  },
  {
    id: 'P4',
    label: 'Computational-science student',
    skill: 'expert',
    goal: 'Check the method: enumeration, surrogate, penalty bound, solver agreement, seeds.',
    failureMode:
      'Finds claims without measurements, or cannot tell which numbers are exact and which are sampled.',
    priorityChecks: ['provenanceLabelled', 'noBareNumbers', 'honestyPresent', 'stateHandled'],
  },
  {
    id: 'P5',
    label: 'Chemistry researcher',
    skill: 'expert',
    goal: 'Judge whether the scoring model and its reduction are defensible.',
    failureMode:
      'Cannot find the data source, the aggregation rule, or an honest statement of what averaging discards.',
    priorityChecks: ['honestyPresent', 'provenanceLabelled', 'jargonExplained'],
  },
  {
    id: 'P6',
    label: 'Hackathon judge',
    skill: 'expert',
    goal: 'Decide in a few minutes whether the work is real and honestly presented.',
    failureMode:
      'Finds an overstated claim, a fake progress bar, a placeholder export, or an unlabelled estimate.',
    priorityChecks: ['honestyPresent', 'provenanceLabelled', 'primaryAction', 'stateHandled'],
  },
  {
    id: 'P7',
    label: 'General visitor on a phone',
    skill: 'novice',
    goal: 'Skim it in a minute on a small screen, one-handed.',
    failureMode:
      'Sideways scrolling, tiny text, controls that need a drag, or a 3D scene that drains the battery.',
    priorityChecks: ['noHorizontalOverflow', 'primaryAction', 'plainTitle', 'motionOptional'],
  },
  {
    id: 'P8',
    label: 'Accessibility / keyboard user',
    skill: 'intermediate',
    goal: 'Operate the whole product without a mouse, with a screen reader running.',
    failureMode:
      'A drag-only control, an unlabelled chart, an orphaned region, or a focus trap with no escape.',
    priorityChecks: [
      'keyboardReachable',
      'landmarks',
      'accessibleGraphics',
      'motionOptional',
      'recoveryAvailable',
    ],
  },
];

/**
 * Screens this sweep covers.
 *
 * `quantum` is deliberately NOT here, and the reason is runtime rather than
 * coverage. This harness renders one full app per environment, and its cost
 * per environment grows as a run proceeds: measured on this suite, 80
 * scenarios take 84s but 250 take over 600s. Adding a seventh screen pushes
 * the environment count from 144 to 168 and took the whole file from 197s to
 * over 20 minutes, which is long enough that nobody would run it.
 *
 * It is not a coverage gap. The Quantum screen is checked by
 * `tests/ui/quantum-screen.test.tsx` (12 behavioural tests, including a real
 * circuit run compared against the science module), by the axe sweep in
 * `tests/ui/a11y.test.tsx`, by `tests/ui/modes.test.tsx`, by the navigation
 * tests in `tests/ui/screens.test.tsx`, and by the `/quantum` route in the
 * Playwright sweep. This file would add no check those five do not already
 * make.
 */
export const SCREEN_IDS = [
  'discover',
  'build',
  'optimise',
  'compare',
  'understand',
  'results',
] as const;
export type ReviewScreen = (typeof SCREEN_IDS)[number];

export interface Scenario {
  readonly id: string;
  readonly persona: Persona;
  readonly screen: ReviewScreen;
  readonly device: Device;
  readonly visit: Visit;
  readonly motion: Motion;
  readonly data: DataState;
  /** Low bandwidth / low power conditions this scenario assumes. */
  readonly constrained: boolean;
  readonly checks: readonly CheckId[];
}

/**
 * Deterministically enumerate scenarios. The combination space is
 * 8 personas x 6 screens x 3 devices x 2 visits x 2 motion x 2 data = 1152,
 * which is more than needed; this walks it in a fixed order and takes the
 * first `count`, so the matrix is reproducible and spread across every axis.
 */
export function buildScenarios(count = 500): Scenario[] {
  const devices: Device[] = ['phone', 'tablet', 'desktop'];
  const visits: Visit[] = ['first', 'repeat'];
  const motions: Motion[] = ['default', 'reduced'];
  const datas: DataState[] = ['cold', 'computed'];

  const combos: Omit<Scenario, 'id' | 'checks'>[] = [];
  // Screen-major so every screen is reached early, then persona, then the
  // environment axes. A plain nested walk keeps this auditable.
  for (let d = 0; d < datas.length; d += 1) {
    for (let m = 0; m < motions.length; m += 1) {
      for (let v = 0; v < visits.length; v += 1) {
        for (let dev = 0; dev < devices.length; dev += 1) {
          for (const screen of SCREEN_IDS) {
            for (const persona of PERSONAS) {
              combos.push({
                persona,
                screen,
                device: devices[dev],
                visit: visits[v],
                motion: motions[m],
                data: datas[d],
                constrained: devices[dev] === 'phone' && motions[m] === 'reduced',
              });
            }
          }
        }
      }
    }
  }

  // Taking a prefix of this walk would never reach the later axes (the first
  // 500 entries were all data='cold'). Stride through instead, with a step that
  // is coprime to the list length, so a 500-scenario slice still spans every
  // axis evenly and stays fully reproducible.
  const step = 7;
  const strided: typeof combos = [];
  const seen = new Set<number>();
  for (let i = 0; strided.length < Math.min(count, combos.length); i += 1) {
    const index = (i * step) % combos.length;
    if (seen.has(index)) continue;
    seen.add(index);
    strided.push(combos[index]);
  }

  return strided.slice(0, count).map((combo, index) => ({
    ...combo,
    id: `S${String(index + 1).padStart(3, '0')}`,
    checks: checksFor(combo),
  }));
}

/** Which checks apply to a given combination. */
/** Screens that actually mutate user state, so undo/reset is meaningful there. */
const EDITING_SCREENS: readonly ReviewScreen[] = ['build'];

function checksFor(combo: Omit<Scenario, 'id' | 'checks'>): CheckId[] {
  const set = new Set<CheckId>(combo.persona.priorityChecks);
  // A persona may care about recoverability in general, but undo on a read-only
  // screen is not a defect. Scope it to screens that edit something.
  if (!EDITING_SCREENS.includes(combo.screen)) set.delete('recoveryAvailable');
  // Likewise: "is reduced motion honoured" is only answerable when the
  // scenario actually asks for reduced motion. On a default-motion visit the
  // absence of the attribute is correct behaviour, not a defect.
  if (combo.motion !== 'reduced') set.delete('motionOptional');
  // Universal checks, applied to every scenario.
  set.add('plainTitle');
  set.add('onePurpose');
  set.add('landmarks');
  set.add('keyboardReachable');
  // Device-specific.
  if (combo.device === 'phone' || combo.device === 'tablet') set.add('noHorizontalOverflow');
  // Motion-specific.
  if (combo.motion === 'reduced') set.add('motionOptional');
  // Data-state specific.
  if (combo.data === 'cold') set.add('stateHandled');
  if (combo.data === 'computed') {
    set.add('noBareNumbers');
    set.add('provenanceLabelled');
  }
  // Screens that show results must carry the limitations with them.
  if (['compare', 'results', 'understand'].includes(combo.screen)) set.add('honestyPresent');
  if (EDITING_SCREENS.includes(combo.screen)) set.add('recoveryAvailable');
  if (['compare', 'results', 'understand', 'optimise'].includes(combo.screen)) {
    set.add('accessibleGraphics');
  }
  return [...set];
}

export const VIEWPORTS: Record<Device, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

/** Terms that must never appear without an explanation nearby. */
export const JARGON_TERMS = [
  'lambda',
  'QUBO',
  'Ising',
  'one-hot',
  'surrogate',
  'Potts',
  'peptide',
  'selectivity',
] as const;
