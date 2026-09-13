import assert from 'node:assert/strict'
import { test } from 'node:test'
import { simulateGame } from '@hoops/engine/naive'
import { syntheticBundle } from './fixture.ts'
import { computeMetrics } from './metrics.ts'
import { renderReport } from './report.ts'
import { simSeason } from './season.ts'

test('simSeason plays every game and books totals', () => {
  const b = syntheticBundle()
  const s = simSeason(b, simulateGame, 1, 'real')
  assert.equal(s.results.length, 36)
  for (const t of s.teams.values()) assert.equal(t.games, 18)
  const anyPlayer = [...s.players.values()][0]
  assert.ok(anyPlayer && anyPlayer.totals.pts > 0)
})

test('same seed same season', () => {
  const b = syntheticBundle()
  const a = simSeason(b, simulateGame, 5, 'model'),
    c = simSeason(b, simulateGame, 5, 'model')
  assert.deepEqual(a.results, c.results)
})

test('metrics compute and the naive engine is monotonic and orders strength', () => {
  const b = syntheticBundle()
  const sims = Array.from({ length: 20 }, (_, i) => simSeason(b, simulateGame, i, 'real'))
  const m = computeMetrics(b, sims, simulateGame)
  for (const band of m.league) assert.ok(Number.isFinite(band.sim), band.name)
  assert.ok(m.winCorrExpected > 0.9, `win corr ${m.winCorrExpected}`)
  assert.ok(m.monotonic.ok, m.monotonic.winPct.join(','))
  const md = renderReport('naive', 'real', [m], 10)
  assert.ok(md.includes('## 2000'))
})
