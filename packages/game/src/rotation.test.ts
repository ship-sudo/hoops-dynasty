// The coach: who dresses, for how long, and what he does when the treatment table fills up.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POSITIONS } from '@hoops/core'
import { fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import {
  abilityOf,
  buildTeamInput,
  chooseSquad,
  depthScore,
  hintWeight,
  maxMinutes,
  onFloorFor,
  shareMinutes,
} from './rotation.ts'
import { fitPlayer, type GameState, type LeaguePlayer, type TeamSettings } from './state.ts'

function squad(state: GameState, teamId = 'T00'): LeaguePlayer[] {
  return state.league.players.filter((p) => p.teamId === teamId)
}

function team(state: GameState, teamId = 'T00') {
  return state.league.teams.find((t) => t.teamId === teamId) as NonNullable<
    (typeof state.league.teams)[0]
  >
}

test('a rotation plays 240 minutes, tops out near the era ceiling, and tails off at 8-12', () => {
  for (const yearEnd of [1998, 2004, 2016, 2024]) {
    const state = newGame(fixtureBundle({ yearEnd }), 'T00', 1)
    const input = buildTeamInput(team(state), squad(state), false, undefined, { yearEnd })
    const mins = input.players.map((p) => p.minutesTarget).sort((a, b) => b - a)
    const total = mins.reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(total - 240) < 0.01, `${yearEnd}: a team plays 240, got ${total.toFixed(2)}`)
    assert.ok(
      (mins[0] as number) <= maxMinutes(yearEnd) + 1e-6,
      `${yearEnd}: nobody passes the era ceiling`,
    )
    assert.ok(
      (mins[0] as number) >= 33,
      `${yearEnd}: the best man should carry a real load, got ${(mins[0] as number).toFixed(1)}`,
    )
    const tail = mins.filter((m) => m > 0).at(-1) as number
    assert.ok(
      tail < 14,
      `${yearEnd}: the bottom of the ladder should collapse, got ${tail.toFixed(1)}`,
    )
  }
})

test('the era ceiling follows the real minutes leaders down the decades', () => {
  assert.ok(maxMinutes(1998) > maxMinutes(2016))
  assert.ok(maxMinutes(2016) > maxMinutes(2024))
  assert.ok(maxMinutes(2004) >= 42 && maxMinutes(2024) <= 38.5)
  assert.equal(maxMinutes(2100), 37.5, 'it flattens out rather than falling forever')
})

test('a star stretches the ladder past a flat squad', () => {
  const flat = shareMinutes([50, 50, 50, 50, 50, 50, 50, 50, 50, 50], false, 2016)
  const starry = shareMinutes([88, 55, 52, 50, 48, 46, 44, 42, 40, 38], false, 2016)
  assert.ok(
    (starry[0] as number) > (flat[0] as number) + 2,
    `a star should play more: ${(starry[0] as number).toFixed(1)} vs ${(flat[0] as number).toFixed(1)}`,
  )
  assert.ok(Math.abs(starry.reduce((a, b) => a + b, 0) - 240) < 0.01)
})

test('the real-minutes hint decides the first season and then fades', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2020 }), 'T00', 1)
  const roster = squad(state)
  const grinder = roster[0] as LeaguePlayer // 36 real mpg
  const deep = roster[10] as LeaguePlayer // 8 real mpg
  assert.ok(hintWeight(grinder, 2020) > 0.5, 'gospel on opening night')
  assert.equal(hintWeight(grinder, 2023), 0, 'and worthless three years on')

  // Make the deep reserve the better player. In the hint year the coach still rides the starter.
  deep.ratings = {
    ...deep.ratings,
    ...Object.fromEntries(Object.keys(deep.ratings).map((k) => [k, 90])),
  }
  assert.ok(abilityOf(deep) > abilityOf(grinder), 'on merit he is now the best man on the team')
  assert.ok(
    depthScore(grinder, 2020) > depthScore(deep, 2020),
    'but on opening night the depth chart believes what really happened',
  )
  assert.ok(
    depthScore(deep, 2023) > depthScore(grinder, 2023),
    'three years later only merit is left',
  )
})

test('an injured man does not dress, and the fit ones absorb his minutes', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const star = roster[0] as LeaguePlayer
  const availability = { [star.playerId]: { ...fitPlayer(), out: 9 } }
  const input = buildTeamInput(team(state), roster, false, undefined, {
    yearEnd: 2016,
    availability,
  })
  assert.ok(
    !input.players.some((p) => p.playerId === star.playerId),
    'he is on the treatment table',
  )
  assert.ok(Math.abs(input.players.reduce((a, p) => a + p.minutesTarget, 0) - 240) < 0.01)
})

test('eight men dress even when the treatment table is full', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const availability = Object.fromEntries(
    roster.slice(0, roster.length - 3).map((p) => [p.playerId, { ...fitPlayer(), out: 5 }]),
  )
  const dressed = chooseSquad(roster, { yearEnd: 2016, availability })
  assert.ok(dressed.length >= 8, `the engine needs eight bodies, got ${dressed.length}`)
})

test('condition reaches the engine instead of a hardcoded 1', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const tired = roster[0] as LeaguePlayer
  const input = buildTeamInput(team(state), roster, false, undefined, {
    yearEnd: 2016,
    availability: { [tired.playerId]: { ...fitPlayer(), condition: 0.7 } },
  })
  const line = input.players.find((p) => p.playerId === tired.playerId)
  assert.equal(line?.condition, 0.7)
  assert.equal(
    input.players.find((p) => p.playerId !== tired.playerId)?.condition,
    1,
    'everyone else is fresh',
  )
})

test('a manager who demands 44 minutes gets them', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2024 }), 'T00', 1)
  const roster = squad(state)
  const chosen = roster[0] as LeaguePlayer
  const input = buildTeamInput(
    team(state),
    roster,
    false,
    {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: [],
      minutes: Object.fromEntries(
        roster.map((p, i) => [p.playerId, i === 0 ? 44 : (240 - 44) / (roster.length - 1)]),
      ),
      inactive: [],
    },
    { yearEnd: 2024 },
  )
  const his = input.players.find((p) => p.playerId === chosen.playerId)?.minutesTarget ?? 0
  assert.ok(
    his > 40,
    `the era ceiling must not silently override the manager, got ${his.toFixed(1)}`,
  )
})

function byPos(roster: LeaguePlayer[]): NonNullable<TeamSettings['lineups']> {
  const of = (start: number) => ({
    PG: roster[start]!.playerId,
    SG: roster[start + 1]!.playerId,
    SF: roster[start + 2]!.playerId,
    PF: roster[start + 3]!.playerId,
    C: roster[start + 4]!.playerId,
  })
  return {
    starters: of(0),
    bench: of(5),
    // Sixth man closes; the starting centre sits. Classic small-ball close.
    closing: {
      PG: roster[0]!.playerId,
      SG: roster[1]!.playerId,
      SF: roster[5]!.playerId,
      PF: roster[2]!.playerId,
      C: roster[3]!.playerId,
    },
  }
}

function plan(roster: LeaguePlayer[]): TeamSettings {
  return {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [],
    lineups: byPos(roster),
  }
}

test('named units: starters play the first stint', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const settings = plan(roster)
  const floor = onFloorFor(roster, settings, { period: 1, clock: 720, margin: 0 }, { yearEnd: 2016 })
  assert.ok(floor, 'units are on')
  assert.deepEqual(
    floor,
    POSITIONS.map((p) => settings.lineups!.starters![p]),
    'tip-off is the starting five, PG through C',
  )
})

test('named units: closing five in a 2-point fourth', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const settings = plan(roster)
  const floor = onFloorFor(
    roster,
    settings,
    { period: 4, clock: 120, margin: 2 },
    { yearEnd: 2016 },
  )
  assert.deepEqual(
    floor,
    POSITIONS.map((p) => settings.lineups!.closing![p]),
    'a two-point game inside six minutes is the closing five, not the starters',
  )
  const first = onFloorFor(roster, settings, { period: 1, clock: 720, margin: 0 }, { yearEnd: 2016 })
  assert.notDeepEqual(floor, first, 'closing is a different group from the opening five')
})

test('named units: an injured starter is skipped and the next man at that slot starts', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const settings = plan(roster)
  const pg = roster[0] as LeaguePlayer
  const nextPg = roster[5] as LeaguePlayer
  assert.equal(pg.pos, 'PG')
  assert.equal(nextPg.pos, 'PG')
  const floor = onFloorFor(
    roster,
    settings,
    { period: 1, clock: 720, margin: 0 },
    { yearEnd: 2016, availability: { [pg.playerId]: { ...fitPlayer(), out: 9 } } },
  )
  assert.ok(floor)
  assert.ok(!floor.includes(pg.playerId), 'he is on the treatment table')
  assert.equal(floor[0], nextPg.playerId, 'the backup point guard is next man up')
})

test('named units: no lineups means the old minutes-share path, digit for digit', () => {
  const state = newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', 1)
  const roster = squad(state)
  const none = buildTeamInput(team(state), roster, false, undefined, { yearEnd: 2016 })
  const empty = buildTeamInput(
    team(state),
    roster,
    false,
    {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: [],
      minutes: {},
      inactive: [],
    },
    { yearEnd: 2016 },
  )
  const startersOnly = buildTeamInput(
    team(state),
    roster,
    false,
    {
      tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
      depth: [],
      minutes: {},
      inactive: [],
      lineup: {
        PG: roster[0]!.playerId,
        SG: roster[1]!.playerId,
        SF: roster[2]!.playerId,
        PF: roster[3]!.playerId,
        C: roster[4]!.playerId,
      },
    },
    { yearEnd: 2016 },
  )
  assert.equal(none.units, undefined)
  assert.equal(empty.units, undefined)
  assert.equal(startersOnly.units, undefined, 'the old starting five is not a unit rotation')
  assert.deepEqual(
    empty.players.map((p) => [p.playerId, p.minutesTarget, p.starter]),
    none.players.map((p) => [p.playerId, p.minutesTarget, p.starter]),
  )
  const withUnits = buildTeamInput(team(state), roster, false, plan(roster), { yearEnd: 2016 })
  assert.ok(withUnits.units, 'three named lineups opt in')
  assert.notEqual(
    withUnits.players[0]!.minutesTarget,
    none.players[0]!.minutesTarget,
    'once units are named, minutes come from stints, not the ladder',
  )
  const mid = onFloorFor(
    roster,
    plan(roster),
    { period: 1, clock: 300, margin: 0 },
    { yearEnd: 2016 },
  )
  assert.deepEqual(
    mid,
    POSITIONS.map((p) => plan(roster).lineups!.bench![p]),
    'the bench unit takes the middle of the first quarter',
  )
  const blowout = onFloorFor(
    roster,
    plan(roster),
    { period: 4, clock: 180, margin: 22 },
    { yearEnd: 2016 },
  )
  const stars = new Set(POSITIONS.map((p) => plan(roster).lineups!.starters![p]!))
  assert.ok(
    blowout && blowout.every((id) => !stars.has(id)),
    'a blowout sits the starting five',
  )
})
