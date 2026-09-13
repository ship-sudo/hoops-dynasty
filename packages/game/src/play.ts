// Play one game and fold it into the state: record, per-player season totals, results list.
// This is the only place the injected engine is called.

import type { GameInput, GameResult, Rng, StatLine, TeamBox, TeamGameInput } from '@hoops/core'
import { emptyStatLine, nightlyLoad } from '@hoops/core'
import {
  conditionAfterReturn,
  escalateInjury,
  injuryChance,
  isWarning,
  nextCondition,
  playThroughRisk,
  rollInjury,
} from '@hoops/injury'
import { daysBetween } from './dates.ts'
import { noteGameRecords } from './history.ts'
import { effortFor, engagementFor, updateMorale } from './morale.ts'
import { buildTeamInput } from './rotation.ts'
import { restoreInjuryCover } from './sit.ts'
import {
  availabilityOf,
  emptyRecord,
  type GameHooks,
  type GameState,
  type GameSummary,
  type LeaguePlayer,
  type LeagueTeam,
  pushLog,
  rosterOf,
  type SeasonType,
  type TeamRecord,
  teamOf,
} from './state.ts'

const STAT_KEYS = Object.keys(emptyStatLine()) as (keyof StatLine)[]

/** The night's workload multiplier per man, read off the input the engine was just handed. */
function loadOf(team: TeamGameInput): Map<string, number> {
  return new Map(team.players.map((p) => [p.playerId, nightlyLoad(p.workRate, team.tactics.pace)]))
}

function record(state: GameState, teamId: string): TeamRecord {
  let r = state.records[teamId]
  if (!r) {
    r = emptyRecord(teamId)
    state.records[teamId] = r
  }
  return r
}

function accumulate(state: GameState, box: TeamBox, teamId: string): void {
  for (const pb of box.players) {
    let s = state.stats[pb.playerId]
    if (!s) {
      s = { ...emptyStatLine(), gp: 0, gs: 0, teamId }
      state.stats[pb.playerId] = s
    }
    s.teamId = teamId
    if (pb.min > 0) s.gp++
    if (pb.starter) s.gs++
    for (const k of STAT_KEYS) s[k] += pb[k]
  }
}

export interface PlayedGame {
  summary: GameSummary
  result: GameResult
}

/**
 * An absence is worth a line in the paper, and a pause on your own roster, once it costs a week.
 * The same threshold fires again when he is cleared — news, not a lineup job. Cover already
 * stamped the minutes to put back; healing does that itself. Knocks sit him without stopping
 * the sim — a jammed finger is not a recap.
 */
export const NEWSWORTHY_GAMES = 5

/** Why a multi-day sim stopped. Ephemeral: lives on DayResult / DayReport, not the save. */
export type SimInterrupt =
  | {
      kind: 'injury'
      playerId: string
      name: string
      games: number
      injuryName: string
      teamId: string
      /** True when this is a knock: he can dress, but playing him risks a real absence. */
      warning: boolean
    }
  | {
      kind: 'allstar'
      date: string
      yearEnd: number
      eastPts: number
      westPts: number
      mvpName: string | null
      yours: string[]
    }
  | {
      kind: 'season'
      yearEnd: number
      mvpName: string | null
      userWins: number
      userLosses: number
    }
  | {
      kind: 'champion'
      yearEnd: number
      championTeamId: string
      championName: string
      runnerUpTeamId: string
      runnerUpName: string
      championWins: number
      runnerUpWins: number
      /** What the Finals meant for the user. */
      yours: 'won' | 'finals' | 'out'
      /** Optional so older interrupts still type-check. */
      finalsMvpName?: string | null
    }
  | {
      kind: 'return'
      playerId: string
      name: string
      /** Length of the spell he just finished, not games remaining. */
      games: number
      injuryName: string
      teamId: string
    }

const pendingInterrupt = new WeakMap<GameState, SimInterrupt>()

/** Pull the day's user-team interrupt, if one was recorded. Cleared so the next day starts clean. */
export function takeSimInterrupt(state: GameState): SimInterrupt | null {
  const hit = pendingInterrupt.get(state) ?? null
  pendingInterrupt.delete(state)
  return hit
}

export function setSimInterrupt(state: GameState, hit: SimInterrupt): void {
  pendingInterrupt.set(state, hit)
}

function rememberUserInjury(
  state: GameState,
  date: string,
  p: LeaguePlayer,
  injury: { games: number; name: string; severity: string },
): void {
  const warning = injury.severity === 'knock'
  if (injury.games >= NEWSWORTHY_GAMES)
    pushLog(state, {
      date,
      yearEnd: state.season.yearEnd,
      kind: 'note',
      text: `${p.name} (${p.teamId ?? 'FA'}) out ${injury.games} game${injury.games === 1 ? '' : 's'}: ${injury.name}`,
    })
  if (p.teamId !== state.userTeamId || warning || injury.games < NEWSWORTHY_GAMES) return
  const hit: SimInterrupt = {
    kind: 'injury',
    playerId: p.playerId,
    name: p.name,
    games: injury.games,
    injuryName: injury.name,
    teamId: p.teamId,
    warning,
  }
  const prev = pendingInterrupt.get(state)
  if (prev && prev.kind !== 'injury' && prev.kind !== 'return') return
  if (prev?.kind === 'injury' && hit.games < prev.games) return
  pendingInterrupt.set(state, hit)
}

function rememberUserReturn(
  state: GameState,
  date: string,
  p: LeaguePlayer,
  games: number,
  injuryName: string,
): void {
  if (p.teamId !== state.userTeamId || games < NEWSWORTHY_GAMES) return
  pushLog(state, {
    date,
    yearEnd: state.season.yearEnd,
    kind: 'note',
    text: `${p.name} is available again after ${games} game${games === 1 ? '' : 's'} out (${injuryName})`,
  })
  const hit: SimInterrupt = {
    kind: 'return',
    playerId: p.playerId,
    name: p.name,
    games,
    injuryName,
    teamId: p.teamId,
  }
  const prev = pendingInterrupt.get(state)
  // A new tear the same night is the more urgent stop. Two returns: keep the longer spell.
  if (prev && prev.kind !== 'return') return
  if (prev?.kind === 'return' && prev.games >= games) return
  pendingInterrupt.set(state, hit)
}

/**
 * The night after. Everyone on the roster either ticks a game off his absence or pays for the
 * minutes he just played, and every fit man rolls for a new injury.
 *
 * This is what used to be missing. `seasonAvailability` was called once a summer and its answer
 * thrown away, so `condition: 1` was hardcoded into every game input and 348 of 380 players
 * finished every season on exactly 82 games. The real figures are 51 of 439 (1998) and 17 of 556
 * (2024), and the gap is why riding five men 48 minutes a night was free.
 */
function settleAfterGame(
  state: GameState,
  rng: Rng,
  roster: LeaguePlayer[],
  box: TeamBox,
  date: string,
  seasonType: SeasonType,
  /** Per-player multiplier on the minutes just played, from the coach's instructions. */
  load: Map<string, number>,
  hooks: GameHooks,
): void {
  const minutesOf = new Map(box.players.map((pb) => [pb.playerId, pb.min]))
  for (const p of roster) {
    const a = availabilityOf(state, p.playerId)
    const rest = a.lastGame ? daysBetween(a.lastGame, date) : 2
    a.lastGame = date
    if (a.out > 0) {
      a.out--
      if (seasonType === 'regular') a.missed++
      // Rest is rest even in a walking boot, but he cannot get back above his recovery ceiling.
      a.condition = nextCondition({
        condition: a.condition,
        minutesPlayed: 0,
        daysRest: rest,
        stamina: p.ratings.stamina,
        ceiling: a.injury ? a.injury.returnCondition : 1,
      })
      if (a.out === 0) {
        a.sinceReturn = 0
        restoreInjuryCover(state, p)
        const spell = a.injury
        if (spell && !isWarning(spell) && spell.games >= NEWSWORTHY_GAMES)
          rememberUserReturn(state, date, p, spell.games, spell.name)
      }
      continue
    }
    restoreInjuryCover(state, p)
    const played = minutesOf.get(p.playerId) ?? 0
    // A man told to get after it on defence, crash the glass and run the floor covers more ground
    // in the same minutes. He is billed for it here, in recovery and in the injury roll, which is
    // the only place a season-long instruction can honestly cost anything.
    const billed = played * (load.get(p.playerId) ?? 1)
    const ceiling =
      a.injury && a.sinceReturn < 24 ? conditionAfterReturn(a.injury, a.sinceReturn) : 1
    a.condition = nextCondition({
      condition: a.condition,
      minutesPlayed: billed,
      daysRest: rest,
      stamina: p.ratings.stamina,
      ceiling,
    })
    if (a.playingThrough && a.injury && isWarning(a.injury)) {
      if (played <= 0) {
        a.injury = { ...a.injury, games: a.injury.games - 1 }
        if (a.injury.games <= 0) {
          a.injury = null
          a.playingThrough = false
        }
        continue
      }
      const forced = hooks.injure?.(p)
      const worse =
        forced !== undefined
          ? forced
          : rng.chance(playThroughRisk(billed, a.condition, p.ratings.durability))
            ? escalateInjury(rng, a.injury)
            : null
      if (!worse) continue
      a.injury = worse
      a.out = worse.games
      a.playingThrough = false
      a.sinceReturn = 0
      a.condition = Math.min(a.condition, worse.returnCondition)
      rememberUserInjury(state, date, p, worse)
      continue
    }
    a.sinceReturn = Math.min(99, a.sinceReturn + 1)
    if (a.sinceReturn >= 24) a.injury = null
    if (played <= 0) continue
    const forced = hooks.injure?.(p)
    const injury =
      forced !== undefined
        ? forced
        : rng.chance(injuryChance(p.ratings.durability, p.age, billed, a.condition, p.yearsPro))
          ? rollInjury(rng, p.ratings.durability)
          : null
    if (!injury) continue
    a.injury = injury
    a.out = injury.games
    a.sinceReturn = 0
    a.condition = Math.min(a.condition, injury.returnCondition)
    rememberUserInjury(state, date, p, injury)
  }
}

/**
 * The dressing room, folded into the two inputs the engine already reads.
 *
 * It reaches the floor here and nowhere else, through nothing the engine did not already have:
 *
 *   `condition` is energy. It seeds it, caps what a man can recover to, and shifts every shot by
 *   `FAT_K * (energy - FAT_REF)`. A flat squad shoots a touch worse and fades a touch sooner.
 *
 *   `tendencies.usage` is how often he finishes a possession, relative to the other four on the
 *   floor. A man who has stopped asking for the ball hands those shots to whoever is next to him.
 *
 * Nothing is added to the scoreboard and no rating is touched: he is as good as he ever was.
 */
function withEffort(state: GameState, side: GameInput['home']): GameInput['home'] {
  return {
    ...side,
    players: side.players.map((p) => {
      const engaged = engagementFor(state, p.playerId)
      return {
        ...p,
        condition: p.condition * effortFor(state, p.playerId),
        ...(engaged === 1
          ? {}
          : { tendencies: { ...p.tendencies, usage: p.tendencies.usage * engaged } }),
      }
    }),
  }
}

/** Sim one matchup. Only regular-season games touch the standings record. */
export function playGame(
  state: GameState,
  hooks: GameHooks,
  rng: Rng,
  game: { gameId: string; date: string; homeTeamId: string; awayTeamId: string },
  seasonType: SeasonType,
  neutralSite = false,
): PlayedGame {
  const home = teamOf(state, game.homeTeamId) as LeagueTeam
  const away = teamOf(state, game.awayTeamId) as LeagueTeam
  const playoffs = seasonType !== 'regular'
  const homeRoster = rosterOf(state, home.teamId)
  const awayRoster = rosterOf(state, away.teamId)
  // Touch every man's record before the rotation reads it, so "missing" means fit and nothing else.
  for (const p of [...homeRoster, ...awayRoster]) availabilityOf(state, p.playerId)
  const opts = {
    yearEnd: state.season.yearEnd,
    availability: state.availability ?? {},
    ...(state.staff ? { staff: state.staff } : {}),
    zoneLegal: state.season.era.zoneLegal,
    date: game.date,
  }
  const input: GameInput = {
    era: state.season.era,
    home: withEffort(
      state,
      buildTeamInput(home, homeRoster, playoffs, state.teamSettings[home.teamId], opts),
    ),
    away: withEffort(
      state,
      buildTeamInput(away, awayRoster, playoffs, state.teamSettings[away.teamId], opts),
    ),
    seasonType,
    ...(neutralSite ? { neutralSite: true } : {}),
  }
  const result = hooks.engine(input, rng.int(2 ** 31))
  const summary: GameSummary = {
    gameId: game.gameId,
    date: game.date,
    homeTeamId: home.teamId,
    awayTeamId: away.teamId,
    homePts: result.home.pts,
    awayPts: result.away.pts,
    overtimes: result.overtimes,
    seasonType,
  }
  if (seasonType !== 'regular') {
    const line = (box: TeamBox, teamId: string) =>
      box.players
        .filter((p) => p.min > 0)
        .map((p) => ({
          playerId: p.playerId,
          teamId,
          pts: p.pts,
          reb: p.oreb + p.dreb,
          ast: p.ast,
          min: p.min,
        }))
    summary.players = [...line(result.home, home.teamId), ...line(result.away, away.teamId)]
  }
  if (seasonType === 'regular') {
    const rh = record(state, home.teamId)
    const ra = record(state, away.teamId)
    const homeWon = result.winner === 'home'
    rh.wins += homeWon ? 1 : 0
    rh.losses += homeWon ? 0 : 1
    ra.wins += homeWon ? 0 : 1
    ra.losses += homeWon ? 1 : 0
    rh.pf += result.home.pts
    rh.pa += result.away.pts
    ra.pf += result.away.pts
    ra.pa += result.home.pts
    rh.h2h[away.teamId] ??= { w: 0, l: 0 }
    ra.h2h[home.teamId] ??= { w: 0, l: 0 }
    ;(rh.h2h[away.teamId] as { w: number; l: number })[homeWon ? 'w' : 'l']++
    ;(ra.h2h[home.teamId] as { w: number; l: number })[homeWon ? 'l' : 'w']++
    if (home.conference === away.conference) {
      rh.confW += homeWon ? 1 : 0
      rh.confL += homeWon ? 0 : 1
      ra.confW += homeWon ? 0 : 1
      ra.confL += homeWon ? 1 : 0
      if (home.division === away.division) {
        rh.divW += homeWon ? 1 : 0
        rh.divL += homeWon ? 0 : 1
        ra.divW += homeWon ? 0 : 1
        ra.divL += homeWon ? 1 : 0
      }
    }
    accumulate(state, result.home, home.teamId)
    accumulate(state, result.away, away.teamId)
  }
  // Six comparisons a man against the single-game book. Cheap enough to run on every line of every
  // game, and there is no other way to know a 61-point night ever happened: the save keeps totals.
  noteGameRecords(state, result.home.players, home.teamId, away.teamId, game.date, playoffs)
  noteGameRecords(state, result.away.players, away.teamId, home.teamId, game.date, playoffs)
  settleAfterGame(
    state,
    rng,
    homeRoster,
    result.home,
    game.date,
    seasonType,
    loadOf(input.home),
    hooks,
  )
  settleAfterGame(
    state,
    rng,
    awayRoster,
    result.away,
    game.date,
    seasonType,
    loadOf(input.away),
    hooks,
  )
  // The dressing room moves for reasons that happened, not on a timer: both squads read their own
  // minutes, their share of the ball and the scoreboard after every game they play.
  updateMorale(state, home.teamId)
  updateMorale(state, away.teamId)
  for (const teamId of [home.teamId, away.teamId]) {
    const s = state.teamSettings[teamId]
    if (s?.sitNext?.length) state.teamSettings[teamId] = { ...s, sitNext: [] }
  }
  state.calendar.results.push(summary)
  return { summary, result }
}
