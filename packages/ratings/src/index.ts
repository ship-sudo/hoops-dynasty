// Real stats → 0–100 ratings on a fixed anchor, plus tendencies.
//
// Pipeline, per player-season:
//   1. rawProxies()          absolute skill proxies from the box score (proxies.ts)
//   2. ÷ season league mean  makes them era-fair: "how far above his own league"
//   3. z against anchors.json  the frozen pooled 1998–2026 distribution
//   4. zToRating()           50 + 15 z, clamped
//
// Step 3 is what keeps a rating meaning the same thing in 1998 and 2026 (DECISIONS.md 2026-09-11).
// Regenerate the anchors with `npm run ratings:anchors` after the data pipeline changes.

import {
  clamp,
  type PlayerSeasonStats,
  type Position,
  RATING_KEYS,
  type Ratings,
  type Tendencies,
  zToRating,
} from '@hoops/core'
import anchorsJson from './anchors.json' with { type: 'json' }
import {
  type LeaguePriors,
  leaguePriorsFrom,
  minuteWeight,
  PROXY_KEYS,
  type ProxyInput,
  type ProxyKey,
  rawProxies,
} from './proxies.ts'

export * from './proxies.ts'

export interface RateInput {
  playerId: string
  pos: Position
  age: number
  heightIn: number
  weightLb: number
  stats: PlayerSeasonStats | null
  /** Games this player's team played. Defaults to the season's longest schedule. */
  teamGames?: number
}

export interface RateOutput {
  ratings: Ratings
  tendencies: Tendencies
}

export interface Anchor {
  mean: number
  sd: number
}
export type Anchors = Record<ProxyKey, Anchor>

export const ANCHORS = anchorsJson as Anchors

/** How strongly a thin season is pulled back to league average, by minutes. */
const MIN_WEIGHT_FLOOR = 0.25

export function rateSeason(
  inputs: RateInput[],
  anchors: Anchors = ANCHORS,
): Map<string, RateOutput> {
  const seasonGames = Math.max(50, ...inputs.map((i) => i.stats?.gp ?? 0))
  const proxyInputs: ProxyInput[] = inputs.map((i) => ({
    playerId: i.playerId,
    pos: i.pos,
    age: i.age,
    heightIn: i.heightIn,
    weightLb: i.weightLb,
    stats: i.stats,
    teamGames: i.teamGames ?? seasonGames,
  }))
  const priors = leaguePriorsFrom(proxyInputs)
  const raws = proxyInputs.map((p) => rawProxies(p, priors))
  const leagueMean = meanByProxy(raws, proxyInputs)

  const out = new Map<string, RateOutput>()
  for (let i = 0; i < proxyInputs.length; i++) {
    const p = proxyInputs[i] as ProxyInput
    const raw = raws[i] as Record<ProxyKey, number | null>
    out.set(p.playerId, {
      ratings: toRatings(raw, leagueMean, anchors, minuteWeight(p.stats?.min ?? 0)),
      tendencies: tendenciesFromStats(p.stats),
    })
  }
  return out
}

/** Minutes-weighted league mean of each proxy for one season. Used to make proxies era-relative. */
export function meanByProxy(
  raws: readonly Record<ProxyKey, number | null>[],
  inputs: readonly ProxyInput[],
): Record<ProxyKey, number> {
  const out = {} as Record<ProxyKey, number>
  for (const k of PROXY_KEYS) {
    let num = 0
    let den = 0
    for (let i = 0; i < raws.length; i++) {
      const v = (raws[i] as Record<ProxyKey, number | null>)[k]
      const w = Math.max(0.05, minuteWeight(inputs[i]?.stats?.min ?? 0))
      if (v == null || !Number.isFinite(v)) continue
      num += v * w
      den += w
    }
    out[k] = den > 0 && num !== 0 ? num / den : 1
  }
  return out
}

/** One player's relative proxies (raw ÷ league mean). Exported for the anchors script. */
export function relativeProxies(
  raw: Record<ProxyKey, number | null>,
  leagueMean: Record<ProxyKey, number>,
): Record<ProxyKey, number | null> {
  const out = {} as Record<ProxyKey, number | null>
  for (const k of PROXY_KEYS) {
    const v = raw[k]
    const m = leagueMean[k]
    out[k] = v == null || !Number.isFinite(v) || m === 0 ? null : v / m
  }
  return out
}

/**
 * Era-relative proxies for every player in one season. Each value is raw ÷ that season's
 * minutes-weighted league mean, so a 36% shooter in 1999 and a 40% shooter in 2024 can be blended.
 */
export function relativeSeason(inputs: RateInput[]): Map<string, Record<ProxyKey, number | null>> {
  const seasonGames = Math.max(50, ...inputs.map((i) => i.stats?.gp ?? 0))
  const proxyInputs: ProxyInput[] = inputs.map((i) => ({
    playerId: i.playerId,
    pos: i.pos,
    age: i.age,
    heightIn: i.heightIn,
    weightLb: i.weightLb,
    stats: i.stats,
    teamGames: i.teamGames ?? seasonGames,
  }))
  const priors = leaguePriorsFrom(proxyInputs)
  const raws = proxyInputs.map((p) => rawProxies(p, priors))
  const leagueMean = meanByProxy(raws, proxyInputs)
  const out = new Map<string, Record<ProxyKey, number | null>>()
  for (let i = 0; i < proxyInputs.length; i++) {
    const p = proxyInputs[i] as ProxyInput
    out.set(p.playerId, relativeProxies(raws[i] as Record<ProxyKey, number | null>, leagueMean))
  }
  return out
}

export interface RelativeLayer {
  relative: Record<ProxyKey, number | null>
  minutes: number
  recency: number
}

/**
 * Minutes- and recency-weighted blend of era-relative proxies. A 16-game injury year does not
 * overwrite two healthy seasons of being a good shooter.
 */
export function blendRelative(layers: readonly RelativeLayer[]): Record<ProxyKey, number | null> {
  const out = {} as Record<ProxyKey, number | null>
  for (const k of PROXY_KEYS) {
    let num = 0
    let den = 0
    for (const layer of layers) {
      const v = layer.relative[k]
      const w = minuteWeight(layer.minutes) * Math.max(0, layer.recency)
      if (v == null || !Number.isFinite(v) || w <= 0) continue
      num += v * w
      den += w
    }
    out[k] = den > 0 ? num / den : null
  }
  return out
}

/** How much evidence a stack of seasons is. Saturates at 1,500 blended minutes. */
export function blendEvidence(layers: readonly RelativeLayer[]): number {
  return clamp(
    layers.reduce((s, l) => s + minuteWeight(l.minutes), 0),
    0,
    1,
  )
}

export function ratingsFromRelative(
  rel: Record<ProxyKey, number | null>,
  weight: number,
  anchors: Anchors = ANCHORS,
): Ratings {
  const ratings = {} as Ratings
  for (const k of RATING_KEYS) {
    const key = k as ProxyKey
    const a = anchors[key]
    const v = rel[key]
    if (v == null || !a || a.sd <= 0) {
      ratings[k] = 45
      continue
    }
    const z = (v - a.mean) / a.sd
    const shrunk = z * Math.max(MIN_WEIGHT_FLOOR, weight)
    ratings[k] = clamp(zToRating(shrunk), 5, 99)
  }
  return ratings
}

function toRatings(
  raw: Record<ProxyKey, number | null>,
  leagueMean: Record<ProxyKey, number>,
  anchors: Anchors,
  weight: number,
): Ratings {
  return ratingsFromRelative(relativeProxies(raw, leagueMean), weight, anchors)
}

/** Tendencies straight from the real line. Falls back to a league-typical profile. */
export function tendenciesFromStats(s: PlayerSeasonStats | null): Tendencies {
  if (!s || s.min < 50)
    return {
      usage: 0.18,
      shotRim: 0.3,
      shotClose: 0.15,
      shotMid: 0.3,
      shotThree: 0.25,
      assist: 0.15,
      postUp: 0.1,
    }
  const sh = s.shooting
  const three = sh?.share3p ?? (s.per100.fga > 0 ? s.per100.fg3a / s.per100.fga : 0.25)
  const rim = sh?.share0_3 ?? (1 - three) * 0.4
  const close = sh?.share3_10 ?? (1 - three) * 0.2
  const mid = clamp(1 - three - rim - close, 0, 1)
  const used = s.per100.fga + 0.44 * s.per100.fta + s.per100.tov
  return {
    usage: clamp((s.adv.usg ?? 20) / 100, 0.05, 0.45),
    shotRim: rim,
    shotClose: close,
    shotMid: mid,
    shotThree: three,
    assist: used > 0 ? clamp(s.per100.ast / used, 0, 1) : 0.15,
    postUp: 0.1,
  }
}

export function flatRatings(v: number): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, v])) as unknown as Ratings
}

export type { LeaguePriors, ProxyInput, ProxyKey }
