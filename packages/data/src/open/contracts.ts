// Parser for basketball-reference /contracts/players.html (current page or a Wayback snapshot).
// Table #player-contracts: Rk, Player, Tm, y1..y6 (season labels in the header), Guaranteed.
// Option flags live in the salary cell class: salary-pl = player option, salary-tm = team option.

import { cell, parseBrefTable, parseDollars, playerSlug, seasonEndFromLabel } from './html.ts'

export type OptionFlag = 'player' | 'team' | 'early_termination' | null

export interface ContractSeason {
  /** Year the season ends: 2027 = 2026-27. */
  season_end: number
  salary: number
  option: OptionFlag
}

export interface ContractRow {
  player: string
  player_id: string | null
  team: string
  seasons: ContractSeason[]
  guaranteed: number | null
}

export interface ContractsPage {
  /** Season the page's first salary column belongs to. */
  first_season_end: number
  /** Season labels by column, y1 → '2026-27'. */
  columns: Record<string, string>
  rows: ContractRow[]
}

const OPTION_BY_CLASS: Record<string, OptionFlag> = {
  pl: 'player',
  tm: 'team',
  et: 'early_termination',
}

function optionOf(cls: string): OptionFlag {
  const m = /salary-([a-z]+)/.exec(cls)
  if (!m) return null
  return OPTION_BY_CLASS[m[1] as string] ?? null
}

/** Parse a contracts page. Throws if the table or season headers are missing. */
export function parseContractsPage(html: string): ContractsPage {
  const t = parseBrefTable(html, 'player-contracts')
  const columns: Record<string, string> = {}
  const seasonByCol: Record<string, number> = {}
  for (const [stat, label] of Object.entries(t.headers)) {
    if (!/^y\d$/.test(stat)) continue
    const end = seasonEndFromLabel(label)
    if (end === null) continue
    columns[stat] = label
    seasonByCol[stat] = end
  }
  const first = seasonByCol.y1
  if (first === undefined) throw new Error('contracts page: no y1 season header')
  const rows: ContractRow[] = []
  for (const r of t.rows) {
    const p = cell(r, 'player')
    if (!p || p.text === '') continue
    const seasons: ContractSeason[] = []
    for (const [stat, season_end] of Object.entries(seasonByCol)) {
      const c = cell(r, stat)
      if (!c) continue
      const salary = parseDollars(c.csk ?? c.text)
      if (salary === null) continue
      seasons.push({ season_end, salary, option: optionOf(c.cls) })
    }
    const g = cell(r, 'remain_gtd')
    rows.push({
      player: p.text,
      player_id: playerSlug(p),
      team: cell(r, 'team_id')?.text ?? '',
      seasons,
      guaranteed: g ? parseDollars(g.csk ?? g.text) : null,
    })
  }
  return { first_season_end: first, columns, rows }
}

export interface SalaryLine {
  season_end: number
  player: string
  player_id: string | null
  team: string
  salary: number
  option: OptionFlag
}

/** Flatten a page to one row per player-season. */
export function toSalaryLines(page: ContractsPage): SalaryLine[] {
  const out: SalaryLine[] = []
  for (const r of page.rows) {
    for (const s of r.seasons) {
      out.push({
        season_end: s.season_end,
        player: r.player,
        player_id: r.player_id,
        team: r.team,
        salary: s.salary,
        option: s.option,
      })
    }
  }
  return out
}
