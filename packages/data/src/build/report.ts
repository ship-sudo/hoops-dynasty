// data/REPORT.md: row counts per season per table, every gap with its reason, 10 seeded spot-checks of
// NBA season totals (leaguedash) against the sum of that player's game logs (leaguegamelog), and the
// opening-night rule with its known error.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { makeRng } from '@hoops/core'
import { all } from '../db/db.ts'
import { seasonId } from '../nba/client.ts'
import * as nba from '../nba/parse.ts'
import * as bref from '../open/bref.ts'
import { OPENING_NIGHT_ERROR, OPENING_NIGHT_RULE } from './opening-night.ts'

const SEASON_TABLES = [
  'team_seasons',
  'player_seasons',
  'games',
  'player_games',
  'playoff_series',
  'rosters',
  'coaches',
  'salaries',
  'contracts',
  'awards',
  'injuries',
] as const

const ONCE_TABLES = ['players', 'draft_picks', 'id_map'] as const

export interface SpotCheck {
  yearEnd: number
  playerId: string
  name: string
  nba: Record<string, number>
  logs: Record<string, number>
  /** bref Player Totals (combined row for traded players); null when the id is unmatched. */
  bref: Record<string, number> | null
  per100Nba: Record<string, number> | null
  per100Bref: Record<string, number> | null
  logsOk: boolean
  brefOk: boolean
  per100Ok: boolean
}

const CHECK_KEYS = [
  'gp',
  'min',
  'pts',
  'fga',
  'fgm',
  'fg3m',
  'fta',
  'ftm',
  'oreb',
  'dreb',
  'ast',
  'tov',
]
const PER100_KEYS = ['pts', 'fga', 'ast', 'trb', 'tov']
/** bref and stats.nba.com estimate possessions differently; per-100 lines agree to a few percent. */
const PER100_TOL = 0.07
/** Both sources print one decimal, so two rounded values can differ by 0.1 on their own. */
const PER100_FLOOR = 0.15

/** Our key → bref column. Box columns are computed keys in bref.ts, so rows are read as a plain record. */
const BREF_TOTAL_KEYS: Record<string, string> = {
  gp: 'g',
  min: 'mp',
  pts: 'pts',
  fga: 'fga',
  fgm: 'fg',
  fg3m: 'x3p',
  fta: 'fta',
  ftm: 'ft',
  oreb: 'orb',
  dreb: 'drb',
  ast: 'ast',
  tov: 'tov',
}

/** Combined row per (season, bref id): TOT when traded, else the only row. */
function brefSeasonRows<R extends { season: number; player_id: string; team: string }>(
  rows: R[],
): Map<string, R> {
  const out = new Map<string, R>()
  for (const r of rows) {
    const k = `${r.season}|${r.player_id}`
    if (!out.has(k) || bref.isTotalRow(r.team)) out.set(k, r)
  }
  return out
}

function closeEnough(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= Math.max(tol * Math.max(Math.abs(a), Math.abs(b)), PER100_FLOOR)
}

/**
 * 10 random regular-season player-seasons, seed 1. Three sources: leaguedash totals, the sum of that
 * player's game logs (must match on counting stats), and bref totals (must match) plus per-100 lines
 * (within PER100_TOL).
 */
export async function spotChecks(db: DatabaseSync, n = 10, seed = 1): Promise<SpotCheck[]> {
  const rng = makeRng(seed)
  const candidates = all<{ year_end: number; player_id: string }>(
    db,
    `SELECT DISTINCT year_end, player_id FROM player_seasons WHERE season_type = 'regular' AND gp >= 10
     ORDER BY year_end, player_id`,
  )
  const out: SpotCheck[] = []
  const totalsCache = new Map<number, Map<string, nba.PlayerBase>>()
  const brefTotals = brefSeasonRows(bref.loadTotals())
  const brefPer100 = brefSeasonRows(bref.loadPer100())
  for (let i = 0; i < n && candidates.length > 0; i++) {
    const c = candidates[rng.int(candidates.length)] as { year_end: number; player_id: string }
    let totals = totalsCache.get(c.year_end)
    if (!totals) {
      totals = new Map(
        (await nba.playerTotals(c.year_end))
          .filter((t) => t.season_type === 'regular')
          .map((t) => [String(t.player_id), t]),
      )
      totalsCache.set(c.year_end, totals)
    }
    const t = totals.get(c.player_id)
    const logs = all<Record<string, number>>(
      db,
      `SELECT COUNT(*) AS gp, SUM(min) AS min, SUM(pts) AS pts, SUM(fga) AS fga, SUM(fgm) AS fgm,
              SUM(fg3m) AS fg3m, SUM(fta) AS fta, SUM(ftm) AS ftm, SUM(oreb) AS oreb, SUM(dreb) AS dreb,
              SUM(ast) AS ast, SUM(tov) AS tov
       FROM player_games WHERE year_end = ? AND player_id = ? AND season_type = 'regular'`,
      [c.year_end, c.player_id],
    )[0] as Record<string, number>
    const nbaLine: Record<string, number> = {}
    for (const k of CHECK_KEYS)
      nbaLine[k] = Number((t as unknown as Record<string, number>)?.[k] ?? 0)
    const minOk = (a: number, b: number) => Math.abs(a - b) <= 0.6 * (logs.gp ?? 0)
    const logsOk = CHECK_KEYS.every((k) => {
      const a = nbaLine[k] ?? 0
      const b = logs[k] ?? 0
      return k === 'min' ? minOk(a, b) : a === b
    })
    const ps = all<{ bref_id: string | null; per100_json: string | null }>(
      db,
      `SELECT p.bref_id, s.per100_json FROM players p
       LEFT JOIN player_seasons s ON s.player_id = p.player_id AND s.year_end = ? AND s.season_type = 'regular'
       WHERE p.player_id = ? LIMIT 1`,
      [c.year_end, c.player_id],
    )[0]
    const bt = ps?.bref_id ? brefTotals.get(`${c.year_end}|${ps.bref_id}`) : undefined
    const bp = ps?.bref_id ? brefPer100.get(`${c.year_end}|${ps.bref_id}`) : undefined
    let brefLine: Record<string, number> | null = null
    if (bt) {
      brefLine = {}
      const raw = bt as unknown as Record<string, number | null>
      for (const [k, col] of Object.entries(BREF_TOTAL_KEYS)) brefLine[k] = Number(raw[col] ?? 0)
    }
    const brefOk =
      brefLine !== null &&
      CHECK_KEYS.every((k) => {
        const a = nbaLine[k] ?? 0
        const b = brefLine?.[k] ?? 0
        return k === 'min' ? minOk(a, b) : a === b
      })
    let per100Nba: Record<string, number> | null = null
    if (ps?.per100_json) {
      const p = JSON.parse(ps.per100_json) as Record<string, number>
      per100Nba = {
        pts: p.pts ?? 0,
        fga: p.fga ?? 0,
        ast: p.ast ?? 0,
        trb: (p.oreb ?? 0) + (p.dreb ?? 0),
        tov: p.tov ?? 0,
      }
    }
    const per100Bref: Record<string, number> | null = bp
      ? {
          pts: bp.pts_per_100_poss ?? 0,
          fga: bp.fga_per_100_poss ?? 0,
          ast: bp.ast_per_100_poss ?? 0,
          trb: bp.trb_per_100_poss ?? 0,
          tov: bp.tov_per_100_poss ?? 0,
        }
      : null
    const per100Ok =
      per100Nba !== null &&
      per100Bref !== null &&
      PER100_KEYS.every((k) => closeEnough(per100Nba?.[k] ?? 0, per100Bref?.[k] ?? 0, PER100_TOL))
    out.push({
      yearEnd: c.year_end,
      playerId: c.player_id,
      name: t?.player_name ?? c.player_id,
      nba: nbaLine,
      logs,
      bref: brefLine,
      per100Nba,
      per100Bref,
      logsOk,
      brefOk,
      per100Ok,
    })
  }
  return out
}

function md(rows: string[][]): string {
  const head = rows[0] as string[]
  const sep = head.map(() => '---')
  return [head, sep, ...rows.slice(1)].map((r) => `| ${r.join(' | ')} |`).join('\n')
}

export async function buildReport(db: DatabaseSync): Promise<string> {
  const seasons = all<{ year_end: number; games: number; teams: number }>(
    db,
    'SELECT year_end, games, teams FROM seasons ORDER BY year_end',
  )
  const countRows: string[][] = [['season', 'games/team', ...SEASON_TABLES]]
  for (const s of seasons) {
    const row = [seasonId(s.year_end), String(s.games)]
    for (const t of SEASON_TABLES) {
      const c = all<{ c: number }>(db, `SELECT COUNT(*) AS c FROM ${t} WHERE year_end = ?`, [
        s.year_end,
      ])[0]
      row.push(String(c?.c ?? 0))
    }
    countRows.push(row)
  }
  const onceRows: string[][] = [['table', 'rows']]
  for (const t of ONCE_TABLES)
    onceRows.push([t, String(all<{ c: number }>(db, `SELECT COUNT(*) AS c FROM ${t}`)[0]?.c ?? 0)])

  const champs = all<{ year_end: number; abbr: string; loser: string; hw: number; lw: number }>(
    db,
    `SELECT s.year_end, w.abbr AS abbr, l.abbr AS loser,
            MAX(s.high_wins, s.low_wins) AS hw, MIN(s.high_wins, s.low_wins) AS lw
     FROM playoff_series s
     JOIN team_seasons w ON w.year_end = s.year_end AND w.team_id = s.winner_team_id
     JOIN team_seasons l ON l.year_end = s.year_end
       AND l.team_id = CASE WHEN s.winner_team_id = s.high_team_id THEN s.low_team_id ELSE s.high_team_id END
     WHERE s.round = 4 ORDER BY s.year_end`,
  )
  const champRows: string[][] = [['season', 'champion', 'runner-up', 'finals']]
  for (const c of champs) champRows.push([seasonId(c.year_end), c.abbr, c.loser, `${c.hw}-${c.lw}`])

  const gaps = all<{ year_end: number | null; table_name: string; reason: string }>(
    db,
    'SELECT year_end, table_name, reason FROM pipeline_gaps ORDER BY year_end IS NOT NULL, year_end, table_name',
  )
  // Collapse identical per-season reasons into one row with a season range.
  const grouped = new Map<string, number[]>()
  for (const g of gaps) {
    const k = `${g.table_name}\t${g.reason}`
    const list = grouped.get(k)
    if (g.year_end === null) grouped.set(k, [])
    else if (list) list.push(g.year_end)
    else grouped.set(k, [g.year_end])
  }
  const gapRows: string[][] = [['seasons', 'table', 'reason']]
  for (const [k, years] of grouped) {
    const [table, reason] = k.split('\t') as [string, string]
    const span =
      years.length === 0
        ? 'all'
        : years.length === 1
          ? seasonId(years[0] as number)
          : years.length > 3 && years[years.length - 1] === (years[0] as number) + years.length - 1
            ? `${seasonId(years[0] as number)} to ${seasonId(years[years.length - 1] as number)}`
            : years.map(seasonId).join(', ')
    gapRows.push([span, table, reason.replace(/\|/g, '/')])
  }

  const checks = await spotChecks(db)
  const checkRows: string[][] = [['season', 'player', 'source', ...CHECK_KEYS, 'match']]
  for (const c of checks) {
    checkRows.push([
      seasonId(c.yearEnd),
      c.name,
      'leaguedash totals',
      ...CHECK_KEYS.map((k) => fmt(c.nba[k])),
      '',
    ])
    checkRows.push([
      '',
      '',
      'sum of game logs',
      ...CHECK_KEYS.map((k) => fmt(c.logs[k])),
      c.logsOk ? 'yes' : 'NO',
    ])
    checkRows.push([
      '',
      '',
      'bref totals',
      ...CHECK_KEYS.map((k) => fmt(c.bref?.[k])),
      c.bref ? (c.brefOk ? 'yes' : 'NO') : 'no bref id',
    ])
  }
  const per100Rows: string[][] = [['season', 'player', 'source', ...PER100_KEYS, 'within 7%']]
  for (const c of checks) {
    per100Rows.push([
      seasonId(c.yearEnd),
      c.name,
      'stats.nba.com per 100',
      ...PER100_KEYS.map((k) => fmt(c.per100Nba?.[k])),
      '',
    ])
    per100Rows.push([
      '',
      '',
      'bref per 100',
      ...PER100_KEYS.map((k) => fmt(c.per100Bref?.[k])),
      c.per100Bref ? (c.per100Ok ? 'yes' : 'NO') : 'no bref row',
    ])
  }
  const matchedLogs = checks.filter((c) => c.logsOk).length
  const matchedBref = checks.filter((c) => c.brefOk).length
  const matchedPer100 = checks.filter((c) => c.per100Ok).length

  return [
    '# Data pipeline report',
    '',
    `Generated ${new Date().toISOString()} from data/db.sqlite. Source: stats.nba.com cache (Lane A).`,
    'b-ref-derived tables (salaries, contracts, awards, shooting, id_map) and era rules fill in when Lanes B and C merge.',
    '',
    '## Row counts per season',
    '',
    md(countRows),
    '',
    '## Once-only tables',
    '',
    md(onceRows),
    '',
    '## Champions (derived from playoff game logs)',
    '',
    md(champRows),
    '',
    '## Gaps',
    '',
    md(gapRows),
    '',
    '## Spot checks',
    '',
    `10 random regular-season player-seasons (seeded rng, seed 1, gp ≥ 10). leaguedash totals against the sum of that player's leaguegamelog rows and against the basketball-reference Player Totals row (via id_map). Game logs match ${matchedLogs}/${checks.length}; bref totals match ${matchedBref}/${checks.length}. Minutes are integers per game in the logs and in bref, so they may differ by rounding; counting stats must be equal.`,
    '',
    md(checkRows),
    '',
    `Per-100 lines, stats.nba.com against bref: ${matchedPer100}/${checks.length} within 7% on every column. The two sites estimate possessions differently, so exact equality is not expected.`,
    '',
    md(per100Rows),
    '',
    '## Opening-night rule',
    '',
    OPENING_NIGHT_RULE,
    '',
    `Known error: ${OPENING_NIGHT_ERROR}`,
    '',
  ].join('\n')
}

function fmt(x: number | undefined): string {
  if (x === undefined || x === null) return '-'
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}

export async function writeReport(db: DatabaseSync, file: string): Promise<void> {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, await buildReport(db))
}
