/**
 * The real record, fetched once per session and shared by every screen that compares your league
 * with history. `history.json` sits next to the season bundles and weighs about 7 MB, so it is
 * pulled lazily, never at start-up, and never twice.
 */
import type { CareerArc, HistoryBundle } from '@hoops/core'

export interface RealHistory {
  seasons: HistoryBundle['seasons']
  /** playerId → name, for the awards tables. */
  names: Map<string, string>
  /** playerId → the career he really had. */
  arcs: Map<string, CareerArc>
}

let cached: RealHistory | null = null
let inFlight: Promise<RealHistory> | null = null

export const realHistory = (): RealHistory | null => cached

export function loadRealHistory(): Promise<RealHistory> {
  if (cached) return Promise.resolve(cached)
  inFlight ??= fetch('/bundles/history.json')
    .then((res) => {
      if (!res.ok) throw new Error(`history.json is not being served (${res.status})`)
      return res.json() as Promise<HistoryBundle>
    })
    .then((raw) => {
      const names = new Map<string, string>()
      const arcs = new Map<string, CareerArc>()
      for (const c of raw.careers) {
        names.set(c.playerId, c.name)
        arcs.set(c.playerId, c)
      }
      cached = { seasons: raw.seasons, names, arcs }
      return cached
    })
    .catch((e: unknown) => {
      inFlight = null
      throw e
    })
  return inFlight
}
