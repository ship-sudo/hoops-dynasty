import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AwardWinner, GameState, SeasonAwards } from '@hoops/game'
import {
  honorsOf,
  pictureRows,
  playoffCuts,
  wrapBand,
  wrapFate,
  wrapFromGame,
} from './seasonWrap.ts'

const winner = (name: string, teamId: string, award: string): AwardWinner => ({
  award,
  playerId: name,
  name,
  teamId,
  score: 1,
})

test('the play-in era cuts six in and ten in the tournament', () => {
  assert.deepEqual(playoffCuts('none'), { inCut: 8, playCut: 8 })
  assert.deepEqual(playoffCuts('seeds_7_to_10'), { inCut: 6, playCut: 10 })
  assert.deepEqual(playoffCuts('bubble_8_v_9'), { inCut: 7, playCut: 9 })
})

test('fate is past tense and names the seed, not a forecast', () => {
  assert.match(wrapFate(3, 'West', 'none', 3), /3rd seed in the West/)
  assert.match(wrapFate(8, 'East', 'seeds_7_to_10', null), /Play-in next/)
  assert.match(wrapFate(12, 'East', 'seeds_7_to_10', null), /Missed the playoffs/)
  assert.equal(wrapBand(6, 'seeds_7_to_10'), 'in')
  assert.equal(wrapBand(7, 'seeds_7_to_10'), 'playin')
  assert.equal(wrapBand(11, 'seeds_7_to_10'), 'out')
})

test("honors only list the manager's own players", () => {
  const awards: SeasonAwards = {
    mvp: winner('Duncan', 'SAS', 'mvp'),
    roy: winner('James', 'CLE', 'roy'),
    dpoy: winner('Wallace', 'DET', 'dpoy'),
    allNba: [
      [winner('Duncan', 'SAS', 'allnba'), winner('Garnett', 'MIN', 'allnba')],
      [winner('Parker', 'SAS', 'allnba')],
    ],
  }
  const ours = honorsOf(awards, 'SAS')
  assert.deepEqual(
    ours.map((h) => h.name),
    ['Duncan', 'Duncan', 'Parker'],
  )
  assert.equal(ours[0]?.label, 'MVP')
  assert.equal(ours[1]?.label, 'All-NBA first team')
  assert.equal(ours[2]?.label, 'All-NBA second team')
  assert.equal(honorsOf(awards, 'LAL').length, 0)

  const withFmvp: SeasonAwards = {
    ...awards,
    finalsMvp: winner('Parker', 'SAS', 'fmvp'),
  }
  assert.equal(honorsOf(withFmvp, 'SAS').at(-1)?.label, 'Finals MVP')
})

test('the picture draws the playoff and lottery lines where the era puts them', () => {
  const order = Array.from({ length: 12 }, (_, i) => ({
    teamId: `T${i + 1}`,
    wins: 50 - i,
    losses: 32 + i,
  }))
  const rows = pictureRows(order, 'T8', 'seeds_7_to_10')
  assert.equal(rows.length, 12)
  assert.equal(rows[5]?.cut, 'Play-in')
  assert.equal(rows[9]?.cut, 'Lottery')
  assert.equal(rows[7]?.mine, true)
  assert.equal(rows[7]?.band, 'playin')
})

function rec(id: string, w: number, l: number) {
  return {
    teamId: id,
    wins: w,
    losses: l,
    pf: 0,
    pa: 0,
    divW: 0,
    divL: 0,
    confW: 0,
    confL: 0,
    h2h: {},
  }
}

function club(id: string, conf: 'East' | 'West', div: string, city: string, name: string) {
  return { teamId: id, abbr: id, name, city, conference: conf, division: div }
}

test('the wrap names the record, the seed, and the MVP', () => {
  const west = [
    club('SAS', 'West', 'Midwest', 'San Antonio', 'Spurs'),
    club('MIN', 'West', 'Midwest', 'Minnesota', 'Timberwolves'),
    club('LAL', 'West', 'Pacific', 'Los Angeles', 'Lakers'),
    club('SAC', 'West', 'Pacific', 'Sacramento', 'Kings'),
  ]
  const east = [
    club('DET', 'East', 'Central', 'Detroit', 'Pistons'),
    club('IND', 'East', 'Central', 'Indiana', 'Pacers'),
    club('BOS', 'East', 'Atlantic', 'Boston', 'Celtics'),
    club('MIA', 'East', 'Atlantic', 'Miami', 'Heat'),
  ]
  const game = {
    seed: 1,
    userTeamId: 'SAS',
    phase: 'playoffs',
    season: {
      yearEnd: 2004,
      seasonId: '2003-04',
      rules: { playoffs: { teams: 16, play_in: 'none' } },
    },
    league: { teams: [...west, ...east] },
    records: {
      SAS: rec('SAS', 57, 25),
      MIN: rec('MIN', 51, 31),
      LAL: rec('LAL', 56, 26),
      SAC: rec('SAC', 50, 32),
      DET: rec('DET', 54, 28),
      IND: rec('IND', 61, 21),
      BOS: rec('BOS', 36, 46),
      MIA: rec('MIA', 42, 40),
    },
    awards: {
      mvp: winner('Kevin Garnett', 'MIN', 'mvp'),
      roy: winner('LeBron James', 'CLE', 'roy'),
      dpoy: winner('Ron Artest', 'IND', 'dpoy'),
      allNba: [[winner('Tim Duncan', 'SAS', 'allnba'), winner('Kevin Garnett', 'MIN', 'allnba')]],
    },
    playoffs: {
      seeds: { East: ['IND', 'DET', 'MIA', 'BOS'], West: ['SAS', 'LAL', 'MIN', 'SAC'] },
      rounds: [[{ highTeamId: 'SAS', lowTeamId: 'SAC' }]],
      championTeamId: null,
      runnerUpTeamId: null,
    },
  } as unknown as GameState

  const wrap = wrapFromGame(game)
  assert.ok(wrap)
  assert.equal(wrap.yours.wins, 57)
  assert.equal(wrap.yours.losses, 25)
  assert.equal(wrap.yours.place, 1)
  assert.equal(wrap.yours.seed, 1)
  assert.equal(wrap.yours.band, 'in')
  assert.match(wrap.yours.fate, /1st seed/)
  assert.equal(wrap.awards[0]?.winner?.name, 'Kevin Garnett')
  assert.equal(wrap.honors[0]?.name, 'Tim Duncan')
  assert.equal(wrap.finalsMvp, null)
  assert.equal(wrap.hasBracket, true)
  assert.equal(wrap.playIn, false)
})
