import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyStatLine } from '@hoops/core'
import { candidates, computeAwards, computeFinalsHonors } from './awards.ts'
import { fakeEngine, fixtureBundle } from './fixture.ts'
import { newGame } from './newgame.ts'
import { simRestOfSeason } from './sim.ts'
import type { GameHooks, GameState, SeasonStatLine } from './state.ts'

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

function put(
  s: GameState,
  playerId: string,
  teamId: string,
  gp: number,
  box: Partial<SeasonStatLine>,
): void {
  s.stats[playerId] = { ...emptyStatLine(), gp, gs: gp, teamId, ...box }
}

test('two stars on the same 60-win club do not go 1–2 in MVP', () => {
  const s = newGame(fixtureBundle(), 'T00', 1)
  for (const r of Object.values(s.records)) {
    r.wins = 30
    r.losses = 52
  }
  s.records.T00!.wins = 62
  s.records.T00!.losses = 20
  s.records.T05!.wins = 54
  s.records.T05!.losses = 28
  // Duncan-shaped and Parker-shaped, same locker room. Without the ballot cut they finish 1–2.
  put(s, 'T00-0', 'T00', 82, {
    pts: 2200,
    oreb: 250,
    dreb: 550,
    ast: 400,
    stl: 80,
    blk: 180,
    fgm: 850,
    fga: 1700,
    tov: 250,
  })
  put(s, 'T00-1', 'T00', 82, {
    pts: 2000,
    oreb: 80,
    dreb: 320,
    ast: 700,
    stl: 90,
    blk: 20,
    fgm: 740,
    fga: 1600,
    tov: 220,
  })
  put(s, 'T05-0', 'T05', 82, {
    pts: 1800,
    oreb: 150,
    dreb: 450,
    ast: 500,
    stl: 90,
    blk: 80,
    fgm: 680,
    fga: 1500,
    tov: 200,
  })

  const race = [...candidates(s)].sort((a, b) => b.mvpVote - a.mvpVote)
  assert.ok(race.length >= 2)
  assert.equal(race[0]?.playerId, 'T00-0', 'the alpha on the 62-win side is MVP')
  assert.notEqual(race[0]?.teamId, race[1]?.teamId, 'his teammate is not second')
  assert.equal(race[1]?.playerId, 'T05-0')

  const a = computeAwards(s)
  assert.equal(a.mvp?.playerId, 'T00-0')
  const allIds = a.allNba.flat().map((w) => w.playerId)
  assert.ok(allIds.includes('T00-0'))
  assert.ok(allIds.includes('T00-1'), 'the co-star still makes All-NBA')
})

test('a simulated season does not hand MVP 1 and 2 to the same club', () => {
  const s = season(21)
  const race = [...candidates(s)].sort((a, b) => b.mvpVote - a.mvpVote)
  assert.ok(race.length >= 2)
  assert.notEqual(race[0]?.teamId, race[1]?.teamId)
})

test('Finals MVP is a champion, not the runner-up who scored more', () => {
  const game = (
    id: string,
    lines: { playerId: string; teamId: string; pts: number; reb: number; ast: number }[],
  ) => ({
    gameId: id,
    date: '2004-06-15',
    homeTeamId: 'SAS',
    awayTeamId: 'DET',
    homePts: 80,
    awayPts: 70,
    overtimes: 0,
    seasonType: 'playoffs' as const,
    players: lines.map((p) => ({ ...p, min: 40 })),
  })
  const g1 = game('f1', [
    { playerId: 'duncan', teamId: 'SAS', pts: 24, reb: 12, ast: 4 },
    { playerId: 'parker', teamId: 'SAS', pts: 10, reb: 2, ast: 9 },
    { playerId: 'billups', teamId: 'DET', pts: 40, reb: 4, ast: 8 },
  ])
  const g2 = game('f2', [
    { playerId: 'duncan', teamId: 'SAS', pts: 22, reb: 11, ast: 3 },
    { playerId: 'parker', teamId: 'SAS', pts: 12, reb: 1, ast: 10 },
    { playerId: 'billups', teamId: 'DET', pts: 38, reb: 3, ast: 9 },
  ])
  const honors = computeFinalsHonors([g1, g2], 'SAS', (id) => id)
  assert.equal(honors.finalsMvp?.playerId, 'duncan')
  assert.equal(honors.finalsMvp?.teamId, 'SAS')
  assert.equal(honors.finalsLeaders.pts?.playerId, 'duncan')
  assert.equal(honors.finalsLeaders.reb?.playerId, 'duncan')
  assert.equal(honors.finalsLeaders.ast?.playerId, 'parker')
})

test('Finals honours stay empty when the series has no player lines', () => {
  const honors = computeFinalsHonors(
    [
      {
        gameId: 'f1',
        date: '2004-06-15',
        homeTeamId: 'SAS',
        awayTeamId: 'DET',
        homePts: 80,
        awayPts: 70,
        overtimes: 0,
        seasonType: 'playoffs',
      },
    ],
    'SAS',
    (id) => id,
  )
  assert.equal(honors.finalsMvp, null)
  assert.equal(honors.finalsLeaders.pts, null)
})
