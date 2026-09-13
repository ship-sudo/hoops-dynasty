// Raw skill proxies: one number per skill, per player-season, before it becomes a 0–100 rating.
//
// Two ideas hold this together.
//
// 1. Era fairness. A 34% three-point shooter in 1999 was average; in 2024 he is poor. So every rate
//    proxy is divided by that season's minutes-weighted league mean of the same quantity. The proxy
//    is therefore "how far above or below his own league he was", which is comparable across eras.
// 2. Fixed anchor. The pooled 1998–2026 distribution of those relative values is frozen in
//    anchors.json (mean and sd per proxy). A rating is 50 + 15 z against that frozen distribution,
//    so a rating means the same thing in every season — required by DECISIONS.md 2026-09-11.
//
// Small samples are shrunk toward the league mean before any of that, so a 40-minute season of
// 3-for-4 from deep does not read as an all-time shooter.

import { clamp, type PlayerSeasonStats, type Position } from '@hoops/core'

export const PROXY_KEYS = [
  'rim',
  'close',
  'mid',
  'three',
  'ft',
  'passing',
  'handling',
  'drawFoul',
  'oreb',
  'dreb',
  'perimD',
  'interiorD',
  'steal',
  'block',
  'speed',
  'strength',
  'stamina',
  'iq',
  'durability',
] as const
export type ProxyKey = (typeof PROXY_KEYS)[number]

export interface ProxyInput {
  playerId: string
  pos: Position
  age: number
  heightIn: number
  weightLb: number
  stats: PlayerSeasonStats | null
  /** Games the player's team(s) played that season, for durability. */
  teamGames: number
}

/** Shrink a rate toward a prior. `k` is the number of prior observations the prior is worth. */
export function shrink(value: number, attempts: number, prior: number, k: number): number {
  if (!Number.isFinite(value) || attempts <= 0) return prior
  return (value * attempts + prior * k) / (attempts + k)
}

/** Minutes weight used everywhere: full credit at 1,500 minutes, none at 0. */
export function minuteWeight(min: number): number {
  return clamp(min / 1500, 0, 1)
}

const POS_HEIGHT: Record<Position, number> = { PG: 74, SG: 77, SF: 79, PF: 81, C: 83 }

/**
 * Absolute (not yet league-relative) proxy values. Null means "no signal, use the league mean".
 * League means and the relative step happen in index.ts, which sees the whole season at once.
 */
export function rawProxies(
  p: ProxyInput,
  leaguePriors: LeaguePriors,
): Record<ProxyKey, number | null> {
  const s = p.stats
  const out = {} as Record<ProxyKey, number | null>
  for (const k of PROXY_KEYS) out[k] = null

  // Body and age proxies work without any stats at all.
  const heightEdge = p.heightIn - POS_HEIGHT[p.pos]
  const bmi = (p.weightLb / Math.max(1, p.heightIn * p.heightIn)) * 703
  out.strength = clamp(bmi / 25, 0.5, 1.6) * (1 + heightEdge * 0.01)
  out.speed = clamp(
    1.25 - Math.max(0, p.heightIn - 74) * 0.018 - Math.max(0, p.age - 30) * 0.02,
    0.5,
    1.5,
  )

  if (!s || s.min < 1) return out

  const min = s.min
  const w = minuteWeight(min)
  const fga = s.totals.fga
  const sh = s.shooting

  // Shooting by zone. Attempts per zone come from the shot-share splits when the season has them.
  const zone = (
    share: number | null,
    pct: number | null,
    prior: number,
    fallback: number | null,
  ) => {
    if (pct == null || share == null) return fallback
    const att = fga * share
    if (att < 5) return null
    return shrink(pct, att, prior, 40)
  }
  const fg2 = s.pct.fg != null && s.pct.fg3 != null ? s.pct.fg : null
  out.rim = zone(sh?.share0_3 ?? null, sh?.pct0_3 ?? null, leaguePriors.pct0_3, fg2)
  out.close = zone(sh?.share3_10 ?? null, sh?.pct3_10 ?? null, leaguePriors.pct3_10, fg2)
  // Mid is the two mid ranges pooled: 10–16 ft and 16 ft to the arc.
  const midShare = (sh?.share10_16 ?? 0) + (sh?.share16_3p ?? 0)
  const midPct =
    midShare > 0 && sh
      ? ((sh.pct10_16 ?? 0) * (sh.share10_16 ?? 0) + (sh.pct16_3p ?? 0) * (sh.share16_3p ?? 0)) /
        midShare
      : null
  out.mid = zone(midShare || null, midPct, leaguePriors.pct10_3p, fg2)
  out.three =
    s.totals.fg3a >= 5 ? shrink(s.pct.fg3 ?? 0, s.totals.fg3a, leaguePriors.pct3p, 60) : null
  out.ft = s.totals.fta >= 10 ? shrink(s.pct.ft ?? 0, s.totals.fta, leaguePriors.pctFt, 30) : null

  // Playmaking and ball security.
  out.passing = s.adv.astPct
  const used = s.per100.fga + 0.44 * s.per100.fta + s.per100.tov
  // Lower turnover rate is better, so invert: possessions used per turnover.
  out.handling =
    s.adv.tovPct != null && s.adv.tovPct > 0
      ? 100 / s.adv.tovPct
      : used > 0 && s.per100.tov > 0
        ? used / s.per100.tov
        : null
  out.drawFoul = fga > 20 ? s.totals.fta / Math.max(1, fga) : null

  // Rebounding, defence, activity.
  out.oreb = s.adv.orbPct
  out.dreb = s.adv.drbPct
  out.steal = s.adv.stlPct
  out.block = s.adv.blkPct
  // Defence: dbpm is the only broad defensive signal in the box score. Anchor it at 1.0 = league
  // average (dbpm is centred on 0) and lean perimeter defence on steals, rim defence on blocks.
  const dbpm = s.adv.dbpm
  if (dbpm != null) {
    const stl = s.adv.stlPct ?? leaguePriors.stlPct
    const blk = s.adv.blkPct ?? leaguePriors.blkPct
    out.perimD = 1 + dbpm * 0.18 + (stl - leaguePriors.stlPct) * 0.12
    out.interiorD = 1 + dbpm * 0.18 + (blk - leaguePriors.blkPct) * 0.1
  }

  // Stamina: minutes per game when he played, plus an age tax.
  out.stamina = s.gp > 5 ? min / s.gp / 36 - Math.max(0, p.age - 31) * 0.03 : null

  // Decision quality: scoring efficiency, assist-to-turnover, and staying out of foul trouble.
  if (w > 0.15) {
    const ts = s.pct.ts ?? leaguePriors.ts
    const astTov = s.per100.tov > 0 ? s.per100.ast / s.per100.tov : s.per100.ast > 0 ? 3 : 1
    const fouls = s.per100.pf > 0 ? leaguePriors.pfPer100 / s.per100.pf : 1
    out.iq =
      (ts / leaguePriors.ts) * 0.5 +
      clamp(astTov / 2, 0.2, 1.6) * 0.3 +
      clamp(fouls, 0.5, 1.6) * 0.2
  }

  // Durability: share of his team's games played, shrunk — one healthy year is weak evidence.
  out.durability = shrink(clamp(s.gp / Math.max(1, p.teamGames), 0, 1), s.gp, 0.75, 20)

  // Speed and strength get a nudge from what the stats say about how he plays.
  if (s.adv.stlPct != null && out.speed != null)
    out.speed *= clamp(0.9 + (s.adv.stlPct - leaguePriors.stlPct) * 0.06, 0.75, 1.25)
  if (s.adv.orbPct != null && out.strength != null)
    out.strength *= clamp(0.92 + (s.adv.orbPct - leaguePriors.orbPct) * 0.02, 0.8, 1.25)

  return out
}

/** League-average shooting and activity for one season, used as shrink priors. */
export interface LeaguePriors {
  pct0_3: number
  pct3_10: number
  pct10_3p: number
  pct3p: number
  pctFt: number
  ts: number
  stlPct: number
  blkPct: number
  orbPct: number
  pfPer100: number
}

export const FALLBACK_PRIORS: LeaguePriors = {
  pct0_3: 0.6,
  pct3_10: 0.4,
  pct10_3p: 0.4,
  pct3p: 0.35,
  pctFt: 0.75,
  ts: 0.54,
  stlPct: 1.6,
  blkPct: 1.2,
  orbPct: 5,
  pfPer100: 4.5,
}

/** Minutes-weighted league priors from every player-season in one season. */
export function leaguePriorsFrom(inputs: readonly ProxyInput[]): LeaguePriors {
  const acc = { ...FALLBACK_PRIORS }
  const pick = (
    key: keyof LeaguePriors,
    get: (s: PlayerSeasonStats) => number | null,
    weight: (s: PlayerSeasonStats) => number,
  ) => {
    let num = 0
    let den = 0
    for (const p of inputs) {
      if (!p.stats) continue
      const v = get(p.stats)
      const wt = weight(p.stats)
      if (v == null || !Number.isFinite(v) || wt <= 0) continue
      num += v * wt
      den += wt
    }
    if (den > 0) acc[key] = num / den
  }
  const byFga = (s: PlayerSeasonStats) => s.totals.fga
  const byMin = (s: PlayerSeasonStats) => s.min
  pick(
    'pct0_3',
    (s) => s.shooting?.pct0_3 ?? null,
    (s) => s.totals.fga * (s.shooting?.share0_3 ?? 0),
  )
  pick(
    'pct3_10',
    (s) => s.shooting?.pct3_10 ?? null,
    (s) => s.totals.fga * (s.shooting?.share3_10 ?? 0),
  )
  pick(
    'pct10_3p',
    (s) => {
      const sh = s.shooting
      if (!sh) return null
      const share = (sh.share10_16 ?? 0) + (sh.share16_3p ?? 0)
      if (share <= 0) return null
      return (
        ((sh.pct10_16 ?? 0) * (sh.share10_16 ?? 0) + (sh.pct16_3p ?? 0) * (sh.share16_3p ?? 0)) /
        share
      )
    },
    (s) => s.totals.fga * ((s.shooting?.share10_16 ?? 0) + (s.shooting?.share16_3p ?? 0)),
  )
  pick(
    'pct3p',
    (s) => s.pct.fg3,
    (s) => s.totals.fg3a,
  )
  pick(
    'pctFt',
    (s) => s.pct.ft,
    (s) => s.totals.fta,
  )
  pick('ts', (s) => s.pct.ts, byFga)
  pick('stlPct', (s) => s.adv.stlPct, byMin)
  pick('blkPct', (s) => s.adv.blkPct, byMin)
  pick('orbPct', (s) => s.adv.orbPct, byMin)
  pick('pfPer100', (s) => s.per100.pf, byMin)
  return acc
}
