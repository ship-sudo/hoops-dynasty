/** Save encode/decode. Offers live on the session, not only in GameState. */
import type { GameResult } from '@hoops/core'
import type { GameState } from '@hoops/game'
import type { SaveFile } from './api.ts'
import type { UserOffer } from './market.ts'
import type { DynastySession } from './session.ts'

export interface SavePayload {
  game: GameState
  potentials: [string, number][]
  boxes?: [string, GameResult][]
  offers?: UserOffer[]
  marketOpen?: boolean
  fired?: string[]
  marketDay?: number
}

export function encodeSave(s: DynastySession): SaveFile {
  // Your own team's box scores go in the save. Without them, closing the tab empties every
  // game log and every past box score in the schedule — the season would have no memory of
  // itself. The play-by-play is dropped: it is the bulk of a box and is only ever read for
  // the game you just watched.
  const boxesForSave: [string, GameResult][] = [...s.userBoxes].map(([id, r]) => [
    id,
    { ...r, pbp: [] },
  ])
  return {
    format: 'hoops-dynasty-save',
    version: 1,
    savedAt: new Date().toISOString(),
    yearEnd: s.current.season.yearEnd,
    userTeamId: s.current.userTeamId,
    label: `${s.current.season.seasonId} · ${s.current.calendar.date}`,
    state: {
      game: s.current,
      potentials: [...s.potentials],
      boxes: boxesForSave,
      // Bids you have placed but not yet resolved, so a reload mid-market keeps them.
      offers: [...s.userOffers.values()],
      marketOpen: s.marketOpen,
      marketDay: s.marketDay,
      // Who you have sacked. The staff itself lives in the game state; this is only the grudge.
      fired: [...s.firedByUser],
    },
  }
}

export function decodeSave(save: SaveFile): {
  game: GameState
  potentials: Map<string, number>
  boxes: [string, GameResult][]
  resume: {
    offers: UserOffer[]
    marketOpen: boolean
    fired: string[]
    marketDay: number
  }
} {
  const payload = save.state as SavePayload
  return {
    game: payload.game,
    potentials: new Map(payload.potentials),
    boxes: payload.boxes ?? [],
    resume: {
      offers: payload.offers ?? [],
      marketOpen: payload.marketOpen ?? false,
      fired: payload.fired ?? [],
      marketDay: payload.marketDay ?? 0,
    },
  }
}
