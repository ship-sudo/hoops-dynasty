import assert from 'node:assert/strict'
import { test } from 'node:test'
import { eraContextFrom, type TeamSeasonLine } from './era-context.ts'

const team = (over: Partial<TeamSeasonLine>): TeamSeasonLine => ({
  gp: 82,
  poss: 8200, // 100 per game
  pace: 100,
  ortg: 110,
  fgm: 3000,
  fga: 7000,
  fg3m: 900,
  fg3a: 2500,
  ftm: 1500,
  fta: 2000,
  oreb: 800,
  dreb: 2700,
  ast: 1800,
  tov: 1100,
  stl: 600,
  blk: 400,
  pf: 1600,
  pts: 9400,
  ...over,
})

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`)

test('league rates are sums over teams; pace and ortg are game-weighted', () => {
  const a = team({})
  const b = team({
    gp: 41,
    poss: 4100,
    pace: 90,
    ortg: 100,
    fga: 3500,
    fgm: 1500,
    fg3a: 1250,
    fg3m: 450,
  })
  const e = eraContextFrom(2016, [a, b], { homeWins: 700, games: 1230 })
  near(e.pace, (100 * 82 + 90 * 41) / 123)
  near(e.ortg, (110 * 82 + 100 * 41) / 123)
  near(e.threePAr, (2500 + 1250) / (7000 + 3500))
  near(e.ftr, (2000 + 2000) / 10500)
  near(e.tovPct, (100 * 2200) / 12300)
  near(e.orbPct, 1600 / (1600 + 5400))
  near(e.fg3Pct, 1350 / 3750)
  near(e.fg2Pct, (4500 - 1350) / (10500 - 3750))
  near(e.ftPct, 3000 / 4000)
  near(e.astPct, 3600 / 4500)
  near(e.stlPer100, (100 * 1200) / 12300)
  near(e.blkPer100, (100 * 800) / 12300)
  near(e.pfPer100, (100 * 3200) / 12300)
  near(e.homeWinPct, 700 / 1230)
  assert.equal(e.handCheckBanned, true)
  assert.equal(e.zoneLegal, true)
})

test('placeholder zones split the 2P mix and reproduce the real 2P%', () => {
  const e = eraContextFrom(1998, [team({})], { homeWins: 1, games: 2 })
  const s = e.zoneShare
  near(s.rim + s.close + s.mid + s.three, 1)
  near(s.three, e.threePAr)
  near(s.rim / (1 - s.three), 0.4)
  const p = e.zonePct
  near((s.rim * p.rim + s.close * p.close + s.mid * p.mid) / (1 - s.three), e.fg2Pct)
  assert.equal(e.handCheckBanned, false)
  assert.equal(e.zoneLegal, false)
})

test('bref zone baselines override the placeholder', () => {
  const zones = {
    share: { rim: 0.3, close: 0.1, mid: 0.2, three: 0.4 },
    pct: { rim: 0.65, close: 0.4, mid: 0.4, three: 0.36 },
  }
  const e = eraContextFrom(2024, [team({})], { homeWins: 1, games: 2 }, zones)
  assert.deepEqual(e.zoneShare, zones.share)
  assert.deepEqual(e.zonePct, zones.pct)
})

test('era table flags override the year heuristics', () => {
  const flags = { handCheckBanned: true, zoneLegal: false }
  const e = eraContextFrom(1998, [team({})], { homeWins: 1, games: 2 }, null, flags)
  assert.equal(e.handCheckBanned, true)
  assert.equal(e.zoneLegal, false)
})
