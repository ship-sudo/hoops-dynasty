// Injuries and fatigue over a whole simulated season, and the trophies that season leaves behind.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { rollover } from './rollover.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, LeaguePlayer } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

function playedSeason(seed = 1, yearEnd = 2016): GameState {
  return simRestOfSeason(newGame(fixtureBundle({ yearEnd }), 'T00', seed), hooks).state
}

test('players miss games: a league is not 95% iron men', () => {
  const state = playedSeason(4)
  const games = state.season.rules.games
  const rotation = Object.values(state.stats).filter((s) => s.gp > 0 && s.min / s.gp >= 12)
  const ironMen = rotation.filter((s) => s.gp >= games).length
  assert.ok(rotation.length > 200, `expected a league of rotation players, got ${rotation.length}`)
  assert.ok(
    ironMen / rotation.length < 0.2,
    `nearly everyone used to finish on ${games}; got ${ironMen}/${rotation.length}`,
  )
  assert.ok(ironMen > 0, 'somebody should still play every night')
  const missed = rotation.reduce((a, s) => a + (games - s.gp), 0) / rotation.length
  assert.ok(
    missed > 5 && missed < 35,
    `a rotation player should miss a handful, got ${missed.toFixed(1)}`,
  )
})

test('the news says who is hurt and for how long', () => {
  const state = playedSeason(6)
  const notes = state.log.filter((e) => e.kind === 'note' && / out \d+ games?: /.test(e.text))
  assert.ok(notes.length > 10, `expected an injury report, got ${notes.length} lines`)
  assert.ok(
    notes.every((n) => n.date >= '2015-10-01' && n.yearEnd === 2016),
    'every note is dated inside the season it happened in',
  )
})

test('condition falls under a heavy load and holds under a sane one', () => {
  const build = (load: number): GameState => {
    const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 3)
    const roster = state.league.players.filter((p) => p.teamId === 'T00')
    const rest = (240 - 5 * load) / (roster.length - 5)
    state.teamSettings.T00 = {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: roster.map((p) => p.playerId),
      minutes: Object.fromEntries(roster.map((p, i) => [p.playerId, i < 5 ? load : rest])),
      inactive: [],
    }
    return simRestOfSeason(state, hooks).state
  }
  const meanGp = (s: GameState) => {
    const roster = s.league.players.filter((p) => p.teamId === 'T00').slice(0, 5)
    return roster.reduce((a, p) => a + (s.stats[p.playerId]?.gp ?? 0), 0) / 5
  }
  const sane = build(32)
  const mad = build(46)
  assert.ok(
    meanGp(mad) < meanGp(sane) - 3,
    `riding five men must cost games: ${meanGp(mad).toFixed(1)} vs ${meanGp(sane).toFixed(1)}`,
  )
})

test('everyone starts the new season fit', () => {
  const state = playedSeason(8)
  const hurt = Object.values(state.availability ?? {}).filter((a) => a.out > 0).length
  assert.ok(hurt > 0, 'somebody should be hurt at the end of a season')
  rollover(state, hooks, makeRng(2))
  const after = Object.values(state.availability ?? {})
  assert.ok(after.length > 0)
  assert.ok(
    after.every((a) => a.out === 0 && a.condition === 1 && a.missed === 0),
    'a summer heals everything',
  )
})

test('an out-of-date save with no availability record still plays', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 5)
  delete (state as { availability?: unknown }).availability
  const played = simRestOfSeason(state, hooks).state
  assert.ok(Object.keys(played.stats).length > 100, 'the season should run')
  assert.ok(Object.keys(played.availability ?? {}).length > 100, 'and build the record as it goes')
})

test('a season that was played always records its trophies', () => {
  // The first simulated season used to reach history with `awards: null`, so `seasonHistory()[0]`
  // had no MVP. Closing the books computes them if nothing else has.
  const state = playedSeason(9)
  state.awards = null
  rollover(state, hooks, makeRng(11))
  const first = state.history[0]
  assert.ok(first?.awards?.mvp, 'the first season should have an MVP')
  assert.ok(first?.awards?.dpoy && first.awards.allNba.length === 3)
  const mvpId = first?.awards?.mvp?.playerId as string
  assert.ok(
    state.league.players.some((p: LeaguePlayer) => p.playerId === mvpId),
    'and he should be a real player',
  )
})
