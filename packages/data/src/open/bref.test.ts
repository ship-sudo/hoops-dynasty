import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as b from './bref.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

test('every spec matches its fixture header', () => {
  const pairs: [string, b.Spec][] = [
    ['Advanced.csv', b.ADVANCED],
    ['Per 100 Poss.csv', b.PER_100],
    ['Per 36 Minutes.csv', b.PER_36],
    ['Player Per Game.csv', b.PER_GAME],
    ['Player Totals.csv', b.TOTALS],
    ['Player Play By Play.csv', b.PLAY_BY_PLAY],
    ['Player Shooting.csv', b.SHOOTING],
    ['Player Season Info.csv', b.SEASON_INFO],
    ['Player Career Info.csv', b.CAREER_INFO],
    ['Draft Pick History.csv', b.DRAFT],
    ['Team Abbrev.csv', b.TEAM_ABBREV],
    ['Team Summaries.csv', b.TEAM_SUMMARIES],
    ['Team Totals.csv', b.TEAM_TOTALS],
    ['Team Stats Per Game.csv', b.TEAM_PER_GAME],
    ['Team Stats Per 100 Poss.csv', b.TEAM_PER_100],
    ['Opponent Totals.csv', b.OPP_TOTALS],
    ['Opponent Stats Per 100 Poss.csv', b.OPP_PER_100],
  ]
  for (const [file, spec] of pairs) {
    const rows = b.typedRows(fx(file), spec)
    assert.ok(rows.length > 0, file)
    // every spec column present on every row, with no undefined
    for (const r of rows)
      for (const k of Object.keys(spec))
        assert.notEqual((r as Record<string, unknown>)[k], undefined, `${file}:${k}`)
  }
})

test('typedRows: numbers parsed, NA → null, unknown column throws', () => {
  const rows = b.typedRows(fx('Advanced.csv'), b.ADVANCED)
  const jokic = rows.find((r) => r.player_id === 'jokicni01')
  assert.equal(jokic?.per, 32.3)
  assert.equal(jokic?.vorp, 9.2)
  assert.equal(jokic?.age, 30)
  const aba = rows.find((r) => r.lg === 'ABA')
  assert.equal(aba?.gs, null)
  assert.throws(() => b.typedRows('a,b\n1,2\n', { c: 'n' }), /column c not in header/)
  assert.throws(() => b.typedRows('season\nNA\n', { season: 'N' }), /required number/)
})

test('nbaSeasons drops other leagues and seasons outside the range', () => {
  const rows = b.typedRows(fx('Player Totals.csv'), b.TOTALS)
  assert.equal(rows.length, 8)
  assert.equal(b.nbaSeasons(rows).length, 6)
  assert.equal(b.nbaSeasons(rows, { from: 1997 }).length, 7)
  assert.equal(b.nbaSeasons(rows, { from: 1997, to: 1997 }).length, 1)
})

test('totals: row order preserved, stints exposed, combined rows detectable', () => {
  const rows = b.nbaSeasons(b.typedRows(fx('Player Totals.csv'), b.TOTALS))
  const agbaji = rows.filter((r) => r.player_id === 'agbajoc01')
  assert.deepEqual(
    agbaji.map((r) => r.team),
    ['2TM', 'TOR', 'BRK'],
  )
  assert.equal(b.isTotalRow('2TM'), true)
  assert.equal(b.isTotalRow('TOT'), true)
  assert.equal(b.isTotalRow('TOR'), false)
  const stints = b.totalsStints(rows)
  assert.equal(stints.length, 5)
  assert.deepEqual(
    stints.filter((r) => r.player_id === 'agbajoc01').map((r) => [r.team, r.g]),
    [
      ['TOR', 42],
      ['BRK', 20],
    ],
  )
  assert.equal(rows.find((r) => r.player_id === 'jokicni01')?.trp_dbl, 34)
})

test('team summaries: League Average row has null abbreviation', () => {
  const rows = b.nbaSeasons(b.typedRows(fx('Team Summaries.csv'), b.TEAM_SUMMARIES))
  assert.equal(rows.length, 3)
  const avg = rows.find((r) => r.team === 'League Average')
  assert.equal(avg?.abbreviation, null)
  assert.equal(avg?.w, null)
  assert.equal(avg?.pace, 99.4)
  const atl = rows.find((r) => r.abbreviation === 'ATL')
  assert.equal(atl?.playoffs, false)
  assert.equal(atl?.o_rtg, 116.1)
  assert.equal(atl?.arena, 'State Farm Arena')
})

test('career info: quoted colleges, hof boolean, null college', () => {
  const rows = b.typedRows(fx('Player Career Info.csv'), b.CAREER_INFO)
  const byId = new Map(rows.map((r) => [r.player_id, r]))
  assert.equal(byId.get('jordami01')?.hof, true)
  assert.equal(byId.get('butleji01')?.colleges, 'Tyler Junior College, Marquette')
  assert.equal(byId.get('jokicni01')?.colleges, null)
  assert.equal(byId.get('jokicni01')?.ht_in_in, 83)
  assert.equal(byId.get('jokicni01')?.birth_date, '1995-02-19')
})

test('draft: 2025 top three, BAA dropped', () => {
  const rows = b.nbaSeasons(b.typedRows(fx('Draft Pick History.csv'), b.DRAFT))
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[3] && [rows[3].season, rows[3].overall_pick, rows[3].player_id], [
    1998,
    1,
    'olowomi01',
  ])
  assert.deepEqual(
    rows.filter((r) => r.season === 2025).map((r) => [r.overall_pick, r.tm, r.player_id]),
    [
      [1, 'DAL', 'flaggco01'],
      [2, 'SAS', 'harpedy01'],
      [3, 'PHI', 'edgecvj01'],
    ],
  )
})
