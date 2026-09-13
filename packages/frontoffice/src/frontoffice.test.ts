import assert from 'node:assert/strict'
import { test } from 'node:test'
import { type Contract, type EraRules, makeRng, RATING_KEYS, type Ratings } from '@hoops/core'
import {
  birdRights,
  capSpace,
  capStatus,
  contractFrom,
  evaluateTrade,
  type FaTeam,
  type FreeAgent,
  isLegalTrade,
  maxSalary,
  payroll,
  pickValue,
  playerValue,
  rookieContract,
  rookieScale,
  runFreeAgency,
  seasonValue,
  type TradeAsset,
  type TradeSide,
  taxBill,
  tradeValue,
} from './index.ts'

function flat(v: number): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, v])) as unknown as Ratings
}

/** A 2016-ish CBA: tax line, one apron, incremental tax, 125% + 100k matching under the line. */
function rules(over: Partial<EraRules> = {}): EraRules {
  return {
    season_id: '2015-16',
    season_end: 2016,
    teams: 30,
    games: 82,
    cap: 70_000_000,
    tax_line: 84_740_000,
    apron_1: 88_740_000,
    apron_2: null,
    min_salary_0yr: 525_093,
    min_salary_10yr: 1_499_187,
    max_salary: { pct: { yrs_0_6: 25, yrs_7_9: 30, yrs_10_plus: 35 }, dollars: null },
    rookie_scale_pick1: 4_500_000,
    mle_non_taxpayer: 5_464_000,
    mle_taxpayer: 3_376_000,
    mle_room: 2_814_000,
    bae: 2_139_000,
    trade_matching: {
      split_at: 'tax_line',
      under: [{ up_to: null, pct: 150, plus: 100_000 }],
      over: [{ up_to: null, pct: 125, plus: 100_000 }],
      over_apron_2: null,
    },
    bird_years: 3,
    early_bird_years: 2,
    roster_max: 15,
    roster_min: 13,
    roster_active: 13,
    two_way_slots: 0,
    luxury_tax_scheme: 'incremental',
    tax_rates: {
      bracket: 5_000_000,
      standard: [1.5, 1.75, 2.5, 3.25],
      repeater: [2.5, 2.75, 3.5, 4.25],
      step: 0.5,
      repeater_rule: '3_of_4_prior',
    },
    draft: {
      rounds: 2,
      lottery_teams: 14,
      lottery_odds: [25, 19.9, 15.6, 11.9, 8.8, 6.3, 4.3, 2.8, 1.7, 1.1, 0.8, 0.7, 0.6, 0.5],
      picks_drawn: 3,
      min_age: 19,
      one_year_removed_from_hs: true,
    },
    playoffs: {
      teams: 16,
      first_round_games: 7,
      seeding: 'division_winners_top_4',
      play_in: 'none',
    },
    expansion_draft: {
      precedent: 2004,
      protected_per_team: 8,
      min_unprotected_per_team: 1,
      max_picks_per_team: 1,
      min_picks: 14,
    },
    rules: {
      hand_check_banned: true,
      zone_defense_legal: true,
      defensive_three_seconds: true,
      eight_second_backcourt: true,
      three_point_line_ft: { arc: 23.75, corner: 22 },
      shot_clock_offensive_rebound_14: false,
      coach_challenge: false,
    },
    notes: 'test fixture',
    unverified: [],
    ...over,
  }
}

function salaries(...amounts: number[]) {
  return amounts.map((amount, i) => ({ playerId: `p${i}`, amount, kind: 'standard' as const }))
}

function contract(teamId: string, yearEnd: number, amount: number, years = 1): Contract {
  return {
    teamId,
    kind: 'standard',
    years: Array.from({ length: years }, (_, i) => ({
      yearEnd: yearEnd + i,
      amount,
      option: null,
      guaranteed: true,
    })),
    source: 'generated',
  }
}

function asset(id: string, ov: number, age: number, salary: number, years = 1): TradeAsset {
  return {
    playerId: id,
    name: id,
    ratings: flat(ov),
    age,
    potential: ov + 5,
    contract: contract('A', 2016, salary, years),
  }
}

test('payroll ignores two-way deals', () => {
  const s = [
    ...salaries(10_000_000, 5_000_000),
    { playerId: 'tw', amount: 300_000, kind: 'two_way' as const },
  ]
  assert.equal(payroll(s), 15_000_000)
})

test('cap space holds a slot for every empty roster spot', () => {
  const r = rules()
  const s = salaries(...Array(10).fill(5_000_000))
  // 50m of salary, 10 players: 3 empty slots below the 13-man minimum are charged as holds.
  assert.equal(capSpace(s, r, 10), r.cap - 50_000_000 - 3 * r.min_salary_0yr)
})

test('cap status walks the lines in order', () => {
  const r = rules()
  assert.equal(capStatus(salaries(40_000_000), r), 'room')
  assert.equal(capStatus(salaries(75_000_000), r), 'over_cap')
  assert.equal(capStatus(salaries(86_000_000), r), 'taxpayer')
  assert.equal(capStatus(salaries(90_000_000), r), 'apron_1')
})

test('luxury tax: none, flat, incremental and repeater', () => {
  const none = rules({ luxury_tax_scheme: 'none', tax_line: null })
  assert.equal(taxBill(salaries(120_000_000), none), 0)

  const flatTax = rules({ luxury_tax_scheme: 'flat_1_to_1' })
  assert.equal(taxBill(salaries(94_740_000), flatTax), 10_000_000)

  const r = rules()
  // 6m over: 5m at 1.5 plus 1m at 1.75.
  assert.equal(taxBill(salaries(90_740_000), r), 5_000_000 * 1.5 + 1_000_000 * 1.75)
  assert.ok(taxBill(salaries(90_740_000), r, { repeater: true }) > taxBill(salaries(90_740_000), r))
})

test('max salary follows years of service, by percent or by dollars', () => {
  const r = rules()
  assert.equal(maxSalary(r, 2), 17_500_000)
  assert.equal(maxSalary(r, 12), 24_500_000)
  const dollars = rules({
    max_salary: {
      pct: null,
      dollars: { yrs_0_6: 9_000_000, yrs_7_9: 11_000_000, yrs_10_plus: 14_000_000 },
    },
  })
  assert.equal(maxSalary(dollars, 8), 11_000_000)
  const noMax = rules({ max_salary: { pct: null, dollars: null } })
  assert.equal(maxSalary(noMax, 5), noMax.cap, 'no individual max before the 1999 CBA')
})

test('bird rights need three seasons, early bird two', () => {
  const r = rules()
  assert.equal(birdRights(3, r), 'full')
  assert.equal(birdRights(2, r), 'early')
  assert.equal(birdRights(1, r), 'non')
  assert.equal(birdRights(0, r), 'none')
})

test('the value curve is anchored to what the league actually pays', () => {
  const r = rules()
  const max = maxSalary(r, 10)
  // The best player alive produces far more than the maximum lets anyone pay him. That gap is the
  // whole reason a star is an asset; pricing him at about the max made every star a liability on
  // his own trade block, and the league handed its best players away for spare parts.
  const star = seasonValue(flat(75), r)
  assert.ok(
    star > max * 1.5,
    `a 75 should clear the max (${Math.round(max / 1e6)}M) comfortably, got ${Math.round(star / 1e6)}M`,
  )
  // Replacement level is 45 on this scale — the 400th-best player in a 30-team league, measured on
  // the 1998, 2004 and 2016 bundles. He is worth no more than the minimum he costs.
  assert.ok(seasonValue(flat(45), r) <= r.min_salary_0yr)
  assert.ok(
    seasonValue(flat(38), r) < seasonValue(flat(45), r),
    'ordering survives below the floor',
  )
  // And a rotation regular prices like a rotation regular, not like a minimum man.
  const rotation = seasonValue(flat(51), r)
  assert.ok(
    rotation > 3_000_000 && rotation < 12_000_000,
    `a 51 should price like a rotation player, got ${Math.round(rotation / 1e6)}M`,
  )
})

test('a star on a fair contract is worth more than a scrub on a cheap one', () => {
  const opts = { yearEnd: 2016, rules: rules(), winNow: 0.5 }
  // The star earns a maximum salary, so his *surplus* is modest. The bargain bench player is paid
  // nothing, so his surplus is positive. Judged on surplus alone the two looked comparable, which
  // is how a rebuilding tester was handed Allen Iverson and a first for a role player.
  const star = asset('star', 72, 27, 24_000_000, 3)
  const scrub = asset('scrub', 46, 29, 900_000, 3)
  assert.ok(
    tradeValue(star, opts) > tradeValue(scrub, opts) * 5,
    `a star should dwarf a minimum-salary bench man: ${tradeValue(star, opts)} vs ${tradeValue(scrub, opts)}`,
  )
  // And nobody swaps one for the other, in either direction.
  const side = (teamId: string, players: TradeAsset[]): TradeSide => ({
    teamId,
    salaries: [],
    outPlayers: players,
    outPicks: [],
  })
  assert.equal(evaluateTrade(side('AI', [star]), side('YOU', [scrub]), opts).accepted, false)
})

test('a star is worth far more than a rotation player, and value is convex', () => {
  const r = rules()
  const star = seasonValue(flat(75), r)
  const starter = seasonValue(flat(58), r)
  const bench = seasonValue(flat(45), r)
  assert.ok(star > starter * 2, `stars should be worth multiples: ${star} vs ${starter}`)
  assert.ok(starter > bench * 2)
})

test('surplus turns negative on a bad contract', () => {
  const opts = { yearEnd: 2016, rules: rules(), winNow: 0.5 }
  const goodDeal = playerValue(asset('good', 70, 26, 8_000_000, 3), opts)
  const albatross = playerValue(asset('bad', 44, 33, 20_000_000, 3), opts)
  assert.ok(goodDeal.surplus > 0)
  assert.ok(
    albatross.surplus < 0,
    `an overpaid declining player should be a liability, got ${albatross.surplus}`,
  )
})

test('rebuilding teams value youth and picks more than win-now teams', () => {
  const base = { yearEnd: 2016, rules: rules() }
  const kid = asset('kid', 55, 22, 3_000_000, 3)
  const rebuildValue = playerValue(kid, { ...base, winNow: 0 }).surplus
  const winNowValue = playerValue(kid, { ...base, winNow: 1 }).surplus
  assert.ok(rebuildValue > winNowValue)
  const pick = { draftYear: 2017, round: 1 as const, expectedSlot: 5, fromTeamId: 'B' }
  assert.ok(pickValue(pick, { ...base, winNow: 0 }) > pickValue(pick, { ...base, winNow: 1 }))
  assert.ok(
    pickValue({ ...pick, expectedSlot: 2 }, { ...base, winNow: 0.5 }) >
      pickValue({ ...pick, expectedSlot: 25 }, { ...base, winNow: 0.5 }) * 3,
    'the top of the lottery should be worth much more than the back of the round',
  )
})

test('salary matching blocks a lopsided trade for an over-the-line team', () => {
  const r = rules()
  const over = {
    teamId: 'OVER',
    salaries: salaries(...Array(14).fill(6_200_000)), // ~86.8m, above the tax line
    outPlayers: [asset('small', 50, 27, 2_000_000)],
    outPicks: [],
  }
  const under = {
    teamId: 'UNDER',
    salaries: salaries(...Array(12).fill(5_000_000)),
    outPlayers: [asset('big', 70, 27, 18_000_000)],
    outPicks: [],
  }
  const verdict = isLegalTrade(over, under, r, 2016)
  assert.equal(verdict.legal, false)
  assert.match(verdict.reasons.join(' '), /may take back/)
})

test('second-apron teams cannot aggregate salaries', () => {
  const r = rules({
    apron_2: 100_000_000,
    trade_matching: {
      split_at: 'apron_1',
      under: [{ up_to: null, pct: 125, plus: 250_000 }],
      over: [{ up_to: null, pct: 110, plus: 0 }],
      over_apron_2: { pct: 100, plus: 0, can_aggregate: false, can_send_cash: false },
    },
  })
  const rich = {
    teamId: 'RICH',
    salaries: salaries(...Array(14).fill(7_500_000)), // 105m, over the second apron
    outPlayers: [asset('a', 60, 27, 8_000_000), asset('b', 58, 28, 8_000_000)],
    outPicks: [],
  }
  const poor = {
    teamId: 'POOR',
    salaries: salaries(...Array(12).fill(4_000_000)),
    outPlayers: [asset('c', 65, 26, 16_000_000)],
    outPicks: [],
  }
  assert.match(isLegalTrade(rich, poor, r, 2016).reasons.join(' '), /aggregate/)
})

test('the AI refuses a fleecing and accepts a real upgrade', () => {
  const opts = { yearEnd: 2016, rules: rules(), winNow: 0.7 }
  const aiSide = {
    teamId: 'AI',
    salaries: salaries(...Array(12).fill(5_000_000)),
    outPlayers: [asset('star', 76, 27, 15_000_000, 3)],
    outPicks: [],
  }
  const fleece = {
    teamId: 'USER',
    salaries: salaries(...Array(12).fill(5_000_000)),
    outPlayers: [asset('scrub', 42, 31, 14_000_000, 3)],
    outPicks: [],
  }
  assert.equal(evaluateTrade(aiSide, fleece, opts).accepted, false)

  const fair = {
    teamId: 'USER',
    salaries: salaries(...Array(12).fill(5_000_000)),
    outPlayers: [asset('better', 80, 25, 16_000_000, 3)],
    outPicks: [],
  }
  const verdict = evaluateTrade(aiSide, fair, opts)
  assert.equal(
    verdict.accepted,
    true,
    `expected acceptance, got: ${verdict.reason} (net ${verdict.net})`,
  )
})

function faTeam(id: string, payrollTotal: number, winNow: number, wins = 41): FaTeam {
  return {
    teamId: id,
    salaries: salaries(payrollTotal),
    rosterCount: 10,
    projectedWins: wins,
    winNow,
    rotation: Array(9).fill(flat(48)),
  }
}

function freeAgent(id: string, ov: number, age: number, service = 6): FreeAgent {
  return {
    playerId: id,
    name: id,
    ratings: flat(ov),
    age,
    potential: ov + 4,
    contract: null,
    yearsOfService: service,
    incumbentTeamId: null,
    yearsWithIncumbent: 0,
  }
}

test('free agency: the best players sign first and for the most money', () => {
  const r = rules()
  const rng = makeRng(12)
  const pool = [freeAgent('star', 74, 27), freeAgent('starter', 58, 29), freeAgent('scrub', 42, 33)]
  const teams = [
    faTeam('A', 30_000_000, 0.8, 50),
    faTeam('B', 40_000_000, 0.5),
    faTeam('C', 82_000_000, 0.9, 55),
  ]
  const signings = runFreeAgency(pool, teams, r, 2016, rng)
  const byPlayer = new Map(signings.map((s) => [s.playerId, s]))
  assert.equal(signings.length, 3, 'everyone should land somewhere')
  assert.ok(byPlayer.get('star')!.amount > byPlayer.get('starter')!.amount)
  assert.ok(byPlayer.get('starter')!.amount > byPlayer.get('scrub')!.amount)
  assert.ok(byPlayer.get('star')!.years >= byPlayer.get('scrub')!.years)
  assert.equal(signings[0]?.playerId, 'star', 'the market clears from the top')
})

test('a whole league clears the market at real money, not at the minimum', () => {
  const r = rules()
  const rng = makeRng(7)
  // Thirty clubs with three roster spots each and a board that spans the real rating spread.
  const teams = Array.from({ length: 30 }, (_, i) => faTeam(`T${i}`, 22_000_000, 0.5, 41))
  const pool = Array.from({ length: 120 }, (_, i) =>
    // 72 down to 44: one star, a tail of starters, then the bench.
    freeAgent(`p${i}`, Math.round(72 - i * 0.24), 24 + (i % 10)),
  )
  const signings = runFreeAgency(pool, teams, r, 2016, rng)

  // Every club used to chase the same man each round, so eight rounds produced about eight real
  // contracts in the whole league and everyone else fell through to a one-year minimum. That is
  // how league payroll halved in two summers.
  const real = signings.filter((s) => s.kind === 'standard')
  assert.ok(
    real.length >= 40,
    `a league's summer should write dozens of real contracts, got ${real.length} of ${signings.length}`,
  )
  const committed = signings.reduce((a, s) => a + s.amount, 0)
  assert.ok(
    committed > r.cap * 3,
    `ninety roster spots should cost real money, got ${Math.round(committed / 1e6)}M`,
  )
  // And the good players are the ones being paid.
  const paid = new Map(signings.map((s) => [s.playerId, s.amount]))
  assert.ok((paid.get('p0') ?? 0) > (paid.get('p100') ?? 0) * 4)
})

test('nobody signs his way deep into the tax for a role player', () => {
  const r = rules()
  const rng = makeRng(3)
  // 80m payroll against an 84.74m line: room under the exceptions, but no appetite for the tax.
  const rebuilding = faTeam('REB', 80_000_000, 0)
  const signings = runFreeAgency([freeAgent('mid', 58, 28)], [rebuilding], r, 2016, rng)
  const after = 80_000_000 + (signings[0]?.amount ?? 0)
  assert.ok(
    after <= (r.tax_line ?? 0),
    `a rebuilding club should stop short of the tax line, ended at ${Math.round(after / 1e6)}M`,
  )
})

test('free agency respects the cap: a taxpayer only offers the taxpayer exception', () => {
  const r = rules()
  const rng = makeRng(4)
  const taxpayer = faTeam('TAX', 86_000_000, 0.9, 52) // above the 84.74m tax line
  const signings = runFreeAgency([freeAgent('mid', 60, 28)], [taxpayer], r, 2016, rng)
  assert.equal(signings.length, 1)
  assert.ok(
    signings[0]!.amount <= (r.mle_taxpayer ?? 0) + 1,
    `a taxpayer should be limited to the taxpayer MLE, offered ${signings[0]!.amount}`,
  )
})

test('the full mid-level is off the table when it would cross the apron', () => {
  const r = rules()
  const rng = makeRng(4)
  // 84m: under the tax line, so nominally entitled to the full MLE — but 84m + 5.46m clears the
  // 88.74m apron, and using the full exception hard-caps you there. So: taxpayer MLE only.
  const nearApron = faTeam('NEAR', 84_000_000, 0.9, 52)
  const signings = runFreeAgency([freeAgent('mid', 60, 28)], [nearApron], r, 2016, rng)
  assert.equal(signings.length, 1)
  assert.ok(
    signings[0]!.amount <= (r.mle_taxpayer ?? 0) + 1,
    `expected the taxpayer MLE, offered ${signings[0]!.amount}`,
  )

  // A team with the same rules but far below the apron keeps the full exception.
  const roomy = faTeam('ROOM', 72_000_000, 0.9, 52)
  const other = runFreeAgency([freeAgent('mid2', 60, 28)], [roomy], r, 2016, rng)
  assert.ok((other[0]?.amount ?? 0) > (r.mle_taxpayer ?? 0) + 1)
})

test('free agency is deterministic for a seed', () => {
  const r = rules()
  const pool = [freeAgent('a', 65, 26), freeAgent('b', 55, 30)]
  const teams = [faTeam('A', 20_000_000, 0.5), faTeam('B', 60_000_000, 0.7)]
  const one = runFreeAgency(pool, teams, r, 2016, makeRng(99))
  const two = runFreeAgency(pool, teams, r, 2016, makeRng(99))
  assert.deepEqual(one, two)
})

test('contracts come out with the right years and raises', () => {
  const c = contractFrom(
    { teamId: 'A', playerId: 'p', amount: 10_000_000, years: 3, kind: 'standard' },
    2016,
  )
  assert.equal(c.years.length, 3)
  assert.equal(c.years[0]?.yearEnd, 2016)
  assert.equal(c.years[2]?.yearEnd, 2018)
  assert.equal(c.years[1]?.amount, 10_500_000)
})

test('the market fills every team to the legal minimum roster', () => {
  const r = rules()
  const rng = makeRng(21)
  // 30 teams with 8 men each, and a pool big enough to fill them.
  const teams = Array.from({ length: 30 }, (_, i) => ({
    ...faTeam(`T${i}`, 40_000_000, 0.5),
    rosterCount: 8,
  }))
  const pool = Array.from({ length: 220 }, (_, i) =>
    freeAgent(`fa${i}`, 38 + (i % 30), 24 + (i % 12), i % 11),
  )
  const signings = runFreeAgency(pool, teams, r, 2016, rng)
  const counts = new Map<string, number>()
  for (const s of signings) counts.set(s.teamId, (counts.get(s.teamId) ?? 0) + 1)
  for (const t of teams) {
    const total = 8 + (counts.get(t.teamId) ?? 0)
    assert.ok(total >= r.roster_min, `${t.teamId} finished with ${total}, below the minimum`)
    assert.ok(total <= r.roster_max, `${t.teamId} finished with ${total}, above the maximum`)
  }
  assert.ok(
    signings.length >= 30 * (r.roster_min - 8),
    `expected at least ${30 * (r.roster_min - 8)} signings, got ${signings.length}`,
  )
})

test('a thin pool still leaves teams legal where it can, without over-signing', () => {
  const r = rules()
  const rng = makeRng(22)
  const teams = [{ ...faTeam('A', 40_000_000, 0.5), rosterCount: 8 }]
  const pool = Array.from({ length: 3 }, (_, i) => freeAgent(`p${i}`, 45, 27))
  const signings = runFreeAgency(pool, teams, r, 2016, rng)
  assert.equal(signings.length, 3, 'every available player should be signed by the needy team')
  assert.ok(signings.every((s) => s.teamId === 'A'))
})

test('the rookie scale falls steeply through the lottery and flattens late', () => {
  const r = rules()
  const top = rookieScale(r, 1)
  assert.equal(top, r.rookie_scale_pick1)
  assert.ok(rookieScale(r, 5) < top && rookieScale(r, 5) > rookieScale(r, 14))
  assert.ok(rookieScale(r, 30) < top * 0.3)
  assert.ok(rookieScale(r, 30) >= r.min_salary_0yr)
  assert.equal(rookieScale(r, 40, 2), r.min_salary_0yr, 'second round is not on the scale')
})

test('rookie contracts run four years for a first-rounder, two for a second', () => {
  const r = rules()
  const first = rookieContract(r, 'A', 2017, 3)
  assert.equal(first.years.length, 4)
  assert.equal(first.kind, 'rookie_scale')
  assert.equal(first.years[0]?.yearEnd, 2017)
  assert.ok(first.years[0]!.guaranteed && !first.years[3]!.guaranteed)
  const second = rookieContract(r, 'A', 2017, 45, 2)
  assert.equal(second.years.length, 2)
  assert.equal(second.kind, 'minimum')
})
