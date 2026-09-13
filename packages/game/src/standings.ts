// Standings, the NBA tiebreaker ladder, and era-correct playoff seeding.
//
// Tiebreaker ladder (two or more teams, same win pct):
//   1. Head-to-head record between the tied teams
//   2. Division leader beats a non-leader        -- dropped by the NBA from 2022-23; gated on the era
//   3. Division record                            -- only when all tied teams share a division
//   4. Conference record                          -- only when all tied teams share a conference
//   5. Record against conference playoff teams    -- uses the provisional field (steps 1-4 only)
//   6. Point differential
//   7. Deterministic coin flip seeded by the league seed and the team ids
// Multi-team ties are resolved by applying the ladder to the whole group, then re-running it on
// what is left, which is what the NBA does.

import type { Conference, GameState, LeagueTeam, TeamRecord } from './state.ts'

export interface StandingRow {
  teamId: string
  conference: Conference
  division: string
  wins: number
  losses: number
  pct: number
  gb: number
  divisionRank: number
}

export function winPct(r: TeamRecord): number {
  const g = r.wins + r.losses
  return g === 0 ? 0 : r.wins / g
}

function hash(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** Step 7. Deterministic, and it does not consume the league rng, so replays are identical. */
function coinFlip(seed: number, a: string, b: string): number {
  return hash(`${seed}:${a}`) - hash(`${seed}:${b}`) || (a < b ? -1 : 1)
}

function subRecord(rec: TeamRecord, against: Set<string>): number {
  let w = 0
  let l = 0
  for (const [opp, wl] of Object.entries(rec.h2h)) {
    if (!against.has(opp)) continue
    w += wl.w
    l += wl.l
  }
  return w + l === 0 ? 0 : w / (w + l)
}

interface Ctx {
  seed: number
  teams: Map<string, LeagueTeam>
  records: Record<string, TeamRecord>
  /** Teams leading their division (by raw win pct, ties shared). */
  divisionLeaders: Set<string>
  /** Provisional playoff field per conference, from a ladder run that stops before step 5. */
  playoffField: Set<string>
  useDivisionLeaderRule: boolean
}

function rec(ctx: Ctx, id: string): TeamRecord {
  return ctx.records[id] as TeamRecord
}

/** Compares two tied teams. `group` is every team in the tie, for the head-to-head step. */
function breakTie(ctx: Ctx, a: string, b: string, group: string[], deep: boolean): number {
  const ra = rec(ctx, a)
  const rb = rec(ctx, b)
  // 1. head to head among the tied group (for a pair, that is just each other)
  const vs = new Set(group)
  vs.delete(a)
  const h2hA = subRecord(ra, vs)
  const vsB = new Set(group)
  vsB.delete(b)
  const h2hB = subRecord(rb, vsB)
  if (h2hA !== h2hB) return h2hB - h2hA

  const ta = ctx.teams.get(a) as LeagueTeam
  const tb = ctx.teams.get(b) as LeagueTeam

  // 2. division leader
  if (ctx.useDivisionLeaderRule) {
    const la = ctx.divisionLeaders.has(a) ? 1 : 0
    const lb = ctx.divisionLeaders.has(b) ? 1 : 0
    if (la !== lb) return lb - la
  }

  // 3. division record, when the whole tie is inside one division
  if (group.every((x) => (ctx.teams.get(x) as LeagueTeam).division === ta.division)) {
    const pa = ra.divW + ra.divL === 0 ? 0 : ra.divW / (ra.divW + ra.divL)
    const pb = rb.divW + rb.divL === 0 ? 0 : rb.divW / (rb.divW + rb.divL)
    if (pa !== pb) return pb - pa
  }

  // 4. conference record, when the whole tie is inside one conference
  if (ta.conference === tb.conference) {
    const pa = ra.confW + ra.confL === 0 ? 0 : ra.confW / (ra.confW + ra.confL)
    const pb = rb.confW + rb.confL === 0 ? 0 : rb.confW / (rb.confW + rb.confL)
    if (pa !== pb) return pb - pa
  }

  // 5. record against conference playoff teams (skipped on the provisional pass)
  if (deep) {
    const field = new Set(
      [...ctx.playoffField].filter(
        (x) => (ctx.teams.get(x) as LeagueTeam).conference === ta.conference,
      ),
    )
    const pa = subRecord(ra, field)
    const pb = subRecord(rb, field)
    if (pa !== pb) return pb - pa
  }

  // 6. point differential
  const da = ra.pf - ra.pa
  const db = rb.pf - rb.pa
  if (da !== db) return db - da

  // 7. coin flip
  return coinFlip(ctx.seed, a, b)
}

function orderTeams(ctx: Ctx, ids: string[], deep: boolean): string[] {
  const byPct = [...ids].sort((x, y) => winPct(rec(ctx, y)) - winPct(rec(ctx, x)))
  const out: string[] = []
  let i = 0
  while (i < byPct.length) {
    let j = i
    while (
      j + 1 < byPct.length &&
      winPct(rec(ctx, byPct[j + 1] as string)) === winPct(rec(ctx, byPct[i] as string))
    )
      j++
    const group = byPct.slice(i, j + 1)
    if (group.length === 1) out.push(group[0] as string)
    else {
      const sorted = [...group].sort((a, b) => breakTie(ctx, a, b, group, deep))
      out.push(...sorted)
    }
    i = j + 1
  }
  return out
}

function makeCtx(state: GameState): Ctx {
  const teams = new Map(state.league.teams.map((t) => [t.teamId, t]))
  const ctx: Ctx = {
    seed: state.seed,
    teams,
    records: state.records,
    divisionLeaders: new Set(),
    playoffField: new Set(),
    useDivisionLeaderRule: state.season.yearEnd <= 2022,
  }
  // Division leaders by raw win pct (ties all count as leaders; step 2 only needs the flag).
  const byDiv = new Map<string, string[]>()
  for (const t of state.league.teams) {
    const k = `${t.conference}/${t.division}`
    byDiv.set(k, [...(byDiv.get(k) ?? []), t.teamId])
  }
  for (const ids of byDiv.values()) {
    let best = -1
    for (const id of ids) best = Math.max(best, winPct(rec(ctx, id)))
    for (const id of ids) if (winPct(rec(ctx, id)) === best) ctx.divisionLeaders.add(id)
  }
  // Provisional playoff field, ladder steps 1-4 only, so step 5 has something to point at.
  const field = state.season.rules.playoffs.teams / 2
  for (const conf of ['East', 'West'] as const) {
    const ids = state.league.teams.filter((t) => t.conference === conf).map((t) => t.teamId)
    for (const id of orderTeams(ctx, ids, false).slice(0, field)) ctx.playoffField.add(id)
  }
  return ctx
}

/** Teams of one conference, best first, full tiebreaker ladder applied. */
export function conferenceOrder(state: GameState, conf: Conference): string[] {
  const ctx = makeCtx(state)
  const ids = state.league.teams.filter((t) => t.conference === conf).map((t) => t.teamId)
  return orderTeams(ctx, ids, true)
}

/** Every team, best first. Used for the lottery order and for Finals home court. */
export function leagueOrder(state: GameState): string[] {
  const ctx = makeCtx(state)
  return orderTeams(
    ctx,
    state.league.teams.map((t) => t.teamId),
    true,
  )
}

function rows(state: GameState, ids: string[]): StandingRow[] {
  const lead = ids.length > 0 ? (state.records[ids[0] as string] as TeamRecord) : null
  const divCount = new Map<string, number>()
  return ids.map((id) => {
    const r = state.records[id] as TeamRecord
    const t = state.league.teams.find((x) => x.teamId === id) as LeagueTeam
    const n = (divCount.get(t.division) ?? 0) + 1
    divCount.set(t.division, n)
    return {
      teamId: id,
      conference: t.conference,
      division: t.division,
      wins: r.wins,
      losses: r.losses,
      pct: winPct(r),
      gb: lead ? (lead.wins - r.wins + (r.losses - lead.losses)) / 2 : 0,
      divisionRank: n,
    }
  })
}

export function conferenceTable(state: GameState): Record<Conference, StandingRow[]> {
  return {
    East: rows(state, conferenceOrder(state, 'East')),
    West: rows(state, conferenceOrder(state, 'West')),
  }
}

export function divisionTable(state: GameState): Record<string, StandingRow[]> {
  const out: Record<string, StandingRow[]> = {}
  const conf = conferenceTable(state)
  for (const c of ['East', 'West'] as const) {
    for (const row of conf[c]) {
      const k = `${c}/${row.division}`
      out[k] = [...(out[k] ?? []), row]
    }
  }
  for (const k of Object.keys(out)) {
    const list = out[k] as StandingRow[]
    const lead = list[0]
    for (const r of list) {
      r.gb = lead ? (lead.wins - r.wins + (r.losses - lead.losses)) / 2 : 0
    }
  }
  return out
}

/**
 * Era-correct seeding of one conference. Returns the playoff field in seed order, plus, for
 * play-in eras, the 9th and 10th teams appended (the caller slices what it needs).
 */
export function seedConference(state: GameState, conf: Conference): string[] {
  const order = conferenceOrder(state, conf)
  const seeding = state.season.rules.playoffs.seeding
  if (seeding === 'record') return order

  const divisions = new Map<string, string[]>()
  for (const id of order) {
    const t = state.league.teams.find((x) => x.teamId === id) as LeagueTeam
    divisions.set(t.division, [...(divisions.get(t.division) ?? []), id])
  }
  // `order` is already best-first, so the head of each division list is that division's winner.
  const winners = [...divisions.values()].map((ids) => ids[0] as string)
  const guaranteed =
    seeding === 'division_winners_top_2' ? 2 : seeding === 'division_winners_top_3' ? 3 : 4

  const top: string[] = []
  const taken = new Set<string>()
  for (const id of order) {
    if (top.length >= guaranteed) break
    if (winners.includes(id)) {
      top.push(id)
      taken.add(id)
    }
  }
  // top_4: the best non-winner fills out the top four alongside the three division winners.
  for (const id of order) {
    if (top.length >= guaranteed) break
    if (!taken.has(id)) {
      top.push(id)
      taken.add(id)
    }
  }
  top.sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const rest = order.filter((id) => !taken.has(id))
  return [...top, ...rest]
}
