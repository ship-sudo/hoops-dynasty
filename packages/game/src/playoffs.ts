// Play-in, bracket and series. Era-correct format comes from rules.playoffs.
//
// Bracket is fixed, not reseeded: 1v8 meets 4v5, 2v7 meets 3v6, winners meet in the conference
// final, conference champions meet in the Finals.
//
// Home-court patterns (H = higher seed at home):
//   best-of-5 (first round 1997-98 to 2001-02): H H A A H
//   best-of-7:                                  H H A A H A H
//   Finals through 2012-13 used 2-3-2:          H H A A A H H
// Finals home court goes to the better regular-season record, ties broken by the standings ladder.

import type { Rng } from '@hoops/core'
import { applyFinalsHonors } from './awards.ts'
import { addDays } from './dates.ts'
import { playGame } from './play.ts'
import { leagueOrder, seedConference } from './standings.ts'
import type {
  Conference,
  GameHooks,
  GameState,
  PlayInState,
  PlayoffState,
  SeriesState,
} from './state.ts'
import { pushLog } from './state.ts'

const BO5 = [true, true, false, false, true]
const BO7 = [true, true, false, false, true, false, true]
const BO7_235 = [true, true, false, false, false, true, true]

/**
 * Split out so a screen can say "you are at home in game four" without holding a GameState.
 * One rule, one place: if this changes, both the sim and the preview change with it.
 */
export function homePatternFor(
  bestOf: number,
  bracket: Conference | 'Finals' | string,
  yearEnd: number,
): boolean[] {
  if (bestOf === 5) return BO5
  if (bracket === 'Finals' && yearEnd <= 2013) return BO7_235
  return BO7
}

export function homePattern(state: GameState, s: SeriesState): boolean[] {
  return homePatternFor(s.bestOf, s.bracket, state.season.yearEnd)
}

function newSeries(
  round: number,
  bracket: Conference | 'Finals',
  high: string,
  low: string,
  bestOf: 5 | 7,
): SeriesState {
  return {
    round,
    bracket,
    highTeamId: high,
    lowTeamId: low,
    highWins: 0,
    lowWins: 0,
    bestOf,
    winnerTeamId: null,
    games: [],
  }
}

/** Sim exactly one game of an unfinished series. Returns true if a game was played. */
export function advanceSeries(
  state: GameState,
  hooks: GameHooks,
  rng: Rng,
  s: SeriesState,
  date: string,
): boolean {
  if (s.winnerTeamId) return false
  const need = s.bestOf === 5 ? 3 : 4
  const idx = s.highWins + s.lowWins
  const pattern = homePattern(state, s)
  const highHome = pattern[idx] ?? true
  const played = playGame(
    state,
    hooks,
    rng,
    {
      gameId: `p${state.season.yearEnd}-r${s.round}-${s.highTeamId}${s.lowTeamId}-${idx + 1}`,
      date,
      homeTeamId: highHome ? s.highTeamId : s.lowTeamId,
      awayTeamId: highHome ? s.lowTeamId : s.highTeamId,
    },
    'playoffs',
  )
  const homeWon = played.result.winner === 'home'
  const highWon = highHome === homeWon
  if (highWon) s.highWins++
  else s.lowWins++
  s.games.push(played.summary)
  if (s.highWins >= need) s.winnerTeamId = s.highTeamId
  else if (s.lowWins >= need) s.winnerTeamId = s.lowTeamId
  return true
}

// ---------------------------------------------------------------------------- play-in

export function startPlayIn(state: GameState): PlayInState | null {
  const mode = state.season.rules.playoffs.play_in
  if (mode === 'none') return null
  return { games: [], day: 0, done: false }
}

/**
 * One play-in day. `seeds_7_to_10`: day 0 is 7v8 and 9v10, day 1 is the loser of 7v8 against the
 * winner of 9v10. `bubble_8_v_9` (2020 only): the 9 seed must beat the 8 twice, and only plays if
 * it finished within four games of the 8.
 */
export function playInDay(state: GameState, hooks: GameHooks, rng: Rng): void {
  const pi = state.playIn as PlayInState
  const mode = state.season.rules.playoffs.play_in
  const date = state.calendar.date
  const orders: Record<Conference, string[]> = {
    East: seedConference(state, 'East'),
    West: seedConference(state, 'West'),
  }
  const slots = state.season.rules.playoffs.teams / 2

  if (mode === 'bubble_8_v_9') {
    for (const conf of ['East', 'West'] as const) {
      const o = orders[conf]
      const eight = o[slots - 1]
      const nine = o[slots]
      if (!eight || !nine) continue
      const r8 = state.records[eight]
      const r9 = state.records[nine]
      if (!r8 || !r9) continue
      const gb = (r8.wins - r9.wins + (r9.losses - r8.losses)) / 2
      if (gb > 4) continue
      // The 9 seed must win two in a row; the 8 seed needs one.
      let nineWins = 0
      for (let g = 0; g < 2; g++) {
        const played = playGame(
          state,
          hooks,
          rng,
          {
            gameId: `pi${state.season.yearEnd}-${conf}-${g + 1}`,
            date: addDays(date, g),
            homeTeamId: eight,
            awayTeamId: nine,
          },
          'playin',
        )
        pi.games.push(played.summary)
        if (played.result.winner === 'away') nineWins++
        else break
      }
      if (nineWins === 2) {
        pushLog(state, {
          date,
          yearEnd: state.season.yearEnd,
          kind: 'game',
          text: `${nine} beat ${eight} twice to take the ${conf} 8 seed`,
        })
        pi.games.push({
          gameId: `pi${state.season.yearEnd}-${conf}-result`,
          date,
          homeTeamId: nine,
          awayTeamId: eight,
          homePts: 0,
          awayPts: 0,
          overtimes: 0,
          seasonType: 'playin',
        })
      }
    }
    pi.done = true
    return
  }

  // seeds_7_to_10
  if (pi.day === 0) {
    for (const conf of ['East', 'West'] as const) {
      const o = orders[conf]
      const [s7, s8, s9, s10] = [o[slots - 2], o[slots - 1], o[slots], o[slots + 1]]
      if (!s7 || !s8 || !s9 || !s10) continue
      for (const [home, away, tag] of [
        [s7, s8, 'A'],
        [s9, s10, 'B'],
      ] as const) {
        const played = playGame(
          state,
          hooks,
          rng,
          {
            gameId: `pi${state.season.yearEnd}-${conf}-${tag}`,
            date,
            homeTeamId: home,
            awayTeamId: away,
          },
          'playin',
        )
        pi.games.push(played.summary)
      }
    }
    pi.day = 1
    return
  }
  for (const conf of ['East', 'West'] as const) {
    const a = pi.games.find((g) => g.gameId === `pi${state.season.yearEnd}-${conf}-A`)
    const b = pi.games.find((g) => g.gameId === `pi${state.season.yearEnd}-${conf}-B`)
    if (!a || !b) continue
    const loserA = a.homePts > a.awayPts ? a.awayTeamId : a.homeTeamId
    const winnerB = b.homePts > b.awayPts ? b.homeTeamId : b.awayTeamId
    const played = playGame(
      state,
      hooks,
      rng,
      {
        gameId: `pi${state.season.yearEnd}-${conf}-C`,
        date,
        homeTeamId: loserA,
        awayTeamId: winnerB,
      },
      'playin',
    )
    pi.games.push(played.summary)
  }
  pi.day = 2
  pi.done = true
}

/** Final seed order for a conference after any play-in. Length = playoff slots. */
export function resolveSeeds(state: GameState, conf: Conference): string[] {
  const order = seedConference(state, conf)
  const slots = state.season.rules.playoffs.teams / 2
  const seeds = order.slice(0, slots)
  const pi = state.playIn
  if (!pi || pi.games.length === 0) return seeds
  const mode = state.season.rules.playoffs.play_in
  const y = state.season.yearEnd
  if (mode === 'bubble_8_v_9') {
    const res = pi.games.find((g) => g.gameId === `pi${y}-${conf}-result`)
    if (res) seeds[slots - 1] = res.homeTeamId
    return seeds
  }
  const a = pi.games.find((g) => g.gameId === `pi${y}-${conf}-A`)
  const c = pi.games.find((g) => g.gameId === `pi${y}-${conf}-C`)
  if (a) seeds[slots - 2] = a.homePts > a.awayPts ? a.homeTeamId : a.awayTeamId
  if (c) seeds[slots - 1] = c.homePts > c.awayPts ? c.homeTeamId : c.awayTeamId
  return seeds
}

// ---------------------------------------------------------------------------- bracket

export function startPlayoffs(state: GameState): PlayoffState {
  const slots = state.season.rules.playoffs.teams / 2
  const bestOf = state.season.rules.playoffs.first_round_games
  const seeds: Record<Conference, string[]> = {
    East: resolveSeeds(state, 'East'),
    West: resolveSeeds(state, 'West'),
  }
  const first: SeriesState[] = []
  for (const conf of ['East', 'West'] as const) {
    const s = seeds[conf]
    for (let i = 0; i < slots / 2; i++) {
      const high = s[i]
      const low = s[slots - 1 - i]
      if (!high || !low) continue
      first.push(newSeries(0, conf, high, low, bestOf))
    }
  }
  return { seeds, rounds: [first], championTeamId: null, runnerUpTeamId: null }
}

/** Build the next round from the finished one. Fixed bracket: adjacent pairs meet. */
function nextRound(state: GameState, po: PlayoffState): SeriesState[] | null {
  const last = po.rounds[po.rounds.length - 1] as SeriesState[]
  if (last.some((s) => !s.winnerTeamId)) return null
  const roundNo = po.rounds.length
  if (last.length === 1) return null
  const league = leagueOrder(state)
  const rank = (id: string) => {
    const i = league.indexOf(id)
    return i < 0 ? 999 : i
  }
  const out: SeriesState[] = []
  if (last.length === 2) {
    // Conference champions meet: home court by regular-season record.
    const a = last[0]?.winnerTeamId as string
    const b = last[1]?.winnerTeamId as string
    const [high, low] = rank(a) <= rank(b) ? [a, b] : [b, a]
    out.push(newSeries(roundNo, 'Finals', high, low, 7))
    return out
  }
  for (const conf of ['East', 'West'] as const) {
    const inConf = last.filter((s) => s.bracket === conf)
    // Fixed bracket: the 1/8 winner meets the 4/5 winner, the 2/7 winner meets the 3/6 winner.
    for (let i = 0; i < inConf.length / 2; i++) {
      const x = inConf[i]?.winnerTeamId as string
      const y = inConf[inConf.length - 1 - i]?.winnerTeamId as string
      if (!x || !y) continue
      const seeds = po.seeds[conf]
      const seedOf = (id: string) => {
        const k = seeds.indexOf(id)
        return k < 0 ? 999 : k
      }
      const [high, low] = seedOf(x) <= seedOf(y) ? [x, y] : [y, x]
      out.push(newSeries(roundNo, conf, high, low, 7))
    }
  }
  return out
}

function crown(state: GameState, final: SeriesState): void {
  const po = state.playoffs as PlayoffState
  po.championTeamId = final.winnerTeamId
  po.runnerUpTeamId = final.winnerTeamId === final.highTeamId ? final.lowTeamId : final.highTeamId
  if (final.winnerTeamId) applyFinalsHonors(state, final.games, final.winnerTeamId)
  pushLog(state, {
    date: state.calendar.date,
    yearEnd: state.season.yearEnd,
    kind: 'phase',
    text: `${po.championTeamId} win the ${state.season.seasonId} championship`,
  })
}

/** One playoff day: every live series plays a game. Returns true while the playoffs continue. */
export function playoffDay(state: GameState, hooks: GameHooks, rng: Rng): boolean {
  const po = state.playoffs as PlayoffState
  const live = (po.rounds[po.rounds.length - 1] as SeriesState[]).filter((s) => !s.winnerTeamId)
  if (live.length > 0) {
    for (const s of live) advanceSeries(state, hooks, rng, s, state.calendar.date)
    for (const s of live) {
      if (!s.winnerTeamId) continue
      pushLog(state, {
        date: state.calendar.date,
        yearEnd: state.season.yearEnd,
        kind: 'game',
        text: `${s.winnerTeamId} win the series ${Math.max(s.highWins, s.lowWins)}-${Math.min(s.highWins, s.lowWins)} over ${s.winnerTeamId === s.highTeamId ? s.lowTeamId : s.highTeamId}`,
      })
    }
    const final = live.find((s) => s.bracket === 'Finals' && s.winnerTeamId)
    if (final) {
      crown(state, final)
      return false
    }
    return true
  }
  const next = nextRound(state, po)
  if (next && next.length > 0) {
    po.rounds.push(next)
    return true
  }
  const final = (po.rounds[po.rounds.length - 1] as SeriesState[])[0] as SeriesState
  crown(state, final)
  return false
}
