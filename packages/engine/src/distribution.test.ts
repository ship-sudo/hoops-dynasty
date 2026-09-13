// How the counting stats are shared out between the five men on the floor.
//
// The league totals are the anchors' business (anchors.test.ts). These tests are about
// shape: the best passer on the floor must collect a dominant share of his team's assists,
// the best rebounder must out-board a bench forward by the multiple the real box scores
// show, and neither knob may move the league total it redistributes.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_TACTICS,
  type GameInput,
  type PlayerGameInput,
  type Ratings,
  type TeamGameInput,
} from '@hoops/core'
import { simulateGameWith } from './index.ts'
import { TEAM_REB_SHARE, TEAM_TOV_SHARE } from './possession.ts'
import { ERA_2016, referenceRatings } from './testkit.ts'

interface Spec {
  minutes: number
  ratings?: Partial<Ratings>
  usage?: number
  assist?: number
}

function roster(teamId: string, specs: Spec[]): TeamGameInput {
  const players: PlayerGameInput[] = specs.map((s, i) => ({
    playerId: `${teamId}-${i}`,
    name: `${teamId} P${i}`,
    pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5]!,
    heightIn: 78,
    weightLb: 220,
    age: 27,
    ratings: { ...referenceRatings(), ...s.ratings },
    tendencies: {
      usage: s.usage ?? 0.2,
      shotRim: ERA_2016.zoneShare.rim,
      shotClose: ERA_2016.zoneShare.close,
      shotMid: ERA_2016.zoneShare.mid,
      shotThree: ERA_2016.zoneShare.three,
      assist: s.assist ?? 0.2,
      postUp: 0.1,
    },
    minutesTarget: s.minutes,
    starter: i < 5,
    condition: 1,
  }))
  return { teamId, name: teamId, players, tactics: { ...DEFAULT_TACTICS } }
}

/** Ten men, 240 minutes, every one of them league-average in every way. */
const FLAT: Spec[] = [36, 34, 32, 30, 28, 22, 18, 16, 12, 12].map((minutes) => ({ minutes }))

/** The same 240 minutes, but the point guard is a real playmaker and the rest defer. */
const PLAYMAKER: Spec[] = FLAT.map((s, i) =>
  i === 0
    ? { minutes: s.minutes, usage: 0.27, assist: 0.62, ratings: { passing: 88 } }
    : { minutes: s.minutes, usage: 0.2, assist: 0.13, ratings: { passing: 44 } },
)

/** The same 240 minutes, but one man owns the glass and the rest are guards. */
const GLASS: Spec[] = FLAT.map((s, i) =>
  i === 4
    ? { minutes: 34, ratings: { oreb: 99, dreb: 99 } }
    : i === 8
      ? { minutes: 14, ratings: { oreb: 40, dreb: 40 } }
      : { minutes: s.minutes, ratings: { oreb: 47, dreb: 47 } },
)

function play(home: Spec[], away: Spec[] = FLAT, games = 300) {
  const totals = new Map<string, { min: number; ast: number; reb: number; tov: number }>()
  let teamAst = 0
  let teamReb = 0
  let teamTov = 0
  let teamMisses = 0
  let teamStl = 0
  for (let seed = 1; seed <= games; seed++) {
    const input: GameInput = {
      era: ERA_2016,
      home: roster('HOM', home),
      away: roster('AWY', away),
      seasonType: 'regular',
    }
    const r = simulateGameWith(input, seed, { pbp: false })
    for (const p of r.home.players) {
      const t = totals.get(p.playerId) ?? { min: 0, ast: 0, reb: 0, tov: 0 }
      t.min += p.min
      t.ast += p.ast
      t.reb += p.oreb + p.dreb
      t.tov += p.tov
      totals.set(p.playerId, t)
    }
    teamAst += r.home.totals.ast
    teamReb += r.home.totals.oreb + r.home.totals.dreb
    teamTov += r.home.totals.tov
    teamStl += r.home.totals.stl
    // Every missed shot from either side is a live rebound chance for somebody.
    for (const s of [r.home, r.away]) teamMisses += s.totals.fga - s.totals.fgm
  }
  return { totals, teamAst, teamReb, teamTov, teamStl, teamMisses, games }
}

describe('assist distribution', () => {
  const flat = play(FLAT)
  const pg = play(PLAYMAKER)

  it("gives a team's best passer a dominant share of its assists", () => {
    const mine = pg.totals.get('HOM-0')!
    const share = mine.ast / pg.teamAst
    // Dončić took 37% of Dallas's assists in 2024, Haliburton 40% of Indiana's, on about
    // three quarters of the minutes. A flat draw among five men would give him nearer 15%.
    assert.ok(share > 0.32, `the playmaker took only ${(share * 100).toFixed(1)}% of the assists`)
    assert.ok(share < 0.6, `the playmaker took ${(share * 100).toFixed(1)}% — nobody is that good`)
    const next = [...pg.totals.entries()]
      .filter(([id]) => id !== 'HOM-0')
      .map(([, t]) => t.ast / Math.max(1, t.min))
      .sort((a, b) => b - a)[0]!
    const his = mine.ast / mine.min
    assert.ok(
      his / next > 3,
      `the playmaker is only ${(his / next).toFixed(2)}x his best team-mate`,
    )
  })

  it('redistributes assists without changing how many the team gets', () => {
    const a = flat.teamAst / flat.games
    const b = pg.teamAst / pg.games
    assert.ok(Math.abs(a - b) < 1.2, `team assists moved from ${a.toFixed(2)} to ${b.toFixed(2)}`)
  })

  it('leaves a team of equals sharing the assists evenly per minute', () => {
    const rates = [...flat.totals.values()]
      .filter((t) => t.min > 0)
      .map((t) => t.ast / t.min)
      .sort((a, b) => b - a)
    assert.ok(rates[0]! / rates.at(-1)! < 1.35, `equal players got ${rates.join(' ')}`)
  })
})

describe('rebound distribution', () => {
  const flat = play(FLAT)
  const glass = play(GLASS)

  it('lets a 99-rebounding big out-board a bench forward by a realistic multiple', () => {
    const big = glass.totals.get('HOM-4')!
    const bench = glass.totals.get('HOM-8')!
    const ratio = big.reb / big.min / (bench.reb / bench.min)
    // Real 2024: Sabonis 0.38 rebounds a minute, a wing forward around 0.11.
    assert.ok(ratio > 2.5, `the 99 big out-boards the bench forward only ${ratio.toFixed(2)}x`)
    assert.ok(ratio < 7, `the 99 big out-boards the bench forward ${ratio.toFixed(2)}x — too steep`)
    const perGame = big.reb / glass.games
    assert.ok(perGame > 11 && perGame < 18, `the big grabbed ${perGame.toFixed(1)} a game`)
  })

  it('shares the glass evenly between equals', () => {
    // The draw is steep in the rating, so it must be flat when the ratings are flat —
    // otherwise minutes alone would be deciding the rebounding title.
    const rates = [...flat.totals.values()]
      .filter((t) => t.min > 0)
      .map((t) => t.reb / t.min)
      .sort((a, b) => b - a)
    assert.ok(rates[0]! / rates.at(-1)! < 1.3, `equal players got ${rates.join(' ')}`)
  })

  it('does not invent or lose boards when one man dominates them', () => {
    // The big crashes harder than the men he replaced, so the team wins a few more of its
    // own misses — but the credited total still tracks the misses on the floor.
    const a = flat.teamReb / (flat.teamMisses / 2)
    const b = glass.teamReb / (glass.teamMisses / 2)
    assert.ok(Math.abs(a - b) < 0.1, `credited share moved from ${a.toFixed(3)} to ${b.toFixed(3)}`)
  })
})

describe('the box score is a player box score', () => {
  const flat = play(FLAT)

  it('leaves the team rebounds off the player lines', () => {
    // Every miss is somebody's rebound chance, but the scorer books roughly one in seven as
    // a team rebound. Real player lines sum to 86-88% of the misses; so must these.
    const credited = flat.teamReb / (flat.teamMisses / 2)
    const want = 1 - TEAM_REB_SHARE
    assert.ok(
      Math.abs(credited / want - 1) < 0.12,
      `players were credited with ${(credited * 100).toFixed(1)}% of the misses`,
    )
    assert.ok(credited < 0.95, 'a player cannot be credited with every miss')
  })

  it('charges nobody with the team turnovers', () => {
    // Shot-clock violations and the like end a possession without a name attached, so the
    // charged turnovers sit below era.tovPct — but never below what the steals imply.
    const perGame = flat.teamTov / flat.games
    const possPerGame = ERA_2016.pace
    const chargedPct = (perGame / possPerGame) * 100
    assert.ok(chargedPct < ERA_2016.tovPct, 'charged turnovers must be under the era rate')
    assert.ok(
      chargedPct > ERA_2016.tovPct * (1 - TEAM_TOV_SHARE - 0.02),
      `charged turnovers ${chargedPct.toFixed(2)} fell too far below ${ERA_2016.tovPct}`,
    )
    assert.ok(flat.teamStl / flat.games < perGame, 'a steal is always a charged turnover')
  })
})
