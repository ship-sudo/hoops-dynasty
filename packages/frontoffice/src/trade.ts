// What a player is worth, whether a trade is legal, and whether the other team says yes.
//
// Value has two halves. On-court value is what he does for you, in dollars, this season and in the
// seasons left on his deal — steeply convex, because one star beats three useful starters and there
// are only five men on the floor. Surplus is that minus what he costs.
//
// A trade is judged on surplus *plus a share of production*, not on surplus alone. Cap room can be
// spent again next summer; the talent it buys cannot be conjured. A star on a fair contract has
// little surplus and is still the most valuable thing in the building, and a replacement-level man
// on the minimum has a little surplus and is worth nothing. Judging on surplus alone made the
// league trade its best players for spare parts.

import { type Contract, clamp, type EraRules, type Ratings, type YearEnd } from '@hoops/core'
import { curveFor, overall } from '@hoops/progression'
import { payroll, type RosterSalary } from './cap.ts'

export interface TradeAsset {
  playerId: string
  name: string
  ratings: Ratings
  age: number
  /** Hidden ceiling; unknown to the other team's scouts unless you pass their estimate. */
  potential: number
  contract: Contract | null
}

export interface PickAsset {
  /** The draft this pick belongs to. */
  draftYear: number
  round: 1 | 2
  /** Expected slot, 1–30. Unknown future picks can be estimated at 15. */
  expectedSlot: number
  /** Whose pick it is, for display. */
  fromTeamId: string
}

/**
 * Replacement level on the rating scale, measured rather than guessed: sort every player in a
 * shipped bundle by `overall` and the 400th — the 13th man on a 30-man league's worth of rosters,
 * the player any team can sign off the street for the minimum — sits at 44.4 (1998), 44.7 (2004)
 * and 45.5 (2016). Everything below this is free; only the points above it are worth paying for.
 *
 * The old figure was 40, which is below the worst player in the league, so even a scrub read as
 * productive and every rating from 40 up was squeezed into the flat bottom of the curve.
 */
export const REPLACEMENT_OVERALL = 45

/** The best player in the league — about 30 points clear of replacement — is worth this many wins. */
const STAR_WINS = 20
/** How sharply value accelerates with rating. One star beats three useful starters. */
const CONVEXITY = 1.314

/**
 * Roughly how many dollars a win is worth, anchored to the cap.
 *
 * cap/22 is what makes the curve agree with the league's own pay scale: on the 2003-04 bundle it
 * prices the 150th-best player at $3.8M against a real $3.6M, the 60th at $9.4M against $7.7M and
 * the 30th at $12.0M against $12.0M, while putting a genuine star well above the individual
 * maximum — which is the whole reason stars are assets and not liabilities.
 */
function dollarsPerWin(rules: EraRules): number {
  return rules.cap / 22
}

/**
 * On-court value for one season, in dollars. Convex above replacement level: on the scale
 * `overall` actually produces, 45 is a 13th man, 50 a rotation regular, 57 an All-Star, 65 an
 * All-NBA sort and 75 the best player alive.
 *
 * Below replacement a player is not worth nothing — somebody has to fill the roster spot, and the
 * market still has to rank the scrubs against each other — but he is worth a rounding error, and
 * he is never worth more than the minimum salary he costs.
 */
export function seasonValue(ratings: Ratings, rules: EraRules): number {
  const ov = overall(ratings)
  const above = ov - REPLACEMENT_OVERALL
  // A gentle tail below replacement keeps the ordering the free-agent market needs, at money that
  // never makes a scrub a trade asset.
  if (above <= 0) return rules.min_salary_0yr * 0.5 * clamp(1 + above / 15, 0, 1)
  const wins = STAR_WINS * (above / 30) ** CONVEXITY
  return wins * dollarsPerWin(rules)
}

/** What his rating will look like in `yearsAhead` seasons, using the fitted age curves. */
export function projectRatings(ratings: Ratings, age: number, yearsAhead: number): Ratings {
  let out = { ...ratings }
  for (let i = 0; i < yearsAhead; i++) {
    const curve = curveFor(age + i)
    const next = { ...out }
    for (const k of Object.keys(next) as (keyof Ratings)[]) {
      next[k] = clamp(Math.round(next[k] + (curve.delta[k] ?? 0)), 5, 99)
    }
    out = next
  }
  return out
}

export interface ValueOpts {
  /** Season the valuation is made in. */
  yearEnd: YearEnd
  rules: EraRules
  /** 0 = pure rebuild (future years matter most), 1 = win now. */
  winNow: number
  /** Per-season discount on future value. */
  discount?: number
  /**
   * How much of a player's raw production counts on top of his surplus when a trade is scored.
   * 0 reproduces the old surplus-only market, where the league gave its stars away.
   */
  talentWeight?: number
}

/** The default share of production that counts on top of surplus. */
export const TALENT_WEIGHT = 0.35

export interface PlayerValue {
  /** Dollars of on-court production over the remaining contract, discounted. */
  production: number
  /** Production minus salary owed. Negative means the contract is a liability. */
  surplus: number
  years: number
}

/**
 * What one player is worth in a trade: his surplus, plus a share of what he actually produces.
 *
 * This is the number both sides of a deal are weighed on. See the note at the top of the file for
 * why surplus on its own is not enough.
 */
export function tradeValue(asset: TradeAsset, opts: ValueOpts): number {
  const v = playerValue(asset, opts)
  return v.surplus + (opts.talentWeight ?? TALENT_WEIGHT) * v.production
}

export function playerValue(asset: TradeAsset, opts: ValueOpts): PlayerValue {
  const { rules, yearEnd } = opts
  const discount = opts.discount ?? 0.88
  const years = asset.contract?.years.filter((y) => y.yearEnd >= yearEnd) ?? []
  // A player with no contract is still worth something to acquire, but only this season's value.
  const horizon =
    years.length > 0 ? years : [{ yearEnd, amount: 0, option: null, guaranteed: true }]

  let production = 0
  let cost = 0
  for (let i = 0; i < horizon.length; i++) {
    const y = horizon[i]
    if (!y) continue
    const ratings = i === 0 ? asset.ratings : projectRatings(asset.ratings, asset.age, i)
    // Win-now teams discount the future harder; rebuilding teams value it more than the present.
    const timeWeight = i === 0 ? 1 : discount ** i * (0.6 + 0.8 * (1 - opts.winNow))
    production += seasonValue(ratings, rules) * timeWeight
    cost += y.amount * (i === 0 ? 1 : discount ** i)
  }
  // Young players with headroom carry option value: the scouting report might be an underestimate.
  const upside = asset.age <= 24 ? Math.max(0, asset.potential - overall(asset.ratings)) : 0
  production += upside * 0.02 * dollarsPerWin(rules) * (1.4 - opts.winNow)

  return {
    production: Math.round(production),
    surplus: Math.round(production - cost),
    years: horizon.length,
  }
}

/** A rough dollar value for a draft pick, by round and expected slot. */
export function pickValue(pick: PickAsset, opts: ValueOpts): number {
  const { rules } = opts
  const slot = clamp(pick.expectedSlot, 1, 60)
  if (pick.round === 2) return dollarsPerWin(rules) * 0.35 * clamp((45 - slot) / 40, 0.05, 0.6)
  // First rounders: steep at the top, flat by the twenties.
  const strength = clamp((31 - slot) / 30, 0.05, 1)
  const value = dollarsPerWin(rules) * (0.8 + 7.5 * strength ** 2.3)
  // Rebuilding teams pay up for picks; win-now teams discount them.
  const yearsOut = Math.max(0, pick.draftYear - opts.yearEnd)
  return value * (1.35 - 0.7 * opts.winNow) * 0.9 ** yearsOut
}

export interface TradeSide {
  teamId: string
  salaries: RosterSalary[]
  outPlayers: TradeAsset[]
  outPicks: PickAsset[]
}

/** Salary going out from one side, ignoring two-way deals. */
export function outgoingSalary(side: TradeSide, yearEnd: YearEnd): number {
  let total = 0
  for (const p of side.outPlayers) {
    const y = p.contract?.years.find((x) => x.yearEnd === yearEnd)
    if (y && p.contract?.kind !== 'two_way') total += y.amount
  }
  return total
}

/** Money as people write it: $12.4M. The rule messages are read by humans, not parsers. */
function money(n: number): string {
  const m = n / 1_000_000
  return `$${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`
}

export interface LegalityResult {
  legal: boolean
  reasons: string[]
}

/**
 * Salary matching, era-correct. Teams under the split line (tax line or first apron, depending on
 * the CBA) get the generous tier ladder; teams above it get the tight one. From 2023-24, second-apron
 * teams cannot aggregate salaries at all.
 */
export function isLegalTrade(
  a: TradeSide,
  b: TradeSide,
  rules: EraRules,
  yearEnd: YearEnd,
): LegalityResult {
  const reasons: string[] = []
  const m = rules.trade_matching
  for (const [side, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const out = outgoingSalary(side, yearEnd)
    const incoming = outgoingSalary(other, yearEnd)
    const after = payroll(side.salaries) - out + incoming
    const line =
      m.split_at === 'tax_line' ? rules.tax_line : m.split_at === 'apron_1' ? rules.apron_1 : null
    const over = line != null && after > line
    const tiers = over && m.over ? m.over : m.under
    const tier = tiers.find((t) => t.up_to == null || out <= t.up_to) ?? tiers.at(-1)
    if (!tier) continue
    const allowed = (out * tier.pct) / 100 + tier.plus
    if (incoming > allowed && after > rules.cap) {
      reasons.push(
        `${side.teamId} may take back ${money(allowed)} for ${money(out)} sent out, not ${money(incoming)}`,
      )
    }
    if (
      m.over_apron_2 &&
      rules.apron_2 != null &&
      after > rules.apron_2 &&
      !m.over_apron_2.can_aggregate &&
      side.outPlayers.length > 1
    ) {
      reasons.push(`${side.teamId} is over the second apron and cannot aggregate salaries`)
    }
    if (
      side.salaries.length - side.outPlayers.length + other.outPlayers.length >
      rules.roster_max
    ) {
      reasons.push(`${side.teamId} would exceed the ${rules.roster_max}-man roster`)
    }
  }
  return { legal: reasons.length === 0, reasons }
}

export interface TradeVerdict {
  accepted: boolean
  /** Net surplus for the AI team, in dollars. Positive means the deal helps them. */
  net: number
  /** What they gave up vs took on, for the message they send back. */
  gainedValue: number
  lostValue: number
  reason: string
}

/**
 * Does the AI side accept? It values what it receives against what it gives up, then demands a
 * margin — no team trades for a coin-flip, and the margin stops the user fleecing them.
 */
export function evaluateTrade(
  ai: TradeSide,
  user: TradeSide,
  opts: ValueOpts & { margin?: number },
): TradeVerdict {
  const margin = opts.margin ?? 0.08
  const legality = isLegalTrade(ai, user, opts.rules, opts.yearEnd)
  const gained =
    user.outPlayers.reduce((t, p) => t + tradeValue(p, opts), 0) +
    user.outPicks.reduce((t, p) => t + pickValue(p, opts), 0)
  const lost =
    ai.outPlayers.reduce((t, p) => t + tradeValue(p, opts), 0) +
    ai.outPicks.reduce((t, p) => t + pickValue(p, opts), 0)
  const net = Math.round(gained - lost)
  if (!legality.legal)
    return {
      accepted: false,
      net,
      gainedValue: Math.round(gained),
      lostValue: Math.round(lost),
      reason: legality.reasons[0] ?? 'illegal trade',
    }
  const required = Math.abs(lost) * margin
  const accepted = net > required
  return {
    accepted,
    net,
    gainedValue: Math.round(gained),
    lostValue: Math.round(lost),
    reason: accepted
      ? 'this helps us'
      : net > 0
        ? 'close, but not enough of an upgrade to be worth the disruption'
        : 'we would be giving up the better side of this',
  }
}
