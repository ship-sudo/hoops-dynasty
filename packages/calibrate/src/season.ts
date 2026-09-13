// Simulate one real season's schedule once with a given engine.

import {
  DEFAULT_TACTICS,
  emptyStatLine,
  type GameInput,
  type GameResult,
  makeRng,
  type PlayerGameInput,
  type PlayerRecord,
  type SeasonBundle,
  type SimulateGame,
  type StatLine,
  type TeamGameInput,
} from '@hoops/core'
import { buildPools, type MinutesMode, pickMinutes } from './minutes.ts'

export interface TeamSeasonSim {
  teamId: string
  wins: number
  losses: number
  games: number
  totals: StatLine
  oppTotals: StatLine
  possessions: number
}
export interface PlayerSeasonSim {
  playerId: string
  teamId: string
  games: number
  totals: StatLine
}
export interface SeasonSim {
  yearEnd: number
  teams: Map<string, TeamSeasonSim>
  players: Map<string, PlayerSeasonSim>
  results: {
    gameId: string
    homeTeamId: string
    awayTeamId: string
    homePts: number
    awayPts: number
  }[]
}

function toInput(p: PlayerRecord, minutesTarget: number, starter: boolean): PlayerGameInput {
  return {
    playerId: p.playerId,
    name: p.name,
    pos: p.pos,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    age: p.age,
    ratings: p.ratings,
    tendencies: p.tendencies,
    minutesTarget,
    starter,
    condition: 1,
  }
}

function addLine(into: StatLine, from: StatLine): void {
  for (const k of Object.keys(into) as (keyof StatLine)[]) into[k] += from[k]
}

export function simSeason(
  bundle: SeasonBundle,
  engine: SimulateGame,
  seed: number,
  mode: MinutesMode,
): SeasonSim {
  const rng = makeRng(seed)
  const pools = buildPools(bundle.players, bundle.real.stints, mode)
  const teamGames = new Map<string, number>()
  for (const g of bundle.schedule) {
    teamGames.set(g.homeTeamId, (teamGames.get(g.homeTeamId) ?? 0) + 1)
    teamGames.set(g.awayTeamId, (teamGames.get(g.awayTeamId) ?? 0) + 1)
  }
  const sim: SeasonSim = {
    yearEnd: bundle.yearEnd,
    teams: new Map(),
    players: new Map(),
    results: [],
  }
  const team = (id: string): TeamSeasonSim => {
    let t = sim.teams.get(id)
    if (!t) {
      t = {
        teamId: id,
        wins: 0,
        losses: 0,
        games: 0,
        totals: emptyStatLine(),
        oppTotals: emptyStatLine(),
        possessions: 0,
      }
      sim.teams.set(id, t)
    }
    return t
  }
  const side = (teamId: string): TeamGameInput => {
    const t = bundle.teams.find((x) => x.teamId === teamId)
    const chosen = pickMinutes(pools.get(teamId) ?? [], mode, teamGames.get(teamId) ?? 82, rng)
    return {
      teamId,
      name: t?.name ?? teamId,
      players: chosen.map((c) => toInput(c.player, c.minutesTarget, c.starter)),
      tactics: DEFAULT_TACTICS,
    }
  }
  for (const g of bundle.schedule) {
    if (g.seasonType !== 'regular') continue
    const input: GameInput = {
      era: bundle.era,
      home: side(g.homeTeamId),
      away: side(g.awayTeamId),
      seasonType: 'regular',
    }
    const r: GameResult = engine(input, rng.int(2 ** 31))
    const h = team(g.homeTeamId),
      a = team(g.awayTeamId)
    h.games++
    a.games++
    if (r.winner === 'home') {
      h.wins++
      a.losses++
    } else {
      a.wins++
      h.losses++
    }
    addLine(h.totals, r.home.totals)
    addLine(a.totals, r.away.totals)
    addLine(h.oppTotals, r.away.totals)
    addLine(a.oppTotals, r.home.totals)
    h.possessions += r.home.possessions
    a.possessions += r.away.possessions
    for (const [box, teamId] of [
      [r.home, g.homeTeamId],
      [r.away, g.awayTeamId],
    ] as const) {
      for (const pb of box.players) {
        let ps = sim.players.get(pb.playerId)
        if (!ps) {
          ps = { playerId: pb.playerId, teamId, games: 0, totals: emptyStatLine() }
          sim.players.set(pb.playerId, ps)
        }
        if (pb.min > 0) ps.games++
        addLine(ps.totals, pb)
      }
    }
    sim.results.push({
      gameId: g.gameId,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homePts: r.home.pts,
      awayPts: r.away.pts,
    })
  }
  return sim
}
