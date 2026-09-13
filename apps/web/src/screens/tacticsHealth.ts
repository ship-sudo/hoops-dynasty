/**
 * Who cannot dress, and when they are back. The tactics screen and a test share this so a
 * "season-ending" label cannot disagree with the engine's remaining games.
 */
import type { InjurySeverity } from '@hoops/injury'
import type { RosterRow } from '../sim/api.ts'
import { healthKind } from './playerDossier.ts'

export interface TrainerRow {
  playerId: string
  name: string
  pos: string
  kind: 'out' | 'dtd' | 'through' | 'season'
  injuryName: string
  when: string
}

export function remainingTeamGames(
  calendar:
    | { next: number; schedule: { homeTeamId: string; awayTeamId: string }[] }
    | null
    | undefined,
  teamId: string,
): number {
  if (!calendar || !teamId) return 0
  let n = 0
  for (let i = calendar.next; i < calendar.schedule.length; i++) {
    const g = calendar.schedule[i]
    if (g && (g.homeTeamId === teamId || g.awayTeamId === teamId)) n++
  }
  return n
}

/** True when he cannot take the floor. Day-to-day and playing-through still can. */
export function cannotDress(injury: RosterRow['injury']): boolean {
  return healthKind(injury) === 'out'
}

export function returnWhen(
  injury: NonNullable<RosterRow['injury']>,
  severity: InjurySeverity | null | undefined,
  gamesLeft: number,
): { kind: TrainerRow['kind']; when: string } {
  const kind = healthKind(injury)
  if (kind === 'through') return { kind: 'through', when: 'Playing through · can dress' }
  if (kind === 'dtd') return { kind: 'dtd', when: 'Day-to-day · can dress' }
  const n = injury.games
  const seasonOver = severity === 'season' || (gamesLeft > 0 && n >= gamesLeft)
  if (seasonOver) return { kind: 'season', when: 'Out for the season' }
  return {
    kind: 'out',
    when: n === 1 ? 'Back next game' : `Back in ${n} games`,
  }
}

/** Hurt men, worst first. Empty when the whole roster can dress without a knock. */
export function trainerRows(
  rows: RosterRow[],
  gamesLeft: number,
  severityOf: (playerId: string) => InjurySeverity | null | undefined,
): TrainerRow[] {
  const out: TrainerRow[] = []
  for (const r of rows) {
    if (!r.injury) continue
    const hit = returnWhen(r.injury, severityOf(r.player.playerId), gamesLeft)
    out.push({
      playerId: r.player.playerId,
      name: r.player.name,
      pos: r.player.pos,
      kind: hit.kind,
      injuryName: r.injury.name,
      when: hit.when,
    })
  }
  const rank = { season: 0, out: 1, dtd: 2, through: 3 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
}

/** Short tag on a lineup <option>, so you do not pick a man who cannot dress. */
export function injuryOptionTag(
  injury: RosterRow['injury'],
  severity: InjurySeverity | null | undefined,
  gamesLeft: number,
): string {
  if (!injury) return ''
  const hit = returnWhen(injury, severity, gamesLeft)
  if (hit.kind === 'season') return ' · OUT season'
  if (hit.kind === 'out') return ` · OUT ${injury.games}`
  if (hit.kind === 'through') return ' · playing through'
  return ' · DTD'
}
