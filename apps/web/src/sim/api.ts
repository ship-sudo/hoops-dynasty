/**
 * THE SEAM.
 *
 * This is the whole contract the web app has with the game simulation. It is satisfied by
 * `./real.ts`, which drives @hoops/game with the progression, draftclass, frontoffice and injury
 * packages plugged into its hooks. Nothing else in the app knows where the sim comes from.
 *
 * Everything crossing this boundary is structured-clone-safe: the implementation runs in a Web
 * Worker and every method's return value is posted to the UI thread.
 */
import type { GameResult, PlayerRecord, SeasonBundle, StatLine, TeamRecord } from '@hoops/core'

export interface NewGameOptions {
  yearEnd: number
  /** The franchise the human runs. */
  teamId: string
  seed: number
}

export interface DynastyState {
  yearEnd: number
  seasonId: string
  userTeamId: string
  seed: number
  /** ISO date the game clock currently sits on. */
  date: string
  /** ISO date of the first unplayed game, or null when the regular season is done. */
  nextGameDate: string | null
  gamesPlayed: number
  gamesTotal: number
  seasonComplete: boolean
}

export interface StandingsRow {
  teamId: string
  wins: number
  losses: number
  pct: number
  /** Games behind the conference leader. */
  gb: number
  pointsFor: number
  pointsAgainst: number
  confWins: number
  confLosses: number
  divWins: number
  divLosses: number
  homeWins: number
  homeLosses: number
  /** Most recent ten results, newest first: true = win. */
  last10: boolean[]
  /** Positive = win streak, negative = losing streak. */
  streak: number
}

export type NewsKind = 'result' | 'milestone' | 'streak' | 'league' | 'system' | 'rumour' | 'offer'

export interface NewsItem {
  id: string
  date: string
  kind: NewsKind
  headline: string
  body: string
  /** Set when the item is about a specific game, so the inbox can link to a box score. */
  gameId?: string
}

export interface PlayedGame {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
  homePts: number
  awayPts: number
  overtimes: number
}

export interface ScheduleEntry {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
  /** Null until the game has been simulated. */
  result: { homePts: number; awayPts: number; overtimes: number } | null
}

/** Why a multi-day sim stopped. Ephemeral on the worker protocol, not the save. */
export type SimInterrupt =
  | {
      kind: 'injury'
      playerId: string
      name: string
      games: number
      injuryName: string
      teamId: string
    }
  | {
      kind: 'allstar'
      date: string
      yearEnd: number
      eastPts: number
      westPts: number
      mvpName: string | null
      yours: string[]
    }
  | {
      kind: 'season'
      yearEnd: number
      mvpName: string | null
      userWins: number
      userLosses: number
    }

/** @deprecated Use SimInterrupt. Kept so older call sites type-check during the rename. */
export type InjuryInterrupt = Extract<SimInterrupt, { kind: 'injury' }>

/** What one `continue` produces: the day that was played, its games, and the news it generated. */
export interface DayReport {
  date: string
  games: PlayedGame[]
  news: NewsItem[]
  /** Set when a recap (injury, All-Star, end of the regular season) ended a multi-day sim. */
  interrupt?: SimInterrupt
}

export interface SeasonTotals extends StatLine {
  gp: number
  gs: number
}

/**
 * The dressing room, as one player's card shows it. Every field is a fact, not a mood ring: the
 * role he expects, the minutes that role expects, the minutes he is getting, and one sentence
 * saying which of those is the problem.
 */
export interface PlayerMood {
  /** 0–100. 55 is where everyone starts. */
  value: number
  /** 'delighted' | 'happy' | 'content' | 'restless' | 'unhappy' | 'furious'. */
  label: string
  /** The role he expects: star, starter, rotation, bench. */
  role: string
  /** Minutes a night that role expects. */
  expectedMpg: number
  /** Minutes a night he is getting. */
  mpg: number
  /** Why the number is what it is, in one sentence. */
  why: string
  /** Every named term behind it, biggest grievance first. For the card's breakdown. */
  terms: { key: string; value: number; text: string }[]
  /** True when he has made his mind up to leave rather than re-sign here. */
  wantsOut: boolean
  /** What he would want to re-sign here, as a multiple of his market price. */
  askingMultiple: number
}

/** The squad's mood in one object, for a panel the manager can act on. */
export interface SquadMoodView {
  teamId: string
  /** Minutes-weighted: the tenth man's sulk is not the star's. */
  average: number
  label: string
  /** How many men are restless or worse. */
  unhappy: number
  worst: { playerId: string; name: string; value: number; role: string; why: string }[]
  /** One sentence. */
  summary: string
}

export interface RosterRow {
  player: PlayerRecord
  /** Role and morale. Absent on saves written before the dressing room existed. */
  mood?: PlayerMood
  /**
   * Ratings as a person should read them: an average rotation player is in the mid-seventies, a
   * superstar in the nineties. `potential` is filled only for players you employ.
   */
  card: RatingCard
  /** Totals accumulated in the simulated season so far. */
  totals: SeasonTotals
  /** Salary in the bundle's own season, or null if no contract data. */
  salary: number | null
  contractYears: number
  /** One sentence: iron man, typical, or injury candidate, from durability and prior seasons. */
  injuryHint?: string
}

export interface TeamFinance {
  teamId: string
  payroll: number
  cap: number
  taxLine: number
  apron1: number | null
  apron2: number | null
  roster: number
  /** Luxury tax owed on this payroll. 0 when under the line or the era has no tax. */
  taxBill: number
  /** True when this bill uses repeater rates. */
  repeater: boolean
}

/** Opaque to the UI. The implementation owns the shape; the app just stores and restores it. */
export interface SaveFile {
  format: 'hoops-dynasty-save'
  version: number
  savedAt: string
  yearEnd: number
  userTeamId: string
  label: string
  state: unknown
}

export interface Dynasty extends ManagerActions, LeagueViews, StaffActions {
  getState(): DynastyState
  teams(): TeamRecord[]

  /** Play every game on the next date that has one. Returns null when the season is over. */
  simDay(): DayReport | null
  /**
   * Play forward until the clock passes `isoDate` (inclusive). `onDay` is called after each
   * simulated day so the caller can report progress; return false from it to stop early.
   */
  simToDate(
    isoDate: string,
    onDay?: (report: DayReport, index: number) => boolean | undefined,
  ): DayReport[]

  standings(): StandingsRow[]
  boxScore(gameId: string): GameResult | null

  schedule(teamId?: string): ScheduleEntry[]
  roster(teamId: string): RosterRow[]
  finance(teamId: string): TeamFinance
  news(limit?: number): NewsItem[]

  save(): SaveFile
}

export interface DynastyModule {
  /** Preview a franchise before committing: the roster and cap sheet as of opening night. */
  preview(bundle: SeasonBundle, teamId: string): { roster: RosterRow[]; finance: TeamFinance }
  newGame(bundle: SeasonBundle, options: NewGameOptions): Dynasty
  loadGame(bundle: SeasonBundle, save: SaveFile): Dynasty
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7: the things a manager actually does — tactics, trades, the draft, the
// market — plus the record of what really happened, for comparison.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  NamedLineups,
  OffenseSystemId,
  PlayerInstruction,
  Position,
  Tactics,
} from '@hoops/core'
import type { RatingCard } from './card.ts'

export type { RatingCard } from './card.ts'

/** How a team plays and who plays. Any part left empty is decided automatically. */
export interface TeamPlan {
  tactics: Tactics
  /** Rotation order, best first, by player id. */
  depth: string[]
  /** Minutes per game by player id, 0–48. */
  minutes: Record<string, number>
  /** Players held out of the rotation. */
  inactive: string[]
  /**
   * The starting five by slot. Empty means "the top five of the depth order start", which is how
   * the game behaved before a manager could name a lineup, and nobody is out of position.
   */
  lineup: Partial<Record<Position, string>>
  /**
   * Named five-man units. Empty means the minutes-share rotation. A complete Starters,
   * Bench or Closing five opts the team into unit rotation.
   */
  lineups: NamedLineups
  /** The offensive system. 'balanced' is no system at all. */
  system: OffenseSystemId
  /** Per-player instructions, by player id. Absent means he plays his own game. */
  instructions: Record<string, PlayerInstruction>
}

export interface PickRef {
  draftYear: number
  round: 1 | 2
  fromTeamId: string
  /** Expected slot, for valuation. */
  expectedSlot: number
}

/** One side's outgoing assets. A trade is two of these. */
export interface TradePackage {
  teamId: string
  players: string[]
  picks: PickRef[]
}

export interface TradeAssessment {
  legal: boolean
  /** Why not, in plain words, when it is illegal. */
  reasons: string[]
  accepted: boolean
  /** What the other side says. */
  reason: string
  /** Net value to the other side, in dollars. Positive means they gain. */
  net: number
  /** Salary each side sends out, for the matching display. */
  outgoing: { user: number; other: number }
}

export interface TradeBlockPlayer {
  playerId: string
  name: string
  teamId: string
  /** What he produces over the life of the deal, in dollars. */
  value: number
  /** Surplus: that production minus what he is owed. What a trade is actually judged on. */
  surplus: number
  salary: number
  contractYears: number
}

/** One incoming trade for a listed man, plus whether you can bid on his next contract. */
export interface PlayerDesk {
  playerId: string
  yours: boolean
  listed: boolean
  offers: { other: TradePackage; user: TradePackage; assessment: TradeAssessment }[]
  /** Names for ids in those offers, so the card does not have to load every block. */
  names: Record<string, string>
  contract: {
    kind: 'fa' | 'extend' | 'none'
    asking: number
    askingYears: number
    max: number
    min: number
    offer: { amount: number; years: number } | null
    reason: string | null
  }
}

export type OffseasonPhase = 'lottery' | 'draft' | 'freeagency' | 'done'

export interface DraftPickView {
  overall: number
  round: number
  teamId: string
  prospectId: string | null
  name: string | null
}

/** A prospect as the user's scouts see him. Never the truth. */
export interface ScoutedView {
  prospectId: string
  name: string
  pos: string
  age: number
  heightIn: number
  ratings: Record<string, number>
  overall: number
  potentialLow: number
  potentialHigh: number
  confidence: number
}

export interface FreeAgentView {
  playerId: string
  name: string
  pos: string
  age: number
  overall: number
  /** What he is asking for, first year. */
  asking: number
  askingYears: number
  /** Your current offer, if you have made one. */
  offer: { amount: number; years: number } | null
  incumbentTeamId: string | null
}

export interface OffseasonState {
  phase: OffseasonPhase
  yearEnd: number
  /** Draft order and what has been taken. */
  picks: DraftPickView[]
  /** Whose pick is on the clock. */
  onTheClock: DraftPickView | null
  /** True when the team on the clock is yours. */
  yourPick: boolean
  /** The board, as your scouts see it. */
  board: ScoutedView[]
  /** The market, once the draft is done. */
  freeAgents: FreeAgentView[]
  /** Your cap position going into the market. */
  finance: TeamFinance | null
  /** What happened so far this offseason. */
  news: NewsItem[]
}

/** One season as it really happened, for the comparison screen. */
export interface RealSeason {
  yearEnd: number
  standings: { teamId: string; wins: number; losses: number }[]
  championTeamId: string | null
  mvp: { playerId: string; name: string } | null
}

/** One season as it happened in this save. */
export interface SimSeason {
  yearEnd: number
  standings: { teamId: string; wins: number; losses: number }[]
  championTeamId: string | null
  mvp: { playerId: string; name: string } | null
  userWins: number
  userLosses: number
}

/** One game in a player's season: what he did, and against whom. */
export interface GameLogRow {
  gameId: string
  date: string
  opponentTeamId: string
  home: boolean
  won: boolean
  teamPts: number
  opponentPts: number
  started: boolean
  line: StatLine
}

export interface ManagerActions {
  /**
   * Game-by-game lines for a player, newest first. Kept in full for your own team all season;
   * for the rest of the league it reaches back as far as the box-score cache does.
   */
  gameLog(playerId: string, limit?: number): GameLogRow[]

  // Tactics and the depth chart.
  getPlan(teamId: string): TeamPlan
  setPlan(teamId: string, plan: Partial<TeamPlan>): void

  // Trades.
  tradeBlock(teamId: string): TradeBlockPlayer[]
  assessTrade(user: TradePackage, other: TradePackage): TradeAssessment
  /** Runs assessTrade first; only executes when it is legal and accepted. */
  executeTrade(user: TradePackage, other: TradePackage): TradeAssessment
  /** Offers the AI would like to make you, best first. */
  incomingOffers(
    limit?: number,
  ): { other: TradePackage; user: TradePackage; assessment: TradeAssessment }[]
  /** Players you have listed on the block. */
  listedOnBlock(): string[]
  /** List or unlist one of yours. */
  listOnBlock(playerId: string, on: boolean): PlayerDesk | null
  /** What the manager can do with this man: the block, offers, a contract. */
  playerDesk(playerId: string): PlayerDesk | null
  /** Add years onto a deal he already has. */
  extendContract(
    playerId: string,
    amount: number,
    years: number,
  ): { ok: boolean; message: string; desk: PlayerDesk | null }

  // The offseason, step by step.
  /** Draft picks a team still holds in the next three drafts. */
  picksOf(teamId: string): PickRef[]

  offseason(): OffseasonState | null
  /** Let the AI pick until you are on the clock (or the draft ends). */
  advanceDraft(): OffseasonState
  /** Make your pick. */
  draftPlayer(prospectId: string): OffseasonState
  /** Bid in the market. Replaces any previous offer for that player. */
  makeOffer(playerId: string, amount: number, years: number): OffseasonState
  withdrawOffer(playerId: string): OffseasonState
  /** Resolve the market, roll the league into the new season. */
  finishOffseason(): OffseasonState

  /**
   * The dressing room. Reached through the generic manager door, so no new worker message is
   * needed and three lanes can add screens without colliding.
   */
  squadMood(teamId: string): SquadMoodView

  // What really happened.
  seasonHistory(): SimSeason[]
}

// ─────────────────────────────────────────────────────────────────────────────
// The league as a spectacle: who is leading what, who is winning the awards,
// who is an All-Star, and what is on tonight.
// ─────────────────────────────────────────────────────────────────────────────

/** Every per-game category a leaderboard can be sorted by. */
export type StatCategory =
  | 'pts'
  | 'reb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'fg3m'
  | 'min'
  | 'fgPct'
  | 'fg3Pct'
  | 'ftPct'
  | 'tsPct'

export interface LeaderRow {
  playerId: string
  name: string
  teamId: string
  pos: string
  gp: number
  /** The value in the requested category: a per-game rate, or a percentage 0–1. */
  value: number
  /** The headline per-game line, so a leaderboard reads like a leaderboard. */
  pts: number
  reb: number
  ast: number
  min: number
}

export interface TeamStatRow {
  teamId: string
  wins: number
  losses: number
  /** Per game. */
  pts: number
  oppPts: number
  diff: number
  pace: number
  fgPct: number
  fg3Pct: number
  reb: number
  ast: number
  tov: number
}

export interface AwardCandidate {
  playerId: string
  name: string
  teamId: string
  pos: string
  /** Share of the imaginary vote, 0–1, among the top candidates. */
  share: number
  gp: number
  pts: number
  reb: number
  ast: number
  teamWins: number
  teamLosses: number
}

export interface AwardRace {
  mvp: AwardCandidate[]
  roy: AwardCandidate[]
  dpoy: AwardCandidate[]
}

export interface AllStarPick {
  playerId: string
  name: string
  teamId: string
  pos: string
  starter: boolean
  pts: number
  reb: number
  ast: number
  /** How many times he has been picked in this save. */
  selections: number
}

export interface AllStarGame {
  yearEnd: number
  /** True once the calendar has passed the break. */
  played: boolean
  date: string
  east: AllStarPick[]
  west: AllStarPick[]
  result: { eastPts: number; westPts: number; mvpPlayerId: string | null } | null
}

/** What is on tonight, and what a fan would want to know before it. */
export interface GamePreview {
  gameId: string
  date: string
  home: boolean
  opponentTeamId: string
  yourRecord: { wins: number; losses: number }
  theirRecord: { wins: number; losses: number }
  /** Earlier meetings this season, newest first. */
  series: { gameId: string; date: string; yourPts: number; theirPts: number }[]
  yourBest: { playerId: string; name: string; pts: number; reb: number; ast: number } | null
  theirBest: { playerId: string; name: string; pts: number; reb: number; ast: number } | null
  /** Your form, newest first: true = win. */
  yourForm: boolean[]
  theirForm: boolean[]
  /**
   * Set only when the next game is a postseason game. Optional, so every existing caller and every
   * saved preview keeps working; the regular season never fills it in.
   */
  playoff?: PlayoffPreview
}

/** One game of a play-in or a live series, told the way a fan would tell it. */
export interface PlayoffPreview {
  /** 'series' once the bracket is drawn; 'playin' before it. */
  kind: 'series' | 'playin'
  /** 'Eastern Conference Semi-finals', 'The Finals', 'The play-in'. */
  title: string
  /** The series score as a sentence: 'Boston lead 2–1'. Empty for a play-in. */
  seriesLine: string
  /** What tonight decides, when it decides something. */
  stake: string | null
  /** Label for the primary button: 'Play game 4 ▸'. */
  action: string
  /** 1-based game number in the series. */
  gameNumber: number
  bestOf: number
  yourSeed: number | null
  theirSeed: number | null
  yourWins: number
  theirWins: number
  /** Every game of this series so far, oldest first. Each one opens its box score. */
  games: { gameId: string; date: string; yourPts: number; theirPts: number; home: boolean }[]
}

/**
 * What the postseason means for you when you are not the one playing: you missed it, you were
 * knocked out, or you won it. Null while the regular season is still on.
 */
export interface PostseasonSummary {
  kind: 'playing' | 'waiting' | 'missed' | 'eliminated' | 'champion' | 'runnerUp'
  headline: string
  detail: string
  /** Clubs still alive, so the screen can show who is left rather than nothing at all. */
  aliveTeamIds: string[]
}

export interface LeagueViews {
  /** The playoff bracket as it stands. Null while the regular season is still on. */
  bracket(): Bracket | null
  /** Per-game leaders in a category. Players below a games-played threshold are excluded. */
  leaders(category: StatCategory, limit?: number): LeaderRow[]
  teamStats(): TeamStatRow[]
  awardRace(limit?: number): AwardRace
  allStars(): AllStarGame | null
  nextGame(): GamePreview | null
  /** Where your season stands once the regular one is done. Null while it is still on. */
  postseason(): PostseasonSummary | null
}

export interface BracketSeries {
  round: number
  /** 'East', 'West' or 'Finals'. */
  bracket: string
  highTeamId: string
  lowTeamId: string
  highSeed: number | null
  lowSeed: number | null
  highWins: number
  lowWins: number
  bestOf: number
  winnerTeamId: string | null
  games: { gameId: string; date: string; homeTeamId: string; homePts: number; awayPts: number }[]
}

export interface Bracket {
  /** Playoff field in seed order per conference. Empty until the field is set. */
  seeds: { East: string[]; West: string[] }
  rounds: BracketSeries[][]
  championTeamId: string | null
  runnerUpTeamId: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// The staff: five men per club, a carousel, and former players with clipboards.
// Implemented in `./staff.ts` over @hoops/game's staff module.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffRoleId = 'head' | 'offense' | 'defense' | 'development' | 'scout'

export interface CoachRatingsView {
  rotation: number
  adjust: number
  morale: number
  offense: number
  defense: number
  development: number
  scouting: number
}

export interface CoachView {
  coachId: string
  name: string
  /** The job he is built for. */
  role: StaffRoleId
  roleLabel: string
  /** What that job does, in plain words. */
  job: string
  age: number
  ratings: CoachRatingsView
  /** The rating that matters in the slot he is shown in, 0–100. */
  quality: number
  reputation: number
  /** How he likes his teams to play, as a sentence. */
  styleText: string
  /** Where he came from: a playing career, a college job, twenty years as a number two. */
  background: string
  hallOfFamer: boolean
  /** Set when he used to play in this league, so the screen can link to his career. */
  playerId: string | null
  /** Dollars per year. 0 when he is out of work. */
  salary: number
  yearsLeft: number
  seasons: number
  record: { w: number; l: number }
  titles: number
  /** What he is actually worth to you, with the number behind each claim. */
  effects: string[]
}

export interface StaffSlotView {
  role: StaffRoleId
  roleLabel: string
  job: string
  coach: CoachView | null
  /** What sacking him would cost, in dollars. Every guaranteed year is paid in full. */
  severance: number
}

/** A man out of work, with what he would cost and whether he would have you. */
export interface CandidateView extends CoachView {
  interest: { role: StaffRoleId; willing: boolean; reason: string; salary: number }[]
}

export interface RivalCoachView {
  teamId: string
  coachName: string
  reputation: number
  record: { w: number; l: number }
  titles: number
  playerId: string | null
  hallOfFamer: boolean
  /** True when this is a man you sacked. */
  formerlyYours: boolean
}

export interface StaffView {
  teamId: string
  slots: StaffSlotView[]
  /** The staff wage bill, per year. */
  wages: number
  /** What sackings have cost this club so far. */
  deadMoney: number
  pool: CandidateView[]
  rivals: RivalCoachView[]
  /** The salary cap, for scale — coaching money is quoted against it. */
  cap: number
  /** How attractive your club looks to a coach, 0–100. */
  appeal: number
}

export interface StaffActionResult {
  ok: boolean
  /** What happened, or why it did not. */
  message: string
  view: StaffView
}

export interface StaffActions {
  /** Your staff, the candidate pool and who is coaching everybody else. */
  staff(teamId?: string): StaffView
  /** `salary` above his asking price buys goodwill; leave it out to offer exactly that. */
  hireCoach(coachId: string, role: StaffRoleId, years: number, salary?: number): StaffActionResult
  fireCoach(role: StaffRoleId): StaffActionResult
}
