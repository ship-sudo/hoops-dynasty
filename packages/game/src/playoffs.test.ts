import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { homePattern, startPlayoffs } from './playoffs.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, SeriesState } from './state.ts'
import { emptyRecord } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

/** A state with a made-up final standings table and nothing played. */
function standings(state: GameState, wins: Record<string, number>): GameState {
  const games = state.season.rules.games
  const records = Object.fromEntries(
    state.league.teams.map((t) => {
      const r = emptyRecord(t.teamId)
      r.wins = wins[t.teamId] ?? 41
      r.losses = games - r.wins
      r.pf = 100 * games
      r.pa = 100 * games
      return [t.teamId, r]
    }),
  )
  return { ...state, records }
}

test('the first round pairs 1v8, 2v7, 3v6, 4v5 in both conferences', () => {
  const s = standings(newGame(fixtureBundle({ seeding: 'record' }), 'T00', 1), {})
  const po = startPlayoffs(s)
  assert.equal(po.rounds[0]?.length, 8)
  for (const conf of ['East', 'West'] as const) {
    const seeds = po.seeds[conf]
    assert.equal(seeds.length, 8)
    const series: SeriesState[] = (po.rounds[0] as SeriesState[]).filter((x) => x.bracket === conf)
    assert.equal(series.length, 4)
    series.forEach((x, i) => {
      assert.equal(x.highTeamId, seeds[i], `${conf} series ${i} high seed`)
      assert.equal(x.lowTeamId, seeds[7 - i], `${conf} series ${i} low seed`)
    })
  }
})

test('the bracket is fixed, not reseeded', () => {
  const s = standings(newGame(fixtureBundle(), 'T00', 1), {})
  const st = { ...s, playoffs: startPlayoffs(s), phase: 'playoffs' as const }
  const r = simRestOfSeason(st, hooks)
  const po = r.state.playoffs
  assert.ok(po)
  assert.deepEqual(
    po.rounds.map((x) => x.length),
    [8, 4, 2, 1],
    'eight series, then four, two, one',
  )
  // Round 2 in each conference must pair the 1/8 winner with the 4/5 winner.
  const r1 = po.rounds[0] as SeriesState[]
  const r2 = po.rounds[1] as SeriesState[]
  const east1 = r1.filter((x) => x.bracket === 'East')
  const pair = r2.find(
    (x) =>
      x.bracket === 'East' &&
      [east1[0]?.winnerTeamId, east1[3]?.winnerTeamId].includes(x.highTeamId),
  )
  assert.ok(pair, '1v8 winner meets 4v5 winner')
  assert.ok([east1[0]?.winnerTeamId, east1[3]?.winnerTeamId].includes(pair.lowTeamId))
  assert.ok(po.championTeamId)
  assert.notEqual(po.championTeamId, po.runnerUpTeamId)
})

test('home court patterns are era-correct', () => {
  const mk = (yearEnd: number, bestOf: 5 | 7, bracket: 'East' | 'Finals'): boolean[] => {
    const s = newGame(fixtureBundle({ yearEnd }), 'T00', 1)
    const series: SeriesState = {
      round: 0,
      bracket,
      highTeamId: 'T00',
      lowTeamId: 'T01',
      highWins: 0,
      lowWins: 0,
      bestOf,
      winnerTeamId: null,
      games: [],
    }
    return homePattern(s, series)
  }
  assert.deepEqual(mk(2000, 5, 'East'), [true, true, false, false, true], 'best of five is 2-2-1')
  assert.deepEqual(mk(2010, 7, 'East'), [true, true, false, false, true, false, true], '2-2-1-1-1')
  assert.deepEqual(
    mk(2010, 7, 'Finals'),
    [true, true, false, false, false, true, true],
    'Finals 2-3-2 to 2013',
  )
  assert.deepEqual(
    mk(2014, 7, 'Finals'),
    [true, true, false, false, true, false, true],
    'Finals 2-2-1-1-1 from 2014',
  )
})

test('a best-of-five first round ends in three to five games', () => {
  const s = standings(newGame(fixtureBundle({ firstRoundGames: 5 }), 'T00', 4), {})
  const st = { ...s, playoffs: startPlayoffs(s), phase: 'playoffs' as const }
  const r = simRestOfSeason(st, hooks)
  for (const x of (r.state.playoffs?.rounds[0] ?? []) as SeriesState[]) {
    assert.ok(x.games.length >= 3 && x.games.length <= 5, `first round went ${x.games.length}`)
    assert.equal(Math.max(x.highWins, x.lowWins), 3)
  }
  for (const round of (r.state.playoffs?.rounds ?? []).slice(1)) {
    for (const x of round)
      assert.equal(Math.max(x.highWins, x.lowWins), 4, 'later rounds are best of seven')
  }
})

test('no play-in before 2020-21', () => {
  const s = newGame(fixtureBundle({ yearEnd: 2019, playIn: 'none' }), 'T00', 1)
  const r = simRestOfSeason(standings(s, {}), hooks)
  assert.equal(r.state.playIn, null)
  assert.equal(r.results.filter((g) => g.seasonType === 'playin').length, 0)
})

test('the 7-to-10 play-in decides seeds 7 and 8 only', () => {
  const bundle = fixtureBundle({ yearEnd: 2021, playIn: 'seeds_7_to_10' })
  const s = newGame(bundle, 'T00', 2)
  const seeded = standings(s, {})
  const r = simRestOfSeason(
    { ...seeded, phase: 'playin', playIn: { games: [], day: 0, done: false } },
    hooks,
  )
  const playin = r.results.filter((g) => g.seasonType === 'playin')
  assert.equal(playin.length, 6, 'three games per conference')
  const po = r.state.playoffs
  assert.ok(po)
  for (const conf of ['East', 'West'] as const) {
    assert.equal(po.seeds[conf].length, 8)
    // Seeds 7 and 8 must have come through the play-in games.
    const ids = new Set(playin.flatMap((g) => [g.homeTeamId, g.awayTeamId]))
    assert.ok(ids.has(po.seeds[conf][6] as string) || ids.has(po.seeds[conf][7] as string))
  }
  assert.ok(r.state.playoffs?.championTeamId)
})

test('the 2020 bubble play-in only happens when the 9 seed is close', () => {
  const bundle = fixtureBundle({ yearEnd: 2020, playIn: 'bubble_8_v_9' })
  const base = newGame(bundle, 'T00', 3)
  const east = base.league.teams.filter((t) => t.conference === 'East').map((t) => t.teamId)
  const far: Record<string, number> = {}
  east.forEach((id, i) => {
    far[id] = i < 8 ? 60 - i : 20 // the 9th seed is miles back of the 8th
  })
  const s1 = simRestOfSeason(
    { ...standings(base, far), phase: 'playin', playIn: { games: [], day: 0, done: false } },
    hooks,
  )
  const eastPlayIn = s1.results.filter(
    (g) => g.seasonType === 'playin' && east.includes(g.homeTeamId),
  )
  assert.equal(eastPlayIn.length, 0, 'a ten-game gap means no play-in')

  const close: Record<string, number> = {}
  east.forEach((id, i) => {
    close[id] = 50 - i
  })
  const s2 = simRestOfSeason(
    { ...standings(base, close), phase: 'playin', playIn: { games: [], day: 0, done: false } },
    hooks,
  )
  const played = s2.results.filter((g) => g.seasonType === 'playin' && east.includes(g.homeTeamId))
  assert.ok(played.length >= 1 && played.length <= 2, 'one or two games, 9 seed must win both')
})
