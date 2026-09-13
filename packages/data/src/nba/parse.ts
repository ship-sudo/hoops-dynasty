// Clean typed rows from cached stats.nba.com responses. snake_case, real numbers, nulls for blanks.
// Every function reads through the endpoint functions, so it works offline once the cache is warm.
//
// Trap: leaguedash* endpoints list a traded player ONCE, under the team he finished the season with,
// with stats summed across teams. Per-game team membership comes from playerGames().

import type { Cell, Row } from './client.ts'
import {
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
  type SeasonType,
} from './endpoints.ts'

export type SeasonTypeKey = 'regular' | 'playoffs' | 'playin'

const SEASON_TYPE_KEY: Record<SeasonType, SeasonTypeKey> = {
  'Regular Season': 'regular',
  Playoffs: 'playoffs',
  PlayIn: 'playin',
}

// ---- cell helpers -------------------------------------------------------

/** Number or null. Blank, null, and non-numeric strings ('Undrafted') become null. */
export function num(v: Cell | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Integer or null. */
export function int(v: Cell | undefined): number | null {
  const n = num(v)
  return n === null ? null : Math.trunc(n)
}

/** Trimmed string or null when blank. */
export function str(v: Cell | undefined): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** '6-5' or `6'5"` to 77. Null when unparseable. */
export function heightToInches(h: Cell | undefined): number | null {
  const s = str(h)
  if (!s) return null
  const m = s.match(/^(\d+)\s*[-'’]\s*(\d+)/)
  if (!m) return null
  return Number(m[1]) * 12 + Number(m[2])
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
}

/** 'APR 29, 1978' to '1978-04-29'. Null when unparseable. */
export function birthDateIso(v: Cell | undefined): string | null {
  const s = str(v)
  if (!s) return null
  const m = s.toUpperCase().match(/^([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})/)
  if (!m || !MONTHS[m[1] ?? '']) return null
  return `${m[3]}-${MONTHS[m[1] ?? '']}-${String(m[2]).padStart(2, '0')}`
}

/** Roster EXP: 'R' (rookie) to 0, '3' to 3. */
export function experienceYears(v: Cell | undefined): number | null {
  const s = str(v)
  if (!s) return null
  if (s.toUpperCase() === 'R') return 0
  return int(s)
}

/** 'HOU @ DEN' to away vs DEN; 'GSW vs. MEM' to home vs MEM. */
export function matchupSide(matchup: Cell | undefined): { home: boolean; opponent: string | null } {
  const s = str(matchup) ?? ''
  const away = s.includes(' @ ')
  const parts = s.split(/\s+(?:@|vs\.?)\s+/)
  return { home: !away, opponent: str(parts[1] ?? null) }
}

// ---- row types ----------------------------------------------------------

export interface PlayerBio {
  season: number
  player_id: number
  player_name: string
  team_id: number
  team_abbr: string | null
  age: number | null
  height: string | null
  height_in: number | null
  weight: number | null
  college: string | null
  country: string | null
  draft_year: number | null
  draft_round: number | null
  draft_number: number | null
  gp: number | null
  pts: number | null
  reb: number | null
  ast: number | null
  net_rating: number | null
  oreb_pct: number | null
  dreb_pct: number | null
  usg_pct: number | null
  ts_pct: number | null
  ast_pct: number | null
}

/** Box-score shape shared by per-100, totals, team totals, and game logs. */
export interface BoxLine {
  min: number | null
  fgm: number | null
  fga: number | null
  fg_pct: number | null
  fg3m: number | null
  fg3a: number | null
  fg3_pct: number | null
  ftm: number | null
  fta: number | null
  ft_pct: number | null
  oreb: number | null
  dreb: number | null
  reb: number | null
  ast: number | null
  tov: number | null
  stl: number | null
  blk: number | null
  pf: number | null
  pts: number | null
  plus_minus: number | null
}

export interface PlayerBase extends BoxLine {
  season: number
  season_type: SeasonTypeKey
  player_id: number
  player_name: string
  team_id: number
  team_abbr: string | null
  age: number | null
  gp: number | null
  w: number | null
  l: number | null
  blka: number | null
  pfd: number | null
}

export interface PlayerAdvanced {
  season: number
  player_id: number
  player_name: string
  team_id: number
  team_abbr: string | null
  age: number | null
  gp: number | null
  w: number | null
  l: number | null
  min: number | null
  off_rating: number | null
  def_rating: number | null
  net_rating: number | null
  ast_pct: number | null
  ast_to: number | null
  ast_ratio: number | null
  oreb_pct: number | null
  dreb_pct: number | null
  reb_pct: number | null
  tm_tov_pct: number | null
  efg_pct: number | null
  ts_pct: number | null
  usg_pct: number | null
  pace: number | null
  pie: number | null
  poss: number | null
}

export interface TeamTotals extends BoxLine {
  season: number
  season_type: SeasonTypeKey
  team_id: number
  team_name: string
  gp: number | null
  w: number | null
  l: number | null
  blka: number | null
  pfd: number | null
}

export interface TeamAdvanced {
  season: number
  team_id: number
  team_name: string
  gp: number | null
  w: number | null
  l: number | null
  min: number | null
  off_rating: number | null
  def_rating: number | null
  net_rating: number | null
  ast_pct: number | null
  ast_to: number | null
  ast_ratio: number | null
  oreb_pct: number | null
  dreb_pct: number | null
  reb_pct: number | null
  tm_tov_pct: number | null
  efg_pct: number | null
  ts_pct: number | null
  pace: number | null
  poss: number | null
  pie: number | null
}

export interface TeamGame extends BoxLine {
  season: number
  season_type: SeasonTypeKey
  season_id: string
  game_id: string
  game_date: string
  team_id: number
  team_abbr: string | null
  team_name: string | null
  matchup: string
  home: boolean
  opponent_abbr: string | null
  wl: 'W' | 'L' | null
}

export interface PlayerGame extends BoxLine {
  season: number
  season_type: SeasonTypeKey
  season_id: string
  game_id: string
  game_date: string
  player_id: number
  player_name: string
  team_id: number
  team_abbr: string | null
  matchup: string
  home: boolean
  opponent_abbr: string | null
  wl: 'W' | 'L' | null
}

export interface Standing {
  season: number
  season_id: string
  team_id: number
  team_city: string | null
  team_name: string | null
  conference: string | null
  division: string | null
  wins: number | null
  losses: number | null
  win_pct: number | null
  playoff_rank: number | null
  division_rank: number | null
  league_rank: number | null
  conference_record: string | null
  division_record: string | null
  home_record: string | null
  road_record: string | null
  points_pg: number | null
  opp_points_pg: number | null
  clinch_indicator: string | null
  clinched_playoff: number | null
  clinched_playin: number | null
}

export interface RosterPlayer {
  season: number
  team_id: number
  player_id: number
  player_name: string
  jersey: string | null
  position: string | null
  height: string | null
  height_in: number | null
  weight: number | null
  birth_date: string | null
  age: number | null
  experience: number | null
  school: string | null
  how_acquired: string | null
}

export interface DraftPick {
  person_id: number
  player_name: string
  season: number
  round_number: number | null
  round_pick: number | null
  overall_pick: number | null
  draft_type: string | null
  team_id: number
  team_city: string | null
  team_name: string | null
  team_abbr: string | null
  organization: string | null
  organization_type: string | null
}

export interface AllPlayer {
  person_id: number
  name: string
  roster_status: number | null
  from_year: number | null
  to_year: number | null
  player_code: string | null
  team_id: number | null
  team_abbr: string | null
  games_played: boolean
}

// ---- mappers (exported for fixture tests) -------------------------------

function box(r: Row): BoxLine {
  return {
    min: num(r.MIN),
    fgm: num(r.FGM),
    fga: num(r.FGA),
    fg_pct: num(r.FG_PCT),
    fg3m: num(r.FG3M),
    fg3a: num(r.FG3A),
    fg3_pct: num(r.FG3_PCT),
    ftm: num(r.FTM),
    fta: num(r.FTA),
    ft_pct: num(r.FT_PCT),
    oreb: num(r.OREB),
    dreb: num(r.DREB),
    reb: num(r.REB),
    ast: num(r.AST),
    tov: num(r.TOV),
    stl: num(r.STL),
    blk: num(r.BLK),
    pf: num(r.PF),
    pts: num(r.PTS),
    plus_minus: num(r.PLUS_MINUS),
  }
}

const wl = (v: Cell | undefined): 'W' | 'L' | null => (v === 'W' || v === 'L' ? v : null)

export function mapPlayerBio(r: Row, season: number): PlayerBio {
  return {
    season,
    player_id: Number(r.PLAYER_ID),
    player_name: str(r.PLAYER_NAME) ?? '',
    team_id: Number(r.TEAM_ID),
    team_abbr: str(r.TEAM_ABBREVIATION),
    age: num(r.AGE),
    height: str(r.PLAYER_HEIGHT),
    height_in: int(r.PLAYER_HEIGHT_INCHES) ?? heightToInches(r.PLAYER_HEIGHT),
    weight: num(r.PLAYER_WEIGHT),
    college: str(r.COLLEGE),
    country: str(r.COUNTRY),
    draft_year: int(r.DRAFT_YEAR),
    draft_round: int(r.DRAFT_ROUND),
    draft_number: int(r.DRAFT_NUMBER),
    gp: num(r.GP),
    pts: num(r.PTS),
    reb: num(r.REB),
    ast: num(r.AST),
    net_rating: num(r.NET_RATING),
    oreb_pct: num(r.OREB_PCT),
    dreb_pct: num(r.DREB_PCT),
    usg_pct: num(r.USG_PCT),
    ts_pct: num(r.TS_PCT),
    ast_pct: num(r.AST_PCT),
  }
}

export function mapPlayerBase(r: Row, season: number, seasonType: SeasonTypeKey): PlayerBase {
  return {
    season,
    season_type: seasonType,
    player_id: Number(r.PLAYER_ID),
    player_name: str(r.PLAYER_NAME) ?? '',
    team_id: Number(r.TEAM_ID),
    team_abbr: str(r.TEAM_ABBREVIATION),
    age: num(r.AGE),
    gp: num(r.GP),
    w: num(r.W),
    l: num(r.L),
    ...box(r),
    blka: num(r.BLKA),
    pfd: num(r.PFD),
  }
}

export function mapPlayerAdvanced(r: Row, season: number): PlayerAdvanced {
  return {
    season,
    player_id: Number(r.PLAYER_ID),
    player_name: str(r.PLAYER_NAME) ?? '',
    team_id: Number(r.TEAM_ID),
    team_abbr: str(r.TEAM_ABBREVIATION),
    age: num(r.AGE),
    gp: num(r.GP),
    w: num(r.W),
    l: num(r.L),
    min: num(r.MIN),
    off_rating: num(r.OFF_RATING),
    def_rating: num(r.DEF_RATING),
    net_rating: num(r.NET_RATING),
    ast_pct: num(r.AST_PCT),
    ast_to: num(r.AST_TO),
    ast_ratio: num(r.AST_RATIO),
    oreb_pct: num(r.OREB_PCT),
    dreb_pct: num(r.DREB_PCT),
    reb_pct: num(r.REB_PCT),
    tm_tov_pct: num(r.TM_TOV_PCT),
    efg_pct: num(r.EFG_PCT),
    ts_pct: num(r.TS_PCT),
    usg_pct: num(r.USG_PCT),
    pace: num(r.PACE),
    pie: num(r.PIE),
    poss: num(r.POSS),
  }
}

export function mapTeamTotals(r: Row, season: number, seasonType: SeasonTypeKey): TeamTotals {
  return {
    season,
    season_type: seasonType,
    team_id: Number(r.TEAM_ID),
    team_name: str(r.TEAM_NAME) ?? '',
    gp: num(r.GP),
    w: num(r.W),
    l: num(r.L),
    ...box(r),
    blka: num(r.BLKA),
    pfd: num(r.PFD),
  }
}

export function mapTeamAdvanced(r: Row, season: number): TeamAdvanced {
  return {
    season,
    team_id: Number(r.TEAM_ID),
    team_name: str(r.TEAM_NAME) ?? '',
    gp: num(r.GP),
    w: num(r.W),
    l: num(r.L),
    min: num(r.MIN),
    off_rating: num(r.OFF_RATING),
    def_rating: num(r.DEF_RATING),
    net_rating: num(r.NET_RATING),
    ast_pct: num(r.AST_PCT),
    ast_to: num(r.AST_TO),
    ast_ratio: num(r.AST_RATIO),
    oreb_pct: num(r.OREB_PCT),
    dreb_pct: num(r.DREB_PCT),
    reb_pct: num(r.REB_PCT),
    tm_tov_pct: num(r.TM_TOV_PCT),
    efg_pct: num(r.EFG_PCT),
    ts_pct: num(r.TS_PCT),
    pace: num(r.PACE),
    poss: num(r.POSS),
    pie: num(r.PIE),
  }
}

export function mapTeamGame(r: Row, season: number, seasonType: SeasonTypeKey): TeamGame {
  const side = matchupSide(r.MATCHUP)
  return {
    season,
    season_type: seasonType,
    season_id: str(r.SEASON_ID) ?? '',
    game_id: str(r.GAME_ID) ?? '',
    game_date: str(r.GAME_DATE) ?? '',
    team_id: Number(r.TEAM_ID),
    team_abbr: str(r.TEAM_ABBREVIATION),
    team_name: str(r.TEAM_NAME),
    matchup: str(r.MATCHUP) ?? '',
    home: side.home,
    opponent_abbr: side.opponent,
    wl: wl(r.WL),
    ...box(r),
  }
}

export function mapPlayerGame(r: Row, season: number, seasonType: SeasonTypeKey): PlayerGame {
  const side = matchupSide(r.MATCHUP)
  return {
    season,
    season_type: seasonType,
    season_id: str(r.SEASON_ID) ?? '',
    game_id: str(r.GAME_ID) ?? '',
    game_date: str(r.GAME_DATE) ?? '',
    player_id: Number(r.PLAYER_ID),
    player_name: str(r.PLAYER_NAME) ?? '',
    team_id: Number(r.TEAM_ID),
    team_abbr: str(r.TEAM_ABBREVIATION),
    matchup: str(r.MATCHUP) ?? '',
    home: side.home,
    opponent_abbr: side.opponent,
    wl: wl(r.WL),
    ...box(r),
  }
}

export function mapStanding(r: Row, season: number): Standing {
  return {
    season,
    season_id: str(r.SeasonID) ?? '',
    team_id: Number(r.TeamID),
    team_city: str(r.TeamCity),
    team_name: str(r.TeamName),
    conference: str(r.Conference),
    division: str(r.Division),
    wins: int(r.WINS),
    losses: int(r.LOSSES),
    win_pct: num(r.WinPCT),
    playoff_rank: int(r.PlayoffRank),
    division_rank: int(r.DivisionRank),
    league_rank: int(r.LeagueRank),
    conference_record: str(r.ConferenceRecord),
    division_record: str(r.DivisionRecord),
    home_record: str(r.HOME),
    road_record: str(r.ROAD),
    points_pg: num(r.PointsPG),
    opp_points_pg: num(r.OppPointsPG),
    clinch_indicator: str(r.ClinchIndicator),
    clinched_playoff: int(r.ClinchedPlayoffBirth),
    clinched_playin: int(r.ClinchedPlayIn),
  }
}

export function mapRosterPlayer(r: Row, season: number, teamId: number): RosterPlayer {
  return {
    season,
    team_id: teamId,
    player_id: Number(r.PLAYER_ID),
    player_name: str(r.PLAYER) ?? '',
    jersey: str(r.NUM),
    position: str(r.POSITION),
    height: str(r.HEIGHT),
    height_in: heightToInches(r.HEIGHT),
    weight: num(r.WEIGHT),
    birth_date: birthDateIso(r.BIRTH_DATE),
    age: num(r.AGE),
    experience: experienceYears(r.EXP),
    school: str(r.SCHOOL),
    how_acquired: str(r.HOW_ACQUIRED),
  }
}

export function mapDraftPick(r: Row): DraftPick {
  return {
    person_id: Number(r.PERSON_ID),
    player_name: str(r.PLAYER_NAME) ?? '',
    season: int(r.SEASON) ?? 0,
    round_number: int(r.ROUND_NUMBER),
    round_pick: int(r.ROUND_PICK),
    overall_pick: int(r.OVERALL_PICK),
    draft_type: str(r.DRAFT_TYPE),
    team_id: Number(r.TEAM_ID),
    team_city: str(r.TEAM_CITY),
    team_name: str(r.TEAM_NAME),
    team_abbr: str(r.TEAM_ABBREVIATION),
    organization: str(r.ORGANIZATION),
    organization_type: str(r.ORGANIZATION_TYPE),
  }
}

export function mapAllPlayer(r: Row): AllPlayer {
  return {
    person_id: Number(r.PERSON_ID),
    name: str(r.DISPLAY_FIRST_LAST) ?? '',
    roster_status: int(r.ROSTERSTATUS),
    from_year: int(r.FROM_YEAR),
    to_year: int(r.TO_YEAR),
    player_code: str(r.PLAYERCODE),
    team_id: int(r.TEAM_ID) || null,
    team_abbr: str(r.TEAM_ABBREVIATION),
    games_played: r.GAMES_PLAYED_FLAG === 'Y',
  }
}

// ---- readers (cache-backed) ---------------------------------------------

export async function playerBio(yearEnd: number): Promise<PlayerBio[]> {
  return (await fetchPlayerBio(yearEnd)).map((r) => mapPlayerBio(r, yearEnd))
}

/** Base stats per 100 possessions, regular season. Traded players: one row, last team. */
export async function playerPer100(yearEnd: number): Promise<PlayerBase[]> {
  return (await fetchPlayerPer100(yearEnd)).map((r) => mapPlayerBase(r, yearEnd, 'regular'))
}

/** Season totals, regular season plus playoffs. Traded players: one row, last team. */
export async function playerTotals(yearEnd: number): Promise<PlayerBase[]> {
  const rs = (await fetchPlayerTotals(yearEnd)).map((r) => mapPlayerBase(r, yearEnd, 'regular'))
  const po = (await fetchPlayerTotals(yearEnd, 'Playoffs')).map((r) =>
    mapPlayerBase(r, yearEnd, 'playoffs'),
  )
  return [...rs, ...po]
}

export async function playerAdvanced(yearEnd: number): Promise<PlayerAdvanced[]> {
  return (await fetchPlayerAdvanced(yearEnd)).map((r) => mapPlayerAdvanced(r, yearEnd))
}

/** Team totals, regular season plus playoffs. */
export async function teamTotals(yearEnd: number): Promise<TeamTotals[]> {
  const rs = (await fetchTeamTotals(yearEnd)).map((r) => mapTeamTotals(r, yearEnd, 'regular'))
  const po = (await fetchTeamTotals(yearEnd, 'Playoffs')).map((r) =>
    mapTeamTotals(r, yearEnd, 'playoffs'),
  )
  return [...rs, ...po]
}

export async function teamAdvanced(yearEnd: number): Promise<TeamAdvanced[]> {
  return (await fetchTeamAdvanced(yearEnd)).map((r) => mapTeamAdvanced(r, yearEnd))
}

/** PlayIn is empty before 2019-20; a failed PlayIn request counts as no games. */
async function gameLogOrEmpty(
  yearEnd: number,
  playerOrTeam: 'T' | 'P',
  seasonType: SeasonType,
): Promise<Row[]> {
  try {
    return await fetchGameLog(yearEnd, playerOrTeam, seasonType)
  } catch (e) {
    if (seasonType === 'PlayIn') return []
    throw e
  }
}

/** One row per team per game. Two rows per game. season_type marks RS / playoffs / play-in. */
export async function teamGames(yearEnd: number): Promise<TeamGame[]> {
  const out: TeamGame[] = []
  for (const st of ['Regular Season', 'Playoffs', 'PlayIn'] as const) {
    const rows = await gameLogOrEmpty(yearEnd, 'T', st)
    for (const r of rows) out.push(mapTeamGame(r, yearEnd, SEASON_TYPE_KEY[st]))
  }
  return out
}

/** One row per player per game. This is where per-game team membership lives. */
export async function playerGames(yearEnd: number): Promise<PlayerGame[]> {
  const out: PlayerGame[] = []
  for (const st of ['Regular Season', 'Playoffs'] as const) {
    const rows = await fetchGameLog(yearEnd, 'P', st)
    for (const r of rows) out.push(mapPlayerGame(r, yearEnd, SEASON_TYPE_KEY[st]))
  }
  return out
}

export async function standings(yearEnd: number): Promise<Standing[]> {
  return (await fetchStandings(yearEnd)).map((r) => mapStanding(r, yearEnd))
}

/** Every team's roster for the season, as stats.nba.com lists it (end-of-season snapshot). */
export async function rosters(yearEnd: number): Promise<RosterPlayer[]> {
  const out: RosterPlayer[] = []
  for (const teamId of await fetchTeamIds(yearEnd)) {
    const rows = await fetchTeamRoster(yearEnd, teamId)
    for (const r of rows) out.push(mapRosterPlayer(r, yearEnd, teamId))
  }
  return out
}

/** Every draft pick on record, all years. */
export async function draft(): Promise<DraftPick[]> {
  return (await fetchDraftHistory()).map(mapDraftPick)
}

/** Every player id stats.nba.com knows. */
export async function allPlayers(): Promise<AllPlayer[]> {
  return (await fetchAllPlayers()).map(mapAllPlayer)
}
