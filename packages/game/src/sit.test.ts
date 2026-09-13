import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import {
  autoAdjustSettings,
  coverInjured,
  dropFromRoster,
  markInjuryCover,
  uncoverReturned,
} from './sit.ts'
import { availabilityOf, type TeamSettings } from './state.ts'

function plan(over: Partial<TeamSettings> = {}): TeamSettings {
  return {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: ['a', 'b', 'c', 'd', 'e'],
    minutes: { a: 36, b: 32, c: 28, d: 24, e: 20 },
    inactive: [],
    lineup: { PG: 'a', SG: 'b', SF: 'c', PF: 'd', C: 'e' },
    lineups: {
      starters: { PG: 'a', SG: 'b', SF: 'c', PF: 'd', C: 'e' },
      bench: { PG: 'f', SG: 'g', SF: 'h', PF: 'i', C: 'j' },
    },
    ...over,
  }
}

test('coverInjured benches him, zeroes minutes, and pulls him from every five', () => {
  const next = coverInjured(plan(), 'a')
  assert.deepEqual(next.inactive, ['a'])
  assert.equal(next.minutes.a, 0)
  assert.equal(next.minutes.b, 32)
  assert.equal(next.lineup?.PG, undefined)
  assert.equal(next.lineup?.SG, 'b')
  assert.equal(next.lineups?.starters?.PG, undefined)
  assert.equal(next.lineups?.starters?.SG, 'b')
  assert.equal(next.lineups?.bench?.PG, 'f')
})

test('coverInjured is a no-op on a man already inactive', () => {
  const next = coverInjured(plan({ inactive: ['a'] }), 'a')
  assert.deepEqual(next.inactive, ['a'])
  assert.equal(next.minutes.a, 0)
})

test('dropFromRoster takes him off the club, not the inactive list', () => {
  const next = dropFromRoster(plan({ inactive: ['a'] }), 'a')
  assert.deepEqual(next.inactive, [])
  assert.ok(!next.depth.includes('a'))
  assert.equal(next.minutes.a, undefined)
  assert.equal(next.lineup?.PG, undefined)
})

test('autoAdjustSettings sits the hurt, fills the five, and plays 240', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2004 }), 'T00', 1)
  const roster = state.league.players.filter((p) => p.teamId === 'T00')
  const hurt = roster[0]
  assert.ok(hurt)
  const next = autoAdjustSettings(plan(), roster, new Set([hurt.playerId]), false)
  assert.ok(next.inactive.includes(hurt.playerId))
  assert.equal(next.minutes[hurt.playerId], 0)
  assert.ok(next.lineup?.PG && next.lineup.PG !== hurt.playerId)
  const dressed = roster
    .filter((p) => !next.inactive.includes(p.playerId))
    .reduce((s, p) => s + (next.minutes[p.playerId] ?? 0), 0)
  assert.equal(dressed, 240)
  const back = autoAdjustSettings(next, roster, new Set(), false)
  assert.ok(!back.inactive.includes(hurt.playerId))
  assert.ok((back.minutes[hurt.playerId] ?? 0) > 0)
})

test('uncoverReturned takes him off inactive and restores minutes without rewriting the rest', () => {
  const covered = coverInjured(plan({ depth: ['a', 'b', 'c', 'd', 'e', 'f'] }), 'a')
  const next = uncoverReturned(covered, 'a', 36)
  assert.ok(!next.inactive.includes('a'))
  assert.equal(next.minutes.a, 36)
  assert.equal(next.minutes.b, 32)
  assert.equal(next.depth[0], 'a')
})

test('markInjuryCover stamps minutes and skips a man already benched', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2004 }), 'T00', 1)
  const id = 'T00-0'
  state.teamSettings.T00 = plan({ minutes: { [id]: 36 }, inactive: [], depth: [id] })
  markInjuryCover(state, id)
  assert.equal(availabilityOf(state, id).heldMinutes, 36)

  const other = 'T00-1'
  state.teamSettings.T00 = plan({ minutes: { [other]: 28 }, inactive: [other], depth: [other] })
  markInjuryCover(state, other)
  assert.equal(availabilityOf(state, other).heldMinutes, undefined)
})
