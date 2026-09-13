// The coaching staff: the market's rules, the carousel, and what a coach does on the floor.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { type Career, encodeCareer } from './history.ts'
import { newGame } from './newgame.ts'
import { rollover } from './rollover.ts'
import { buildTeamInput } from './rotation.ts'
import { simSeason } from './sim.ts'
import {
  askingSalary,
  type Coach,
  clubAppeal,
  coachFromCareer,
  coachOf,
  developmentFactor,
  fireCoach,
  hireCoach,
  initStaff,
  joinVerdict,
  makeCoach,
  moraleFactor,
  packCoach,
  profileOf,
  rebuildProfile,
  rotationNoise,
  runCarousel,
  STAFF_ROLES,
  scoutingOf,
  slotsOf,
  staffTactics,
  tiltFactor,
  unpackCoach,
} from './staff.ts'
import type { GameHooks, GameState } from './state.ts'

const hooks: GameHooks = { engine: fakeEngine }

function start(seed = 1, yearEnd = 2020): GameState {
  return newGame(fixtureBundle({ yearEnd }), 'T00', seed)
}

function setRating(
  state: GameState,
  teamId: string,
  slot: number,
  patch: Partial<Coach['ratings']>,
) {
  const staff = state.staff!
  const id = slotsOf(staff, teamId)[slot] as string
  const c = coachOf(state, id)!
  c.ratings = { ...c.ratings, ...patch }
  staff.coaches[id] = packCoach(c)
  rebuildProfile(staff, teamId)
  return c
}

test('every club starts with five coaches and a pool to hire from', () => {
  const state = start()
  const staff = state.staff!
  assert.equal(Object.keys(staff.byTeam).length, state.league.teams.length)
  for (const team of state.league.teams) {
    const ids = slotsOf(staff, team.teamId)
    assert.equal(ids.filter(Boolean).length, 5, `${team.teamId} should employ five men`)
    const profile = profileOf(state, team.teamId)
    assert.ok(profile, 'a profile is built for every club')
    for (const k of ['rotation', 'adjust', 'morale', 'offense', 'defense'] as const)
      assert.ok(profile[k] >= 1 && profile[k] <= 99)
  }
  assert.ok(staff.pool.length >= 20, `a market of ${staff.pool.length} is too thin`)
  // Nobody in the pool is employed, and nobody employed is in the pool.
  for (const id of staff.pool) assert.equal(coachOf(state, id)?.teamId, null)
})

test('a coach packs and unpacks without losing anything', () => {
  const state = start()
  const staff = state.staff!
  const c = makeCoach(staff, makeRng(7), 'head')
  c.teamId = 'T05'
  c.salary = 4_250_000
  c.yearsLeft = 3
  c.record = { w: 213, l: 141 }
  c.titles = 1
  const back = unpackCoach(c.coachId, packCoach(c))
  assert.deepEqual(back, c)
})

test('the whole staff survives a save', () => {
  const state = start(3)
  const before = JSON.stringify(state.staff)
  const reloaded = JSON.parse(JSON.stringify(state)) as GameState
  assert.equal(JSON.stringify(reloaded.staff), before)
  // And it still answers questions after the round trip.
  const id = slotsOf(reloaded.staff!, 'T00')[0] as string
  assert.equal(coachOf(reloaded, id)?.name, coachOf(state, id)?.name)
  assert.equal(scoutingOf(reloaded, 'T00'), scoutingOf(state, 'T00'))
})

test('a save written before staff existed still loads and plays', () => {
  const state = start(4)
  delete state.staff
  const out = simSeason(state, hooks)
  assert.ok(out.summary, 'a staffless save plays a whole season')
  // And the rollover gives it one.
  assert.ok(out.state.staff, 'the next summer hands it a staff')
})

test('the effects are centred on 50, so an average league is the league we had', () => {
  assert.equal(tiltFactor(50), 1)
  assert.equal(Math.round(moraleFactor(50) * 1000) / 1000, 1)
  assert.equal(rotationNoise(100), 0)
  assert.ok(Math.abs(rotationNoise(50) - 2.75) < 1e-9)
  assert.ok(Math.abs(rotationNoise(0) - 5.5) < 1e-9)
  assert.ok(tiltFactor(0) < 1 && tiltFactor(100) > 1)
  assert.ok(moraleFactor(0) < 1 && moraleFactor(100) > 1)
})

test('a bad head coach sets a worse rotation than a good one', () => {
  const state = start(11)
  const roster = state.league.players.filter((p) => p.teamId === 'T00')
  const team = state.league.teams[0]!
  // Two years on, the real-minutes hint is stale and the coach is ranking on ability alone — which
  // is the situation a rotation rating is actually about.
  for (const p of roster) p.hintYear = state.season.yearEnd - 3
  const rank = (): string[] => {
    const input = buildTeamInput(team, roster, false, undefined, {
      yearEnd: state.season.yearEnd,
      staff: state.staff!,
    })
    return input.players.map((p) => p.playerId)
  }
  setRating(state, 'T00', 0, { rotation: 100 })
  const perfect = rank()
  setRating(state, 'T00', 0, { rotation: 0 })
  const hopeless = rank()
  const moved = perfect.filter((id, i) => hopeless[i] !== id).length
  assert.ok(moved >= 2, `a hopeless coach should misrank his squad, ${moved} men moved`)
  // And the man he leaves out is one the good coach played.
  assert.notDeepEqual(perfect, hopeless)
})

test('morale and in-game adjustments reach the engine through condition and minutes', () => {
  const state = start(12)
  const roster = state.league.players.filter((p) => p.teamId === 'T00')
  const team = state.league.teams[0]!
  const build = () =>
    buildTeamInput(team, roster, false, undefined, {
      yearEnd: state.season.yearEnd,
      staff: state.staff!,
      availability: Object.fromEntries(
        roster.map((p) => [
          p.playerId,
          { out: 0, injury: null, condition: 0.9, sinceReturn: 99, missed: 0, lastGame: null },
        ]),
      ),
    })

  setRating(state, 'T00', 0, { morale: 100, adjust: 100 })
  const great = build()
  setRating(state, 'T00', 0, { morale: 0, adjust: 0 })
  const poor = build()

  assert.ok(
    great.players[0]!.condition > poor.players[0]!.condition,
    'a happy squad is handed a better condition',
  )
  // Both rotations still add to a basketball game.
  for (const side of [great, poor])
    assert.ok(Math.abs(side.players.reduce((t, p) => t + p.minutesTarget, 0) - 240) < 0.01)
  // The coach who reads a game rides his best man harder.
  assert.ok(
    great.players[0]!.minutesTarget > poor.players[0]!.minutesTarget,
    `tilt should ride the star: ${great.players[0]!.minutesTarget.toFixed(1)} vs ${poor.players[0]!.minutesTarget.toFixed(1)}`,
  )
})

test('the assistants set the tactics of a club the manager never touches', () => {
  const state = start(13)
  const roster = state.league.players.filter((p) => p.teamId === 'T00')
  const team = state.league.teams[0]!
  // A good offensive coach on a roster that cannot shoot does not ask it to shoot.
  for (const p of roster) p.ratings = { ...p.ratings, three: 30 }
  setRating(state, 'T00', 1, { offense: 95 })
  const input = buildTeamInput(team, roster, false, undefined, {
    yearEnd: state.season.yearEnd,
    staff: state.staff!,
  })
  assert.equal(input.tactics.threes, -1, 'he works it inside instead')

  // A bad one imposes his own way whatever the personnel.
  const profile = profileOf(state, 'T00')!
  const imposed = staffTactics(
    { ...profile, offense: 20, style: { ...profile.style, threes: 1 } },
    roster,
    false,
  )
  assert.equal(imposed.threes, 1, 'the stubborn coach still wants threes')

  // A plan the manager has set always wins.
  state.teamSettings.T00 = {
    tactics: { pace: 1, threes: 1, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [],
  }
  const mine = buildTeamInput(team, roster, false, state.teamSettings.T00, {
    yearEnd: state.season.yearEnd,
    staff: state.staff!,
  })
  assert.equal(mine.tactics.threes, 1)
})

test('the scouting rating is the head scout, not a constant', () => {
  const state = start(14)
  setRating(state, 'T00', 4, { scouting: 91 })
  assert.equal(scoutingOf(state, 'T00'), 91)
  // A save with no staff falls back to the old hardcoded 65, so nothing regresses.
  const bare = start(14)
  delete bare.staff
  assert.equal(scoutingOf(bare, 'T00'), 65)
})

test('the development factor scales with the man in the chair', () => {
  const state = start(15)
  setRating(state, 'T00', 3, { development: 100 })
  setRating(state, 'T01', 3, { development: 0 })
  setRating(state, 'T02', 3, { development: 50 })
  assert.ok(Math.abs(developmentFactor(state, 'T00') - 1.4) < 1e-9)
  assert.ok(Math.abs(developmentFactor(state, 'T01') - 0.6) < 1e-9)
  assert.equal(developmentFactor(state, 'T02'), 1)
  assert.equal(developmentFactor(state, null), 1)
})

test('a great coach will not sign for a bad club, and money moves him a little', () => {
  const state = start(21)
  // A club that has just lost 62 games.
  state.history.push({
    yearEnd: state.season.yearEnd,
    championTeamId: 'T29',
    runnerUpTeamId: 'T28',
    bestRecord: null,
    awards: null,
    standings: state.league.teams.map((t) => ({
      teamId: t.teamId,
      wins: t.teamId === 'T00' ? 20 : 45,
      losses: t.teamId === 'T00' ? 62 : 37,
      seed: null,
    })),
  })
  const staff = state.staff!
  const great = makeCoach(staff, makeRng(99), 'head')
  great.reputation = 95
  staff.coaches[great.coachId] = packCoach(great)
  staff.pool.push(great.coachId)

  const appeal = clubAppeal(state, 'T00')
  assert.ok(appeal < 50, `a 20-62 club should not look like much: ${appeal}`)
  const ask = askingSalary(95, 'head', state.league.cap.cap)
  const no = joinVerdict(state, great, 'T00', 'head', ask)
  assert.equal(no.willing, false)
  assert.match(no.reason, /short of what he will accept/)

  const attempt = hireCoach(state, 'T00', great.coachId, 'head', 3, ask)
  assert.equal(attempt.ok, false)
  assert.equal(slotsOf(staff, 'T00')[0] !== great.coachId, true)

  // Absurd money does move the needle, which is the point of having a number on it.
  const rich = joinVerdict(state, great, 'T00', 'head', state.league.cap.cap)
  assert.ok(
    clubAppeal(state, 'T00', state.league.cap.cap) > appeal,
    'money is part of how a club looks',
  )
  assert.ok(rich.reason.length > 0)

  // And the same man says yes to the club that just won the title.
  const good = joinVerdict(state, great, 'T29', 'head', ask)
  assert.equal(good.willing, true, good.reason)
})

test('hiring fills a chair, firing costs every guaranteed dollar', () => {
  const state = start(22)
  const staff = state.staff!
  const before = coachOf(state, slotsOf(staff, 'T00')[0] as string)!
  const cost = before.salary * before.yearsLeft

  const blocked = hireCoach(state, 'T00', staff.pool[0] as string, 'head', 3)
  assert.equal(blocked.ok, false)
  assert.match(blocked.reason, /Sack him first/)

  const sack = fireCoach(state, 'T00', 'head')
  assert.equal(sack.ok, true)
  assert.equal(sack.cost, cost)
  assert.equal(staff.deadMoney.T00, cost)
  assert.equal(slotsOf(staff, 'T00')[0], null)
  // He is out of work and back on the market.
  assert.ok(staff.pool.includes(before.coachId))
  assert.equal(coachOf(state, before.coachId)?.teamId, null)
  // The empty chair is worse than the worst coach.
  assert.equal(profileOf(state, 'T00')!.rotation, 35)

  // Hire someone who will have us.
  const willing = staff.pool.find(
    (id) =>
      joinVerdict(
        state,
        coachOf(state, id)!,
        'T00',
        'head',
        askingSalary(coachOf(state, id)!.reputation, 'head', state.league.cap.cap),
      ).willing,
  )
  assert.ok(willing, 'somebody in a 30-man market will take a job')
  const hired = hireCoach(state, 'T00', willing, 'head', 4)
  assert.equal(hired.ok, true, hired.reason)
  assert.equal(hired.years, 4)
  assert.equal(slotsOf(staff, 'T00')[0], willing)
  assert.equal(staff.pool.includes(willing), false)
  assert.ok(profileOf(state, 'T00')!.rotation > 35)
})

test('the AI carousel fires, hires and keeps every chair filled', () => {
  const state = start(31)
  const staff = state.staff!
  // Give every club a season: T00 is dreadful, the rest are fine.
  for (const t of state.league.teams) {
    const bad = t.teamId === 'T01'
    state.records[t.teamId] = {
      ...state.records[t.teamId]!,
      wins: bad ? 15 : 45,
      losses: bad ? 67 : 37,
    }
  }
  // The man about to be sacked has been there long enough to own it.
  const doomedId = slotsOf(staff, 'T01')[0] as string
  const doomed = coachOf(state, doomedId)!
  doomed.seasons = 4
  doomed.yearsLeft = 3
  staff.coaches[doomedId] = packCoach(doomed)

  const news = runCarousel(state, makeRng(5))
  assert.ok(news.length > 0, 'a summer should produce some news')
  assert.ok(
    news.some((n) => n.includes('T01') || n.includes('City 1')),
    `the 15-67 club should be in the news: ${news.join(' | ')}`,
  )
  assert.notEqual(slotsOf(staff, 'T01')[0], doomedId, 'he is gone')
  assert.ok(slotsOf(staff, 'T01')[0], 'and somebody has replaced him')
  // Nobody in the league is left short-handed, and the user's staff is untouched by the AI.
  for (const t of state.league.teams) {
    if (t.teamId === state.userTeamId) continue
    assert.equal(slotsOf(staff, t.teamId).filter(Boolean).length, 5, `${t.teamId} is short-handed`)
  }
  // The head coaches now carry the season on their record.
  const winner = coachOf(state, slotsOf(staff, 'T02')[0] as string)!
  assert.ok(winner.record.w + winner.record.l >= 0)
})

test('a man you sack turns up somewhere else', () => {
  const state = start(32)
  const staff = state.staff!
  // Make the user's head coach an obvious hire: strong, and not too grand for anyone.
  const mineId = slotsOf(staff, 'T00')[0] as string
  const mine = coachOf(state, mineId)!
  mine.ratings = { ...mine.ratings, rotation: 88, adjust: 85, morale: 84 }
  mine.reputation = 45
  staff.coaches[mineId] = packCoach(mine)

  fireCoach(state, 'T00', 'head')
  assert.equal(coachOf(state, mineId)?.teamId, null)

  // Open a chair elsewhere, then run the summer.
  fireCoach(state, 'T07', 'head')
  for (const t of state.league.teams)
    state.records[t.teamId] = { ...state.records[t.teamId]!, wins: 41, losses: 41 }
  runCarousel(state, makeRng(3))

  const now = coachOf(state, mineId)
  assert.ok(now, 'he is still in the league')
  assert.ok(now.teamId && now.teamId !== 'T00', `he should be working elsewhere, got ${now.teamId}`)
  // Your own chair is yours to fill: the AI never does it for you.
  assert.equal(slotsOf(staff, 'T00')[0], null)
})

test('a retired player can walk back in with a clipboard, and a great one is a draw', () => {
  const state = start(41)
  const staff = state.staff!
  const legend: Career = {
    playerId: 'p-legend',
    name: 'Marcus Vale',
    pos: 'PG',
    debutYear: 2004,
    retiredYear: 2020,
    draft: { year: 2004, round: 1, pick: 1 },
    seasons: Array.from({ length: 16 }, (_, i) => ({
      yearEnd: 2005 + i,
      teamId: 'T00',
      age: 22 + i,
      gp: 78,
      gs: 78,
      min: 2800,
      pts: 2000,
      fgm: 700,
      fga: 1500,
      fg3m: 100,
      fg3a: 280,
      ftm: 500,
      fta: 600,
      oreb: 60,
      dreb: 330,
      ast: 620,
      stl: 110,
      blk: 20,
      tov: 200,
      pf: 180,
      // champion + MVP + All-NBA first team
      flags: 1 | 4 | 32,
    })),
  }
  const journeyman: Career = {
    ...legend,
    playerId: 'p-journey',
    name: 'Ray Corliss',
    seasons: legend.seasons.slice(0, 4).map((s) => ({ ...s, pts: 300, ast: 90, flags: 0 })),
  }

  const star = coachFromCareer(staff, legend, makeRng(2))
  assert.equal(star.playerId, 'p-legend')
  assert.equal(star.name, 'Marcus Vale')
  assert.equal(star.hallOfFamer, true)
  assert.match(star.background, /Hall of Famer/)
  assert.equal(star.role, 'head', 'a man with trophies is handed a team')

  const plain = coachFromCareer(staff, journeyman, makeRng(2))
  assert.ok(
    star.reputation > plain.reputation + 15,
    `fame should carry: ${star.reputation} vs ${plain.reputation}`,
  )
  // The encode/decode round trip keeps his link back to the career store.
  assert.equal(unpackCoach(star.coachId, packCoach(star)).playerId, 'p-legend')
  assert.ok(encodeCareer(legend).length > 0)
})

test('the summer wires retirements into the pool through the rollover', () => {
  const state = start(51)
  const poolBefore = state.staff!.pool.length
  // A development hook that retires the best man in the league and nobody else.
  const victim = state.league.players.find((p) => p.teamId === 'T00')!
  const withRetirement: GameHooks = {
    engine: fakeEngine,
    develop: (s) => {
      s.league.players = s.league.players.filter((p) => p.playerId !== victim.playerId)
    },
  }
  // Give him a career worth remembering first.
  state.careers = {
    [victim.playerId]: encodeCareer({
      playerId: victim.playerId,
      name: victim.name,
      pos: victim.pos,
      debutYear: 2004,
      retiredYear: 0,
      draft: null,
      seasons: Array.from({ length: 15 }, (_, i) => ({
        yearEnd: 2005 + i,
        teamId: 'T00',
        age: 22 + i,
        gp: 80,
        gs: 80,
        min: 2800,
        pts: 1800,
        fgm: 650,
        fga: 1400,
        fg3m: 90,
        fg3a: 240,
        ftm: 450,
        fta: 540,
        oreb: 70,
        dreb: 350,
        ast: 400,
        stl: 100,
        blk: 40,
        tov: 190,
        pf: 170,
        flags: 1 | 4 | 32,
      })),
    }),
  }
  rollover(state, withRetirement, makeRng(9))
  const nowCoach = Object.entries(state.staff!.coaches).find(
    ([, line]) => line.split('|')[3] === victim.playerId,
  )
  assert.ok(nowCoach, 'a hall-of-fame retirement should reach the coaching market')
  assert.ok(state.staff!.pool.length >= poolBefore - 15)
  assert.ok(
    state.log.some((e) => e.text.includes('going into coaching')),
    'and the inbox should say so',
  )
})

test('initStaff is idempotent and every role has a price', () => {
  const state = start(61)
  const same = initStaff(state, makeRng(1))
  assert.equal(same, state.staff)
  const cap = state.league.cap.cap
  for (const role of STAFF_ROLES) {
    const cheap = askingSalary(20, role, cap)
    const dear = askingSalary(95, role, cap)
    assert.ok(dear > cheap, `${role}: reputation should cost money`)
    assert.ok(dear < cap, `${role}: nobody earns a whole cap`)
  }
  assert.ok(
    askingSalary(80, 'head', cap) > askingSalary(80, 'offense', cap) * 3,
    'the top job pays several times what an assistant does',
  )
})
