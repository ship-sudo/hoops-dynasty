import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { RAW_DIR } from '../paths.ts'
import { ERA, ERA_FIRST, ERA_LAST } from './era.ts'

const years = Object.keys(ERA).map(Number)
const seasons = Object.values(ERA)

/** Parse the cached basketball-reference cap table: season end year → cap dollars. */
function parseBrefCaps(html: string): Map<number, number> {
  const table = html.match(/<table[^>]*id="salary_cap_history"[^>]*>([\s\S]*?)<\/table>/)
  assert.ok(table, 'salary_cap_history table not found')
  const caps = new Map<number, number>()
  for (const row of (table[1] ?? '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) =>
      (c[1] ?? '').replace(/<[^>]+>/g, '').trim(),
    )
    const season = cells[0]?.match(/^(\d{4})-(\d{2})$/)
    const cap = cells[1]?.match(/^\$([\d,]+)$/)
    if (!season || !cap) continue
    const start = Number(season[1])
    const end = Math.floor(start / 100) * 100 + Number(season[2])
    caps.set(end < start ? end + 100 : end, Number((cap[1] ?? '').replaceAll(',', '')))
  }
  return caps
}

const brefPath = path.join(RAW_DIR, 'bref', 'salary-cap-history.html')

test('cap matches the cached basketball-reference table for every season', {
  skip: existsSync(brefPath) ? false : `cached page missing: ${brefPath} (set HOOPS_DATA_DIR)`,
}, () => {
  const caps = parseBrefCaps(readFileSync(brefPath, 'utf8'))
  for (const s of seasons) {
    const want = caps.get(s.season_end)
    if (want === undefined) continue
    assert.equal(s.cap, want, `cap ${s.season_id}`)
  }
})

test('30 seasons, 1998 through 2027, ids match keys', () => {
  assert.equal(seasons.length, 30)
  assert.equal(ERA_FIRST, 1998)
  assert.equal(ERA_LAST, 2027)
  assert.deepEqual(
    years,
    seasons.map((s) => s.season_end),
  )
  for (const s of seasons) {
    const y = s.season_end
    assert.equal(ERA[y], s)
    assert.equal(s.season_id, `${y - 1}-${String(y % 100).padStart(2, '0')}`)
  }
})

test("2026-27 money is the NBA's June 2026 release", () => {
  const s = ERA[2027]
  assert.ok(s)
  assert.equal(s.cap, 164_961_000)
  assert.equal(s.tax_line, 200_428_000)
  assert.equal(s.apron_1, 209_015_000)
  assert.equal(s.apron_2, 221_686_000)
  assert.equal(s.min_salary_0yr, 1_357_763)
  assert.equal(s.mle_non_taxpayer, 15_044_000)
})

test('tax line and aprons are ordered', () => {
  for (const s of seasons) {
    if (s.tax_line !== null) assert.ok(s.tax_line >= s.cap, `tax >= cap ${s.season_id}`)
    if (s.apron_1 !== null) {
      assert.ok(s.tax_line !== null, `apron_1 needs a tax line ${s.season_id}`)
      assert.ok(s.apron_1 >= s.tax_line, `apron_1 >= tax ${s.season_id}`)
    }
    if (s.apron_2 !== null) {
      assert.ok(s.apron_1 !== null, `apron_2 needs apron_1 ${s.season_id}`)
      assert.ok(s.apron_2 >= s.apron_1, `apron_2 >= apron_1 ${s.season_id}`)
    }
  }
})

test('lottery odds sum to 100 and match the team count', () => {
  for (const s of seasons) {
    const sum = s.draft.lottery_odds.reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 100) < 0.01, `odds sum ${s.season_id} = ${sum}`)
    assert.equal(s.draft.lottery_odds.length, s.draft.lottery_teams, `odds length ${s.season_id}`)
    assert.equal(s.draft.lottery_teams, s.teams - s.playoffs.teams, `lottery teams ${s.season_id}`)
  }
})

test('first round is best-of-5 or best-of-7', () => {
  for (const s of seasons)
    assert.ok(s.playoffs.first_round_games === 5 || s.playoffs.first_round_games === 7)
})

test('unverified lists only name real fields', () => {
  for (const s of seasons) {
    const keys = new Set(Object.keys(s))
    for (const f of s.unverified)
      assert.ok(keys.has(f), `${s.season_id} unverified names unknown field ${f}`)
  }
})

test('money fields are whole dollars and salaries are ordered', () => {
  for (const s of seasons) {
    for (const v of [
      s.cap,
      s.tax_line,
      s.apron_1,
      s.apron_2,
      s.min_salary_0yr,
      s.min_salary_10yr,
      s.rookie_scale_pick1,
    ]) {
      if (v !== null) assert.ok(Number.isInteger(v) && v > 0, `${s.season_id} money ${v}`)
    }
    assert.ok(s.min_salary_10yr >= s.min_salary_0yr, `min ordering ${s.season_id}`)
    if (s.max_salary.dollars) {
      const d = s.max_salary.dollars
      assert.ok(d.yrs_0_6 < d.yrs_7_9 && d.yrs_7_9 < d.yrs_10_plus, `max ordering ${s.season_id}`)
    }
  }
})

test('trade tiers ascend and rule flags are monotone', () => {
  for (const s of seasons) {
    let last = 0
    for (const t of s.trade_matching.under) {
      if (t.up_to !== null) assert.ok(t.up_to > last, `tier order ${s.season_id}`)
      if (t.up_to !== null) last = t.up_to
    }
    assert.equal(s.trade_matching.under.at(-1)?.up_to, null, `open last tier ${s.season_id}`)
    assert.equal(
      s.tax_rates !== null,
      s.luxury_tax_scheme === 'incremental',
      `tax_rates ${s.season_id}`,
    )
  }
  for (let i = 1; i < seasons.length; i++) {
    const prev = seasons[i - 1]
    const cur = seasons[i]
    if (!prev || !cur) continue
    const a = prev.rules
    const b = cur.rules
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      if (k === 'three_point_line_ft') continue
      assert.ok(!(a[k] && !b[k]), `rule ${k} flips back off in ${cur.season_id}`)
    }
  }
})
