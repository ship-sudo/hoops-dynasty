// Contract terms where no free source has them (1998–2020). Pure.
//
// Years: from the season's salary, walk forward while the next season's salary stays within a raise or
// decline band (±20%). A new deal almost always jumps more than the CBA's annual raise; a minimum player
// re-signed at the minimum every year is the known false positive. Capped at 5 years. Flagged 'inferred'.
//
// Kind, from the era table's money (packages/data/src/era): rookie_scale when the player is within his
// first four seasons after a first-round pick and the salary sits on the rookie scale (at most
// ROOKIE_SCALE_CEILING × the #1-pick scale of his draft); two_way when the salary is under TWO_WAY_SHARE
// of the 0-year minimum (2017-18 onward); minimum when the salary is at or under the 10-year minimum;
// else standard.

import type { ContractKind } from '@hoops/core'

export const RAISE_BAND = { lo: 0.8, hi: 1.2 }
export const MAX_INFERRED_YEARS = 5
/** Pick 1 earns the top of the scale; later picks and later years stay under it, so 1.0 is a ceiling
 * with headroom only for the 120% signing option. */
export const ROOKIE_SCALE_CEILING = 1.25
/** Two-way pay is half the rookie minimum (2021 CBA) or a flat sum well under it (2017–2021). */
export const TWO_WAY_SHARE = 0.75
/** Pro-rated minimum deals fall under the minimum; a little headroom covers rounding in the sources. */
export const MINIMUM_HEADROOM = 1.02

export interface InferredYear {
  yearEnd: number
  amount: number
}

/** Salary by season for one player (any team). Returns the run of seasons starting at `yearEnd`. */
export function inferYears(
  history: ReadonlyMap<number, number>,
  yearEnd: number,
  maxYears = MAX_INFERRED_YEARS,
): InferredYear[] {
  const first = history.get(yearEnd)
  if (first === undefined || first <= 0) return []
  const out: InferredYear[] = [{ yearEnd, amount: first }]
  let prev = first
  for (let y = yearEnd + 1; out.length < maxYears; y++) {
    const a = history.get(y)
    if (a === undefined || a <= 0) break
    if (a < prev * RAISE_BAND.lo || a > prev * RAISE_BAND.hi) break
    out.push({ yearEnd: y, amount: a })
    prev = a
  }
  return out
}

export interface KindInput {
  amount: number
  yearEnd: number
  draftYear: number | null
  draftRound: number | null
  /** Era money for `yearEnd`. */
  minSalary0yr: number
  minSalary10yr: number
  /** 100% first-year scale for the #1 pick of the player's draft. null when unknown. */
  rookieScalePick1: number | null
}

export function contractKind(k: KindInput): ContractKind {
  if (k.draftRound === 1 && k.draftYear !== null) {
    const seasonsSince = k.yearEnd - k.draftYear
    const onScale =
      k.rookieScalePick1 === null || k.amount <= ROOKIE_SCALE_CEILING * k.rookieScalePick1
    if (seasonsSince >= 1 && seasonsSince <= 4 && onScale) return 'rookie_scale'
  }
  if (k.yearEnd >= 2018 && k.amount < TWO_WAY_SHARE * k.minSalary0yr) return 'two_way'
  if (k.amount <= MINIMUM_HEADROOM * k.minSalary10yr) return 'minimum'
  return 'standard'
}
