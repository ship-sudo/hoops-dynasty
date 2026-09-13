// Compare simulated seasons to reality. Every band here is a definition of "realistic" from SPEC §7.

import {
  DEFAULT_TACTICS,
  makeRng,
  mean,
  type PlayerRecord,
  pearson,
  type SeasonBundle,
  type SimulateGame,
  type StatLine,
  sd,
} from '@hoops/core'
import { pickMinutes, poolOf } from './minutes.ts'
import type { SeasonSim } from './season.ts'

export interface Band {
  name: string
  real: number
  sim: number
  tol: number
  ok: boolean
}

export interface SeasonMetrics {
  yearEnd: number
  runs: number
  league: Band[]
  winCorrExpected: number // pearson of mean sim wins vs real wins (the pass criterion)
  winCorrPerRun: number // mean over runs of pearson(sim wins, real wins)
  winSdReal: number
  winSdSim: number
  topScorers: Band
  topMinutes: Band
  topShooters: Band // FGA per game, top 10
  monotonic: { deltas: number[]; winPct: number[]; ok: boolean }
  outOfBand: string[]
}

export const TOL = {
  pace: 2.0,
  ortg: 2.0,
  threePAr: 0.02,
  ftr: 0.025,
  tovPct: 1.0,
  orbPct: 1.5,
  fg3Pct: 0.01,
  fg2Pct: 0.01,
  ftPct: 0.01,
  winCorr: 0.8,
  topScorers: 2.0,
  topMinutes: 2.0,
  topShooters: 1.5,
  winSdRatio: 0.2,
}

function band(name: string, real: number, sim: number, tol: number): Band {
  return { name, real, sim, tol, ok: Math.abs(real - sim) <= tol }
}

function sumLines(lines: Iterable<StatLine>): StatLine {
  const t: StatLine = {
    min: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  }
  for (const l of lines) for (const k of Object.keys(t) as (keyof StatLine)[]) t[k] += l[k]
  return t
}

export function realPpg(p: PlayerRecord, pace: number): number {
  if (!p.real || p.real.gp === 0) return 0
  const possPerGame = (p.realMpg * pace) / 48
  return (p.real.per100.pts * possPerGame) / 100
}

export function realFgaPg(p: PlayerRecord, pace: number): number {
  if (!p.real || p.real.gp === 0) return 0
  return (p.real.per100.fga * ((p.realMpg * pace) / 48)) / 100
}

function topMean(xs: number[], n = 10): number {
  return mean([...xs].sort((a, b) => b - a).slice(0, n))
}

export function computeMetrics(
  bundle: SeasonBundle,
  sims: SeasonSim[],
  engine: SimulateGame,
): SeasonMetrics {
  const era = bundle.era
  const teamIds = bundle.teams.map((t) => t.teamId)
  // League totals across every run.
  const tot = sumLines(sims.flatMap((s) => [...s.teams.values()].map((t) => t.totals)))
  const opp = sumLines(sims.flatMap((s) => [...s.teams.values()].map((t) => t.oppTotals)))
  const teamGames = sims.reduce(
    (a, s) => a + [...s.teams.values()].reduce((b, t) => b + t.games, 0),
    0,
  )
  const poss = sims.reduce(
    (a, s) => a + [...s.teams.values()].reduce((b, t) => b + t.possessions, 0),
    0,
  )
  const league: Band[] = [
    band('pace', era.pace, poss / teamGames, TOL.pace),
    band('ortg', era.ortg, (tot.pts / poss) * 100, TOL.ortg),
    band('3PAr', era.threePAr, tot.fg3a / tot.fga, TOL.threePAr),
    band('FTr', era.ftr, tot.fta / tot.fga, TOL.ftr),
    band('TOV%', era.tovPct, (tot.tov / poss) * 100, TOL.tovPct),
    band(
      'ORB%',
      era.orbPct * 100,
      (tot.oreb / (tot.oreb + opp.dreb)) * 100,
      ((TOL.orbPct * 100) / 100) * 1,
    ),
    band('FG3%', era.fg3Pct, tot.fg3m / tot.fg3a, TOL.fg3Pct),
    band('FG2%', era.fg2Pct, (tot.fgm - tot.fg3m) / (tot.fga - tot.fg3a), TOL.fg2Pct),
    band('FT%', era.ftPct, tot.ftm / tot.fta, TOL.ftPct),
  ]
  // Standings.
  const realWins = teamIds.map((id) => bundle.teams.find((t) => t.teamId === id)?.real.wins ?? 0)
  const meanSimWins = teamIds.map((id) => mean(sims.map((s) => s.teams.get(id)?.wins ?? 0)))
  const winCorrExpected = pearson(meanSimWins, realWins)
  const winCorrPerRun = mean(
    sims.map((s) =>
      pearson(
        teamIds.map((id) => s.teams.get(id)?.wins ?? 0),
        realWins,
      ),
    ),
  )
  const winSdReal = sd(realWins)
  const winSdSim = mean(sims.map((s) => sd(teamIds.map((id) => s.teams.get(id)?.wins ?? 0))))
  // Player distributions: top-10 means, real vs mean over runs.
  const halfSeason = Math.max(1, Math.floor((bundle.schedule.length * 2) / bundle.teams.length / 2))
  const simTop = (f: (p: { games: number; totals: StatLine }) => number) =>
    mean(
      sims.map((s) => topMean([...s.players.values()].filter((p) => p.games >= halfSeason).map(f))),
    )
  const qualifiers = bundle.players.filter((p) => p.real && p.real.gp >= halfSeason)
  const topScorers = band(
    'top10 ppg',
    topMean(qualifiers.map((p) => realPpg(p, era.pace))),
    simTop((p) => p.totals.pts / p.games),
    TOL.topScorers,
  )
  const topMinutes = band(
    'top10 mpg',
    topMean(qualifiers.map((p) => p.realMpg)),
    simTop((p) => p.totals.min / p.games),
    TOL.topMinutes,
  )
  const topShooters = band(
    'top10 fga/g',
    topMean(qualifiers.map((p) => realFgaPg(p, era.pace))),
    simTop((p) => p.totals.fga / p.games),
    TOL.topShooters,
  )
  const monotonic = monotonicity(bundle, engine)
  const outOfBand: string[] = []
  for (const b of league)
    if (!b.ok) outOfBand.push(`${b.name}: real ${fmt(b.real)} sim ${fmt(b.sim)} (tol ${b.tol})`)
  if (winCorrExpected < TOL.winCorr)
    outOfBand.push(`win% correlation ${winCorrExpected.toFixed(3)} < ${TOL.winCorr}`)
  if (Math.abs(winSdSim / winSdReal - 1) > TOL.winSdRatio)
    outOfBand.push(
      `standings spread: real sd ${winSdReal.toFixed(1)} sim sd ${winSdSim.toFixed(1)}`,
    )
  for (const b of [topScorers, topMinutes, topShooters])
    if (!b.ok) outOfBand.push(`${b.name}: real ${fmt(b.real)} sim ${fmt(b.sim)} (tol ${b.tol})`)
  if (!monotonic.ok)
    outOfBand.push(`not monotonic: ${monotonic.winPct.map((w) => w.toFixed(2)).join(' → ')}`)
  return {
    yearEnd: bundle.yearEnd,
    runs: sims.length,
    league,
    winCorrExpected,
    winCorrPerRun,
    winSdReal,
    winSdSim,
    topScorers,
    topMinutes,
    topShooters,
    monotonic,
    outOfBand,
  }
}

export function fmt(x: number): string {
  return Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3)
}

/** Better ratings must win more. Shift one team's every rating by delta and play a fixed opponent. */
export function monotonicity(
  bundle: SeasonBundle,
  engine: SimulateGame,
  gamesPerStep = 300,
): SeasonMetrics['monotonic'] {
  const deltas = [-10, -5, 0, 5, 10]
  const byTeam = new Map<string, PlayerRecord[]>()
  for (const p of bundle.players) byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p])
  const teams = bundle.teams.map((t) => t.teamId).filter((id) => (byTeam.get(id)?.length ?? 0) >= 8)
  if (teams.length < 2) return { deltas, winPct: deltas.map(() => 0.5), ok: true }
  const sortedByReal = [...teams].sort(
    (a, b) =>
      (bundle.teams.find((t) => t.teamId === a)?.real.wins ?? 0) -
      (bundle.teams.find((t) => t.teamId === b)?.real.wins ?? 0),
  )
  const subjectId = sortedByReal[Math.floor(sortedByReal.length / 2)] as string
  const oppId = sortedByReal[Math.floor(sortedByReal.length / 2) - 1] as string
  const rng = makeRng(777)
  const side = (id: string, delta: number) => {
    const chosen = pickMinutes(poolOf(byTeam.get(id) ?? []), 'model', 82, rng)
    return {
      teamId: id,
      name: id,
      tactics: DEFAULT_TACTICS,
      players: chosen.map((c) => ({
        playerId: c.player.playerId,
        name: c.player.name,
        pos: c.player.pos,
        heightIn: c.player.heightIn,
        weightLb: c.player.weightLb,
        age: c.player.age,
        ratings: Object.fromEntries(
          Object.entries(c.player.ratings).map(([k, v]) => [
            k,
            Math.max(0, Math.min(100, v + delta)),
          ]),
        ) as unknown as PlayerRecord['ratings'],
        tendencies: c.player.tendencies,
        minutesTarget: c.minutesTarget,
        starter: c.starter,
        condition: 1,
      })),
    }
  }
  const winPct = deltas.map((d) => {
    let w = 0
    for (let i = 0; i < gamesPerStep; i++) {
      const homeIsSubject = i % 2 === 0
      const r = engine(
        {
          era: bundle.era,
          seasonType: 'regular',
          home: side(homeIsSubject ? subjectId : oppId, homeIsSubject ? d : 0),
          away: side(homeIsSubject ? oppId : subjectId, homeIsSubject ? 0 : d),
        },
        rng.int(2 ** 31),
      )
      if ((r.winner === 'home') === homeIsSubject) w++
    }
    return w / gamesPerStep
  })
  let ok = true
  for (let i = 1; i < winPct.length; i++)
    if ((winPct[i] as number) < (winPct[i - 1] as number) - 0.03) ok = false
  return { deltas, winPct, ok }
}
