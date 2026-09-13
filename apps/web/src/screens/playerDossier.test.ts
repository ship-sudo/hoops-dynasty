import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameSummary, PlayerAvailability } from '@hoops/game'
import type { GameLogRow } from '../sim/api.ts'
import {
  absenceMark,
  healthCopy,
  injuryFromAvail,
  lastNAverages,
  legsOf,
  logsOf,
  playoffTotals,
  recentGames,
} from './playerDossier.ts'

const fit = (): PlayerAvailability => ({
  out: 0,
  injury: null,
  condition: 1,
  sinceReturn: 99,
  missed: 0,
  lastGame: null,
})

test('a fit man reads Healthy, not a blank', () => {
  const h = healthCopy(injuryFromAvail(fit()))
  assert.equal(h.kind, 'healthy')
  assert.equal(h.chip, 'Healthy')
  assert.equal(h.headline, null)
})

test('an absence is Out with games left', () => {
  const a: PlayerAvailability = {
    ...fit(),
    out: 9,
    injury: {
      name: 'hamstring',
      severity: 'strain',
      games: 9,
      returnCondition: 0.85,
    },
  }
  const h = healthCopy(injuryFromAvail(a))
  assert.equal(h.kind, 'out')
  assert.equal(h.chip, 'Out')
  assert.match(h.headline ?? '', /hamstring/)
  assert.match(h.detail ?? '', /9 games/)
})

test('a knock he is playing through is not Healthy', () => {
  const a: PlayerAvailability = {
    ...fit(),
    out: 0,
    playingThrough: true,
    injury: {
      name: 'sprained ankle',
      severity: 'knock',
      games: 3,
      returnCondition: 0.95,
    },
  }
  const h = healthCopy(injuryFromAvail(a))
  assert.equal(h.kind, 'through')
  assert.match(h.chip, /Playing/)
})

test('legs labels follow the engine bands', () => {
  assert.equal(legsOf(1).v, 'Fresh')
  assert.equal(legsOf(0.9).v, 'Fine')
  assert.equal(legsOf(0.8).v, 'Used')
  assert.equal(legsOf(0.7).v, 'Tired')
  assert.equal(legsOf(0.5).v, 'Gassed')
})

test('recent games are the lines he played, newest first', () => {
  const logs: GameLogRow[] = [
    {
      gameId: 'g2',
      date: '2003-11-03',
      opponentTeamId: 'DAL',
      home: false,
      won: true,
      teamPts: 91,
      opponentPts: 88,
      started: true,
      line: {
        min: 36,
        pts: 22,
        fgm: 8,
        fga: 16,
        fg3m: 0,
        fg3a: 0,
        ftm: 6,
        fta: 6,
        oreb: 2,
        dreb: 8,
        ast: 3,
        stl: 1,
        blk: 2,
        tov: 1,
        pf: 2,
      },
    },
    {
      gameId: 'g1',
      date: '2003-11-01',
      opponentTeamId: 'LAL',
      home: true,
      won: true,
      teamPts: 100,
      opponentPts: 90,
      started: true,
      line: {
        min: 34,
        pts: 18,
        fgm: 7,
        fga: 15,
        fg3m: 1,
        fg3a: 3,
        ftm: 3,
        fta: 4,
        oreb: 1,
        dreb: 5,
        ast: 5,
        stl: 0,
        blk: 1,
        tov: 2,
        pf: 3,
      },
    },
  ]
  const rows = recentGames(logs, 5)
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.gameId, 'g2')
  assert.equal(rows[0]?.log?.line.pts, 22)
  assert.equal(rows[1]?.gameId, 'g1')
  const avg = lastNAverages(rows, 5)
  assert.ok(avg)
  assert.equal(avg.gp, 2)
  assert.equal(avg.pts, 20)
  assert.equal(avg.reb, 8)
  assert.equal(avg.ast, 4)
})

test('lastNAverages ignores a DNP and stops at N', () => {
  const line = (pts: number): GameLogRow['line'] => ({
    min: 30,
    pts,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 2,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  })
  const row = (id: string, pts: number, min = 30): GameLogRow => ({
    gameId: id,
    date: '2003-11-01',
    opponentTeamId: 'LAL',
    home: true,
    won: true,
    teamPts: 100,
    opponentPts: 90,
    started: true,
    line: { ...line(pts), min },
  })
  const games = recentGames([row('a', 30), row('b', 10, 0), row('c', 20), row('d', 10)])
  const avg = lastNAverages(games, 2)
  assert.ok(avg)
  assert.equal(avg.gp, 2)
  assert.equal(avg.pts, 25)
  const withFlag = recentGames([
    { ...row('hot', 40), dnp: true },
    row('ok', 10),
  ])
  const skipFlag = lastNAverages(withFlag, 5)
  assert.ok(skipFlag)
  assert.equal(skipFlag.gp, 1)
  assert.equal(skipFlag.pts, 10)
})

test('logsOf splits regular season from the playoffs', () => {
  const row = (id: string, seasonType: 'regular' | 'playin' | 'playoffs'): GameLogRow => ({
    gameId: id,
    date: '2004-04-20',
    opponentTeamId: 'LAL',
    home: true,
    won: true,
    teamPts: 100,
    opponentPts: 90,
    started: true,
    seasonType,
    line: {
      min: 30,
      pts: 10,
      fgm: 0,
      fga: 0,
      fg3m: 0,
      fg3a: 0,
      ftm: 0,
      fta: 0,
      oreb: 0,
      dreb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      pf: 0,
    },
  })
  const logs = [row('rs', 'regular'), row('po', 'playoffs'), row('pi', 'playin')]
  assert.deepEqual(
    logsOf(logs, 'regular').map((g) => g.gameId),
    ['rs'],
  )
  assert.deepEqual(
    logsOf(logs, 'postseason').map((g) => g.gameId),
    ['po', 'pi'],
  )
})

test('playoffTotals averages the postseason lines and ignores regular season', () => {
  const results: GameSummary[] = [
    {
      gameId: 'rs',
      date: '2004-04-14',
      homeTeamId: 'SAS',
      awayTeamId: 'LAL',
      homePts: 100,
      awayPts: 90,
      overtimes: 0,
      seasonType: 'regular',
      players: [{ playerId: 'manu', teamId: 'SAS', pts: 40, reb: 5, ast: 5, min: 36 }],
    },
    {
      gameId: 'g1',
      date: '2004-04-20',
      homeTeamId: 'SAS',
      awayTeamId: 'MEM',
      homePts: 98,
      awayPts: 80,
      overtimes: 0,
      seasonType: 'playoffs',
      players: [{ playerId: 'manu', teamId: 'SAS', pts: 20, reb: 4, ast: 6, min: 38 }],
    },
    {
      gameId: 'g2',
      date: '2004-04-22',
      homeTeamId: 'MEM',
      awayTeamId: 'SAS',
      homePts: 85,
      awayPts: 95,
      overtimes: 0,
      seasonType: 'playoffs',
      players: [{ playerId: 'manu', teamId: 'SAS', pts: 30, reb: 8, ast: 4, min: 40 }],
    },
  ]
  const avg = playoffTotals(results, 'manu')
  assert.ok(avg)
  assert.equal(avg.gp, 2)
  assert.equal(avg.pts, 25)
  assert.equal(avg.reb, 6)
  assert.equal(avg.ast, 5)
  assert.equal(playoffTotals(results, 'nobody'), null)
})

const missRow = (id: string, dnp: boolean, min = dnp ? 0 : 32): GameLogRow => ({
  gameId: id,
  date: '2003-11-01',
  opponentTeamId: 'LAL',
  home: true,
  won: true,
  teamPts: 100,
  opponentPts: 90,
  started: !dnp,
  dnp,
  line: {
    min,
    pts: dnp ? 0 : 12,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  },
})

test('absenceMark labels the current injury streak Out, older misses DNP', () => {
  const games = recentGames([
    missRow('miss1', true),
    missRow('miss2', true),
    missRow('played', false),
    missRow('oldBench', true),
  ])
  assert.deepEqual(absenceMark(games, true), ['out', 'out', null, 'dnp'])
  assert.deepEqual(absenceMark(games, false), ['dnp', 'dnp', null, 'dnp'])
})

test('a dressed night ends the Out streak even if he is currently injured', () => {
  const games = recentGames([missRow('played', false), missRow('miss', true)])
  assert.deepEqual(absenceMark(games, true), [null, 'dnp'])
})
