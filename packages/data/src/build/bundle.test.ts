import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlayerRecord, SeasonBundle } from '@hoops/core'
import { flatRatings, tendenciesFromStats } from '@hoops/ratings'
import {
  ageOn,
  type CareerIndex,
  statsFromStints,
  toPosition,
  validateBundle,
  yearsProOf,
  yearsWithTeamOf,
} from './bundle.ts'

function player(id: string, teamId: string): PlayerRecord {
  return {
    playerId: id,
    brefId: null,
    name: id,
    birthDate: null,
    age: 25,
    heightIn: 78,
    weightLb: 210,
    pos: 'SF',
    draft: null,
    yearsPro: 2,
    yearsWithTeam: 0,
    teamId,
    contract: null,
    ratings: flatRatings(50),
    tendencies: tendenciesFromStats(null),
    real: null,
    realMpg: 0,
  }
}

function bundle(): SeasonBundle {
  const teams = ['A', 'B', 'C', 'D'].map((id) => ({
    teamId: id,
    abbr: id,
    name: id,
    city: id,
    conference: 'East' as const,
    division: 'X',
    real: { wins: 1, losses: 1, playoffSeed: null },
  }))
  const players: PlayerRecord[] = []
  for (const t of teams)
    for (let i = 0; i < 13; i++) players.push(player(`${t.teamId}${i}`, t.teamId))
  const schedule: SeasonBundle['schedule'] = []
  let n = 0
  for (const h of teams)
    for (const a of teams)
      if (h !== a)
        schedule.push({
          gameId: `g${n++}`,
          date: '2000-01-01',
          homeTeamId: h.teamId,
          awayTeamId: a.teamId,
          seasonType: 'regular',
          real: { homePts: 100, awayPts: 90 },
        })
  return {
    yearEnd: 2000,
    seasonId: '1999-00',
    era: {
      yearEnd: 2000,
      pace: 90,
      ortg: 100,
      threePAr: 0.2,
      ftr: 0.3,
      tovPct: 15,
      orbPct: 0.3,
      fg3Pct: 0.35,
      fg2Pct: 0.47,
      ftPct: 0.75,
      astPct: 0.6,
      stlPer100: 8,
      blkPer100: 5,
      pfPer100: 22,
      zoneShare: { rim: 0.3, close: 0.2, mid: 0.3, three: 0.2 },
      zonePct: { rim: 0.6, close: 0.4, mid: 0.4, three: 0.35 },
      homeWinPct: 0.6,
      handCheckBanned: false,
      zoneLegal: false,
    },
    rules: {},
    teams,
    players,
    schedule,
    real: { stints: [], playoffs: [], awards: [], draft: [] },
  }
}

test('a well-formed bundle validates; 6 games per team over 4 teams', () => {
  assert.deepEqual(validateBundle(bundle(), 6), [])
})

test('validation catches roster size, schedule count, unknown teams and NaN', () => {
  const b = bundle()
  b.players = b.players.filter((p) => p.teamId !== 'A' || p.playerId < 'A5')
  b.players.push(player('zz', 'Z'))
  b.schedule.pop()
  b.era.pace = Number.NaN
  const problems = validateBundle(b, 6)
  assert.ok(problems.some((p) => p.startsWith('A has')))
  assert.ok(problems.some((p) => p.includes('unknown team Z')))
  assert.ok(problems.some((p) => p.includes('schedule has 11')))
  assert.ok(problems.some((p) => p.includes('NaN at bundle.era.pace')))
  assert.deepEqual(validateBundle(bundle(), 82, 12), [])
})

test('toPosition: bref codes pass through, NBA strings split by height', () => {
  assert.equal(toPosition('PG', 80), 'PG')
  assert.equal(toPosition('G', 74), 'PG')
  assert.equal(toPosition('G', 77), 'SG')
  assert.equal(toPosition('G-F', 78), 'SG')
  assert.equal(toPosition('F-G', 79), 'SF')
  assert.equal(toPosition('F', 79), 'SF')
  assert.equal(toPosition('F', 82), 'PF')
  assert.equal(toPosition('F-C', 82), 'PF')
  assert.equal(toPosition('C-F', 84), 'C')
  assert.equal(toPosition(null, 85), 'C')
  assert.equal(toPosition(null, 73), 'PG')
})

test('ageOn counts whole years', () => {
  assert.equal(ageOn('1963-02-17', '1997-10-31'), 34)
  assert.equal(ageOn('1984-12-30', '2003-10-28'), 18)
  assert.equal(ageOn('1984-10-28', '2003-10-28'), 19)
  assert.equal(ageOn(null, '2003-10-28'), null)
})

test('statsFromStints sums stints and reads the season-level lines', () => {
  const row = (team: string, stint: number, gp: number, pts: number) => ({
    year_end: 2016,
    player_id: 'p',
    team_id: team,
    stint,
    age: 25,
    pos: 'SG',
    years_pro: 3,
    gp,
    gs: 40,
    min: gp * 30,
    totals_json: JSON.stringify({
      fgm: pts / 2,
      fga: pts,
      fg3m: 10,
      fg3a: 30,
      ftm: 0,
      fta: 0,
      oreb: 10,
      dreb: 40,
      ast: 50,
      tov: 20,
      stl: 5,
      blk: 5,
      pf: 30,
      pts,
    }),
    per100_json: JSON.stringify({
      fgm: 10,
      fga: 20,
      fg3m: 2,
      fg3a: 6,
      ftm: 4,
      fta: 5,
      oreb: 1,
      dreb: 5,
      ast: 6,
      tov: 3,
      stl: 1,
      blk: 1,
      pf: 3,
      pts: 26,
    }),
    advanced_json: JSON.stringify({
      off_rating: 110,
      def_rating: 105,
      ast_pct: 0.25,
      oreb_pct: 0.03,
      dreb_pct: 0.15,
      tm_tov_pct: 12.5,
      usg_pct: 0.28,
      bref: { per: 20, stl_pct: 1.5, blk_pct: 0.5, ws_48: 0.15, obpm: 2, dbpm: 1, bpm: 3 },
    }),
    shooting_json: JSON.stringify({ avgDist: 12.5, share3p: 0.3 }),
    pbp_json: JSON.stringify({ and1: 12 }),
  })
  const s = statsFromStints([row('A', 1, 40, 400), row('B', 2, 20, 200)])
  assert.ok(s)
  assert.equal(s.gp, 60)
  assert.equal(s.gs, 40)
  assert.equal(s.min, 1800)
  assert.equal(s.totals.pts, 600)
  assert.equal(s.totals.ast, 100)
  assert.equal(s.per100.pts, 26)
  assert.equal(s.pct.fg, 0.5)
  assert.equal(s.pct.fg3, 20 / 60)
  assert.equal(s.pct.ft, null)
  assert.equal(s.adv.usg, 28)
  assert.equal(s.adv.tovPct, 12.5)
  assert.equal(s.adv.stlPct, 1.5)
  assert.equal(s.adv.per, 20)
  assert.equal(s.adv.ws48, 0.15)
  assert.equal(s.shooting?.avgDist, 12.5)
  assert.equal(s.pbp?.and1, 12)
  assert.equal(statsFromStints([row('A', 1, 0, 0)]), null)
})

test('yearsPro and yearsWithTeam from the career index', () => {
  const idx: CareerIndex = {
    byPlayer: new Map([
      [
        'p',
        [
          { yearEnd: 1998, lastTeam: 'A', gp: 50 },
          { yearEnd: 1999, lastTeam: 'A', gp: 0 },
          { yearEnd: 2000, lastTeam: 'B', gp: 70 },
          { yearEnd: 2001, lastTeam: 'B', gp: 70 },
        ],
      ],
    ]),
  }
  assert.equal(yearsProOf(idx, 'p', 2002, 1995, 1998), 3 + 3)
  assert.equal(yearsProOf(idx, 'p', 2002, 1998, 1998), 3)
  assert.equal(yearsProOf(idx, 'p', 2002, null, 1998), 3)
  assert.equal(yearsWithTeamOf(idx, 'p', 2002, 'B'), 2)
  assert.equal(yearsWithTeamOf(idx, 'p', 2002, 'A'), 0)
  assert.equal(yearsWithTeamOf(idx, 'p', 2000, 'A'), 2)
  assert.equal(yearsWithTeamOf(idx, 'q', 2000, 'A'), 0)
})
