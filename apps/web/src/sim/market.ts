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
  maxOfferFor,
  maxSalary,
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
}

/**
 * Assess the luxury tax on the payroll every club has committed for `yearEnd`.
 *
 * `taxBill` had been sitting in `packages/frontoffice` unused by anything but its own test since it
 * was written, so a $93.2M payroll against an $84.7M line was simply never charged. It is assessed
 * here, at the close of the summer, because that is the first moment the coming season's payroll is
 * actually known — and the result is written into the league log, so a taxpayer reads about its
 * bill the way it reads about everything else.
 */
export function seasonTaxBills(state: GameState, yearEnd: number): TaxBill[] {
  const rules = state.season.rules
  const line = rules.tax_line
  if (line == null) return []
  const out: TaxBill[] = []
  for (const t of state.league.teams) {
    const squad = state.league.players.filter((p) => p.teamId === t.teamId)
    const salaries = salariesFor(
      squad.map((p) => ({ playerId: p.playerId, contract: p.contract })),
      yearEnd,
    )
    const bill = taxBill(salaries, rules)
    if (bill <= 0) continue
    out.push({ teamId: t.teamId, payroll: payroll(salaries), taxLine: line, bill })
  }
  return out.sort((a, b) => b.bill - a.bill)
}

function apply(state: GameState, signing: Signing, yearEnd: number): void {
  const player = state.league.players.find((p) => p.playerId === signing.playerId)
  if (!player) return
  const stayed = signing.teamId === player.teamId
  player.teamId = signing.teamId
  player.contract = contractFrom(signing, yearEnd)
  player.yearsWithTeam = stayed ? player.yearsWithTeam + 1 : 0
}

/**
 * Run the whole summer. `userOffers` are honoured first — a player who has an offer from the user
 * that beats what he is asking takes it, which is the one advantage of being the manager; anything
 * short of his asking price goes into the general market with everyone else's bids.
 */
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

  const pool = freeAgentPool(state, yearEnd, potentials)
  const userSigned: string[] = []
  const signings: Signing[] = []
  const rejected: RejectedOffer[] = []

  if (userOffers.length > 0) {
    // The user's offers are bound by the same CBA as everyone else's. Cap room, or the right
    // exception, or Bird rights on his own player — and never more than the individual maximum.
    const userTeam = marketTeams(state, yearEnd).find((t) => t.teamId === state.userTeamId)
    const salaries = userTeam ? [...userTeam.salaries] : []
    let roster = userTeam?.rosterCount ?? 0

    for (const offer of userOffers) {
      const fa = pool.find((p) => p.playerId === offer.playerId)
      if (!fa || !userTeam) continue
      // His price to you, not his price to the league: a year on the bench costs you a premium.
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
      // Bird rights let you go over the cap for your own man; otherwise room or an exception.
      const teamCeiling =
        rights === 'full' ? individualMax : maxOfferFor(salaries, rules, fa.yearsOfService)
      const ceiling = Math.min(individualMax, teamCeiling)
      // Which rule actually binds, so the refusal names the right one. The old message blamed cap
      // room for a limit that was usually the individual maximum.
      const binding =
        individualMax <= teamCeiling
          ? `the individual maximum for his service is ${money(individualMax)}`
          : capSpace(salaries, rules, roster) > 0
            ? `you have ${money(teamCeiling)} of cap room`
            : `you are over the cap; the exception you have left is ${money(teamCeiling)}`

      // Bidding above the limit is not a mistake to be punished — it is an instruction to pay as
      // much as the CBA allows. The offer is clamped, not dropped. Losing a player because you bid
      // too much was the single most-reported absurdity in the market.
      const amount = Math.min(offer.amount, ceiling)

      // He signs with you when the money is there. Below his price he waits for the market.
      if (amount + 1 < ask.amount) {
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
      // The next offer is judged against a payroll that now includes this one.
      salaries.push({ playerId: fa.playerId, amount: signing.amount, kind: signing.kind })
      roster++
    }
  }

  const rest = pool.filter((p) => !userSigned.includes(p.playerId))
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
  const nameOf = (teamId: string) => {
    const t = state.league.teams.find((x) => x.teamId === teamId)
    return t ? `${t.city} ${t.name}` : teamId
  }
  for (const t of tax)
    state.log.push({
      date: state.calendar.date,
      yearEnd,
      kind: 'note',
      text: `${nameOf(t.teamId)} owe ${money(t.bill)} in luxury tax on a ${money(t.payroll)} payroll (line ${money(t.taxLine)})`,
    })

  return { signings, userSigned, rejected, tax }
}
