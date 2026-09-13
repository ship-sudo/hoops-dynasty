import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SeriesState } from '@hoops/game'
import {
  pathLine,
  recapFilm,
  recapFromChampion,
  seriesLeadersBeat,
  userPath,
} from './seasonRecap.ts'

const series = (
  round: number,
  bracket: SeriesState['bracket'],
  high: string,
  low: string,
  hw: number,
  lw: number,
  winner: string,
): SeriesState => ({
  round,
  bracket,
  highTeamId: high,
  lowTeamId: low,
  highWins: hw,
  lowWins: lw,
  bestOf: 7,
  winnerTeamId: winner,
  games: [],
})

test("the path is the user's series in order, not every series in the round", () => {
  const rounds: SeriesState[][] = [
    [series(0, 'West', 'SAS', 'MEM', 4, 0, 'SAS'), series(0, 'West', 'LAL', 'HOU', 4, 1, 'LAL')],
    [series(1, 'West', 'SAS', 'LAL', 4, 2, 'SAS')],
    [series(2, 'West', 'SAS', 'MIN', 4, 2, 'SAS')],
    [series(3, 'Finals', 'SAS', 'NJN', 4, 1, 'SAS')],
  ]
  const path = userPath(rounds, 'SAS')
  assert.equal(path.length, 4)
  assert.equal(path[0]?.lowTeamId, 'MEM')
  assert.equal(path.at(-1)?.bracket, 'Finals')
  assert.equal(userPath(rounds, 'LAL').length, 2)
})

test('the run reads as a broadcast line', () => {
  const path = [
    series(0, 'West', 'SAS', 'MEM', 4, 0, 'SAS'),
    series(3, 'Finals', 'SAS', 'NJN', 4, 1, 'SAS'),
  ]
  const line = pathLine(path, 'SAS', (id) => (id === 'MEM' ? 'Grizzlies' : 'Nets'), 3)
  assert.match(line, /beat the Grizzlies 4–0/)
  assert.match(line, /beat the Nets 4–1/)
  assert.match(line, /The Finals/)
})

test('the interrupt lockup names the champion before the save catches up', () => {
  const film = recapFromChampion({
    yearEnd: 2004,
    yours: 'won',
    champion: { teamId: 'SAS', city: 'San Antonio', name: 'Spurs', abbr: 'SAS' },
    runner: { teamId: 'NJN', city: 'New Jersey', name: 'Nets', abbr: 'NJN' },
    champWins: 4,
    runnerWins: 1,
    finalsMvpName: 'Tim Duncan',
  })
  assert.equal(film.championAbbr, 'SAS')
  assert.equal(film.runnerAbbr, 'NJN')
  assert.equal(film.beats[0]?.v, 'Spurs 4–1 Nets')
  assert.equal(film.beats[1]?.k, 'Finals MVP')
  assert.equal(film.beats[1]?.v, 'Tim Duncan')
})

const winner = (name: string, playerId: string, teamId: string, award: string, score: number) => ({
  award,
  playerId,
  name,
  teamId,
  score,
})

test('one man leading the series is named once, with the three rates', () => {
  const beat = seriesLeadersBeat({
    pts: winner('Duncan', 'd', 'SAS', 'Finals PTS', 24.2),
    reb: winner('Duncan', 'd', 'SAS', 'Finals REB', 12.1),
    ast: winner('Duncan', 'd', 'SAS', 'Finals AST', 4.0),
  })
  assert.equal(beat?.v, 'Duncan')
  assert.match(beat?.note ?? '', /24.2 pts/)
})

test('split series leaders are named by what they led', () => {
  const beat = seriesLeadersBeat({
    pts: winner('Parker', 'p', 'SAS', 'Finals PTS', 22.4),
    reb: winner('Duncan', 'd', 'SAS', 'Finals REB', 12.1),
    ast: winner('Ginobili', 'g', 'SAS', 'Finals AST', 5.2),
  })
  assert.equal(beat?.v, 'Parker scored · Duncan rebounded · Ginobili passed')
})

test('the recap names Finals MVP and series leaders, not regular-season scoring', () => {
  const game = {
    userTeamId: 'SAS',
    season: { yearEnd: 2004, rules: { playoffs: { teams: 16 } } },
    league: {
      teams: [
        { teamId: 'SAS', city: 'San Antonio', name: 'Spurs', abbr: 'SAS', conference: 'West' },
        { teamId: 'NJN', city: 'New Jersey', name: 'Nets', abbr: 'NJN', conference: 'East' },
      ],
      players: [],
    },
    records: {
      SAS: { wins: 57, losses: 25 },
    },
    awards: {
      mvp: winner('Kevin Garnett', 'kg', 'MIN', 'mvp', 1),
      allNba: [],
      finalsMvp: winner('Tim Duncan', 'td', 'SAS', 'Finals MVP', 90),
      finalsLeaders: {
        pts: winner('Tim Duncan', 'td', 'SAS', 'Finals PTS', 24.2),
        reb: winner('Tim Duncan', 'td', 'SAS', 'Finals REB', 12.1),
        ast: winner('Tony Parker', 'tp', 'SAS', 'Finals AST', 6.4),
      },
    },
    stats: {
      fake: { teamId: 'SAS', gp: 82, pts: 2000, oreb: 0, dreb: 0, ast: 0 },
    },
    playoffs: {
      seeds: { East: ['NJN'], West: ['SAS'] },
      championTeamId: 'SAS',
      runnerUpTeamId: 'NJN',
      rounds: [
        [
          {
            round: 3,
            bracket: 'Finals',
            highTeamId: 'SAS',
            lowTeamId: 'NJN',
            highWins: 4,
            lowWins: 1,
            winnerTeamId: 'SAS',
          },
        ],
      ],
    },
  }
  const film = recapFilm(game as never)
  assert.ok(film)
  const keys = film.beats.map((b) => b.k)
  assert.ok(keys.includes('Finals MVP'))
  assert.ok(keys.includes('In the series'))
  assert.ok(!keys.includes('The floor'))
  assert.equal(film.beats.find((b) => b.k === 'Finals MVP')?.v, 'Tim Duncan')
  assert.match(film.beats.find((b) => b.k === 'In the series')?.v ?? '', /Parker passed/)
})
