// Roles, morale, and the price of stacking a squad.
//
// Every claim the system makes is pinned here: the role a man expects, the terms his number is
// built from, the fact that five stars cannot all be stars, that unhappiness reaches the engine
// through `condition` and costs games, and that it costs money in the summer.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GameInput, GameResult, Position, Ratings, SimulateGame } from '@hoops/core'
import { RATING_KEYS } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import {
  abilityScore,
  askingMultiplier,
  effortOf,
  engagementOf,
  expectedRole,
  moodLabel,
  moraleOf,
  moraleTarget,
  ROLE_MINUTES,
  START_MORALE,
  setMoraleEffects,
  settleMorale,
  squadMood,
  updateMorale,
  wantsOut,
  why,
} from './morale.ts'
import { newGame } from './newgame.ts'
import { simDay, simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, LeaguePlayer } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

function flat(v: number): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, v])) as unknown as Ratings
}

function fresh(seed = 1): GameState {
  return newGame(fixtureBundle({ yearEnd: 2016 }), 'T00', seed)
}

/** Rebuild a club's roster from a spec, so a test can say exactly what kind of squad it is. */
function setRoster(
  state: GameState,
  teamId: string,
  spec: { rating: number; salary: number; pos?: Position }[],
): LeaguePlayer[] {
  state.league.players = state.league.players.filter((p) => p.teamId !== teamId)
  const made: LeaguePlayer[] = spec.map((s, i) => ({
    playerId: `${teamId}-x${i}`,
    name: `${teamId} Man ${i}`,
    pos: s.pos ?? (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5] ?? 'PG',
    age: 26,
    heightIn: 78,
    weightLb: 210,
    yearsPro: 5,
    yearsWithTeam: 2,
    debutYear: 2011,
    teamId,
    contract: {
      teamId,
      kind: 'standard',
      years: [
        { yearEnd: state.season.yearEnd, amount: s.salary, option: null, guaranteed: true },
        { yearEnd: state.season.yearEnd + 1, amount: s.salary, option: null, guaranteed: true },
      ],
      source: 'generated',
    },
    ratings: flat(s.rating),
    tendencies: {
      usage: 0.2,
      shotRim: 0.32,
      shotClose: 0.13,
      shotMid: 0.3,
      shotThree: 0.25,
      assist: 0.2,
      postUp: 0.1,
    },
    mpgHint: 0,
    draft: null,
  }))
  state.league.players.push(...made)
  return made
}

// ── the role a man expects ───────────────────────────────────────────────────

test('a max-salary player expects to be a star; a minimum-salary journeyman does not', () => {
  const state = fresh()
  const cap = state.league.cap
  const year = state.season.yearEnd
  const [maxMan, minMan] = setRoster(state, 'T00', [
    // Ordinary player, paid like a franchise cornerstone.
    { rating: 52, salary: Math.round(cap.cap * 0.3) },
    // The same ordinary player on the minimum.
    { rating: 52, salary: cap.minSalary },
  ])
  assert.equal(expectedRole(maxMan as LeaguePlayer, cap, year), 'star')
  assert.notEqual(expectedRole(minMan as LeaguePlayer, cap, year), 'star')
})

test('a minimum-salary man who is genuinely good still expects to play', () => {
  const state = fresh()
  const [good] = setRoster(state, 'T00', [{ rating: 70, salary: state.league.cap.minSalary }])
  assert.ok(abilityScore(good as LeaguePlayer) >= 70)
  assert.equal(expectedRole(good as LeaguePlayer, state.league.cap, state.season.yearEnd), 'star')
})

test('the four rungs are ordered by ability at a fixed salary', () => {
  const state = fresh()
  const cap = state.league.cap
  const year = state.season.yearEnd
  const men = setRoster(state, 'T00', [
    { rating: 70, salary: cap.minSalary, pos: 'SG' },
    { rating: 60, salary: cap.minSalary, pos: 'SG' },
    { rating: 52, salary: cap.minSalary, pos: 'SG' },
    { rating: 40, salary: cap.minSalary, pos: 'SG' },
  ])
  assert.deepEqual(
    men.map((m) => expectedRole(m, cap, year)),
    ['star', 'starter', 'rotation', 'bench'],
  )
})

// ── the number, and why ──────────────────────────────────────────────────────

test('minutes below what a role expects drag the target down, and the sentence says so', () => {
  const state = fresh()
  const cap = state.league.cap
  const [star] = setRoster(state, 'T00', [{ rating: 70, salary: Math.round(cap.cap * 0.3) }])
  const p = star as LeaguePlayer
  const gp = 30
  const played = (min: number) => {
    state.stats = {
      [p.playerId]: {
        teamId: 'T00',
        gp,
        gs: gp,
        min: min * gp,
        pts: 20 * gp,
        fgm: 0,
        fga: 0,
        fg3m: 0,
        fg3a: 0,
        ftm: 0,
        fta: 0,
        oreb: 0,
        dreb: 0,
        ast: 0,
        stl: 0,
        blk: 0,
        tov: 0,
        pf: 0,
      },
    }
    return moraleTarget(state, p)
  }
  const honoured = played(ROLE_MINUTES.star)
  const buried = played(12)
  assert.ok(
    buried.target < honoured.target - 12,
    `burying a star should cost him: ${buried.target.toFixed(1)} vs ${honoured.target.toFixed(1)}`,
  )
  const term = buried.terms.find((t) => t.key === 'minutes')
  assert.ok(term && term.value < -20, 'the minutes term should be the big one')
  assert.match(why(buried), /12\.0 a night|expects 34/)
})

test('a target is the sum of its named terms and nothing else', () => {
  const state = fresh()
  const [p] = setRoster(state, 'T00', [{ rating: 60, salary: 5_000_000 }])
  const b = moraleTarget(state, p as LeaguePlayer)
  const sum = 50 + b.terms.reduce((a, t) => a + t.value, 0)
  assert.ok(Math.abs(sum - b.target) < 1e-9, `${sum} vs ${b.target}`)
})

test('a contract year and a fresh trade both weigh on a man, and the trade wears off', () => {
  const state = fresh()
  const [p] = setRoster(state, 'T00', [{ rating: 60, salary: 5_000_000 }])
  const man = p as LeaguePlayer
  const settled = moraleTarget(state, man, { sinceTrade: 99 })
  const justMoved = moraleTarget(state, man, { sinceTrade: 0 })
  const halfway = moraleTarget(state, man, { sinceTrade: 10 })
  assert.ok(justMoved.target < halfway.target)
  assert.ok(halfway.target < settled.target)

  man.contract = {
    ...(man.contract as NonNullable<LeaguePlayer['contract']>),
    years: [
      {
        yearEnd: state.season.yearEnd,
        amount: 5_000_000,
        option: null,
        guaranteed: true,
      },
    ],
  }
  const expiring = moraleTarget(state, man)
  assert.ok(expiring.terms.some((t) => t.key === 'contract' && t.value < 0))
})

test('a longer stay at the club is worth something', () => {
  const state = fresh()
  const [p] = setRoster(state, 'T00', [{ rating: 60, salary: 5_000_000 }])
  const man = p as LeaguePlayer
  man.yearsWithTeam = 0
  const rookie = moraleTarget(state, man).target
  man.yearsWithTeam = 6
  const veteran = moraleTarget(state, man).target
  assert.ok(veteran > rookie, `${veteran} should beat ${rookie}`)
})

// ── the whole point: stacking has a price ────────────────────────────────────

test('five stars cannot all be stars: the surplus are told so, two are not', () => {
  const state = fresh()
  const cap = state.league.cap
  const stacked = setRoster(state, 'T00', [
    { rating: 78, salary: Math.round(cap.cap * 0.3), pos: 'SG' },
    { rating: 76, salary: Math.round(cap.cap * 0.3), pos: 'SF' },
    { rating: 74, salary: Math.round(cap.cap * 0.3), pos: 'PG' },
    { rating: 72, salary: Math.round(cap.cap * 0.3), pos: 'PF' },
    { rating: 70, salary: Math.round(cap.cap * 0.3), pos: 'C' },
    ...Array.from({ length: 7 }, () => ({ rating: 40, salary: cap.minSalary })),
  ])
  const crowd = stacked
    .slice(0, 5)
    .map((p) => moraleTarget(state, p).terms.find((t) => t.key === 'crowding')?.value ?? 0)
  assert.deepEqual(crowd.slice(0, 2), [0, 0], 'two men may be the man')
  assert.ok(crowd[2] !== undefined && crowd[2] < 0, 'the third may not')
  assert.ok((crowd[3] as number) < (crowd[2] as number), 'and it gets worse down the list')
  assert.ok((crowd[4] as number) <= (crowd[3] as number))
  assert.match(why(moraleTarget(state, stacked[4] as LeaguePlayer)), /expect to be a star/)

  // The same five men spread over five clubs are all content.
  const spread = fresh()
  for (const [i, t] of ['T00', 'T01', 'T02', 'T03', 'T04'].entries()) {
    setRoster(spread, t, [
      { rating: 78 - i * 2, salary: Math.round(cap.cap * 0.3), pos: 'SG' },
      ...Array.from({ length: 11 }, () => ({ rating: 40, salary: cap.minSalary })),
    ])
  }
  for (const t of ['T00', 'T01', 'T02', 'T03', 'T04']) {
    const p = spread.league.players.find((q) => q.teamId === t) as LeaguePlayer
    const term = moraleTarget(spread, p).terms.find((x) => x.key === 'crowding')
    assert.equal(term, undefined, `${t}'s star should have no crowding term`)
  }
})

test('a stacked squad ends a season unhappier than a balanced one of the same talent', () => {
  const state = fresh()
  const cap = state.league.cap
  const mid = Math.round(cap.cap * 0.12)
  // Equal total ability, twelve men each: five stars and seven scrubs against twelve starters.
  setRoster(state, 'T00', [
    ...Array.from({ length: 5 }, (_, i) => ({
      rating: 76 - i,
      salary: Math.round(cap.cap * 0.3),
    })),
    ...Array.from({ length: 7 }, () => ({ rating: 41, salary: cap.minSalary })),
  ])
  // A real squad is a ladder, not a clone army: twelve men whose pay tracks what they are.
  setRoster(
    state,
    'T01',
    [64, 62, 60, 58, 56, 54, 52, 50, 48, 46, 44, 42].map((r) => ({
      rating: r,
      salary: Math.round(mid * ((r - 38) / 26)),
    })),
  )
  const stackedTalent = state.league.players
    .filter((p) => p.teamId === 'T00')
    .reduce((a, p) => a + abilityScore(p), 0)
  const balancedTalent = state.league.players
    .filter((p) => p.teamId === 'T01')
    .reduce((a, p) => a + abilityScore(p), 0)
  assert.ok(
    Math.abs(stackedTalent - balancedTalent) < 60,
    `the two squads must be comparable: ${stackedTalent.toFixed(0)} vs ${balancedTalent.toFixed(0)}`,
  )

  const played = simRestOfSeason(state, hooks).state
  const stacked = squadMood(played, 'T00')
  const balanced = squadMood(played, 'T01')
  assert.ok(
    stacked.average < balanced.average - 6,
    `stacking should cost: ${stacked.average.toFixed(1)} vs ${balanced.average.toFixed(1)}`,
  )
  assert.ok(stacked.unhappy >= 1, `expected an unhappy dressing room, got ${stacked.unhappy}`)
  const worst = stacked.worst[0] as { value: number; why: string }
  assert.ok(worst.value < 36, `the surplus star should be unhappy, got ${worst.value.toFixed(1)}`)
  assert.ok(
    worst.value < balanced.average - 15,
    `and far below anyone on the balanced squad: ${worst.value.toFixed(1)} vs ${balanced.average.toFixed(1)}`,
  )
  assert.match(worst.why, /expect to be a star/)
  assert.ok(balanced.unhappy < stacked.unhappy)
  assert.match(stacked.summary, /unhappy/)
})

// ── it reaches the floor ─────────────────────────────────────────────────────

test('effort is 1 at the neutral number, rises with happiness and falls with misery', () => {
  assert.equal(effortOf(START_MORALE), 1)
  assert.ok(effortOf(90) > 1)
  assert.ok(effortOf(20) < 1)
  // Monotone, and bounded at both ends so nothing can run away.
  for (let v = 0; v < 100; v++) assert.ok(effortOf(v + 1) >= effortOf(v))
  assert.ok(effortOf(0) >= 0.8 && effortOf(100) <= 1.1)
})

test('a man who has stopped asking for the ball hands his shots to whoever is next to him', () => {
  // `condition` alone is inside a fatigue loop: a flat squad plays fewer hard minutes, recovers
  // more, and over a season the condition the engine sees barely moves. Engagement is the lever
  // that does not come back, and it is the recognisable thing an unhappy man does.
  assert.equal(engagementOf(START_MORALE), 1)
  assert.ok(engagementOf(20) < 0.9, `${engagementOf(20)}`)
  assert.ok(engagementOf(95) > 1)
  assert.ok(engagementOf(0) >= 0.8 && engagementOf(100) <= 1.05, 'and it is bounded')
  for (let v = 0; v < 100; v++) assert.ok(engagementOf(v + 1) >= engagementOf(v))

  const state = fresh()
  setRoster(state, 'T00', [{ rating: 70, salary: state.league.cap.minSalary }])
  const p = state.league.players.find((q) => q.teamId === 'T00') as LeaguePlayer
  const base = p.tendencies.usage
  let seen: number | null = null
  const spy: SimulateGame = (input, seed) => {
    for (const side of [input.home, input.away])
      for (const q of side.players)
        if (q.playerId === p.playerId && seen === null) seen = q.tendencies.usage
    return fakeEngine(input, seed) as GameResult
  }
  moraleOf(state, p).value = 10
  setMoraleEffects(true)
  simRestOfSeason(structuredClone(state), { engine: spy })
  assert.ok(seen != null && seen < base * 0.9, `usage should fall: ${seen} from ${base}`)
  // His skill is untouched. He is as good as he ever was; he just isn't asking.
  const ratingSpy: SimulateGame = (input, seed) => {
    for (const side of [input.home, input.away])
      for (const q of side.players)
        if (q.playerId === p.playerId) assert.deepEqual(q.ratings, p.ratings)
    return fakeEngine(input, seed) as GameResult
  }
  simRestOfSeason(structuredClone(state), { engine: ratingSpy })
})

test('morale reaches the engine through condition, and only through condition', () => {
  const state = fresh()
  const seen: GameInput[] = []
  const spy: SimulateGame = (input, seed) => {
    seen.push(structuredClone(input) as GameInput)
    return fakeEngine(input, seed) as GameResult
  }
  const cap = state.league.cap
  setRoster(state, 'T00', [
    ...Array.from({ length: 5 }, (_, i) => ({
      rating: 76 - i,
      salary: Math.round(cap.cap * 0.3),
    })),
    ...Array.from({ length: 7 }, () => ({ rating: 41, salary: cap.minSalary })),
  ])
  const played = simRestOfSeason(state, { engine: spy }).state
  const mine = seen.filter((i) => i.home.teamId === 'T00' || i.away.teamId === 'T00')
  const last = mine.at(-1) as GameInput
  const side = last.home.teamId === 'T00' ? last.home : last.away
  // The surplus stars finish the year unhappy, and their condition arrives at the engine scaled.
  const worst = squadMood(played, 'T00').worst[0]
  assert.ok(worst && worst.value < 40, `expected an unhappy man, got ${worst?.value}`)
  const line = side.players.find((p) => p.playerId === worst.playerId)
  assert.ok(line, 'the unhappy man should be in the game input')
  assert.ok(
    (line as { condition: number }).condition < 0.97,
    `an unhappy man should arrive flat, got ${(line as { condition: number }).condition}`,
  )
  // Nothing else about him was touched: the engine still sees his real ratings.
  const real = played.league.players.find((p) => p.playerId === worst.playerId) as LeaguePlayer
  assert.deepEqual((line as { ratings: Ratings }).ratings, real.ratings)
})

test('a squad that plays for the manager beats the same squad that does not', () => {
  // An engine that reads condition and nothing else, so the measurement is of the plumbing rather
  // than of the real engine's shooting model. What the real engine makes of it is in the report:
  // the same 2003-04 roster at morale 25 loses about 12 games in 82 to itself at morale 55.
  const conditionEngine: SimulateGame = (input, seed) => {
    const fit = (side: GameInput['home']) => {
      let s = 0
      let m = 0
      for (const p of side.players) {
        s += p.condition * p.minutesTarget
        m += p.minutesTarget
      }
      return m > 0 ? s / m : 1
    }
    const r = fakeEngine(input, seed) as GameResult
    const home = Math.round(r.home.pts * (1 + (fit(input.home) - 1) * 3))
    const away = Math.round(r.away.pts * (1 + (fit(input.away) - 1) * 3))
    return {
      ...r,
      home: { ...r.home, pts: home },
      away: { ...r.away, pts: away },
      winner: home > away ? 'home' : 'away',
    }
  }

  const hooks2: GameHooks = { engine: conditionEngine }

  const wins = (pinned: number): number => {
    let state = fresh(7)
    const cap = state.league.cap
    // Twelve interchangeable men, so nothing but the mood can separate the two runs.
    setRoster(
      state,
      'T00',
      Array.from({ length: 12 }, () => ({ rating: 56, salary: Math.round(cap.cap * 0.06) })),
    )
    setMoraleEffects(true)
    // Pin the room between days. `simDay` hands the state back, so a test can hold one mood all
    // year and read off what it was worth — which is not something the game itself ever does.
    for (let guard = 0; guard < 400 && state.phase === 'regular'; guard++) {
      for (const p of state.league.players) {
        if (p.teamId === 'T00') moraleOf(state, p).value = pinned
      }
      const out = simDay(state, hooks2)
      if (out.state.calendar.date === state.calendar.date && out.results.length === 0) break
      state = out.state
    }
    return state.records.T00?.wins ?? 0
  }

  const happy = wins(85)
  const miserable = wins(15)
  assert.ok(
    happy > miserable + 3,
    `a happy squad should be worth games: ${happy} vs ${miserable} wins`,
  )
})

test('the harness switch takes the dressing room out of the engine entirely', () => {
  const state = fresh()
  setRoster(state, 'T00', [{ rating: 70, salary: state.league.cap.minSalary }])
  const p = state.league.players.find((q) => q.teamId === 'T00') as LeaguePlayer
  moraleOf(state, p).value = 5
  // Opening night, when everybody is fit: the only thing that can move his condition is his mood.
  const firstCondition = (): number => {
    let seen: number | null = null
    const spy: SimulateGame = (input, seed) => {
      for (const side of [input.home, input.away])
        for (const q of side.players)
          if (q.playerId === p.playerId && seen === null) seen = q.condition
      return fakeEngine(input, seed) as GameResult
    }
    simRestOfSeason(structuredClone(state), { engine: spy })
    return seen ?? Number.NaN
  }
  setMoraleEffects(false)
  const off = firstCondition()
  setMoraleEffects(true)
  const on = firstCondition()
  assert.equal(off, 1, 'with the switch off a furious man is simply as fit as he is')
  assert.ok(Math.abs(on - effortOf(5)) < 1e-9, `with it on he arrives at ${on}`)
})

// ── it costs money in the summer ─────────────────────────────────────────────

test('an unhappy man wants a premium to re-sign, a happy one takes a little less', () => {
  assert.equal(askingMultiplier(START_MORALE), 1)
  assert.ok(askingMultiplier(20) > 1.15, `${askingMultiplier(20)}`)
  assert.ok(askingMultiplier(90) < 1)
  assert.ok(askingMultiplier(0) <= 1.3, 'and it is bounded')
})

test('below the walk-away line he has made his mind up', () => {
  assert.equal(wantsOut(START_MORALE), false)
  assert.equal(wantsOut(40), false)
  assert.equal(wantsOut(10), true)
  // The boundary is where the label turns, so a screen and the market never disagree.
  assert.equal(moodLabel(10), 'furious')
})

// ── housekeeping ─────────────────────────────────────────────────────────────

test('a save written before the dressing room existed still loads and starts keeping one', () => {
  const state = fresh()
  delete state.morale
  const p = state.league.players[0] as LeaguePlayer
  const m = moraleOf(state, p)
  assert.equal(m.value, START_MORALE)
  assert.ok(state.morale)
  // And a whole season runs off it without complaint.
  const played = simRestOfSeason(state, hooks).state
  assert.ok(Object.keys(played.morale ?? {}).length > 100)
})

test('morale survives a round trip through JSON, like everything else in the save', () => {
  const state = fresh()
  updateMorale(state, 'T00')
  const back = JSON.parse(JSON.stringify(state)) as GameState
  assert.deepEqual(back.morale, state.morale)
})

test('a summer calms the room without wiping it', () => {
  const state = fresh()
  const p = state.league.players[0] as LeaguePlayer
  moraleOf(state, p).value = 5
  settleMorale(state)
  const after = (state.morale as Record<string, { value: number }>)[p.playerId]?.value ?? 0
  assert.ok(after > 5 && after < START_MORALE, `expected a partial thaw, got ${after}`)
  assert.equal(Object.keys(state.morale ?? {}).length, state.league.players.length)
})

test('the room summary names the worst man and what is wrong', () => {
  const state = fresh()
  const cap = state.league.cap
  setRoster(state, 'T00', [
    ...Array.from({ length: 5 }, (_, i) => ({
      rating: 76 - i,
      salary: Math.round(cap.cap * 0.3),
    })),
    ...Array.from({ length: 7 }, () => ({ rating: 41, salary: cap.minSalary })),
  ])
  const played = simRestOfSeason(state, hooks).state
  const mood = squadMood(played, 'T00')
  assert.ok(mood.worst.length > 0)
  const worst = mood.worst[0] as { name: string; why: string }
  assert.ok(mood.summary.includes(worst.name), mood.summary)
  assert.ok(worst.why.length > 10 && worst.why.endsWith('.'), worst.why)
})
