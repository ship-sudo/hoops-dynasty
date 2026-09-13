// End of season: summary, ages, contracts, then the next season's calendar.
//
// Seams left for later phases:
//   hooks.develop    Phase 5 — ratings change with age. Default: ratings are untouched.
//   hooks.freeAgency Phase 4 — free agents, re-signings, trades. Default: stubResign below.
// Nothing in here decides who a player signs with beyond the stub, and the stub is one function
// so it is easy to delete.

import type { Rng } from '@hoops/core'
import { computeAwards } from './awards.ts'
import { addDays, addYears, daysBetween } from './dates.ts'
import { recordRetirements, recordSeason, runHallOfFameBallot } from './history.ts'
import { settleMorale } from './morale.ts'
import { capFrom } from './newgame.ts'
import { generateSchedule } from './schedule.ts'
import { restoreInjuryCover } from './sit.ts'
import { staffOffseason } from './staff.ts'
import { leagueOrder } from './standings.ts'
import {
  emptyRecord,
  type GameHooks,
  type GameState,
  pushLog,
  resetAvailability,
  type SeasonSummary,
} from './state.ts'

/** Money grows at this rate per year after the last real season (DECISIONS.md, 2026-09-11). */
export const MONEY_GROWTH = 0.07

export function summarise(state: GameState): SeasonSummary {
  // Awards are normally computed the moment the last regular-season game is played. A season that
  // is closed by any other route — a rollover driven straight from a reducer, a save restored past
  // the end of the schedule — used to be written into history with `awards: null`, which is why the
  // very first simulated season had no MVP. If the games were played, the trophies exist.
  if (!state.awards && Object.keys(state.stats).length > 0) state.awards = computeAwards(state)
  const order = leagueOrder(state)
  const seedOf = new Map<string, number>()
  if (state.playoffs) {
    for (const conf of ['East', 'West'] as const) {
      state.playoffs.seeds[conf].forEach((id, i) => {
        seedOf.set(id, i + 1)
      })
    }
  }
  const bestId = order[0]
  const bestRec = bestId ? state.records[bestId] : undefined
  // How far each club got, so franchise history can say "lost the conference finals" a decade
  // later rather than only "4 seed".
  const rounds: Record<string, number> = {}
  if (state.playoffs) {
    for (const [i, round] of state.playoffs.rounds.entries())
      for (const s of round) {
        if (!s.winnerTeamId) continue
        const loser = s.winnerTeamId === s.highTeamId ? s.lowTeamId : s.highTeamId
        rounds[loser] = i
        rounds[s.winnerTeamId] = i + 1
      }
  }
  return {
    yearEnd: state.season.yearEnd,
    championTeamId: state.playoffs?.championTeamId ?? null,
    runnerUpTeamId: state.playoffs?.runnerUpTeamId ?? null,
    bestRecord:
      bestId && bestRec ? { teamId: bestId, wins: bestRec.wins, losses: bestRec.losses } : null,
    awards: state.awards,
    rounds,
    standings: order.map((id) => {
      const r = state.records[id]
      return {
        teamId: id,
        wins: r?.wins ?? 0,
        losses: r?.losses ?? 0,
        seed: seedOf.get(id) ?? null,
      }
    }),
  }
}

/**
 * Phase 4 placeholder. Keeps the league playable without a front office: a player whose contract
 * ran out re-signs with the same team for two more years at his last salary. Nobody retires and
 * nobody changes team. Replace wholesale with real free agency.
 */
export function stubResign(state: GameState, _rng: Rng): GameState {
  const nextYear = state.season.yearEnd + 1
  for (const p of state.league.players) {
    if (!p.teamId) continue
    const c = p.contract
    if (c?.years.some((y) => y.yearEnd >= nextYear)) continue
    const last = c?.years[c.years.length - 1]
    const amount = last?.amount ?? state.league.cap.minSalary
    p.contract = {
      teamId: p.teamId,
      kind: amount <= state.league.cap.minSalary * 1.05 ? 'minimum' : 'standard',
      years: [
        { yearEnd: nextYear, amount, option: null, guaranteed: true },
        { yearEnd: nextYear + 1, amount, option: null, guaranteed: true },
      ],
      source: 'generated',
    }
  }
  return state
}

/** Drop years that have expired and advance the contract to the coming season. */
function rollContracts(state: GameState, nextYear: number): number {
  let expired = 0
  for (const p of state.league.players) {
    if (!p.contract) continue
    const kept = p.contract.years.filter((y) => y.yearEnd >= nextYear)
    if (kept.length === 0) {
      p.contract = null
      expired++
    } else {
      p.contract = { ...p.contract, years: kept }
    }
  }
  return expired
}

/**
 * End the season and open the next one. Ages go up, contracts roll forward, expiring deals are
 * cleared, free agency and development hooks run, then a new schedule is generated.
 */
/**
 * The first half of a rollover: close the books, age everyone, roll contracts, and let players
 * develop. Stops before free agency so a caller who wants a human in the market can step in.
 */
export function rolloverBegin(state: GameState, hooks: GameHooks, rng: Rng): SeasonSummary {
  const summary = summarise(state)
  state.history.push(summary)
  // Write the season into everyone's career before ages move: the age on a career line is the age
  // he played the season at, not the age he woke up at in July.
  recordSeason(state)
  pushLog(state, {
    date: state.calendar.date,
    yearEnd: state.season.yearEnd,
    kind: 'phase',
    text: `${state.season.seasonId} is over. Champion: ${summary.championTeamId ?? 'none'}. MVP: ${summary.awards?.mvp?.name ?? 'none'}.`,
  })

  const nextYear = state.season.yearEnd + 1
  for (const p of state.league.players) {
    p.age += 1
    // Players drafted this offseason have not played a season yet.
    if (p.debutYear <= state.season.yearEnd) {
      p.yearsPro += 1
      if (p.teamId) p.yearsWithTeam += 1
      else p.yearsWithTeam = 0
    }
  }
  const expired = rollContracts(state, nextYear)
  pushLog(state, {
    date: state.calendar.date,
    yearEnd: state.season.yearEnd,
    kind: 'contract',
    text: `${expired} contracts expired`,
  })
  // The development hook is where men retire: it hands back a shorter roster and says nothing
  // about who is missing. Hold the roll of names, then diff it — that is the only place in the
  // game where a career actually ends, and it is worth a paragraph in the inbox.
  const before = state.league.players.map((p) => p.playerId)
  ;(hooks.develop ?? ((s: GameState) => s))(state, rng)
  const gone = recordRetirements(state, before)
  runHallOfFameBallot(state)
  // The coaching carousel turns in the same window, and it turns on the season just played — so it
  // runs while `state.records` still holds it, before `rolloverFinish` wipes the books. The men who
  // have just retired are handed to it: some of them walk straight back in with a clipboard.
  staffOffseason(state, rng, gone)
  return summary
}

/**
 * The second half: new rules, new money, new schedule, new season. Call it after free agency,
 * whoever ran that.
 */
export function rolloverFinish(state: GameState, hooks: GameHooks, rng: Rng): void {
  const nextYear = state.season.yearEnd + 1
  // The era seam: the caller may hand over the real rules and baselines for the coming season.
  const next = hooks.nextSeason?.(nextYear) ?? null
  if (next?.rules) state.season.rules = next.rules
  if (next?.era) state.season.era = next.era

  // Real rules bring their own money. Otherwise it grows (SPEC §4, DECISIONS 2026-09-11).
  if (next?.rules) {
    state.league.cap = capFrom(next.rules)
  } else {
    const g = 1 + MONEY_GROWTH
    const cap = state.league.cap
    cap.cap = Math.round(cap.cap * g)
    cap.taxLine = cap.taxLine === null ? null : Math.round(cap.taxLine * g)
    cap.apron1 = cap.apron1 === null ? null : Math.round(cap.apron1 * g)
    cap.apron2 = cap.apron2 === null ? null : Math.round(cap.apron2 * g)
    cap.minSalary = Math.round(cap.minSalary * g)
    cap.maxSalary = cap.maxSalary === null ? null : Math.round(cap.maxSalary * g)
  }

  const span = Math.max(
    120,
    daysBetween(
      state.calendar.schedule[0]?.date ?? '',
      state.calendar.schedule[state.calendar.schedule.length - 1]?.date ?? '',
    ) || 165,
  )
  const start = addYears(state.calendar.schedule[0]?.date ?? state.calendar.date, 1)
  state.season = {
    ...state.season,
    yearEnd: nextYear,
    seasonId: `${nextYear - 1}-${String(nextYear % 100).padStart(2, '0')}`,
  }
  state.calendar = {
    date: start,
    schedule: generateSchedule(
      state.league.teams,
      state.season.rules.games,
      start,
      addDays(start, span),
      rng,
    ),
    next: 0,
    results: [],
  }
  state.records = Object.fromEntries(
    state.league.teams.map((t) => [t.teamId, emptyRecord(t.teamId)]),
  )
  state.stats = {}
  resetAvailability(state)
  for (const p of state.league.players) restoreInjuryCover(state, p)
  // A summer calms the dressing room without wiping it: last year's grievance comes back at 40%,
  // and every role is recomputed against the new roster and the new money.
  settleMorale(state)
  state.playoffs = null
  state.playIn = null
  state.draft = null
  state.awards = null
  state.phase = 'regular'
}

/**
 * A whole rollover: close the season, develop, run the market through the hook, open the next one.
 * The two halves are exported separately for callers that put a human in the middle.
 */
export function rollover(state: GameState, hooks: GameHooks, rng: Rng): SeasonSummary {
  const summary = rolloverBegin(state, hooks, rng)
  ;(hooks.freeAgency ?? stubResign)(state, rng)
  rolloverFinish(state, hooks, rng)
  return summary
}
