// Synthetic bundle for harness tests. 4 teams, 10 players each, round robin ×3.
import type { PlayerRecord, Ratings, SeasonBundle } from '@hoops/core'
import { makeRng, RATING_KEYS } from '@hoops/core'

export function syntheticBundle(seed = 1): SeasonBundle {
  const rng = makeRng(seed)
  const teams = ['AAA', 'BBB', 'CCC', 'DDD']
  const strength = [60, 55, 50, 45]
  const players: PlayerRecord[] = []
  teams.forEach((teamId, ti) => {
    for (let i = 0; i < 10; i++) {
      const base = (strength[ti] as number) - i * 2
      const ratings = Object.fromEntries(
        RATING_KEYS.map((k) => [k, Math.max(1, Math.min(99, Math.round(base + rng.normal(0, 5))))]),
      ) as unknown as Ratings
      const mpg = [36, 34, 32, 30, 28, 22, 18, 16, 14, 10][i] as number
      players.push({
        playerId: `${teamId}${i}`,
        brefId: null,
        name: `${teamId} P${i}`,
        birthDate: null,
        age: 27,
        heightIn: 78,
        weightLb: 220,
        pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5] ?? 'PG',
        draft: null,
        yearsPro: 5,
        yearsWithTeam: 2,
        teamId,
        contract: null,
        ratings,
        tendencies: {
          usage: 0.2,
          shotRim: 0.32,
          shotClose: 0.13,
          shotMid: 0.3,
          shotThree: 0.25,
          assist: 0.2,
          postUp: 0.1,
        },
        real: {
          gp: 80,
          gs: i < 5 ? 80 : 0,
          min: mpg * 80,
          totals: {
            fga: 900,
            fgm: 400,
            fg3a: 250,
            fg3m: 90,
            fta: 250,
            ftm: 190,
            oreb: 100,
            dreb: 300,
            ast: 200,
            tov: 125,
            stl: 75,
            blk: 50,
            pf: 200,
            pts: 1070,
          },
          per100: {
            fga: 18,
            fgm: 8,
            fg3a: 5,
            fg3m: 1.8,
            fta: 5,
            ftm: 3.8,
            oreb: 2,
            dreb: 6,
            ast: 4,
            tov: 2.5,
            stl: 1.5,
            blk: 1,
            pf: 4,
            pts: 21.4,
          },
          pct: { fg: 0.45, fg3: 0.36, ft: 0.76, ts: 0.55, efg: 0.5 },
          adv: {
            usg: 20,
            astPct: 15,
            tovPct: 12,
            orbPct: 5,
            drbPct: 15,
            stlPct: 1.5,
            blkPct: 1.5,
            ortg: 108,
            drtg: 108,
            obpm: 0,
            dbpm: 0,
            bpm: 0,
            per: 15,
            ws48: 0.1,
          },
          shooting: null,
          pbp: null,
        },
        realMpg: mpg,
      })
    }
  })
  const schedule: SeasonBundle['schedule'] = []
  let n = 0
  for (let round = 0; round < 3; round++)
    for (const h of teams)
      for (const a of teams)
        if (h !== a)
          schedule.push({
            gameId: `g${n++}`,
            date: '2000-01-01',
            homeTeamId: h,
            awayTeamId: a,
            seasonType: 'regular',
            real: null,
          })
  return {
    yearEnd: 2000,
    seasonId: '1999-00',
    era: {
      yearEnd: 2000,
      pace: 93.4,
      ortg: 104.1,
      threePAr: 0.169,
      ftr: 0.309,
      tovPct: 14.2,
      orbPct: 0.297,
      fg3Pct: 0.353,
      fg2Pct: 0.466,
      ftPct: 0.75,
      astPct: 0.6,
      stlPer100: 8.4,
      blkPer100: 5.2,
      pfPer100: 23.6,
      zoneShare: { rim: 0.3, close: 0.14, mid: 0.39, three: 0.17 },
      zonePct: { rim: 0.58, close: 0.4, mid: 0.4, three: 0.353 },
      homeWinPct: 0.6,
      handCheckBanned: false,
      zoneLegal: false,
    },
    rules: {},
    teams: teams.map((teamId, i) => ({
      teamId,
      abbr: teamId,
      name: teamId,
      city: teamId,
      conference: i < 2 ? 'East' : 'West',
      division: 'X',
      real: {
        wins: [60, 50, 32, 22][i] as number,
        losses: 82 - ([60, 50, 32, 22][i] as number),
        playoffSeed: null,
      },
    })),
    players,
    schedule,
    real: { stints: [], playoffs: [], awards: [], draft: [] },
  }
}
