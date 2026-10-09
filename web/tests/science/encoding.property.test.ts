/**
 * SEEDED PROPERTY SUITE - the 6-class alphabet, the 48-variable one-hot
 * encoding and the base-6 sequence index.
 *
 * Every random case is drawn from `makeRng` (mulberry32), never Math.random,
 * so a failure is reproducible: the seed is in the test name and the failing
 * sequence is in the assertion message.
 *
 * These are STRUCTURAL properties only - bijections, round-trips and the
 * rejection of malformed vectors. Nothing here asserts a score, a runtime or a
 * biological claim; the numerical parity gate is tests/science/parity.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  ALPHABET_SIZE,
  BINARY_VARIABLES,
  CLASSES,
  LENGTH,
  REPRESENTATIVES,
  VALID_SEQUENCES,
  classSequence,
  codesToIndex,
  decode,
  encode,
  indexToCodes,
  isValidCodes,
  isValidOneHot,
  oneHotViolations,
  parseClassSequence,
  representativeSequence,
  variableIndex,
  type Codes,
} from '../../src/science/alphabet';
import { makeRng, type Rng } from '../../src/science/rng';

/* -------------------------------------------------------------- local helpers */

function randomCodes(rng: Rng): number[] {
  const codes = new Array<number>(LENGTH);
  for (let i = 0; i < LENGTH; i += 1) codes[i] = rng.int(ALPHABET_SIZE);
  return codes;
}

/** Plain number[] (not Uint8Array) so non-0/1 probe values survive untouched. */
function encodeLoose(codes: Codes): number[] {
  return Array.from(encode(codes));
}

function countValue(x: ArrayLike<number>, value: number): number {
  let n = 0;
  for (let i = 0; i < x.length; i += 1) if (x[i] === value) n += 1;
  return n;
}

function hotIndices(x: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < x.length; i += 1) if (x[i] === 1) out.push(i);
  return out;
}

/** -1 / 0 / +1 comparing the code arrays as base-6 digit strings, MSB first. */
function lexCompare(a: Codes, b: Codes): number {
  for (let i = 0; i < LENGTH; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

const tag = (codes: Codes): string => codes.join('');

/** Base-6 repunit: codesToIndex([c x 8]) === c * REPUNIT. */
const REPUNIT = (VALID_SEQUENCES - 1) / (ALPHABET_SIZE - 1); // 335_923
const LAST = VALID_SEQUENCES - 1; // 1_679_615

/* ============================================================================
 * 1. codesToIndex / indexToCodes are mutual inverses
 * ========================================================================== */

describe('index bijection: strided sweep of the whole 6^8 space', () => {
  it.each([97, 503, 4099])(
    'round-trips every %ith index and decodes only valid 8-code sequences',
    (stride) => {
      const roundTripFailures: string[] = [];
      const shapeFailures: string[] = [];
      let visited = 0;

      for (let index = 0; index < VALID_SEQUENCES; index += stride) {
        visited += 1;
        const codes = indexToCodes(index);
        if (
          codes.length !== LENGTH ||
          !isValidCodes(codes) ||
          codes.some((c) => c < 0 || c >= ALPHABET_SIZE)
        ) {
          shapeFailures.push(`${index} -> [${codes.join(',')}]`);
        }
        if (codesToIndex(codes) !== index) {
          roundTripFailures.push(`${index} -> ${tag(codes)} -> ${codesToIndex(codes)}`);
        }
      }

      expect(visited).toBe(Math.ceil(VALID_SEQUENCES / stride));
      expect(shapeFailures.slice(0, 5), 'first malformed decodings').toEqual([]);
      expect(shapeFailures).toHaveLength(0);
      expect(roundTripFailures.slice(0, 5), 'first round-trip breaks').toEqual([]);
      expect(roundTripFailures).toHaveLength(0);
    },
  );

  it('the stride-97 sweep covers 17316 distinct sequences', () => {
    const seen = new Set<string>();
    let count = 0;
    for (let index = 0; index < VALID_SEQUENCES; index += 97) {
      count += 1;
      seen.add(tag(indexToCodes(index)));
    }
    expect(count).toBe(17_316);
    expect(seen.size).toBe(count);
    expect(count).toBeGreaterThan(17_000);
  });
});

const BOUNDARY_INDICES = [
  0, 1, 2, 3, 4, 5, 6, 7, 35, 36, 37, 215, 216, 217, 1295, 1296, 1297, 7775, 7776, 7777, 46_655,
  46_656, 46_657, 279_935, 279_936, 279_937, LAST - 2, LAST - 1, LAST,
];

describe('index bijection: boundary indices', () => {
  it.each(BOUNDARY_INDICES)('index %i survives index -> codes -> index', (index) => {
    const codes = indexToCodes(index);
    expect(codes, `decoded ${index}`).toHaveLength(LENGTH);
    expect(isValidCodes(codes), `decoded ${index} = [${codes.join(',')}]`).toBe(true);
    expect(codes.every((c) => Number.isInteger(c) && c >= 0 && c < ALPHABET_SIZE)).toBe(true);
    expect(codesToIndex(codes), `round-trip of ${index}`).toBe(index);
  });

  it('pins the exact digit layout at both ends of the enumeration', () => {
    expect(indexToCodes(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(indexToCodes(1)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(indexToCodes(5)).toEqual([0, 0, 0, 0, 0, 0, 0, 5]);
    expect(indexToCodes(6)).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
    expect(indexToCodes(LAST)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect(indexToCodes(LAST - 1)).toEqual([5, 5, 5, 5, 5, 5, 5, 4]);
    expect(indexToCodes(LAST - 6)).toEqual([5, 5, 5, 5, 5, 5, 4, 5]);
    expect(codesToIndex([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(codesToIndex([5, 5, 5, 5, 5, 5, 5, 5])).toBe(LAST);
    expect(codesToIndex([1, 0, 0, 0, 0, 0, 0, 0])).toBe(ALPHABET_SIZE ** (LENGTH - 1));
    expect(VALID_SEQUENCES).toBe(1_679_616);
    expect(REPUNIT).toBe(335_923);
  });

  it('position 0 is the most significant digit, position 7 the least', () => {
    for (let i = 0; i < LENGTH; i += 1) {
      const bumped = [0, 0, 0, 0, 0, 0, 0, 0];
      bumped[i] = 1;
      expect(codesToIndex(bumped), `bumping position ${i}`).toBe(
        ALPHABET_SIZE ** (LENGTH - 1 - i),
      );
    }
  });
});

describe('index bijection: seeded random cases', () => {
  it('index -> codes -> index holds for 160 random indices (seed 0x51bee1)', () => {
    const rng = makeRng(0x51bee1);
    for (let t = 0; t < 160; t += 1) {
      const index = rng.int(VALID_SEQUENCES);
      const codes = indexToCodes(index);
      const msg = `case ${t}: index ${index} -> ${tag(codes)}`;
      expect(isValidCodes(codes), msg).toBe(true);
      expect(codes, msg).toHaveLength(LENGTH);
      expect(codesToIndex(codes), msg).toBe(index);
    }
  });

  it('codes -> index -> codes holds for 160 random sequences (seed 0xc0de5)', () => {
    const rng = makeRng(0xc0de5);
    for (let t = 0; t < 160; t += 1) {
      const codes = randomCodes(rng);
      const index = codesToIndex(codes);
      const msg = `case ${t}: ${tag(codes)} -> index ${index}`;
      expect(index, msg).toBeGreaterThanOrEqual(0);
      expect(index, msg).toBeLessThan(VALID_SEQUENCES);
      expect(indexToCodes(index), msg).toEqual(codes);
    }
  });

  it('the index equals the base-6 Horner value of the digits (seed 0x6a5e6)', () => {
    const rng = makeRng(0x6a5e6);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      let expected = 0;
      for (let i = 0; i < LENGTH; i += 1) expected += codes[i] * ALPHABET_SIZE ** (LENGTH - 1 - i);
      expect(codesToIndex(codes), `case ${t}: ${tag(codes)}`).toBe(expected);
    }
  });
});

describe('codesToIndex rejects malformed code arrays', () => {
  it.each([
    ['too short', [0, 1, 2, 3, 4, 5, 0]],
    ['too long', [0, 1, 2, 3, 4, 5, 0, 1, 2]],
    ['empty', []],
    ['class 6 out of range', [0, 0, 0, 0, 0, 0, 0, 6]],
    ['negative class', [0, 0, 0, 0, 0, 0, 0, -1]],
    ['fractional class', [0, 0, 0, 0, 0, 0, 0, 1.5]],
    ['NaN class', [0, 0, 0, 0, 0, 0, 0, Number.NaN]],
    ['Infinity class', [0, 0, 0, 0, 0, 0, 0, Number.POSITIVE_INFINITY]],
  ])('%s', (_name, codes) => {
    expect(isValidCodes(codes)).toBe(false);
    expect(() => codesToIndex(codes)).toThrow(/8-position sequence/);
  });
});

/* ============================================================================
 * 6. indexToCodes throws outside [0, 6^8)
 * ========================================================================== */

describe('indexToCodes range guard', () => {
  it.each([
    -1,
    -2,
    -1_000_000,
    VALID_SEQUENCES,
    VALID_SEQUENCES + 1,
    VALID_SEQUENCES + 1000,
    1.5,
    0.5,
    -0.5,
    2.0000001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
  ])('throws for %p', (index) => {
    expect(() => indexToCodes(index)).toThrow();
    expect(() => indexToCodes(index)).toThrow(/out of range/);
  });

  it('accepts exactly the half-open range [0, 6^8)', () => {
    expect(() => indexToCodes(0)).not.toThrow();
    expect(() => indexToCodes(LAST)).not.toThrow();
    expect(() => indexToCodes(VALID_SEQUENCES)).toThrow(/out of range/);
    expect(() => indexToCodes(-1)).toThrow(/out of range/);
  });
});

/* ============================================================================
 * 2. encode / decode round-trip and one-hot shape
 * ========================================================================== */

describe('encode / decode round-trip', () => {
  it('144 random sequences encode to 48 bits with exactly 8 ones (seed 0x10701)', () => {
    const rng = makeRng(0x10701);
    for (let t = 0; t < 144; t += 1) {
      const codes = randomCodes(rng);
      const x = encode(codes);
      const msg = `case ${t}: ${tag(codes)}`;
      expect(x.length, msg).toBe(BINARY_VARIABLES);
      expect(countValue(x, 1), msg).toBe(LENGTH);
      expect(countValue(x, 0), msg).toBe(BINARY_VARIABLES - LENGTH);
      expect(isValidOneHot(x), msg).toBe(true);
      expect(oneHotViolations(x), msg).toEqual([]);
      expect(decode(x), msg).toEqual(codes);
    }
  });

  it('the hot bits sit exactly at variableIndex(i, codes[i]) (seed 0xb175)', () => {
    const rng = makeRng(0xb175);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      const x = encode(codes);
      const expected = codes.map((c, i) => variableIndex(i, c)).slice().sort((a, b) => a - b);
      const msg = `case ${t}: ${tag(codes)}`;
      expect(hotIndices(x), msg).toEqual(expected);
      expect(hotIndices(x).length, msg).toBe(LENGTH);
      for (let i = 0; i < LENGTH; i += 1) {
        expect(x[variableIndex(i, codes[i])], `${msg} position ${i}`).toBe(1);
      }
    }
  });

  it('encode -> index -> decode agrees with encode -> decode (seed 0xcr055)', () => {
    const rng = makeRng(0xc0055);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      const viaIndex = indexToCodes(codesToIndex(codes));
      const viaOneHot = decode(encode(codes));
      const msg = `case ${t}: ${tag(codes)}`;
      expect(viaIndex, msg).toEqual(viaOneHot);
      expect(classSequence(viaIndex), msg).toBe(classSequence(viaOneHot));
    }
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'the uniform all-class-%i sequence is self-consistent end to end',
    (c) => {
      const codes = new Array<number>(LENGTH).fill(c);
      const index = codesToIndex(codes);
      const x = encode(codes);
      expect(index).toBe(c * REPUNIT);
      expect(indexToCodes(index)).toEqual(codes);
      expect(countValue(x, 1)).toBe(LENGTH);
      expect(isValidOneHot(x)).toBe(true);
      expect(decode(x)).toEqual(codes);
      expect(classSequence(codes).split('-').every((t) => t === CLASSES[c])).toBe(true);
      expect(representativeSequence(codes)).toBe(REPRESENTATIVES[c].repeat(LENGTH));
      expect(parseClassSequence(classSequence(codes))).toEqual(codes);
    },
  );

  it('encode rejects what codesToIndex rejects', () => {
    const bad: number[][] = [
      [0, 1, 2, 3, 4, 5, 0],
      [0, 1, 2, 3, 4, 5, 0, 1, 2],
      [0, 0, 0, 0, 0, 0, 0, 6],
      [0, 0, 0, 0, 0, 0, 0, -1],
      [0, 0, 0, 0, 0, 0, 0, 0.5],
      [Number.NaN, 0, 0, 0, 0, 0, 0, 0],
      [],
    ];
    for (const codes of bad) {
      expect(() => encode(codes), `[${codes.join(',')}]`).toThrow(/8-position sequence/);
      expect(() => classSequence(codes), `[${codes.join(',')}]`).toThrow(/8-position sequence/);
      expect(() => representativeSequence(codes), `[${codes.join(',')}]`).toThrow(
        /8-position sequence/,
      );
    }
  });
});

/* ============================================================================
 * 3. isValidOneHot / oneHotViolations reject malformed vectors
 * ========================================================================== */

const REFERENCE_CODES = [2, 3, 0, 5, 1, 4, 2, 0];

interface BadVector {
  readonly why: string;
  readonly build: () => number[];
}

const BAD_VECTORS: readonly BadVector[] = [
  { why: 'length 47 (last bit dropped)', build: () => encodeLoose(REFERENCE_CODES).slice(0, 47) },
  { why: 'length 49 (extra zero)', build: () => [...encodeLoose(REFERENCE_CODES), 0] },
  { why: 'length 49 (extra one)', build: () => [...encodeLoose(REFERENCE_CODES), 1] },
  { why: 'length 0', build: () => [] },
  { why: 'length 6', build: () => [1, 0, 0, 0, 0, 0] },
  { why: 'length 42 (one position short)', build: () => encodeLoose(REFERENCE_CODES).slice(0, 42) },
  { why: 'all zeros', build: () => new Array<number>(BINARY_VARIABLES).fill(0) },
  { why: 'all ones', build: () => new Array<number>(BINARY_VARIABLES).fill(1) },
  {
    why: 'position 0 has 0 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(0, REFERENCE_CODES[0])] = 0;
      return x;
    },
  },
  {
    why: 'position 7 has 0 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(7, REFERENCE_CODES[7])] = 0;
      return x;
    },
  },
  {
    why: 'position 3 has 2 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(3, (REFERENCE_CODES[3] + 1) % ALPHABET_SIZE)] = 1;
      return x;
    },
  },
  {
    why: 'position 5 has 2 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(5, (REFERENCE_CODES[5] + 3) % ALPHABET_SIZE)] = 1;
      return x;
    },
  },
  {
    why: 'position 2 has all 6 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      for (let a = 0; a < ALPHABET_SIZE; a += 1) x[variableIndex(2, a)] = 1;
      return x;
    },
  },
  {
    why: 'position 6 has all 6 bits',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      for (let a = 0; a < ALPHABET_SIZE; a += 1) x[variableIndex(6, a)] = 1;
      return x;
    },
  },
  {
    why: 'value 2 instead of 1',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(4, REFERENCE_CODES[4])] = 2;
      return x;
    },
  },
  {
    why: 'value -1 somewhere',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(1, (REFERENCE_CODES[1] + 2) % ALPHABET_SIZE)] = -1;
      return x;
    },
  },
  {
    why: 'fractional 0.5 in one slot',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(0, (REFERENCE_CODES[0] + 1) % ALPHABET_SIZE)] = 0.5;
      return x;
    },
  },
  {
    why: 'two halves summing to one',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(2, REFERENCE_CODES[2])] = 0.5;
      x[variableIndex(2, (REFERENCE_CODES[2] + 1) % ALPHABET_SIZE)] = 0.5;
      return x;
    },
  },
  {
    why: 'NaN in one slot',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(6, REFERENCE_CODES[6])] = Number.NaN;
      return x;
    },
  },
  {
    why: 'Infinity in one slot',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(5, 0)] = Number.POSITIVE_INFINITY;
      return x;
    },
  },
  {
    why: 'bit moved to the wrong position (one empty, one doubled)',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      x[variableIndex(1, REFERENCE_CODES[1])] = 0;
      x[variableIndex(2, (REFERENCE_CODES[2] + 1) % ALPHABET_SIZE)] = 1;
      return x;
    },
  },
  {
    why: 'every position doubled',
    build: () => {
      const x = encodeLoose(REFERENCE_CODES);
      for (let i = 0; i < LENGTH; i += 1) {
        x[variableIndex(i, (REFERENCE_CODES[i] + 1) % ALPHABET_SIZE)] = 1;
      }
      return x;
    },
  },
];

describe('isValidOneHot rejects malformed vectors', () => {
  it.each(BAD_VECTORS.map((b) => [b.why, b] as const))('rejects: %s', (_why, bad) => {
    const x = bad.build();
    expect(isValidOneHot(x), _why).toBe(false);
    expect(() => decode(x), _why).toThrow(/invalid one-hot/);
    expect(isValidOneHot(encodeLoose(REFERENCE_CODES)), 'control vector stays valid').toBe(true);
  });

  it('accepts the 48 single-hot-per-position encodings it should accept', () => {
    for (let i = 0; i < LENGTH; i += 1) {
      for (let a = 0; a < ALPHABET_SIZE; a += 1) {
        const codes = REFERENCE_CODES.slice();
        codes[i] = a;
        const x = encode(codes);
        expect(isValidOneHot(x), `position ${i} -> class ${a}`).toBe(true);
        expect(decode(x), `position ${i} -> class ${a}`).toEqual(codes);
      }
    }
  });
});

describe('oneHotViolations lists exactly the broken positions', () => {
  it('reports [] for 64 valid encodings (seed 0x0a9)', () => {
    const rng = makeRng(0x0a9);
    for (let t = 0; t < 64; t += 1) {
      const codes = randomCodes(rng);
      expect(oneHotViolations(encode(codes)), `case ${t}: ${tag(codes)}`).toEqual([]);
    }
  });

  it('reports exactly the broken positions for 96 multi-position breakages (seed 0xbad0)', () => {
    const rng = makeRng(0xbad0);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      const x = encodeLoose(codes);
      // Break between 1 and 4 distinct positions, each in a sum-changing way.
      const broken = new Set<number>();
      const wanted = 1 + rng.int(4);
      while (broken.size < wanted) broken.add(rng.int(LENGTH));
      for (const i of broken) {
        const mode = rng.int(3);
        if (mode === 0) {
          x[variableIndex(i, codes[i])] = 0; // 0 bits
        } else if (mode === 1) {
          x[variableIndex(i, (codes[i] + 1 + rng.int(ALPHABET_SIZE - 1)) % ALPHABET_SIZE)] = 1; // 2 bits
        } else {
          for (let a = 0; a < ALPHABET_SIZE; a += 1) x[variableIndex(i, a)] = 1; // 6 bits
        }
      }
      const expected = [...broken].sort((a, b) => a - b);
      const msg = `case ${t}: ${tag(codes)} broken at [${expected.join(',')}]`;
      expect(oneHotViolations(x), msg).toEqual(expected);
      expect(isValidOneHot(x), msg).toBe(false);
      expect(() => decode(x), msg).toThrow(/invalid one-hot/);
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('a single empty position %i is the only violation', (i) => {
    const x = encodeLoose(REFERENCE_CODES);
    x[variableIndex(i, REFERENCE_CODES[i])] = 0;
    expect(oneHotViolations(x)).toEqual([i]);
    expect(oneHotViolations(x)).toHaveLength(1);
    expect(isValidOneHot(x)).toBe(false);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])('a single doubled position %i is the only violation', (i) => {
    const x = encodeLoose(REFERENCE_CODES);
    x[variableIndex(i, (REFERENCE_CODES[i] + 1) % ALPHABET_SIZE)] = 1;
    expect(oneHotViolations(x)).toEqual([i]);
    expect(isValidOneHot(x)).toBe(false);
    expect(() => decode(x)).toThrow(/invalid one-hot/);
  });

  it('flags all eight positions for the all-on and the all-off vector', () => {
    const allOn = new Array<number>(BINARY_VARIABLES).fill(1);
    const allOff = new Array<number>(BINARY_VARIABLES).fill(0);
    expect(oneHotViolations(allOn)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(oneHotViolations(allOff)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(isValidOneHot(allOn)).toBe(false);
    expect(isValidOneHot(allOff)).toBe(false);
  });

  it('is a per-position SUM check, so it is weaker than isValidOneHot', () => {
    // Documented, deliberate difference: oneHotViolations only sums a position,
    // so a fractional pair summing to 1 passes it while isValidOneHot rejects
    // the non-binary values. Teaching views use the former, solvers the latter.
    const x = encodeLoose(REFERENCE_CODES);
    const p = 4;
    x[variableIndex(p, REFERENCE_CODES[p])] = 0.5;
    x[variableIndex(p, (REFERENCE_CODES[p] + 1) % ALPHABET_SIZE)] = 0.5;
    expect(oneHotViolations(x)).toEqual([]);
    expect(isValidOneHot(x)).toBe(false);
    expect(() => decode(x)).toThrow(/invalid one-hot/);
  });

  it('treats positions missing from a truncated vector as empty', () => {
    const x = encodeLoose(REFERENCE_CODES).slice(0, 36); // positions 6 and 7 gone
    expect(x).toHaveLength(36);
    expect(oneHotViolations(x)).toEqual([6, 7]);
    expect(isValidOneHot(x)).toBe(false);
    expect(() => decode(x)).toThrow(/invalid one-hot/);
  });
});

/* ============================================================================
 * 4. variableIndex(i, a) = i*6 + a is a bijection onto 0..47
 * ========================================================================== */

describe('variableIndex is a bijection onto 0..47', () => {
  const PAIRS: [number, number][] = [];
  for (let i = 0; i < LENGTH; i += 1) {
    for (let a = 0; a < ALPHABET_SIZE; a += 1) PAIRS.push([i, a]);
  }

  it.each(PAIRS)('variableIndex(%i, %i) is i*6+a and inverts back', (i, a) => {
    const v = variableIndex(i, a);
    expect(v, `pair (${i},${a})`).toBe(i * ALPHABET_SIZE + a);
    expect(Math.floor(v / ALPHABET_SIZE), `position from ${v}`).toBe(i);
    expect(v % ALPHABET_SIZE, `class from ${v}`).toBe(a);
    expect(v, `pair (${i},${a}) in range`).toBeGreaterThanOrEqual(0);
    expect(v, `pair (${i},${a}) in range`).toBeLessThan(BINARY_VARIABLES);
  });

  it('covers 0..47 exactly once and is strictly increasing in (i, a)', () => {
    const seen = PAIRS.map(([i, a]) => variableIndex(i, a));
    expect(new Set(seen).size).toBe(BINARY_VARIABLES);
    expect(seen).toHaveLength(BINARY_VARIABLES);
    expect(Math.min(...seen)).toBe(0);
    expect(Math.max(...seen)).toBe(BINARY_VARIABLES - 1);
    expect(seen.slice().sort((p, q) => p - q)).toEqual(
      Array.from({ length: BINARY_VARIABLES }, (_, k) => k),
    );
    for (let k = 1; k < seen.length; k += 1) {
      expect(seen[k], `entry ${k} follows ${seen[k - 1]}`).toBe(seen[k - 1] + 1);
    }
  });

  it('round-trips random (position, class) pairs through the flat index (seed 0x7a81e)', () => {
    const rng = makeRng(0x7a81e);
    for (let t = 0; t < 96; t += 1) {
      const i = rng.int(LENGTH);
      const a = rng.int(ALPHABET_SIZE);
      const v = variableIndex(i, a);
      const msg = `case ${t}: (${i},${a}) -> ${v}`;
      expect(Math.floor(v / ALPHABET_SIZE), msg).toBe(i);
      expect(v % ALPHABET_SIZE, msg).toBe(a);
      expect(variableIndex(Math.floor(v / ALPHABET_SIZE), v % ALPHABET_SIZE), msg).toBe(v);
    }
  });
});

/* ============================================================================
 * 5. classSequence / representativeSequence / parseClassSequence
 * ========================================================================== */

describe('class sequence strings round-trip', () => {
  it('96 random sequences survive classSequence -> parseClassSequence (seed 0x5e9f)', () => {
    const rng = makeRng(0x5e9f);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      const text = classSequence(codes);
      const msg = `case ${t}: ${text}`;
      expect(text.split('-'), msg).toHaveLength(LENGTH);
      expect(parseClassSequence(text), msg).toEqual(codes);
      expect(parseClassSequence(text.toLowerCase()), `${msg} (lowercase)`).toEqual(codes);
      expect(parseClassSequence(`  ${text}  `), `${msg} (padded)`).toEqual(codes);
    }
  });

  it('representativeSequence is 8 display letters drawn from the class table (seed 0xd15b)', () => {
    const rng = makeRng(0xd15b);
    for (let t = 0; t < 96; t += 1) {
      const codes = randomCodes(rng);
      const repr = representativeSequence(codes);
      const msg = `case ${t}: ${tag(codes)} -> ${repr}`;
      expect(repr, msg).toHaveLength(LENGTH);
      expect([...repr].every((ch) => (REPRESENTATIVES as readonly string[]).includes(ch)), msg).toBe(
        true,
      );
      expect(repr, msg).toBe(codes.map((c) => REPRESENTATIVES[c]).join(''));
      // Display letters are lossy only across classes sharing a letter: here the
      // class table has 6 distinct letters, so the mapping is invertible.
      expect(
        [...repr].map((ch) => (REPRESENTATIVES as readonly string[]).indexOf(ch)),
        msg,
      ).toEqual(codes);
    }
  });

  it('mixed case and per-token whitespace parse to the same codes', () => {
    const codes = [1, 4, 2, 2, 5, 0, 3, 1];
    const text = classSequence(codes);
    expect(parseClassSequence(text)).toEqual(codes);
    expect(parseClassSequence(text.toLowerCase())).toEqual(codes);
    expect(parseClassSequence(text.split('-').map((t) => ` ${t} `).join('-'))).toEqual(codes);
    expect(
      parseClassSequence(
        text
          .split('-')
          .map((t, i) => (i % 2 === 0 ? t.toLowerCase() : t))
          .join('-'),
      ),
    ).toEqual(codes);
  });

  it.each(CLASSES.map((name, i) => [name, i] as const))(
    'class token %s parses back to index %i in every position',
    (name, index) => {
      for (let p = 0; p < LENGTH; p += 1) {
        const codes = [0, 0, 0, 0, 0, 0, 0, 0];
        codes[p] = index;
        expect(parseClassSequence(classSequence(codes)), `${name} at ${p}`).toEqual(codes);
      }
    },
  );
});

describe('parseClassSequence rejects bad input', () => {
  const GOOD = classSequence([0, 1, 2, 3, 4, 5, 0, 1]);
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['single hyphen', '-'],
    ['seven empty tokens', '-------'],
    ['7 tokens', GOOD.split('-').slice(0, 7).join('-')],
    ['9 tokens', `${GOOD}-AROM_W`],
    ['1 token', 'AROM_W'],
    ['unknown class name', `${GOOD.split('-').slice(0, 7).join('-')}-NOT_A_CLASS`],
    ['chemical name instead of class', 'ALANINE-AROM_W-AROM_W-AROM_W-AROM_W-AROM_W-AROM_W-AROM_W'],
    ['numeric codes', '0-1-2-3-4-5-0-1'],
    ['representative letters', 'W-F-L-S-E-K-W-F'],
    ['class names joined by the wrong separator', GOOD.replace(/-/g, ' ')],
    ['one token blank', `${GOOD.split('-').slice(0, 7).join('-')}-`],
  ])('throws on %s', (_why, text) => {
    expect(() => parseClassSequence(text), _why).toThrow();
    expect(() => parseClassSequence(text), _why).toThrow(/cannot parse class sequence/);
  });

  it('accepts the canonical spelling it rejects variants of', () => {
    expect(parseClassSequence(GOOD)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(classSequence(parseClassSequence(GOOD))).toBe(GOOD);
  });
});

/* ============================================================================
 * 7. Lexicographic order of codes matches numeric order of indices
 * ========================================================================== */

describe('index order is lexicographic order of the code arrays', () => {
  it('sign(index difference) equals lexicographic sign for 160 random pairs (seed 0x1ex0)', () => {
    const rng = makeRng(0x1ec0);
    for (let t = 0; t < 160; t += 1) {
      const a = randomCodes(rng);
      const b = randomCodes(rng);
      const ia = codesToIndex(a);
      const ib = codesToIndex(b);
      const msg = `case ${t}: ${tag(a)} (#${ia}) vs ${tag(b)} (#${ib})`;
      expect(Math.sign(ia - ib), msg).toBe(lexCompare(a, b));
      expect(ia < ib, `${msg} - strictly-smaller implication`).toBe(lexCompare(a, b) < 0);
    }
  });

  it('holds for 96 pairs differing in exactly one position (seed 0x0ne0)', () => {
    const rng = makeRng(0x0e0);
    for (let t = 0; t < 96; t += 1) {
      const a = randomCodes(rng);
      const p = rng.int(LENGTH);
      const b = a.slice();
      b[p] = (a[p] + 1 + rng.int(ALPHABET_SIZE - 1)) % ALPHABET_SIZE;
      const msg = `case ${t}: ${tag(a)} vs ${tag(b)} at position ${p}`;
      expect(Math.sign(codesToIndex(a) - codesToIndex(b)), msg).toBe(lexCompare(a, b));
      expect(codesToIndex(a) === codesToIndex(b), msg).toBe(false);
    }
  });

  it('equal sequences give equal indices (seed 0x5a3e)', () => {
    const rng = makeRng(0x5a3e);
    for (let t = 0; t < 48; t += 1) {
      const a = randomCodes(rng);
      const b = a.slice();
      expect(lexCompare(a, b), `case ${t}`).toBe(0);
      expect(codesToIndex(a) - codesToIndex(b), `case ${t}`).toBe(0);
    }
  });

  it('sorting 64 random indices ascending sorts their codes lexicographically (seed 0x50r7)', () => {
    const rng = makeRng(0x5017);
    const indices = Array.from({ length: 64 }, () => rng.int(VALID_SEQUENCES)).sort(
      (p, q) => p - q,
    );
    const codes = indices.map((i) => indexToCodes(i));
    for (let k = 1; k < codes.length; k += 1) {
      const cmp = lexCompare(codes[k - 1], codes[k]);
      const expected = indices[k - 1] === indices[k] ? 0 : -1;
      expect(cmp, `#${indices[k - 1]} ${tag(codes[k - 1])} before #${indices[k]} ${tag(codes[k])}`).toBe(
        expected,
      );
    }
  });

  it('consecutive indices differ by a single base-6 increment', () => {
    const rng = makeRng(0x57e9);
    for (let t = 0; t < 64; t += 1) {
      const index = rng.int(VALID_SEQUENCES - 1);
      const here = indexToCodes(index);
      const next = indexToCodes(index + 1);
      const msg = `case ${t}: #${index} ${tag(here)} -> #${index + 1} ${tag(next)}`;
      expect(lexCompare(here, next), msg).toBe(-1);
      expect(codesToIndex(next) - codesToIndex(here), msg).toBe(1);
    }
  });
});
