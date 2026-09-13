import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from '@hoops/core'
import { lotteryTeams, runLottery, startDraft } from './draft.ts'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

function finished(seed = 3): GameState {
  return simRestOfSeason(newGame(fixtureBundle(), 'T00', seed), hooks).state
}

test('the lottery pool is exactly the teams that missed the playoffs, worst first', () => {
  const s = finished()
  const lot = lotteryTeams(s)
  assert.equal(lot.length, 14)
  const inPlayoffs = new Set([...(s.playoffs?.seeds.East ?? []), ...(s.playoffs?.seeds.West ?? [])])
  for (const id of lot) assert.ok(!inPlayoffs.has(id))
  for (let i = 1; i < lot.length; i++) {
    const a = s.records[lot[i - 1] as string]
    const b = s.records[lot[i] as string]
    assert.ok(a && b && a.wins <= b.wins, 'worst record picks first')
  }
})

test('the draft order covers every team once per round', () => {
  const s = finished()
  const d = startDraft(s, makeRng(9))
  assert.equal(d.picks.length, 60)
  assert.equal(d.order.length, 30)
  assert.equal(new Set(d.order).size, 30)
  for (const round of [1, 2]) {
    const ids = d.picks.filter((p) => p.round === round).map((p) => p.teamId)
    assert.equal(new Set(ids).size, 30, `round ${round} has each team once`)
  }
  d.picks.forEach((p, i) => {
    assert.equal(p.overall, i + 1)
  })
  // Round 2 is reverse record order, never the lottery order.
  const r2 = d.picks.filter((p) => p.round === 2).map((p) => p.teamId)
  for (let i = 1; i < r2.length; i++) {
    const a = s.records[r2[i - 1] as string]
    const b = s.records[r2[i] as string]
    assert.ok(a && b && a.wins <= b.wins, 'round 2 is strictly reverse record')
  }
})

test('lottery odds are honoured over many drawings', () => {
  const s = finished()
  const lot = lotteryTeams(s)
  const worst = lot[0] as string
  const best = lot[13] as string
  const counts = new Map<string, number>()
  const rng = makeRng(1234)
  const N = 4000
  for (let i = 0; i < N; i++) {
    const order = runLottery(s, rng)
    counts.set(order[0] as string, (counts.get(order[0] as string) ?? 0) + 1)
  }
  const pWorst = (counts.get(worst) ?? 0) / N
  const pBest = (counts.get(best) ?? 0) / N
  // Flat-top era: the worst three share 14% each, the best lottery team has 0.5%.
  assert.ok(Math.abs(pWorst - 0.14) < 0.025, `worst team first-pick rate ${pWorst}`)
  assert.ok(pBest < 0.02, `best lottery team first-pick rate ${pBest}`)
  assert.ok(pWorst > pBest * 3)
})

test('a team outside the drawn picks cannot jump the order', () => {
  const s = finished()
  const lot = lotteryTeams(s)
  const rng = makeRng(5)
  for (let i = 0; i < 200; i++) {
    const order = runLottery(s, rng)
    const drawn = order.slice(0, 4)
    const rest = order.slice(4, 14)
    // Everyone after the drawn picks is still in worst-first order among those left.
    const expected = lot.filter((id) => !drawn.includes(id))
    assert.deepEqual(rest, expected)
    // Non-lottery teams never appear before pick 15.
    for (const id of order.slice(0, 14)) assert.ok(lot.includes(id))
  }
})

test('picks are recorded even with no prospect pool', () => {
  const s = finished()
  const d = startDraft(s, makeRng(2))
  assert.ok(d.picks.every((p) => p.prospectId === null))
  assert.equal(d.done, false)
})
