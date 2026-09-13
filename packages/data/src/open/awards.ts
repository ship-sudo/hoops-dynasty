// Awards from sumitrodatta/bball-reference-datasets.
// Player Award Shares: award values 'nba mvp', 'nba roy', 'nba dpoy', 'nba smoy', 'nba mip', 'nba clutch_poy'.
// End of Season Teams: type 'All-NBA' | 'All-Defense' | 'All-Rookie', number_tm '1st' | '2nd' | '3rd'.
// All-Star Selections: one row per selection; team is the All-Star side, not the NBA team.

import { DEFAULT_RANGE, loadTable, nbaSeasons, type Range, type RowOf } from './bref.ts'

export const AWARD_SHARES = {
  season: 'N',
  award: 'S',
  player: 'S',
  /** NA for a few pre-1998 rows. */
  player_id: 's',
  age: 'n',
  first: 'n',
  pts_won: 'n',
  pts_max: 'n',
  share: 'n',
  winner: 'b',
} as const
export type AwardShare = RowOf<typeof AWARD_SHARES>

/** NBA award votes (award starts with 'nba ') in [from, to]. No lg column in this file. */
export function loadAwardShares(range: Range = {}): AwardShare[] {
  const from = range.from ?? DEFAULT_RANGE.from
  const to = range.to ?? DEFAULT_RANGE.to
  return loadTable('Player Award Shares.csv', AWARD_SHARES).filter(
    (r) => r.award.startsWith('nba ') && r.season >= from && r.season <= to,
  )
}

/** Winners only, optionally for one award ('nba mvp', ...). */
export function awardWinners(rows: AwardShare[], award?: string): AwardShare[] {
  return rows.filter((r) => r.winner === true && (award === undefined || r.award === award))
}

export const END_OF_SEASON_TEAMS = {
  season: 'N',
  lg: 'S',
  type: 'S',
  number_tm: 'S',
  player: 'S',
  player_id: 'S',
  position: 's',
} as const
export type EndOfSeasonTeam = RowOf<typeof END_OF_SEASON_TEAMS>
export function loadEndOfSeasonTeams(range?: Range): EndOfSeasonTeam[] {
  return nbaSeasons(loadTable('End of Season Teams.csv', END_OF_SEASON_TEAMS), range)
}

export const END_OF_SEASON_VOTING = {
  season: 'N',
  lg: 'S',
  type: 'S',
  number_tm: 'S',
  position: 's',
  player: 'S',
  player_id: 'S',
  age: 'n',
  pts_won: 'n',
  pts_max: 'n',
  share: 'n',
  x1st_tm: 'n',
  x2nd_tm: 'n',
  x3rd_tm: 'n',
} as const
export type EndOfSeasonVoting = RowOf<typeof END_OF_SEASON_VOTING>
/** Vote totals per candidate. type is 'all_nba' | 'all_defense' | 'all_rookie'; ORV = others receiving votes. */
export function loadEndOfSeasonVoting(range?: Range): EndOfSeasonVoting[] {
  return nbaSeasons(loadTable('End of Season Teams (Voting).csv', END_OF_SEASON_VOTING), range)
}

export const ALL_STAR = {
  player: 'S',
  player_id: 'S',
  team: 'S',
  season: 'N',
  lg: 'S',
  replaced: 'b',
} as const
export type AllStar = RowOf<typeof ALL_STAR>
export function loadAllStarSelections(range?: Range): AllStar[] {
  return nbaSeasons(loadTable('All-Star Selections.csv', ALL_STAR), range)
}

/** Highest season in a set of rows, or null when empty. */
export function latestSeason(rows: { season: number }[]): number | null {
  let max: number | null = null
  for (const r of rows) if (max === null || r.season > max) max = r.season
  return max
}
