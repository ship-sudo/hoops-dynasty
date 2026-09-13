/** Mutable session the adapter modules share. real.ts only builds the Dynasty object. */
import type { GameResult, Rng, SeasonBundle } from '@hoops/core'
import { makeRng } from '@hoops/core'
import type { classFor, NameBank } from '@hoops/draftclass'
import type { GameHooks, GameState, TeamSettings } from '@hoops/game'
import type { NewsItem, OffseasonState, ScoutedView } from './api.ts'
import type { Potentials, UserOffer } from './market.ts'

/** How many recent box scores to keep. Enough for the inbox to stay clickable; small enough to hold. */
export const BOX_CACHE = 400

/** Phases where pressing continue plays basketball. */
export const PLAYING = new Set(['regular', 'playin', 'playoffs'])

export interface RealOptions {
  /** Career arcs for historical draft classes and the fate slider. Optional: costs 7MB to load. */
  history?: Parameters<typeof classFor>[0] | null
  /** 0 = real careers, 100 = the model decides everything. */
  fate?: number
}

export interface DynastySession {
  bundle: SeasonBundle
  current: GameState
  potentials: Potentials
  opts: RealOptions
  boxes: Map<string, GameResult>
  userBoxes: Map<string, GameResult>
  feed: NewsItem[]
  lastRumourDate: string
  userOffers: Map<string, UserOffer>
  marketOpen: boolean
  marketDay: number
  lastPicks: OffseasonState['picks']
  scoutCache: Map<string, ScoutedView>
  firedByUser: Set<string>
  pending: GameResult[]
  names: NameBank
  hooks: GameHooks
}

export function blankSettings(): TeamSettings {
  return {
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [],
  }
}

/** A deterministic rng for an offseason step, so the same save replays the same summer. */
export function rngFor(s: DynastySession, tag: string): Rng {
  let h = s.current.seed ^ s.current.season.yearEnd
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0
  return makeRng(h)
}

export function playerName(s: DynastySession, id: string): string {
  return s.current.league.players.find((p) => p.playerId === id)?.name ?? id
}

/** City + nickname, for the wire. Distinct from views.clubName, which is the short headline. */
export function fullClubName(s: DynastySession, teamId: string): string {
  const t = s.current.league.teams.find((x) => x.teamId === teamId)
  return t ? `${t.city} ${t.name}` : teamId
}
