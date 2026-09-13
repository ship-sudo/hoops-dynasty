import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import {
  conferenceOrder,
  conferenceTable,
  divisionTable,
  seedConference,
  winPct,
} from './standings.ts'
import type { GameState, TeamRecord } from './state.ts'
import { emptyRecord } from './state.ts'

/** Hand-build a finished season: `wins[teamId]` and optional head-to-head overrides. */
function withRecords(
  state: GameState,
  wins: Record<string, number>,
  h2h: Record<string, Record<string, [number, number]>> = {},
  diff: Record<string, number> = {},
): GameState {
  const games = state.season.rules.games
  const recs: Record<string, TeamRecord> = {}
  for (const t of state.league.teams) {
    const w = wins[t.teamId] ?? 41
    const r = emptyRecord(t.teamId)
    r.wins = w
    r.losses = games - w
    r.pf = 100 * games + (diff[t.teamId] ?? 0)
    r.pa = 100 * games
    // Conference and division splits track the overall rate, so those steps stay neutral.
    r.confW = Math.round(w * 0.6)
    r.confL = Math.round((games - w) * 0.6)
    r.divW = Math.round(w * 0.2)
    r.divL = Math.round((games - w) * 0.2)
    recs[t.teamId] = r
  }
  for (const [a, opps] of Object.entries(h2h)) {
    for (const [b, [w, l]] of Object.entries(opps)) {
      ;(recs[a] as TeamRecord).h2h[b] = { w, l }
      ;(recs[b] as TeamRecord).h2h[a] = { w: l, l: w }
    }
  }
  return { ...state, records: recs }
}

function base(opts = {}): GameState {
  return newGame(fixtureBundle({ teams: 30, ...opts }), 'T00', 1)
}

test('win pct and games behind', () => {
  const s = withRecords(base(), { T00: 60, T02: 50 })
  const east = conferenceTable(s).East
  assert.equal(east[0]?.teamId, 'T00')
  assert.equal(Math.round((east[0]?.pct ?? 0) * 1000), 732) // 60-22
  const t02 = east.find((r) => r.teamId === 'T02')
  assert.equal(t02?.gb, 10)
})

test('head to head breaks a two-team tie', () => {
  // T00 and T03 are both East (index 0 -> Atlantic, 3 -> Northwest is West) so use T00 and T06.
  const s = withRecords(base(), { T00: 55, T06: 55 }, { T00: { T06: [1, 3] } })
  const order = conferenceOrder(s, 'East')
  assert.ok(order.indexOf('T06') < order.indexOf('T00'), 'T06 won the season series 3-1')
})

test('point differential breaks a tie when everything above is level', () => {
  const s = withRecords(
    base(),
    { T00: 55, T06: 55 },
    { T00: { T06: [2, 2] } },
    { T00: -100, T06: 400 },
  )
  const order = conferenceOrder(s, 'East')
  assert.ok(order.indexOf('T06') < order.indexOf('T00'))
})

test('the last resort is deterministic, not random', () => {
  const s = withRecords(base(), { T00: 55, T06: 55 }, { T00: { T06: [2, 2] } })
  const a = conferenceOrder(s, 'East')
  const b = conferenceOrder(s, 'East')
  assert.deepEqual(a, b)
})

test('division tables partition the conference tables', () => {
  const s = withRecords(base(), {})
  const divs = divisionTable(s)
  assert.equal(Object.keys(divs).length, 6)
  let total = 0
  for (const rows of Object.values(divs)) {
    assert.equal(rows.length, 5)
    total += rows.length
  }
  assert.equal(total, 30)
})

test('1998-2004: the two division winners take seeds 1 and 2', () => {
  // Four divisions: East is Atlantic (T00, T04, ...) and Central (T01, T05, ...).
  const s = withRecords(base({ seeding: 'division_winners_top_2', divisions: 4 }), {
    T04: 62, // Atlantic winner
    T00: 61, // Atlantic runner up, second best record in the conference
    T01: 48, // Central winner on a much worse record
    T05: 47,
  })
  const seeds = seedConference(s, 'East')
  assert.deepEqual(seeds.slice(0, 2), ['T04', 'T01'], 'division winners seed 1 and 2, by record')
  assert.equal(seeds[2], 'T00', 'a 61-win non-winner drops to the 3 seed')
})

test('2006-2016: three division winners plus the best of the rest fill seeds 1 to 4', () => {
  const s = withRecords(base({ seeding: 'division_winners_top_4' }), {
    T00: 45, // Atlantic winner, weak division
    T01: 60, // Central winner
    T07: 55, // Central runner up: best record of any non-winner
    T02: 58, // Southeast winner
    T08: 54, // Southeast runner up
  })
  const seeds = seedConference(s, 'East')
  assert.deepEqual(
    seeds.slice(0, 4),
    ['T01', 'T02', 'T07', 'T00'],
    'three winners plus the best of the rest',
  )
  assert.equal(seeds[4], 'T08', 'the next non-winner starts at 5')
})

test('2017 on: seeding is record only', () => {
  const s = withRecords(base({ seeding: 'record' }), { T00: 45, T06: 62, T12: 60 })
  const seeds = seedConference(s, 'East')
  assert.equal(seeds[0], 'T06')
  assert.equal(seeds[1], 'T12')
})

test('winPct of an unplayed season is zero, not NaN', () => {
  assert.equal(winPct(emptyRecord('X')), 0)
})
