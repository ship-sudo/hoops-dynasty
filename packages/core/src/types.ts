// Shared types. The engine interface (GameInput → GameResult) is fixed here before the bake-off.
// Money is whole dollars. Heights are inches. Weights are pounds. Seasons are keyed by the year they end.

export type YearEnd = number // 1998 means the 1997-98 season
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C'

/** 0–100 on a fixed anchor: 50 = the pooled 1998–2026 league mean, 15 per sd. Not era-relative,
 * so a 1998 shooter keeps his number in 2010. Era differences come from Tendencies and EraContext. */
export interface Ratings {
  rim: number // finishing 0–3 ft
  close: number // 3–10 ft: floaters, post, short hooks
  mid: number // 10 ft to the arc
  three: number
  ft: number
  passing: number // creates assists
  handling: number // avoids turnovers under usage
  drawFoul: number
  oreb: number
  dreb: number
  perimD: number // stays in front, contests jumpers
  interiorD: number // rim protection, post defence
  steal: number
  block: number
  speed: number
  strength: number
  stamina: number
  iq: number // decision quality: shot selection, fouls, help rotations
  durability: number
}

export const RATING_KEYS = [
  'rim',
  'close',
  'mid',
  'three',
  'ft',
  'passing',
  'handling',
  'drawFoul',
  'oreb',
  'dreb',
  'perimD',
  'interiorD',
  'steal',
  'block',
  'speed',
  'strength',
  'stamina',
  'iq',
  'durability',
] as const satisfies readonly (keyof Ratings)[]

/** How a player plays, separate from how well. Shares are per shot attempt or per possession used. */
export interface Tendencies {
  usage: number // share of team possessions used while on the floor, 0–1 (league mean ≈ 0.20)
  shotRim: number // shot distribution by zone; the four sum to 1
  shotClose: number
  shotMid: number
  shotThree: number
  assist: number // assists per possession used, 0–1
  postUp: number // 0–1, flavour only
}

export interface PlayerGameInput {
  playerId: string
  name: string
  pos: Position
  heightIn: number
  weightLb: number
  age: number
  ratings: Ratings
  tendencies: Tendencies
  /** Coach's target minutes, 0–48. Engines may deviate for foul trouble, blowouts, overtime. */
  minutesTarget: number
  starter: boolean
  /** 0–1. Fatigue and injury knock this down. 1 = fresh. */
  condition: number
  /**
   * How hard he is being asked to work, as a multiplier on how fast he tires. 1 (or absent) is
   * normal and is what every engine saw before coaching instructions existed. A man told to get
   * after it on defence and crash the offensive glass runs further for the same minutes, and pays
   * for it in the fourth quarter. Engines that ignore it simply lose the cost, never the effect.
   */
  workRate?: number
}

/** Minimal tactics. -1 / 0 / +1 means less / normal / more. */
export interface Tactics {
  pace: -1 | 0 | 1
  threes: -1 | 0 | 1
  crashGlass: -1 | 0 | 1 // offensive rebounding vs transition defence
  pressure: -1 | 0 | 1 // defensive aggression: more steals and fouls
  zone: boolean // only honoured when EraContext.zoneLegal
}

export const DEFAULT_TACTICS: Tactics = {
  pace: 0,
  threes: 0,
  crashGlass: 0,
  pressure: 0,
  zone: false,
}

/**
 * Resolved five-man units the engine plays as groups. Absent means the greedy
 * minute-share rotation, which is what every untouched team still uses.
 */
export interface RotationUnits {
  starters: string[]
  bench: string[]
  closing: string[]
  /** Garbage time. Stars sit; this is whoever is left. */
  blowout: string[]
}

export interface TeamGameInput {
  teamId: string
  name: string
  players: PlayerGameInput[] // 8–15, starters first
  tactics: Tactics
  /**
   * Named rotation units. Left off entirely when the manager never set lineups, so a
   * save that never opened the screen produces a byte-identical input.
   */
  units?: RotationUnits
}

/** League baselines the engine must reproduce for an average-vs-average game in that season. */
export interface EraContext {
  yearEnd: YearEnd
  pace: number // possessions per team per 48 min
  ortg: number // points per 100 possessions
  threePAr: number // 3PA / FGA
  ftr: number // FTA / FGA
  tovPct: number // turnovers per 100 possessions
  orbPct: number // ORB / (ORB + opp DRB)
  fg3Pct: number
  fg2Pct: number
  ftPct: number
  astPct: number // share of made FG that were assisted
  stlPer100: number
  blkPer100: number
  pfPer100: number
  /** League shot mix by zone (shares sum to 1) and FG% by zone. rim 0–3 ft, close 3–10, mid 10 ft to the arc. */
  zoneShare: { rim: number; close: number; mid: number; three: number }
  zonePct: { rim: number; close: number; mid: number; three: number }
  homeWinPct: number // regular-season home win share that season
  handCheckBanned: boolean
  zoneLegal: boolean
}

export interface GameInput {
  era: EraContext
  home: TeamGameInput
  away: TeamGameInput
  seasonType: 'regular' | 'playin' | 'playoffs'
  neutralSite?: boolean
}

export interface StatLine {
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

export interface PlayerBox extends StatLine {
  playerId: string
  name: string
  starter: boolean
  plusMinus: number
}

export interface TeamBox {
  teamId: string
  pts: number
  quarters: number[] // 4 + overtimes
  possessions: number
  players: PlayerBox[]
  totals: StatLine
}

export interface PbpEvent {
  period: number
  clock: number // seconds remaining in the period
  team: 'home' | 'away'
  type: 'shot' | 'ft' | 'reb' | 'tov' | 'foul' | 'sub' | 'period' | 'other'
  playerId?: string
  made?: boolean
  points?: number
  text: string
}

export interface GameResult {
  home: TeamBox
  away: TeamBox
  winner: 'home' | 'away'
  overtimes: number
  pbp: PbpEvent[] // may be empty for engines that do not produce one
}

/** The one function every engine lane implements. Pure. Same input and seed → same result. */
export type SimulateGame = (input: GameInput, seed: number) => GameResult

export function emptyStatLine(): StatLine {
  return {
    min: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  }
}
