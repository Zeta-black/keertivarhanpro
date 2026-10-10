/**
 * All human-facing language in one place.
 *
 * Writing rules applied throughout:
 *  - Plain word first, technical term second, in brackets or a disclosure.
 *  - Never claim a peptide binds, degrades or recycles anything. The model
 *    produces a SCORE. Say "predicted", "model score", "proxy".
 *  - Every number gets a definition and a direction ("higher is better").
 *  - No exclamation marks, no hype, no emoji used as scientific notation.
 */

export const SITE = {
  name: 'QBind Select',
  tagline: 'Finding peptide designs that prefer one plastic over another',
  /** The one-line promise, above the fold. */
  promise:
    'We search 1,679,616 short peptide designs to find the ones our model scores higher for PET than for the other common plastics.',
  /** The 30-second version, for someone with no science background. */
  thirtySeconds:
    'Plastic recycling struggles because different plastics look similar to machines and to molecules. If a short protein fragment could stick to one plastic and ignore the others, it could help sort them. This site searches every possible design in a reduced alphabet, scores each one with a published physics model, and shows which designs the model prefers for PET. These are computational candidates only, never tested in a laboratory.',
} as const;

export const JARGON = {
  peptide: {
    term: 'peptide',
    plain: 'a short chain of amino-acid building blocks',
    more: 'Proteins are long chains of amino acids. A peptide is a short one. Here every design is exactly eight building blocks long.',
  },
  selectivity: {
    term: 'selectivity',
    plain: 'preferring one thing strongly over another',
    more: 'A design is selective if the model scores it much higher for PET than for PE and PP. We measure that gap and call it the margin.',
  },
  lambda: {
    term: 'Selectivity Priority (lambda)',
    plain: 'how hard the search tries to avoid the other plastics',
    more: 'At 0 the search only cares about scoring well for PET. As it rises, designs that also score well for PE or PP get pushed down the list. It is a dial we choose, not a measured quantity.',
  },
  margin: {
    term: 'margin',
    plain: 'the size of the gap between the PET score and the other plastics',
    more: 'Two versions are shown. Margin against average compares PET with the mean of PE and PP. Margin against worst case compares PET with whichever of PE or PP scores highest, which is the stricter test.',
  },
  qubo: {
    term: 'QUBO',
    plain: 'a puzzle written as 48 on/off switches',
    more: 'Quadratic Unconstrained Binary Optimisation. The goal is rewritten as one number built from switches that are either on or off, plus penalties for breaking the rules. Quantum annealers and several classical solvers accept problems in exactly this form.',
  },
  ising: {
    term: 'Ising model',
    plain: 'the same puzzle written with plus-one and minus-one instead of on and off',
    more: 'Physics hardware usually works with spins that are plus or minus one rather than switches that are 0 or 1. The two forms are equivalent, related by x = (s + 1) / 2.',
  },
  potts: {
    term: 'Potts model',
    plain: 'a scoring recipe with a value for each building block, plus a value for each pair',
    more: 'The score of a design is the sum of eight single-position terms and twenty-eight pair terms. Pair terms are what make this a genuinely quadratic problem rather than a simple lookup.',
  },
  surrogate: {
    term: 'surrogate model',
    plain: 'a simpler stand-in model the optimiser can read',
    more: 'The optimiser needs the objective written as switch terms. A ridge regression is fitted over exactly that form. Because that form can represent the original model perfectly, the fit is essentially exact, which is why its R-squared is 1.0.',
  },
  oneHot: {
    term: 'one-hot encoding',
    plain: 'exactly one switch on per position',
    more: 'Each of the eight positions has six switches, one per building-block class. A valid design has precisely one switch on in each position. The optimiser does not know this automatically, so a penalty term enforces it.',
  },
  objective: {
    term: 'objective',
    plain: 'the single number the search tries to make as small as possible',
    more: 'objective = -(PET score) + lambda x (PE score + PP score). The minus sign in front of PET means a higher PET score lowers the objective, which the search likes. Lower objective is better.',
  },
  proxy: {
    term: 'selectivity proxy',
    plain: 'a stand-in measure, not the real thing',
    more: 'The model score is a computational prediction of binding preference. It is not a measured binding strength, not evidence of adhesion, and not evidence that any plastic would be broken down.',
  },
} as const;

export type JargonKey = keyof typeof JARGON;

/** The three illustrated "how it works" steps on the home screen. */
export const HOW_IT_WORKS = [
  {
    step: 1,
    title: 'Generate designs',
    plain:
      'Every position in an eight-block chain can be one of six building-block families. That makes 1,679,616 different designs, and we can list all of them.',
    detail:
      '6^8 = 1,679,616 valid class sequences. We enumerate the class space, not the 2^48 binary cube.',
  },
  {
    step: 2,
    title: 'Score selectivity',
    plain:
      'A published physics model gives each design three scores: one for PET, one for PE and one for PP. We want PET high and the other two low.',
    detail:
      'Six-class Potts model aggregated from QA-PBP-RL-Nexus energies. Score = 8 one-body terms + 28 two-body terms. Higher score = stronger predicted binding.',
  },
  {
    step: 3,
    title: 'Compare candidates',
    plain:
      'Because we can check every design, we can prove which one is best for a given setting, and show how the answer shifts as the setting changes.',
    detail:
      'Exact brute-force minimisation of -PET + lambda(PE+PP), with simulated annealing on the equivalent 48-variable QUBO as a comparison.',
  },
] as const;

/** Screen metadata. Titles are plain English; purposes are one sentence. */
export const SCREENS = {
  discover: {
    id: 'discover',
    path: '/',
    nav: 'Discover',
    title: 'Peptides that can tell plastics apart',
    purpose:
      'Start here. What the problem is, what this tool does, and what you will see next.',
  },
  build: {
    id: 'build',
    path: '/build',
    nav: 'Build & Explore',
    title: 'Build a peptide and watch the scores move',
    purpose:
      'Drag building blocks into the eight positions. Every edit is scored for real, instantly.',
  },
  optimise: {
    id: 'optimise',
    path: '/optimise',
    nav: 'Optimise',
    title: 'Set the priority, then run the search',
    purpose:
      'Decide how hard to avoid the other plastics, then watch the nine real computation stages run.',
  },
  compare: {
    id: 'compare',
    path: '/compare',
    nav: 'Compare',
    title: 'Compare candidates and solvers',
    purpose:
      'See the top designs side by side, and how different search methods performed on the same problem.',
  },
  understand: {
    id: 'understand',
    path: '/understand',
    nav: 'Understand',
    title: 'How the maths works',
    purpose:
      'Why 48 switches, how the puzzle is built, how it was checked, and what this project does not prove.',
  },
  results: {
    id: 'results',
    path: '/results',
    nav: 'Results',
    title: 'Your run, written up',
    purpose:
      'A readable summary of the current run, with every number defined, and real downloads.',
  },
} as const;

export type ScreenId = keyof typeof SCREENS;

export const NAV_ORDER: ScreenId[] = [
  'discover',
  'build',
  'optimise',
  'compare',
  'understand',
  'results',
];

/**
 * Where each capability of the original Python benchmark now lives.
 * Kept in code so it is checkable, and rendered on the Understand screen.
 */
export const MIGRATION_MAP = [
  {
    legacy: 'Pipeline',
    legacySource: 'scripts/run_benchmark.py stage sequence',
    screen: 'optimise' as ScreenId,
    section: 'Live Run / Guided Replay',
    note: 'All nine stages are animated from real worker messages, with per-stage timings.',
  },
  {
    legacy: 'Peptides',
    legacySource: 'results/top10_peptides.csv',
    screen: 'compare' as ScreenId,
    section: 'Candidate podium and table',
    note: 'Top candidates with class sequence, all three scores, margins and warning labels.',
  },
  {
    legacy: 'Sweep',
    legacySource: 'results/selectivity_sweep.csv',
    screen: 'compare' as ScreenId,
    section: 'Lambda sweep chart',
    note: 'Each sweep point is solved exactly rather than interpolated.',
  },
  {
    legacy: 'Solvers',
    legacySource: 'results/solver_comparison.csv',
    screen: 'compare' as ScreenId,
    section: 'Solver comparison',
    note: 'Brute force and simulated annealing run live; D-Wave is reported as NOT EXECUTED.',
  },
  {
    legacy: 'QUBO',
    legacySource: 'qbind_select/qubo.py, artifacts/variable_map.json',
    screen: 'understand' as ScreenId,
    section: 'The 48 switches, heatmap and Ising form',
    note: 'The heatmap renders the real coefficient matrix at the selected lambda.',
  },
  {
    legacy: 'Scale (P1)',
    legacySource: 'qbind_select.qubo.safe_penalty',
    screen: 'understand' as ScreenId,
    section: 'Penalty scale and resource growth',
    note: 'P is recomputed live; growth curves are labelled as derived counts, not measured runtimes.',
  },
  {
    legacy: 'Verify',
    legacySource: 'results/run_metadata.json validation block',
    screen: 'understand' as ScreenId,
    section: 'Confidence centre',
    note: 'Checks are re-run in your browser and the measured errors are shown, not quoted.',
  },
  {
    legacy: 'Export',
    legacySource: 'results/*.csv, results/*.json',
    screen: 'results' as ScreenId,
    section: 'Downloads',
    note: 'CSV and JSON of the current run, plus SVG chart export and a printable report.',
  },
  {
    legacy: 'About',
    legacySource: 'docs/methodology.md, docs/judge_explanation.md',
    screen: 'understand' as ScreenId,
    section: 'About this project',
    note: 'Problem, audience, pipeline and methodology, with links to the source documents.',
  },
  {
    legacy: 'Honesty',
    legacySource: 'docs/evidence.md, run_metadata warnings',
    screen: 'results' as ScreenId,
    section: 'Scientific validity assessment',
    note: 'Consolidated into one assessment at the bottom of Results, with a status and the evidence for every claim, rather than repeated on every screen.',
  },
] as const;

/** The standing honesty statements. These appear verbatim where relevant. */
export const HONESTY = {
  noQuantum: 'NO QUANTUM HARDWARE EXECUTION',
  noQuantumDetail:
    'No quantum processor was used at any point, in this website or in the Python benchmark behind it. The problem is written as a QUBO - a puzzle made of on/off switches - which is the format a quantum annealer would accept. That is the whole claim. No quantum speedup is measured, implied or available here.',
  noLab:
    'Nothing here has been tested in a laboratory. Every number is the output of a computational model.',
  noDegradation:
    'This project does not show that any peptide breaks down plastic. It does not model degradation, enzymes or recycling chemistry at all.',
  noBinding:
    'A high score is not a measured binding strength. It is a dimensionless model score, useful for ranking designs against each other and for nothing else.',
  conceptualVisual:
    'Conceptual illustration. Not molecular docking, not a simulation, and not an experimentally observed binding pose. No atomic coordinates, bond distances or interaction energies are implied.',
  classNotResidue:
    'The six options are FAMILIES of amino acids, not individual amino acids. A single letter shown on a block is one representative member of its family, for readability only. The optimisation never distinguishes members within a family.',
  proxyScore:
    'Scores are a computational selectivity proxy. They do not establish physical binding, adhesion, or any recycling benefit.',
  surrogateR2:
    'The surrogate reports R-squared = 1.0. That is expected, not suspicious: the feature basis it fits can represent the scoring model exactly, so it recovers it to numerical precision. It is a consistency check on the encoding, not evidence that the scoring model is correct about biology.',
} as const;

/** Beginner-facing definitions for every number the app displays. */
export const METRIC_HELP = {
  petScore: {
    label: 'PET score',
    direction: 'higher is better',
    unit: 'dimensionless model score',
    plain: 'How strongly the model predicts this design sticks to PET, the drink-bottle plastic. We want this high.',
  },
  peScore: {
    label: 'PE score',
    direction: 'lower is better',
    unit: 'dimensionless model score',
    plain: 'How strongly the model predicts this design sticks to PE, the bag-and-film plastic. We want this low.',
  },
  ppScore: {
    label: 'PP score',
    direction: 'lower is better',
    unit: 'dimensionless model score',
    plain: 'How strongly the model predicts this design sticks to PP, the tub-and-cap plastic. We want this low.',
  },
  meanOffTarget: {
    label: 'Average of the two off-targets',
    direction: 'lower is better',
    unit: 'dimensionless model score',
    plain: 'The PE and PP scores averaged together, as one number.',
  },
  worstOffTarget: {
    label: 'Worst off-target',
    direction: 'lower is better',
    unit: 'dimensionless model score',
    plain: 'Whichever of PE or PP this design scores HIGHEST for. This is the one that would cause mistakes, so it is the strict test.',
  },
  marginMean: {
    label: 'Margin vs average',
    direction: 'higher is better',
    unit: 'dimensionless model score',
    plain: 'PET score minus the average of PE and PP. A bigger gap means a clearer preference for PET.',
  },
  marginWorst: {
    label: 'Margin vs worst case',
    direction: 'higher is better',
    unit: 'dimensionless model score',
    plain: 'PET score minus the worst off-target score. The honest version of the selectivity gap.',
  },
  objective: {
    label: 'Objective',
    direction: 'lower is better',
    unit: 'dimensionless, depends on the chosen priority',
    plain: 'The single number the search minimises. It combines the PET reward with the off-target penalty. It is only comparable between designs at the SAME selectivity priority.',
  },
  penalty: {
    label: 'Constraint penalty P',
    direction: 'not a quality measure',
    unit: 'dimensionless',
    plain: 'How much the puzzle charges for breaking the one-block-per-position rule. It is set deliberately larger than the whole score range, so breaking the rule can never pay off.',
  },
  rankInSpace: {
    label: 'Rank among all designs',
    direction: 'lower is better',
    unit: 'position out of 1,679,616',
    plain: 'Where this design sits if every possible design is lined up best-first at the current priority setting.',
  },
} as const;

export const CANDIDATE_LABEL_HELP: Record<string, { title: string; plain: string }> = {
  BALANCED: {
    title: 'Balanced',
    plain: 'No composition warning triggered. The design is not dominated by one kind of building block.',
  },
  HIGH_HYDROPHOBICITY: {
    title: 'Very greasy',
    plain: 'Three quarters or more of the positions are water-avoiding blocks. Real peptides like this are often hard to dissolve, which the score does not account for.',
  },
  HIGH_CHARGE: {
    title: 'Heavily charged',
    plain: 'Half or more of the positions carry an electrical charge. Strongly charged designs can behave unpredictably in water, which the score does not account for.',
  },
  LOW_SELECTIVITY: {
    title: 'Not actually selective',
    plain: 'The PET score is not above the average of PE and PP. Whatever else is true, this design does not prefer PET.',
  },
};

/** First-run micro-tour. Each step points at a real element. */
export const TOUR_STEPS = [
  {
    id: 'promise',
    target: 'tour-hero',
    title: 'The problem, in one line',
    body: 'Different plastics need to be sorted. We look for short peptide designs that our model scores higher for PET than for the other two common plastics.',
  },
  {
    id: 'plastics',
    target: 'tour-plastics',
    title: 'Three everyday plastics',
    body: 'PET is drink bottles, PE is bags and films, PP is tubs and caps. One is the target; two are the ones to avoid.',
  },
  {
    id: 'blocks',
    target: 'tour-chain',
    title: 'Eight positions, six choices',
    body: 'A design is eight building blocks long. Each position picks one of six families. That gives 1,679,616 possibilities, and we check all of them.',
  },
  {
    id: 'priority',
    target: 'tour-priority',
    title: 'One dial you control',
    body: 'Selectivity Priority decides how hard the search avoids designs that also stick to PE or PP. Move it and the winner can change.',
  },
  {
    id: 'honesty',
    target: 'tour-honesty',
    title: 'What this is not',
    body: 'These are computer predictions. Nothing was tested in a laboratory, and no quantum computer was used.',
  },
] as const;

export const FAQ = [
  {
    q: 'Do I need to know any chemistry to use this?',
    a: 'No. Everything is written in plain language first, with the technical version tucked behind "Advanced" panels. Beginner mode hides the equations entirely.',
  },
  {
    q: 'Is this a real scientific result?',
    a: 'It is a real computation on real published data, and you can reproduce it. It is not a biological finding. No peptide here has been made or tested. The scores rank designs against each other inside one model; they do not predict what would happen in a laboratory.',
  },
  {
    q: 'Was a quantum computer used?',
    a: 'No. NO QUANTUM HARDWARE EXECUTION. The problem is written as a QUBO, which is the format a quantum annealer accepts, and that is the entire quantum connection. The searches you can run here are classical and run in your browser.',
  },
  {
    q: 'Why only six kinds of building block instead of twenty amino acids?',
    a: 'Twenty amino acids over eight positions is 25.6 billion designs, which cannot be checked exhaustively. Grouping them into six families by shared chemistry gives 1,679,616, which can. The trade-off is that the answer is a family pattern, not a specific peptide sequence.',
  },
  {
    q: 'What does the single letter on each block mean?',
    a: 'It is one representative member of that family, shown because letters are easier to read than family names. The maths never distinguishes members inside a family, so do not read the letters as a specific peptide.',
  },
  {
    q: 'Why is the PET score sometimes negative?',
    a: 'The scores come from energies, where the useful comparison is relative, not absolute. A negative score is not "no binding". What matters is the gap between the PET score and the other two.',
  },
  {
    q: 'Does the winner change when I move the priority dial?',
    a: 'Sometimes. Between some settings the same design stays on top while the numbers behind it move. The Optimise screen shows exactly which terms changed even when the winner did not.',
  },
  {
    q: 'Is my data sent anywhere?',
    a: 'No. All computation happens in your browser. There is no account, no server, no analytics and no tracking. Your saved scenarios and preferences stay in your own browser storage, and you can clear them at any time.',
  },
  {
    q: 'Can I check the numbers myself?',
    a: 'Yes. Every run can be downloaded as CSV and JSON including the seed. The Python benchmark that produced the reference results is in the same repository, and the test suite checks the browser scorer against the Python scorer to within 1e-9.',
  },
] as const;

export const KEYBOARD_SHORTCUTS = [
  { keys: '1 - 6', action: 'Place that building-block family in the selected position' },
  { keys: 'Left / Right', action: 'Move between the eight positions' },
  { keys: 'Ctrl + Z', action: 'Undo the last edit' },
  { keys: 'Ctrl + Shift + Z', action: 'Redo' },
  { keys: 'R', action: 'Reset the sequence to the reference design' },
  { keys: '?', action: 'Open the help panel' },
  { keys: 'Esc', action: 'Close any open panel, tour or dialog' },
] as const;

/** Guided challenge on the Build screen. */
export const CHALLENGE = {
  title: 'Can you beat the optimiser?',
  brief:
    'Try to raise the PET score without raising the PE score. It is harder than it looks: the building blocks that like PET often like PE too.',
  successTemplate:
    'You improved the margin against the worst off-target by {delta}. The exact optimum for this setting is {best}.',
  hint: 'Aromatic (flat ring) families tend to help PET. Greasy families tend to help PE and PP as well, so they often cost you selectivity.',
} as const;

export const ACCESSIBILITY_STATEMENT = {
  title: 'Accessibility',
  body: [
    'This site targets WCAG 2.2 AA. Every interactive control is reachable and operable with a keyboard, has a visible focus ring, and has a touch target of at least 44 by 44 pixels.',
    'The peptide builder supports three input methods: drag and drop with a mouse, tap to select on touch screens, and keyboard placement with the number keys. No feature requires dragging.',
    'Charts never use colour as the only signal. Series are labelled directly, legends carry shapes as well as colours, and every data point is reachable as text in the accompanying table.',
    'Animation can be switched off, either by your operating system setting or with the motion control in the header. Nothing that matters is conveyed by motion alone.',
    'If something here is not usable for you, that is a defect worth reporting against the repository.',
  ],
} as const;

export const LEGAL = {
  title: 'Scientific and legal notice',
  body: [
    'QBind Select is an educational and research-demonstration tool. It is not a scientific publication, not a medical or environmental product, and not advice.',
    'All displayed values are outputs of a computational model built from publicly available Potts-model energies (QA-PBP-RL-Nexus). They are predictions, not measurements.',
    'No peptide described here has been synthesised or tested. No claim is made that any design binds, adheres to, degrades, or assists in recycling any material.',
    'No quantum hardware was used. Any resemblance to a quantum-advantage claim is unintended and incorrect.',
    'The underlying data belongs to its original authors under their own licence. Please cite the original sources, listed on this screen, rather than this website.',
  ],
} as const;

export const SOURCES = [
  {
    label: 'QA-PBP-RL-Nexus (Potts energies and quantum-annealing code)',
    detail: 'PEESEgroup. Shallow-cloned at commit cd63b7ef2f4be2725971fe86d5510090d54242e5.',
    role: 'The scoring model used by this site is aggregated from this data.',
  },
  {
    label: 'Dhoriyani et al. (2025), PNAS Nexus',
    detail: 'Biophysical modelling, quantum computing and AI for plastic-binding peptides.',
    role: 'Source publication for the energy model and the overall problem framing.',
  },
  {
    label: 'Jain et al. (2025), Chemical Science',
    detail: 'AI-driven plastic-binding peptide design.',
    role: 'Background on the research area.',
  },
  {
    label: 'PEESEgroup LSTM-SA repository',
    detail: 'PET/PE/PP 12-mer datasets.',
    role: 'Related dataset, not used directly by this site.',
  },
  {
    label: 'D-Wave Ocean documentation',
    detail: 'dimod, dwave-samplers, dwave-system.',
    role: 'Defines the QUBO/BQM format the problem is expressed in.',
  },
] as const;

/** Explanation of what changed between two scored states, in plain language. */
export function describeScoreChange(
  petDelta: number,
  peDelta: number,
  ppDelta: number,
  marginDelta: number,
): string {
  const parts: string[] = [];
  const word = (d: number) => (d > 0 ? 'increased' : 'decreased');
  const near = (d: number) => Math.abs(d) < 1e-9;

  if (near(petDelta) && near(peDelta) && near(ppDelta)) {
    return 'That edit left all three scores unchanged.';
  }
  if (!near(petDelta)) parts.push(`the PET score ${word(petDelta)} by ${Math.abs(petDelta).toFixed(2)}`);
  if (!near(peDelta)) parts.push(`the PE score ${word(peDelta)} by ${Math.abs(peDelta).toFixed(2)}`);
  if (!near(ppDelta)) parts.push(`the PP score ${word(ppDelta)} by ${Math.abs(ppDelta).toFixed(2)}`);

  const verdict = near(marginDelta)
    ? 'Overall selectivity against the worst off-target did not change.'
    : marginDelta > 0
      ? `Overall this is more selective for PET: the margin against the worst off-target improved by ${marginDelta.toFixed(2)}.`
      : `Overall this is less selective for PET: the margin against the worst off-target fell by ${Math.abs(marginDelta).toFixed(2)}.`;

  return `This edit means ${parts.join(', ')}. ${verdict}`;
}

/** Plain-language reading of a lambda value. */
export function describeLambda(lambda: number): { headline: string; detail: string } {
  if (lambda === 0) {
    return {
      headline: 'Ignore the other plastics completely',
      detail:
        'The search only tries to score well for PET. It will happily pick a design that sticks to PE and PP just as much, which is usually not what you want.',
    };
  }
  if (lambda < 0.75) {
    return {
      headline: 'Mostly chase PET, mildly avoid the others',
      detail:
        'PET scoring dominates, with a gentle push away from designs that also score well for PE or PP.',
    };
  }
  if (lambda < 1.5) {
    return {
      headline: 'Balanced',
      detail:
        'Scoring well for PET and avoiding the other two are weighted comparably. This is the setting the published benchmark reports as its default.',
    };
  }
  if (lambda < 3.5) {
    return {
      headline: 'Strongly avoid the other plastics',
      detail:
        'Avoiding PE and PP now outweighs PET performance. Expect the winner to give up some PET score to stay away from the others.',
    };
  }
  return {
    headline: 'Avoiding the others dominates everything',
    detail:
      'The penalty is so heavy that the search mostly minimises PE and PP, almost regardless of the PET score. Watch the PET score fall as you approach this end.',
  };
}
