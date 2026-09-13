import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from '@hoops/core'
import { fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { buildMatchups } from './schedule.ts'
import type { LeagueTeam } from './state.ts'

const CASES: [number, number][] = [
  [30, 82],
  [29, 82],
  [30, 66],
  [30, 72],
  [29, 50],
  [32, 82],
]

function teamsOf(n: number): LeagueTeam[] {
  const bundle = fixtureBundle({ teams: n })
  return bundle.teams.map((t) => ({
    teamId: t.teamId,
    abbr: t.abbr,
    name: t.name,
    city: t.city,
    conference: t.conference,
    division: t.division,
  }))
}

test('every team plays exactly the era game count, half of them at home', () => {
  for (const [n, games] of CASES) {
    const teams = teamsOf(n)
    const ms = buildMatchups(teams, games, makeRng(9))
    assert.equal(ms.length, (n * games) / 2, `${n}x${games} total`)
    const played = new Map<string, number>()
    const home = new Map<string, number>()
    for (const [h, a] of ms) {
      assert.notEqual(h, a, 'no team plays itself')
      played.set(h, (played.get(h) ?? 0) + 1)
      played.set(a, (played.get(a) ?? 0) + 1)
      home.set(h, (home.get(h) ?? 0) + 1)
    }
    for (const t of teams) {
      assert.equal(
        played.get(t.teamId),
        games,
        `${t.teamId} plays ${games} in a ${n}-team, ${games}-game season`,
      )
      assert.ok(
        Math.abs((home.get(t.teamId) ?? 0) - games / 2) <= 1,
        `${t.teamId} home games ${home.get(t.teamId)} near ${games / 2}`,
      )
    }
  }
})

test('division rivals meet at least as often as interconference opponents', () => {
  const teams = teamsOf(30)
  const ms = buildMatchups(teams, 82, makeRng(3))
  const by = new Map(teams.map((t) => [t.teamId, t]))
  const counts = new Map<string, number>()
  for (const [h, a] of ms) {
    const k = h < a ? `${h}|${a}` : `${a}|${h}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let divMin = 99
  let interMax = 0
  for (const [k, c] of counts) {
    const [x, y] = k.split('|') as [string, string]
    const tx = by.get(x) as LeagueTeam
    const ty = by.get(y) as LeagueTeam
    if (tx.conference === ty.conference && tx.division === ty.division) divMin = Math.min(divMin, c)
    if (tx.conference !== ty.conference) interMax = Math.max(interMax, c)
  }
  assert.ok(divMin >= interMax, `division min ${divMin} >= interconference max ${interMax}`)
})

test('the calendar never puts a team in two games on one day', () => {
  const state = newGame(fixtureBundle({ teams: 30, games: 82 }), 'T00', 5)
  const seen = new Map<string, Set<string>>()
  for (const g of state.calendar.schedule) {
    const day = seen.get(g.date) ?? new Set<string>()
    assert.ok(!day.has(g.homeTeamId), `${g.homeTeamId} twice on ${g.date}`)
    assert.ok(!day.has(g.awayTeamId), `${g.awayTeamId} twice on ${g.date}`)
    day.add(g.homeTeamId)
    day.add(g.awayTeamId)
    seen.set(g.date, day)
  }
  assert.equal(state.calendar.schedule.length, 1230)
  // The schedule must be date ordered: simDay walks it with a cursor.
  for (let i = 1; i < state.calendar.schedule.length; i++) {
    assert.ok(
      (state.calendar.schedule[i - 1] as { date: string }).date <=
        (state.calendar.schedule[i] as { date: string }).date,
    )
  }
})

test('the same seed builds the same schedule', () => {
  const a = newGame(fixtureBundle(), 'T00', 11).calendar.schedule
  const b = newGame(fixtureBundle(), 'T00', 11).calendar.schedule
  assert.deepEqual(a, b)
  const c = newGame(fixtureBundle(), 'T00', 12).calendar.schedule
  assert.notDeepEqual(a, c)
})
