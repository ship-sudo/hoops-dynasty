import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Injury } from '@hoops/injury'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { NEWSWORTHY_GAMES } from './play.ts'
import { simDays } from './sim.ts'
import type { GameHooks } from './state.ts'

const EIGHT: Injury = {
  severity: 'strain',
  name: 'torn meniscus',
  games: 8,
  returnCondition: 0.85,
}
const TWO: Injury = {
  severity: 'knock',
  name: 'ankle soreness',
  games: 2,
  returnCondition: 0.95,
}

function force(playerId: string, injury: Injury): GameHooks {
  let done = false
  return {
    engine: fakeEngine,
    injure(p) {
      if (p.playerId !== playerId) return null
      if (done) return null
      done = true
      return injury
    },
  }
}

function datesOf(results: { date: string }[]): number {
  return new Set(results.map((g) => g.date)).size
}

test('NEWSWORTHY_GAMES is a week, not a knock', () => {
  assert.equal(NEWSWORTHY_GAMES, 5)
  assert.ok(EIGHT.games >= NEWSWORTHY_GAMES)
  assert.ok(TWO.games < NEWSWORTHY_GAMES)
})

test('a user-team 8-game injury stops a 10-day sim after that day', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const first = s.calendar.schedule.find((g) => g.homeTeamId === 'T00' || g.awayTeamId === 'T00')
  assert.ok(first)
  const r = simDays(s, force('T00-0', EIGHT), 10)
  assert.deepEqual(r.interrupt, {
    kind: 'injury',
    playerId: 'T00-0',
    name: 'T00 Player 0',
    games: 8,
    injuryName: 'torn meniscus',
    teamId: 'T00',
  })
  assert.ok(r.results.every((g) => g.date <= first.date))
  assert.ok(r.results.some((g) => g.date === first.date))
  assert.ok(datesOf(r.results) < 10, 'the week must not keep running after the tear')
  assert.equal(r.state.availability?.['T00-0']?.out, 8)
})

test('a 2-game knock does not stop a 10-day sim', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const r = simDays(s, force('T00-0', TWO), 10)
  assert.equal(r.interrupt, null)
  assert.equal(datesOf(r.results), 10)
  assert.ok(
    (r.state.availability?.['T00-0']?.missed ?? 0) >= 1,
    'he still sat, the calendar just did not pause',
  )
  assert.ok(!r.state.log.some((e) => e.kind === 'note' && e.text.includes('T00 Player 0')))
})

test('other-team injuries do not stop the sim', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const opener = s.calendar.schedule[0]
  assert.ok(opener)
  const otherTeam =
    opener.homeTeamId === 'T00'
      ? opener.awayTeamId
      : opener.awayTeamId === 'T00'
        ? opener.homeTeamId
        : opener.homeTeamId
  const otherId = `${otherTeam}-0`
  const r = simDays(s, force(otherId, EIGHT), 10)
  assert.equal(r.interrupt, null)
  assert.equal(datesOf(r.results), 10)
  assert.ok(
    r.state.log.some((e) => e.kind === 'note' && e.text.includes(`${otherTeam} Player 0`)),
    'the paper still carries the other club’s injury',
  )
})
