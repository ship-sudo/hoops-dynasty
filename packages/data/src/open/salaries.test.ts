import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SEASON_INFO, typedRows } from './bref.ts'
import { matchPlayerIds, normalizeName, PLAYER_SALARIES, WAYBACK_SEASONS } from './salaries.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

test('Player Salaries.csv rows parse', () => {
  const rows = typedRows(fx('Player Salaries.csv'), PLAYER_SALARIES)
  assert.equal(rows.length, 5)
  const mj = rows.find((r) => r.player === 'Michael Jordan')
  assert.deepEqual(mj, {
    player: 'Michael Jordan',
    salary: 33_140_000,
    tm: 'CHI',
    season: 1998,
    source: 'Basketball-Reference',
  })
  assert.equal(rows.find((r) => r.player === 'Bol Bol')?.salary, 0)
})

test('normalizeName', () => {
  assert.equal(normalizeName('Nikola Jokić'), 'nikola jokic')
  assert.equal(normalizeName("Shaquille O'Neal"), 'shaquille oneal')
  assert.equal(normalizeName('Gary Payton II'), 'gary payton')
  assert.equal(normalizeName('Tim Hardaway Jr.'), 'tim hardaway')
  assert.equal(normalizeName('J.J. Redick'), 'jj redick')
})

test('matchPlayerIds: team match, unique-name fallback, ambiguous → null', () => {
  const stints = typedRows(fx('Player Season Info.csv'), SEASON_INFO)
  const sal = [
    { player: 'Nikola Jokic', salary: 1, tm: 'DEN', season: 2026, source: null },
    { player: 'Jimmy Butler', salary: 2, tm: 'MIA', season: 2026, source: null }, // team mismatch, unique name
    { player: 'Nobody Here', salary: 3, tm: 'DEN', season: 2026, source: null },
    { player: 'Jimmy Butler', salary: 4, tm: 'GSW', season: 1998, source: null }, // wrong season
  ]
  const out = matchPlayerIds(sal, stints)
  assert.deepEqual(
    out.map((r) => [r.season_end, r.player_id, r.source, r.option]),
    [
      [2026, 'jokicni01', 'csv', null],
      [2026, 'butleji01', 'csv', null],
      [2026, null, 'csv', null],
      [1998, null, 'csv', null],
    ],
  )
  // two ids for the same name in a season → no fallback
  const dup = matchPlayerIds(
    [{ player: 'Sam Smith', salary: 1, tm: 'XXX', season: 2000, source: null }],
    [
      { season: 2000, team: 'AAA', player: 'Sam Smith', player_id: 'smithsa01' },
      { season: 2000, team: 'BBB', player: 'Sam Smith', player_id: 'smithsa02' },
    ],
  )
  assert.equal(dup[0]?.player_id, null)
})

test('wayback seasons are 2021..2026', () => {
  assert.deepEqual(WAYBACK_SEASONS, [2021, 2022, 2023, 2024, 2025, 2026])
})
