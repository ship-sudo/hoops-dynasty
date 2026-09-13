// Era-correct-length schedule generator.
//
// The game generates its own schedule (SPEC §8) so relocations and expansion teams need no real
// fixture list. The real schedule in the bundle is only used for the opening and closing dates.
//
// Shape of the algorithm, for `games` games and `n` teams:
//   cycles = floor(games / (n - 1))  -> every pair meets `cycles` times, home and away alternating
//   extra  = games - cycles * (n - 1) -> each team plays `extra` opponents one more time
// `extra` is always < n - 1, so the extra meetings form a simple `extra`-regular graph. It is built
// by Havel-Hakimi (always realisable for a regular degree sequence) with ties broken toward
// division rivals, then conference rivals. So division and conference opponents get the extra game
// and a handful of interconference opponents do not.
//
// Deviation from reality, logged here rather than in DECISIONS.md because it is local: the real
// 30-team 82-game formula is 4/4/3/2 meetings (division / six conference / four conference /
// interconference). This generator produces 3/3/3/2-or-3. Totals, home-away balance and the
// division-heavy weighting are right; the exact meeting counts are not.

import type { Rng } from '@hoops/core'
import { allStarDate, isAllStarRestDay } from './allstar.ts'
import { addDays, daysBetween } from './dates.ts'
import type { LeagueTeam, ScheduledGame } from './state.ts'

interface Pair {
  a: number
  b: number
  /** 0 = same division, 1 = same conference, 2 = interconference. */
  klass: 0 | 1 | 2
}

function classify(x: LeagueTeam, y: LeagueTeam): 0 | 1 | 2 {
  if (x.conference !== y.conference) return 2
  return x.division === y.division ? 0 : 1
}

/** An `extra`-regular simple graph over n nodes, preferring low-class (division first) edges. */
function regularGraph(n: number, degree: number, klass: (i: number, j: number) => number): Pair[] {
  const need = new Array<number>(n).fill(degree)
  const used = new Set<string>()
  const edges: Pair[] = []
  const key = (i: number, j: number) => (i < j ? `${i}:${j}` : `${j}:${i}`)
  for (let step = 0; step < n * degree; step++) {
    // Havel-Hakimi: satisfy the hungriest node first, against the next-hungriest partners.
    let v = -1
    for (let i = 0; i < n; i++) {
      if ((need[i] ?? 0) > (v < 0 ? 0 : (need[v] ?? 0))) v = i
    }
    if (v < 0) break
    const want = need[v] ?? 0
    const partners = []
    for (let j = 0; j < n; j++) {
      if (j === v || (need[j] ?? 0) <= 0 || used.has(key(v, j))) continue
      partners.push(j)
    }
    // Feasibility first (most remaining need), then division rivals, then a stable id order.
    partners.sort((p, q) => (need[q] ?? 0) - (need[p] ?? 0) || klass(v, p) - klass(v, q) || p - q)
    if (partners.length < want) throw new Error(`schedule: cannot build ${degree}-regular graph`)
    for (let k = 0; k < want; k++) {
      const j = partners[k] as number
      used.add(key(v, j))
      need[v] = 0
      need[j] = (need[j] ?? 0) - 1
      edges.push({ a: v, b: j, klass: klass(v, j) as 0 | 1 | 2 })
    }
  }
  if (need.some((x) => x !== 0)) throw new Error('schedule: degree sequence unsatisfied')
  return edges
}

/**
 * Decide who hosts each extra game. Walking an Eulerian circuit and orienting every edge along the
 * walk leaves each team hosting exactly half its extra games when the degree is even, which it is
 * for every real season length. Odd degrees come out one off, which the caller tolerates.
 */
function orientEdges(n: number, edges: Pair[]): [number, number][] {
  const adj: { to: number; id: number }[][] = Array.from({ length: n }, () => [])
  edges.forEach((e, id) => {
    adj[e.a]?.push({ to: e.b, id })
    adj[e.b]?.push({ to: e.a, id })
  })
  const used = new Array<boolean>(edges.length).fill(false)
  const ptr = new Array<number>(n).fill(0)
  const out: [number, number][] = []
  for (let s = 0; s < n; s++) {
    // Hierholzer, iterative, one pass per component and per odd-degree stub.
    const stack: number[] = [s]
    const trail: [number, number][] = []
    while (stack.length > 0) {
      const v = stack[stack.length - 1] as number
      const list = adj[v] as { to: number; id: number }[]
      let p = ptr[v] as number
      while (p < list.length && used[(list[p] as { id: number }).id]) p++
      ptr[v] = p
      if (p >= list.length) {
        stack.pop()
        const u = stack[stack.length - 1]
        if (u !== undefined) trail.push([u, v])
        continue
      }
      const e = list[p] as { to: number; id: number }
      used[e.id] = true
      stack.push(e.to)
    }
    // trail is the circuit in reverse; direction is consistent either way.
    for (const t of trail) out.push(t)
  }
  return out
}

/** Unordered meetings for the season, each already assigned a home side. */
export function buildMatchups(teams: LeagueTeam[], games: number, rng: Rng): [string, string][] {
  const n = teams.length
  if (n < 2) return []
  if ((n * games) % 2 !== 0) throw new Error(`schedule: ${n} teams x ${games} games is odd`)
  const cycles = Math.floor(games / (n - 1))
  const extra = games - cycles * (n - 1)
  const klass = (i: number, j: number) => classify(teams[i] as LeagueTeam, teams[j] as LeagueTeam)

  // Each meeting as [home, away] indices; venues are balanced below.
  const meetings: [number, number][] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let c = 0; c < cycles; c++) {
        // Alternating by (i + j + c) keeps home counts level even for an odd number of cycles.
        if ((i + j + c) % 2 === 0) meetings.push([i, j])
        else meetings.push([j, i])
      }
    }
  }
  if (extra > 0) {
    const edges = regularGraph(n, extra, klass)
    edges.sort((p, q) => p.klass - q.klass || p.a - q.a || p.b - q.b)
    for (const [h, a] of orientEdges(n, edges)) meetings.push([h, a])
  }
  const out: [string, string][] = meetings.map(([h, a]) => [
    teams[h]?.teamId as string,
    teams[a]?.teamId as string,
  ])
  // Shuffle so the date assignment below is not alphabetical. Fisher-Yates on the seeded rng.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const t = out[i] as [string, string]
    out[i] = out[j] as [string, string]
    out[j] = t
  }
  return out
}

/**
 * Spread the matchups over the calendar: no team twice in a day, at most one back-to-back-to-back
 * avoided by requiring a rest day only when the day is otherwise fillable.
 */
export function assignDates(
  matchups: [string, string][],
  teams: LeagueTeam[],
  start: string,
  end: string,
): ScheduledGame[] {
  const n = teams.length
  const span = Math.max(1, daysBetween(start, end))
  // Pace the league across the whole calendar instead of front-loading it: a 1189-game season over
  // 170 nights is about seven games a night, so each team plays every other day or so.
  const perDay = Math.max(1, Math.min(Math.floor(n / 2), Math.ceil(matchups.length / span)))
  const remaining = matchups.map((m, i) => ({ m, i, done: false }))
  const left = new Map<string, number>()
  for (const [h, a] of matchups) {
    left.set(h, (left.get(h) ?? 0) + 1)
    left.set(a, (left.get(a) ?? 0) + 1)
  }
  const out: ScheduledGame[] = []
  let placed = 0
  let day = 0
  const lastPlayed = new Map<string, number>()
  const breakDate = allStarDate(start, end)
  while (placed < remaining.length) {
    const date = addDays(start, day)
    if (breakDate && isAllStarRestDay(date, breakDate)) {
      day++
      continue
    }
    const busy = new Set<string>()
    let onThisDay = 0
    // Pass 1 wants a rest day for both teams; pass 2 takes anything legal.
    for (const rest of [1, 0]) {
      for (const g of remaining) {
        if (onThisDay >= perDay || placed >= remaining.length) break
        if (g.done) continue
        const [h, a] = g.m
        if (busy.has(h) || busy.has(a)) continue
        if (
          rest === 1 &&
          (day - (lastPlayed.get(h) ?? -9) < 2 || day - (lastPlayed.get(a) ?? -9) < 2)
        )
          continue
        g.done = true
        busy.add(h)
        busy.add(a)
        lastPlayed.set(h, day)
        lastPlayed.set(a, day)
        left.set(h, (left.get(h) ?? 0) - 1)
        left.set(a, (left.get(a) ?? 0) - 1)
        out.push({ gameId: '', date, homeTeamId: h, awayTeamId: a })
        onThisDay++
        placed++
      }
    }
    day++
    if (day > span * 4 + 2000) throw new Error('schedule: could not place every game')
  }
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
  out.forEach((g, i) => {
    g.gameId = `g${String(i + 1).padStart(5, '0')}`
  })
  return out
}

export function generateSchedule(
  teams: LeagueTeam[],
  games: number,
  start: string,
  end: string,
  rng: Rng,
): ScheduledGame[] {
  return assignDates(buildMatchups(teams, games, rng), teams, start, end)
}
