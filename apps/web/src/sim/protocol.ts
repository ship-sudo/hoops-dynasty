/** Message shapes between the UI thread and the sim worker. Structured-clone-safe throughout. */
import type { GameResult, TeamRecord } from '@hoops/core'
import type {
  DayReport,
  DynastyState,
  NewsItem,
  PickRef,
  RosterRow,
  SaveFile,
  ScheduleEntry,
  SimSeason,
  StandingsRow,
  TeamFinance,
  TeamPlan,
  TradeAssessment,
  TradeBlockPlayer,
  TradePackage,
} from './api.ts'

/** One deal the AI wants to make you. */
export interface IncomingOffer {
  other: TradePackage
  user: TradePackage
  assessment: TradeAssessment
}

export interface Snapshot {
  state: DynastyState
  standings: StandingsRow[]
  news: NewsItem[]
  /** The last day played by the call that produced this snapshot, if any. */
  lastDay: DayReport | null
}

export type Request =
  | { id: number; kind: 'openSeason'; yearEnd: number }
  | { id: number; kind: 'preview'; yearEnd: number; teamId: string }
  | { id: number; kind: 'newGame'; yearEnd: number; teamId: string; seed: number }
  | { id: number; kind: 'loadSave'; save: SaveFile }
  | { id: number; kind: 'simDays'; days: number }
  | { id: number; kind: 'simToDate'; date: string }
  | { id: number; kind: 'snapshot' }
  | { id: number; kind: 'schedule'; teamId?: string }
  | { id: number; kind: 'roster'; teamId: string }
  | { id: number; kind: 'finance'; teamId: string }
  | { id: number; kind: 'boxScore'; gameId: string }
  | { id: number; kind: 'save' }
  | { id: number; kind: 'tradeBlock'; teamId: string }
  | { id: number; kind: 'picks'; teamId: string }
  | { id: number; kind: 'assessTrade'; user: TradePackage; other: TradePackage }
  | { id: number; kind: 'executeTrade'; user: TradePackage; other: TradePackage }
  | { id: number; kind: 'incomingOffers'; limit?: number }
  /**
   * One passthrough to a `ManagerActions` method, so the offseason, trade and tactics screens do
   * not each need their own message. `method` is checked against the Dynasty instance at run time.
   */
  | { id: number; kind: 'manager'; method: string; args: unknown[] }
  | { id: number; kind: 'plan'; teamId: string }
  | { id: number; kind: 'setPlan'; teamId: string; plan: Partial<TeamPlan> }
  | { id: number; kind: 'seasonHistory' }

/** Omit that distributes over the union, so each variant keeps its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A request with the correlation id left for the client to fill in. */
export type RequestBody = DistributiveOmit<Request, 'id'>

export interface SeasonInfo {
  yearEnd: number
  seasonId: string
  teams: TeamRecord[]
}

export interface Progress {
  done: number
  total: number
  label: string
}

/** What each successful response kind carries. */
export interface ResponseData {
  openSeason: SeasonInfo
  preview: { roster: RosterRow[]; finance: TeamFinance }
  snapshot: Snapshot
  schedule: ScheduleEntry[]
  roster: RosterRow[]
  finance: TeamFinance
  boxScore: GameResult | null
  save: SaveFile
  tradeBlock: TradeBlockPlayer[]
  picks: PickRef[]
  tradeAssessment: TradeAssessment
  incomingOffers: IncomingOffer[]
  manager: unknown
  /** The plan, plus the one era fact the tactics screen needs to tell the truth about zone. */
  plan: { plan: TeamPlan; zoneLegal: boolean }
  seasonHistory: SimSeason[]
}

export type ResponseKind = keyof ResponseData

export type Response =
  | { [K in ResponseKind]: { id: number; ok: true; kind: K; data: ResponseData[K] } }[ResponseKind]
  | { id: number; ok: false; error: string }

export type WorkerEvent = Response | { id: number; progress: Progress }
