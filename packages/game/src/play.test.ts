import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Injury } from '@hoops/injury'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { NEWSWORTHY_GAMES } from './play.ts'
import { simDays } from './sim.ts'
import { coverInjured } from './sit.ts'
import { availabilityOf, type GameHooks } from './state.ts'

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
    warning: false,
  })
  assert.ok(r.results.every((g) => g.date <= first.date))
  assert.ok(r.results.some((g) => g.date === first.date))
  assert.ok(datesOf(r.results) < 10, 'the week must not keep running after the tear')
  assert.equal(r.state.availability?.['T00-0']?.out, 8)
})

test('a user-team 2-game knock sits him without stopping the week', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const r = simDays(s, force('T00-0', TWO), 10)
  assert.equal(r.interrupt, null, 'a knock is not a recap')
  assert.equal(datesOf(r.results), 10)
  assert.ok(
    !r.state.log.some((e) => e.kind === 'note' && e.text.includes('day-to-day')),
    'the paper does not run jammed fingers',
  )
  const a = r.state.availability?.['T00-0']
  assert.ok(a)
  assert.ok((a.missed ?? 0) >= 1 || (a.out ?? 0) > 0 || a.injury, 'he sat with the knock')
})

test('playing through a warning can become a real absence', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  let nextHit: Injury | null = TWO
  const worse: Injury = {
    severity: 'strain',
    name: 'hamstring strain',
    games: 8,
    returnCondition: 0.85,
  }
  const hooks: GameHooks = {
    engine: fakeEngine,
    injure(p) {
      if (p.playerId !== 'T00-0') return null
      const hit = nextHit
      nextHit = null
      return hit
    },
  }
  const first = simDays(s, hooks, 10)
  assert.equal(first.interrupt, null, 'the knock itself does not pause the week')
  const a = first.state.availability?.['T00-0']
  assert.ok(a)
  a.injury = TWO
  a.out = 0
  a.playingThrough = true
  nextHit = worse
  const next = simDays(first.state, hooks, 10)
  assert.equal(next.interrupt?.kind, 'injury')
  assert.equal(next.interrupt && next.interrupt.kind === 'injury' && next.interrupt.warning, false)
  assert.equal(next.state.availability?.['T00-0']?.injury?.severity, 'strain')
  assert.ok((next.state.availability?.['T00-0']?.out ?? 0) > 0)
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

test('coming back from a week-plus absence stops the sim', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const a = availabilityOf(s, 'T00-0')
  a.out = 1
  a.injury = EIGHT
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 20)
  assert.equal(r.interrupt?.kind, 'return')
  if (r.interrupt?.kind === 'return') {
    assert.equal(r.interrupt.playerId, 'T00-0')
    assert.equal(r.interrupt.games, 8)
    assert.equal(r.interrupt.injuryName, 'torn meniscus')
  }
  assert.equal(r.state.availability?.['T00-0']?.out, 0)
  assert.ok(
    r.state.log.some((e) => e.kind === 'note' && e.text.includes('available again')),
    'the paper says he is back',
  )
  assert.ok(datesOf(r.results) < 20, 'the week must not keep running after he is cleared')
})

test('coming back from a knock does not stop the week', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const a = availabilityOf(s, 'T00-0')
  a.out = 1
  a.injury = TWO
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 10)
  assert.equal(r.interrupt, null, 'a two-game return is not a recap')
  assert.equal(datesOf(r.results), 10)
  assert.equal(r.state.availability?.['T00-0']?.out, 0)
})

test('another club coming back does not stop the sim', () => {
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
  const a = availabilityOf(s, otherId)
  a.out = 1
  a.injury = EIGHT
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 10)
  assert.equal(r.interrupt, null)
  assert.equal(datesOf(r.results), 10)
})

test('a covered man comes back without the manager activating him', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const id = 'T00-0'
  s.teamSettings.T00 = {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [id, 'T00-1', 'T00-2'],
    minutes: { [id]: 36, 'T00-1': 32, 'T00-2': 28 },
    inactive: [],
  }
  const a = availabilityOf(s, id)
  a.out = 1
  a.injury = EIGHT
  a.heldMinutes = 36
  s.teamSettings.T00 = coverInjured(s.teamSettings.T00, id)
  assert.ok(s.teamSettings.T00.inactive.includes(id))
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 20)
  assert.equal(r.state.availability?.[id]?.out, 0)
  assert.equal(r.state.availability?.[id]?.heldMinutes, undefined)
  assert.ok(!r.state.teamSettings.T00?.inactive.includes(id), 'he is not still parked')
  assert.equal(r.state.teamSettings.T00?.minutes[id], 36)
})

test('an old cover with no stamp still comes back when he heals', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const id = 'T00-0'
  s.teamSettings.T00 = coverInjured(
    {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: [id, 'T00-1'],
      minutes: { [id]: 36, 'T00-1': 32 },
      inactive: [],
    },
    id,
  )
  const a = availabilityOf(s, id)
  a.out = 1
  a.injury = EIGHT
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 20)
  assert.equal(r.state.availability?.[id]?.out, 0)
  assert.ok(!r.state.teamSettings.T00?.inactive.includes(id))
  assert.ok((r.state.teamSettings.T00?.minutes[id] ?? 0) > 0)
})

test('a man already healthy but still parked from an old cover is put back', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const id = 'T00-0'
  s.teamSettings.T00 = coverInjured(
    {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: [id, 'T00-1'],
      minutes: { [id]: 36, 'T00-1': 32 },
      inactive: [],
    },
    id,
  )
  const a = availabilityOf(s, id)
  a.out = 0
  a.injury = EIGHT
  a.sinceReturn = 3
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 5)
  assert.ok(!r.state.teamSettings.T00?.inactive.includes(id), 'he should dress again')
  assert.ok((r.state.teamSettings.T00?.minutes[id] ?? 0) > 0)
})

test('a man the manager benched on purpose stays benched after he heals', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  const id = 'T00-0'
  s.teamSettings.T00 = {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [id],
    minutes: { [id]: 0 },
    inactive: [id],
  }
  const r = simDays(s, { engine: fakeEngine, injure: () => null }, 10)
  assert.ok(r.state.teamSettings.T00?.inactive.includes(id), 'a voluntary bench is not an injury cover')
})
