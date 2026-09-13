// Seeded xoshiro128**. Every random draw in the sim goes through one of these.
// Never call Math.random anywhere in packages/.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). */
  int(n: number): number
  /** True with probability p. */
  chance(p: number): boolean
  /** Pick one element. */
  pick<T>(xs: readonly T[]): T
  /** Pick an index weighted by weights[i] (non-negative). */
  weighted(weights: readonly number[]): number
  /** Standard normal via Box–Muller. */
  normal(mean?: number, sd?: number): number
  /** Independent child stream. Deterministic given this stream's state. */
  fork(): Rng
  /** Current seed state, for saves. */
  state(): [number, number, number, number]
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x9e3779b9) >>> 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return (t ^ (t >>> 15)) >>> 0
  }
}

export function makeRng(seed: number | [number, number, number, number]): Rng {
  let s0: number, s1: number, s2: number, s3: number
  if (typeof seed === 'number') {
    const sm = splitmix32(seed)
    s0 = sm()
    s1 = sm()
    s2 = sm()
    s3 = sm()
  } else {
    ;[s0, s1, s2, s3] = seed
  }
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0
  const nextU32 = (): number => {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0
    const t = (s1 << 9) >>> 0
    s2 ^= s0
    s3 ^= s1
    s1 ^= s2
    s0 ^= s3
    s2 ^= t
    s3 = rotl(s3, 11)
    return result
  }
  const rng: Rng = {
    next: () => nextU32() / 4294967296,
    int: (n) => Math.floor(rng.next() * n),
    chance: (p) => rng.next() < p,
    pick: (xs) => {
      if (xs.length === 0) throw new Error('pick from empty array')
      return xs[rng.int(xs.length)] as (typeof xs)[number]
    },
    weighted: (ws) => {
      let total = 0
      for (const w of ws) total += w
      if (total <= 0) throw new Error('weighted: all weights zero')
      let r = rng.next() * total
      for (let i = 0; i < ws.length; i++) {
        r -= ws[i] as number
        if (r < 0) return i
      }
      return ws.length - 1
    },
    normal: (mean = 0, sd = 1) => {
      let u = 0
      while (u === 0) u = rng.next()
      const v = rng.next()
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    },
    fork: () => makeRng([nextU32(), nextU32(), nextU32(), nextU32()]),
    state: () => [s0, s1, s2, s3],
  }
  return rng
}
