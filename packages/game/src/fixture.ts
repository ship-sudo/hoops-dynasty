// Synthetic league and a fake engine, so the tests need no bundle files and no real engine.
// Exported because the tests in this package are the only consumers.

import type {
  EraContext,
  EraRules,
  GameInput,
  GameResult,
  PlayerBox,
  PlayerRecord,
  Ratings,
  SeasonBundle,
  StatLine,
  TeamBox,
  Tendencies,
} from '@hoops/core'
import { emptyStatLine, makeRng, RATING_KEYS } from '@hoops/core'

const DIV6: ['East' | 'West', string][] = [
  ['East', 'Atlantic'],
  ['East', 'Central'],
  ['East', 'Southeast'],
  ['West', 'Northwest'],
  ['West', 'Pacific'],
  ['West', 'Southwest'],
]

/** The 1997-98 to 2003-04 shape: two divisions per conference. */
const DIV4: ['East' | 'West', string][] = [
  ['East', 'Atlantic'],
  ['East', 'Central'],
  ['West', 'Midwest'],
  ['West', 'Pacific'],
]

export interface FixtureOpts {
  yearEnd?: number
  teams?: number
  games?: number
  seeding?: EraRules['playoffs']['seeding']
  playIn?: EraRules['playoffs']['play_in']
  firstRoundGames?: 5 | 7
  /** 4 = two divisions per conference (1998-2004), 6 = three (2005 on). */
  divisions?: 4 | 6
  seed?: number
}

const TENDENCIES: Tendencies = {
  usage: 0.2,
  shotRim: 0.32,
  shotClose: 0.13,
  shotMid: 0.3,
  shotThree: 0.25,
  assist: 0.2,
  postUp: 0.1,
}

export function fixtureRules(o: FixtureOpts = {}): EraRules {
  const teams = o.teams ?? 30
  return {
    season_id: `${(o.yearEnd ?? 2020) - 1}-${String((o.yearEnd ?? 2020) % 100).padStart(2, '0')}`,
    season_end: o.yearEnd ?? 2020,
    teams,
    games: o.games ?? 82,
    cap: 100_000_000,
    tax_line: 120_000_000,
    apron_1: 126_000_000,
    apron_2: null,
    min_salary_0yr: 1_000_000,
    min_salary_10yr: 2_600_000,
    max_salary: { pct: null, dollars: { yrs_0_6: 30e6, yrs_7_9: 35e6, yrs_10_plus: 40e6 } },
    rookie_scale_pick1: 8_000_000,
    mle_non_taxpayer: 9_000_000,
    mle_taxpayer: 5_700_000,
    mle_room: 4_700_000,
    bae: 3_500_000,
    trade_matching: {
      split_at: 'none',
      under: [{ up_to: null, pct: 125, plus: 100_000 }],
      over: null,
      over_apron_2: null,
    },
    bird_years: 3,
    early_bird_years: 2,
    roster_max: 15,
    roster_min: 14,
    roster_active: 13,
    two_way_slots: 2,
    luxury_tax_scheme: 'flat_1_to_1',
    tax_rates: null,
    draft: {
      rounds: 2,
      lottery_teams: Math.max(1, teams - 16),
      lottery_odds: [14, 14, 14, 12.5, 10.5, 9, 7.5, 6, 4.5, 3, 2, 1.5, 1, 0.5],
      picks_drawn: 4,
      min_age: 19,
      one_year_removed_from_hs: true,
    },
    playoffs: {
      teams: 16,
      first_round_games: o.firstRoundGames ?? 7,
      seeding: o.seeding ?? 'record',
      play_in: o.playIn ?? 'none',
    },
    expansion_draft: {
      precedent: 2004,
      protected_per_team: 8,
      min_unprotected_per_team: 1,
      max_picks_per_team: 1,
      min_picks: null,
    },
    rules: {
      hand_check_banned: true,
      zone_defense_legal: true,
      defensive_three_seconds: true,
      eight_second_backcourt: true,
      three_point_line_ft: { arc: 23.75, corner: 22 },
      shot_clock_offensive_rebound_14: true,
      coach_challenge: true,
    },
    notes: 'fixture',
    unverified: [],
  }
}

const ERA: EraContext = {
  yearEnd: 2020,
  pace: 100,
  ortg: 110,
  threePAr: 0.38,
  ftr: 0.24,
  tovPct: 13,
  orbPct: 0.23,
  fg3Pct: 0.36,
  fg2Pct: 0.52,
  ftPct: 0.77,
  astPct: 0.56,
  stlPer100: 7.7,
  blkPer100: 4.9,
  pfPer100: 20,
  zoneShare: { rim: 0.32, close: 0.13, mid: 0.17, three: 0.38 },
  zonePct: { rim: 0.64, close: 0.41, mid: 0.41, three: 0.36 },
  homeWinPct: 0.55,
  handCheckBanned: true,
  zoneLegal: true,
}

export function fixtureBundle(o: FixtureOpts = {}): SeasonBundle {
  const yearEnd = o.yearEnd ?? 2020
  const nTeams = o.teams ?? 30
  const rules = fixtureRules(o)
  const rng = makeRng(o.seed ?? 42)
  const divs = (o.divisions ?? 6) === 4 ? DIV4 : DIV6
  const teams = Array.from({ length: nTeams }, (_, i) => {
    const [conference, division] = divs[i % divs.length] as ['East' | 'West', string]
    const abbr = `T${String(i).padStart(2, '0')}`
    return {
      teamId: abbr,
      abbr,
      name: `Team ${i}`,
      city: `City ${i}`,
      conference,
      division,
      real: { wins: 41, losses: 41, playoffSeed: null },
    }
  })
  const players: PlayerRecord[] = []
  const mpgs = [36, 34, 32, 30, 28, 24, 20, 17, 14, 10, 8, 6]
  teams.forEach((t, ti) => {
    // Team strength spreads 62 down to 40 so the standings and awards have real spread.
    const base = 62 - (ti * 22) / Math.max(1, nTeams - 1)
    for (let i = 0; i < mpgs.length; i++) {
      const lvl = base - i * 1.6
      const ratings = Object.fromEntries(
        RATING_KEYS.map((k) => [k, Math.max(1, Math.min(99, Math.round(lvl + rng.normal(0, 4))))]),
      ) as unknown as Ratings
      players.push({
        playerId: `${t.abbr}-${i}`,
        brefId: null,
        name: `${t.abbr} Player ${i}`,
        birthDate: null,
        age: 22 + (i % 10),
        heightIn: 74 + (i % 9),
        weightLb: 190 + i * 3,
        pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5] ?? 'PG',
        draft: null,
        yearsPro: i % 10,
        yearsWithTeam: 1,
        teamId: t.teamId,
        contract: {
          teamId: t.teamId,
          kind: 'standard',
          years: Array.from({ length: 1 + (i % 3) }, (_, y) => ({
            yearEnd: yearEnd + y,
            amount: 2_000_000 + (12 - i) * 1_000_000,
            option: null,
            guaranteed: true,
          })),
          source: 'generated',
        },
        ratings,
        tendencies: TENDENCIES,
        real: null,
        realMpg: mpgs[i] as number,
      })
    }
  })
  // The date range only sets the calendar; the generator builds its own fixture list.
  const start = `${yearEnd - 1}-10-25`
  return {
    yearEnd,
    seasonId: rules.season_id,
    era: { ...ERA, yearEnd },
    rules,
    teams,
    players,
    schedule: [
      {
        gameId: 's1',
        date: start,
        homeTeamId: teams[0]?.teamId as string,
        awayTeamId: teams[1]?.teamId as string,
        seasonType: 'regular',
        real: null,
      },
      {
        gameId: 's2',
        date: `${yearEnd}-04-12`,
        homeTeamId: teams[1]?.teamId as string,
        awayTeamId: teams[0]?.teamId as string,
        seasonType: 'regular',
        real: null,
      },
    ],
    real: { stints: [], playoffs: [], awards: [], draft: [] },
  }
}

/**
 * A fake engine: deterministic from the seed, with the better team favoured and a home edge.
 * Box scores are shaped from the minutes targets so the awards and stat maths have something real.
 */
export function fakeEngine(input: GameInput, seed: number): GameResult {
  const rng = makeRng(seed)
  const strength = (side: GameInput['home']) => {
    let s = 0
    let m = 0
    for (const p of side.players) {
      let r = 0
      for (const k of RATING_KEYS) r += p.ratings[k]
      s += (r / RATING_KEYS.length) * p.minutesTarget
      m += p.minutesTarget
    }
    return m > 0 ? s / m : 50
  }
  const hs = strength(input.home)
  const as = strength(input.away)
  const edge = input.neutralSite ? 0 : 3
  let homePts = Math.round(105 + (hs - as) * 1.4 + edge + rng.normal(0, 9))
  let awayPts = Math.round(105 - (hs - as) * 1.4 + rng.normal(0, 9))
  let overtimes = 0
  while (homePts === awayPts) {
    overtimes++
    homePts += rng.int(12)
    awayPts += rng.int(12)
  }
  const box = (side: GameInput['home'], pts: number): TeamBox => {
    const totalMin = side.players.reduce((a, p) => a + p.minutesTarget, 0) || 1
    const players: PlayerBox[] = side.players.map((p) => {
      const share = p.minutesTarget / totalMin
      let r = 0
      for (const k of RATING_KEYS) r += p.ratings[k]
      const skill = r / RATING_KEYS.length / 50
      const ppg = Math.max(0, Math.round(pts * share * skill))
      const fgm = Math.round(ppg * 0.38)
      const line: StatLine = {
        min: p.minutesTarget,
        pts: ppg,
        fgm,
        fga: Math.round(fgm * 2.2),
        fg3m: Math.round(fgm * 0.3),
        fg3a: Math.round(fgm * 0.85),
        ftm: Math.round(ppg * 0.15),
        fta: Math.round(ppg * 0.19),
        oreb: Math.round(p.minutesTarget * 0.04 * skill),
        dreb: Math.round(p.minutesTarget * 0.12 * skill),
        ast: Math.round(p.minutesTarget * 0.11 * skill),
        stl: Math.round(p.minutesTarget * 0.025 * skill),
        blk: Math.round(p.minutesTarget * 0.018 * skill),
        tov: Math.round(p.minutesTarget * 0.045),
        pf: Math.round(p.minutesTarget * 0.06),
      }
      return { ...line, playerId: p.playerId, name: p.name, starter: p.starter, plusMinus: 0 }
    })
    const totals = emptyStatLine()
    for (const pb of players)
      for (const k of Object.keys(totals) as (keyof StatLine)[]) totals[k] += pb[k]
    totals.pts = pts
    return { teamId: side.teamId, pts, quarters: [pts], possessions: 100, players, totals }
  }
  return {
    home: box(input.home, homePts),
    away: box(input.away, awayPts),
    winner: homePts > awayPts ? 'home' : 'away',
    overtimes,
    pbp: [],
  }
}
