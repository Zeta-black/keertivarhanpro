/**
 * Deterministic, seedable RNG. Every stochastic thing in this app (simulated
 * annealing, feature sampling, demo shuffles) draws from here so a run with the
 * same seed reproduces exactly, in any browser.
 *
 * mulberry32: small, fast, good enough for Monte-Carlo search. It is NOT a
 * cryptographic generator and is never used for anything security-related.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** The seed this generator started from. */
  readonly seed: number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    seed: seed >>> 0,
  };
}

/** Sample `count` distinct integers from [0, n) without replacement. */
export function sampleWithoutReplacement(rng: Rng, n: number, count: number): number[] {
  if (count > n) throw new Error(`cannot sample ${count} distinct values from ${n}`);
  // Floyd's algorithm: O(count) memory, no need to materialise the population.
  const picked = new Set<number>();
  const out: number[] = [];
  for (let i = n - count; i < n; i += 1) {
    let j = rng.int(i + 1);
    if (picked.has(j)) j = i;
    picked.add(j);
    out.push(j);
  }
  return out;
}
