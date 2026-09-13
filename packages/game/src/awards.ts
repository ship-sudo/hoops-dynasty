// Season awards from simulated regular-season stats. One documented score, no black box.
//
//   production per game = pts + 1.2*reb + 1.5*ast + 2*stl + 2*blk + 0.7*(fgm - fga*0.45) - tov
//   team factor         = 0.70 + 0.60 * team win pct        (a 50-win team beats a 20-win team)
//   all-nba score       = production per game * team factor
//
//   MVP is not All-NBA. Voters name one man a night: the face of a winning club. A co-star on
//   the same roster keeps his All-NBA score, but his MVP ballot is cut so two teammates cannot
//   finish 1–2 just because the club won 60 games.
//
//     rank on the club, by production:  1st ×1.00   2nd ×0.52   3rd ×0.36   rest ×0.25
//     mvp vote                          = all-nba score * that factor
//
//   defence per game    = 1.0*dreb + 3.0*stl + 3.5*blk + 0.4*(oreb) - 0.3*pf
//   dpoy score          = defence per game * team factor
//
// Eligibility: at least 58% of the team's games, matching the NBA's 65-of-82 rule closely enough
// for every era including the 50- and 66-game seasons.
//
// All-NBA: three teams of five, by all-nba score. Positional (2 guards, 2 forwards, 1 centre)
// through 2022-23; positionless from 2023-24, which is when the NBA dropped positions.
//
// Finals MVP is a different vote, named when the series ends. Only the champion's men count.
//   series production = pts + 1.2*reb + 1.5*ast   (series totals, not per game)
// A man who plays every night beats a one-game explosion. Leaders are the same pool, by points,
// rebounds and assists, shown per game.

import { winPct } from './standings.ts'
import {
  type AwardWinner,
  type FinalsLeaders,
  type GameState,
  type GameSummary,
  pushLog,
  type SeasonAwards,
  type SeasonStatLine,
} from './state.ts'

const MIN_SHARE = 0.58

/** How much of a teammate's MVP case survives once the club already has a guy. Index = rank. */
const MATE_VOTE = [1, 0.52, 0.36, 0.25] as const

export interface Cand {
  playerId: string
  name: string
  teamId: string
  pos: string
  gp: number
  /** Production × team, used for All-NBA. A co-star still belongs here. */
  mvp: number
  /** After the one-man-a-night cut. MVP winner and the live race sort on this. */
  mvpVote: number
  dpoy: number
  rookie: boolean
}

export function candidates(state: GameState): Cand[] {
  const byId = new Map(state.league.players.map((p) => [p.playerId, p]))
  const raw: (Cand & { prod: number })[] = []
  for (const [playerId, s] of Object.entries(state.stats) as [
    string,
    SeasonStatLine & { teamId: string },
  ][]) {
    const p = byId.get(playerId)
    if (!p || s.gp === 0) continue
    const r = state.records[s.teamId]
    const teamGames = r ? r.wins + r.losses : 82
    if (s.gp < teamGames * MIN_SHARE) continue
    const f = 1 / s.gp
    const reb = s.oreb + s.dreb
    const prod =
      (s.pts +
        1.2 * reb +
        1.5 * s.ast +
        2 * s.stl +
        2 * s.blk +
        0.7 * (s.fgm - s.fga * 0.45) -
        s.tov) *
      f
    const def = (1.0 * s.dreb + 3.0 * s.stl + 3.5 * s.blk + 0.4 * s.oreb - 0.3 * s.pf) * f
    const team = r ? 0.7 + 0.6 * winPct(r) : 1
    raw.push({
      playerId,
      name: p.name,
      teamId: s.teamId,
      pos: p.pos,
      gp: s.gp,
      prod,
      mvp: prod * team,
      mvpVote: prod * team,
      dpoy: def * team,
      rookie: p.debutYear === state.season.yearEnd,
    })
  }

  const byTeam = new Map<string, (Cand & { prod: number })[]>()
  for (const c of raw) {
    const list = byTeam.get(c.teamId) ?? []
    list.push(c)
    byTeam.set(c.teamId, list)
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => b.prod - a.prod || (a.playerId < b.playerId ? -1 : 1))
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!c) continue
      const cut = MATE_VOTE[Math.min(i, MATE_VOTE.length - 1)] ?? 0.25
      c.mvpVote = c.mvp * cut
    }
  }

  return raw.map(({ prod: _prod, ...c }) => c)
}

function toWinner(award: string, c: Cand, score: number): AwardWinner {
  return {
    award,
    playerId: c.playerId,
    name: c.name,
    teamId: c.teamId,
    score: Math.round(score * 100) / 100,
  }
}

function best(cands: Cand[], key: 'mvpVote' | 'mvp' | 'dpoy'): Cand | null {
  let top: Cand | null = null
  for (const c of cands) {
    if (!top || c[key] > top[key] || (c[key] === top[key] && c.playerId < top.playerId)) top = c
  }
  return top
}

const GUARD = new Set(['PG', 'SG'])
const FORWARD = new Set(['SF', 'PF'])

function allNbaPositional(pool: Cand[]): Cand[][] {
  const left = [...pool].sort((a, b) => b.mvp - a.mvp || (a.playerId < b.playerId ? -1 : 1))
  const teams: Cand[][] = []
  for (let t = 0; t < 3; t++) {
    const need = { g: 2, f: 2, c: 1 }
    const team: Cand[] = []
    for (const c of left) {
      if (team.length >= 5) break
      if (team.includes(c)) continue
      if (GUARD.has(c.pos) && need.g > 0) {
        need.g--
        team.push(c)
      } else if (FORWARD.has(c.pos) && need.f > 0) {
        need.f--
        team.push(c)
      } else if (c.pos === 'C' && need.c > 0) {
        need.c--
        team.push(c)
      }
    }
    for (const c of team) left.splice(left.indexOf(c), 1)
    if (team.length > 0) teams.push(team)
  }
  return teams
}

function allNbaFlat(pool: Cand[]): Cand[][] {
  const sorted = [...pool].sort((a, b) => b.mvp - a.mvp || (a.playerId < b.playerId ? -1 : 1))
  return [sorted.slice(0, 5), sorted.slice(5, 10), sorted.slice(10, 15)].filter((t) => t.length > 0)
}

export function computeAwards(state: GameState): SeasonAwards {
  const cands = candidates(state)
  const mvp = best(cands, 'mvpVote')
  const dpoy = best(cands, 'dpoy')
  const roy = best(
    cands.filter((c) => c.rookie),
    'mvp',
  )
  const positional = state.season.yearEnd <= 2023
  const teams = positional ? allNbaPositional(cands) : allNbaFlat(cands)
  return {
    mvp: mvp ? toWinner('MVP', mvp, mvp.mvpVote) : null,
    roy: roy ? toWinner('ROY', roy, roy.mvp) : null,
    dpoy: dpoy ? toWinner('DPOY', dpoy, dpoy.dpoy) : null,
    allNba: teams.map((t, i) => t.map((c) => toWinner(`All-NBA ${i + 1}`, c, c.mvp))),
  }
}

interface SeriesMan {
  playerId: string
  name: string
  teamId: string
  gp: number
  pts: number
  reb: number
  ast: number
  min: number
}

function poolFinals(games: GameSummary[], championTeamId: string, nameOf: (id: string) => string) {
  const byId = new Map<string, SeriesMan>()
  for (const g of games) {
    for (const p of g.players ?? []) {
      if (p.teamId !== championTeamId || p.min <= 0) continue
      const cur = byId.get(p.playerId)
      if (cur) {
        cur.gp++
        cur.pts += p.pts
        cur.reb += p.reb
        cur.ast += p.ast
        cur.min += p.min
      } else {
        byId.set(p.playerId, {
          playerId: p.playerId,
          name: nameOf(p.playerId),
          teamId: p.teamId,
          gp: 1,
          pts: p.pts,
          reb: p.reb,
          ast: p.ast,
          min: p.min,
        })
      }
    }
  }
  return [...byId.values()]
}

function winnerOf(award: string, man: SeriesMan | undefined, score: number): AwardWinner | null {
  if (!man) return null
  return {
    award,
    playerId: man.playerId,
    name: man.name,
    teamId: man.teamId,
    score: Math.round(score * 100) / 100,
  }
}

/**
 * Finals MVP and the champion's series leaders. Nulls when the games have no player lines
 * (saves written before those were kept).
 */
export function computeFinalsHonors(
  games: GameSummary[],
  championTeamId: string,
  nameOf: (id: string) => string,
): { finalsMvp: AwardWinner | null; finalsLeaders: FinalsLeaders } {
  const pool = poolFinals(games, championTeamId, nameOf)
  const empty: FinalsLeaders = { pts: null, reb: null, ast: null }
  if (pool.length === 0) return { finalsMvp: null, finalsLeaders: empty }
  const rate = (n: number, gp: number) => (gp > 0 ? n / gp : 0)
  const better = (a: SeriesMan, b: SeriesMan, key: 'pts' | 'reb' | 'ast' | 'prod') => {
    const av = key === 'prod' ? a.pts + 1.2 * a.reb + 1.5 * a.ast : a[key]
    const bv = key === 'prod' ? b.pts + 1.2 * b.reb + 1.5 * b.ast : b[key]
    if (av !== bv) return av > bv
    if (a.min !== b.min) return a.min > b.min
    return a.playerId < b.playerId
  }
  const pick = (key: 'pts' | 'reb' | 'ast' | 'prod') =>
    pool.reduce((top, m) => (better(m, top, key) ? m : top))
  const mvp = pick('prod')
  const pts = pick('pts')
  const reb = pick('reb')
  const ast = pick('ast')
  return {
    finalsMvp: winnerOf('Finals MVP', mvp, mvp.pts + 1.2 * mvp.reb + 1.5 * mvp.ast),
    finalsLeaders: {
      pts: winnerOf('Finals PTS', pts, rate(pts.pts, pts.gp)),
      reb: winnerOf('Finals REB', reb, rate(reb.reb, reb.gp)),
      ast: winnerOf('Finals AST', ast, rate(ast.ast, ast.gp)),
    },
  }
}

/** Write Finals honours onto the season's awards. No-op when the series has no player lines. */
export function applyFinalsHonors(state: GameState, games: GameSummary[], championTeamId: string) {
  const nameOf = (id: string) => state.league.players.find((p) => p.playerId === id)?.name ?? id
  const honors = computeFinalsHonors(games, championTeamId, nameOf)
  if (!state.awards) {
    state.awards = { mvp: null, roy: null, dpoy: null, allNba: [] }
  }
  state.awards.finalsMvp = honors.finalsMvp
  state.awards.finalsLeaders = honors.finalsLeaders
  if (honors.finalsMvp) {
    pushLog(state, {
      date: state.calendar.date,
      yearEnd: state.season.yearEnd,
      kind: 'award',
      text: `${honors.finalsMvp.name} (${championTeamId}) is Finals MVP`,
    })
  }
}
