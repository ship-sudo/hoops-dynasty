// Salary cap by season from the cached basketball-reference salary-cap-history page.
// Source: data/raw/bref/salary-cap-history.html (fetched once; never refetched).

import { readFileSync } from 'node:fs'
import { cachePath } from '../fetch.ts'
import { cell, parseBrefTable, parseDollars, seasonEndFromLabel } from './html.ts'

export interface CapRow {
  /** Year the season ends: 1998 = 1997-98. */
  season_end: number
  cap: number
}

/** Parse the cap history table. All seasons present, ascending. */
export function parseCapHistory(html: string): CapRow[] {
  const t = parseBrefTable(html, 'salary_cap_history')
  const rows: CapRow[] = []
  for (const r of t.rows) {
    const year = cell(r, 'year_id')?.text
    const cap = parseDollars(cell(r, 'cap')?.text)
    const season_end = year ? seasonEndFromLabel(year) : null
    if (season_end === null || cap === null) continue
    rows.push({ season_end, cap })
  }
  return rows.sort((a, b) => a.season_end - b.season_end)
}

export const CAP_HISTORY_PATH = cachePath('bref', 'salary-cap-history.html')

/** Cap rows for season_end in [from, to]. Defaults to 1998..2026. */
export function loadCapHistory(from = 1998, to = 2026): CapRow[] {
  const html = readFileSync(CAP_HISTORY_PATH, 'utf8')
  return parseCapHistory(html).filter((r) => r.season_end >= from && r.season_end <= to)
}
