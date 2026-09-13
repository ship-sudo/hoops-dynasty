/**
 * The rumour mill has to tell the truth.
 *
 * "X is unhappy with his role" used to be inferred from a rating against minutes, which meant the
 * paper could report a grievance the game did not hold. It now quotes the stored number and the
 * sentence attached to it, so what the manager reads and what the simulation believes are the same
 * thing.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeRng, type SeasonBundle } from '@hoops/core'
import { type GameState, type LeaguePlayer, moraleOf, newGame } from '@hoops/game'
import { draftPotential } from '@hoops/progression'
import type { Potentials } from './market.ts'
import { weeklyRumours } from './rumours.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const bundlePath = join(dataDir, 'bundles', '2004.json')
const havePipeline = existsSync(bundlePath)
const bundle: SeasonBundle | null = havePipeline
  ? (JSON.parse(readFileSync(bundlePath, 'utf8')) as SeasonBundle)
  : null
const skip = !havePipeline

function opening(): { state: GameState; potentials: Potentials } {
  const teamId = (bundle as SeasonBundle).teams.find((t) => t.abbr === 'SAS')?.teamId as string
  const state = newGame(bundle as SeasonBundle, teamId, 5)
  const potentials: Potentials = new Map()
  const rng = makeRng(99)
  for (const p of state.league.players)
    potentials.set(p.playerId, draftPotential(p.ratings, p.age, rng))
  return { state, potentials }
}

/** Twenty-four tries: the beat writer files this one about one week in three. */
function fileUntil(
  state: GameState,
  potentials: Potentials,
  match: RegExp,
): { headline: string; body: string } | null {
  for (let i = 0; i < 24; i++) {
    const items = weeklyRumours({
      state,
      potentials,
      rng: makeRng(1000 + i),
      nameOf: (teamId) => {
        const t = state.league.teams.find((x) => x.teamId === teamId)
        return t ? `${t.city} ${t.name}` : teamId
      },
    })
    const hit = items.find((it) => match.test(it.headline))
    if (hit) return { headline: hit.headline, body: hit.body }
  }
  return null
}

test('the paper reports an unhappy man, and quotes the real reason', { skip }, () => {
  const { state, potentials } = opening()
  const mine = state.league.players.filter((p) => p.teamId === state.userTeamId)
  const man = mine[3] as LeaguePlayer
  const m = moraleOf(state, man)
  // Unhappy, but not yet past the point of no return.
  m.value = 32
  m.mpg = 9.4
  m.why = 'Playing 9.4 a night when a starter expects 28.'
  m.role = 'starter'

  const item = fileUntil(state, potentials, /is unhappy with his role/)
  assert.ok(item, 'the beat writers should have noticed')
  assert.ok(item.headline.includes(man.name), item.headline)
  assert.match(item.headline, /is unhappy with his role/)
  assert.ok(item.body.includes('9.4'), item.body)
  assert.ok(item.body.includes('a starter expects 28'), item.body)
  assert.match(item.body, /unhappy|furious/)
})

test('a man below the walk-away line is reported as wanting out', { skip }, () => {
  const { state, potentials } = opening()
  const man = state.league.players.find((p) => p.teamId === state.userTeamId) as LeaguePlayer
  const m = moraleOf(state, man)
  m.value = 9
  m.why = 'Playing 6.0 a night when a star expects 34.'
  m.role = 'star'

  const item = fileUntil(state, potentials, /wants out/)
  assert.ok(item)
  assert.ok(item.headline.includes(man.name), item.headline)
  assert.match(item.body, /will not re-sign here/)
})

test('a contented squad produces no grievance at all', { skip }, () => {
  const { state, potentials } = opening()
  for (const p of state.league.players) moraleOf(state, p).value = 70
  const item = fileUntil(state, potentials, /unhappy|wants out/)
  assert.equal(item, null, `a happy room should have nothing to say: ${item?.headline}`)
})

test('a room that has turned is reported as a room, not as one man', { skip }, () => {
  const { state, potentials } = opening()
  const mine = state.league.players.filter((p) => p.teamId === state.userTeamId)
  for (const p of mine.slice(0, 5)) {
    const m = moraleOf(state, p)
    m.value = 30
    m.why = 'Playing 8.0 a night when a starter expects 28.'
    m.role = 'starter'
  }
  const item = fileUntil(state, potentials, /of .* squad are unhappy/)
  assert.ok(item, 'five unhappy men is a story')
  assert.match(item.headline, /^5 of /)
  assert.match(item.body, /men are unhappy/)
  assert.match(item.body, /The room as a whole is/)
})
