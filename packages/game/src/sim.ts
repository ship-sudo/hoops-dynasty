// The reducers. Pure: they clone the state, advance it, and hand back a new one.
// Every random draw comes from the rng restored from state.rngState and written back at the end.
//
// One "day" means whatever the current phase says it means:
//   regular   every game on the calendar date
//   playin    one round of the play-in
//   playoffs  one game in every live series, or the opening of the next round
//   lottery   the drawing and the pick order
//   draft     the whole draft
//   offseason ages, contracts, the hooks, and the next season's calendar

import { makeRng, type Rng } from '@hoops/core'
import { computeAwards } from './awards.ts'
import { addDays } from './dates.ts'
import { runDraft, startDraft } from './draft.ts'
import { playGame, type SimInterrupt, takeSimInterrupt } from './play.ts'
import { playInDay, playoffDay, startPlayIn, startPlayoffs } from './playoffs.ts'
import { rollover } from './rollover.ts'
import type { GameHooks, GameState, GameSummary, ScheduledGame, SeasonSummary } from './state.ts'
import { cloneState, pushLog } from './state.ts'

export type { SimInterrupt }

export interface DayResult {
  state: GameState
  results: GameSummary[]
  /** Set on the day the season rolls over. */
  summary: SeasonSummary | null
  /** User-team newsworthy injury from the last completed day, if any. Not persisted. */
  interrupt: SimInterrupt | null
}

function phaseLog(state: GameState, text: string): void {
  pushLog(state, { date: state.calendar.date, yearEnd: state.season.yearEnd, kind: 'phase', text })
}

/** Advance one day in place. Returns the games played that day. */
function step(
  state: GameState,
  hooks: GameHooks,
  rng: Rng,
): { results: GameSummary[]; summary: SeasonSummary | null; interrupt: SimInterrupt | null } {
  const before = state.calendar.results.length
  let summary: SeasonSummary | null = null

  switch (state.phase) {
    case 'regular': {
      const sched = state.calendar.schedule
      const today = state.calendar.date
      while (
        state.calendar.next < sched.length &&
        (sched[state.calendar.next] as { date: string }).date === today
      ) {
        playGame(state, hooks, rng, sched[state.calendar.next] as ScheduledGame, 'regular')
        state.calendar.next++
      }
      if (state.calendar.next >= sched.length) {
        state.awards = computeAwards(state)
        const mvp = state.awards.mvp
        if (mvp) {
          pushLog(state, {
            date: today,
            yearEnd: state.season.yearEnd,
            kind: 'award',
            text: `${mvp.name} (${mvp.teamId}) is MVP`,
          })
        }
        state.playIn = startPlayIn(state)
        if (state.playIn) {
          state.phase = 'playin'
          phaseLog(state, 'Regular season over. Play-in next.')
        } else {
          state.playoffs = startPlayoffs(state)
          state.phase = 'playoffs'
          phaseLog(state, 'Regular season over. Playoffs next.')
        }
        state.calendar.date = addDays(today, 3)
      } else {
        state.calendar.date = (sched[state.calendar.next] as { date: string }).date
      }
      break
    }
    case 'playin': {
      playInDay(state, hooks, rng)
      state.calendar.date = addDays(state.calendar.date, 2)
      if (state.playIn?.done) {
        state.playoffs = startPlayoffs(state)
        state.phase = 'playoffs'
        phaseLog(state, 'Play-in done. Playoffs next.')
      }
      break
    }
    case 'playoffs': {
      const more = playoffDay(state, hooks, rng)
      state.calendar.date = addDays(state.calendar.date, 2)
      if (!more) {
        state.phase = 'lottery'
        state.calendar.date = `${state.season.yearEnd}-05-15`
      }
      break
    }
    case 'lottery': {
      state.draft = startDraft(state, rng)
      const top = state.draft.order[0]
      pushLog(state, {
        date: state.calendar.date,
        yearEnd: state.season.yearEnd,
        kind: 'draft',
        text: `Lottery: ${top ?? 'nobody'} win the first pick`,
      })
      state.phase = 'draft'
      state.calendar.date = `${state.season.yearEnd}-06-25`
      break
    }
    case 'draft': {
      runDraft(state, hooks, rng)
      state.phase = 'offseason'
      state.calendar.date = `${state.season.yearEnd}-07-01`
      break
    }
    case 'offseason': {
      summary = rollover(state, hooks, rng)
      break
    }
  }
  return {
    results: state.calendar.results.slice(before),
    summary,
    interrupt: takeSimInterrupt(state),
  }
}

function run(
  state: GameState,
  hooks: GameHooks,
  stop: (s: GameState, days: number, interrupt: SimInterrupt | null) => boolean,
): DayResult {
  const next = cloneState(state)
  const rng = makeRng(next.rngState)
  const results: GameSummary[] = []
  let summary: SeasonSummary | null = null
  let interrupt: SimInterrupt | null = null
  let days = 0
  // Hard cap: nothing legitimate takes more than a few thousand days.
  while (!stop(next, days, interrupt) && days < 100_000) {
    const r = step(next, hooks, rng)
    results.push(...r.results)
    if (r.summary) summary = r.summary
    interrupt = r.interrupt
    days++
  }
  next.rngState = rng.state()
  return { state: next, results, summary, interrupt }
}

/** One day. */
export function simDay(state: GameState, hooks: GameHooks): DayResult {
  return run(state, hooks, (_s, days) => days >= 1)
}

/**
 * N league days. Stops after a user-team newsworthy injury so the manager can fix the lineup.
 * Headless full-season runners use simToDate / simSeason and do not pause.
 */
export function simDays(state: GameState, hooks: GameHooks, days: number): DayResult {
  return run(state, hooks, (_s, d, interrupt) => d >= days || Boolean(interrupt))
}

/** Days up to and including `date`, stopping early if the regular season ends first. */
export function simToDate(state: GameState, hooks: GameHooks, date: string): DayResult {
  return run(
    state,
    hooks,
    (s, days) => s.calendar.date > date || (days > 0 && s.phase !== 'regular'),
  )
}

/** Everything left in the season: regular season, play-in, playoffs. Stops once a champion exists. */
export function simRestOfSeason(state: GameState, hooks: GameHooks): DayResult {
  return run(
    state,
    hooks,
    (s) => s.phase === 'lottery' || s.phase === 'draft' || s.phase === 'offseason',
  )
}

/** Rest of the season plus lottery, draft and rollover. Lands on opening night of the next season. */
export function simSeason(state: GameState, hooks: GameHooks): DayResult {
  const year = state.season.yearEnd
  return run(state, hooks, (s) => s.season.yearEnd !== year)
}
