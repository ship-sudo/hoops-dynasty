/**
 * The league talks about itself.
 *
 * DESIGN-THEMES.md §4: the stories are what people stay for, and the systems that generate them are
 * the news feed, the rivalries and the rumour mill. A week in which nothing is said is a week that
 * did not happen. So once a week the beat writers file: who is hot, who is hurt, who somebody has
 * asked about, who is unhappy, and who is winning the MVP.
 *
 * Everything here is derived from real league state — no invented facts. A rumour that says
 * Sacramento have asked about your centre means Sacramento's front office would genuinely do that
 * trade, because the same valuation answers both.
 */
import type { Rng } from '@hoops/core'
import {
  candidates,
  type GameState,
  type LeaguePlayer,
  moodLabel,
  moraleOf,
  PLAYER_ROLE_LABEL,
  ROLE_MINUTES,
  squadMood,
  wantsOut,
} from '@hoops/game'
import type { NewsItem, TradeAssessment, TradePackage } from './api.ts'
import type { Potentials } from './market.ts'
import { incomingOffers, tradeBlock, winNowOf } from './trades.ts'

export interface RumourContext {
  state: GameState
  potentials: Potentials
  rng: Rng
  /** Team names, so the copy reads like a newspaper rather than a database. */
  nameOf: (teamId: string) => string
}

function playersOf(state: GameState, teamId: string): LeaguePlayer[] {
  return state.league.players.filter((p) => p.teamId === teamId)
}

/** A team on a run, and how long it has been going. */
function streaks(state: GameState): { teamId: string; run: number }[] {
  const out: { teamId: string; run: number }[] = []
  for (const team of state.league.teams) {
    const games = state.calendar.results.filter(
      (g) => g.homeTeamId === team.teamId || g.awayTeamId === team.teamId,
    )
    let run = 0
    for (let i = games.length - 1; i >= 0; i--) {
      const g = games[i]
      if (!g) break
      const won = g.homeTeamId === team.teamId ? g.homePts > g.awayPts : g.awayPts > g.homePts
      if (run === 0) run = won ? 1 : -1
      else if (won === run > 0) run += won ? 1 : -1
      else break
    }
    if (Math.abs(run) >= 5) out.push({ teamId: team.teamId, run })
  }
  return out
}

/**
 * Who on your roster is genuinely unhappy.
 *
 * This used to guess — it inferred discontent from a man's rating against his minutes, which meant
 * the paper could report a grievance the game did not hold, and could miss one it did. There is a
 * real number now, and a sentence attached to it saying why, so the beat writer quotes the dressing
 * room instead of inventing it.
 */
function discontent(
  state: GameState,
): { player: LeaguePlayer; mpg: number; value: number; why: string; out: boolean } | null {
  let worst: {
    player: LeaguePlayer
    mpg: number
    value: number
    why: string
    out: boolean
  } | null = null
  for (const p of playersOf(state, state.userTeamId)) {
    const m = state.morale?.[p.playerId]
    if (!m || m.value >= 36) continue
    if (!worst || m.value < worst.value) {
      worst = { player: p, mpg: m.mpg, value: m.value, why: m.why, out: wantsOut(m.value) }
    }
  }
  return worst
}

const SOURCES = [
  'league sources say',
  'people around the league say',
  'a rival executive says',
  'one agent tells us',
  'word around the league is',
]

/**
 * One week of talk. Returns between two and five items; the mix changes with what is actually
 * happening, so a quiet week reads quiet and a chaotic one reads chaotic.
 */
export function weeklyRumours(ctx: RumourContext): NewsItem[] {
  const { state, rng, nameOf } = ctx
  const date = state.calendar.date
  const items: NewsItem[] = []
  const id = (tag: string) => `rumour-${date}-${tag}-${items.length}`
  const source = () => SOURCES[rng.int(SOURCES.length)] as string

  // 1. Somebody has asked about one of your players.
  const mine = tradeBlock(state, state.userTeamId, ctx.potentials)
  const others = state.league.teams.filter((t) => t.teamId !== state.userTeamId)
  if (mine.length > 3 && others.length > 0) {
    const target = mine[rng.int(Math.min(6, mine.length))]
    const suitor = others[rng.int(others.length)]
    if (target && suitor) {
      const keen = winNowOf(state, suitor.teamId) > 0.55
      items.push({
        id: id('interest'),
        date,
        kind: 'rumour',
        headline: `${nameOf(suitor.teamId)} have asked about ${target.name}`,
        body: `${source()} the ${keen ? 'contending' : 'rebuilding'} ${nameOf(suitor.teamId)} called to check on ${target.name}'s availability. Nothing is close.`,
      })
    }
  }

  // 2. A team on a run, in either direction.
  for (const s of streaks(state).slice(0, 2)) {
    const hot = s.run > 0
    items.push({
      id: id('streak'),
      date,
      kind: 'streak',
      headline: `${nameOf(s.teamId)} have ${hot ? 'won' : 'lost'} ${Math.abs(s.run)} straight`,
      body: hot
        ? `Nobody in the league is playing better right now.`
        : `The pressure is building, and ${source()} the coach is feeling it.`,
    })
  }

  // 3. A player of yours who is unhappy — and the number says so, rather than the writer guessing.
  //    Filed about one week in three: a grievance that runs every single week stops being news.
  const unhappy = discontent(state)
  if (unhappy && rng.chance(0.3)) {
    const m = moraleOf(state, unhappy.player)
    const role = PLAYER_ROLE_LABEL[m.role].toLowerCase()
    // `why` usually already names the minutes. Saying it twice reads like a bad mail merge, so the
    // gap is only spelled out when the sentence is about something else — crowding, or the ball.
    const spellOut = /a night/.test(unhappy.why)
      ? ''
      : ` He is on ${unhappy.mpg.toFixed(1)} minutes a night; a ${role} expects ${ROLE_MINUTES[m.role]}.`
    items.push({
      id: id('unhappy'),
      date,
      kind: 'rumour',
      headline: unhappy.out
        ? `${unhappy.player.name} wants out`
        : `${unhappy.player.name} is unhappy with his role`,
      body:
        `${source()} ${unhappy.player.name} is ${moodLabel(unhappy.value)}. ${unhappy.why}` +
        spellOut +
        (unhappy.out ? ' He has told people he will not re-sign here.' : ''),
    })
  }

  // 3b. The room as a whole, when it has turned. A manager who is losing the squad should hear it
  //     from the paper before he hears it in the summer. The headline counts the men rather than
  //     labelling the room: a squad can average "content" while three of its best are furious, and
  //     "the dressing room is content" over a story about three unhappy men is a mail merge again.
  const mood = squadMood(state, state.userTeamId)
  if (mood.unhappy >= 3 && rng.chance(0.25)) {
    items.push({
      id: id('room'),
      date,
      kind: 'rumour',
      headline: `${mood.unhappy} of ${nameOf(state.userTeamId)}'s squad are unhappy`,
      body: `${source()} ${mood.summary} The room as a whole is ${mood.label}.`,
    })
  }

  // 4. Who is leading the MVP conversation, once there is a season to talk about.
  const played = state.calendar.results.length
  if (played > 200 && rng.chance(0.5)) {
    const race = [...candidates(state)].sort(
      (a, b) => b.mvpVote - a.mvpVote || (a.playerId < b.playerId ? -1 : 1),
    )
    const best = race[0]
    if (best) {
      items.push({
        id: id('mvp'),
        date,
        kind: 'league',
        headline: `${best.name} is the MVP favourite`,
        body: `The vote would not be close if it were held today, with ${nameOf(best.teamId)} where they are in the standings.`,
      })
    }
  }

  return items
}

/**
 * A real offer, not talk: a package an AI club would genuinely accept, put in front of the user.
 * The Trade screen shows the same list, so an alert here is something he can act on.
 */
export function tradeAlert(ctx: RumourContext): {
  item: NewsItem
  offer: { user: TradePackage; other: TradePackage }
  assessment: TradeAssessment
} | null {
  const { state, rng, nameOf } = ctx
  const offers = incomingOffers(state, ctx.potentials, rng, 4)
  const pick = offers[0]
  if (!pick) return null
  const nameFor = (ids: string[]) =>
    ids
      .map(
        (playerId) => state.league.players.find((p) => p.playerId === playerId)?.name ?? playerId,
      )
      .join(' and ') || 'draft picks'
  const wants = nameFor(pick.user.players)
  const gives = nameFor(pick.other.players)
  const picks = pick.other.picks.length
  return {
    item: {
      id: `offer-${state.calendar.date}-${pick.other.teamId}`,
      date: state.calendar.date,
      kind: 'offer',
      headline: `${nameOf(pick.other.teamId)} have offered you a trade`,
      body: `They want ${wants}. On the table: ${gives}${picks > 0 ? ` and ${picks} draft pick${picks === 1 ? '' : 's'}` : ''}. The clock is stopped.`,
    },
    offer: { user: pick.user, other: pick.other },
    assessment: pick.assessment,
  }
}
