// All-Star weekend: a date on the calendar, two conference squads, one exhibition.
//
// The break is mid-February on a normal October-start season. Lockout years that open after
// New Year's have no All-Star weekend. The exhibition does not touch standings, season totals
// or injuries — it is a show, then the calendar starts again.

import type { GameInput, PlayerGameInput, Rng } from '@hoops/core'
import { addDays } from './dates.ts'
import type { GameHooks, GameState, LeaguePlayer } from './state.ts'

export interface AllStarPick {
  playerId: string
  starter: boolean
}

export interface AllStarBreak {
  yearEnd: number
  date: string
  east: AllStarPick[]
  west: AllStarPick[]
  result: { eastPts: number; westPts: number; mvpPlayerId: string | null } | null
}

/** Mid-February of the season's winter, or null when this calendar has no break. */
export function allStarDate(start: string, end: string): string | null {
  const startMonth = Number(start.slice(5, 7))
  const y = Number(start.slice(0, 4)) + (startMonth >= 8 ? 1 : 0)
  if (start >= `${y}-01-01`) return null
  const target = `${y}-02-15`
  if (target < start || target > end) return null
  return target
}

/** Thursday–Sunday around the break: four nights with no regular-season games. */
export function isAllStarRestDay(date: string, breakDate: string): boolean {
  return date >= addDays(breakDate, -1) && date <= addDays(breakDate, 2)
}

function prod(s: { gp: number; pts: number; oreb: number; dreb: number; ast: number }): number {
  if (s.gp <= 0) return 0
  return (s.pts + 1.2 * (s.oreb + s.dreb) + 1.5 * s.ast) / s.gp
}

/** Twelve a side, top five starting. Floor is "has played", not the 58% awards cut. */
export function pickAllStars(state: GameState): { east: AllStarPick[]; west: AllStarPick[] } {
  const confOf = new Map(state.league.teams.map((t) => [t.teamId, t.conference]))
  const byId = new Map(state.league.players.map((p) => [p.playerId, p]))
  const east: { id: string; score: number }[] = []
  const west: { id: string; score: number }[] = []
  for (const [id, s] of Object.entries(state.stats)) {
    if (s.gp < 8) continue
    const p = byId.get(id)
    if (!p?.teamId) continue
    const row = { id, score: prod(s) }
    if (confOf.get(p.teamId) === 'West') west.push(row)
    else east.push(row)
  }
  const take = (pool: { id: string; score: number }[]): AllStarPick[] =>
    [...pool]
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, 12)
      .map((r, i) => ({ playerId: r.id, starter: i < 5 }))
  return { east: take(east), west: take(west) }
}

function exhibitionPlayer(p: LeaguePlayer, starter: boolean): PlayerGameInput {
  return {
    playerId: p.playerId,
    name: p.name,
    pos: p.pos,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    age: p.age,
    ratings: p.ratings,
    tendencies: p.tendencies,
    minutesTarget: starter ? 28 : 20,
    starter,
    condition: 1,
  }
}

function squad(state: GameState, picks: AllStarPick[], teamId: string): GameInput['home'] {
  const byId = new Map(state.league.players.map((p) => [p.playerId, p]))
  const players = picks
    .map((sel) => {
      const p = byId.get(sel.playerId)
      return p ? exhibitionPlayer(p, sel.starter) : null
    })
    .filter((x): x is PlayerGameInput => !!x)
  return {
    teamId,
    name: teamId,
    players,
    tactics: { pace: 1, threes: 1, crashGlass: -1, pressure: -1, zone: false },
  }
}

/**
 * Freeze the squads, play the exhibition, write it on the save. Call once per season, on the
 * break day. The game does not count.
 */
export function holdAllStarBreak(
  state: GameState,
  hooks: GameHooks,
  rng: Rng,
  date: string,
): AllStarBreak {
  const { east, west } = pickAllStars(state)
  const breakState: AllStarBreak = { yearEnd: state.season.yearEnd, date, east, west, result: null }
  if (east.length >= 8 && west.length >= 8) {
    const input: GameInput = {
      era: state.season.era,
      home: squad(state, east, 'EAST'),
      away: squad(state, west, 'WEST'),
      seasonType: 'regular',
      neutralSite: true,
    }
    const result = hooks.engine(input, rng.int(2 ** 31))
    const winners = result.home.pts >= result.away.pts ? result.home : result.away
    let mvp = winners.players[0] ?? null
    for (const line of winners.players) {
      const score = (l: typeof line) => l.pts + 1.2 * (l.oreb + l.dreb) + 1.5 * l.ast
      if (mvp && score(line) > score(mvp)) mvp = line
    }
    breakState.result = {
      eastPts: result.home.pts,
      westPts: result.away.pts,
      mvpPlayerId: mvp?.playerId ?? null,
    }
  }
  state.allStar = breakState
  return breakState
}
