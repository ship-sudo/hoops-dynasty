// Typed loaders for sumitrodatta/bball-reference-datasets CSVs (cached by download.ts).
// One loader per file. Rows filtered to lg=NBA and season in [from, to] (default 1998..2026).
// Column names stay as in the CSV (snake_case). 'NA' → null. season = year the season ends.

import { readFileSync } from 'node:fs'
import { cachePath } from '../fetch.ts'
import { bool, num, parseCsv, str } from './csv.ts'
import { GITHUB_SOURCE } from './download.ts'

/** n: number|null, N: number, s: string|null, S: string, b: boolean|null. */
export type Kind = 'n' | 'N' | 's' | 'S' | 'b'
export type Spec = Record<string, Kind>
type CellOf<K extends Kind> = K extends 'n'
  ? number | null
  : K extends 'N'
    ? number
    : K extends 's'
      ? string | null
      : K extends 'S'
        ? string
        : boolean | null
export type RowOf<S extends Spec> = { [K in keyof S]: CellOf<S[K]> }

export interface Range {
  from?: number
  to?: number
}
export const DEFAULT_RANGE = { from: 1998, to: 2027 }

export function readCachedCsv(repo: string, base: string): string {
  return readFileSync(cachePath(GITHUB_SOURCE, `sumitrodatta/${repo}/${base}`), 'utf8')
}

function coerce(kind: Kind, v: string | undefined, col: string): unknown {
  switch (kind) {
    case 'n':
      return num(v)
    case 'N': {
      const x = num(v)
      if (x === null) throw new Error(`${col}: required number missing`)
      return x
    }
    case 's':
      return str(v)
    case 'S': {
      const x = str(v)
      if (x === null) throw new Error(`${col}: required string missing`)
      return x
    }
    case 'b':
      return bool(v)
  }
}

/** Parse CSV text into typed rows per spec. Throws if a spec column is absent. */
export function typedRows<S extends Spec>(text: string, spec: S): RowOf<S>[] {
  const rows = parseCsv(text)
  const header = rows[0] ?? []
  const idx: [keyof S & string, Kind, number][] = []
  for (const [col, kind] of Object.entries(spec)) {
    const i = header.indexOf(col)
    if (i < 0) throw new Error(`column ${col} not in header: ${header.join(',')}`)
    idx.push([col, kind, i])
  }
  const out: RowOf<S>[] = []
  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r] as string[]
    const obj: Record<string, unknown> = {}
    for (const [col, kind, i] of idx) obj[col] = coerce(kind, raw[i], col)
    out.push(obj as RowOf<S>)
  }
  return out
}

/** Load a bball-reference-datasets file as typed rows. Row order preserved. */
export function loadTable<S extends Spec>(base: string, spec: S): RowOf<S>[] {
  return typedRows(readCachedCsv('bball-reference-datasets', base), spec)
}

function inRange(season: number, range: Range): boolean {
  const from = range.from ?? DEFAULT_RANGE.from
  const to = range.to ?? DEFAULT_RANGE.to
  return season >= from && season <= to
}

/** Keep NBA rows inside the season range. */
export function nbaSeasons<R extends { lg: string; season: number }>(
  rows: R[],
  range: Range = {},
): R[] {
  return rows.filter((r) => r.lg.toUpperCase() === 'NBA' && inRange(r.season, range))
}

/** True for the combined row of a traded player ('TOT', '2TM', '3TM', ...). */
export function isTotalRow(team: string | null): boolean {
  return team !== null && /^(TOT|\dTM)$/.test(team)
}

// ---- player season files. Shared leading columns.

const PLAYER_SEASON = {
  season: 'N',
  lg: 'S',
  player: 'S',
  player_id: 'S',
  age: 'n',
  team: 'S',
  pos: 's',
} as const

const PLAYER_GAMES = { ...PLAYER_SEASON, g: 'n', gs: 'n', mp: 'n' } as const

export const ADVANCED = {
  ...PLAYER_GAMES,
  per: 'n',
  ts_percent: 'n',
  x3p_ar: 'n',
  f_tr: 'n',
  orb_percent: 'n',
  drb_percent: 'n',
  trb_percent: 'n',
  ast_percent: 'n',
  stl_percent: 'n',
  blk_percent: 'n',
  tov_percent: 'n',
  usg_percent: 'n',
  ows: 'n',
  dws: 'n',
  ws: 'n',
  ws_48: 'n',
  obpm: 'n',
  dbpm: 'n',
  bpm: 'n',
  vorp: 'n',
} as const
export type Advanced = RowOf<typeof ADVANCED>
export function loadAdvanced(range?: Range): Advanced[] {
  return nbaSeasons(loadTable('Advanced.csv', ADVANCED), range)
}

const BOX_CORE = (suffix: string) =>
  ({
    [`fg${suffix}`]: 'n',
    [`fga${suffix}`]: 'n',
    fg_percent: 'n',
    [`x3p${suffix}`]: 'n',
    [`x3pa${suffix}`]: 'n',
    x3p_percent: 'n',
    [`x2p${suffix}`]: 'n',
    [`x2pa${suffix}`]: 'n',
    x2p_percent: 'n',
    [`ft${suffix}`]: 'n',
    [`fta${suffix}`]: 'n',
    ft_percent: 'n',
    [`orb${suffix}`]: 'n',
    [`drb${suffix}`]: 'n',
    [`trb${suffix}`]: 'n',
    [`ast${suffix}`]: 'n',
    [`stl${suffix}`]: 'n',
    [`blk${suffix}`]: 'n',
    [`tov${suffix}`]: 'n',
    [`pf${suffix}`]: 'n',
    [`pts${suffix}`]: 'n',
  }) as const

export const PER_100 = {
  ...PLAYER_GAMES,
  fg_per_100_poss: 'n',
  fga_per_100_poss: 'n',
  fg_percent: 'n',
  x3p_per_100_poss: 'n',
  x3pa_per_100_poss: 'n',
  x3p_percent: 'n',
  x2p_per_100_poss: 'n',
  x2pa_per_100_poss: 'n',
  x2p_percent: 'n',
  e_fg_percent: 'n',
  ft_per_100_poss: 'n',
  fta_per_100_poss: 'n',
  ft_percent: 'n',
  orb_per_100_poss: 'n',
  drb_per_100_poss: 'n',
  trb_per_100_poss: 'n',
  ast_per_100_poss: 'n',
  stl_per_100_poss: 'n',
  blk_per_100_poss: 'n',
  tov_per_100_poss: 'n',
  pf_per_100_poss: 'n',
  pts_per_100_poss: 'n',
  o_rtg: 'n',
  d_rtg: 'n',
} as const
export type Per100 = RowOf<typeof PER_100>
export function loadPer100(range?: Range): Per100[] {
  return nbaSeasons(loadTable('Per 100 Poss.csv', PER_100), range)
}

export const PER_36 = {
  ...PLAYER_GAMES,
  fg_per_36_min: 'n',
  fga_per_36_min: 'n',
  fg_percent: 'n',
  x3p_per_36_min: 'n',
  x3pa_per_36_min: 'n',
  x3p_percent: 'n',
  x2p_per_36_min: 'n',
  x2pa_per_36_min: 'n',
  x2p_percent: 'n',
  e_fg_percent: 'n',
  ft_per_36_min: 'n',
  fta_per_36_min: 'n',
  ft_percent: 'n',
  orb_per_36_min: 'n',
  drb_per_36_min: 'n',
  trb_per_36_min: 'n',
  ast_per_36_min: 'n',
  stl_per_36_min: 'n',
  blk_per_36_min: 'n',
  tov_per_36_min: 'n',
  pf_per_36_min: 'n',
  pts_per_36_min: 'n',
} as const
export type Per36 = RowOf<typeof PER_36>
export function loadPer36(range?: Range): Per36[] {
  return nbaSeasons(loadTable('Per 36 Minutes.csv', PER_36), range)
}

export const PER_GAME = {
  ...PLAYER_SEASON,
  g: 'n',
  gs: 'n',
  mp_per_game: 'n',
  fg_per_game: 'n',
  fga_per_game: 'n',
  fg_percent: 'n',
  x3p_per_game: 'n',
  x3pa_per_game: 'n',
  x3p_percent: 'n',
  x2p_per_game: 'n',
  x2pa_per_game: 'n',
  x2p_percent: 'n',
  e_fg_percent: 'n',
  ft_per_game: 'n',
  fta_per_game: 'n',
  ft_percent: 'n',
  orb_per_game: 'n',
  drb_per_game: 'n',
  trb_per_game: 'n',
  ast_per_game: 'n',
  stl_per_game: 'n',
  blk_per_game: 'n',
  tov_per_game: 'n',
  pf_per_game: 'n',
  pts_per_game: 'n',
} as const
export type PerGame = RowOf<typeof PER_GAME>
export function loadPerGame(range?: Range): PerGame[] {
  return nbaSeasons(loadTable('Player Per Game.csv', PER_GAME), range)
}

export const TOTALS = { ...PLAYER_GAMES, ...BOX_CORE(''), e_fg_percent: 'n', trp_dbl: 'n' } as const
export type Totals = RowOf<typeof TOTALS>
/** All rows in file order: one per team stint plus a TOT/2TM row for traded players. */
export function loadTotals(range?: Range): Totals[] {
  return nbaSeasons(loadTable('Player Totals.csv', TOTALS), range)
}
/** Only the per-team stint rows (combined rows dropped). */
export function totalsStints(rows: Totals[]): Totals[] {
  return rows.filter((r) => !isTotalRow(r.team))
}

export const PLAY_BY_PLAY = {
  ...PLAYER_GAMES,
  pg_percent: 'n',
  sg_percent: 'n',
  sf_percent: 'n',
  pf_percent: 'n',
  c_percent: 'n',
  on_court_plus_minus_per_100_poss: 'n',
  net_plus_minus_per_100_poss: 'n',
  bad_pass_turnover: 'n',
  lost_ball_turnover: 'n',
  shooting_foul_committed: 'n',
  offensive_foul_committed: 'n',
  shooting_foul_drawn: 'n',
  offensive_foul_drawn: 'n',
  points_generated_by_assists: 'n',
  and1: 'n',
  fga_blocked: 'n',
} as const
export type PlayByPlay = RowOf<typeof PLAY_BY_PLAY>
export function loadPlayByPlay(range?: Range): PlayByPlay[] {
  return nbaSeasons(loadTable('Player Play By Play.csv', PLAY_BY_PLAY), range)
}

export const SHOOTING = {
  ...PLAYER_GAMES,
  fg_percent: 'n',
  avg_dist_fga: 'n',
  percent_fga_from_x2p_range: 'n',
  percent_fga_from_x0_3_range: 'n',
  percent_fga_from_x3_10_range: 'n',
  percent_fga_from_x10_16_range: 'n',
  percent_fga_from_x16_3p_range: 'n',
  percent_fga_from_x3p_range: 'n',
  fg_percent_from_x2p_range: 'n',
  fg_percent_from_x0_3_range: 'n',
  fg_percent_from_x3_10_range: 'n',
  fg_percent_from_x10_16_range: 'n',
  fg_percent_from_x16_3p_range: 'n',
  fg_percent_from_x3p_range: 'n',
  percent_assisted_x2p_fg: 'n',
  percent_assisted_x3p_fg: 'n',
  percent_dunks_of_fga: 'n',
  num_of_dunks: 'n',
  percent_corner_3s_of_3pa: 'n',
  corner_3_point_percent: 'n',
  num_heaves_attempted: 'n',
  num_heaves_made: 'n',
} as const
export type Shooting = RowOf<typeof SHOOTING>
export function loadShooting(range?: Range): Shooting[] {
  return nbaSeasons(loadTable('Player Shooting.csv', SHOOTING), range)
}

export const SEASON_INFO = { ...PLAYER_SEASON, experience: 'n' } as const
export type SeasonInfo = RowOf<typeof SEASON_INFO>
export function loadSeasonInfo(range?: Range): SeasonInfo[] {
  return nbaSeasons(loadTable('Player Season Info.csv', SEASON_INFO), range)
}

export const CAREER_INFO = {
  player: 'S',
  player_id: 'S',
  pos: 's',
  ht_in_in: 'n',
  wt: 'n',
  birth_date: 's',
  colleges: 's',
  from: 'N',
  to: 'N',
  debut: 's',
  hof: 'b',
} as const
export type CareerInfo = RowOf<typeof CAREER_INFO>
/** Players whose career overlaps [from, to]. No lg column in this file. */
export function loadCareerInfo(range: Range = {}): CareerInfo[] {
  const from = range.from ?? DEFAULT_RANGE.from
  const to = range.to ?? DEFAULT_RANGE.to
  return loadTable('Player Career Info.csv', CAREER_INFO).filter(
    (r) => r.to >= from && r.from <= to,
  )
}

// ---- draft

export const DRAFT = {
  season: 'N',
  lg: 'S',
  overall_pick: 'n',
  round: 'n',
  tm: 'S',
  player: 'S',
  player_id: 's',
  college: 's',
} as const
export type DraftPick = RowOf<typeof DRAFT>
/** season = draft year (2025 = the 2025 draft, rookies of 2025-26). */
export function loadDraft(range?: Range): DraftPick[] {
  return nbaSeasons(loadTable('Draft Pick History.csv', DRAFT), range)
}

// ---- team files. 'League Average' row has abbreviation NA.

const TEAM_SEASON = {
  season: 'N',
  lg: 'S',
  team: 'S',
  abbreviation: 's',
  playoffs: 'b',
} as const

export const TEAM_ABBREV = TEAM_SEASON
export type TeamAbbrev = RowOf<typeof TEAM_ABBREV>
export function loadTeamAbbrev(range?: Range): TeamAbbrev[] {
  return nbaSeasons(loadTable('Team Abbrev.csv', TEAM_ABBREV), range)
}

export const TEAM_SUMMARIES = {
  ...TEAM_SEASON,
  age: 'n',
  w: 'n',
  l: 'n',
  pw: 'n',
  pl: 'n',
  mov: 'n',
  sos: 'n',
  srs: 'n',
  o_rtg: 'n',
  d_rtg: 'n',
  n_rtg: 'n',
  pace: 'n',
  f_tr: 'n',
  x3p_ar: 'n',
  ts_percent: 'n',
  e_fg_percent: 'n',
  tov_percent: 'n',
  orb_percent: 'n',
  ft_fga: 'n',
  opp_e_fg_percent: 'n',
  opp_tov_percent: 'n',
  drb_percent: 'n',
  opp_ft_fga: 'n',
  arena: 's',
  attend: 'n',
  attend_g: 'n',
} as const
export type TeamSummary = RowOf<typeof TEAM_SUMMARIES>
/** Includes the 'League Average' row per season (abbreviation null). */
export function loadTeamSummaries(range?: Range): TeamSummary[] {
  return nbaSeasons(loadTable('Team Summaries.csv', TEAM_SUMMARIES), range)
}

export const TEAM_TOTALS = { ...TEAM_SEASON, g: 'n', mp: 'n', ...BOX_CORE('') } as const
export type TeamTotals = RowOf<typeof TEAM_TOTALS>
export function loadTeamTotals(range?: Range): TeamTotals[] {
  return nbaSeasons(loadTable('Team Totals.csv', TEAM_TOTALS), range)
}

export const TEAM_PER_GAME = {
  ...TEAM_SEASON,
  g: 'n',
  mp_per_game: 'n',
  ...BOX_CORE('_per_game'),
} as const
export type TeamPerGame = RowOf<typeof TEAM_PER_GAME>
export function loadTeamPerGame(range?: Range): TeamPerGame[] {
  return nbaSeasons(loadTable('Team Stats Per Game.csv', TEAM_PER_GAME), range)
}

export const TEAM_PER_100 = {
  ...TEAM_SEASON,
  g: 'n',
  mp: 'n',
  ...BOX_CORE('_per_100_poss'),
} as const
export type TeamPer100 = RowOf<typeof TEAM_PER_100>
export function loadTeamPer100(range?: Range): TeamPer100[] {
  return nbaSeasons(loadTable('Team Stats Per 100 Poss.csv', TEAM_PER_100), range)
}

const OPP_BOX = (suffix: string) => {
  const out: Record<string, 'n'> = {}
  for (const k of Object.keys(BOX_CORE(suffix))) out[`opp_${k}`] = 'n'
  return out
}

export const OPP_TOTALS = { ...TEAM_SEASON, g: 'n', mp: 'n', ...OPP_BOX('') } as const
export type OppTotals = RowOf<typeof OPP_TOTALS> & Record<`opp_${string}`, number | null>
export function loadOppTotals(range?: Range): OppTotals[] {
  return nbaSeasons(loadTable('Opponent Totals.csv', OPP_TOTALS), range) as OppTotals[]
}

export const OPP_PER_100 = { ...TEAM_SEASON, g: 'n', mp: 'n', ...OPP_BOX('_per_100_poss') } as const
export type OppPer100 = RowOf<typeof OPP_PER_100> & Record<`opp_${string}`, number | null>
export function loadOppPer100(range?: Range): OppPer100[] {
  return nbaSeasons(loadTable('Opponent Stats Per 100 Poss.csv', OPP_PER_100), range) as OppPer100[]
}
