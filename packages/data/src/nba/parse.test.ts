import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseNba, seasonId } from './client.ts'
import { resultRows } from './endpoints.ts'
import {
  birthDateIso,
  experienceYears,
  heightToInches,
  int,
  mapAllPlayer,
  mapDraftPick,
  mapPlayerAdvanced,
  mapPlayerBase,
  mapPlayerBio,
  mapPlayerGame,
  mapRosterPlayer,
  mapStanding,
  mapTeamAdvanced,
  mapTeamGame,
  mapTeamTotals,
  matchupSide,
  num,
  str,
} from './parse.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Fixture rows: real cached responses cut to a few rows, parsed like the client does. */
function fixture(name: string, set: string) {
  const body = readFileSync(path.join(here, 'fixtures', `${name}.json`), 'utf8')
  return resultRows(parseNba(body), set)
}

test('seasonId edge cases', () => {
  assert.equal(seasonId(1998), '1997-98')
  assert.equal(seasonId(1999), '1998-99')
  assert.equal(seasonId(2000), '1999-00')
  assert.equal(seasonId(2001), '2000-01')
  assert.equal(seasonId(2010), '2009-10')
  assert.equal(seasonId(2026), '2025-26')
})

test('cell helpers', () => {
  assert.equal(num('209'), 209)
  assert.equal(num(0.55), 0.55)
  assert.equal(num(''), null)
  assert.equal(num(null), null)
  assert.equal(num('Undrafted'), null)
  assert.equal(int('17'), 17)
  assert.equal(int(2.9), 2)
  assert.equal(str('  '), null)
  assert.equal(str(' G-F '), 'G-F')
})

test('height string to inches', () => {
  assert.equal(heightToInches('6-5'), 77)
  assert.equal(heightToInches('7-0'), 84)
  assert.equal(heightToInches('5-11'), 71)
  assert.equal(heightToInches(`6'5"`), 77)
  assert.equal(heightToInches(''), null)
  assert.equal(heightToInches(null), null)
  assert.equal(heightToInches('tall'), null)
})

test('birth date and experience', () => {
  assert.equal(birthDateIso('APR 25, 1976'), '1976-04-25')
  assert.equal(birthDateIso('OCT 08, 1971'), '1971-10-08')
  assert.equal(birthDateIso('Jan 1, 2000'), '2000-01-01')
  assert.equal(birthDateIso(''), null)
  assert.equal(birthDateIso('1976-04-25'), null)
  assert.equal(experienceYears('R'), 0)
  assert.equal(experienceYears('7'), 7)
  assert.equal(experienceYears(null), null)
})

test('matchup side', () => {
  assert.deepEqual(matchupSide('HOU @ DEN'), { home: false, opponent: 'DEN' })
  assert.deepEqual(matchupSide('GSW vs. MEM'), { home: true, opponent: 'MEM' })
  assert.deepEqual(matchupSide(null), { home: true, opponent: null })
})

test('playerBio fixture: numbers, undrafted → null', () => {
  const rows = fixture('bio_1998', 'LeagueDashPlayerBioStats').map((r) => mapPlayerBio(r, 1998))
  assert.equal(rows.length, 3)
  const green = rows[0]
  assert.equal(green?.player_id, 920)
  assert.equal(green?.player_name, 'A.C. Green')
  assert.equal(green?.season, 1998)
  assert.equal(green?.team_abbr, 'DAL')
  assert.equal(green?.height, '6-9')
  assert.equal(green?.height_in, 81)
  assert.equal(green?.weight, 225)
  assert.equal(green?.draft_year, 1985)
  assert.equal(green?.draft_round, 1)
  assert.equal(green?.draft_number, 23)
  assert.equal(green?.ts_pct, 0.496)
  const undrafted = rows[2]
  assert.equal(undrafted?.player_name, 'Aaron Williams')
  assert.equal(undrafted?.draft_year, null)
  assert.equal(undrafted?.draft_round, null)
  assert.equal(undrafted?.draft_number, null)
})

test('playerPer100 and totals fixtures', () => {
  const per100 = fixture('per100_1998', 'LeagueDashPlayerStats').map((r) =>
    mapPlayerBase(r, 1998, 'regular'),
  )
  assert.equal(per100.length, 3)
  assert.equal(per100[0]?.player_name, 'A.C. Green')
  assert.equal(per100[0]?.season_type, 'regular')
  assert.equal(per100[0]?.gp, 82)
  assert.equal(per100[0]?.pts, 12)
  assert.equal(per100[0]?.plus_minus, -7.6)
  assert.equal(typeof per100[0]?.fg_pct, 'number')
  assert.ok(!('GP_RANK' in (per100[0] ?? {})), 'rank columns dropped')

  const totals = fixture('totals_1998', 'LeagueDashPlayerStats').map((r) =>
    mapPlayerBase(r, 1998, 'regular'),
  )
  assert.equal(totals[0]?.player_id, 920)
  assert.ok((totals[0]?.pts ?? 0) > 100, 'totals are season sums')

  const po = fixture('totals_po_1998', 'LeagueDashPlayerStats').map((r) =>
    mapPlayerBase(r, 1998, 'playoffs'),
  )
  assert.equal(po.length, 2)
  assert.equal(po[0]?.season_type, 'playoffs')
})

test('playerAdvanced fixture', () => {
  const rows = fixture('advanced_1998', 'LeagueDashPlayerStats').map((r) =>
    mapPlayerAdvanced(r, 1998),
  )
  assert.equal(rows.length, 3)
  assert.equal(rows[0]?.player_name, 'A.C. Green')
  assert.equal(rows[0]?.off_rating, 98)
  assert.equal(rows[0]?.def_rating, 105.3)
  assert.equal(rows[0]?.usg_pct, 0.116)
  assert.equal(rows[0]?.pace, 90.97)
  assert.equal(rows[0]?.poss, 5007)
})

test('team totals and advanced fixtures', () => {
  const tot = fixture('team_totals_1998', 'LeagueDashTeamStats').map((r) =>
    mapTeamTotals(r, 1998, 'regular'),
  )
  assert.equal(tot.length, 3)
  assert.equal(tot[0]?.team_id, 1610612737)
  assert.equal(tot[0]?.team_name, 'Atlanta Hawks')
  assert.equal(tot[0]?.gp, 82)
  assert.equal(tot[0]?.w, 50)
  assert.equal(tot[0]?.pts, 7860)
  const po = fixture('team_totals_po_1998', 'LeagueDashTeamStats').map((r) =>
    mapTeamTotals(r, 1998, 'playoffs'),
  )
  assert.equal(po[0]?.season_type, 'playoffs')
  assert.ok((po[0]?.gp ?? 99) < 30)

  const adv = fixture('team_advanced_1998', 'LeagueDashTeamStats').map((r) =>
    mapTeamAdvanced(r, 1998),
  )
  assert.equal(adv[0]?.team_name, 'Atlanta Hawks')
  assert.equal(typeof adv[0]?.off_rating, 'number')
  assert.equal(typeof adv[0]?.pace, 'number')
  assert.ok((adv[0]?.poss ?? 0) > 5000)
})

test('teamGames fixture: home/away and season_type', () => {
  const rs = fixture('team_games_1998', 'LeagueGameLog').map((r) => mapTeamGame(r, 1998, 'regular'))
  assert.equal(rs.length, 4)
  const hou = rs[0]
  assert.equal(hou?.game_id, '0029701185')
  assert.equal(hou?.game_date, '1998-04-19')
  assert.equal(hou?.season_id, '21997')
  assert.equal(hou?.home, true)
  assert.equal(hou?.opponent_abbr, 'PHX')
  assert.equal(hou?.wl, 'L')
  assert.equal(hou?.pts, 93)
  assert.equal(hou?.min, 240)
  const mia = rs[2]
  assert.equal(mia?.home, false)
  assert.equal(mia?.opponent_abbr, 'ATL')

  const po = fixture('team_games_po_1998', 'LeagueGameLog').map((r) =>
    mapTeamGame(r, 1998, 'playoffs'),
  )
  assert.equal(po[0]?.season_type, 'playoffs')
  assert.equal(po[0]?.season_id, '41997')

  const pi = fixture('team_games_playin_1998', 'LeagueGameLog')
  assert.equal(pi.length, 0, 'PlayIn before 2019-20 is an empty 200')
})

test('playerGames fixture: null pct stays null', () => {
  const rows = fixture('player_games_1998', 'LeagueGameLog').map((r) =>
    mapPlayerGame(r, 1998, 'regular'),
  )
  assert.equal(rows.length, 4)
  assert.equal(rows[0]?.player_name, 'Anthony Miller')
  assert.equal(rows[0]?.team_abbr, 'ATL')
  assert.equal(rows[0]?.home, true)
  assert.equal(rows[0]?.opponent_abbr, 'MIA')
  assert.equal(rows[0]?.fg3_pct, null)
  assert.equal(rows[0]?.ftm, 2)
  assert.equal(rows[2]?.ft_pct, null)
  assert.equal(rows[2]?.home, false)
  assert.ok(!('FANTASY_PTS' in (rows[0] ?? {})))
})

test('standings fixture', () => {
  const rows = fixture('standings_1998', 'Standings').map((r) => mapStanding(r, 1998))
  assert.equal(rows.length, 3)
  const top = rows[0]
  assert.equal(top?.season_id, '21997')
  assert.equal(typeof top?.team_id, 'number')
  assert.equal(typeof top?.wins, 'number')
  assert.equal(typeof top?.losses, 'number')
  assert.equal((top?.wins ?? 0) + (top?.losses ?? 0), 82)
  assert.ok(['East', 'West'].includes(top?.conference ?? ''))
  assert.match(top?.conference_record ?? '', /^\d+-\d+$/)
  assert.equal(top?.playoff_rank, 1)
})

test('roster fixture: birth date, height, rookie experience', () => {
  const rows = fixture('roster_sas_1998', 'CommonTeamRoster').map((r) =>
    mapRosterPlayer(r, 1998, 1610612759),
  )
  assert.equal(rows.length, 4)
  const duncan = rows.find((r) => r.player_name === 'Tim Duncan')
  assert.ok(duncan)
  assert.equal(duncan.player_id, 1495)
  assert.equal(duncan.team_id, 1610612759)
  assert.equal(duncan.jersey, '21')
  assert.equal(duncan.position, 'F-C')
  assert.equal(duncan.height, '7-0')
  assert.equal(duncan.height_in, 84)
  assert.equal(duncan.weight, 248)
  assert.equal(duncan.birth_date, '1976-04-25')
  assert.equal(duncan.age, 22)
  assert.equal(duncan.experience, 0)
  assert.equal(duncan.school, 'Wake Forest')
  assert.equal(duncan.how_acquired, null)
  const jackson = rows[0]
  assert.equal(jackson?.experience, 7)
  assert.equal(jackson?.birth_date, '1967-10-27')
})

test('draft fixture', () => {
  const rows = fixture('draft', 'DraftHistory').map(mapDraftPick)
  assert.equal(rows.length, 4)
  const duncan = rows.find((r) => r.person_id === 1495)
  assert.ok(duncan)
  assert.equal(duncan.season, 1997)
  assert.equal(duncan.round_number, 1)
  assert.equal(duncan.overall_pick, 1)
  assert.equal(duncan.team_abbr, 'SAS')
  assert.equal(duncan.organization, 'Wake Forest')
  assert.equal(rows[0]?.season, 2026)
})

test('allPlayers fixture', () => {
  const rows = fixture('all_players', 'CommonAllPlayers').map(mapAllPlayer)
  assert.equal(rows.length, 3)
  const duncan = rows.find((r) => r.person_id === 1495)
  assert.ok(duncan)
  assert.equal(duncan.name, 'Tim Duncan')
  assert.equal(duncan.from_year, 1997)
  assert.equal(duncan.to_year, 2015)
  assert.equal(duncan.team_id, null)
  assert.equal(duncan.games_played, true)
  assert.equal(rows[0]?.name, 'Alaa Abdelnaby')
})
