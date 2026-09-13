// Minutes targets for a team in a harness game.
// 'real': each player's real minutes per game and real availability (gp / team games), per stint.
// 'model': a plain depth-chart rotation from overall rating. Stands in until packages/game has a coach.

import { type PlayerRecord, RATING_KEYS, type Rng } from '@hoops/core'

export type MinutesMode = 'real' | 'model'

const SLOTS = [35, 34, 33, 31, 29, 24, 20, 16, 10, 5, 2, 1, 0, 0, 0]

/** A player available to a team, with real games played and minutes for that stint. */
export interface PoolEntry {
  player: PlayerRecord
  gp: number
  mpg: number
}

export function overallOf(p: PlayerRecord): number {
  let s = 0
  for (const k of RATING_KEYS) s += p.ratings[k]
  return s / RATING_KEYS.length
}

/** Per-team pools. Real mode uses every stint that season so traded players play for the right team. */
export function buildPools(
  players: PlayerRecord[],
  stints: { playerId: string; teamId: string; gp: number; mpg: number }[],
  mode: MinutesMode,
): Map<string, PoolEntry[]> {
  const pools = new Map<string, PoolEntry[]>()
  const add = (teamId: string, e: PoolEntry) => pools.set(teamId, [...(pools.get(teamId) ?? []), e])
  if (mode === 'real' && stints.length > 0) {
    const byId = new Map(players.map((p) => [p.playerId, p]))
    for (const s of stints) {
      const p = byId.get(s.playerId)
      if (p) add(s.teamId, { player: p, gp: s.gp, mpg: s.mpg })
    }
  } else {
    for (const p of players) add(p.teamId, { player: p, gp: p.real?.gp ?? 0, mpg: p.realMpg })
  }
  return pools
}

export function poolOf(players: PlayerRecord[]): PoolEntry[] {
  return players.map((p) => ({ player: p, gp: p.real?.gp ?? 0, mpg: p.realMpg }))
}

/** Returns players who dress tonight with their minutes targets summing to 240. */
export function pickMinutes(
  pool: PoolEntry[],
  mode: MinutesMode,
  teamGames: number,
  rng: Rng,
): { player: PlayerRecord; minutesTarget: number; starter: boolean }[] {
  const roster = pool.map((e) => e.player)
  let dressed: { player: PlayerRecord; minutesTarget: number }[]
  if (mode === 'real') {
    dressed = pool
      .filter((e) => e.gp > 0 && rng.chance(Math.min(1, e.gp / teamGames)))
      .map((e) => ({ player: e.player, minutesTarget: e.mpg }))
  } else {
    const sorted = [...roster].sort((a, b) => overallOf(b) - overallOf(a))
    dressed = sorted.slice(0, 13).map((p, i) => ({ player: p, minutesTarget: SLOTS[i] ?? 0 }))
  }
  dressed = dressed.filter((d) => d.minutesTarget > 0)
  if (dressed.length < 8) {
    // Short-handed: pull the next-best bodies in.
    const have = new Set(dressed.map((d) => d.player.playerId))
    const extra = roster
      .filter((p) => !have.has(p.playerId))
      .sort((a, b) => overallOf(b) - overallOf(a))
    for (const p of extra) {
      if (dressed.length >= 8) break
      dressed.push({ player: p, minutesTarget: 8 })
    }
  }
  const total = dressed.reduce((a, d) => a + d.minutesTarget, 0) || 1
  const scaled = dressed
    .map((d) => ({ ...d, minutesTarget: (d.minutesTarget * 240) / total }))
    .sort((a, b) => b.minutesTarget - a.minutesTarget)
  return scaled.map((d, i) => ({ ...d, starter: i < 5 }))
}
