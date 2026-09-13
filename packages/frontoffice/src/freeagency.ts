// Free agency: what a player asks for, who wants him, and who he signs with.
//
// A round-by-round market. Each round every team with room and a need makes its best offer to the
// player it wants most; each player then picks the offer he likes best — money first, but a winning
// team and a real role both count. The top of the market clears first, which is why the useful
// veterans left in the last rounds sign for the minimum.

import {
  type Contract,
  clamp,
  type EraRules,
  type Ratings,
  type Rng,
  type YearEnd,
} from '@hoops/core'
import { overall } from '@hoops/progression'
import {
  birdRights,
  capSpace,
  maxOfferFor,
  maxSalary,
  minSalary,
  payroll,
  type RosterSalary,
} from './cap.ts'
import { seasonValue, type TradeAsset } from './trade.ts'

export interface FreeAgent extends TradeAsset {
  yearsOfService: number
  /** Team he finished last season with, for Bird rights. */
  incumbentTeamId: string | null
  yearsWithIncumbent: number
}

export interface FaTeam {
  teamId: string
  salaries: RosterSalary[]
  /** Players under contract, for roster limits. */
  rosterCount: number
  /** Projected wins without any signing, for how attractive the team is. */
  projectedWins: number
  /** 0 = rebuilding, 1 = all in. Drives how hard they chase veterans. */
  winNow: number
  /** Ratings of the current rotation, used to spot a hole. */
  rotation: Ratings[]
}

export interface Offer {
  teamId: string
  playerId: string
  /** First-year salary. */
  amount: number
  years: number
}

export interface Signing extends Offer {
  kind: Contract['kind']
}

/** What he wants: his market value, nudged by age and how good he is. */
export function askingPrice(fa: FreeAgent, rules: EraRules): { amount: number; years: number } {
  const value = seasonValue(fa.ratings, rules)
  const ov = overall(fa.ratings)
  const max = maxSalary(rules, fa.yearsOfService)
  const min = minSalary(rules, fa.yearsOfService)
  // Players ask for a bit more than they are worth, and stars ask for the max.
  const amount = clamp(value * 1.12, min, max)
  const years =
    ov >= 62 ? (fa.age <= 28 ? 5 : 3) : ov >= 50 ? (fa.age <= 30 ? 4 : 2) : fa.age <= 26 ? 3 : 1
  return { amount: Math.round(amount), years }
}

/** How much this team wants him: value, positional need, and whether they are chasing wins. */
export function interest(team: FaTeam, fa: FreeAgent, rules: EraRules): number {
  const value = seasonValue(fa.ratings, rules)
  const ov = overall(fa.ratings)
  // Need: how much better he is than the worst rotation player he would replace.
  const rotation = [...team.rotation].map(overall).sort((a, b) => b - a)
  const replaced = rotation[Math.min(rotation.length - 1, 8)] ?? 40
  const upgrade = Math.max(0, ov - replaced)
  // Rebuilding teams prefer youth; win-now teams pay for proven production.
  const ageFit =
    team.winNow > 0.6
      ? clamp(1.2 - Math.max(0, fa.age - 30) * 0.08, 0.4, 1.2)
      : clamp(1.3 - Math.max(0, fa.age - 25) * 0.09, 0.3, 1.3)
  return value * (0.6 + upgrade / 12) * ageFit
}

/**
 * Does this club pursue him at all?
 *
 * A team still short of a squad takes the best man available. A team with a rotation only chases
 * someone who would join it — otherwise every club bids on everybody and the board goes to whoever
 * happens to have room rather than to whoever needs him.
 */
export function worthChasing(
  team: FaTeam,
  fa: FreeAgent,
  rules: EraRules,
  fillTo: number,
): boolean {
  if (team.rosterCount < Math.min(fillTo, rules.roster_min)) return true
  const rotation = [...team.rotation].map(overall).sort((a, b) => b - a)
  const worst = rotation[Math.min(rotation.length - 1, 8)] ?? 0
  return overall(fa.ratings) >= worst - 1
}

/**
 * Would signing him at this price put the club in the tax, and would it stand for that?
 *
 * The tax is a real cost — `taxBill` prices it — so a club that is not chasing anything stops short
 * of the line, and only a contender goes past it, by about a bracket. Minimum deals are exempt: a
 * team over the line still has to dress twelve men.
 *
 * This is the one thing that keeps a league of thirty clubs from all sitting in the tax, which is
 * what happens when the only limit on spending is the exceptions.
 */
function taxTolerable(team: FaTeam, rules: EraRules, amount: number, floor: number): boolean {
  const line = rules.tax_line
  if (line == null || amount <= floor * 1.1) return true
  const tolerance = 0.9 + 0.18 * clamp(team.winNow, 0, 1)
  return payroll(team.salaries) + amount <= line * tolerance
}

/** The most this team can offer him, respecting cap space, Bird rights and the roster limit. */
export function bestOffer(team: FaTeam, fa: FreeAgent, rules: EraRules): Offer | null {
  if (team.rosterCount >= rules.roster_max) return null
  const rights =
    fa.incumbentTeamId === team.teamId ? birdRights(fa.yearsWithIncumbent, rules) : 'none'
  const ceiling =
    rights === 'full'
      ? maxSalary(rules, fa.yearsOfService) // Bird rights: re-sign your own man over the cap
      : maxOfferFor(team.salaries, rules, fa.yearsOfService)
  const ask = askingPrice(fa, rules)
  const want = interest(team, fa, rules)
  // They will stretch above the asking price only for someone they really want.
  const stretch = want > seasonValue(fa.ratings, rules) * 1.3 ? 1.1 : 0.92
  const floor = minSalary(rules, fa.yearsOfService)
  const amount = Math.round(Math.min(ceiling, ask.amount * stretch))
  if (amount < floor * 0.95) return null
  const space = capSpace(team.salaries, rules, team.rosterCount)
  if (
    rights !== 'full' &&
    amount > Math.max(space, maxOfferFor(team.salaries, rules, fa.yearsOfService))
  )
    return null
  if (!taxTolerable(team, rules, amount, floor)) return null
  return { teamId: team.teamId, playerId: fa.playerId, amount, years: ask.years }
}

/** How a player ranks the offers in front of him. Money leads; winning and a role matter too. */
export function rankOffers(
  fa: FreeAgent,
  offers: readonly { offer: Offer; team: FaTeam }[],
  rng: Rng,
): Offer | null {
  let best: { score: number; offer: Offer } | null = null
  for (const { offer, team } of offers) {
    const money = offer.amount * (1 + 0.06 * (offer.years - 1))
    const winning = 1 + (team.projectedWins - 41) / 120
    const loyalty = team.teamId === fa.incumbentTeamId ? 1.04 : 1
    const whim = 1 + rng.normal(0, 0.05)
    const score = money * winning * loyalty * whim
    if (!best || score > best.score) best = { score, offer }
  }
  return best?.offer ?? null
}

/**
 * Run the market. Returns the signings in the order they happened; anyone still unsigned at the end
 * takes a minimum deal from the team that wanted him most, or goes unsigned.
 */
export interface MarketOptions {
  rounds?: number
  /**
   * Roster size teams fill up to at the minimum salary. Defaults to the legal minimum, but real
   * clubs carry more than the minimum, so callers running a league usually pass roster_max - 1.
   */
  fillTo?: number
  /**
   * When false, only the named rounds run — no minimum-salary fill. A day of free agency, not the
   * whole summer.
   */
  fill?: boolean
}

export function runFreeAgency(
  pool: readonly FreeAgent[],
  teams: readonly FaTeam[],
  rules: EraRules,
  // The season the deals are for. The market itself needs only the rules and the pool; the caller
  // writes the contracts, so this rides along for the signature's sake.
  _yearEnd: YearEnd,
  rng: Rng,
  opts: MarketOptions | number = {},
): Signing[] {
  const settings: MarketOptions = typeof opts === 'number' ? { rounds: opts } : opts
  const rounds = settings.rounds ?? 8
  const fillTo = Math.min(settings.fillTo ?? rules.roster_min, rules.roster_max)
  const fill = settings.fill !== false
  const signings: Signing[] = []
  const remaining = new Map(pool.map((p) => [p.playerId, p]))
  const state = new Map(teams.map((t) => [t.teamId, { ...t, salaries: [...t.salaries] }]))

  // The market runs top down: the best man left hears from everyone who wants him and picks, then
  // the next, and so on to the bottom of the board. A round is one pass down that board, and a
  // couple of passes are enough to clear it.
  //
  // It used to be one signing per round per *target*, and since every club ranks the board the same
  // way they all chased the same man, so eight rounds produced about eight contracts in the whole
  // league. Everybody else fell through to the minimum-salary fill below, which is why league
  // payroll halved in two summers and the median salary sat on the floor.
  for (let round = 0; round < rounds && remaining.size > 0; round++) {
    let signedThisRound = 0
    const board = [...remaining.values()].sort(
      (a, b) => seasonValue(b.ratings, rules) - seasonValue(a.ratings, rules),
    )
    for (const fa of board) {
      if (!remaining.has(fa.playerId)) continue
      const bids: { offer: Offer; team: FaTeam }[] = []
      for (const team of state.values()) {
        if (team.rosterCount >= fillTo) continue
        if (!worthChasing(team, fa, rules, fillTo)) continue
        const offer = bestOffer(team, fa, rules)
        if (offer) bids.push({ offer, team })
      }
      if (bids.length === 0) continue
      const chosen = rankOffers(fa, bids, rng)
      if (!chosen) continue
      const team = state.get(chosen.teamId)
      if (!team) continue
      const kind: Contract['kind'] =
        chosen.amount <= minSalary(rules, fa.yearsOfService) * 1.05 ? 'minimum' : 'standard'
      signings.push({ ...chosen, kind })
      team.salaries.push({ playerId: fa.playerId, amount: chosen.amount, kind })
      team.rosterCount++
      remaining.delete(fa.playerId)
      signedThisRound++
    }
    if (signedThisRound === 0) break
  }

  if (!fill) return signings

  // Fill to the legal minimum. Every team must dress a full squad, so a club short of
  // rules.roster_min keeps signing the best man left at the minimum salary — that is what the
  // back of an NBA bench is. This runs before the general last call so thin teams get first pick
  // of what remains.
  for (;;) {
    const needy = [...state.values()]
      .filter((t) => t.rosterCount < fillTo)
      .sort((a, b) => a.rosterCount - b.rosterCount)
    if (needy.length === 0 || remaining.size === 0) break
    let signedAny = false
    for (const team of needy) {
      let best: { fa: FreeAgent; want: number } | null = null
      for (const fa of remaining.values()) {
        const want = interest(team, fa, rules)
        if (!best || want > best.want) best = { fa, want }
      }
      if (!best) break
      const amount = minSalary(rules, best.fa.yearsOfService)
      signings.push({
        teamId: team.teamId,
        playerId: best.fa.playerId,
        amount,
        years: 1,
        kind: 'minimum',
      })
      team.salaries.push({ playerId: best.fa.playerId, amount, kind: 'minimum' })
      team.rosterCount++
      remaining.delete(best.fa.playerId)
      signedAny = true
      if (remaining.size === 0) break
    }
    if (!signedAny) break
  }

  // Last call: minimum deals for whoever is left and wanted.
  for (const fa of remaining.values()) {
    let best: { team: FaTeam; want: number } | null = null
    for (const team of state.values()) {
      if (team.rosterCount >= rules.roster_max) continue
      const want = interest(team, fa, rules)
      if (!best || want > best.want) best = { team, want }
    }
    if (!best) continue
    const amount = minSalary(rules, fa.yearsOfService)
    signings.push({
      teamId: best.team.teamId,
      playerId: fa.playerId,
      amount,
      years: 1,
      kind: 'minimum',
    })
    best.team.salaries.push({ playerId: fa.playerId, amount, kind: 'minimum' })
    best.team.rosterCount++
  }

  return signings
}

/** Turn a signing into a contract, with flat raises. */
export function contractFrom(signing: Signing, yearEnd: YearEnd, raisePct = 5): Contract {
  const years = []
  for (let i = 0; i < signing.years; i++) {
    years.push({
      yearEnd: yearEnd + i,
      amount: Math.round(signing.amount * (1 + (raisePct / 100) * i)),
      option: null,
      guaranteed: true,
    })
  }
  return { teamId: signing.teamId, kind: signing.kind, years, source: 'generated' }
}
