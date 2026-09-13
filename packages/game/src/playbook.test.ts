// The wiring: a plan the manager typed has to reach the engine input, and a plan he never touched
// has to leave it exactly as it was. The numbers those inputs then produce are proved in
// packages/engine/src/playbook.test.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NEUTRAL_INSTRUCTION, nightlyLoad, type PlayerInstruction } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { buildTeamInput, lineupOrder, slotOf } from './rotation.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, LeaguePlayer, TeamSettings } from './state.ts'

const OPTS = { yearEnd: 2020 }
const hooks: GameHooks = { engine: fakeEngine }

function squad(): {
  state: GameState
  team: GameState['league']['teams'][number]
  roster: LeaguePlayer[]
} {
  const state = newGame(fixtureBundle(), 'T00', 1)
  const team = state.league.teams[0] as GameState['league']['teams'][number]
  return { state, team, roster: state.league.players.filter((p) => p.teamId === team.teamId) }
}

function settings(over: Partial<TeamSettings> = {}): TeamSettings {
  return {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [],
    ...over,
  }
}

test('an untouched plan builds exactly the input it always built', () => {
  const { team, roster } = squad()
  const before = buildTeamInput(team, roster, false, undefined, OPTS)
  const withEmptyPlan = buildTeamInput(team, roster, false, settings(), OPTS)
  assert.deepEqual(withEmptyPlan.tactics, before.tactics)
  for (const [i, p] of withEmptyPlan.players.entries()) {
    const q = before.players[i] as (typeof before.players)[number]
    assert.equal(p.playerId, q.playerId)
    assert.deepEqual(p.ratings, q.ratings)
    assert.deepEqual(p.tendencies, q.tendencies)
    assert.equal(p.workRate, undefined, 'no work rate is sent when nobody was instructed')
    assert.equal(p.pos, q.pos)
  }
})

test('a named starting five starts, in the slots it was named for', () => {
  const { team, roster } = squad()
  // Pick five men who would not all start on merit: the last five of the roster.
  const five = roster.slice(-5)
  const lineup = {
    PG: (five[0] as LeaguePlayer).playerId,
    SG: (five[1] as LeaguePlayer).playerId,
    SF: (five[2] as LeaguePlayer).playerId,
    PF: (five[3] as LeaguePlayer).playerId,
    C: (five[4] as LeaguePlayer).playerId,
  }
  const input = buildTeamInput(team, roster, false, settings({ lineup }), OPTS)
  assert.deepEqual(
    input.players.slice(0, 5).map((p) => p.playerId),
    Object.values(lineup),
    'the five he named are the five who start, in PG-to-C order',
  )
  for (const p of input.players.slice(0, 5)) assert.ok(p.starter)
  assert.deepEqual(
    input.players.slice(0, 5).map((p) => p.pos),
    ['PG', 'SG', 'SF', 'PF', 'C'],
    'and the engine is told which slot each is filling',
  )
  const total = input.players.reduce((a, p) => a + p.minutesTarget, 0)
  assert.ok(Math.abs(total - 240) < 0.01, `still a 240-minute game, got ${total}`)
})

test('a lineup outranks the depth order, and the rest fall in behind it', () => {
  const { team, roster } = squad()
  const star = (roster[0] as LeaguePlayer).playerId
  const sub = (roster.at(-1) as LeaguePlayer).playerId
  const input = buildTeamInput(
    team,
    roster,
    false,
    settings({ lineup: { C: sub }, depth: [star] }),
    OPTS,
  )
  assert.equal(input.players[0]?.playerId, sub, 'the named centre starts ahead of the ranked man')
  assert.equal(input.players[1]?.playerId, star, 'and the ranked man is next')
})

test('playing a man out of position costs him the ratings that slot needs', () => {
  const { team, roster } = squad()
  // Find a guard and put him at centre.
  const guard = roster.find((p) => p.pos === 'PG') ?? (roster[0] as LeaguePlayer)
  const input = buildTeamInput(
    team,
    roster,
    false,
    settings({ lineup: { C: guard.playerId } }),
    OPTS,
  )
  const his = input.players.find((p) => p.playerId === guard.playerId)
  assert.ok(his)
  if (guard.pos === 'PG') {
    assert.ok(his.ratings.dreb < guard.ratings.dreb - 10, 'he is not rebounding like a centre')
    assert.ok(his.ratings.interiorD < guard.ratings.interiorD - 10)
    assert.equal(his.ratings.three, guard.ratings.three, 'his shot is untouched')
  }
})

test('an offensive system reaches the input as tendencies and tactics, never as a bonus', () => {
  const { team, roster } = squad()
  const flat = buildTeamInput(team, roster, false, settings(), OPTS)
  const inside = buildTeamInput(team, roster, false, settings({ system: 'insideOut' }), OPTS)
  assert.equal(inside.tactics.pace, -1)
  assert.equal(inside.tactics.crashGlass, 1)
  // Somebody's shot mix has moved, and nobody's ratings have.
  let moved = 0
  for (const [i, p] of inside.players.entries()) {
    const q = flat.players[i] as (typeof flat.players)[number]
    assert.deepEqual(p.ratings, q.ratings, 'a system never touches a rating')
    if (Math.abs(p.tendencies.shotThree - q.tendencies.shotThree) > 1e-9) moved++
  }
  assert.ok(moved >= 5, `the system should reshape the offence, ${moved} men moved`)
  // And the shot mix still sums to one for everybody.
  for (const p of inside.players) {
    const s =
      p.tendencies.shotRim + p.tendencies.shotClose + p.tendencies.shotMid + p.tendencies.shotThree
    assert.ok(Math.abs(s - 1) < 1e-9, `shot mix sums to ${s}`)
  }
})

test('an instruction reaches the input, and only for the man it was given to', () => {
  const { team, roster } = squad()
  const flat = buildTeamInput(team, roster, false, settings(), OPTS)
  const him = flat.players[2]?.playerId as string
  const bomb: PlayerInstruction = { ...NEUTRAL_INSTRUCTION, threes: 2, effort: 1 }
  const input = buildTeamInput(
    team,
    roster,
    false,
    settings({ instructions: { [him]: bomb } }),
    OPTS,
  )
  for (const [i, p] of input.players.entries()) {
    const q = flat.players[i] as (typeof flat.players)[number]
    if (p.playerId === him) {
      assert.ok(p.tendencies.shotThree > q.tendencies.shotThree + 0.05)
      assert.ok(p.ratings.perimD > q.ratings.perimD)
      assert.ok((p.workRate ?? 1) > 1.2)
    } else {
      assert.deepEqual(p.tendencies, q.tendencies)
      assert.deepEqual(p.ratings, q.ratings)
      assert.equal(p.workRate, undefined)
    }
  }
})

test('the lineup helpers read the plan the way the screen writes it', () => {
  const plan = settings({ lineup: { C: 'c1', PG: 'p1', SF: 'f1' } })
  assert.deepEqual(lineupOrder(plan), ['p1', 'f1', 'c1'], 'PG first, C last, blanks skipped')
  assert.equal(slotOf(plan, 'c1'), 'C')
  assert.equal(slotOf(plan, 'nobody'), null)
  assert.deepEqual(lineupOrder(undefined), [])
})

test('work rate is billed against recovery, so effort costs condition over a season', () => {
  // Two identical leagues, one where every man on T00 is told to get after it and crash.
  function seasonCondition(instruct: boolean): { condition: number; missed: number } {
    let state = newGame(fixtureBundle(), 'T00', 7)
    if (instruct) {
      const roster = state.league.players.filter((p) => p.teamId === 'T00')
      state.teamSettings.T00 = settings({
        instructions: Object.fromEntries(
          roster.map((p) => [p.playerId, { ...NEUTRAL_INSTRUCTION, effort: 1, crash: 1 }]),
        ),
      })
    }
    state = simRestOfSeason(state, hooks).state
    const roster = state.league.players.filter((p) => p.teamId === 'T00')
    const av = state.availability ?? {}
    const conditions = roster.map((p) => av[p.playerId]?.condition ?? 1)
    const missed = roster.reduce((a, p) => a + (av[p.playerId]?.missed ?? 0), 0)
    return { condition: conditions.reduce((a, b) => a + b, 0) / conditions.length, missed }
  }
  const easy = seasonCondition(false)
  const hard = seasonCondition(true)
  assert.ok(
    hard.condition < easy.condition,
    `a team that runs itself into the ground ends the season more tired: ${easy.condition.toFixed(3)} -> ${hard.condition.toFixed(3)}`,
  )
  assert.ok(hard.missed > easy.missed, `and misses more games: ${easy.missed} -> ${hard.missed}`)
})

test('the nightly load is 1 for everybody nobody has instructed', () => {
  assert.equal(nightlyLoad(undefined, 0), 1)
  assert.ok(
    nightlyLoad(undefined, 1) > 1.1,
    'running the floor is billed even without an instruction',
  )
  assert.ok(nightlyLoad(1.34, 0) > 1.3)
})
