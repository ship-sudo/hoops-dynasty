// Season awards from simulated regular-season stats. One documented score, no black box.
//
//   production per game = pts + 1.2*reb + 1.5*ast + 2*stl + 2*blk + 0.7*(fgm - fga*0.45) - tov
//   team factor         = 0.70 + 0.60 * team win pct        (a 50-win team beats a 20-win team)
//   mvp score           = production per game * team factor
//
//   defence per game    = 1.0*dreb + 3.0*stl + 3.5*blk + 0.4*(oreb) - 0.3*pf
//   dpoy score          = defence per game * team factor
//
// Eligibility: at least 58% of the team's games, matching the NBA's 65-of-82 rule closely enough
// for every era including the 50- and 66-game seasons.
//
// All-NBA: three teams of five, by mvp score. Positional (2 guards, 2 forwards, 1 centre) through
// 2022-23; positionless from 2023-24, which is when the NBA dropped positions.

import { winPct } from './standings.ts'
import type { AwardWinner, GameState, SeasonAwards, SeasonStatLine } from './state.ts'

const MIN_SHARE = 0.58

export interface Cand {
  playerId: string
  name: string
  teamId: string
  pos: string
  gp: number
  mvp: number
  dpoy: number
  rookie: boolean
}

export function candidates(state: GameState): Cand[] {
  const byId = new Map(state.league.players.map((p) => [p.playerId, p]))
  const out: Cand[] = []
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
    out.push({
      playerId,
      name: p.name,
      teamId: s.teamId,
      pos: p.pos,
      gp: s.gp,
      mvp: prod * team,
      dpoy: def * team,
      rookie: p.debutYear === state.season.yearEnd,
    })
  }
  return out
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

function best(cands: Cand[], key: 'mvp' | 'dpoy'): Cand | null {
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
  const mvp = best(cands, 'mvp')
  const dpoy = best(cands, 'dpoy')
  const roy = best(
    cands.filter((c) => c.rookie),
    'mvp',
  )
  const positional = state.season.yearEnd <= 2023
  const teams = positional ? allNbaPositional(cands) : allNbaFlat(cands)
  return {
    mvp: mvp ? toWinner('MVP', mvp, mvp.mvp) : null,
    roy: roy ? toWinner('ROY', roy, roy.mvp) : null,
    dpoy: dpoy ? toWinner('DPOY', dpoy, dpoy.dpoy) : null,
    allNba: teams.map((t, i) => t.map((c) => toWinner(`All-NBA ${i + 1}`, c, c.mvp))),
  }
}
