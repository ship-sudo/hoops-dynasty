// What a year on the bench costs you at the negotiating table, in dollars, for real players.
//
//   npx tsx experiments/resign.ts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeRng, type SeasonBundle } from '@hoops/core'
import { askingPrice, type FreeAgent } from '@hoops/frontoffice'
import { moraleOf, newGame } from '@hoops/game'
import { draftPotential, overall } from '@hoops/progression'
import { askingFrom, freeAgentPool, type Potentials } from '../apps/web/src/sim/market.ts'

const bundlesDir = path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles')
const bundle = JSON.parse(readFileSync(path.join(bundlesDir, '2004.json'), 'utf8')) as SeasonBundle
const teamId = bundle.teams.find((t) => t.abbr === 'SAS')?.teamId as string

const state = newGame(bundle, teamId, 5)
const potentials: Potentials = new Map()
const rng = makeRng(11)
for (const p of state.league.players)
  potentials.set(p.playerId, draftPotential(p.ratings, p.age, rng))

const money = (n: number) => `$${(n / 1e6).toFixed(2)}M`

const mine = state.league.players
  .filter((p) => p.teamId === teamId)
  .sort((a, b) => overall(b.ratings) - overall(a.ratings))
  .slice(0, 5)
for (const p of mine) p.contract = null

const pool = freeAgentPool(state, state.season.yearEnd, potentials)

console.log('What a year in the doghouse adds to a re-signing, 2004 Spurs\n')
console.log('  player              market     content(55)  unhappy(20)  furious(5)   walks?')
for (const p of mine) {
  const fa = pool.find((f) => f.playerId === p.playerId) as FreeAgent
  if (!fa) continue
  const market = askingPrice(fa, state.season.rules).amount
  const at = (v: number) => {
    moraleOf(state, p).value = v
    return askingFrom(state, fa, teamId).amount
  }
  const content = at(55)
  const unhappy = at(20)
  const furious = at(5)
  moraleOf(state, p).value = 5
  const walks =
    freeAgentPool(state, state.season.yearEnd, potentials).find((f) => f.playerId === p.playerId)
      ?.incumbentTeamId === null
  console.log(
    `  ${p.name.padEnd(20)}${money(market).padEnd(11)}${money(content).padEnd(13)}` +
      `${money(unhappy).padEnd(13)}${money(furious).padEnd(13)}${walks ? 'yes' : 'no'}`,
  )
  moraleOf(state, p).value = 55
}
console.log(
  '\nThe premium is charged by the club that made him unhappy and by nobody else: at any other' +
    '\nclub he asks the market price. Below morale 28 he takes his Bird rights with him.',
)
