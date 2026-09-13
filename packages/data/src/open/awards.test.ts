import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ALL_STAR,
  AWARD_SHARES,
  awardWinners,
  END_OF_SEASON_TEAMS,
  END_OF_SEASON_VOTING,
  latestSeason,
} from './awards.ts'
import { nbaSeasons, typedRows } from './bref.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

test('award shares: winners and shares', () => {
  const rows = typedRows(fx('Player Award Shares.csv'), AWARD_SHARES).filter((r) =>
    r.award.startsWith('nba '),
  )
  assert.equal(rows.length, 4)
  const winners = awardWinners(rows, 'nba mvp')
  assert.deepEqual(
    winners.map((r) => [r.season, r.player_id, r.share]),
    [
      [2025, 'gilgesh01', 0.913],
      [1998, 'jordami01', 0.934],
    ],
  )
  assert.equal(rows.find((r) => r.player_id === 'jokicni01')?.winner, false)
  assert.equal(rows.find((r) => r.player_id === 'jokicni01')?.first, 29)
  assert.equal(latestSeason(rows), 2025)
  assert.equal(latestSeason([]), null)
})

test('end of season teams: All-NBA 1st 2025, BAA dropped', () => {
  const rows = nbaSeasons(typedRows(fx('End of Season Teams.csv'), END_OF_SEASON_TEAMS))
  assert.equal(rows.length, 6)
  const first2025 = rows.filter(
    (r) => r.season === 2025 && r.type === 'All-NBA' && r.number_tm === '1st',
  )
  assert.equal(first2025.length, 5)
  assert.deepEqual(
    first2025.map((r) => r.position),
    ['C', 'F', 'F', 'G', 'G'],
  )
  assert.equal(rows.find((r) => r.season === 1998)?.player, "Shaquille O'Neal")
})

test('end of season voting: lowercase lg passes the NBA filter', () => {
  const rows = nbaSeasons(typedRows(fx('End of Season Teams (Voting).csv'), END_OF_SEASON_VOTING))
  assert.equal(rows.length, 4)
  const jokic = rows.find((r) => r.player_id === 'jokicni01')
  assert.equal(jokic?.type, 'all_nba')
  assert.equal(jokic?.x1st_tm, 100)
  assert.equal(rows.find((r) => r.number_tm === 'ORV')?.x1st_tm, null)
})

test('all-star selections', () => {
  const rows = nbaSeasons(typedRows(fx('All-Star Selections.csv'), ALL_STAR))
  assert.equal(rows.length, 5)
  assert.equal(rows.filter((r) => r.season === 2026).length, 3)
  assert.equal(rows[0]?.replaced, false)
  assert.equal(latestSeason(rows), 2026)
})
