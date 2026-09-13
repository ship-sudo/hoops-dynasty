// Naive baseline engine: the floor every real engine must beat.
// Team strength = minutes-weighted mean rating. Score = era ORtg ± strength gap + noise.
// Box scores are real-tendency shaped but crude. Produces no play-by-play.

import {
  emptyStatLine,
  type GameInput,
  type GameResult,
  makeRng,
  type PlayerBox,
  RATING_KEYS,
  type Rng,
  type StatLine,
  type TeamBox,
  type TeamGameInput,
} from '@hoops/core'

function overall(p: TeamGameInput['players'][number]): number {
  let s = 0
  for (const k of RATING_KEYS) s += p.ratings[k]
  return s / RATING_KEYS.length
}

function strength(t: TeamGameInput): number {
  let w = 0,
    s = 0
  for (const p of t.players) {
    w += p.minutesTarget
    s += p.minutesTarget * overall(p)
  }
  return w > 0 ? s / w : 50
}

function teamBox(
  t: TeamGameInput,
  pts: number,
  poss: number,
  rng: Rng,
  era: GameInput['era'],
): TeamBox {
  const totalMin = t.players.reduce((a, p) => a + p.minutesTarget, 0) || 240
  const players: PlayerBox[] = t.players.map((p) => {
    const min = (p.minutesTarget / totalMin) * 240
    const share = p.tendencies.usage * (min / 48)
    const fga = Math.round(poss * share * 0.85 + rng.normal(0, 1))
    const fg3a = Math.round(fga * p.tendencies.shotThree)
    const fg3m = Math.round(fg3a * era.fg3Pct)
    const fg2m = Math.round((fga - fg3a) * era.fg2Pct)
    const fta = Math.round(fga * era.ftr)
    const ftm = Math.round(fta * era.ftPct)
    const line: StatLine = {
      ...emptyStatLine(),
      min: Math.round(min * 10) / 10,
      fga: Math.max(0, fga),
      fg3a: Math.max(0, fg3a),
      fg3m: Math.max(0, fg3m),
      fgm: Math.max(0, fg2m + fg3m),
      fta: Math.max(0, fta),
      ftm: Math.max(0, ftm),
      oreb: Math.round(((era.orbPct * 0.45 * poss * min) / 240) * (p.ratings.oreb / 50)),
      dreb: Math.round((((1 - era.orbPct) * 0.45 * poss * min) / 240) * (p.ratings.dreb / 50)),
      ast: Math.round(poss * p.tendencies.assist * share),
      tov: Math.round(((poss * era.tovPct) / 100) * (min / 240)),
      stl: Math.round(((poss * era.stlPer100) / 100) * (min / 240)),
      blk: Math.round(((poss * era.blkPer100) / 100) * (min / 240)),
      pf: Math.round(((poss * era.pfPer100) / 100) * (min / 240)),
    }
    line.pts = 2 * (line.fgm - line.fg3m) + 3 * line.fg3m + line.ftm
    return { ...line, playerId: p.playerId, name: p.name, starter: p.starter, plusMinus: 0 }
  })
  // Scale points to the team total so the scoreboard and box agree.
  const raw = players.reduce((a, p) => a + p.pts, 0) || 1
  for (const p of players) p.pts = Math.round((p.pts * pts) / raw)
  const totals = emptyStatLine()
  for (const p of players)
    for (const k of Object.keys(totals) as (keyof StatLine)[]) totals[k] += p[k]
  totals.pts = pts
  const q = [0, 0, 0, 0].map(() => Math.round(pts / 4))
  q[3] = pts - q[0]! - q[1]! - q[2]!
  return { teamId: t.teamId, pts, quarters: q, possessions: poss, players, totals }
}

export function simulateGame(input: GameInput, seed: number): GameResult {
  const rng = makeRng(seed)
  const { era, home, away } = input
  const gap = strength(home) - strength(away) // rating points
  const homeEdge = input.neutralSite ? 0 : (era.homeWinPct - 0.5) * 30 // ~3 pts at .60
  const poss = Math.round(era.pace + rng.normal(0, 4))
  const base = (era.ortg / 100) * poss
  let hp = Math.round(base + gap * 0.6 + homeEdge + rng.normal(0, 10))
  let ap = Math.round(base - gap * 0.6 - homeEdge + rng.normal(0, 10))
  let ot = 0
  while (hp === ap) {
    ot++
    hp += rng.int(14)
    ap += rng.int(14)
  }
  return {
    home: teamBox(home, hp, poss, rng, era),
    away: teamBox(away, ap, poss, rng, era),
    winner: hp > ap ? 'home' : 'away',
    overtimes: ot,
    pbp: [],
  }
}
