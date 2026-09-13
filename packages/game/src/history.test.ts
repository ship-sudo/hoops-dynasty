import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import type { HistoryBundle, Ratings, SeasonBundle } from '@hoops/core'
import { RATING_KEYS } from '@hoops/core'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import {
  allCareers,
  careerOf,
  decodeCareer,
  encodeCareer,
  FLAG,
  franchiseLeaders,
  franchiseRank,
  franchiseSeasons,
  hofScore,
  isNotable,
  isOneClubMan,
  leagueRecords,
  MAX_FAREWELLS,
  peakSeason,
  totalsOf,
} from './history.ts'
import { newGame } from './newgame.ts'
import { simSeason } from './sim.ts'
import type { GameHooks, GameState } from './state.ts'

/**
 * A league that turns over: men retire in their thirties and a draft class replaces them, which is
 * the only way a career, a retirement and a hall of fame can be tested at all.
 */
const TENDENCIES = {
  usage: 0.2,
  shotRim: 0.32,
  shotClose: 0.13,
  shotMid: 0.3,
  shotThree: 0.25,
  assist: 0.2,
  postUp: 0.1,
}

const hooks: GameHooks = {
  engine: fakeEngine,
  prospects: ({ yearEnd, count }) =>
    Array.from({ length: count }, (_, i) => {
      const level = 58 - i * 0.35
      const ratings = Object.fromEntries(
        RATING_KEYS.map((k) => [k, Math.max(5, Math.round(level))]),
      ) as unknown as Ratings
      return {
        prospectId: `D${yearEnd}-${i}`,
        name: `Rookie ${yearEnd}-${i}`,
        pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5] ?? 'PG',
        age: 20,
        heightIn: 78,
        weightLb: 210,
        ratings,
        tendencies: TENDENCIES,
      }
    }),
  develop: (state) => {
    state.league.players = state.league.players.filter((p) => p.age <= 31)
  },
}

function run(seasons: number, seed = 7): GameState {
  let state = newGame(fixtureBundle({ seed }), 'T00', seed)
  for (let i = 0; i < seasons; i++) state = simSeason(state, hooks).state
  return state
}

test('a packed career survives a round trip', () => {
  const career = {
    playerId: 'p1',
    name: 'Bob | Smith; Jr, III',
    pos: 'PF',
    debutYear: 2001,
    retiredYear: 2014,
    draft: { year: 2000, round: 1, pick: 3 },
    seasons: [
      {
        yearEnd: 2001,
        teamId: 'T04',
        age: 21,
        gp: 80,
        gs: 41,
        min: 2100.4,
        pts: 1200,
        fgm: 440,
        fga: 900,
        fg3m: 30,
        fg3a: 90,
        ftm: 290,
        fta: 360,
        oreb: 120,
        dreb: 380,
        ast: 190,
        stl: 70,
        blk: 55,
        tov: 150,
        pf: 210,
        flags: FLAG.champion | FLAG.allNba2,
      },
    ],
  }
  const back = decodeCareer('p1', encodeCareer(career))
  assert.equal(back.name, 'Bob   Smith  Jr  III', 'separators are scrubbed out of names')
  assert.equal(back.pos, 'PF')
  assert.equal(back.debutYear, 2001)
  assert.equal(back.retiredYear, 2014)
  assert.deepEqual(back.draft, { year: 2000, round: 1, pick: 3 })
  assert.equal(back.seasons.length, 1)
  assert.equal(back.seasons[0]?.min, 2100, 'minutes round to whole numbers')
  assert.equal(back.seasons[0]?.pts, 1200)
  assert.equal(back.seasons[0]?.teamId, 'T04')
  assert.ok((back.seasons[0]?.flags ?? 0) & FLAG.champion)
  assert.ok((back.seasons[0]?.flags ?? 0) & FLAG.allNba2)
})

test('an undrafted career with no seasons round-trips to nothing', () => {
  const back = decodeCareer(
    'p2',
    encodeCareer({
      playerId: 'p2',
      name: 'Nobody',
      pos: 'C',
      debutYear: 2010,
      retiredYear: 0,
      draft: null,
      seasons: [],
    }),
  )
  assert.equal(back.draft, null)
  assert.deepEqual(back.seasons, [])
})

test('every season played is written into the save and stays there', () => {
  const state = run(4)
  const careers = allCareers(state)
  assert.ok(careers.length >= 30 * 12, 'everyone who played has a career')

  const withFour = careers.filter((c) => c.seasons.length === 4)
  assert.ok(withFour.length > 0, 'men who lasted four years have four lines')

  // Years are distinct and ascending, and nothing is written twice.
  for (const c of careers) {
    const years = c.seasons.map((s) => s.yearEnd)
    assert.deepEqual(
      years,
      [...years].sort((a, b) => a - b),
      `${c.name} is in order`,
    )
    assert.equal(new Set(years).size, years.length, `${c.name} has no duplicate seasons`)
    for (const s of c.seasons) assert.ok(s.gp > 0 && s.min > 0, 'a written season was played')
  }

  // And it really is in the save, not in a closure: JSON is the whole contract.
  const reloaded = JSON.parse(JSON.stringify(state)) as GameState
  assert.deepEqual(allCareers(reloaded).length, careers.length)
  assert.equal(
    careerOf(reloaded, careers[0]?.playerId ?? '')?.seasons.length,
    careers[0]?.seasons.length,
  )
})

test('a season carries the badges it was won with', () => {
  const state = run(3)
  const champions = state.history.map((h) => h.championTeamId)
  let titles = 0
  let allNba = 0
  for (const c of allCareers(state)) {
    for (const s of c.seasons) {
      if (s.flags & FLAG.champion) {
        titles++
        assert.equal(champions[s.yearEnd - (state.history[0]?.yearEnd ?? 0)], s.teamId)
      }
      if (s.flags & (FLAG.allNba1 | FLAG.allNba2 | FLAG.allNba3)) allNba++
    }
  }
  assert.ok(titles >= 3 * 8, 'a champion squad is stamped, every year')
  assert.equal(allNba, 3 * 15, 'fifteen All-NBA places a season, no more')
})

test('retirement closes the career and reaches the log', () => {
  const state = run(5)
  const retired = allCareers(state).filter((c) => c.retiredYear > 0)
  assert.ok(retired.length > 0, 'somebody retired')
  for (const c of retired) {
    assert.ok(!state.league.players.some((p) => p.playerId === c.playerId), 'and he is gone')
    assert.ok(c.seasons.length > 0, 'a retired man has a career behind him')
    assert.ok(c.retiredYear >= (c.seasons[c.seasons.length - 1]?.yearEnd ?? 0))
  }
  const notes = state.log.filter((e) => / retires at /.test(e.text))
  assert.ok(notes.length > 0, 'the substantial ones are announced')
  assert.ok(
    notes.some((n) => /points,/.test(n.text)),
    'with the numbers to go with it',
  )
})

test('a summer of retirements does not bury the inbox', () => {
  const state = run(8)
  const perSummer = new Map<string, number>()
  for (const e of state.log) {
    if (!/ retires at /.test(e.text)) continue
    perSummer.set(e.date, (perSummer.get(e.date) ?? 0) + 1)
  }
  assert.ok(perSummer.size > 0, 'somebody retired')
  for (const [date, n] of perSummer)
    assert.ok(n <= MAX_FAREWELLS, `${date} wrote ${n} farewells, cap is ${MAX_FAREWELLS}`)
  // And what does get written is worth writing: a marginal career is not news.
  for (const e of state.log) {
    if (!/ retires at /.test(e.text)) continue
    const name = e.text.slice(0, e.text.indexOf(' retires at '))
    const c = allCareers(state).find((x) => x.name === name)
    assert.ok(c && isNotable(c), `${name} was worth a letter`)
  }
})

test('a man who never left is marked a one-club man', () => {
  const state = run(5)
  const loyal = allCareers(state).filter((c) => isOneClubMan(c))
  assert.ok(loyal.length > 0)
  for (const c of loyal) assert.equal(new Set(c.seasons.map((s) => s.teamId)).size, 1)
  const oneClubNotes = state.log.filter((e) => /one-club man/.test(e.text))
  assert.ok(oneClubNotes.length > 0, 'and it is said out loud when he goes')
})

test('the hall of fame opens three years after a man stops playing', () => {
  const state = run(13)
  const hall = state.hallOfFame ?? []
  assert.ok(hall.length > 0, 'somebody got in')
  for (const h of hall) {
    assert.equal(h.year - h.retiredYear, 3, 'inducted on the third ballot year')
    const c = careerOf(state, h.playerId)
    assert.ok(c, 'an inductee has a career on file')
    assert.ok(hofScore(c).toFixed(1) === h.score.toFixed(1), 'the score is the career, recomputed')
    assert.ok(h.case.length > 40, 'and a case in words')
    assert.ok(/points/.test(h.case))
  }
  assert.equal(new Set(hall.map((h) => h.playerId)).size, hall.length, 'nobody in twice')
  const announced = state.log.filter((e) => /^Hall of Fame:/.test(e.text))
  assert.ok(announced.length >= hall.length - 3)
})

test('single-game records are real records', () => {
  const state = run(2)
  const book = leagueRecords(state)
  const pts = book.game.pts
  assert.ok(pts, 'somebody holds the scoring record')
  assert.ok(pts.value > 20)
  assert.ok(pts.date && pts.teamId && pts.opponentTeamId !== pts.teamId)
  // No season line can beat the single-game record on a per-game basis.
  for (const c of allCareers(state))
    for (const s of c.seasons) assert.ok(s.pts / s.gp <= pts.value, 'the record is the maximum')
  assert.ok((book.career.pts?.length ?? 0) > 1, 'career leaders are listed')
  const leaders = book.career.pts ?? []
  for (let i = 1; i < leaders.length; i++)
    assert.ok((leaders[i - 1]?.value ?? 0) >= (leaders[i]?.value ?? 0), 'best first')
})

test('franchise history reads season by season, with a leading scorer', () => {
  const state = run(4)
  const rows = franchiseSeasons(state, 'T00')
  assert.equal(rows.length, 4)
  for (const r of rows) {
    assert.ok(r.wins + r.losses > 0)
    assert.ok(r.leadingScorer, 'somebody led the scoring')
    assert.ok(r.finish.length > 0)
  }
  const champs = rows.filter((r) => r.finish === 'Champions')
  for (const c of champs)
    assert.equal(state.history.find((h) => h.yearEnd === c.yearEnd)?.championTeamId, 'T00')
})

test('franchise leaders only count the seasons a man spent there', () => {
  const state = run(4)
  const leaders = franchiseLeaders(state, 'T00', 'pts')
  assert.ok(leaders.length > 0)
  for (const l of leaders) {
    const c = careerOf(state, l.playerId)
    assert.ok(c)
    const here = c.seasons.filter((s) => s.teamId === 'T00')
    assert.equal(totalsOf(here).pts, l.value, 'his T00 points, and no others')
    assert.equal(here.length, l.seasons)
  }
  for (let i = 1; i < leaders.length; i++)
    assert.ok((leaders[i - 1]?.value ?? 0) >= (leaders[i]?.value ?? 0))

  const top = leaders[0]
  assert.ok(top)
  const rank = franchiseRank(state, 'T00', top.playerId, 'pts')
  assert.equal(rank.rank, 1)
  assert.equal(rank.value, top.value)
  assert.ok(rank.of >= leaders.length)
  assert.equal(franchiseRank(state, 'T00', 'nobody-at-all', 'pts').rank, 0)
})

test('a peak is his best scoring season, not his longest', () => {
  const seasons = [
    { yearEnd: 2001, gp: 82, pts: 820 },
    { yearEnd: 2002, gp: 40, pts: 1000 },
    { yearEnd: 2003, gp: 10, pts: 400 },
  ].map((s) => ({
    teamId: 'T01',
    age: 25,
    gs: 0,
    min: 1000,
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
    flags: 0,
    ...s,
  }))
  assert.equal(peakSeason(seasons)?.yearEnd, 2002, 'a 10-game cameo is not a peak')
})

test('an old save with no career store starts keeping one', () => {
  let state = newGame(fixtureBundle({ seed: 3 }), 'T00', 3)
  state = simSeason(state, hooks).state
  // What a save written before the league had a memory looks like: the keys are simply absent.
  const stripped = JSON.parse(JSON.stringify(state)) as GameState
  delete stripped.careers
  delete stripped.hallOfFame
  delete stripped.gameRecords
  const after = simSeason(stripped, hooks).state
  assert.ok(allCareers(after).length > 0, 'the league starts remembering from here on')
  assert.ok(leagueRecords(after).game.pts, 'and the record book refills')
})

test('opening night already has the seasons he played before you arrived', () => {
  const bundle = fixtureBundle({ seed: 1, yearEnd: 2004 })
  const star = bundle.players.find((p) => p.teamId === 'T00')
  assert.ok(star)
  const box = (pts: number) => ({
    gs: 80,
    min: 3000,
    pts,
    fgm: 700,
    fga: 1400,
    fg3m: 10,
    fg3a: 40,
    ftm: 390,
    fta: 500,
    oreb: 200,
    dreb: 600,
    ast: 250,
    stl: 80,
    blk: 180,
    tov: 200,
    pf: 200,
  })
  const line = (yearEnd: number, pts: number) => ({
    yearEnd,
    age: star.age - (2004 - yearEnd),
    teamId: star.teamId,
    mpg: 36,
    gp: 82,
    box: box(pts),
    ratings: star.ratings,
    tendencies: star.tendencies,
  })
  const history = {
    careers: [
      {
        playerId: star.playerId,
        brefId: null,
        name: star.name,
        birthDate: null,
        heightIn: star.heightIn,
        weightLb: star.weightLb,
        pos: star.pos,
        draft: star.draft,
        hof: false,
        seasons: [line(2002, 1800), line(2003, 1900), line(2004, 2000)],
      },
    ],
    drafts: {},
    seasons: {
      2002: {
        standings: [],
        playoffs: [
          {
            round: 4,
            highTeamId: star.teamId,
            lowTeamId: 'T01',
            winnerTeamId: star.teamId,
            highWins: 4,
            lowWins: 2,
          },
        ],
        awards: [{ award: 'MVP', playerId: star.playerId, teamRank: null, share: 1 }],
        champion: star.teamId,
        runnerUp: 'T01',
      },
      2003: {
        standings: [],
        playoffs: [],
        awards: [{ award: 'All-NBA', playerId: star.playerId, teamRank: 1, share: null }],
        champion: null,
        runnerUp: null,
      },
    },
  }
  const state = newGame(bundle, 'T00', 1, { history })
  const c = careerOf(state, star.playerId)
  assert.ok(c, 'the career store is not empty on opening night')
  assert.equal(c.seasons.length, 2, 'the season you are about to play is not in the book yet')
  assert.equal(c.seasons[0]?.pts, 1800)
  assert.equal(c.seasons[1]?.pts, 1900)
  assert.equal(
    c.seasons.some((s) => s.yearEnd === 2004),
    false,
  )
  assert.equal((c.seasons[0]?.flags ?? 0) & FLAG.mvp, FLAG.mvp)
  assert.equal((c.seasons[0]?.flags ?? 0) & FLAG.champion, FLAG.champion)
  assert.equal((c.seasons[1]?.flags ?? 0) & FLAG.allNba1, FLAG.allNba1)
  assert.equal(totalsOf(c.seasons).pts, 3700)
})

test("a 2004 Spurs start already has Duncan's real prior seasons", (t) => {
  const dir = process.env.HOOPS_DATA_DIR ?? resolve('data')
  const histPath = resolve(dir, 'bundles/history.json')
  const bundlePath = resolve(dir, 'bundles/2004.json')
  if (!existsSync(histPath) || !existsSync(bundlePath)) {
    t.skip('no season bundles')
    return
  }
  const history = JSON.parse(readFileSync(histPath, 'utf8')) as HistoryBundle
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as SeasonBundle
  const duncan = bundle.players.find((p) => p.name === 'Tim Duncan')
  if (!duncan) {
    t.skip('Tim Duncan not in the 2004 bundle')
    return
  }
  const arc = history.careers.find((c) => c.playerId === duncan.playerId)
  if (!arc?.seasons.some((s) => s.box && s.yearEnd < 2004)) {
    t.skip('history.json has no prior box scores yet — rebuild bundles')
    return
  }
  const state = newGame(bundle, duncan.teamId, 1, { history })
  const c = careerOf(state, duncan.playerId)
  assert.ok(c && c.seasons.length >= 5, `expected 1998–2003 on file, got ${c?.seasons.length ?? 0}`)
  assert.ok(totalsOf(c.seasons).pts > 8000, 'six seasons of Duncan is not a blank page')
  assert.ok(
    duncan.yearsPro >= 6,
    `years in the league should already be 6+, got ${duncan.yearsPro}`,
  )
})
