// Team stints from player game logs. Pure: rows in, stints out.
// A stint is a run of consecutive games (by date) for one team. Stint 1 is the first team of the season.
// A player traded away and back gets a third stint on the first team.

export const BOX_KEYS = [
  'fgm',
  'fga',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'ast',
  'tov',
  'stl',
  'blk',
  'pf',
  'pts',
] as const
export type BoxKey = (typeof BOX_KEYS)[number]
export type BoxTotals = Record<BoxKey, number>

/** The subset of a player game log row that stint derivation needs. Nulls read as 0. */
export interface GameLine extends Partial<Record<BoxKey, number | null>> {
  player_id: number | string
  team_id: number | string
  game_id: string
  game_date: string
  min: number | null
}

export interface Stint {
  playerId: string
  teamId: string
  order: number // 1 = first team that season
  gp: number
  min: number
  firstDate: string
  lastDate: string
  totals: BoxTotals
}

export function emptyTotals(): BoxTotals {
  return Object.fromEntries(BOX_KEYS.map((k) => [k, 0])) as BoxTotals
}

export function addLine(into: BoxTotals, line: Partial<Record<BoxKey, number | null>>): void {
  for (const k of BOX_KEYS) into[k] += line[k] ?? 0
}

/** Date then game id, so same-day rows (rare) are stable. */
export function byDateThenId(a: GameLine, b: GameLine): number {
  if (a.game_date !== b.game_date) return a.game_date < b.game_date ? -1 : 1
  if (a.game_id !== b.game_id) return a.game_id < b.game_id ? -1 : 1
  return 0
}

export function deriveStints(games: readonly GameLine[]): Stint[] {
  const byPlayer = new Map<string, GameLine[]>()
  for (const g of games) {
    const id = String(g.player_id)
    const list = byPlayer.get(id)
    if (list) list.push(g)
    else byPlayer.set(id, [g])
  }
  const out: Stint[] = []
  for (const [playerId, list] of byPlayer) {
    list.sort(byDateThenId)
    let cur: Stint | null = null
    for (const g of list) {
      const teamId = String(g.team_id)
      if (!cur || cur.teamId !== teamId) {
        cur = {
          playerId,
          teamId,
          order: cur ? cur.order + 1 : 1,
          gp: 0,
          min: 0,
          firstDate: g.game_date,
          lastDate: g.game_date,
          totals: emptyTotals(),
        }
        out.push(cur)
      }
      cur.gp++
      cur.min += g.min ?? 0
      cur.lastDate = g.game_date
      addLine(cur.totals, g)
    }
  }
  return out
}
