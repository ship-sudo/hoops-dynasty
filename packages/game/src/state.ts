// The whole save is one JSON-serialisable object. Reducers are pure: (state, hooks) -> { state, ... }.
// No I/O in here. The caller loads the bundle and passes it in.

import type {
  Contract,
  EraContext,
  EraRules,
  NamedLineups,
  OffenseSystemId,
  PlayerInstruction,
  Position,
  Ratings,
  Rng,
  SimulateGame,
  StatLine,
  Tactics,
  Tendencies,
  YearEnd,
} from '@hoops/core'
import type { Injury } from '@hoops/injury'
// Types only, so the cycle with history.ts is erased at compile time.
import type { GameRecord, HallOfFamer } from './history.ts'
import type { PlayerMorale } from './morale.ts'
// Same again for staff.ts.
import type { StaffState } from './staff.ts'

/** Where the league is in its year. `offseason` is the step that ages the league into the next season. */
export type Phase = 'regular' | 'playin' | 'playoffs' | 'lottery' | 'draft' | 'offseason'

export type Conference = 'East' | 'West'

export interface LeagueTeam {
  teamId: string
  abbr: string
  name: string
  city: string
  conference: Conference
  division: string
}

/** A player in the league. Real season stats from the bundle are dropped: saves stay small. */
export interface LeaguePlayer {
  playerId: string
  name: string
  pos: Position
  age: number
  heightIn: number
  weightLb: number
  yearsPro: number
  yearsWithTeam: number
  /** Season this player first played. `debutYear === season.yearEnd` is the rookie test. */
  debutYear: YearEnd
  /** null = free agent. Free agency is Phase 4; see hooks.freeAgency. */
  teamId: string | null
  contract: Contract | null
  ratings: Ratings
  tendencies: Tendencies
  /** Minutes per game hint used to seed the depth chart in the player's first simulated season. */
  mpgHint: number
  /**
   * The season `mpgHint` describes. The hint is what a player really played that year, so it is
   * gospel on opening night, a suggestion a year later and worthless after that; without a year on
   * it there is no way to know how stale it is. Absent for players the league generated.
   */
  hintYear?: YearEnd
  draft: { year: number; round: number; pick: number } | null
}

/** Who is fit, who is tired, who is hurt. One entry per player, rebuilt every season. */
export interface PlayerAvailability {
  /** Games he is still to miss, this one included. 0 means he is available. */
  out: number
  /** What is wrong with him, while something is. */
  injury: Injury | null
  /** 0–1. Heavy minutes drag it down, rest brings it back; the engine reads it as energy. */
  condition: number
  /** Games since he came back, for the ramp back to full condition. */
  sinceReturn: number
  /** Regular-season games missed so far. */
  missed: number
  /** Date of his team's last game, so rest days are real days and not a guess. */
  lastGame: string | null
}

export interface SeasonStatLine extends StatLine {
  gp: number
  gs: number
}

/** Running regular-season record. Everything the tiebreaker ladder needs is kept here. */
export interface TeamRecord {
  teamId: string
  wins: number
  losses: number
  pf: number
  pa: number
  divW: number
  divL: number
  confW: number
  confL: number
  /** Head to head, by opponent id. */
  h2h: Record<string, { w: number; l: number }>
}

export type SeasonType = 'regular' | 'playin' | 'playoffs'

/** One finished game. Box scores are not kept in the save; season totals are. */
export interface GameSummary {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
  homePts: number
  awayPts: number
  overtimes: number
  seasonType: SeasonType
}

export interface ScheduledGame {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
}

export interface SeriesState {
  round: number // 0 = first round, then conference semis, conference finals, finals
  bracket: Conference | 'Finals'
  highTeamId: string
  lowTeamId: string
  highWins: number
  lowWins: number
  bestOf: 5 | 7
  winnerTeamId: string | null
  games: GameSummary[]
}

export interface PlayInState {
  games: GameSummary[]
  /** Days played so far. Day 0 = 7v8 and 9v10, day 1 = the elimination game. */
  day: number
  done: boolean
}

export interface PlayoffState {
  /** Playoff field in seed order (index 0 = 1 seed). Fixed once the play-in resolves. */
  seeds: Record<Conference, string[]>
  rounds: SeriesState[][]
  championTeamId: string | null
  runnerUpTeamId: string | null
}

export interface DraftPick {
  overall: number
  round: number
  pick: number
  teamId: string
  /** null when no prospect pool was supplied. Player generation is not this package's lane. */
  prospectId: string | null
  name: string | null
}

export interface DraftState {
  draftYear: number
  /** Lottery result: team ids in pick order for round 1. */
  order: string[]
  picks: DraftPick[]
  done: boolean
  /**
   * Prospects still on the board, best first by the AI's reckoning. Filled when the draft opens so
   * the user can be handed the board and make his own pick; empty when no generator was supplied.
   */
  board: Prospect[]
  /** Index of the next pick to be made. */
  next: number
}

/** What an injected prospect generator must hand back. Ratings/potential are another lane's job. */
export interface Prospect {
  prospectId: string
  name: string
  pos: Position
  age: number
  heightIn: number
  weightLb: number
  ratings: Ratings
  tendencies: Tendencies
}

export interface AwardWinner {
  award: string
  playerId: string
  name: string
  teamId: string | null
  score: number
}

export interface SeasonAwards {
  mvp: AwardWinner | null
  roy: AwardWinner | null
  dpoy: AwardWinner | null
  /** Three teams of five, best first. Positional (2G/2F/1C) before 2023-24, positionless after. */
  allNba: AwardWinner[][]
}

export interface SeasonSummary {
  yearEnd: YearEnd
  championTeamId: string | null
  runnerUpTeamId: string | null
  bestRecord: { teamId: string; wins: number; losses: number } | null
  awards: SeasonAwards | null
  standings: { teamId: string; wins: number; losses: number; seed: number | null }[]
  /**
   * Rounds won in the playoffs, by team id. 0 = lost in round one, 4 = champions. Absent for teams
   * that missed the playoffs, and for whole seasons on saves written before franchise history
   * existed — read it through `franchiseSeasons`, which falls back to the seed.
   */
  rounds?: Record<string, number>
}

export interface LogEvent {
  date: string
  yearEnd: YearEnd
  kind: 'phase' | 'game' | 'award' | 'draft' | 'contract' | 'trade' | 'signing' | 'note'
  text: string
}

export interface CapState {
  cap: number
  taxLine: number | null
  apron1: number | null
  apron2: number | null
  minSalary: number
  maxSalary: number | null
}

/** What the coach decides: how the team plays and who plays. Absent means "work it out for me". */
export interface TeamSettings {
  tactics: Tactics
  /**
   * Rotation order, best first, by player id. Anyone missing is ranked behind those listed.
   * Empty means the depth chart is picked automatically.
   */
  depth: string[]
  /** Minutes per game per player, 0-48. Missing players get the default for their depth slot. */
  minutes: Record<string, number>
  /** Players held out of the rotation entirely. */
  inactive: string[]
  /**
   * The starting five, by the slot each man is asked to fill. Optional: without it the top five of
   * the depth order start and nobody is out of position, which is exactly how the game behaved
   * before a manager could name a lineup. A slot may be empty, and a player named here is pulled
   * to the front of the rotation whatever `depth` says.
   */
  lineup?: Partial<Record<Position, string>>
  /**
   * Named five-man units: Starters, Bench, Closing. Optional so old saves load.
   * Absent means the minutes-share rotation, unchanged. Present (at least one
   * complete five) means the coach puts those groups on the floor by situation.
   */
  lineups?: NamedLineups
  /** The offensive system. Absent or 'balanced' means no system: every man plays his own game. */
  system?: OffenseSystemId
  /** Per-player coaching instructions, by player id. Missing or neutral means "play your game". */
  instructions?: Record<string, PlayerInstruction>
}

export interface GameState {
  version: 1
  seed: number
  /** xoshiro128** state. Every reducer restores it, draws, and writes it back. */
  rngState: [number, number, number, number]
  userTeamId: string
  phase: Phase
  season: {
    yearEnd: YearEnd
    seasonId: string
    era: EraContext
    rules: EraRules
  }
  league: {
    teams: LeagueTeam[]
    players: LeaguePlayer[]
    cap: CapState
  }
  calendar: {
    date: string
    schedule: ScheduledGame[]
    /** Index of the next unplayed regular-season game. The schedule is date-ordered. */
    next: number
    results: GameSummary[]
  }
  records: Record<string, TeamRecord>
  stats: Record<string, SeasonStatLine & { teamId: string }>
  /**
   * Fitness and injuries, by player id. Absent on saves written before injuries existed, so read
   * it through `availabilityOf`, never directly.
   */
  availability?: Record<string, PlayerAvailability>
  /**
   * Roles and morale, by player id. Optional for the same reason availability is: saves written
   * before the dressing room existed simply start keeping one. Read it through `moraleOf` in
   * `morale.ts`, never directly.
   */
  morale?: Record<string, PlayerMorale>
  playoffs: PlayoffState | null
  playIn: PlayInState | null
  draft: DraftState | null
  awards: SeasonAwards | null
  history: SeasonSummary[]
  /**
   * Every season every player has ever played, packed one string per man. Optional: saves written
   * before the league had a memory simply start accumulating one. Never read it directly — go
   * through `careerOf`/`allCareers` in `history.ts`, which own the encoding.
   */
  careers?: Record<string, string>
  /** Single-game league records, by category. Kept live because totals cannot recover them. */
  gameRecords?: Record<string, GameRecord>
  /** Everyone the hall has taken in, oldest first. */
  hallOfFame?: HallOfFamer[]
  /**
   * Every coach in the league and who employs him. Optional: a save written before staff existed
   * loads without one and the league plays exactly as it did — every effect is centred on 50 and a
   * missing profile means "no effect". `initStaff` gives it one at the next rollover.
   */
  staff?: StaffState
  log: LogEvent[]
  /** Per-team coaching settings. Only teams the user has touched need an entry. */
  teamSettings: Record<string, TeamSettings>
  /**
   * Who owns a draft pick that has changed hands, keyed `${draftYear}-${round}-${originalTeamId}`.
   * A pick with no entry still belongs to the team that earned it.
   */
  pickOwners: Record<string, string>
}

/**
 * Everything the reducers need from outside. The engine is injected so this package never
 * imports @hoops/engine, and so tests can run a fake engine.
 * Hooks mutate the state they are handed; the reducer has already cloned it.
 */
export interface GameHooks {
  engine: SimulateGame
  /** Phase 5 seam: the draft class. Without it, picks are recorded with no player attached. */
  prospects?: (ctx: { yearEnd: YearEnd; count: number; rng: Rng }) => Prospect[]
  /** Phase 4 seam: free agency and re-signings. Default: stubResign (see rollover.ts). */
  freeAgency?: (state: GameState, rng: Rng) => void
  /** Phase 5 seam: development, aging curves, retirement. Default: ratings unchanged. */
  develop?: (state: GameState, rng: Rng) => void
  /**
   * Era seam. Called at rollover for the season about to start. Return that season's rules and
   * league baselines when the caller has them (the era table covers 1998-2026). Default: the
   * bundle's rules and EraContext are kept and only the money grows, which is what SPEC §4 asks
   * for beyond the last real season.
   */
  nextSeason?: (yearEnd: YearEnd) => { rules?: EraRules; era?: EraContext } | null
  /**
   * Injury roll override. Unset in production. Tests return an Injury to inflict,
   * null to skip the roll, or undefined to use the catalogue.
   */
  injure?: (player: LeaguePlayer) => Injury | null | undefined
}

export const MAX_LOG = 2000

export function pushLog(state: GameState, e: LogEvent): void {
  state.log.push(e)
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG)
}

export function emptyRecord(teamId: string): TeamRecord {
  return { teamId, wins: 0, losses: 0, pf: 0, pa: 0, divW: 0, divL: 0, confW: 0, confL: 0, h2h: {} }
}

export function teamOf(state: GameState, teamId: string): LeagueTeam | undefined {
  return state.league.teams.find((t) => t.teamId === teamId)
}

export function rosterOf(state: GameState, teamId: string): LeaguePlayer[] {
  return state.league.players.filter((p) => p.teamId === teamId)
}

/** Total salary on the books this season. Cap holds and exceptions are Phase 4. */
export function payrollOf(state: GameState, teamId: string): number {
  let total = 0
  for (const p of state.league.players) {
    if (p.teamId !== teamId || !p.contract) continue
    const y = p.contract.years.find((yr) => yr.yearEnd === state.season.yearEnd)
    if (y) total += y.amount
  }
  return total
}

export function fitPlayer(): PlayerAvailability {
  return { out: 0, injury: null, condition: 1, sinceReturn: 99, missed: 0, lastGame: null }
}

/** The availability record for one player, created fit if the save has never seen him. */
export function availabilityOf(state: GameState, playerId: string): PlayerAvailability {
  state.availability ??= {}
  const all = state.availability
  let a = all[playerId]
  if (!a) {
    a = fitPlayer()
    all[playerId] = a
  }
  return a
}

/** Everyone starts a season fit. Summers are long enough to heal anything. */
export function resetAvailability(state: GameState): void {
  state.availability = Object.fromEntries(
    state.league.players.map((p) => [p.playerId, fitPlayer()]),
  )
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

export type { EraContext, EraRules }
