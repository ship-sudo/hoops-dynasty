import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ratings, Tendencies } from '@hoops/core'
import { RATING_KEYS } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { simDay, simRestOfSeason, simSeason, simToDate } from './sim.ts'
import type { GameHooks, GameState, Prospect } from './state.ts'
import { rosterOf } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

const TENDENCIES: Tendencies = {
  usage: 0.2,
  shotRim: 0.32,
  shotClose: 0.13,
  shotMid: 0.3,
  shotThree: 0.25,
  assist: 0.2,
  postUp: 0.1,
}

/** A stand-in for the Phase 5 prospect generator, to prove the seam. */
function fakeProspects(ctx: { yearEnd: number; count: number }): Prospect[] {
  return Array.from({ length: ctx.count }, (_, i) => ({
    prospectId: `d${ctx.yearEnd}-${i}`,
    name: `Rookie ${ctx.yearEnd} ${i}`,
    pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5] ?? 'PG',
    age: 20,
    heightIn: 78,
    weightLb: 210,
    ratings: Object.fromEntries(RATING_KEYS.map((k) => [k, 55 - i])) as unknown as Ratings,
    tendencies: TENDENCIES,
  }))
}

function fiveSeasons(seed: number): GameState {
  let s = newGame(fixtureBundle(), 'T00', seed)
  for (let i = 0; i < 5; i++) s = simSeason(s, { ...hooks, prospects: fakeProspects }).state
  return s
}

test('same seed, same five seasons', () => {
  const a = fiveSeasons(77)
  const b = fiveSeasons(77)
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)))
  const c = fiveSeasons(78)
  assert.notDeepEqual(
    a.history.map((h) => h.championTeamId),
    c.history.map((h) => h.championTeamId),
  )
})

test('the state is JSON round-trippable at every phase', () => {
  let s = newGame(fixtureBundle({ playIn: 'seeds_7_to_10' }), 'T00', 4)
  const seen = new Set<string>()
  for (let i = 0; i < 400 && seen.size < 6; i++) {
    seen.add(s.phase)
    const r = simDay(s, hooks)
    s = JSON.parse(JSON.stringify(r.state)) as GameState
  }
  assert.deepEqual(
    [...seen].sort(),
    ['draft', 'lottery', 'offseason', 'playin', 'playoffs', 'regular'],
    'every phase survived a JSON round trip',
  )
})

test('simDay plays exactly one calendar day', () => {
  const s = newGame(fixtureBundle(), 'T00', 6)
  const day = s.calendar.date
  const expected = s.calendar.schedule.filter((g) => g.date === day).length
  const r = simDay(s, hooks)
  assert.equal(r.results.length, expected)
  assert.ok(r.state.calendar.date > day)
  for (const g of r.results) assert.equal(g.date, day)
})

test('simToDate stops on the date asked for', () => {
  const s = newGame(fixtureBundle(), 'T00', 6)
  const target = s.calendar.schedule[400]?.date as string
  const r = simToDate(s, hooks, target)
  assert.ok(r.state.calendar.date > target)
  for (const g of r.results) assert.ok(g.date <= target)
  assert.ok(r.results.length > 0)
})

test('a full regular season plays every scheduled game once, and standings add up', () => {
  const s = newGame(fixtureBundle(), 'T00', 8)
  const total = s.calendar.schedule.length
  const r = simRestOfSeason(s, hooks)
  const reg = r.results.filter((g) => g.seasonType === 'regular')
  assert.equal(reg.length, total)
  assert.equal(new Set(reg.map((g) => g.gameId)).size, total)
  let w = 0
  let l = 0
  for (const t of r.state.league.teams) {
    const rec = r.state.records[t.teamId]
    assert.ok(rec)
    assert.equal(rec.wins + rec.losses, 82, `${t.teamId} played 82`)
    assert.ok(rec.confW + rec.confL <= 82, 'conference games are a subset')
    assert.ok(
      rec.divW + rec.divL <= rec.confW + rec.confL,
      'division games are inside conference games',
    )
    const h2h = Object.values(rec.h2h).reduce((a, x) => a + x.w + x.l, 0)
    assert.equal(h2h, 82, 'head to head covers every game')
    w += rec.wins
    l += rec.losses
  }
  assert.equal(w, l, 'every win is someone else’s loss')
  assert.equal(w, total)
  assert.ok(r.state.awards?.mvp, 'an MVP was picked')
  assert.ok(r.state.playoffs?.championTeamId, 'a champion was crowned')
})

test('contracts roll forward, expire, and the stub re-signs so rosters stay legal', () => {
  const bundle = fixtureBundle()
  const s0 = newGame(bundle, 'T00', 12)
  const year = s0.season.yearEnd
  const p0 = s0.league.players.find((p) => (p.contract?.years.length ?? 0) === 1)
  assert.ok(p0, 'the fixture has a one-year deal')
  const s1 = simSeason(s0, hooks).state
  assert.equal(s1.season.yearEnd, year + 1)

  const p1 = s1.league.players.find((p) => p.playerId === p0.playerId)
  assert.ok(p1)
  assert.equal(p1.age, p0.age + 1, 'a year older')
  assert.equal(p1.yearsPro, p0.yearsPro + 1)
  assert.ok(p1.contract, 'the expiring deal was replaced by the stub')
  assert.equal(p1.contract.years[0]?.yearEnd, year + 1, 'the new deal starts next season')

  // A multi-year deal simply loses its first year.
  const m0 = s0.league.players.find((p) => (p.contract?.years.length ?? 0) === 3)
  assert.ok(m0)
  const m1 = s1.league.players.find((p) => p.playerId === m0.playerId)
  assert.equal(m1?.contract?.years.length, 2)
  assert.equal(m1?.contract?.years[0]?.yearEnd, year + 1)
  assert.ok(!m1?.contract?.years.some((y) => y.yearEnd < year + 1), 'no stale years left')

  // No contract year is ever left in the past.
  for (const p of s1.league.players) {
    for (const y of p.contract?.years ?? []) assert.ok(y.yearEnd >= year + 1)
  }
  // Season state is reset for the new year.
  assert.equal(s1.calendar.results.length, 0)
  assert.equal(Object.keys(s1.stats).length, 0)
  assert.equal(s1.playoffs, null)
  assert.equal(s1.awards, null)
  assert.equal(s1.phase, 'regular')
  assert.ok(s1.league.cap.cap > s0.league.cap.cap, 'the cap grew')
})

test('ten seasons headless: no crash, sane champions, one summary each', () => {
  let s = newGame(fixtureBundle(), 'T00', 2024)
  const h: GameHooks = { ...hooks, prospects: fakeProspects }
  for (let i = 0; i < 10; i++) {
    const r = simSeason(s, h)
    assert.ok(r.summary, `season ${i} produced a summary`)
    s = r.state
  }
  assert.equal(s.history.length, 10)
  const ids = new Set(s.league.teams.map((t) => t.teamId))
  for (const h2 of s.history) {
    assert.ok(h2.championTeamId && ids.has(h2.championTeamId), 'champion is a real team')
    assert.ok(h2.runnerUpTeamId && ids.has(h2.runnerUpTeamId))
    assert.notEqual(h2.championTeamId, h2.runnerUpTeamId)
    assert.ok(h2.bestRecord && h2.bestRecord.wins >= 41, `best record ${h2.bestRecord?.wins} wins`)
    assert.equal(h2.standings.length, 30)
    assert.equal(
      h2.standings.filter((x) => x.seed !== null).length,
      16,
      '16 teams made the playoffs',
    )
    assert.ok(h2.awards?.mvp)
    assert.equal(h2.awards?.allNba.length, 3)
    assert.equal(h2.awards?.allNba.flat().length, 15)
  }
  // The champion is usually a good team: no champion should be below .400.
  for (const h2 of s.history) {
    const row = h2.standings.find((x) => x.teamId === h2.championTeamId)
    assert.ok(row && row.wins / (row.wins + row.losses) > 0.4, `champion won ${row?.wins}`)
  }
  // Rosters stay legal without a front office.
  for (const t of s.league.teams) {
    assert.ok(rosterOf(s, t.teamId).length >= 8, `${t.teamId} has bodies`)
  }
  assert.equal(s.season.yearEnd, 2030)
})

test('the draft seam fills picks when a prospect generator is injected, and no-ops without one', () => {
  const s0 = newGame(fixtureBundle(), 'T00', 31)
  const withGen = simSeason(s0, { ...hooks, prospects: fakeProspects }).state
  const drafted = withGen.league.players.filter((p) => p.draft?.year === s0.season.yearEnd)
  assert.equal(drafted.length, 60, 'two rounds of 30')
  assert.equal(drafted.filter((p) => p.debutYear === withGen.season.yearEnd).length, 60)

  const without = simSeason(s0, hooks).state
  assert.equal(without.league.players.length, s0.league.players.length, 'no players invented')
})
