// One typed function per stats.nba.com endpoint. All go through nbaGet (cached, rate-limited).
// Parameter sets mirror swar/nba_api defaults, which are proven to return 200 from Node fetch.

import {
  DASH_DEFAULTS,
  type NbaResponse,
  nbaGet,
  type Params,
  type Row,
  seasonId,
} from './client.ts'

export type SeasonType = 'Regular Season' | 'Playoffs' | 'PlayIn'
export type MeasureType = 'Base' | 'Advanced'
export type PerMode = 'Totals' | 'PerGame' | 'Per100Possessions'

export const FIRST_SEASON = 1998
export const LAST_SEASON = 2026

/** Named result set, or the first one if the name is missing. */
export function resultRows(res: NbaResponse, name: string): Row[] {
  return res[name] ?? Object.values(res)[0] ?? []
}

/** leaguedashplayerbiostats, PerGame, Regular Season. Age, height, weight, draft slot. */
export async function fetchPlayerBio(yearEnd: number): Promise<Row[]> {
  const res = await nbaGet('leaguedashplayerbiostats', {
    ...DASH_DEFAULTS,
    PerMode: 'PerGame',
    Season: seasonId(yearEnd),
    SeasonType: 'Regular Season',
  })
  return resultRows(res, 'LeagueDashPlayerBioStats')
}

/** leaguedashplayerstats for one measure/per-mode/season-type combo. */
export async function fetchPlayerStats(
  yearEnd: number,
  measure: MeasureType,
  perMode: PerMode,
  seasonType: SeasonType = 'Regular Season',
): Promise<Row[]> {
  const res = await nbaGet('leaguedashplayerstats', {
    ...DASH_DEFAULTS,
    MeasureType: measure,
    PerMode: perMode,
    Season: seasonId(yearEnd),
    SeasonType: seasonType,
  })
  return resultRows(res, 'LeagueDashPlayerStats')
}

export const fetchPlayerPer100 = (yearEnd: number) =>
  fetchPlayerStats(yearEnd, 'Base', 'Per100Possessions')
export const fetchPlayerTotals = (yearEnd: number, seasonType: SeasonType = 'Regular Season') =>
  fetchPlayerStats(yearEnd, 'Base', 'Totals', seasonType)
export const fetchPlayerAdvanced = (yearEnd: number) =>
  fetchPlayerStats(yearEnd, 'Advanced', 'PerGame')

/** leaguedashteamstats for one measure/per-mode/season-type combo. */
export async function fetchTeamStats(
  yearEnd: number,
  measure: MeasureType,
  perMode: PerMode,
  seasonType: SeasonType = 'Regular Season',
): Promise<Row[]> {
  const res = await nbaGet('leaguedashteamstats', {
    ...DASH_DEFAULTS,
    MeasureType: measure,
    PerMode: perMode,
    Season: seasonId(yearEnd),
    SeasonType: seasonType,
  })
  return resultRows(res, 'LeagueDashTeamStats')
}

export const fetchTeamTotals = (yearEnd: number, seasonType: SeasonType = 'Regular Season') =>
  fetchTeamStats(yearEnd, 'Base', 'Totals', seasonType)
export const fetchTeamAdvanced = (yearEnd: number) => fetchTeamStats(yearEnd, 'Advanced', 'PerGame')

/** leaguegamelog: one row per team-game (T) or player-game (P). Counter=1000 does not truncate. */
export async function fetchGameLog(
  yearEnd: number,
  playerOrTeam: 'T' | 'P',
  seasonType: SeasonType = 'Regular Season',
): Promise<Row[]> {
  const params: Params = {
    LeagueID: '00',
    Season: seasonId(yearEnd),
    SeasonType: seasonType,
    PlayerOrTeam: playerOrTeam,
    Counter: 1000,
    Sorter: 'DATE',
    Direction: 'DESC',
    DateFrom: '',
    DateTo: '',
  }
  const res = await nbaGet('leaguegamelog', params)
  return resultRows(res, 'LeagueGameLog')
}

/** leaguestandingsv3, Regular Season. One row per team. */
export async function fetchStandings(yearEnd: number): Promise<Row[]> {
  const res = await nbaGet('leaguestandingsv3', {
    LeagueID: '00',
    Season: seasonId(yearEnd),
    SeasonType: 'Regular Season',
  })
  return resultRows(res, 'Standings')
}

/** commonteamroster for one team-season. Returns the player rows; coaches are dropped. */
export async function fetchTeamRoster(yearEnd: number, teamId: number): Promise<Row[]> {
  const res = await nbaGet('commonteamroster', {
    TeamID: teamId,
    Season: seasonId(yearEnd),
    LeagueID: '00',
  })
  return resultRows(res, 'CommonTeamRoster')
}

/** commonteamroster coaches result set for one team-season. */
export async function fetchTeamCoaches(yearEnd: number, teamId: number): Promise<Row[]> {
  const res = await nbaGet('commonteamroster', {
    TeamID: teamId,
    Season: seasonId(yearEnd),
    LeagueID: '00',
  })
  return res.Coaches ?? []
}

/** drafthistory, every draft on record. One request, not per season. */
export async function fetchDraftHistory(): Promise<Row[]> {
  const res = await nbaGet('drafthistory', { LeagueID: '00' })
  return resultRows(res, 'DraftHistory')
}

/** commonallplayers with IsOnlyCurrentSeason=0: every player id ever. One request. */
export async function fetchAllPlayers(): Promise<Row[]> {
  const res = await nbaGet('commonallplayers', {
    LeagueID: '00',
    Season: seasonId(LAST_SEASON),
    IsOnlyCurrentSeason: 0,
  })
  return resultRows(res, 'CommonAllPlayers')
}

/** Team ids present in a season's leaguedashteamstats. 29 through 2004, 30 after. */
export async function fetchTeamIds(yearEnd: number): Promise<number[]> {
  const rows = await fetchTeamTotals(yearEnd)
  return rows.map((r) => Number(r.TEAM_ID)).filter((n) => Number.isFinite(n))
}
