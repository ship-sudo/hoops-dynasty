// Tactics, fatigue and speed. Each knob must move the game the way its name says.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { GameInput, StatLine, Tactics } from '@hoops/core'
import { DEFAULT_TACTICS, emptyStatLine } from '@hoops/core'
import { simulateGameWith } from './index.ts'
import { ERA_1998, ERA_2016, makeGame } from './testkit.ts'

function leagueWith(
  homeTactics: Partial<Tactics>,
  awayTactics: Partial<Tactics>,
  games = 400,
  era = ERA_2016,
): { home: StatLine; away: StatLine; poss: number } {
  const home = emptyStatLine()
  const away = emptyStatLine()
  let poss = 0
  for (let i = 0; i < games; i++) {
    const input = makeGame(0, 0, era)
    input.home.tactics = { ...DEFAULT_TACTICS, ...homeTactics }
    input.away.tactics = { ...DEFAULT_TACTICS, ...awayTactics }
    const r = simulateGameWith(input, i + 1, { pbp: false })
    for (const k of Object.keys(home) as (keyof StatLine)[]) {
      home[k] += r.home.totals[k]
      away[k] += r.away.totals[k]
    }
    poss += r.home.possessions
  }
  return { home, away, poss }
}

describe('tactics', () => {
  it('pace changes the possession count for both teams', () => {
    const base = leagueWith({}, {}, 200).poss
    const fast = leagueWith({ pace: 1 }, { pace: 1 }, 200).poss
    const slow = leagueWith({ pace: -1 }, { pace: -1 }, 200).poss
    assert.ok(fast > base * 1.03, `fast ${fast} vs base ${base}`)
    assert.ok(slow < base * 0.97, `slow ${slow} vs base ${base}`)
  })

  it('threes raises the three-point rate of the team that calls it, not its opponent', () => {
    const r = leagueWith({ threes: 1 }, { threes: -1 }, 300)
    const homeRate = r.home.fg3a / r.home.fga
    const awayRate = r.away.fg3a / r.away.fga
    assert.ok(homeRate > awayRate + 0.06, `home 3PAr ${homeRate} vs away ${awayRate}`)
  })

  it('crashGlass trades offensive rebounds', () => {
    const r = leagueWith({ crashGlass: 1 }, { crashGlass: -1 }, 300)
    const homeOrb = r.home.oreb / (r.home.oreb + r.away.dreb)
    const awayOrb = r.away.oreb / (r.away.oreb + r.home.dreb)
    assert.ok(homeOrb > awayOrb + 0.02, `home ORB% ${homeOrb} vs away ${awayOrb}`)
  })

  it('pressure forces more turnovers and commits more fouls', () => {
    const base = leagueWith({}, {}, 300)
    const press = leagueWith({ pressure: 1 }, {}, 300)
    // The pressing team is home, so the *away* offence turns it over more.
    assert.ok(press.away.tov > base.away.tov * 1.02, 'pressure forces turnovers')
    assert.ok(press.home.pf > base.home.pf * 1.01, 'pressure costs fouls')
  })

  it('a zone defence is only honoured when the era allows it', () => {
    const legal = leagueWith({}, { zone: true }, 300, ERA_2016)
    const illegal = leagueWith({}, { zone: true }, 300, ERA_1998)
    const flat2016 = leagueWith({}, {}, 300, ERA_2016)
    const flat1998 = leagueWith({}, {}, 300, ERA_1998)
    assert.ok(
      legal.home.fg3a / legal.home.fga > flat2016.home.fg3a / flat2016.home.fga + 0.005,
      'a legal zone pushes the offence outside',
    )
    assert.ok(
      Math.abs(illegal.home.fg3a / illegal.home.fga - flat1998.home.fg3a / flat1998.home.fga) <
        0.005,
      'an illegal zone changes nothing',
    )
  })
})

describe('fatigue', () => {
  it('a tired team scores less', () => {
    function pointsAt(condition: number): number {
      let pts = 0
      const games = 400
      for (let i = 0; i < games; i++) {
        const input: GameInput = makeGame()
        for (const p of input.home.players) p.condition = condition
        input.neutralSite = true
        pts += simulateGameWith(input, i + 1, { pbp: false }).home.pts
      }
      return pts / games
    }
    const fresh = pointsAt(1)
    const worn = pointsAt(0.7)
    assert.ok(worn < fresh - 0.8, `worn ${worn.toFixed(2)} vs fresh ${fresh.toFixed(2)}`)
  })

  it('a back-to-back team wins less', () => {
    let wins = 0
    const games = 800
    for (let i = 0; i < games; i++) {
      const input = makeGame()
      input.neutralSite = true
      for (const p of input.away.players) p.condition = 0.7
      if (simulateGameWith(input, i + 1, { pbp: false }).winner === 'home') wins++
    }
    assert.ok(wins / games > 0.53, `rested side won only ${(wins / games).toFixed(3)}`)
  })
})

describe('speed', () => {
  it('sims a full 1230-game season in a couple of seconds, with the log on', () => {
    const t0 = Date.now()
    for (let i = 0; i < 1230; i++) simulateGameWith(makeGame(0, i % 7), i + 1, { pbp: true })
    const withLog = Date.now() - t0
    const t1 = Date.now()
    for (let i = 0; i < 1230; i++) simulateGameWith(makeGame(0, i % 7), i + 1, { pbp: false })
    const without = Date.now() - t1
    assert.ok(withLog < 4000, `${withLog} ms for a season with play-by-play`)
    assert.ok(without <= withLog, 'turning the log off is not slower')
  })
})
