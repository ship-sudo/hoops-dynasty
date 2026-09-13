// Fetch every stats.nba.com endpoint for every season into data/raw/nba/.
// Idempotent: cached keys are read from disk, not refetched. Failures are logged and skipped.
//
//   HOOPS_DATA_DIR=... npx tsx packages/data/src/nba/fetchAll.ts [--from 1998] [--to 2026]
//
// Writes a run summary to <DATA_DIR>/raw/nba/_fetchAll.json (merged across runs).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAW_DIR } from '../paths.ts'
import { seasonId } from './client.ts'
import {
  FIRST_SEASON,
  fetchAllPlayers,
  fetchDraftHistory,
  fetchGameLog,
  fetchPlayerAdvanced,
  fetchPlayerBio,
  fetchPlayerPer100,
  fetchPlayerTotals,
  fetchStandings,
  fetchTeamAdvanced,
  fetchTeamIds,
  fetchTeamRoster,
  fetchTeamTotals,
  LAST_SEASON,
} from './endpoints.ts'

export interface Failure {
  season: string
  job: string
  reason: string
}

export interface SeasonSummary {
  season: string
  counts: Record<string, number>
  /** Team ids that returned a roster. */
  rosterTeams: number
  teamIds: number
}

export interface RunSummary {
  ranAt: string
  seasons: Record<string, SeasonSummary>
  once: Record<string, number>
  failures: Failure[]
}

export const SUMMARY_PATH = path.join(RAW_DIR, 'nba', '_fetchAll.json')

/** Per-season jobs, in fetch order. Rosters are handled separately (need team ids). */
export const SEASON_JOBS: [string, (y: number) => Promise<unknown[]>][] = [
  ['bio', fetchPlayerBio],
  ['per100', fetchPlayerPer100],
  ['totals', (y) => fetchPlayerTotals(y)],
  ['advanced', fetchPlayerAdvanced],
  ['totals_po', (y) => fetchPlayerTotals(y, 'Playoffs')],
  ['team_totals', (y) => fetchTeamTotals(y)],
  ['team_advanced', fetchTeamAdvanced],
  ['team_totals_po', (y) => fetchTeamTotals(y, 'Playoffs')],
  ['standings', fetchStandings],
  ['team_games_rs', (y) => fetchGameLog(y, 'T', 'Regular Season')],
  ['team_games_po', (y) => fetchGameLog(y, 'T', 'Playoffs')],
  ['team_games_pi', (y) => fetchGameLog(y, 'T', 'PlayIn')],
  ['player_games_rs', (y) => fetchGameLog(y, 'P', 'Regular Season')],
  ['player_games_po', (y) => fetchGameLog(y, 'P', 'Playoffs')],
]

export const ONCE_JOBS: [string, () => Promise<unknown[]>][] = [
  ['draft', fetchDraftHistory],
  ['all_players', fetchAllPlayers],
]

function loadSummary(): RunSummary {
  if (existsSync(SUMMARY_PATH)) return JSON.parse(readFileSync(SUMMARY_PATH, 'utf8')) as RunSummary
  return { ranAt: '', seasons: {}, once: {}, failures: [] }
}

function saveSummary(s: RunSummary): void {
  mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true })
  writeFileSync(SUMMARY_PATH, JSON.stringify(s, null, 2))
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/** Fetch one season. Never throws; failures land in summary.failures. */
export async function fetchSeason(yearEnd: number, summary: RunSummary): Promise<SeasonSummary> {
  const season = seasonId(yearEnd)
  const out: SeasonSummary = { season, counts: {}, rosterTeams: 0, teamIds: 0 }
  summary.failures = summary.failures.filter((f) => f.season !== season)
  for (const [job, fn] of SEASON_JOBS) {
    try {
      out.counts[job] = (await fn(yearEnd)).length
    } catch (e) {
      summary.failures.push({ season, job, reason: reason(e) })
    }
  }
  let teamIds: number[] = []
  try {
    teamIds = await fetchTeamIds(yearEnd)
  } catch (e) {
    summary.failures.push({ season, job: 'team_ids', reason: reason(e) })
  }
  out.teamIds = teamIds.length
  let rosterRows = 0
  for (const teamId of teamIds) {
    try {
      rosterRows += (await fetchTeamRoster(yearEnd, teamId)).length
      out.rosterTeams++
    } catch (e) {
      summary.failures.push({ season, job: `roster:${teamId}`, reason: reason(e) })
    }
  }
  out.counts.rosters = rosterRows
  summary.seasons[season] = out
  return out
}

function fmtLine(s: SeasonSummary): string {
  const c = s.counts
  const k = (name: string) => (c[name] === undefined ? 'FAIL' : String(c[name]))
  return [
    s.season,
    `bio=${k('bio')}`,
    `per100=${k('per100')}`,
    `tot=${k('totals')}`,
    `adv=${k('advanced')}`,
    `tot_po=${k('totals_po')}`,
    `team=${k('team_totals')}/${k('team_advanced')}/${k('team_totals_po')}`,
    `stand=${k('standings')}`,
    `tg=${k('team_games_rs')}/${k('team_games_po')}/${k('team_games_pi')}`,
    `pg=${k('player_games_rs')}/${k('player_games_po')}`,
    `rosters=${s.rosterTeams}/${s.teamIds} (${k('rosters')} rows)`,
  ].join(' ')
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN
  return Number.isFinite(v) ? v : fallback
}

export async function main(): Promise<void> {
  const from = arg('--from', FIRST_SEASON)
  const to = arg('--to', LAST_SEASON)
  const summary = loadSummary()
  summary.ranAt = new Date().toISOString()
  for (const [job, fn] of ONCE_JOBS) {
    summary.failures = summary.failures.filter((f) => !(f.season === 'all' && f.job === job))
    try {
      summary.once[job] = (await fn()).length
      console.log(`once ${job}=${summary.once[job]}`)
    } catch (e) {
      summary.failures.push({ season: 'all', job, reason: reason(e) })
      console.log(`once ${job}=FAIL ${reason(e)}`)
    }
    saveSummary(summary)
  }
  for (let y = from; y <= to; y++) {
    const s = await fetchSeason(y, summary)
    console.log(fmtLine(s))
    saveSummary(summary)
  }
  const fails = summary.failures.filter((f) => f.season === 'all' || inRange(f.season, from, to))
  console.log(`done. ${fails.length} failed requests. summary: ${SUMMARY_PATH}`)
  for (const f of fails) console.log(`  FAIL ${f.season} ${f.job}: ${f.reason}`)
}

function inRange(season: string, from: number, to: number): boolean {
  const y = Number(season.slice(0, 4)) + 1
  return y >= from && y <= to
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
