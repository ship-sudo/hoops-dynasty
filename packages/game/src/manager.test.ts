// What a human manager can do: set the rotation and the tactics, take part in the draft, trade a
// pick, and have the two halves of a rollover behave like the whole.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from '@hoops/core'
import { makePick, onTheClock, openDraft, pickKey, runDraft, startDraft } from './draft.ts'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { rollover, rolloverBegin, rolloverFinish, stubResign } from './rollover.ts'
import { buildTeamInput } from './rotation.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, Prospect, TeamSettings } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

/** Every rotation call needs the season it is being played in. The fixture bundle is 2020. */
const OPTS = { yearEnd: 2020 }

function prospectHook(count: number): GameHooks {
  return {
    engine: fakeEngine,
    prospects: ({ yearEnd, count: n }: { yearEnd: number; count: number }) =>
      Array.from(
        { length: Math.min(n, count) },
        (_, i): Prospect => ({
          prospectId: `p-${yearEnd}-${i}`,
          name: `Prospect ${i}`,
          pos: 'SF',
          age: 20,
          heightIn: 79,
          weightLb: 210,
          // Descending quality, so "best available" is unambiguous.
          ratings: Object.fromEntries(
            [
              'rim',
              'close',
              'mid',
              'three',
              'ft',
              'passing',
              'handling',
              'drawFoul',
              'oreb',
              'dreb',
              'perimD',
              'interiorD',
              'steal',
              'block',
              'speed',
              'strength',
              'stamina',
              'iq',
              'durability',
            ].map((k) => [k, Math.max(10, 70 - i)]),
          ) as never,
          tendencies: {
            usage: 0.2,
            shotRim: 0.3,
            shotClose: 0.15,
            shotMid: 0.3,
            shotThree: 0.25,
            assist: 0.15,
            postUp: 0.1,
          },
        }),
      ),
  }
}

function playedSeason(seed = 1): GameState {
  return simRestOfSeason(newGame(fixtureBundle(), 'T00', seed), hooks).state
}

test('a depth order puts the coach in charge of who starts', () => {
  const state = newGame(fixtureBundle(), 'T00', 1)
  const team = state.league.teams[0]!
  const roster = state.league.players.filter((p) => p.teamId === team.teamId)
  const auto = buildTeamInput(team, roster, false, undefined, OPTS)
  const last = roster.at(-1)!

  const settings: TeamSettings = {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [last.playerId],
    minutes: {},
    inactive: [],
  }
  const forced = buildTeamInput(team, roster, false, settings, OPTS)
  assert.notEqual(auto.players[0]?.playerId, last.playerId, 'he would not start on merit')
  assert.equal(forced.players[0]?.playerId, last.playerId, 'the depth chart should override merit')
  assert.ok(forced.players[0]?.starter)
})

test('explicit minutes are honoured and the team still plays 240', () => {
  const state = newGame(fixtureBundle(), 'T00', 1)
  const team = state.league.teams[0]!
  const roster = state.league.players.filter((p) => p.teamId === team.teamId)
  const chosen = roster[6]!
  const settings: TeamSettings = {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [chosen.playerId],
    minutes: { [chosen.playerId]: 44 },
    inactive: [],
  }
  const input = buildTeamInput(team, roster, false, settings, OPTS)
  const his = input.players.find((p) => p.playerId === chosen.playerId)
  assert.ok(his, 'he should be in the rotation')
  assert.ok(his.minutesTarget > 35, `expected heavy minutes, got ${his.minutesTarget.toFixed(1)}`)
  const total = input.players.reduce((a, p) => a + p.minutesTarget, 0)
  assert.ok(Math.abs(total - 240) < 0.01, `a team plays 240 minutes, got ${total}`)
})

test('an inactive player does not dress', () => {
  const state = newGame(fixtureBundle(), 'T00', 1)
  const team = state.league.teams[0]!
  const roster = state.league.players.filter((p) => p.teamId === team.teamId)
  const benched = buildTeamInput(team, roster, false, undefined, OPTS)?.players[0]
    ?.playerId as string
  const settings: TeamSettings = {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [benched],
  }
  const input = buildTeamInput(team, roster, false, settings, OPTS)
  assert.ok(!input.players.some((p) => p.playerId === benched), 'he was made inactive')
})

test('tactics reach the engine input', () => {
  const state = newGame(fixtureBundle(), 'T00', 1)
  const team = state.league.teams[0]!
  const roster = state.league.players.filter((p) => p.teamId === team.teamId)
  const settings: TeamSettings = {
    tactics: { pace: 1, threes: 1, crashGlass: -1, pressure: 1, zone: true },
    depth: [],
    minutes: {},
    inactive: [],
  }
  assert.deepEqual(buildTeamInput(team, roster, false, settings, OPTS).tactics, settings.tactics)
  assert.equal(
    buildTeamInput(team, roster, false, undefined, OPTS).tactics.pace,
    0,
    'default is neutral',
  )
})

test('the draft can pause before your pick, and you can take who you like', () => {
  const state = playedSeason()
  const rng = makeRng(4)
  state.draft = startDraft(state, rng)
  const h = prospectHook(60)
  openDraft(state, h, rng)
  assert.ok((state.draft.board.length ?? 0) > 0, 'the board should be filled when the draft opens')

  const mine = state.draft.picks.find((p) => p.teamId === 'T00')?.teamId ?? 'T00'
  runDraft(state, h, rng, mine)
  const clock = onTheClock(state)
  assert.equal(clock?.teamId, mine, 'the draft should stop on your pick')
  assert.ok(!state.draft.done)

  // Take someone who is not the best available, which is the whole point of picking yourself.
  const target = state.draft.board[3]
  assert.ok(target)
  const taken = makePick(state, target.prospectId)
  assert.equal(taken?.prospectId, target.prospectId)
  assert.ok(
    state.league.players.some((p) => p.playerId === target.prospectId && p.teamId === mine),
    'he should join your team',
  )
  assert.ok(!state.draft.board.some((p) => p.prospectId === target.prospectId), 'off the board')

  runDraft(state, h, rng)
  assert.ok(state.draft.done, 'the rest of the room finishes the draft')
})

test('a traded pick is made by whoever holds it', () => {
  const state = playedSeason()
  // T00 sold its first-rounder to T05 before the draft.
  const original = 'T00'
  const buyer = 'T05'
  state.pickOwners[pickKey(state.season.yearEnd, 1, original)] = buyer
  const draft = startDraft(state, makeRng(9))
  const round1 = draft.picks.filter((p) => p.round === 1)
  assert.ok(!round1.some((p) => p.teamId === original), 'the original owner has no first-rounder')
  assert.equal(
    round1.filter((p) => p.teamId === buyer).length,
    2,
    'the buyer holds two first-round picks',
  )
})

test('the two halves of a rollover equal the whole', () => {
  const whole = playedSeason(7)
  const split = playedSeason(7)
  const rngA = makeRng(3)
  const rngB = makeRng(3)

  rollover(whole, hooks, rngA)

  const summary = rolloverBegin(split, hooks, rngB)
  // The default market is what rollover() would have run in the middle.
  stubResign(split, rngB)
  rolloverFinish(split, hooks, rngB)

  assert.equal(summary.yearEnd, whole.history.at(-1)?.yearEnd)
  assert.equal(split.season.yearEnd, whole.season.yearEnd, 'both should be in the new season')
  assert.equal(split.phase, 'regular')
  assert.equal(split.league.players.length, whole.league.players.length)
  assert.equal(split.calendar.schedule.length, whole.calendar.schedule.length)
})
