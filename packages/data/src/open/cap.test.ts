import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parseCapHistory } from './cap.ts'

const html = readFileSync(new URL('./fixtures/salary-cap-history.html', import.meta.url), 'utf8')

test('parseCapHistory reads season_end and cap, ascending', () => {
  const rows = parseCapHistory(html)
  assert.deepEqual(rows, [
    { season_end: 1985, cap: 3_600_000 },
    { season_end: 1998, cap: 26_900_000 },
    { season_end: 2000, cap: 34_000_000 },
    { season_end: 2026, cap: 154_647_000 },
    { season_end: 2027, cap: 164_961_000 },
  ])
})
