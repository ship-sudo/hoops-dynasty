// What a dressing room is worth on the floor, measured cleanly: two identical squads, one happy
// and one furious, playing each other a few thousand times on a neutral floor.
//
//   npx tsx scratchpad/effort.ts [--games 3000]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { GameInput, SeasonBundle } from '@hoops/core'
import { DEFAULT_TACTICS } from '@hoops/core'
import { simulateGame } from '@hoops/engine'
import { buildTeamInput, effortOf, newGame } from '@hoops/game'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : dflt
}

const games = Number(arg('games', '3000'))
const bundlesDir = path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles')
const bundle = JSON.parse(readFileSync(path.join(bundlesDir, '2004.json'), 'utf8')) as SeasonBundle
const state = newGame(bundle, bundle.teams[0]?.teamId as string, 1)

// One real roster, played against a copy of itself. Anything that is not morale cancels.
const team = state.league.teams[0] as { teamId: string; name: string }
const roster = state.league.players.filter((p) => p.teamId === team.teamId)
const base = buildTeamInput(
  { ...team, abbr: 'AAA', city: 'A', conference: 'East', division: 'Atlantic' },
  roster,
  false,
  undefined,
  { yearEnd: state.season.yearEnd },
)

function at(morale: number, teamId: string): GameInput['home'] {
  const e = effortOf(morale)
  return {
    ...base,
    teamId,
    players: base.players.map((p) => ({ ...p, condition: p.condition * e })),
  }
}

function duel(a: number, b: number): number {
  let aWins = 0
  for (let i = 0; i < games; i++) {
    // Alternate ends so the home edge cancels exactly.
    const flip = i % 2 === 0
    const input: GameInput = {
      era: state.season.era,
      home: flip ? at(a, 'AAA') : at(b, 'BBB'),
      away: flip ? at(b, 'BBB') : at(a, 'AAA'),
      seasonType: 'regular',
      tactics: DEFAULT_TACTICS,
    } as GameInput
    const r = simulateGame(input, i * 7919 + 13)
    const homeWon = r.winner === 'home'
    if (flip ? homeWon : !homeWon) aWins++
  }
  return aWins / games
}

console.log(`same squad, ${games} neutral games per pairing, 2003-04 ratings\n`)
console.log('  A morale   B morale   A win%    wins per 82')
for (const [a, b] of [
  [55, 55],
  [85, 55],
  [55, 40],
  [55, 25],
  [55, 10],
  [85, 15],
] as [number, number][]) {
  const p = duel(a, b)
  console.log(
    `  ${String(a).padStart(8)}   ${String(b).padStart(8)}   ${(p * 100).toFixed(1).padStart(5)}%   ` +
      `${((p - 0.5) * 2 * 82).toFixed(1).padStart(5)}`,
  )
}
