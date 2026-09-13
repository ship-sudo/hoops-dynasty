// Pull a hurt man out of the manager's plan. Rotation already skips `out > 0`; this is the
// minutes, inactive list and named fives the tactics screen actually shows.

import {
  LINEUP_UNIT_IDS,
  type NamedLineups,
  POSITIONS,
  type Position,
  positionGap,
} from '@hoops/core'
import { overallOf } from './rotation.ts'
import {
  availabilityOf,
  type GameState,
  type LeaguePlayer,
  rosterOf,
  type TeamSettings,
} from './state.ts'

const TEAM_MINUTES = 240
const AUTO_RS = [34, 32, 30, 28, 26, 24, 22, 18, 16]
const AUTO_PO = [38, 36, 34, 32, 28, 24, 20, 16]

function withoutPlayer(
  slots: Partial<Record<(typeof POSITIONS)[number], string>> | undefined,
  playerId: string,
): Partial<Record<(typeof POSITIONS)[number], string>> | undefined {
  if (!slots) return slots
  const next: Partial<Record<(typeof POSITIONS)[number], string>> = {}
  for (const pos of POSITIONS) {
    const id = slots[pos]
    if (id && id !== playerId) next[pos] = id
  }
  return next
}

/** Sit this player: inactive, zero minutes, pulled from every named five. */
export function coverInjured(settings: TeamSettings, playerId: string): TeamSettings {
  const inactive = settings.inactive.includes(playerId)
    ? settings.inactive
    : [...settings.inactive, playerId]
  const minutes = { ...settings.minutes, [playerId]: 0 }
  const lineup = withoutPlayer(settings.lineup, playerId)
  let lineups = settings.lineups
  if (lineups) {
    const next: NamedLineups = {}
    for (const unit of LINEUP_UNIT_IDS) {
      const cleaned = withoutPlayer(lineups[unit], playerId)
      if (cleaned && POSITIONS.some((p) => cleaned[p])) next[unit] = cleaned
    }
    lineups = Object.keys(next).length > 0 ? next : undefined
  }
  const out: TeamSettings = { ...settings, inactive, minutes }
  if (lineup && Object.keys(lineup).length > 0) out.lineup = lineup
  else delete out.lineup
  if (lineups) out.lineups = lineups
  else delete out.lineups
  return out
}

/**
 * Stamp the minutes he had before cover, so healing can put him back. Skip a man the manager
 * already benched — that is a lineup choice, not an injury cover.
 */
export function markInjuryCover(state: GameState, playerId: string): void {
  const player = state.league.players.find((p) => p.playerId === playerId)
  if (!player?.teamId) return
  const a = availabilityOf(state, playerId)
  if (a.heldMinutes != null) return
  const settings = state.teamSettings[player.teamId]
  if (settings?.inactive.includes(playerId)) return
  a.heldMinutes = settings?.minutes[playerId] ?? 0
}

/** Off the inactive list, minutes restored, not left at the back of the depth chart. */
export function uncoverReturned(
  settings: TeamSettings,
  playerId: string,
  minutesBack: number,
): TeamSettings {
  const minutes = { ...settings.minutes, [playerId]: minutesBack }
  const inactive = settings.inactive.filter((id) => id !== playerId)
  const without = settings.depth.filter((id) => id !== playerId)
  const active = without.filter((id) => !inactive.includes(id))
  const parked = without.filter((id) => inactive.includes(id))
  let at = active.length
  for (let i = 0; i < active.length; i++) {
    if ((minutes[active[i]!] ?? 0) < minutesBack) {
      at = i
      break
    }
  }
  const depth = [...active.slice(0, at), playerId, ...active.slice(at), ...parked]
  return { ...settings, inactive, minutes, depth }
}

/**
 * Inverse of a computer cover: when `out` hits 0, dress him again. A stamp of 0 minutes means
 * there was no personal assignment — rebuild the eight-man split around the now-healthy roster.
 * Inactive with no stamp still counts if the injury record is still on him (old covers,
 * before the stamp). A healthy bench with no injury is left alone.
 */
export function restoreInjuryCover(state: GameState, player: LeaguePlayer): void {
  if (player.teamId == null) return
  const a = availabilityOf(state, player.playerId)
  if (a.out > 0) return
  const settings = state.teamSettings[player.teamId]
  if (!settings) {
    delete a.heldMinutes
    return
  }
  const parked = settings.inactive.includes(player.playerId)
  const stamped = a.heldMinutes
  delete a.heldMinutes
  const wasHurt = a.injury != null
  if (stamped == null && !(parked && wasHurt)) return
  const back = stamped ?? 0
  if (back > 0) {
    state.teamSettings[player.teamId] = uncoverReturned(settings, player.playerId, back)
    return
  }
  const roster = rosterOf(state, player.teamId)
  const skip = new Set<string>()
  for (const q of roster) {
    if (availabilityOf(state, q.playerId).out > 0) skip.add(q.playerId)
  }
  const playoffs = state.phase === 'playoffs' || state.phase === 'playin'
  state.teamSettings[player.teamId] = autoAdjustSettings(settings, roster, skip, playoffs)
}

/** He left the club. Pull him out of the plan entirely — not inactive, gone. */
export function dropFromRoster(settings: TeamSettings, playerId: string): TeamSettings {
  const minutes = { ...settings.minutes }
  delete minutes[playerId]
  const instructions = settings.instructions ? { ...settings.instructions } : undefined
  if (instructions) delete instructions[playerId]
  const lineup = withoutPlayer(settings.lineup, playerId)
  let lineups = settings.lineups
  if (lineups) {
    const next: NamedLineups = {}
    for (const unit of LINEUP_UNIT_IDS) {
      const cleaned = withoutPlayer(lineups[unit], playerId)
      if (cleaned && POSITIONS.some((p) => cleaned[p])) next[unit] = cleaned
    }
    lineups = Object.keys(next).length > 0 ? next : undefined
  }
  const out: TeamSettings = {
    ...settings,
    depth: settings.depth.filter((id) => id !== playerId),
    minutes,
    inactive: settings.inactive.filter((id) => id !== playerId),
  }
  if (instructions && Object.keys(instructions).length > 0) out.instructions = instructions
  else delete out.instructions
  if (lineup && Object.keys(lineup).length > 0) out.lineup = lineup
  else delete out.lineup
  if (lineups) out.lineups = lineups
  else delete out.lineups
  return out
}

/** Best remaining body for each slot. Naturals first, then the next-closest position. */
function pickFive(pool: LeaguePlayer[], taken: Set<string>): Partial<Record<Position, string>> {
  const next: Partial<Record<Position, string>> = {}
  for (const gap of [0, 1, 2, 3, 4]) {
    for (const pos of POSITIONS) {
      if (next[pos]) continue
      const man = pool.find(
        (p) => !taken.has(p.playerId) && Math.abs(positionGap(p.pos, pos)) === gap,
      )
      if (!man) continue
      next[pos] = man.playerId
      taken.add(man.playerId)
    }
  }
  return next
}

/**
 * The tactics screen's "Auto-adjust": starters, bench, closing, and an 8–9 man minutes split.
 * Anyone in `skip` is inactive with zero minutes — hurt tonight, or the man just covered.
 */
export function autoAdjustSettings(
  settings: TeamSettings,
  roster: LeaguePlayer[],
  skip: ReadonlySet<string>,
  playoffs: boolean,
): TeamSettings {
  const pool = [...roster]
    .filter((p) => !skip.has(p.playerId))
    .sort((a, b) => overallOf(b) - overallOf(a) || (a.playerId < b.playerId ? -1 : 1))
  const taken = new Set<string>()
  const starters = pickFive(pool, taken)
  const benchUnit = pickFive(pool, taken)
  const units: NamedLineups = { starters, bench: benchUnit, closing: { ...starters } }
  const rotation: string[] = []
  for (const slots of [starters, benchUnit]) {
    for (const pos of POSITIONS) {
      const id = slots[pos]
      if (id && !rotation.includes(id)) rotation.push(id)
    }
  }
  const ladder = playoffs ? AUTO_PO : AUTO_RS
  const depth = ladder.length
  while (rotation.length < depth) {
    const extra = pool.find((p) => !rotation.includes(p.playerId))
    if (!extra) break
    rotation.push(extra.playerId)
  }
  const used = rotation.slice(0, depth)
  const ids = roster.map((p) => p.playerId)
  const minutes: Record<string, number> = { ...settings.minutes }
  for (const id of ids) minutes[id] = 0
  const byId = new Map(roster.map((p) => [p.playerId, p]))
  const caps = used.map((id) => ((byId.get(id)?.age ?? 0) >= 34 ? 24 : 40))
  let want = used.map((_, i) => ladder[i] ?? 0)
  for (let pass = 0; pass < 8; pass++) {
    want = want.map((m, i) => Math.min(caps[i] ?? 40, m))
    const sum = want.reduce((a, b) => a + b, 0) || 1
    if (Math.abs(sum - TEAM_MINUTES) < 0.5) break
    const room = used.map((_, i) => (caps[i] ?? 40) - (want[i] ?? 0))
    const free = room.reduce((a, b) => a + Math.max(0, b), 0)
    const need = TEAM_MINUTES - want.reduce((a, b) => a + b, 0)
    if (free <= 0 || need === 0) break
    want = want.map((m, i) => m + (Math.max(0, room[i] ?? 0) / free) * need)
  }
  used.forEach((id, i) => {
    minutes[id] = Math.round(want[i] ?? 0)
  })
  let drift = TEAM_MINUTES - used.reduce((s, id) => s + (minutes[id] ?? 0), 0)
  const order2 = [...used].sort((a, b) => (minutes[b] ?? 0) - (minutes[a] ?? 0))
  for (let pass = 0; pass < 4 && drift !== 0; pass++) {
    for (const id of drift > 0 ? order2 : [...order2].reverse()) {
      if (drift === 0) break
      const i = used.indexOf(id)
      const step = drift > 0 ? 1 : -1
      const v = (minutes[id] ?? 0) + step
      if (v < 0 || v > (caps[i] ?? 40)) continue
      minutes[id] = v
      drift -= step
    }
  }
  const depthOrder = [...used, ...ids.filter((id) => !used.includes(id))]
  return {
    ...settings,
    depth: depthOrder,
    lineup: starters,
    lineups: units,
    minutes,
    inactive: ids.filter((id) => !used.includes(id)),
  }
}
