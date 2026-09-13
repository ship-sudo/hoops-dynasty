/**
 * The summer market, in one place so both paths use it: the automatic one (a hook during rollover,
 * used headless and by AI-only saves) and the interactive one, where the user's offers go in first
 * and compete with everyone else's.
 *
 * Order matters and is the real order: rookie-scale deals for this year's draft picks, then a
 * backfill of undrafted players if the league is short, then the market itself.
 */
import type { Rng } from '@hoops/core'
import { type NameBank, undraftedFillers } from '@hoops/draftclass'
import {
  askingPrice,
  birdRights,
  capSpace,
  contractFrom,
  type FaTeam,
  type FreeAgent,
  isTaxRepeater,
  maxOfferFor,
  maxSalary,
  minSalary,
  payroll,
  rookieContract,
  runFreeAgency,
  type Signing,
  salariesFor,
  taxBill,
} from '@hoops/frontoffice'
import {
  askingMultiplier,
  type GameState,
  type LeaguePlayer,
  moraleValue,
  wantsOut,
} from '@hoops/game'
import { overall } from '@hoops/progression'

export type Potentials = Map<string, number>

/** A bid the user has placed. Resolved alongside the AI's offers, not ahead of them. */
export interface UserOffer {
  playerId: string
  amount: number
  years: number
}

/** Draft picks sign with the team that took them; they never reach the open market. */
export function signRookies(state: GameState, yearEnd: number): void {
  const rules = state.season.rules
  for (const p of state.league.players) {
    if (p.contract || !p.draft || p.teamId === null) continue
    if (p.draft.year !== state.season.yearEnd) continue
    p.contract = rookieContract(
      rules,
      p.teamId,
      yearEnd,
      p.draft.round === 1 ? p.draft.pick : p.draft.pick + 30,
      p.draft.round === 1 ? 1 : 2,
    )
  }
}

/**
 * Undrafted free agents. Two draft rounds do not replace everyone who retires, and a real league
 * backfills from the G League, Europe and training camp. Without this the pool drains year on year.
 */
export function backfillPool(
  state: GameState,
  yearEnd: number,
  rng: Rng,
  potentials: Potentials,
  bank?: NameBank,
): void {
  const rules = state.season.rules
  const needed = state.league.teams.length * (rules.roster_max - 1)
  const shortfall = needed - state.league.players.length
  if (shortfall <= 0) return
  for (const p of undraftedFillers(yearEnd, rng, shortfall, bank)) {
    potentials.set(p.prospectId, p.potential)
    state.league.players.push({
      playerId: p.prospectId,
      name: p.name,
      pos: p.pos,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      yearsPro: 0,
      yearsWithTeam: 0,
      debutYear: yearEnd,
      teamId: null,
      contract: null,
      ratings: p.ratings,
      tendencies: p.tendencies,
      mpgHint: 0,
      draft: null,
    })
  }
}

/**
 * Everyone without a deal for the coming season.
 *
 * A man you left furious does not come back. Dropping his incumbent club costs that club its Bird
 * rights on him and the small loyalty edge every other bidder has to beat, which is exactly what
 * losing a player in free agency feels like: he was yours to keep until he wasn't.
 */
export function freeAgentPool(
  state: GameState,
  yearEnd: number,
  potentials: Potentials,
): FreeAgent[] {
  const pool: FreeAgent[] = []
  for (const p of state.league.players) {
    if (p.contract?.years.some((y) => y.yearEnd === yearEnd)) continue
    const out = wantsOut(moraleValue(state, p.playerId))
    pool.push({
      playerId: p.playerId,
      name: p.name,
      ratings: p.ratings,
      age: p.age,
      potential: potentials.get(p.playerId) ?? overall(p.ratings) + 3,
      contract: null,
      yearsOfService: p.yearsPro,
      incumbentTeamId: out ? null : p.teamId,
      yearsWithIncumbent: out ? 0 : p.yearsWithTeam,
    })
  }
  return pool
}

/**
 * What he wants from *this* club. An unhappy man does not ask the league for more — he asks the
 * people who made him unhappy for more, and takes a small discount to stay somewhere he is happy.
 */
export function askingFrom(
  state: GameState,
  fa: FreeAgent,
  teamId: string,
): { amount: number; years: number } {
  const base = askingPrice(fa, state.season.rules)
  if (teamId !== fa.incumbentTeamId && !hasPlayedFor(state, fa.playerId, teamId)) return base
  const mult = askingMultiplier(moraleValue(state, fa.playerId))
  return { amount: Math.round(base.amount * mult), years: base.years }
}

/** What he would take to stay, whether that is a re-sign or an extension. */
export function askingToStay(
  state: GameState,
  p: LeaguePlayer,
  potentials: Potentials,
): { amount: number; years: number } {
  const fa: FreeAgent = {
    playerId: p.playerId,
    name: p.name,
    ratings: p.ratings,
    age: p.age,
    potential: potentials.get(p.playerId) ?? overall(p.ratings) + 3,
    contract: null,
    yearsOfService: p.yearsPro,
    incumbentTeamId: p.teamId,
    yearsWithIncumbent: p.yearsWithTeam,
  }
  return askingFrom(state, fa, state.userTeamId)
}

/**
 * Add years onto a deal he already has. Bird rights cover it: you can always pay your own man.
 * A free agent whose deal is up belongs in the summer market, not here.
 */
export function extendPlayer(
  state: GameState,
  playerId: string,
  amount: number,
  years: number,
  potentials: Potentials,
): { ok: boolean; message: string } {
  const p = state.league.players.find((x) => x.playerId === playerId)
  if (!p || p.teamId !== state.userTeamId)
    return { ok: false, message: 'He is not yours to extend.' }
  if (!p.contract) return { ok: false, message: 'He has no deal to extend. Bid in free agency.' }
  if (wantsOut(moraleValue(state, playerId)))
    return { ok: false, message: 'He will not re-sign here, whatever you offer.' }
  const yearEnd = state.season.yearEnd
  const remaining = p.contract.years.filter((y) => y.yearEnd >= yearEnd)
  if (remaining.length === 0) return { ok: false, message: 'His deal is up. Bid in free agency.' }
  const add = Math.max(1, Math.min(5, Math.round(years)))
  if (remaining.length + add > 5)
    return {
      ok: false,
      message: `A deal cannot run more than five years. He has ${remaining.length} left.`,
    }
  const rules = state.season.rules
  const ask = askingToStay(state, p, potentials)
  const max = maxSalary(rules, p.yearsPro)
  const min = minSalary(rules, p.yearsPro)
  const first = Math.min(max, Math.max(min, Math.round(amount)))
  if (first + 1 < ask.amount * 0.9)
    return { ok: false, message: `He wants about ${money(ask.amount)} to stay.` }
  const last = Math.max(...p.contract.years.map((y) => y.yearEnd))
  const extra = contractFrom(
    {
      teamId: p.teamId,
      playerId: p.playerId,
      amount: first,
      years: add,
      kind: 'standard',
    },
    last + 1,
  )
  p.contract = {
    ...p.contract,
    kind: 'standard',
    source: 'generated',
    years: [...p.contract.years, ...extra.years],
  }
  state.log.push({
    date: state.calendar.date,
    yearEnd,
    kind: 'contract',
    text: `Extended ${p.name} at ${money(first)} for ${add} more year${add === 1 ? '' : 's'}`,
  })
  return {
    ok: true,
    message: `Extended ${p.name} at ${money(first)} for ${add} more year${add === 1 ? '' : 's'}.`,
  }
}

/** The club he is actually leaving, whatever the pool says about his Bird rights. */
function hasPlayedFor(state: GameState, playerId: string, teamId: string): boolean {
  return state.league.players.some((p) => p.playerId === playerId && p.teamId === teamId)
}

/** Each club as the market sees it: what it has spent, how good it is, and what it needs. */
export function marketTeams(state: GameState, yearEnd: number): FaTeam[] {
  return state.league.teams.map((t) => {
    const squad = state.league.players.filter(
      (p) => p.teamId === t.teamId && p.contract?.years.some((y) => y.yearEnd === yearEnd),
    )
    const record = state.history.at(-1)?.standings?.find((s) => s.teamId === t.teamId)
    const wins = record?.wins ?? 41
    return {
      teamId: t.teamId,
      salaries: salariesFor(
        squad.map((p) => ({ playerId: p.playerId, contract: p.contract })),
        yearEnd,
      ),
      rosterCount: squad.length,
      projectedWins: wins,
      winNow: Math.min(1, Math.max(0, (wins - 25) / 30)),
      rotation: squad.slice(0, 9).map((p) => p.ratings),
    }
  })
}

export function whatHeWants(state: GameState, fa: FreeAgent): { amount: number; years: number } {
  return askingPrice(fa, state.season.rules)
}

/** One club's tax bill for a season. */
export interface TaxBill {
  teamId: string
  payroll: number
  taxLine: number
  bill: number
  repeater: boolean
}

/**
 * Assess the luxury tax on the payroll every club has committed for `yearEnd`.
 *
 * Repeater status comes from seasons this save actually billed, not from real-world history: a
 * club that paid in three of the prior four (or all of the prior three, in 2014-15) is charged
 * the surcharge. Old saves start with an empty ledger, so nobody is a repeater on night one.
 */
export function seasonTaxBills(state: GameState, yearEnd: number): TaxBill[] {
  const rules = state.season.rules
  const line = rules.tax_line
  if (line == null) return []
  const paid = state.taxPaid ?? {}
  const rule = rules.tax_rates?.repeater_rule ?? null
  const out: TaxBill[] = []
  for (const t of state.league.teams) {
    const squad = state.league.players.filter((p) => p.teamId === t.teamId)
    const salaries = salariesFor(
      squad.map((p) => ({ playerId: p.playerId, contract: p.contract })),
      yearEnd,
    )
    const repeater = isTaxRepeater(paid[t.teamId] ?? [], yearEnd, rule)
    const bill = taxBill(salaries, rules, { repeater })
    if (bill <= 0) continue
    out.push({ teamId: t.teamId, payroll: payroll(salaries), taxLine: line, bill, repeater })
  }
  return out.sort((a, b) => b.bill - a.bill)
}

/** Remember who paid this year, so next summer's repeater test has something to read. */
export function recordTaxBills(state: GameState, yearEnd: number, bills: TaxBill[]): void {
  if (bills.length === 0) return
  const paid = { ...(state.taxPaid ?? {}) }
  for (const b of bills) {
    const years = paid[b.teamId] ?? []
    if (!years.includes(yearEnd)) paid[b.teamId] = [...years, yearEnd]
  }
  state.taxPaid = paid
}

function apply(state: GameState, signing: Signing, yearEnd: number): void {
  const player = state.league.players.find((p) => p.playerId === signing.playerId)
  if (!player) return
  const stayed = signing.teamId === player.teamId
  player.teamId = signing.teamId
  player.contract = contractFrom(signing, yearEnd)
  player.yearsWithTeam = stayed ? player.yearsWithTeam + 1 : 0
}

/** Why an offer of yours went nowhere. The user is owed an explanation, not a silent failure. */
export interface RejectedOffer {
  playerId: string
  name: string
  reason: string
}

function money(n: number): string {
  const m = n / 1_000_000
  return `$${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`
}

/**
 * Try to land the manager's bids. `patient` leaves a short offer on the table so he can raise it
 * tomorrow; `strict` (the end of summer) rejects anything under the ask.
 */
function tryUserOffers(
  state: GameState,
  yearEnd: number,
  potentials: Potentials,
  userOffers: UserOffer[],
  patient: boolean,
): { signings: Signing[]; userSigned: string[]; rejected: RejectedOffer[]; pending: UserOffer[] } {
  const rules = state.season.rules
  const pool = freeAgentPool(state, yearEnd, potentials)
  const userTeam = marketTeams(state, yearEnd).find((t) => t.teamId === state.userTeamId)
  const salaries = userTeam ? [...userTeam.salaries] : []
  let roster = userTeam?.rosterCount ?? 0
  const signings: Signing[] = []
  const userSigned: string[] = []
  const rejected: RejectedOffer[] = []
  const pending: UserOffer[] = []

  for (const offer of userOffers) {
    const fa = pool.find((p) => p.playerId === offer.playerId)
    if (!fa || !userTeam) continue

    const ask = askingFrom(state, fa, state.userTeamId)

    if (roster >= rules.roster_max) {
      rejected.push({
        playerId: fa.playerId,
        name: fa.name,
        reason: `your roster is full at ${rules.roster_max}`,
      })
      continue
    }

    const rights =
      fa.incumbentTeamId === state.userTeamId ? birdRights(fa.yearsWithIncumbent, rules) : 'none'
    const individualMax = maxSalary(rules, fa.yearsOfService)
    const teamCeiling =
      rights === 'full' ? individualMax : maxOfferFor(salaries, rules, fa.yearsOfService)
    const ceiling = Math.min(individualMax, teamCeiling)
    const binding =
      individualMax <= teamCeiling
        ? `the individual maximum for his service is ${money(individualMax)}`
        : capSpace(salaries, rules, roster) > 0
          ? `you have ${money(teamCeiling)} of cap room`
          : `you are over the cap; the exception you have left is ${money(teamCeiling)}`

    const amount = Math.min(offer.amount, ceiling)

    if (amount + 1 < ask.amount) {
      // A short bid waits for you to raise it. A bid that met his price but the cap will not
      // let you pay is a decision today — otherwise the wire stays quiet and it looks like
      // nothing happened.
      if (patient && offer.amount + 1 < ask.amount) {
        pending.push(offer)
        continue
      }
      rejected.push({
        playerId: fa.playerId,
        name: fa.name,
        reason:
          amount < offer.amount
            ? `he wants ${money(ask.amount)}, your bid was cut to ${money(amount)} — ${binding}`
            : `he wants ${money(ask.amount)} and you offered ${money(amount)}`,
      })
      continue
    }

    const signing: Signing = {
      teamId: state.userTeamId,
      playerId: fa.playerId,
      amount,
      years: Math.max(1, Math.min(5, offer.years)),
      kind: amount <= rules.min_salary_0yr * 1.05 ? 'minimum' : 'standard',
    }
    apply(state, signing, yearEnd)
    signings.push(signing)
    userSigned.push(fa.playerId)
    salaries.push({ playerId: fa.playerId, amount: signing.amount, kind: signing.kind })
    roster++
  }

  return { signings, userSigned, rejected, pending }
}

/**
 * One day of free agency: land any of your bids that meet his price, then one round of everyone
 * else. Short offers stay on the table. The books do not close — call `runMarket` for that.
 */
export function runMarketDay(
  state: GameState,
  yearEnd: number,
  rng: Rng,
  potentials: Potentials,
  userOffers: UserOffer[] = [],
): {
  signings: Signing[]
  userSigned: string[]
  rejected: RejectedOffer[]
  pending: UserOffer[]
  stolen: { playerId: string; name: string; teamId: string }[]
} {
  const rules = state.season.rules
  const user = tryUserOffers(state, yearEnd, potentials, userOffers, true)
  const rest = freeAgentPool(state, yearEnd, potentials).filter(
    (p) => !user.userSigned.includes(p.playerId),
  )
  const wave = runFreeAgency(rest, marketTeams(state, yearEnd), rules, yearEnd, rng, {
    rounds: 1,
    fillTo: rules.roster_max - 1,
    fill: false,
  })
  const stillOffered = new Set(user.pending.map((o) => o.playerId))
  const stolen: { playerId: string; name: string; teamId: string }[] = []
  const pending: UserOffer[] = []
  for (const s of wave) {
    apply(state, s, yearEnd)
    if (stillOffered.has(s.playerId) && s.teamId !== state.userTeamId) {
      const name = state.league.players.find((p) => p.playerId === s.playerId)?.name ?? s.playerId
      stolen.push({ playerId: s.playerId, name, teamId: s.teamId })
    }
  }
  for (const o of user.pending) {
    if (stolen.some((x) => x.playerId === o.playerId)) continue
    pending.push(o)
  }
  return {
    signings: [...user.signings, ...wave],
    userSigned: user.userSigned,
    rejected: user.rejected,
    pending,
    stolen,
  }
}

/**
 * Run the whole summer. `userOffers` are honoured first — a player who has an offer from the user
 * that beats what he is asking takes it, which is the one advantage of being the manager; anything
 * short of his asking price goes into the general market with everyone else's bids.
 */
export function runMarket(
  state: GameState,
  yearEnd: number,
  rng: Rng,
  potentials: Potentials,
  userOffers: UserOffer[] = [],
  bank?: NameBank,
): { signings: Signing[]; userSigned: string[]; rejected: RejectedOffer[]; tax: TaxBill[] } {
  const rules = state.season.rules
  signRookies(state, yearEnd)
  backfillPool(state, yearEnd, rng, potentials, bank)

  const user = tryUserOffers(state, yearEnd, potentials, userOffers, false)
  const rest = freeAgentPool(state, yearEnd, potentials).filter(
    (p) => !user.userSigned.includes(p.playerId),
  )
  const signings = [...user.signings]
  const userSigned = user.userSigned
  const rejected = user.rejected

  const market = runFreeAgency(rest, marketTeams(state, yearEnd), rules, yearEnd, rng, {
    fillTo: rules.roster_max - 1,
  })
  for (const s of market) {
    apply(state, s, yearEnd)
    signings.push(s)
  }

  // Anyone nobody signed becomes a free agent rather than vanishing: veterans do sit out a summer
  // and come back. Only the ones with no way back leave the league for good.
  state.league.players = state.league.players.filter((p: LeaguePlayer) => {
    if (p.contract?.years.some((y) => y.yearEnd >= yearEnd)) return true
    p.teamId = null
    return p.age <= 35 && overall(p.ratings) >= 35
  })

  // The books close on the summer: whoever is over the line is billed for it, in the log.
  const tax = seasonTaxBills(state, yearEnd)
  recordTaxBills(state, yearEnd, tax)
  const nameOf = (teamId: string) => {
    const t = state.league.teams.find((x) => x.teamId === teamId)
    return t ? `${t.city} ${t.name}` : teamId
  }
  for (const t of tax)
    state.log.push({
      date: state.calendar.date,
      yearEnd,
      kind: 'note',
      text: `${nameOf(t.teamId)} owe ${money(t.bill)} in luxury tax${t.repeater ? ' (repeater)' : ''} on a ${money(t.payroll)} payroll (line ${money(t.taxLine)})`,
    })

  return { signings, userSigned, rejected, tax }
}
