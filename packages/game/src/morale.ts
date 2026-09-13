/**
 * Roles and morale — the rule that tells the manager no.
 *
 * DESIGN-THEMES.md §9: the most-missed mechanic in twenty years of 2K franchise modes is the one
 * that refused you something.
 *
 *   "players had a role (Superstar, Star, Starter, Role Player, Bench Warmer) and it really threw
 *    off your team morale if they weren't getting the minutes they wanted. So you couldn't just
 *    stack your team, since then they'd be unhappy."
 *
 * So this is a constraint, not a chore list. There is nothing here to click through: morale is a
 * pressure the manager feels, and the only ways to answer it are decisions he already makes —
 * minutes, contracts, trades. Nothing in this file moves a player or changes a lineup.
 *
 * Three properties it has to have, or it is decoration:
 *
 *  1. **Legible.** Every player's number is the sum of seven named terms, each one a fact the user
 *     can see on a screen: his minutes against what his role expects, his share of the scoring,
 *     how crowded his role is, whether the team is winning, his own form, his tenure, whether he
 *     was just traded and whether he is in a contract year. `why()` reads back the largest
 *     negative term as one sentence.
 *  2. **Predictable.** The target is a pure function of league state. The stored value walks toward
 *     it a little each game, so the manager sees a slide coming and has a month to answer it.
 *  3. **It bites.** Unhappy men play worse (through `condition`, which the engine already reads as
 *     energy), ask for more to re-sign, and stop wanting to stay.
 *
 * The stacking cost is the crowding term. Two men can be the man; five cannot.
 */

import { clamp, type YearEnd } from '@hoops/core'
import { roleRating } from '@hoops/progression'
import type { CapState, GameState, LeaguePlayer, SeasonStatLine } from './state.ts'

/** What a player expects to be. Four rungs, because four is what a manager can act on. */
export type Role = 'star' | 'starter' | 'rotation' | 'bench'

export const ROLES: Role[] = ['star', 'starter', 'rotation', 'bench']

/** Minutes a night each role takes as its due. */
export const ROLE_MINUTES: Record<Role, number> = { star: 34, starter: 28, rotation: 18, bench: 9 }

/** Share of the team's points each role expects to be responsible for. */
export const ROLE_SHARE: Record<Role, number> = {
  star: 0.21,
  starter: 0.145,
  rotation: 0.085,
  bench: 0.045,
}

/**
 * How many men a club can hold at each rung. This is the whole stacking rule in one line: a team
 * has one ball and two headline slots, so the third man who expects to lead is surplus whatever
 * his minutes say.
 */
export const ROLE_ROOM: Record<Role, number> = { star: 2, starter: 5, rotation: 9, bench: 15 }

export const PLAYER_ROLE_LABEL: Record<Role, string> = {
  star: 'Star',
  starter: 'Starter',
  rotation: 'Rotation',
  bench: 'Bench',
}

/** One player's standing in the dressing room. Plain JSON, so it survives a save. */
export interface PlayerMorale {
  /** 0–100. 50 is a professional getting on with it; 55 is where everyone starts. */
  value: number
  /** The role he expects, from what he is and what he is paid. */
  role: Role
  /**
   * The club this record belongs to. When it stops matching the player's team he has been traded,
   * which is how the unsettling of a move is detected without reaching into the trade code.
   */
  teamId: string | null
  /** Games since he changed clubs. 99 means settled. */
  sinceTrade: number
  /** Minutes a night the last update saw, so a card can show the gap without recomputing. */
  mpg: number
  /** The one sentence that explains the number. */
  why: string
}

/** One named contribution to the target. Positive is happy. */
export interface MoraleTerm {
  key: 'minutes' | 'scoring' | 'crowding' | 'winning' | 'form' | 'tenure' | 'trade' | 'contract'
  value: number
  text: string
}

/** Where a morale number came from: the target, and every term that built it. */
export interface MoraleBreakdown {
  role: Role
  target: number
  expectedMpg: number
  mpg: number
  terms: MoraleTerm[]
}

/** Everyone starts here. Not delighted, not sulking. */
export const START_MORALE = 55

/** Fraction of the gap to the target a player closes each game his team plays. */
const INERTIA = 0.06

/** How long a trade unsettles a man, in games. */
const TRADE_GAMES = 20

// ─────────────────────────────────────────────────────────────────────────────
// The role a player expects
// ─────────────────────────────────────────────────────────────────────────────

/** What he is, on the internal scale: 50 an average rotation player, 72 an All-Star. */
export function abilityScore(p: LeaguePlayer): number {
  return roleRating(p.ratings, p.tendencies, p.pos)
}

function roleFromAbility(ability: number): Role {
  return ability >= 70 ? 'star' : ability >= 58 ? 'starter' : ability >= 46 ? 'rotation' : 'bench'
}

function roleFromPay(share: number): Role {
  return share >= 0.2 ? 'star' : share >= 0.105 ? 'starter' : share >= 0.045 ? 'rotation' : 'bench'
}

function higher(a: Role, b: Role): Role {
  return ROLES.indexOf(a) <= ROLES.indexOf(b) ? a : b
}

/** This season's salary, or 0 when he has no deal on the books. */
export function salaryOf(p: LeaguePlayer, yearEnd: YearEnd): number {
  return p.contract?.years.find((y) => y.yearEnd === yearEnd)?.amount ?? 0
}

/**
 * The role a player expects: the better of what he is and what he is paid.
 *
 * A max-salary player expects to be a star even in a bad year, because the club told him so with
 * its chequebook. A minimum-salary veteran expects nothing — unless he is genuinely good, in which
 * case he expects to play and will say so.
 */
export function expectedRole(p: LeaguePlayer, cap: CapState, yearEnd: YearEnd): Role {
  const salary = salaryOf(p, yearEnd)
  const share = cap.cap > 0 ? salary / cap.cap : 0
  return higher(roleFromAbility(abilityScore(p)), roleFromPay(share))
}

// ─────────────────────────────────────────────────────────────────────────────
// The number
// ─────────────────────────────────────────────────────────────────────────────

function line(state: GameState, playerId: string): SeasonStatLine | undefined {
  return state.stats[playerId]
}

/** Where he sits among the men on this roster who expect the same rung, best first. 0 = top. */
function crowdRank(state: GameState, roster: LeaguePlayer[], p: LeaguePlayer, role: Role): number {
  const cap = state.league.cap
  const year = state.season.yearEnd
  const peers = roster.filter((q) => expectedRole(q, cap, year) === role)
  peers.sort((a, b) => abilityScore(b) - abilityScore(a) || (a.playerId < b.playerId ? -1 : 1))
  return peers.findIndex((q) => q.playerId === p.playerId)
}

/**
 * The number a player is drifting toward, and every term that built it. Pure: it reads state and
 * returns arithmetic, so a test can pin any one effect on its own.
 */
export function moraleTarget(
  state: GameState,
  p: LeaguePlayer,
  opts: { sinceTrade?: number } = {},
): MoraleBreakdown {
  const cap = state.league.cap
  const year = state.season.yearEnd
  const role = expectedRole(p, cap, year)
  const roster = p.teamId ? state.league.players.filter((q) => q.teamId === p.teamId) : [p]
  const terms: MoraleTerm[] = []

  const mine = line(state, p.playerId)
  const gp = mine?.gp ?? 0
  const mpg = gp > 0 ? (mine as SeasonStatLine).min / gp : 0
  const expectedMpg = ROLE_MINUTES[role]

  // 1. Minutes against what his role expects. The largest term, because it is the one the
  //    manager sets directly.
  if (gp >= 5) {
    const gap = mpg - expectedMpg
    const v = clamp(gap * (gap < 0 ? 1.7 : 0.5), -26, 6)
    terms.push({
      key: 'minutes',
      value: v,
      text:
        gap < -2
          ? `playing ${mpg.toFixed(1)} a night when a ${PLAYER_ROLE_LABEL[role].toLowerCase()} expects ${expectedMpg}`
          : `getting the ${mpg.toFixed(1)} minutes a ${PLAYER_ROLE_LABEL[role].toLowerCase()} expects`,
    })
  }

  // 2. His share of the scoring. One ball: this is what actually happens when you stack a team,
  //    and it falls out of the box scores rather than being asserted.
  if (gp >= 5 && p.teamId) {
    let teamPts = 0
    for (const q of roster) teamPts += line(state, q.playerId)?.pts ?? 0
    if (teamPts > 0) {
      const mineShare = (mine as SeasonStatLine).pts / teamPts
      const want = ROLE_SHARE[role]
      const v = clamp(((mineShare - want) / want) * 12, -12, 5)
      terms.push({
        key: 'scoring',
        value: v,
        text:
          v < -1
            ? `taking ${(mineShare * 100).toFixed(0)}% of the scoring where his role expects ${(want * 100).toFixed(0)}%`
            : `a big enough part of the offence`,
      })
    }
  }

  // 3. Crowding. Two men can be the man; five cannot. Nothing else in the game says no to a
  //    super-team, and this is the whole point of the mechanic.
  const rank = crowdRank(state, roster, p, role)
  const surplus = rank + 1 - ROLE_ROOM[role]
  if (surplus > 0) {
    const v = clamp(-14 * surplus, -34, 0)
    const others = rank
    terms.push({
      key: 'crowding',
      value: v,
      text: `${others} other men here also expect to be a ${PLAYER_ROLE_LABEL[role].toLowerCase()}`,
    })
  }

  // 4. Winning. Everybody forgives a lot on a good team.
  if (p.teamId) {
    const rec = state.records[p.teamId]
    const played = rec ? rec.wins + rec.losses : 0
    if (played >= 10 && rec) {
      const pct = rec.wins / played
      const v = clamp((pct - 0.5) * 26, -10, 10)
      terms.push({
        key: 'winning',
        value: v,
        text:
          v < 0
            ? `the team is ${rec.wins}-${rec.losses}`
            : `the team is winning at ${rec.wins}-${rec.losses}`,
      })
    }
  }

  // 5. His own form: what he is producing per 36 against what a man of his ability should.
  if (gp >= 10 && mine && mine.min > 0) {
    const per36 = ((mine.pts + 1.2 * (mine.oreb + mine.dreb) + 1.5 * mine.ast) / mine.min) * 36
    const expected = clamp(2 + Math.max(0, abilityScore(p) - 30) * 0.52, 6, 40)
    const v = clamp(((per36 - expected) / expected) * 14, -7, 7)
    terms.push({
      key: 'form',
      value: v,
      text: v < 0 ? `he is not playing well` : `he is playing the best basketball of his year`,
    })
  }

  // 6. Tenure. A man who has been here a while is harder to unsettle.
  if (p.yearsWithTeam > 0) {
    const v = Math.min(5, p.yearsWithTeam) * 1.2
    terms.push({ key: 'tenure', value: v, text: `${p.yearsWithTeam} seasons at the club` })
  }

  // 7. A move unsettles anyone, and it wears off.
  const since = opts.sinceTrade ?? 99
  if (since < TRADE_GAMES) {
    terms.push({
      key: 'trade',
      value: -11 * (1 - since / TRADE_GAMES),
      text: `he was traded here ${since} game${since === 1 ? '' : 's'} ago`,
    })
  }

  // 8. A contract year. Everyone is playing for the next deal and nobody is relaxed about it.
  const last = p.contract?.years.at(-1)
  if (last && last.yearEnd === year) {
    terms.push({ key: 'contract', value: -5, text: `he is in the last year of his deal` })
  }

  let target = 50
  for (const t of terms) target += t.value
  return { role, target: clamp(target, 0, 100), expectedMpg, mpg, terms }
}

/**
 * The one sentence a card shows.
 *
 * A contented man led with his grievance until this was fixed: Tony Parker, 72 and delighted, was
 * reported as "he is in the last year of his deal" because that was his only negative term. A
 * sentence has to agree with the number above it, so the headline follows the mood — what is
 * keeping a happy man happy, what is eating an unhappy one.
 */
export function why(b: MoraleBreakdown): string {
  const sorted = [...b.terms].sort((a, c) => a.value - c.value)
  const worst = sorted[0]
  const best = sorted.at(-1)
  const sentence = (t: MoraleTerm) => `${t.text.charAt(0).toUpperCase()}${t.text.slice(1)}.`
  if (b.target < START_MORALE) {
    if (worst && worst.value <= -2) return sentence(worst)
  } else if (best && best.value >= 2) {
    return sentence(best)
  }
  if (worst && worst.value <= -2) return sentence(worst)
  if (best && best.value >= 2) return sentence(best)
  return 'He has nothing to say either way.'
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────

function fresh(p: LeaguePlayer, role: Role): PlayerMorale {
  return {
    value: START_MORALE,
    role,
    teamId: p.teamId,
    sinceTrade: 99,
    mpg: 0,
    why: 'He has nothing to say either way.',
  }
}

/** One player's record, created content if the save has never seen him. */
export function moraleOf(state: GameState, p: LeaguePlayer): PlayerMorale {
  state.morale ??= {}
  const all = state.morale
  let m = all[p.playerId]
  if (!m) {
    m = fresh(p, expectedRole(p, state.league.cap, state.season.yearEnd))
    all[p.playerId] = m
  }
  return m
}

/** Just the number, for callers that only want to price something. 55 if unknown. */
export function moraleValue(state: GameState, playerId: string): number {
  return state.morale?.[playerId]?.value ?? START_MORALE
}

/**
 * Walk one club's dressing room forward by a game. Called after every game for both rosters, so
 * the number moves for reasons that happened rather than on a timer.
 */
export function updateMorale(state: GameState, teamId: string): void {
  const roster = state.league.players.filter((p) => p.teamId === teamId)
  for (const p of roster) {
    const m = moraleOf(state, p)
    // A change of club is detected here, not signalled from the trade code: nothing else has to
    // know this system exists.
    if (m.teamId !== p.teamId) {
      m.teamId = p.teamId
      m.sinceTrade = 0
    } else if (m.sinceTrade < 99) {
      m.sinceTrade = Math.min(99, m.sinceTrade + 1)
    }
    const b = moraleTarget(state, p, { sinceTrade: m.sinceTrade })
    m.role = b.role
    m.mpg = b.mpg
    m.value = clamp(m.value + (b.target - m.value) * INERTIA, 0, 100)
    m.why = why(b)
  }
}

/**
 * A summer calms everyone down without wiping the slate. Called at rollover, after the roster has
 * settled, so a man who spent a year furious starts the next one merely wary.
 */
export function settleMorale(state: GameState): void {
  const next: Record<string, PlayerMorale> = {}
  for (const p of state.league.players) {
    const old = state.morale?.[p.playerId]
    const role = expectedRole(p, state.league.cap, state.season.yearEnd)
    const value = old
      ? clamp(START_MORALE + (old.value - START_MORALE) * 0.4, 0, 100)
      : START_MORALE
    next[p.playerId] = {
      value,
      role,
      teamId: p.teamId,
      sinceTrade: 99,
      mpg: 0,
      why: 'A new season. Nothing has happened yet.',
    }
  }
  state.morale = next
}

// ─────────────────────────────────────────────────────────────────────────────
// Consequences
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a mood is worth on the floor, as a multiplier on `condition`.
 *
 * The engine already reads `condition` as energy: it seeds it, drains it through the game, and
 * cannot recover a player above it. That makes it the honest door into the simulation for effort —
 * no thumb on the scoreboard, no invented rating. A furious dressing room starts every night a
 * little flat and never gets back; a delighted one has a bit more in the legs late.
 *
 * The scale is deliberately small per possession and large over a season: 0.82 at the floor, 1.05
 * at the ceiling. It is only half the story — see `engagementOf` for the other, and DECISIONS.md
 * for why condition on its own turned out to cancel itself out.
 */
export function effortOf(morale: number): number {
  return clamp(1 + (morale - 55) * 0.005, 0.82, 1.05)
}

/**
 * How much of the ball he still asks for, as a multiplier on his usage tendency.
 *
 * `condition` alone turned out to be a weaker lever than it looks, because it is inside a loop: a
 * flat squad plays fewer hard minutes, so fatigue recovers what the mood took, and over a season
 * the condition the engine actually sees barely moves. Measured on a stacked 2003-04 roster, a 5%
 * effort penalty left the mean condition at the engine unchanged to three decimal places.
 *
 * Engagement is the lever that does not come back. `usageWeight` in the engine picks who finishes
 * each possession by usage *relative to the other four on the floor*, so a man who stops asking
 * for the ball hands those shots to whoever is stood next to him. On a stacked squad that is a
 * minimum-salary body, and the cost is immediate and large. It is also the most recognisable thing
 * an unhappy player does: he stops looking for his shot.
 *
 * Nothing about his skill changes. He is as good as he ever was; he just isn't asking.
 */
export function engagementOf(morale: number): number {
  return clamp(1 + (morale - 55) * 0.004, 0.8, 1.05)
}

/**
 * A switch for the measurement harness only, so a season can be replayed with the dressing room
 * taken out and the difference read off. The game never turns it off; `morale.test.ts` does, to
 * put a number on what the system is worth.
 */
let effectsOn = true

export function setMoraleEffects(on: boolean): void {
  effectsOn = on
}

export function moraleEffectsOn(): boolean {
  return effectsOn
}

/** The effort multiplier for one player, respecting the harness switch. This is what play.ts uses. */
export function effortFor(state: GameState, playerId: string): number {
  return effectsOn ? effortOf(moraleValue(state, playerId)) : 1
}

/** The engagement multiplier for one player, respecting the harness switch. */
export function engagementFor(state: GameState, playerId: string): number {
  return effectsOn ? engagementOf(moraleValue(state, playerId)) : 1
}

/**
 * What he wants to re-sign, as a multiplier on his asking price.
 *
 * A man you have kept happy takes a small discount to stay. A man you have buried wants paying for
 * the year you put him through, and the club that did it pays the premium — nobody else does.
 */
export function askingMultiplier(morale: number): number {
  return clamp(1 + (55 - morale) * 0.005, 0.95, 1.3)
}

/** Below this he will not re-sign with the club that made him feel like this. */
export const WALK_AWAY = 28

/** Has he made up his mind to leave? */
export function wantsOut(morale: number): boolean {
  return morale < WALK_AWAY
}

// ─────────────────────────────────────────────────────────────────────────────
// The dressing room, for a screen
// ─────────────────────────────────────────────────────────────────────────────

export type MoodLabel = 'delighted' | 'happy' | 'content' | 'restless' | 'unhappy' | 'furious'

export function moodLabel(v: number): MoodLabel {
  if (v >= 78) return 'delighted'
  if (v >= 64) return 'happy'
  if (v >= 48) return 'content'
  if (v >= 36) return 'restless'
  if (v >= 24) return 'unhappy'
  return 'furious'
}

export interface SquadMood {
  teamId: string
  /** Minutes-weighted, because the tenth man's sulk is not the same problem as the star's. */
  average: number
  label: MoodLabel
  /** How many men are below `restless`. */
  unhappy: number
  /** The worst of them, worst first, with the reason. */
  worst: { playerId: string; name: string; value: number; role: Role; why: string }[]
  /** One sentence the manager can act on. */
  summary: string
}

export function squadMood(state: GameState, teamId: string): SquadMood {
  const roster = state.league.players.filter((p) => p.teamId === teamId)
  let weighted = 0
  let weight = 0
  const rows: SquadMood['worst'] = []
  for (const p of roster) {
    const m = moraleOf(state, p)
    const w = Math.max(4, m.mpg)
    weighted += m.value * w
    weight += w
    rows.push({ playerId: p.playerId, name: p.name, value: m.value, role: m.role, why: m.why })
  }
  const average = weight > 0 ? weighted / weight : START_MORALE
  rows.sort((a, b) => a.value - b.value)
  const unhappy = rows.filter((r) => r.value < 36).length
  const label = moodLabel(average)
  const worstRow = rows[0]
  const summary =
    roster.length === 0
      ? 'No squad.'
      : unhappy === 0
        ? `The dressing room is ${label}. Nobody is agitating.`
        : `${unhappy} ${unhappy === 1 ? 'man is' : 'men are'} unhappy. ${worstRow ? `${worstRow.name} worst of all: ${worstRow.why.toLowerCase()}` : ''}`
  return { teamId, average, label, unhappy, worst: rows.slice(0, 5), summary }
}
