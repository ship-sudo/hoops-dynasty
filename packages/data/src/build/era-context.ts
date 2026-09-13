// EraContext per season from stats.nba.com team data. Pure arithmetic over team season lines.
//
// pace and ortg: game-weighted league mean of team advanced (pace, off_rating).
// Rates: league sums. 3PAr = 3PA/FGA, FTr = FTA/FGA, TOV% = TOV per 100 possessions,
// ORB% = ORB/(ORB+DRB) league-wide (every ORB chance is some team's DRB chance), assisted share = AST/FGM,
// stl/blk/pf per 100 possessions. homeWinPct = home wins / regular-season games.
//
// zoneShare and zonePct come from the b-ref Player Shooting file, FGA-weighted (seasons.shooting_json).
// When a season has none, the 2P mix is split by a fixed placeholder (ZONE_SPLIT) and the zone
// percentages are scaled so they reproduce the real 2P%.
// Rule flags come from the era table (seasons.rules_json); the year decides only when a season has none.

import type { EraContext } from '@hoops/core'

export interface TeamSeasonLine {
  gp: number
  poss: number // total possessions
  pace: number
  ortg: number
  fgm: number
  fga: number
  fg3m: number
  fg3a: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  ast: number
  tov: number
  stl: number
  blk: number
  pf: number
  pts: number
}

export interface HomeAway {
  homeWins: number
  games: number
}

/** Placeholder share of 2PA by zone and relative FG% by zone, until Lane B's shooting file lands. */
export const ZONE_SPLIT = {
  share: { rim: 0.4, close: 0.2, mid: 0.4 },
  relPct: { rim: 1.3, close: 0.85, mid: 0.78 },
}

export const ZONE_PLACEHOLDER_NOTE =
  'zoneShare/zonePct: 2PA split rim 40% / close 20% / mid 40% with relative FG% 1.30 / 0.85 / 0.78 scaled to the real 2P%. Used only when a season has no bref shooting baseline.'

/** League zone baselines from bref Player Shooting (seasons.shooting_json). */
export interface ZoneBaseline {
  share: { rim: number; close: number; mid: number; three: number }
  pct: { rim: number; close: number; mid: number; three: number }
}

function sum(lines: readonly TeamSeasonLine[], k: keyof TeamSeasonLine): number {
  let s = 0
  for (const l of lines) s += l[k]
  return s
}

function weighted(lines: readonly TeamSeasonLine[], k: 'pace' | 'ortg'): number {
  let s = 0
  let w = 0
  for (const l of lines) {
    s += l[k] * l.gp
    w += l.gp
  }
  return w > 0 ? s / w : Number.NaN
}

export function eraContextFrom(
  yearEnd: number,
  teams: readonly TeamSeasonLine[],
  homeAway: HomeAway,
  zones: ZoneBaseline | null = null,
  flags: { handCheckBanned: boolean; zoneLegal: boolean } | null = null,
): EraContext {
  const fga = sum(teams, 'fga')
  const fgm = sum(teams, 'fgm')
  const fg3a = sum(teams, 'fg3a')
  const fg3m = sum(teams, 'fg3m')
  const fta = sum(teams, 'fta')
  const ftm = sum(teams, 'ftm')
  const oreb = sum(teams, 'oreb')
  const dreb = sum(teams, 'dreb')
  const poss = sum(teams, 'poss')
  const per100 = (k: keyof TeamSeasonLine) => (100 * sum(teams, k)) / poss
  const fg2Pct = (fgm - fg3m) / (fga - fg3a)
  const three = fg3a / fga
  const two = 1 - three
  const s = ZONE_SPLIT.share
  const r = ZONE_SPLIT.relPct
  // Scale relative zone percentages so the 2PA-weighted mean equals the real 2P%.
  const k = fg2Pct / (s.rim * r.rim + s.close * r.close + s.mid * r.mid)
  return {
    yearEnd,
    pace: weighted(teams, 'pace'),
    ortg: weighted(teams, 'ortg'),
    threePAr: three,
    ftr: fta / fga,
    tovPct: per100('tov'),
    orbPct: oreb / (oreb + dreb),
    fg3Pct: fg3m / fg3a,
    fg2Pct,
    ftPct: ftm / fta,
    astPct: sum(teams, 'ast') / fgm,
    stlPer100: per100('stl'),
    blkPer100: per100('blk'),
    pfPer100: per100('pf'),
    zoneShare: zones
      ? { ...zones.share }
      : { rim: two * s.rim, close: two * s.close, mid: two * s.mid, three },
    zonePct: zones
      ? { ...zones.pct }
      : { rim: k * r.rim, close: k * r.close, mid: k * r.mid, three: fg3m / fg3a },
    homeWinPct: homeAway.games > 0 ? homeAway.homeWins / homeAway.games : 0.6,
    handCheckBanned: flags?.handCheckBanned ?? yearEnd >= 2005,
    zoneLegal: flags?.zoneLegal ?? yearEnd >= 2002,
  }
}
