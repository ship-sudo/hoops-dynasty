/**
 * Facts the player card has to lead with. Pure, so the screen and a test cannot disagree
 * about "healthy" vs "out".
 */
import type { GameSummary, PlayerAvailability } from '@hoops/game'
import { isWarning } from '@hoops/injury'
import type { GameLogRow, RosterRow } from '../sim/api.ts'

export type HealthKind = 'healthy' | 'out' | 'dtd' | 'through'

export function injuryFromAvail(a: PlayerAvailability): RosterRow['injury'] {
  if (!a.injury) return undefined
  const playingThrough = Boolean(a.playingThrough)
  if (a.out <= 0 && !playingThrough) return undefined
  const hit: NonNullable<RosterRow['injury']> = {
    name: a.injury.name,
    games: a.out > 0 ? a.out : a.injury.games,
    warning: isWarning(a.injury),
  }
  if (playingThrough) hit.playingThrough = true
  return hit
}

export function healthKind(injury: RosterRow['injury']): HealthKind {
  if (!injury) return 'healthy'
  if (injury.warning && injury.playingThrough) return 'through'
  if (injury.warning) return 'dtd'
  return 'out'
}

/** Chip, banner, and the one sentence a GM needs. Fit men get no banner. */
export function healthCopy(injury: RosterRow['injury']): {
  kind: HealthKind
  chip: string
  badge: 'win' | 'warn' | 'loss'
  headline: string | null
  detail: string | null
} {
  const kind = healthKind(injury)
  if (kind === 'healthy')
    return { kind, chip: 'Healthy', badge: 'win', headline: null, detail: null }
  if (!injury) return { kind, chip: 'Healthy', badge: 'win', headline: null, detail: null }
  const n = injury.games
  const games = `${n} game${n === 1 ? '' : 's'}`
  if (kind === 'through')
    return {
      kind,
      chip: 'Playing through',
      badge: 'warn',
      headline: `${injury.name} — playing through`,
      detail: 'Sit him or this can get worse.',
    }
  if (kind === 'dtd')
    return {
      kind,
      chip: 'Day-to-day',
      badge: 'warn',
      headline: `${injury.name} · day-to-day`,
      detail: 'He can dress. Sitting the spell is how it stays a knock.',
    }
  return {
    kind,
    chip: 'Out',
    badge: 'loss',
    headline: `${injury.name} · out ${games}`,
    detail: `He cannot dress. ${games} left.`,
  }
}

/** Legs: the 0–1 condition the engine already keeps. */
export function legsOf(condition: number): {
  v: string
  note: string
  tone: 'win' | 'loss' | 'warn' | undefined
} {
  const note = `${Math.round(condition * 100)}%`
  if (condition >= 0.95) return { v: 'Fresh', note, tone: 'win' }
  if (condition >= 0.85) return { v: 'Fine', note, tone: undefined }
  if (condition >= 0.78) return { v: 'Used', note, tone: undefined }
  if (condition >= 0.68) return { v: 'Tired', note, tone: 'warn' }
  return { v: 'Gassed', note, tone: 'loss' }
}

export interface RecentGame {
  gameId: string
  date: string
  opponentTeamId: string
  home: boolean
  won: boolean
  teamPts: number
  opponentPts: number
  started: boolean
  seasonType: 'regular' | 'playin' | 'playoffs'
  thin: boolean
  dnp: boolean
  /** Null means he did not dress — only when we actually have the box. */
  log: GameLogRow | null
}

export type LogSplit = 'regular' | 'postseason'

export function isPostseasonType(t: GameLogRow['seasonType'] | undefined): boolean {
  return t === 'playoffs' || t === 'playin'
}

export function logsOf(logs: GameLogRow[], which: LogSplit): GameLogRow[] {
  return logs.filter((g) =>
    which === 'postseason' ? isPostseasonType(g.seasonType) : !isPostseasonType(g.seasonType),
  )
}

/**
 * Team games newest first. A DNP row is a night we saw the box and he was not in it —
 * not a guess from a missing cache. Last-N averages skip those.
 */
export function recentGames(logs: GameLogRow[], limit = 10): RecentGame[] {
  return logs.slice(0, limit).map((g) => ({
    gameId: g.gameId,
    date: g.date,
    opponentTeamId: g.opponentTeamId,
    home: g.home,
    won: g.won,
    teamPts: g.teamPts,
    opponentPts: g.opponentPts,
    started: g.started,
    seasonType: g.seasonType ?? 'regular',
    thin: Boolean(g.thin),
    dnp: Boolean(g.dnp),
    log: g,
  }))
}

export type AbsenceMark = 'out' | 'dnp' | null

/**
 * While he is still injured, the leading streak of missed games is Out.
 * Older misses, or a healthy benching, stay DNP. A dressed game ends the streak.
 */
export function absenceMark(games: RecentGame[], currentlyOut: boolean): AbsenceMark[] {
  let leading = currentlyOut
  return games.map((g) => {
    const dressed = !g.dnp && (g.log?.line.min ?? 0) > 0
    if (dressed) {
      leading = false
      return null
    }
    const mark: AbsenceMark = leading ? 'out' : 'dnp'
    return mark
  })
}

export interface LastNAverages {
  gp: number
  min: number
  pts: number
  reb: number
  ast: number
}

/** Per-game line over the last N performances (games with minutes). */
export function lastNAverages(games: RecentGame[], n = 5): LastNAverages | null {
  const played = games.filter((g) => !g.dnp && (g.log?.line.min ?? 0) > 0).slice(0, n)
  if (played.length === 0) return null
  const gp = played.length
  let min = 0
  let pts = 0
  let reb = 0
  let ast = 0
  for (const g of played) {
    const line = g.log?.line
    if (!line) continue
    min += line.min
    pts += line.pts
    reb += line.oreb + line.dreb
    ast += line.ast
  }
  return { gp, min: min / gp, pts: pts / gp, reb: reb / gp, ast: ast / gp }
}

/**
 * Playoff + play-in averages from the save's game summaries. Regular-season totals live on
 * `stats`; these lines are the only playoff counting stats that survive a reload.
 */
export function playoffTotals(results: GameSummary[], playerId: string): LastNAverages | null {
  let gp = 0
  let min = 0
  let pts = 0
  let reb = 0
  let ast = 0
  for (const g of results) {
    if (g.seasonType === 'regular') continue
    const line = g.players?.find((p) => p.playerId === playerId)
    if (!line || line.min <= 0) continue
    gp++
    min += line.min
    pts += line.pts
    reb += line.reb
    ast += line.ast
  }
  if (gp === 0) return null
  return { gp, min: min / gp, pts: pts / gp, reb: reb / gp, ast: ast / gp }
}
