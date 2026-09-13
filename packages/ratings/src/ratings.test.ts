import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PlayerSeasonStats } from '@hoops/core'
import { minuteWeight, type RateInput, rateSeason, shrink } from './index.ts'
import { leaguePriorsFrom, rawProxies } from './proxies.ts'

/** A plain league-average-ish season, then override what the test cares about. */
function stats(
  over: Partial<{
    min: number
    gp: number
    fg3a: number
    fg3Pct: number
    ftPct: number
    astPct: number
    blkPct: number
    orbPct: number
    usg: number
    dbpm: number
    ts: number
  }> = {},
): PlayerSeasonStats {
  const min = over.min ?? 2000
  const gp = over.gp ?? 75
  const fg3a = over.fg3a ?? 200
  const fg3Pct = over.fg3Pct ?? 0.35
  return {
    gp,
    gs: gp,
    min,
    totals: {
      fga: 900,
      fgm: 405,
      fg3a,
      fg3m: Math.round(fg3a * fg3Pct),
      fta: 300,
      ftm: Math.round(300 * (over.ftPct ?? 0.75)),
      oreb: 90,
      dreb: 250,
      ast: 200,
      tov: 130,
      stl: 70,
      blk: 40,
      pf: 180,
      pts: 1100,
    },
    per100: {
      fga: 19,
      fgm: 8.6,
      fg3a: 4,
      fg3m: 1.4,
      fta: 6.4,
      ftm: 4.8,
      oreb: 1.9,
      dreb: 5.3,
      ast: 4.2,
      tov: 2.7,
      stl: 1.5,
      blk: 0.8,
      pf: 3.8,
      pts: 23,
    },
    pct: { fg: 0.45, fg3: fg3Pct, ft: over.ftPct ?? 0.75, ts: over.ts ?? 0.54, efg: 0.49 },
    adv: {
      usg: over.usg ?? 20,
      astPct: over.astPct ?? 15,
      tovPct: 11,
      orbPct: over.orbPct ?? 4,
      drbPct: 12,
      stlPct: 1.6,
      blkPct: over.blkPct ?? 1.2,
      ortg: 108,
      drtg: 108,
      obpm: 0,
      dbpm: over.dbpm ?? 0,
      bpm: 0,
      per: 15,
      ws48: 0.1,
    },
    shooting: {
      avgDist: 12,
      share0_3: 0.3,
      share3_10: 0.15,
      share10_16: 0.15,
      share16_3p: 0.18,
      share3p: 0.22,
      pct0_3: 0.6,
      pct3_10: 0.4,
      pct10_16: 0.4,
      pct16_3p: 0.4,
      pct3p: fg3Pct,
      assisted2p: 0.5,
      assisted3p: 0.85,
      dunkShare: 0.05,
      corner3Share: 0.2,
    },
    pbp: null,
  }
}

function player(id: string, over: Parameters<typeof stats>[0] = {}): RateInput {
  return { playerId: id, pos: 'SG', age: 27, heightIn: 78, weightLb: 210, stats: stats(over) }
}

/** A league of 60 average players plus whoever the test adds. */
function league(extra: RateInput[]): RateInput[] {
  const base: RateInput[] = []
  for (let i = 0; i < 60; i++) base.push(player(`avg${i}`))
  return [...base, ...extra]
}

test('shrink pulls small samples toward the prior', () => {
  assert.equal(shrink(1, 0, 0.35, 40), 0.35)
  assert.ok(shrink(1, 4, 0.35, 40) < 0.42)
  assert.ok(shrink(1, 4000, 0.35, 40) > 0.95)
})

test('minuteWeight saturates at 1500 minutes', () => {
  assert.equal(minuteWeight(0), 0)
  assert.equal(minuteWeight(1500), 1)
  assert.equal(minuteWeight(3000), 1)
})

test('a better shooter gets a higher three rating', () => {
  const out = rateSeason(
    league([player('hot', { fg3Pct: 0.44 }), player('cold', { fg3Pct: 0.28 })]),
  )
  const hot = out.get('hot')!.ratings.three
  const cold = out.get('cold')!.ratings.three
  assert.ok(hot > cold + 15, `expected a clear gap, got ${hot} vs ${cold}`)
  assert.ok(hot <= 99 && cold >= 5)
})

test('thin seasons are pulled toward league average', () => {
  const out = rateSeason(
    league([
      player('thin', { fg3Pct: 0.5, fg3a: 20, min: 150, gp: 20 }),
      player('thick', { fg3Pct: 0.5, fg3a: 400, min: 2500 }),
    ]),
  )
  const thin = out.get('thin')!.ratings.three
  const thick = out.get('thick')!.ratings.three
  assert.ok(thick > thin, `full season should out-rate the cameo: ${thick} vs ${thin}`)
  assert.ok(thin < 75, `a 20-attempt sample should not read elite, got ${thin}`)
})

test('rim protection follows blocks and defensive impact', () => {
  const out = rateSeason(
    league([player('rim', { blkPct: 6, dbpm: 4 }), player('none', { blkPct: 0.2, dbpm: -2 })]),
  )
  assert.ok(out.get('rim')!.ratings.interiorD > out.get('none')!.ratings.interiorD + 20)
})

test('every rating is a finite number in range, even with no stats', () => {
  const out = rateSeason(
    league([{ playerId: 'ghost', pos: 'C', age: 22, heightIn: 84, weightLb: 240, stats: null }]),
  )
  for (const v of Object.values(out.get('ghost')!.ratings)) {
    assert.ok(Number.isFinite(v), 'rating must be finite')
    assert.ok(v >= 5 && v <= 99, `rating out of range: ${v}`)
  }
})

test('rateSeason is pure: same input, same output', () => {
  const inputs = league([player('x', { fg3Pct: 0.41 })])
  const a = rateSeason(inputs)
  const b = rateSeason(inputs)
  assert.deepEqual(a.get('x'), b.get('x'))
})

test('tendencies carry the real shot mix and sum to one', () => {
  const t = rateSeason(league([player('mix')])).get('mix')!.tendencies
  const sum = t.shotRim + t.shotClose + t.shotMid + t.shotThree
  assert.ok(Math.abs(sum - 1) < 0.02, `shot shares should sum to 1, got ${sum}`)
  assert.ok(t.usage > 0 && t.usage < 0.45)
})

test('ratings are era-fair: the same edge over your league rates the same', () => {
  // A 1999-ish league shooting 33%, with a man 6 points above it.
  const oldLeague: RateInput[] = []
  for (let i = 0; i < 60; i++) oldLeague.push(player(`old${i}`, { fg3Pct: 0.33 }))
  oldLeague.push(player('sharp', { fg3Pct: 0.39 }))
  // A 2024-ish league shooting 37%, with a man the same 6 points above it.
  const newLeague: RateInput[] = []
  for (let i = 0; i < 60; i++) newLeague.push(player(`new${i}`, { fg3Pct: 0.37 }))
  newLeague.push(player('sharp', { fg3Pct: 0.43 }))

  const a = rateSeason(oldLeague).get('sharp')!.ratings.three
  const b = rateSeason(newLeague).get('sharp')!.ratings.three
  assert.ok(Math.abs(a - b) <= 4, `same edge should rate alike across eras: ${a} vs ${b}`)
  assert.ok(a > 60, `six points above league average should rate well, got ${a}`)
})

test('league priors track the league they are given', () => {
  const hot = leaguePriorsFrom(
    Array.from({ length: 30 }, (_, i) => ({ ...player(`h${i}`, { fg3Pct: 0.42 }), teamGames: 82 })),
  )
  const cold = leaguePriorsFrom(
    Array.from({ length: 30 }, (_, i) => ({ ...player(`c${i}`, { fg3Pct: 0.3 }), teamGames: 82 })),
  )
  assert.ok(hot.pct3p > cold.pct3p + 0.08)
  const raw = rawProxies({ ...player('x', { fg3Pct: 0.42 }), teamGames: 82 }, hot)
  assert.ok(raw.three != null && raw.three > 0.39)
})
