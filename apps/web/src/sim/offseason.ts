/** Draft, market, payroll. The summer is played through these, not Continue. */
import { makeRng } from '@hoops/core'
import { scout } from '@hoops/draftclass'
import { salariesFor } from '@hoops/frontoffice'
import { simDay as gameSimDay, onTheClock, openDraft, rolloverBegin } from '@hoops/game'
import { overall } from '@hoops/progression'
import type { FreeAgentView, OffseasonState, ScoutedView, TeamFinance } from './api.ts'
import {
  askingFrom,
  backfillPool,
  freeAgentPool,
  runMarketDay,
  seasonTaxBills,
  signRookies,
} from './market.ts'
import { type DynastySession, fullClubName, PLAYING, rngFor } from './session.ts'
import { scoutingOf } from './staff.ts'
import { withTeamNames } from './views.ts'

export function financeOf(
  s: DynastySession,
  teamId: string,
  yearEnd = s.current.season.yearEnd,
): TeamFinance {
  const squad = s.current.league.players.filter((p) => p.teamId === teamId)
  const rules = s.current.season.rules
  const salaries = salariesFor(
    squad.map((p) => ({ playerId: p.playerId, contract: p.contract })),
    yearEnd,
  )
  const payrollAmt = salaries.reduce((t, x) => (x.kind === 'two_way' ? t : t + x.amount), 0)
  const deadCap = (s.current.deadMoney ?? [])
    .filter((d) => d.teamId === teamId && d.yearEnd === yearEnd)
    .reduce((t, d) => t + d.amount, 0)
  const bills = seasonTaxBills(s.current, yearEnd)
  const mine = bills.find((b) => b.teamId === teamId)
  return {
    teamId,
    payroll: payrollAmt + deadCap,
    cap: rules.cap,
    taxLine: rules.tax_line ?? rules.cap,
    apron1: rules.apron_1,
    apron2: rules.apron_2,
    roster: squad.length,
    rosterMin: rules.roster_min,
    rosterMax: rules.roster_max,
    rosterActive: rules.roster_active,
    deadCap,
    taxBill: mine?.bill ?? 0,
    repeater: mine?.repeater ?? false,
  }
}

/** The lottery, then the board. Safe to call repeatedly. */
export function ensureDraftOpen(s: DynastySession): void {
  if (s.current.phase === 'lottery') {
    const out = gameSimDay(s.current, s.hooks)
    s.current = out.state
  }
  if (s.current.phase === 'draft' && s.current.draft)
    openDraft(s.current, s.hooks, rngFor(s, 'board'))
}

/**
 * Close the books on last season and open the market: ages, contracts and development happen
 * here, then rookie deals and the undrafted backfill, so what the user sees is the real pool.
 */
export function openMarket(s: DynastySession): void {
  if (s.marketOpen) return
  const rng = rngFor(s, 'rollover')
  rolloverBegin(s.current, s.hooks, rng)
  const yearEnd = s.current.season.yearEnd + 1
  signRookies(s.current, yearEnd)
  backfillPool(s.current, yearEnd, rng, s.potentials)
  s.marketOpen = true
}

const logSigning = (
  s: DynastySession,
  playerId: string,
  amount: number,
  years: number,
  teamId: string,
): void => {
  const name = s.current.league.players.find((p) => p.playerId === playerId)?.name ?? playerId
  const yours = teamId === s.current.userTeamId
  s.current.log.push({
    date: s.current.calendar.date,
    yearEnd: s.current.season.yearEnd,
    kind: 'signing',
    text: yours
      ? `Signed ${name} for $${(amount / 1_000_000).toFixed(1)}M over ${years} year${years === 1 ? '' : 's'}`
      : `${name} signed with ${fullClubName(s, teamId)}`,
  })
}

/** One day of the market. Ready bids land; everyone else takes a round. */
export function stepMarket(s: DynastySession): void {
  if (!s.marketOpen) openMarket(s)
  s.marketDay++
  const yearEnd = s.current.season.yearEnd + 1
  const outcome = runMarketDay(
    s.current,
    yearEnd,
    rngFor(s, `market-${s.marketDay}`),
    s.potentials,
    [...s.userOffers.values()],
  )
  s.userOffers.clear()
  for (const o of outcome.pending) s.userOffers.set(o.playerId, o)
  const stolenIds = new Set(outcome.stolen.map((x) => x.playerId))
  let quiet = 0
  for (const signing of outcome.signings) {
    if (stolenIds.has(signing.playerId) || signing.teamId === s.current.userTeamId) continue
    const p = s.current.league.players.find((x) => x.playerId === signing.playerId)
    if (p && overall(p.ratings) >= 58)
      logSigning(s, signing.playerId, signing.amount, signing.years, signing.teamId)
    else quiet++
  }
  if (quiet > 0)
    s.current.log.push({
      date: s.current.calendar.date,
      yearEnd: s.current.season.yearEnd,
      kind: 'signing',
      text: `${quiet} other deal${quiet === 1 ? '' : 's'} around the league`,
    })
  for (const miss of outcome.rejected)
    s.current.log.push({
      date: s.current.calendar.date,
      yearEnd: s.current.season.yearEnd,
      kind: 'signing',
      text: `No deal for ${miss.name}: ${miss.reason}`,
    })
  for (const stolen of outcome.stolen)
    s.current.log.push({
      date: s.current.calendar.date,
      yearEnd: s.current.season.yearEnd,
      kind: 'signing',
      text: `${stolen.name} signed with ${fullClubName(s, stolen.teamId)} — they beat your offer`,
    })
  for (const signing of outcome.signings) {
    if (signing.teamId === s.current.userTeamId)
      logSigning(s, signing.playerId, signing.amount, signing.years, signing.teamId)
  }
}

export function offseasonView(s: DynastySession): OffseasonState {
  const yearEnd = s.current.season.yearEnd
  const draft = s.current.draft
  if (draft?.picks.length)
    s.lastPicks = draft.picks.map((p) => ({
      overall: p.overall,
      round: p.round,
      teamId: p.teamId,
      prospectId: p.prospectId,
      name: p.name,
    }))
  const clock = onTheClock(s.current)
  const phase: OffseasonState['phase'] = PLAYING.has(s.current.phase)
    ? 'done'
    : s.marketOpen
      ? 'freeagency'
      : s.current.phase === 'lottery'
        ? 'lottery'
        : 'draft'

  const board: ScoutedView[] = s.marketOpen
    ? []
    : (draft?.board ?? []).slice(0, 60).map((p, i) => {
        const cached = s.scoutCache.get(p.prospectId)
        if (cached) return cached
        let h = s.current.seed ^ yearEnd
        for (let c = 0; c < p.prospectId.length; c++) h = (h * 31 + p.prospectId.charCodeAt(c)) | 0
        const seen = scout(
          {
            ...p,
            potential: s.potentials.get(p.prospectId) ?? overall(p.ratings) + 5,
            realPick: null,
            playerId: null,
            origin: 'fictional',
          },
          scoutingOf(s.current, s.current.userTeamId),
          makeRng(h),
          (draft?.next ?? 0) + i + 1,
        )
        const view: ScoutedView = {
          prospectId: p.prospectId,
          name: p.name,
          pos: p.pos,
          age: p.age,
          heightIn: p.heightIn,
          ratings: seen.ratings as unknown as Record<string, number>,
          overall: Math.round(overall(seen.ratings)),
          potentialLow: seen.potentialLow,
          potentialHigh: seen.potentialHigh,
          confidence: seen.confidence,
        }
        s.scoutCache.set(p.prospectId, view)
        return view
      })

  const marketYear = yearEnd + 1
  const freeAgents: FreeAgentView[] = s.marketOpen
    ? freeAgentPool(s.current, marketYear, s.potentials)
        .map((fa) => {
          const ask = askingFrom(s.current, fa, s.current.userTeamId)
          const offer = s.userOffers.get(fa.playerId)
          return {
            playerId: fa.playerId,
            name: fa.name,
            pos: s.current.league.players.find((p) => p.playerId === fa.playerId)?.pos ?? 'SF',
            age: fa.age,
            overall: Math.round(overall(fa.ratings)),
            asking: ask.amount,
            askingYears: ask.years,
            offer: offer ? { amount: offer.amount, years: offer.years } : null,
            incumbentTeamId: fa.incumbentTeamId,
          }
        })
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 120)
    : []

  return {
    phase,
    yearEnd,
    picks: draft?.picks.length
      ? draft.picks.map((p) => ({
          overall: p.overall,
          round: p.round,
          teamId: p.teamId,
          prospectId: p.prospectId,
          name: p.name,
        }))
      : s.lastPicks,
    onTheClock: clock
      ? {
          overall: clock.overall,
          round: clock.round,
          teamId: clock.teamId,
          prospectId: clock.prospectId,
          name: clock.name,
        }
      : null,
    yourPick: clock?.teamId === s.current.userTeamId,
    board,
    freeAgents,
    finance:
      s.marketOpen || phase !== 'done'
        ? financeOf(s, s.current.userTeamId, s.marketOpen ? marketYear : yearEnd)
        : null,
    news: s.current.log.slice(-25).map((e, i) => ({
      id: `off-${yearEnd}-${i}`,
      date: e.date,
      kind: e.kind === 'phase' ? ('system' as const) : ('league' as const),
      headline: withTeamNames(s.current, e.text),
      body: '',
    })),
  }
}
