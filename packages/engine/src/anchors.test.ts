// The engine's contract with the era: a league of league-average players must reproduce
// the EraContext it was handed. Everything else in the engine is a perturbation of this.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_TACTICS, type EraContext, emptyStatLine, type StatLine } from '@hoops/core'
import { computeAnchors } from './anchors.ts'
import { simulateGameWith } from './index.ts'
import { TEAM_TOV_SHARE } from './possession.ts'
import { ERA_1998, ERA_2016, makeGame } from './testkit.ts'

interface League {
  pace: number
  ortg: number
  threePAr: number
  ftr: number
  tovPct: number
  orbPct: number
  fg3Pct: number
  fg2Pct: number
  ftPct: number
  astPct: number
  stlPer100: number
  blkPer100: number
  pfPer100: number
  homeWinPct: number
}

function playLeague(era: EraContext, games: number): League {
  const tot: StatLine = emptyStatLine()
  let poss = 0
  let dreb = 0
  let homeWins = 0
  for (let i = 0; i < games; i++) {
    const r = simulateGameWith(makeGame(0, 0, era), i + 1, { pbp: false })
    if (r.winner === 'home') homeWins++
    poss += r.home.possessions + r.away.possessions
    for (const k of Object.keys(tot) as (keyof StatLine)[]) {
      tot[k] += r.home.totals[k] + r.away.totals[k]
    }
    dreb += r.home.totals.dreb + r.away.totals.dreb
  }
  return {
    pace: poss / (2 * games),
    ortg: (tot.pts / poss) * 100,
    threePAr: tot.fg3a / tot.fga,
    ftr: tot.fta / tot.fga,
    tovPct: (tot.tov / poss) * 100,
    orbPct: tot.oreb / (tot.oreb + dreb),
    fg3Pct: tot.fg3m / tot.fg3a,
    fg2Pct: (tot.fgm - tot.fg3m) / (tot.fga - tot.fg3a),
    ftPct: tot.ftm / tot.fta,
    astPct: tot.ast / tot.fgm,
    stlPer100: (tot.stl / poss) * 100,
    blkPer100: (tot.blk / poss) * 100,
    pfPer100: (tot.pf / poss) * 100,
    homeWinPct: homeWins / games,
  }
}

const BANDS: [keyof League, number][] = [
  ['pace', 1.5],
  ['ortg', 2],
  ['threePAr', 0.01],
  ['ftr', 0.015],
  ['tovPct', 0.6],
  ['orbPct', 0.012],
  ['fg3Pct', 0.01],
  ['fg2Pct', 0.012],
  ['ftPct', 0.01],
  ['astPct', 0.015],
  ['stlPer100', 0.5],
  ['blkPer100', 0.5],
  ['pfPer100', 1],
  ['homeWinPct', 0.02],
]

describe('era fidelity', () => {
  for (const era of [ERA_2016, ERA_1998]) {
    it(`a league of league-average players reproduces ${era.yearEnd}`, () => {
      const got = playLeague(era, 1200)
      // era.tovPct counts every turnover the team committed; the box score only carries the
      // ones a player was charged with. The gap is the team turnovers the engine models.
      const charged =
        1 - (1 - computeAnchors(era, DEFAULT_TACTICS, DEFAULT_TACTICS).stealShare) * TEAM_TOV_SHARE
      for (const [key, tol] of BANDS) {
        const want =
          key === 'orbPct'
            ? era.orbPct
            : key === 'tovPct'
              ? era.tovPct * charged
              : (era as unknown as League)[key]
        assert.ok(
          Math.abs(got[key] - want) <= tol,
          `${era.yearEnd} ${key}: era ${want.toFixed(4)} sim ${got[key].toFixed(4)} (tol ${tol})`,
        )
      }
    })
  }

  it('a neutral site removes the home edge', () => {
    let homeWins = 0
    const games = 2000
    for (let i = 0; i < games; i++) {
      const input = makeGame()
      input.neutralSite = true
      if (simulateGameWith(input, i + 1, { pbp: false }).winner === 'home') homeWins++
    }
    assert.ok(Math.abs(homeWins / games - 0.5) < 0.025, `neutral home win ${homeWins / games}`)
  })
})

describe('computeAnchors', () => {
  it('lands every probability in a sane range', () => {
    for (const era of [ERA_2016, ERA_1998]) {
      const a = computeAnchors(era, DEFAULT_TACTICS, DEFAULT_TACTICS)
      assert.ok(a.possTarget > 80 && a.possTarget < 115)
      assert.ok(a.baseSeconds > 8 && a.baseSeconds < 22)
      assert.ok(a.otherFoulP >= 0)
      for (let z = 0; z < 4; z++) {
        assert.ok(a.makeP[z]! > 0.2 && a.makeP[z]! < 0.8, `makeP[${z}] = ${a.makeP[z]}`)
        assert.ok(a.foulP[z]! > 0 && a.foulP[z]! < 0.5)
        assert.ok(a.blockP[z]! >= 0 && a.blockP[z]! < 0.4)
      }
      // The shot mix is more three-heavy in 2016; the anchors must not flatten it.
      assert.ok(a.shotEvents > 0.8 && a.shotEvents < 1.2)
    }
  })

  it('the pace tactic moves possessions in the right direction', () => {
    const fast = computeAnchors(ERA_2016, { ...DEFAULT_TACTICS, pace: 1 }, DEFAULT_TACTICS)
    const slow = computeAnchors(ERA_2016, { ...DEFAULT_TACTICS, pace: -1 }, DEFAULT_TACTICS)
    const even = computeAnchors(ERA_2016, DEFAULT_TACTICS, DEFAULT_TACTICS)
    assert.ok(fast.possTarget > even.possTarget)
    assert.ok(slow.possTarget < even.possTarget)
    assert.ok(fast.baseSeconds < even.baseSeconds)
  })
})
