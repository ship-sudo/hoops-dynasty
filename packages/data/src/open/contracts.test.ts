import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseContractsPage, toSalaryLines } from './contracts.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

test('current page: seasons, ids, options, guaranteed', () => {
  const p = parseContractsPage(fx('contracts-players.html'))
  assert.equal(p.first_season_end, 2027)
  assert.deepEqual(Object.keys(p.columns), ['y1', 'y2', 'y3', 'y4', 'y5', 'y6'])
  assert.equal(p.columns.y6, '2031-32')
  assert.equal(p.rows.length, 4) // repeated header row is not a data row
  const [curry, jokic, tatum, suggs] = p.rows
  assert.deepEqual(curry, {
    player: 'Stephen Curry',
    player_id: 'curryst01',
    team: 'GSW',
    seasons: [{ season_end: 2027, salary: 62_587_158, option: null }],
    guaranteed: 62_587_158,
  })
  assert.equal(jokic?.player_id, 'jokicni01')
  assert.deepEqual(jokic?.seasons[1], { season_end: 2028, salary: 62_841_702, option: 'player' })
  assert.equal(tatum?.seasons.length, 4)
  assert.deepEqual(tatum?.seasons[3], { season_end: 2030, salary: 71_446_914, option: 'player' })
  assert.equal(tatum?.guaranteed, 188_360_046)
  assert.deepEqual(suggs?.seasons[3], { season_end: 2030, salary: 26_700_000, option: 'team' })
})

test('toSalaryLines flattens to one row per player-season', () => {
  const lines = toSalaryLines(parseContractsPage(fx('contracts-players.html')))
  assert.equal(lines.length, 1 + 2 + 4 + 4)
  assert.equal(lines.filter((l) => l.season_end === 2027).length, 4)
  assert.equal(lines.filter((l) => l.option === 'player').length, 2)
  assert.equal(lines.filter((l) => l.option === 'team').length, 1)
})

test('2020-21 Wayback snapshot parses with the same code', () => {
  const p = parseContractsPage(fx('contracts-players-wayback-2021.html'))
  assert.equal(p.first_season_end, 2021)
  assert.equal(p.columns.y1, '2020-21')
  assert.equal(p.rows.length, 4)
  const byId = new Map(p.rows.map((r) => [r.player_id, r]))
  assert.deepEqual(byId.get('curryst01')?.seasons, [
    { season_end: 2021, salary: 43_006_362, option: null },
    { season_end: 2022, salary: 45_780_966, option: null },
  ])
  assert.deepEqual(byId.get('westbru01')?.seasons[2], {
    season_end: 2023,
    salary: 47_063_478,
    option: 'player',
  })
  assert.equal(byId.get('westbru01')?.team, 'WAS')
  assert.deepEqual(byId.get('paulch01')?.seasons[1], {
    season_end: 2022,
    salary: 44_211_146,
    option: 'player',
  })
  assert.deepEqual(byId.get('dragigo01')?.seasons[1], {
    season_end: 2022,
    salary: 19_440_000,
    option: 'team',
  })
})

test('missing table throws', () => {
  assert.throws(() => parseContractsPage('<html></html>'), /player-contracts/)
})
