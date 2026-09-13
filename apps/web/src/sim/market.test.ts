// The money: what a player is worth in a trade, what a club will pay him, who owns which pick,
// and whether the tax is ever charged.
//
// Every test here started life as a play-tester's complaint. Like sim.test.ts, they need the data
// pipeline to have run and skip themselves when it has not.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeRng, type SeasonBundle } from '@hoops/core'
import { askingPrice, type FreeAgent, TALENT_WEIGHT } from '@hoops/frontoffice'
import { type GameState, type LeaguePlayer, moraleOf, newGame, pickKey } from '@hoops/game'
import { draftPotential, overall } from '@hoops/progression'
import {
  askingFrom,
  askingToStay,
  extendPlayer,
  freeAgentPool,
  type Potentials,
  recordTaxBills,
  runMarket,
  runMarketDay,
  seasonTaxBills,
  whatHeWants,
} from './market.ts'
import { realModule } from './real.ts'
import { applyTrade, assess, expectedSlots, incomingOffers, picksOf, tradeBlock } from './trades.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const bundlePath = join(dataDir, 'bundles', '2004.json')
const havePipeline = existsSync(bundlePath)
const bundle: SeasonBundle | null = havePipeline
  ? (JSON.parse(readFileSync(bundlePath, 'utf8')) as SeasonBundle)
  : null
const skip = !havePipeline
const SAS = () => bundle!.teams.find((t) => t.abbr === 'SAS')!.teamId

/** A raw opening-night state plus the hidden ceilings the valuation wants. */
function opening(seed = 5): { state: GameState; potentials: Potentials } {
  const state = newGame(bundle!, SAS(), seed)
  const potentials: Potentials = new Map()
  const rng = makeRng(seed ^ 0x5eed)
  for (const p of state.league.players)
    potentials.set(p.playerId, draftPotential(p.ratings, p.age, rng))
  return { state, potentials }
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx
    const dy = (ys[i] ?? 0) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

test('the best players are the most valuable, across the whole league', { skip }, () => {
  const { state, potentials } = opening()
  const ratings = new Map(state.league.players.map((p) => [p.playerId, p.ratings]))
  const ovs: number[] = []
  const surplus: number[] = []
  const traded: number[] = []
  const byName = new Map<string, number>()
  for (const t of state.league.teams)
    for (const row of tradeBlock(state, t.teamId, potentials)) {
      const r = ratings.get(row.playerId)
      if (!r) continue
      ovs.push(overall(r))
      surplus.push(row.surplus)
      // What a trade is actually scored on: surplus plus a share of production.
      traded.push(row.surplus + TALENT_WEIGHT * row.value)
      byName.set(row.name, row.surplus)
    }
  assert.ok(ovs.length > 400, `expected a league, got ${ovs.length} players`)

  // Measured at −0.072 before this: quality and trade value were, if anything, anti-correlated,
  // and 60% of the league was a negative asset. The AI would pay you to take its stars.
  const r = pearson(ovs, surplus)
  assert.ok(r > 0.25, `trade value should track quality, got r = ${r.toFixed(3)}`)

  // And counting production, not only the contract, tracks it harder still. This is the half a
  // surplus-only market throws away: cap room can be spent again, talent cannot be conjured.
  const rTraded = pearson(ovs, traded)
  assert.ok(
    rTraded > r + 0.05,
    `production should sharpen the ranking: ${rTraded.toFixed(3)} vs ${r.toFixed(3)}`,
  )

  // Garnett was priced at −$6.4M, Duncan at −$8.1M and Nowitzki at −$19.3M, while the most
  // valuable man in basketball was a 38-year-old Reggie Miller.
  for (const name of ['Kevin Garnett', 'Tim Duncan', 'Dirk Nowitzki'])
    assert.ok(
      (byName.get(name) ?? 0) > 0,
      `${name} should be an asset, priced at ${Math.round((byName.get(name) ?? 0) / 1e6)}M`,
    )
})

test('nobody trades a star for a spare part', { skip }, () => {
  const { state, potentials } = opening()
  const ratings = new Map(state.league.players.map((p) => [p.playerId, overall(p.ratings)]))
  const other = state.league.teams.find((t) => t.teamId !== SAS())!.teamId

  const theirBest = tradeBlock(state, other, potentials).sort(
    (a, b) => (ratings.get(b.playerId) ?? 0) - (ratings.get(a.playerId) ?? 0),
  )[0]!
  const myWorst = tradeBlock(state, SAS(), potentials).sort(
    (a, b) => (ratings.get(a.playerId) ?? 0) - (ratings.get(b.playerId) ?? 0),
  )[0]!

  const verdict = assess(
    state,
    { teamId: SAS(), players: [myWorst.playerId], picks: [] },
    { teamId: other, players: [theirBest.playerId], picks: [] },
    potentials,
  )
  assert.equal(
    verdict.accepted,
    false,
    `their best man for your worst should be refused: ${verdict.reason}`,
  )
})

test('a pick you acquired is a pick you own', { skip }, () => {
  const { state } = opening()
  const other = state.league.teams.find((t) => t.teamId !== SAS())!.teamId
  const theirs = picksOf(state, other)
  const wanted = theirs[0]!
  const before = picksOf(state, SAS()).length

  applyTrade(
    state,
    { teamId: SAS(), players: [], picks: [] },
    { teamId: other, players: [], picks: [wanted] },
  )

  // The ledger says it is yours; `picksOf` used to look up your own key only, so a first you had
  // just bought was invisible — you could not re-trade it and the AI never offered you one.
  assert.equal(state.pickOwners[pickKey(wanted.draftYear, wanted.round, wanted.fromTeamId)], SAS())
  const after = picksOf(state, SAS())
  assert.equal(after.length, before + 1, 'the pick you bought should be on your books')
  assert.ok(
    after.some((p) => p.fromTeamId === other && p.draftYear === wanted.draftYear),
    'and it should still say whose pick it is',
  )
  assert.ok(
    !picksOf(state, other).some(
      (p) => p.draftYear === wanted.draftYear && p.round === wanted.round && p.fromTeamId === other,
    ),
    'and the club that sold it should not still have it',
  )
})

test('a pick is priced by the team that earned it, from the first day', { skip }, () => {
  const { state } = opening()
  const slots = expectedSlots(state)
  assert.equal(slots.size, state.league.teams.length)

  // Every pick in the league used to be priced as the 13th, because the slot came from
  // `state.history`, which is empty on opening night.
  assert.ok(
    new Set(slots.values()).size > 20,
    `thirty clubs should not share one draft slot, got ${new Set(slots.values()).size}`,
  )
  // And the good rosters pick late.
  const strength = (teamId: string) =>
    state.league.players
      .filter((p) => p.teamId === teamId)
      .map((p) => overall(p.ratings))
      .sort((a, b) => b - a)
      .slice(0, 8)
      .reduce((a, b) => a + b, 0)
  const teams = [...state.league.teams].sort((a, b) => strength(b.teamId) - strength(a.teamId))
  const best = teams[0]!.teamId
  const worst = teams.at(-1)!.teamId
  assert.ok(
    (slots.get(best) ?? 0) > (slots.get(worst) ?? 0),
    'the strongest roster should pick later than the weakest',
  )
})

test('the offers list is a market: it moves, and it includes picks', { skip }, () => {
  const { state, potentials } = opening()
  const draws = [1, 2, 3, 4, 5].map((seed) => incomingOffers(state, potentials, makeRng(seed), 20))

  // It used to return nothing at all in year one and then exactly the limit, every year, forever.
  assert.ok(
    draws.every((d) => d.length > 0),
    `every draw should find somebody interested, got ${draws.map((d) => d.length).join(', ')}`,
  )
  const shapes = draws.map((d) =>
    d.map((o) => `${o.other.teamId}:${o.user.players.join('+')}`).join('|'),
  )
  assert.ok(new Set(shapes).size > 1, 'two different weeks should not produce the same board')

  const withPicks = draws.flat().filter((o) => o.other.picks.length + o.user.picks.length > 0)
  assert.ok(withPicks.length > 0, 'a real market moves draft picks, not only players')
  // And nobody asks for everything you own.
  for (const o of draws.flat())
    assert.ok(o.user.picks.length <= 1, 'an offer that demands all your picks is not an offer')
})

test('offering a free agent more than he asks for signs him', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  // Make the best man in the league a free agent this summer.
  const pool0 = state.league.players.filter((p) => p.teamId !== SAS())
  const star = [...pool0].sort((a, b) => overall(b.ratings) - overall(a.ratings))[0]!
  star.contract = null
  star.teamId = null
  // And clear the user's books so there is room to sign anybody.
  for (const p of state.league.players) if (p.teamId === SAS()) p.teamId = null

  const fa = freeAgentPool(state, yearEnd, potentials).find((p) => p.playerId === star.playerId)!
  const ask = whatHeWants(state, fa)

  const out = runMarket(state, yearEnd, makeRng(11), potentials, [
    // Well over the asking price: an instruction to pay as much as the rules allow, not a mistake.
    { playerId: star.playerId, amount: Math.round(ask.amount * 1.6), years: ask.years },
  ])
  assert.deepEqual(
    out.userSigned,
    [star.playerId],
    `bidding above the asking price must not lose the player: ${out.rejected.map((r) => r.reason).join('; ')}`,
  )
  const signed = out.signings.find((s) => s.playerId === star.playerId)!
  assert.ok(signed.amount >= ask.amount, 'and he is paid at least what he asked')
})

test('a market day signs a bid that meets the ask and leaves a short one', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  for (const p of state.league.players) if (p.teamId === SAS()) p.teamId = null
  const pool0 = state.league.players.filter((p) => !p.contract)
  const star = [...pool0].sort((a, b) => overall(b.ratings) - overall(a.ratings))[0]!
  const bench = [...pool0].sort((a, b) => overall(a.ratings) - overall(b.ratings))[0]!
  star.contract = null
  star.teamId = null
  bench.contract = null
  bench.teamId = null
  const starFa = freeAgentPool(state, yearEnd, potentials).find(
    (p) => p.playerId === star.playerId,
  )!
  const benchFa = freeAgentPool(state, yearEnd, potentials).find(
    (p) => p.playerId === bench.playerId,
  )!
  const ask = whatHeWants(state, starFa)
  const benchAsk = whatHeWants(state, benchFa)
  const day = runMarketDay(state, yearEnd, makeRng(11), potentials, [
    { playerId: star.playerId, amount: ask.amount, years: ask.years },
    { playerId: bench.playerId, amount: Math.max(1, Math.round(benchAsk.amount * 0.4)), years: 1 },
  ])
  assert.ok(day.userSigned.includes(star.playerId), 'meeting the ask lands him today')
  assert.ok(
    day.pending.some((o) => o.playerId === bench.playerId) ||
      day.stolen.some((s) => s.playerId === bench.playerId),
    'a short bid waits or gets beaten, it is not silently dropped',
  )
})

test('a market day refuses a bid the cap will not let you pay', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  const star = [...state.league.players]
    .filter((p) => p.teamId !== SAS())
    .sort((a, b) => overall(b.ratings) - overall(a.ratings))[0]!
  star.contract = null
  star.teamId = null
  const mine = state.league.players
    .filter((p) => p.teamId === SAS())
    .sort(
      (a, b) =>
        (a.contract?.years.find((y) => y.yearEnd === yearEnd)?.amount ?? 0) -
        (b.contract?.years.find((y) => y.yearEnd === yearEnd)?.amount ?? 0),
    )
  for (const p of mine.slice(0, 3)) {
    p.teamId = null
    p.contract = null
  }

  const day = runMarketDay(state, yearEnd, makeRng(11), potentials, [
    { playerId: star.playerId, amount: 90_000_000, years: 4 },
  ])
  const miss = day.rejected.find((r) => r.playerId === star.playerId)
  assert.ok(miss, 'meeting a price you cannot pay is a no, not a silent wait')
  assert.equal(day.pending.length, 0, 'the bid does not sit on the table as if nothing happened')
  assert.ok(
    /maximum|cap room|over the cap/.test(miss.reason),
    `the refusal should name the rule that bound: "${miss.reason}"`,
  )
})

test('a refused bid names the rule that actually stopped it', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  const star = [...state.league.players]
    .filter((p) => p.teamId !== SAS())
    .sort((a, b) => overall(b.ratings) - overall(a.ratings))[0]!
  star.contract = null
  star.teamId = null
  // The user keeps his expensive payroll — no cap room — but waives his three cheapest men so the
  // roster limit is not what stops the bid. Then it is the maximum or the exception that binds.
  const mine = state.league.players
    .filter((p) => p.teamId === SAS())
    .sort(
      (a, b) =>
        (a.contract?.years.find((y) => y.yearEnd === yearEnd)?.amount ?? 0) -
        (b.contract?.years.find((y) => y.yearEnd === yearEnd)?.amount ?? 0),
    )
  for (const p of mine.slice(0, 3)) {
    p.teamId = null
    p.contract = null
  }

  const out = runMarket(state, yearEnd, makeRng(11), potentials, [
    { playerId: star.playerId, amount: 90_000_000, years: 4 },
  ])
  const miss = out.rejected.find((r) => r.playerId === star.playerId)
  if (miss) {
    assert.ok(
      /maximum|cap room|over the cap/.test(miss.reason),
      `the refusal should name the rule that bound: "${miss.reason}"`,
    )
    assert.ok(
      !/that is your room, or the exception/.test(miss.reason),
      'and not offer a guess between two of them',
    )
  }
})

test('the luxury tax is assessed and written into the league log', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  const before = seasonTaxBills(state, yearEnd)
  assert.ok(before.length > 0, 'the 2003-04 league had taxpayers in it')
  assert.ok(before[0]!.bill > 0 && before[0]!.payroll > before[0]!.taxLine)

  const logBefore = state.log.length
  const out = runMarket(state, yearEnd + 1, makeRng(2), potentials)
  // `taxBill` had never been called by anything but its own unit test: a $93.2M payroll against an
  // $84.7M line owed $13.6M and was simply never charged.
  assert.ok(Array.isArray(out.tax), 'the summer returns the tax it assessed')
  const notes = state.log
    .slice(logBefore)
    .filter((e) => e.kind === 'note' && /luxury tax/.test(e.text))
  assert.equal(notes.length, out.tax.length, 'every bill should reach the log')
  for (const t of out.tax) assert.ok(t.bill > 0)
  recordTaxBills(state, yearEnd + 1, out.tax)
  assert.ok((state.taxPaid?.[out.tax[0]!.teamId] ?? []).includes(yearEnd + 1))
})

test('a repeater is billed at the surcharge, not the standard rates', { skip }, () => {
  const { state } = opening()
  const yearEnd = state.season.yearEnd
  const first = seasonTaxBills(state, yearEnd)[0]
  assert.ok(first, 'need a taxpayer to prove the surcharge')
  state.season.rules = {
    ...state.season.rules,
    luxury_tax_scheme: 'incremental',
    tax_rates: {
      bracket: 5_000_000,
      standard: [1.5, 1.75, 2.5, 3.25],
      repeater: [2.5, 2.75, 3.5, 4.25],
      step: 0.5,
      repeater_rule: '3_of_4_prior',
    },
  }
  const plain = seasonTaxBills(state, yearEnd).find((b) => b.teamId === first.teamId)
  state.taxPaid = { [first.teamId]: [yearEnd - 1, yearEnd - 2, yearEnd - 3] }
  const rpt = seasonTaxBills(state, yearEnd).find((b) => b.teamId === first.teamId)
  assert.equal(plain?.repeater, false)
  assert.equal(rpt?.repeater, true)
  assert.ok((rpt?.bill ?? 0) > (plain?.bill ?? 0), 'repeater rates cost more')
})

test('listing a man on the block draws offers for him, not the rest of the roster', {
  skip,
}, () => {
  const { state, potentials } = opening()
  const star = tradeBlock(state, SAS(), potentials)[0]
  assert.ok(star)
  state.listed = [star.playerId]
  const offers = incomingOffers(state, potentials, makeRng(9), 12)
  assert.ok(offers.length > 0, 'somebody should come in on a listed star')
  assert.ok(
    offers.every((o) => o.user.players.includes(star.playerId)),
    'every offer should be for the man you listed',
  )
})

test('you can extend a man who is still under contract', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  const man = state.league.players.find((p) => {
    if (p.teamId !== SAS() || !p.contract) return false
    const rem = p.contract.years.filter((y) => y.yearEnd >= yearEnd).length
    return rem >= 1 && rem <= 3
  })
  assert.ok(man?.contract, 'need a Spur with room left on his deal')
  moraleOf(state, man).value = 10
  const no = extendPlayer(
    state,
    man.playerId,
    askingToStay(state, man, potentials).amount,
    1,
    potentials,
  )
  assert.equal(no.ok, false)
  moraleOf(state, man).value = 60
  const before = man.contract.years.length
  const ask = askingToStay(state, man, potentials)
  const res = extendPlayer(state, man.playerId, ask.amount, 2, potentials)
  assert.equal(res.ok, true, res.message)
  assert.equal(man.contract.years.length, before + 2)
})

test('league payroll stays in the realm of the cap', { skip }, () => {
  // Slow: three hands-off seasons through the real engine. It is the one thing the testers could
  // see from the outside — payroll fell from $75M to $37M against a $70M cap in five summers, and
  // the market wrote almost nothing but one-year minimum deals.
  const d = realModule().newGame(bundle!, { yearEnd: 2004, teamId: SAS(), seed: 5 })
  const payrolls: number[] = []
  let cap = 0
  for (let season = 0; season < 3; season++) {
    for (;;) if (!d.simDay()) break
    const fins = d.teams().map((t) => d.finance(t.teamId))
    cap = fins[0]?.cap ?? 0
    payrolls.push(fins.reduce((a, f) => a + f.payroll, 0) / fins.length)
    d.finishOffseason()
  }
  for (const [i, pay] of payrolls.entries())
    assert.ok(
      pay > cap * 0.9,
      `season ${i + 1} payroll ${Math.round(pay / 1e6)}M collapsed against a ${Math.round(cap / 1e6)}M cap`,
    )
  assert.ok(
    payrolls.at(-1)! > payrolls[0]! * 0.75,
    `payroll should not drain away: ${payrolls.map((p) => Math.round(p / 1e6)).join(' -> ')}`,
  )
})

// ── the dressing room reaches the summer ─────────────────────────────────────

test('re-signing a man you made unhappy costs more, and only it costs you', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  // One of your own, out of contract this summer.
  const mine = state.league.players.filter((p) => p.teamId === SAS())
  const man = [...mine].sort((a, b) => overall(b.ratings) - overall(a.ratings))[1] as LeaguePlayer
  man.contract = null

  const fa = freeAgentPool(state, yearEnd, potentials).find(
    (p) => p.playerId === man.playerId,
  ) as FreeAgent
  const market = askingPrice(fa, state.season.rules)

  moraleOf(state, man).value = 55
  const content = askingFrom(state, fa, SAS())
  moraleOf(state, man).value = 20
  const sour = askingFrom(state, fa, SAS())
  const elsewhere = askingFrom(state, fa, 'nobody')

  assert.equal(content.amount, market.amount, 'a content man asks his market price')
  assert.ok(
    sour.amount > market.amount * 1.1,
    `a year on the bench should cost you: ${sour.amount} against a market price of ${market.amount}`,
  )
  assert.equal(
    elsewhere.amount,
    market.amount,
    'the premium is yours alone — he signs elsewhere at the going rate',
  )
})

test('a man below the walk-away line will not re-sign with you', { skip }, () => {
  const { state, potentials } = opening()
  const yearEnd = state.season.yearEnd
  const mine = state.league.players.filter((p) => p.teamId === SAS())
  const man = [...mine].sort((a, b) => overall(b.ratings) - overall(a.ratings))[0] as LeaguePlayer
  man.contract = null

  moraleOf(state, man).value = 60
  const staying = freeAgentPool(state, yearEnd, potentials).find((p) => p.playerId === man.playerId)
  assert.equal(staying?.incumbentTeamId, SAS(), 'a happy man is still yours to keep')
  assert.ok((staying?.yearsWithIncumbent ?? 0) > 0, 'and his Bird rights are intact')

  moraleOf(state, man).value = 10
  const leaving = freeAgentPool(state, yearEnd, potentials).find((p) => p.playerId === man.playerId)
  assert.equal(leaving?.incumbentTeamId, null, 'a furious man has made his mind up')
  assert.equal(leaving?.yearsWithIncumbent, 0, 'which costs you the Bird rights that kept him')
})
