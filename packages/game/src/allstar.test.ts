import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allStarDate, isAllStarRestDay } from './allstar.ts'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { simDays, simRestOfSeason } from './sim.ts'
import type { GameHooks } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine, injure: () => null }

test('a normal October start has a mid-February break; a lockout does not', () => {
  assert.equal(allStarDate('2019-10-25', '2020-04-12'), '2020-02-15')
  assert.equal(allStarDate('1999-02-05', '1999-05-05'), null)
  assert.equal(allStarDate('2020-01-15', '2020-04-12'), null)
  assert.ok(isAllStarRestDay('2020-02-14', '2020-02-15'))
  assert.ok(isAllStarRestDay('2020-02-17', '2020-02-15'))
  assert.ok(!isAllStarRestDay('2020-02-13', '2020-02-15'))
  assert.ok(!isAllStarRestDay('2020-02-18', '2020-02-15'))
})

test('simDays from opening night does not reach the break in ten days', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const r = simDays(s, hooks, 10)
  assert.equal(r.interrupt, null)
  assert.equal(r.state.allStar, undefined)
  assert.ok(r.state.calendar.date < '2020-02-01')
})

test('simDays stops at the All-Star break, then continues, then wraps the season', () => {
  const s = newGame(fixtureBundle(), 'T00', 3)
  const breakHit = simDays(s, hooks, 200)
  assert.equal(breakHit.interrupt?.kind, 'allstar')
  if (breakHit.interrupt?.kind !== 'allstar') return
  assert.equal(breakHit.interrupt.date, '2020-02-15')
  assert.ok(breakHit.state.allStar?.result)
  assert.ok(
    (breakHit.state.allStar?.result?.eastPts ?? 0) > 60 &&
      (breakHit.state.allStar?.result?.westPts ?? 0) > 60,
  )
  assert.equal(breakHit.state.phase, 'regular')
  assert.ok(breakHit.state.calendar.date <= '2020-02-15')

  const after = simDays(breakHit.state, hooks, 5)
  assert.notEqual(after.interrupt?.kind, 'allstar')
  assert.ok(after.state.calendar.date > '2020-02-15')

  const wrap = simDays(after.state, hooks, 400)
  assert.equal(wrap.interrupt?.kind, 'season')
  if (wrap.interrupt?.kind !== 'season') return
  assert.equal(wrap.interrupt.yearEnd, 2020)
  assert.ok(wrap.state.awards?.mvp)
  assert.ok(wrap.interrupt.mvpName)
  assert.notEqual(wrap.state.phase, 'regular')
})

test('simRestOfSeason does not pause at the break and still holds the game', () => {
  const s = newGame(fixtureBundle(), 'T00', 8)
  const r = simRestOfSeason(s, hooks)
  assert.equal(r.interrupt, null, 'the headless runner plays through recaps')
  assert.ok(r.state.allStar?.result)
  assert.ok(r.state.playoffs?.championTeamId)
})
