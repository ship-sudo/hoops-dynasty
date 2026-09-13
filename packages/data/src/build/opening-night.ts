// The opening-night roster rule. Pure.
//
// Rule: a player's opening-night team is the team of his first stint that season (first game log by date).
// A player with zero games that season but present on a season-end roster (commonteamroster) joins that
// roster team with real = null. A team is capped at `cap` players (default 20): the players with the most
// minutes in that first stint stay, roster-only players rank last. The overflow is dropped and counted.
//
// Known error: stats.nba.com has no opening-night roster, so this is a proxy.
// - A mid-season free-agent signing or 10-day contract appears on the team from opening night.
// - A player traded before playing a game appears on the wrong (receiving) team.
// - A player cut in preseason who never played is missing entirely.
// - Bit players beyond the cap (two-way and 10-day churn, common from 2017-18) are dropped.

export interface StintSummary {
  playerId: string
  teamId: string
  order: number
  gp: number
  min: number
}

export interface RosterEntry {
  playerId: string
  teamId: string
}

export interface OpeningNightEntry {
  playerId: string
  teamId: string
  source: 'stint' | 'roster'
  min: number
}

export interface OpeningNight {
  entries: OpeningNightEntry[]
  dropped: OpeningNightEntry[]
}

export function openingNightRosters(
  stints: readonly StintSummary[],
  rosters: readonly RosterEntry[],
  cap = 20,
): OpeningNight {
  const first = new Map<string, OpeningNightEntry>()
  for (const s of stints) {
    if (s.order !== 1) continue
    first.set(s.playerId, { playerId: s.playerId, teamId: s.teamId, source: 'stint', min: s.min })
  }
  for (const r of rosters) {
    if (first.has(r.playerId)) continue
    first.set(r.playerId, { playerId: r.playerId, teamId: r.teamId, source: 'roster', min: 0 })
  }
  const byTeam = new Map<string, OpeningNightEntry[]>()
  for (const e of first.values()) {
    const list = byTeam.get(e.teamId)
    if (list) list.push(e)
    else byTeam.set(e.teamId, [e])
  }
  const entries: OpeningNightEntry[] = []
  const dropped: OpeningNightEntry[] = []
  for (const list of byTeam.values()) {
    list.sort((a, b) => b.min - a.min || (a.playerId < b.playerId ? -1 : 1))
    entries.push(...list.slice(0, cap))
    dropped.push(...list.slice(cap))
  }
  entries.sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : b.min - a.min))
  return { entries, dropped }
}

export const OPENING_NIGHT_RULE = `A player's opening-night team is the team of his first stint that season (first game log by date). A player with zero games but on a season-end roster (commonteamroster) joins that roster team with real = null. Teams are capped at 20: most first-stint minutes stay, roster-only players rank last, the rest are dropped.`

export const OPENING_NIGHT_ERROR = `stats.nba.com has no opening-night roster, so this is a proxy. Mid-season free-agent signings and 10-day contracts appear from opening night. A player traded before playing a game appears on the receiving team. Players cut in preseason who never played are missing. Bit players beyond the cap of 20 (two-way and 10-day churn, common from 2017-18) are dropped.`
