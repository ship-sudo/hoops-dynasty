import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  champion,
  checkBracket,
  deriveSeries,
  type PlayoffGame,
  playoffSeeds,
  runnerUp,
} from './playoffs.ts'

let n = 0
const game = (date: string, home: string, away: string, hp: number, ap: number): PlayoffGame => ({
  gameId: `g${String(++n).padStart(3, '0')}`,
  date,
  homeTeamId: home,
  awayTeamId: away,
  homePts: hp,
  awayPts: ap,
})

/** Four teams: A (1 seed) v D (4 seed), B (2) v C (3); A beats D 3-1, C upsets B 3-2; C beats A 4-1. */
function fixture(): PlayoffGame[] {
  return [
    game('2000-04-22', 'A', 'D', 100, 90),
    game('2000-04-22', 'B', 'C', 100, 90),
    game('2000-04-24', 'A', 'D', 100, 90),
    game('2000-04-24', 'B', 'C', 90, 100),
    game('2000-04-27', 'D', 'A', 100, 90),
    game('2000-04-27', 'C', 'B', 100, 90),
    game('2000-04-29', 'D', 'A', 90, 100),
    game('2000-04-29', 'C', 'B', 90, 100),
    game('2000-05-02', 'B', 'C', 90, 100),
    game('2000-05-06', 'A', 'C', 100, 90),
    game('2000-05-08', 'A', 'C', 90, 100),
    game('2000-05-11', 'C', 'A', 100, 90),
    game('2000-05-13', 'C', 'A', 100, 90),
    game('2000-05-16', 'A', 'C', 90, 100),
  ]
}

test('series, rounds, wins, high seed and champion from game results', () => {
  const series = deriveSeries(fixture()).sort(
    (a, b) => a.round - b.round || (a.highTeamId < b.highTeamId ? -1 : 1),
  )
  assert.deepEqual(
    series.map((s) => [s.round, s.highTeamId, s.lowTeamId, s.winnerTeamId, s.highWins, s.lowWins]),
    [
      [1, 'A', 'D', 'A', 3, 1],
      [1, 'B', 'C', 'C', 2, 3],
      [2, 'A', 'C', 'C', 1, 4],
    ],
  )
  assert.equal(champion(series), null) // no round 4 in a 4-team bracket
  const finals = { ...(series[2] as (typeof series)[number]), round: 4 }
  assert.equal(champion([finals]), 'C')
  assert.equal(runnerUp([finals]), 'A')
})

test('checkBracket wants 8/4/2/1 and the right series lengths', () => {
  const problems = checkBracket(deriveSeries(fixture()))
  assert.ok(problems.some((p) => p.includes('round 1: 2 series')))
  assert.ok(problems.some((p) => p.includes('3 series, want 15')))
})

test('round mismatch throws', () => {
  const bad = [
    game('2000-04-22', 'A', 'B', 100, 90),
    game('2000-04-24', 'A', 'B', 100, 90),
    game('2000-04-26', 'A', 'B', 100, 90),
    game('2000-04-28', 'A', 'B', 100, 90),
    game('2000-05-01', 'A', 'C', 100, 90), // A's second series against a team on its first
  ]
  assert.throws(() => deriveSeries(bad), /round mismatch/)
})

test('seeds: rank order for 1-6, bracket decides 7 and 8', () => {
  // East: ranks 1..10; rank 8 beat rank 7 in the play-in, so rank 8 is the 7 seed (meets the 2 seed).
  const teams = Array.from({ length: 10 }, (_, i) => ({
    teamId: `E${i + 1}`,
    conference: 'East',
    confRank: i + 1,
  }))
  const round1 = [
    ['E1', 'E9'],
    ['E2', 'E8'],
    ['E3', 'E6'],
    ['E4', 'E5'],
  ].map(([h, l]) => ({
    round: 1,
    highTeamId: h as string,
    lowTeamId: l as string,
    winnerTeamId: h as string,
    highWins: 4,
    lowWins: 0,
    firstDate: '2023-04-15',
  }))
  const seeds = playoffSeeds(teams, round1)
  assert.equal(seeds.get('E1'), 1)
  assert.equal(seeds.get('E6'), 6)
  assert.equal(seeds.get('E8'), 7)
  assert.equal(seeds.get('E9'), 8)
  assert.equal(seeds.get('E7'), null)
  assert.equal(seeds.get('E10'), null)
})
