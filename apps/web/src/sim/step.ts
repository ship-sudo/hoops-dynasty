/** One calendar day: games, rumours, incoming offers, AI-AI trades, injury cover. */
import {
  autoAdjustSettings,
  availabilityOf,
  daysBetween,
  simDay as gameSimDay,
  markInjuryCover,
} from '@hoops/game'
import type { DayReport, PlayedGame, SimInterrupt } from './api.ts'
import { tradeAlert, weeklyRumours } from './rumours.ts'
import {
  BOX_CACHE,
  blankSettings,
  type DynastySession,
  fullClubName,
  PLAYING,
  playerName,
  rngFor,
} from './session.ts'
import { aiTradeRound } from './trades.ts'
import { newsFor } from './views.ts'

export function absorb(
  s: DynastySession,
  games: { gameId: string; homeTeamId?: string; awayTeamId?: string }[],
): void {
  for (let i = 0; i < games.length; i++) {
    const r = s.pending[i]
    const g = games[i]
    if (!r || !g) continue
    s.boxes.set(g.gameId, r)
    if (g.homeTeamId === s.current.userTeamId || g.awayTeamId === s.current.userTeamId)
      s.userBoxes.set(g.gameId, r)
  }
  s.pending.length = 0
  if (s.boxes.size > BOX_CACHE) {
    const drop = s.boxes.size - BOX_CACHE
    let i = 0
    for (const key of s.boxes.keys()) {
      if (i++ >= drop) break
      s.boxes.delete(key)
    }
  }
}

export function report(
  s: DynastySession,
  results: typeof s.current.calendar.results,
  date: string,
  interrupt?: DayReport['interrupt'],
): DayReport {
  const games: PlayedGame[] = results.map((g) => ({
    gameId: g.gameId,
    date: g.date,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    homePts: g.homePts,
    awayPts: g.awayPts,
    overtimes: g.overtimes,
  }))
  const items = newsFor(s.current, games, s.boxes, s.current.userTeamId)
  s.feed.push(...items)
  if (s.feed.length > 400) s.feed.splice(0, s.feed.length - 400)
  return interrupt ? { date, games, news: items, interrupt } : { date, games, news: items }
}

export function applyComputerLineup(s: DynastySession, extraSkip: string[] = []): void {
  const teamId = s.current.userTeamId
  const roster = s.current.league.players.filter((p) => p.teamId === teamId)
  const skip = new Set(extraSkip)
  for (const p of roster) {
    if (availabilityOf(s.current, p.playerId).out > 0) skip.add(p.playerId)
  }
  for (const id of skip) markInjuryCover(s.current, id)
  const existing = s.current.teamSettings[teamId] ?? blankSettings()
  const playoffs = s.current.phase === 'playoffs' || s.current.phase === 'playin'
  s.current.teamSettings[teamId] = autoAdjustSettings(existing, roster, skip, playoffs)
}

export function swallowLineupHit(
  s: DynastySession,
  interrupt: SimInterrupt | null | undefined,
): SimInterrupt | null {
  if (!interrupt || !s.current.autoLineup) return interrupt ?? null
  if (interrupt.kind === 'injury') {
    const a = availabilityOf(s.current, interrupt.playerId)
    a.playingThrough = false
    if (a.out === 0 && a.injury) a.out = Math.max(1, a.injury.games)
    applyComputerLineup(s, [interrupt.playerId])
    return null
  }
  if (interrupt.kind === 'return') {
    applyComputerLineup(s)
    return null
  }
  return interrupt
}

/**
 * One calendar day: games, then the weekly paper, then maybe a live offer that stops Continue.
 * Accepting that offer is executeTrade — it never plays another night.
 */
export function playOneDay(s: DynastySession): DayReport | null {
  if (!PLAYING.has(s.current.phase)) return null
  const before = s.current.calendar.date
  const out = gameSimDay(s.current, s.hooks)
  s.current = out.state
  absorb(s, out.results)
  if (out.results.length === 0 && s.current.calendar.date === before) return null

  let offerHit: SimInterrupt | undefined
  if (s.current.phase === 'regular' && s.lastRumourDate === '') {
    s.lastRumourDate = s.current.calendar.date
  } else if (
    s.current.phase === 'regular' &&
    daysBetween(s.lastRumourDate, s.current.calendar.date) >= 7
  ) {
    s.lastRumourDate = s.current.calendar.date
    const ctx = {
      state: s.current,
      potentials: s.potentials,
      rng: rngFor(s, `rumours-${s.current.calendar.date}`),
      nameOf: (teamId: string) => fullClubName(s, teamId),
    }
    const talk = weeklyRumours(ctx)
    if (ctx.rng.chance(0.35)) {
      const alert = tradeAlert(ctx)
      if (alert) {
        talk.push(alert.item)
        if (!out.interrupt) {
          offerHit = {
            kind: 'offer',
            otherTeamId: alert.offer.other.teamId,
            otherName: fullClubName(s, alert.offer.other.teamId),
            user: alert.offer.user,
            other: alert.offer.other,
            theyWant: alert.offer.user.players.map((id) => playerName(s, id)),
            theyGive: alert.offer.other.players.map((id) => playerName(s, id)),
            theyWantPicks: alert.offer.user.picks.length,
            theyGivePicks: alert.offer.other.picks.length,
            reason: alert.assessment.reason,
            net: alert.assessment.net,
          }
        }
      }
    }
    s.feed.push(...talk)
  }

  if (
    !offerHit &&
    s.current.phase === 'regular' &&
    s.current.calendar.next > 0 &&
    s.current.calendar.next % 90 === 0
  ) {
    for (const deal of aiTradeRound(
      s.current,
      s.potentials,
      rngFor(s, `trades-${s.current.calendar.date}`),
    ))
      s.current.log.push({
        date: s.current.calendar.date,
        yearEnd: s.current.season.yearEnd,
        kind: 'trade',
        text: deal.text,
      })
  }

  const interrupt = swallowLineupHit(s, (out.interrupt as SimInterrupt | null) ?? offerHit)
  return report(s, out.results, s.current.calendar.date, interrupt ?? undefined)
}
