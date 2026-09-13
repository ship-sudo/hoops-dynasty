// Cut a man, sign a replacement. The summer market is a different door; this is January.

import type { Contract, EraRules, YearEnd } from '@hoops/core'

/** Guaranteed money that stays on the cap after a waiver. */
export interface DeadMoney {
  teamId: string
  amount: number
  yearEnd: YearEnd
}

/** Remaining guaranteed years become dead cap. Unguaranteed years just vanish. */
export function deadFromWaive(
  teamId: string,
  contract: Contract | null,
  fromYearEnd: YearEnd,
): DeadMoney[] {
  if (!contract) return []
  return contract.years
    .filter((y) => y.yearEnd >= fromYearEnd && y.guaranteed)
    .map((y) => ({ teamId, amount: y.amount, yearEnd: y.yearEnd }))
}

export function canWaive(
  rosterCount: number,
  rules: Pick<EraRules, 'roster_min'>,
): { ok: boolean; reason: string } {
  if (rosterCount <= rules.roster_min)
    return {
      ok: false,
      reason: `the league minimum is ${rules.roster_min} — sign someone first`,
    }
  return { ok: true, reason: '' }
}

export function canSign(
  rosterCount: number,
  rules: Pick<EraRules, 'roster_max'>,
): { ok: boolean; reason: string } {
  if (rosterCount >= rules.roster_max)
    return { ok: false, reason: `the roster is full at ${rules.roster_max}` }
  return { ok: true, reason: '' }
}
