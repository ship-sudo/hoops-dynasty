// The stacking experiment. Build a super-team by trade, build a balanced roster of the same total
// talent, play them both through a real season with the real engine, and read off the record and
// the locker room.
//
//   npx tsx scratchpad/superteam.ts [--seeds 5] [--year 2004]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SeasonBundle, SimulateGame } from '@hoops/core'
import { ERA } from '@hoops/data'
import { simulateGame } from '@hoops/engine'
import {
  abilityScore,
  type GameHooks,
  type GameState,
  simDay as gameSimDay,
  type LeaguePlayer,
  moraleOf,
  newGame,
  setMoraleEffects,
  squadMood,
} from '@hoops/game'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : dflt
}

const year = Number(arg('year', '2004'))
const seeds = Number(arg('seeds', '5'))
const bundlesDir = path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles')
const bundle = JSON.parse(
  readFileSync(path.join(bundlesDir, `${year}.json`), 'utf8'),
) as SeasonBundle

const hooks: GameHooks = {
  engine: simulateGame as SimulateGame,
  nextSeason: (y) => (ERA[y] ? { rules: ERA[y] } : null),
}

const SUPER = bundle.teams[0]?.teamId as string
const BALANCED = bundle.teams[1]?.teamId as string

/** Move a man to a club. A trade in everything but the paperwork; the salary travels with him. */
function moveTo(p: LeaguePlayer, teamId: string): void {
  p.teamId = teamId
  p.yearsWithTeam = 0
  if (p.contract) p.contract = { ...p.contract, teamId }
}

/**
 * Stack one club with the five best men in the league and fill the rest with minimum-wage bodies;
 * build a second club of honest starters whose total ability matches it to within a point. Every
 * other club keeps whoever is left, so both squads play the same league.
 */
function build(state: GameState): { superSum: number; balancedSum: number } {
  const ranked = [...state.league.players]
    .filter((p) => p.teamId)
    .sort((a, b) => abilityScore(b) - abilityScore(a))

  const ROSTER = 12
  const stars = ranked.slice(0, 5)
  // Filler: the weakest men in the league, so the super-team is five stars and nothing else.
  const filler = ranked.slice(-40).filter((p) => !stars.includes(p))
  const superSquad = [...stars, ...filler.slice(0, ROSTER - stars.length)]
  const superSum = superSquad.reduce((s, p) => s + abilityScore(p), 0)

  // Now twelve men, none of them a star, adding up to the same total. Walk down the board from the
  // best man not already spoken for and take whoever keeps the running total on pace.
  const used = new Set(superSquad.map((p) => p.playerId))
  const pool = ranked.filter((p) => !used.has(p.playerId))
  const balanced: LeaguePlayer[] = []
  let sum = 0
  for (let slot = 0; slot < ROSTER; slot++) {
    const left = ROSTER - slot
    const want = (superSum - sum) / left
    let best: LeaguePlayer | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (const p of pool) {
      if (used.has(p.playerId)) continue
      const gap = Math.abs(abilityScore(p) - want)
      if (gap < bestGap) {
        bestGap = gap
        best = p
      }
    }
    if (!best) break
    used.add(best.playerId)
    balanced.push(best)
    sum += abilityScore(best)
  }

  // Anyone displaced from the two clubs goes to whoever had the fewest bodies, so no club dresses
  // eight men and the league stays a league.
  const others = state.league.teams.filter((t) => t.teamId !== SUPER && t.teamId !== BALANCED)
  const displaced = state.league.players.filter(
    (p) => (p.teamId === SUPER || p.teamId === BALANCED) && !used.has(p.playerId),
  )
  let i = 0
  for (const p of displaced) {
    moveTo(p, (others[i % others.length] as { teamId: string }).teamId)
    i++
  }
  // Open a morale record against the old club first, so the move registers as a trade and the
  // men arrive unsettled — which is what actually happens when you assemble a squad in July.
  for (const p of [...superSquad, ...balanced]) moraleOf(state, p)
  for (const p of superSquad) moveTo(p, SUPER)
  for (const p of balanced) moveTo(p, BALANCED)
  return { superSum, balancedSum: sum }
}

interface Run {
  superWins: number
  balancedWins: number
  superMood: number
  balancedMood: number
  superUnhappy: number
  balancedUnhappy: number
  worst: string
}

function run(seed: number, moraleOn: boolean): Run {
  setMoraleEffects(moraleOn)
  let state = newGame(bundle, SUPER, seed)
  const sums = build(state)
  if (seed === 1 && moraleOn) {
    console.log(
      `talent: super-team ${sums.superSum.toFixed(1)}, balanced ${sums.balancedSum.toFixed(1)} ` +
        `(${(sums.balancedSum - sums.superSum).toFixed(1)} apart over twelve men)`,
    )
    for (const label of [SUPER, BALANCED]) {
      const squad = state.league.players
        .filter((p) => p.teamId === label)
        .sort((a, b) => abilityScore(b) - abilityScore(a))
      console.log(
        `  ${label === SUPER ? 'super   ' : 'balanced'}: ${squad
          .map((p) => abilityScore(p).toFixed(0))
          .join(' ')}`,
      )
    }
  }
  // Stop at the end of the regular season: the rollover calms the dressing room, and what we want
  // to read is the room as it was while the games were being played.
  while (state.phase === 'regular') {
    const out = gameSimDay(state, hooks)
    state = out.state
    if (out.results.length === 0 && state.phase === 'regular') break
  }
  const rec = (id: string) => state.records[id]
  if (seed === 1 && moraleOn) {
    for (const id of [SUPER, BALANCED]) {
      console.log(`  ${id === SUPER ? 'super   ' : 'balanced'} dressing room:`)
      for (const p of state.league.players
        .filter((q) => q.teamId === id)
        .sort((a, b) => abilityScore(b) - abilityScore(a))
        .slice(0, 6)) {
        const m = moraleOf(state, p)
        console.log(
          `    ${p.name.padEnd(22)} ${m.role.padEnd(9)} ${m.value.toFixed(0).padStart(3)} ` +
            `${m.mpg.toFixed(1).padStart(5)} mpg  ${m.why}`,
        )
      }
    }
  }
  const sm = squadMood(state, SUPER)
  const bm = squadMood(state, BALANCED)
  return {
    superWins: rec(SUPER)?.wins ?? 0,
    balancedWins: rec(BALANCED)?.wins ?? 0,
    superMood: sm.average,
    balancedMood: bm.average,
    superUnhappy: sm.unhappy,
    balancedUnhappy: bm.unhappy,
    worst: sm.summary,
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

for (const moraleOn of [false, true]) {
  const runs: Run[] = []
  for (let s = 1; s <= seeds; s++) runs.push(run(s, moraleOn))
  console.log(`\n─── morale ${moraleOn ? 'ON' : 'OFF'} ─── ${seeds} seasons, ${year}`)
  console.log(`  per seed, super-team: ${runs.map((r) => r.superWins).join(' ')}`)
  console.log(`  per seed, balanced:   ${runs.map((r) => r.balancedWins).join(' ')}`)
  console.log(
    `super-team   wins ${mean(runs.map((r) => r.superWins)).toFixed(1)}   ` +
      `mood ${mean(runs.map((r) => r.superMood)).toFixed(1)}   ` +
      `unhappy ${mean(runs.map((r) => r.superUnhappy)).toFixed(1)}`,
  )
  console.log(
    `balanced     wins ${mean(runs.map((r) => r.balancedWins)).toFixed(1)}   ` +
      `mood ${mean(runs.map((r) => r.balancedMood)).toFixed(1)}   ` +
      `unhappy ${mean(runs.map((r) => r.balancedUnhappy)).toFixed(1)}`,
  )
  if (moraleOn) console.log(`  ${runs[0]?.worst}`)
}
