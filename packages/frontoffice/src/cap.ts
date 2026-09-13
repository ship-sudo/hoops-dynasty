// Payroll, cap space, the tax bill, and the apron lines — era by era.
//
// Every number comes from the season's EraRules, so 1998 is governed by 1998's CBA and 2024 by the
// 2023 one. Nothing here knows today's rules.

import { type Contract, clamp, type EraRules, type YearEnd } from '@hoops/core'

export interface RosterSalary {
  playerId: string
  /** This season's cap hit. */
  amount: number
  kind: Contract['kind']
}

export function salariesFor(
  contracts: readonly { playerId: string; contract: Contract | null }[],
  yearEnd: YearEnd,
): RosterSalary[] {
  const out: RosterSalary[] = []
  for (const { playerId, contract } of contracts) {
    if (!contract) continue
    const year = contract.years.find((y) => y.yearEnd === yearEnd)
    if (!year) continue
    out.push({ playerId, amount: year.amount, kind: contract.kind })
  }
  return out
}

/** Two-way deals sit outside the cap; everything else counts. */
export function payroll(salaries: readonly RosterSalary[]): number {
  let total = 0
  for (const s of salaries) if (s.kind !== 'two_way') total += s.amount
  return total
}

/**
 * Cap space. A team below the cap must also carry a hold for each empty roster slot up to the
 * league minimum, which is why a team never quite has as much room as its payroll suggests.
 */
export function capSpace(
  salaries: readonly RosterSalary[],
  rules: EraRules,
  playersUnderContract = salaries.length,
): number {
  const pay = payroll(salaries)
  const emptySlots = Math.max(0, rules.roster_min - playersUnderContract)
  const holds = emptySlots * rules.min_salary_0yr
  return rules.cap - pay - holds
}

export type CapStatus = 'room' | 'over_cap' | 'taxpayer' | 'apron_1' | 'apron_2'

export function capStatus(salaries: readonly RosterSalary[], rules: EraRules): CapStatus {
  const pay = payroll(salaries)
  if (rules.apron_2 != null && pay > rules.apron_2) return 'apron_2'
  if (rules.apron_1 != null && pay > rules.apron_1) return 'apron_1'
  if (rules.tax_line != null && pay > rules.tax_line) return 'taxpayer'
  return pay < rules.cap ? 'room' : 'over_cap'
}

/**
 * The luxury tax bill. 'flat_1_to_1' is the old dollar-for-dollar rule; 'incremental' is the
 * bracketed scheme from 2011-12 on, with the repeater surcharge when the team qualifies.
 */
export function taxBill(
  salaries: readonly RosterSalary[],
  rules: EraRules,
  opts: { repeater?: boolean } = {},
): number {
  if (rules.luxury_tax_scheme === 'none' || rules.tax_line == null) return 0
  const over = payroll(salaries) - rules.tax_line
  if (over <= 0) return 0
  if (rules.luxury_tax_scheme === 'flat_1_to_1') return over
  const t = rules.tax_rates
  if (!t) return over
  const rates = (opts.repeater && t.repeater ? t.repeater : t.standard) ?? []
  let remaining = over
  let bill = 0
  let i = 0
  while (remaining > 0) {
    const inBracket = Math.min(remaining, t.bracket)
    const rate = rates[i] ?? (rates.at(-1) ?? 1.5) + t.step * (i - rates.length + 1)
    bill += inBracket * rate
    remaining -= inBracket
    i++
    if (i > 40) break // guard: no team is 40 brackets over
  }
  return Math.round(bill)
}

/** The biggest first-year salary this team can offer a free agent, given its situation. */
export function maxOfferFor(
  salaries: readonly RosterSalary[],
  rules: EraRules,
  yearsOfService: number,
): number {
  const space = capSpace(salaries, rules)
  const status = capStatus(salaries, rules)
  const individualMax = maxSalary(rules, yearsOfService)
  if (space > 0) return Math.min(individualMax, Math.max(space, rules.min_salary_0yr))
  // No room: the mid-level is the tool, and which one depends on where the payroll sits.
  const taxpayerMle = rules.mle_taxpayer ?? rules.min_salary_0yr
  const fullMle = rules.mle_non_taxpayer ?? rules.min_salary_0yr
  if (status === 'apron_2' || status === 'apron_1' || status === 'taxpayer')
    return Math.min(individualMax, taxpayerMle)
  // Using the full mid-level hard-caps a team at the apron, so a team that would cross it by
  // signing the full exception only gets the taxpayer one.
  const wouldCrossApron = rules.apron_1 != null && payroll(salaries) + fullMle > rules.apron_1
  return Math.min(individualMax, wouldCrossApron ? taxpayerMle : fullMle)
}

/** The individual maximum salary, by years of service. Before the 1999 CBA there was none. */
export function maxSalary(rules: EraRules, yearsOfService: number): number {
  const m = rules.max_salary
  const tier = yearsOfService >= 10 ? 'yrs_10_plus' : yearsOfService >= 7 ? 'yrs_7_9' : 'yrs_0_6'
  if (m.dollars) return m.dollars[tier]
  if (m.pct) return Math.round((rules.cap * m.pct[tier]) / 100)
  return rules.cap // no individual max in that era
}

/** Minimum salary for a player with this much service, interpolated between the two known ends. */
export function minSalary(rules: EraRules, yearsOfService: number): number {
  const t = clamp(yearsOfService / 10, 0, 1)
  return Math.round(rules.min_salary_0yr + (rules.min_salary_10yr - rules.min_salary_0yr) * t)
}

/** Bird rights let a team re-sign its own player over the cap. */
export function birdRights(
  yearsWithTeam: number,
  rules: EraRules,
): 'full' | 'early' | 'non' | 'none' {
  if (yearsWithTeam >= rules.bird_years) return 'full'
  if (yearsWithTeam >= rules.early_bird_years) return 'early'
  if (yearsWithTeam >= 1) return 'non'
  return 'none'
}

/**
 * First-year salary on the rookie scale, by draft slot.
 *
 * The real scale is a published table; this reproduces its shape from the one number the era table
 * carries (the #1 pick's 100% figure): a steep drop through the lottery, flattening through the
 * twenties, with the #30 pick at roughly a quarter of the #1. Second-rounders are not on the scale
 * at all — they get minimum deals.
 */
export function rookieScale(rules: EraRules, overallPick: number, round: 1 | 2 = 1): number {
  if (round === 2 || overallPick > 30) return rules.min_salary_0yr
  const top = rules.rookie_scale_pick1
  if (top == null) return rules.min_salary_0yr
  const slot = clamp(overallPick, 1, 30)
  // 1 at pick 1, ~0.25 at pick 30.
  const factor = 0.25 + 0.75 * ((30 - slot) / 29) ** 1.45
  return Math.max(rules.min_salary_0yr, Math.round(top * factor))
}

/** A rookie-scale contract: four years for a first-rounder, two minimum years for a second. */
export function rookieContract(
  rules: EraRules,
  teamId: string,
  yearEnd: YearEnd,
  overallPick: number,
  round: 1 | 2 = 1,
): Contract {
  const first = rookieScale(rules, overallPick, round)
  const years = round === 1 ? 4 : 2
  return {
    teamId,
    kind: round === 1 ? 'rookie_scale' : 'minimum',
    years: Array.from({ length: years }, (_, i) => ({
      yearEnd: yearEnd + i,
      amount: Math.round(first * (1 + 0.05 * i)),
      option: null,
      // Rookie deals are guaranteed for two years, then team options.
      guaranteed: round === 1 ? i < 2 : true,
    })),
    source: 'generated',
  }
}
