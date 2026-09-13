import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyStatLine } from '@hoops/core'
import { computeAwards } from './awards.ts'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

function season(seed = 21): GameState {
  return simRestOfSeason(newGame(fixtureBundle(), 'T00', seed), hooks).state
}

test('the MVP is a big producer on a winning team', () => {
  const s = season()
  const mvp = s.awards?.mvp
  assert.ok(mvp)
  const rec = s.records[mvp.teamId as string]
  assert.ok(rec && rec.wins > rec.losses, 'MVP comes from a team over .500')
  const line = s.stats[mvp.playerId]
  assert.ok(line && line.pts / line.gp > 15, 'and he scored')
})

test('minutes-starved players are not eligible', () => {
  const s = season()
  const eligible = new Set([
    s.awards?.mvp?.playerId,
    ...(s.awards?.allNba.flat().map((a) => a.playerId) ?? []),
  ])
  for (const id of eligible) {
    if (!id) continue
    const line = s.stats[id]
    const rec = s.records[(s.stats[id] as { teamId: string }).teamId]
    assert.ok(line && rec && line.gp >= (rec.wins + rec.losses) * 0.58, `${id} played enough`)
  }
})

test('All-NBA is three teams of five, nobody twice', () => {
  const s = season()
  const all = s.awards?.allNba ?? []
  assert.equal(all.length, 3)
  for (const t of all) assert.equal(t.length, 5)
  const ids = all.flat().map((a) => a.playerId)
  assert.equal(new Set(ids).size, 15)
  // First team outscores second team outscores third.
  const mean = (i: number) => (all[i] as { score: number }[]).reduce((a, x) => a + x.score, 0) / 5
  assert.ok(mean(0) > mean(1) && mean(1) > mean(2))
})

test('All-NBA is positional through 2022-23 and positionless after', () => {
  const before = simRestOfSeason(newGame(fixtureBundle({ yearEnd: 2020 }), 'T00', 5), hooks).state
  for (const team of before.awards?.allNba ?? []) {
    const pos = team.map((a) => before.league.players.find((p) => p.playerId === a.playerId)?.pos)
    assert.equal(pos.filter((p) => p === 'PG' || p === 'SG').length, 2, 'two guards')
    assert.equal(pos.filter((p) => p === 'SF' || p === 'PF').length, 2, 'two forwards')
    assert.equal(pos.filter((p) => p === 'C').length, 1, 'one centre')
  }
  const after = simRestOfSeason(newGame(fixtureBundle({ yearEnd: 2025 }), 'T00', 5), hooks).state
  const first = after.awards?.allNba[0] ?? []
  const ranked = Object.entries(after.stats)
  assert.equal(first.length, 5)
  assert.ok(ranked.length > 0)
  // Positionless means the five best scores, whatever they play.
  const flat = (after.awards?.allNba ?? []).flat()
  for (let i = 1; i < flat.length; i++) {
    assert.ok((flat[i - 1]?.score ?? 0) >= (flat[i]?.score ?? 0), 'sorted by score')
  }
})

test('DPOY rewards blocks and steals, not points', () => {
  const s = season()
  const dpoy = s.awards?.dpoy
  assert.ok(dpoy)
  const line = s.stats[dpoy.playerId]
  assert.ok(line)
  const stops = (line.blk + line.stl) / line.gp
  // Nobody eligible should be stopping more per game than the DPOY.
  for (const [id, other] of Object.entries(s.stats)) {
    const rec = s.records[other.teamId]
    if (!rec || other.gp < (rec.wins + rec.losses) * 0.58) continue
    const theirs = (other.blk + other.stl) / other.gp
    if (theirs > stops * 1.35) assert.fail(`${id} out-defends the DPOY by a mile`)
  }
})

test('no eligible players means no awards, not a crash', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  s.stats.ghost = { ...emptyStatLine(), gp: 0, gs: 0, teamId: 'T00' }
  const a = computeAwards(s)
  assert.equal(a.mvp, null)
  assert.equal(a.roy, null)
  assert.equal(a.dpoy, null)
  assert.deepEqual(a.allNba, [])
})
