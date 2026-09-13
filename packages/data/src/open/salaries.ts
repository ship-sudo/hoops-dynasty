// Player salaries by season.
// 1985..2020: sumitrodatta/nba-player-salaries (names + bref team codes, no player ids).
// 2021..2026: Wayback snapshots of bref /contracts/players.html taken at opening night
//             (ids, team, salary for that season, option flags). See wayback.ts.
// Ids for the CSV rows are matched to Player Season Info by season + team + normalized name.

import {
  DEFAULT_RANGE,
  isTotalRow,
  type Range,
  type RowOf,
  readCachedCsv,
  typedRows,
} from './bref.ts'
import { type OptionFlag, toSalaryLines } from './contracts.ts'
import { loadWaybackContracts, OPENING_NIGHT } from './wayback.ts'

export const PLAYER_SALARIES = {
  player: 'S',
  /** NA on a few rows; those rows are dropped by loadPlayerSalaries. */
  salary: 'n',
  tm: 'S',
  season: 'N',
  source: 's',
} as const
export type PlayerSalary = Omit<RowOf<typeof PLAYER_SALARIES>, 'salary'> & { salary: number }

/** Rows from Player Salaries.csv in [from, to] with a salary. File covers 1985..2020 only. */
export function loadPlayerSalaries(range: Range = {}): PlayerSalary[] {
  const from = range.from ?? DEFAULT_RANGE.from
  const to = range.to ?? DEFAULT_RANGE.to
  const rows = typedRows(
    readCachedCsv('nba-player-salaries', 'Player Salaries.csv'),
    PLAYER_SALARIES,
  )
  return rows.filter(
    (r): r is PlayerSalary => r.salary !== null && r.season >= from && r.season <= to,
  )
}

export interface SalaryRow {
  season_end: number
  player: string
  player_id: string | null
  team: string
  salary: number
  option: OptionFlag
  source: 'csv' | 'wayback'
}

/** Lowercase, no diacritics, no punctuation, no Jr/Sr/II/III/IV suffix. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)$/, '')
    .trim()
}

export interface SeasonStint {
  season: number
  team: string
  player: string
  player_id: string
}

/** Attach bref player ids by (season, team, name), falling back to (season, name) when unique. */
export function matchPlayerIds(sal: PlayerSalary[], stints: SeasonStint[]): SalaryRow[] {
  const byTeam = new Map<string, string>()
  const byName = new Map<string, Set<string>>()
  for (const s of stints) {
    if (isTotalRow(s.team)) continue
    const n = normalizeName(s.player)
    byTeam.set(`${s.season}|${s.team}|${n}`, s.player_id)
    const k = `${s.season}|${n}`
    const set = byName.get(k) ?? new Set()
    set.add(s.player_id)
    byName.set(k, set)
  }
  return sal.map((r) => {
    const n = normalizeName(r.player)
    let id = byTeam.get(`${r.season}|${r.tm}|${n}`) ?? null
    if (id === null) {
      const set = byName.get(`${r.season}|${n}`)
      if (set && set.size === 1) id = [...set][0] as string
    }
    return {
      season_end: r.season,
      player: r.player,
      player_id: id,
      team: r.tm,
      salary: r.salary,
      option: null,
      source: 'csv',
    }
  })
}

/** Seasons the Wayback route covers. */
export const WAYBACK_SEASONS = Object.keys(OPENING_NIGHT).map(Number)

/** Opening-night salaries for the given seasons (default 2021..2026), from the y1 column only. */
export async function loadWaybackSalaries(
  seasons: number[] = WAYBACK_SEASONS,
): Promise<SalaryRow[]> {
  const out: SalaryRow[] = []
  for (const season of seasons) {
    const page = await loadWaybackContracts(season)
    if (!page) continue
    for (const l of toSalaryLines(page)) {
      if (l.season_end !== page.first_season_end) continue
      out.push({
        season_end: l.season_end,
        player: l.player,
        player_id: l.player_id,
        team: l.team,
        salary: l.salary,
        option: l.option,
        source: 'wayback',
      })
    }
  }
  return out
}

/** 1998..2020 from the CSV (ids matched against `stints`) plus 2021..2026 from Wayback. */
export async function loadAllSalaries(stints: SeasonStint[]): Promise<SalaryRow[]> {
  const csv = matchPlayerIds(loadPlayerSalaries({ from: 1998, to: 2020 }), stints)
  const wb = await loadWaybackSalaries()
  return [...csv, ...wb]
}
