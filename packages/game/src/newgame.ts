// Build the initial state from a SeasonBundle. No I/O: the caller loads the bundle.

import type { EraRules, HistoryBundle, SeasonBundle } from '@hoops/core'
import { makeRng } from '@hoops/core'
import { seedPriorCareers } from './history.ts'
import { generateSchedule } from './schedule.ts'
import { initStaff } from './staff.ts'
import {
  type CapState,
  emptyRecord,
  fitPlayer,
  type GameState,
  type LeaguePlayer,
  type LeagueTeam,
} from './state.ts'

export function capFrom(rules: EraRules): CapState {
  const max = rules.max_salary.dollars
  return {
    cap: rules.cap,
    taxLine: rules.tax_line,
    apron1: rules.apron_1,
    apron2: rules.apron_2,
    minSalary: rules.min_salary_0yr,
    maxSalary: max ? max.yrs_10_plus : null,
  }
}

export interface NewGameOptions {
  /** Use the bundle's real fixture list instead of generating one. Off by default (SPEC §8). */
  useRealSchedule?: boolean
  /** Real careers through last season. Seeds the career store so opening night is not a blank page. */
  history?: HistoryBundle | null
}

export function newGame(
  bundle: SeasonBundle,
  teamId: string,
  seed: number,
  opts: NewGameOptions = {},
): GameState {
  const rules = bundle.rules as EraRules
  const teams: LeagueTeam[] = bundle.teams.map((t) => ({
    teamId: t.teamId,
    abbr: t.abbr,
    name: t.name,
    city: t.city,
    conference: t.conference,
    division: t.division,
  }))
  if (!teams.some((t) => t.teamId === teamId)) {
    throw new Error(`newGame: no team ${teamId} in the ${bundle.seasonId} bundle`)
  }
  const teamIds = new Set(teams.map((t) => t.teamId))
  const players: LeaguePlayer[] = bundle.players
    .filter((p) => teamIds.has(p.teamId))
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      pos: p.pos,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      yearsPro: p.yearsPro,
      yearsWithTeam: p.yearsWithTeam,
      debutYear: bundle.yearEnd - p.yearsPro,
      teamId: p.teamId,
      contract: p.contract,
      ratings: p.ratings,
      tendencies: p.tendencies,
      mpgHint: p.realMpg,
      hintYear: bundle.yearEnd,
      draft: p.draft,
    }))

  const rng = makeRng(seed)
  const dates = bundle.schedule.map((g) => g.date).sort()
  const start = dates[0] ?? `${bundle.yearEnd - 1}-10-28`
  const end = dates[dates.length - 1] ?? `${bundle.yearEnd}-04-15`
  const schedule = opts.useRealSchedule
    ? bundle.schedule
        .filter((g) => g.seasonType === 'regular')
        .map((g) => ({
          gameId: g.gameId,
          date: g.date,
          homeTeamId: g.homeTeamId,
          awayTeamId: g.awayTeamId,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    : generateSchedule(teams, rules.games, start, end, rng)

  const state: GameState = {
    version: 1,
    seed,
    rngState: rng.state(),
    userTeamId: teamId,
    phase: 'regular',
    season: {
      yearEnd: bundle.yearEnd,
      seasonId: bundle.seasonId,
      era: bundle.era,
      rules,
    },
    league: { teams, players, cap: capFrom(rules) },
    calendar: { date: start, schedule, next: 0, results: [] },
    records: Object.fromEntries(teams.map((t) => [t.teamId, emptyRecord(t.teamId)])),
    stats: {},
    availability: Object.fromEntries(players.map((p) => [p.playerId, fitPlayer()])),
    playoffs: null,
    playIn: null,
    draft: null,
    awards: null,
    history: [],
    teamSettings: {},
    pickOwners: {},
    log: [
      {
        date: start,
        yearEnd: bundle.yearEnd,
        kind: 'phase',
        text: `${bundle.seasonId} opening night. You are running ${teamId}.`,
      },
    ],
  }
  // Thirty staffs before a ball is thrown up. They set the tactics of every club the manager never
  // touches, so the league has an identity from game one.
  initStaff(state, rng)
  if (opts.history) seedPriorCareers(state, opts.history)
  state.rngState = rng.state()
  return state
}
