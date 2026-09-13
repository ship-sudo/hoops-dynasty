// What the game loads to start on opening night of a season, plus what "really happened" for comparison.
// Built by packages/data. Ratings and tendencies are filled by packages/ratings.

import type { EraContext, Position, Ratings, Tendencies, YearEnd } from './types.ts'

export interface TeamRecord {
  teamId: string
  abbr: string
  name: string // 'Spurs'
  city: string // 'San Antonio'
  conference: 'East' | 'West'
  division: string
  real: { wins: number; losses: number; playoffSeed: number | null }
}

export type ContractOption = null | 'player' | 'team' | 'early_termination'

export interface ContractYear {
  yearEnd: YearEnd
  amount: number
  option: ContractOption
  guaranteed: boolean
}

export type ContractKind = 'standard' | 'rookie_scale' | 'minimum' | 'two_way' | 'ten_day'

export interface Contract {
  teamId: string
  kind: ContractKind
  years: ContractYear[] // first entry is the bundle's season
  source: 'wayback' | 'bref_current' | 'inferred' | 'generated'
}

/** Real per-season numbers used to derive ratings and to judge the sim. Rates are per 100 possessions. */
export interface PlayerSeasonStats {
  gp: number
  gs: number
  min: number // total minutes
  totals: {
    fga: number
    fgm: number
    fg3a: number
    fg3m: number
    fta: number
    ftm: number
    oreb: number
    dreb: number
    ast: number
    tov: number
    stl: number
    blk: number
    pf: number
    pts: number
  }
  per100: {
    fga: number
    fgm: number
    fg3a: number
    fg3m: number
    fta: number
    ftm: number
    oreb: number
    dreb: number
    ast: number
    tov: number
    stl: number
    blk: number
    pf: number
    pts: number
  }
  pct: {
    fg: number | null
    fg3: number | null
    ft: number | null
    ts: number | null
    efg: number | null
  }
  adv: {
    usg: number | null
    astPct: number | null
    tovPct: number | null
    orbPct: number | null
    drbPct: number | null
    stlPct: number | null
    blkPct: number | null
    ortg: number | null
    drtg: number | null
    obpm: number | null
    dbpm: number | null
    bpm: number | null
    per: number | null
    ws48: number | null
  }
  shooting: {
    avgDist: number | null
    share0_3: number | null
    share3_10: number | null
    share10_16: number | null
    share16_3p: number | null
    share3p: number | null
    pct0_3: number | null
    pct3_10: number | null
    pct10_16: number | null
    pct16_3p: number | null
    pct3p: number | null
    assisted2p: number | null
    assisted3p: number | null
    dunkShare: number | null
    corner3Share: number | null
  } | null
  pbp: {
    posShares: { pg: number; sg: number; sf: number; pf: number; c: number } | null
    onCourtNet: number | null
    shootingFoulsDrawn: number | null
    and1: number | null
    fgaBlocked: number | null
    badPassTov: number | null
    lostBallTov: number | null
    shootingFoulsCommitted: number | null
    offFoulsCommitted: number | null
  } | null
}

export interface PlayerRecord {
  playerId: string
  brefId: string | null
  name: string
  birthDate: string | null
  age: number // on opening night
  heightIn: number
  weightLb: number
  pos: Position
  draft: { year: number; round: number; pick: number } | null
  yearsPro: number // seasons before this one
  yearsWithTeam: number // consecutive seasons ending on this team before this one; Bird rights need 3
  teamId: string // opening-night team
  contract: Contract | null
  ratings: Ratings
  tendencies: Tendencies
  /** Real stats this season, regular season only. Null for players with no minutes. */
  real: PlayerSeasonStats | null
  realMpg: number
}

export interface ScheduledGame {
  gameId: string
  date: string // ISO
  homeTeamId: string
  awayTeamId: string
  seasonType: 'regular' | 'playin' | 'playoffs'
  real: { homePts: number; awayPts: number } | null
}

export interface RealPlayoffSeries {
  round: number
  highTeamId: string
  lowTeamId: string
  winnerTeamId: string
  highWins: number
  lowWins: number
}

export interface RealAward {
  award: string
  playerId: string
  teamRank: number | null
  share: number | null
}

export interface SeasonBundle {
  yearEnd: YearEnd
  seasonId: string
  era: EraContext
  rules: unknown // EraRules from packages/data/src/era; typed there, opaque here
  teams: TeamRecord[]
  players: PlayerRecord[]
  schedule: ScheduledGame[] // regular season only; playoffs are simulated
  real: {
    /** Every team stint that season, so the harness can play traded players for the right team. */
    stints: { playerId: string; teamId: string; order: number; gp: number; mpg: number }[]
    playoffs: RealPlayoffSeries[]
    awards: RealAward[]
    draft: {
      draftYear: number
      overall: number
      round: number
      pick: number
      teamId: string
      playerId: string | null
      name: string
    }[]
  }
}

/** Counting stats for one real season. Optional on old history.json files; new bundles always write it. */
export interface CareerBox {
  gs: number
  min: number
  pts: number
  fgm: number
  fga: number
  fg3m: number
  fg3a: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  ast: number
  stl: number
  blk: number
  tov: number
  pf: number
}

/** One player's real career, one entry per season, for the historical draft mode and the fate slider. */
export interface CareerArc {
  playerId: string
  brefId: string | null
  name: string
  birthDate: string | null
  heightIn: number
  weightLb: number
  pos: Position
  draft: { year: number; round: number; pick: number } | null
  seasons: {
    yearEnd: YearEnd
    age: number
    teamId: string
    mpg: number
    gp: number
    /** Real box totals. Missing on history written before careers were seeded into the save. */
    box?: CareerBox
    ratings: Ratings
    tendencies: Tendencies
  }[]
  hof: boolean
}

export interface HistoryBundle {
  careers: CareerArc[] // every player with an NBA season 1998 onward
  drafts: Record<number, SeasonBundle['real']['draft']> // by draft year
  seasons: Record<
    YearEnd,
    {
      standings: { teamId: string; wins: number; losses: number; playoffSeed: number | null }[]
      playoffs: RealPlayoffSeries[]
      awards: RealAward[]
      champion: string | null
      runnerUp: string | null
    }
  >
}
