// Small numeric helpers used by ratings and the calibration harness.

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return Number.NaN
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) ** 2
  return Math.sqrt(s / (xs.length - 1))
}

/** Weighted mean and sd, e.g. minutes-weighted league averages. */
export function weightedMeanSd(
  xs: readonly number[],
  ws: readonly number[],
): { mean: number; sd: number } {
  let sw = 0,
    swx = 0
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i] as number
    swx += (ws[i] as number) * (xs[i] as number)
  }
  const m = swx / sw
  let v = 0
  for (let i = 0; i < xs.length; i++) v += (ws[i] as number) * ((xs[i] as number) - m) ** 2
  return { mean: m, sd: Math.sqrt(v / sw) }
}

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length
  if (n !== ys.length || n < 2) return Number.NaN
  const mx = mean(xs),
    my = mean(ys)
  let sxy = 0,
    sxx = 0,
    syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx,
      dy = (ys[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Standard normal CDF, good to ~1e-7. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp(-0.5 * z * z)
  const p =
    d *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return z >= 0 ? 1 - p : p
}

/** Map a z-score to a 0–100 rating: 50 at the mean, 15 per sd, clamped. */
export function zToRating(z: number): number {
  return Math.round(clamp(50 + 15 * z, 0, 100))
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = clamp(p, 0, 1) * (sorted.length - 1)
  const lo = Math.floor(i),
    hi = Math.ceil(i)
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (i - lo)
}
