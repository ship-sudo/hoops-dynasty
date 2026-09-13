// Draft lottery and draft.
//
// The lottery is the real process, not an approximation: the first `picks_drawn` picks are drawn
// one at a time, weighted by `lottery_odds`, without replacement. Re-normalising the remaining
// combinations after each draw is exactly what the ping-pong machine does. Every lottery team that
// is not drawn falls in behind in reverse-record order. Non-lottery teams follow in reverse-record
// order (regular-season record, not playoff finish). Round 2 is reverse-record order throughout,
// no lottery, which is the real rule.
//
// Seam: this package does not generate players. `hooks.prospects` supplies the class. Without it
// the picks are still made and recorded, with `prospectId: null`.

import type { Rng } from '@hoops/core'
import { leagueOrder } from './standings.ts'
import {
  type DraftPick,
  type DraftState,
  type GameHooks,
  type GameState,
  type Prospect,
  pushLog,
} from './state.ts'

/** Teams that missed the playoffs, worst record first. */
export function lotteryTeams(state: GameState): string[] {
  const inPlayoffs = new Set<string>()
  if (state.playoffs) {
    for (const conf of ['East', 'West'] as const)
      for (const id of state.playoffs.seeds[conf]) inPlayoffs.add(id)
  }
  return leagueOrder(state)
    .filter((id) => !inPlayoffs.has(id))
    .reverse()
}

/** Full first-round order after the drawing. */
export function runLottery(state: GameState, rng: Rng): string[] {
  const rules = state.season.rules.draft
  const lot = lotteryTeams(state).slice(0, rules.lottery_teams)
  const odds = rules.lottery_odds.slice(0, lot.length)
  while (odds.length < lot.length) odds.push(0.1)

  const pool = lot.map((teamId, i) => ({ teamId, w: odds[i] ?? 0.1 }))
  const drawn: string[] = []
  const draws = Math.min(rules.picks_drawn, pool.length)
  for (let d = 0; d < draws; d++) {
    const idx = rng.weighted(pool.map((p) => p.w))
    drawn.push(pool[idx]?.teamId as string)
    pool.splice(idx, 1)
  }
  const rest = pool.map((p) => p.teamId) // still in worst-first order
  const nonLottery = leagueOrder(state)
    .filter((id) => !lot.includes(id))
    .reverse()
  return [...drawn, ...rest, ...nonLottery]
}

/** Reverse regular-season record: the order for round 2 and every round after. */
function reverseRecordOrder(state: GameState): string[] {
  return leagueOrder(state).reverse()
}

/** Key for the pick ledger: the draft, the round, and the team whose record earned it. */
export function pickKey(draftYear: number, round: number, originalTeamId: string): string {
  return `${draftYear}-${round}-${originalTeamId}`
}

export function startDraft(state: GameState, rng: Rng): DraftState {
  const order = runLottery(state, rng)
  const rounds = state.season.rules.draft.rounds
  const later = reverseRecordOrder(state)
  const picks: DraftPick[] = []
  let overall = 1
  for (let r = 1; r <= rounds; r++) {
    const src = r === 1 ? order : later
    src.forEach((teamId, i) => {
      // A pick that has been traded is made by whoever holds it now.
      const owner = state.pickOwners[pickKey(state.season.yearEnd, r, teamId)] ?? teamId
      picks.push({
        overall: overall++,
        round: r,
        pick: i + 1,
        teamId: owner,
        prospectId: null,
        name: null,
      })
    })
  }
  return { draftYear: state.season.yearEnd, order, picks, done: false, board: [], next: 0 }
}

function overallOfProspect(p: Prospect): number {
  const vals = Object.values(p.ratings) as number[]
  return vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
}

/**
 * Fill the board. Called once when the draft opens, so the prospects exist in the state and a
 * human can look at them before anyone picks.
 */
export function openDraft(state: GameState, hooks: GameHooks, rng: Rng): void {
  const d = state.draft as DraftState
  if (d.board.length > 0 || d.next > 0) return
  const supply = hooks.prospects
    ? hooks.prospects({ yearEnd: state.season.yearEnd, count: d.picks.length, rng })
    : []
  d.board = [...supply].sort((a, b) => overallOfProspect(b) - overallOfProspect(a))
}

/**
 * Make the next pick. With no `prospectId` the team takes the best man on the board, which is what
 * every AI team does; pass one to make a human's choice. Returns the prospect taken, or null when
 * the draft is over or the board is empty.
 */
export function makePick(state: GameState, prospectId?: string): Prospect | null {
  const d = state.draft as DraftState
  const pick = d.picks[d.next]
  if (!pick) {
    d.done = true
    return null
  }
  const index = prospectId ? d.board.findIndex((p) => p.prospectId === prospectId) : 0
  const taken = index >= 0 ? d.board[index] : undefined
  if (!taken) {
    d.next++
    if (d.next >= d.picks.length) d.done = true
    return null
  }
  d.board.splice(index, 1)
  pick.prospectId = taken.prospectId
  pick.name = taken.name
  state.league.players.push({
    playerId: taken.prospectId,
    name: taken.name,
    pos: taken.pos,
    age: taken.age,
    heightIn: taken.heightIn,
    weightLb: taken.weightLb,
    yearsPro: 0,
    yearsWithTeam: 0,
    // Drafted in the offseason of `draftYear`; he debuts the season after.
    debutYear: d.draftYear + 1,
    teamId: pick.teamId,
    contract: null, // rookie-scale deals are written by the front office in rollover
    ratings: taken.ratings,
    tendencies: taken.tendencies,
    mpgHint: 0,
    draft: { year: d.draftYear, round: pick.round, pick: pick.pick },
  })
  d.next++
  if (d.next >= d.picks.length) d.done = true
  return taken
}

/** Whose pick is on the clock, or null when the draft is done. */
export function onTheClock(state: GameState): DraftPick | null {
  const d = state.draft
  return d ? (d.picks[d.next] ?? null) : null
}

/** Make every remaining pick automatically. Stops before `pauseForTeamId` when one is given. */
export function runDraft(
  state: GameState,
  hooks: GameHooks,
  rng: Rng,
  pauseForTeamId?: string,
): void {
  const d = state.draft as DraftState
  openDraft(state, hooks, rng)
  while (d.next < d.picks.length) {
    if (pauseForTeamId && d.picks[d.next]?.teamId === pauseForTeamId) return
    makePick(state)
  }
  d.done = true
  const top = d.picks[0]
  pushLog(state, {
    date: state.calendar.date,
    yearEnd: state.season.yearEnd,
    kind: 'draft',
    text: top
      ? `${d.draftYear} draft: ${top.teamId} take ${top.name ?? 'no prospect supplied'} at 1`
      : `${d.draftYear} draft: no picks`,
  })
}
