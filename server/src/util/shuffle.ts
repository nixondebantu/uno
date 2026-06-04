// Deterministic RNG + Fisher–Yates shuffle.
// Pure utility — engine injects RNG so tests stay deterministic and
// production code can swap in `Math.random` (or a crypto seed) at the seam.

export type RNG = () => number;

/**
 * Mulberry32 — small, fast, decent-quality 32-bit PRNG.
 * Sufficient for shuffling a 108-card deck. NOT cryptographically secure.
 * See: https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 */
export function makeSeededRng(seed: number): RNG {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates shuffle. Returns a NEW array; does not mutate input.
 * RNG must produce uniform values in [0, 1).
 */
export function shuffle<T>(arr: readonly T[], rng: RNG): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
