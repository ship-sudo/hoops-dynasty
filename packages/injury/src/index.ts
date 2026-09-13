// Injuries and availability.
//
// Calibrated against the real thing: across 1998–2026, a rotation player (12+ mpg) missed about
// 25% of his team's games, and that share is remarkably flat by age — 0.24 at 20, 0.26 at 35. Some
// of that is rest and coach's decision rather than injury, so the model splits it: most absences are
// short, a few are the kind that end a season.
//
// The durability rating does the separating. A 90-durability iron man misses a handful of games; a
// 20-durability player is never available when you need him.

import { clamp, type Ratings, type Rng } from '@hoops/core'

/** Share of games a league-average (50 durability) rotation player misses. Fitted from history. */
export const LEAGUE_MISS_SHARE = 0.25

export type InjurySeverity = 'knock' | 'strain' | 'break' | 'season'

export interface Injury {
  severity: InjurySeverity
  name: string
  /** Games he will miss, starting with this one. */
  games: number
  /** Condition he returns at, 0–1. */
  returnCondition: number
}

const CATALOGUE: Record<
  InjurySeverity,
  { names: string[]; min: number; max: number; weight: number }
> = {
  // Weights are the share of absences of each kind, not of games lost.
  knock: {
    names: ['ankle soreness', 'bruised hip', 'back spasms', 'flu', 'rest'],
    min: 1,
    max: 3,
    weight: 0.62,
  },
  strain: {
    names: ['hamstring strain', 'groin strain', 'sprained ankle', 'shoulder sprain'],
    min: 4,
    max: 14,
    weight: 0.25,
  },
  break: {
    names: ['broken hand', 'stress reaction', 'torn meniscus', 'plantar fascia tear'],
    min: 15,
    max: 45,
    weight: 0.11,
  },
  season: {
    names: ['torn ACL', 'ruptured Achilles', 'herniated disc', 'fractured leg'],
    min: 46,
    max: 82,
    weight: 0.02,
  },
}

/** Mean length of an absence, straight from the catalogue rather than guessed. */
export const MEAN_ABSENCE_GAMES = (Object.keys(CATALOGUE) as InjurySeverity[]).reduce((sum, s) => {
  const spec = CATALOGUE[s]
  return sum + spec.weight * ((spec.min + spec.max) / 2)
}, 0)

/** Minutes load for the player the league average is measured on: a 30-minute starter. */
const LOAD_ANCHOR = 0.85 + 30 / 60

/** How fast the load term grows with minutes. 1 would be linear; injuries are worse than linear. */
const LOAD_CURVE = 1.8

/**
 * Per-game chance of a new absence starting, for a player who is currently available.
 *
 * The base rate is set so that a league-average player — 50 durability, 27, 30 minutes a night —
 * misses LEAGUE_MISS_SHARE of the season once absences run their natural length. Durability moves
 * it a long way in both directions; age adds a small tax at both ends (young players sit with
 * growing pains, old ones with maintenance); heavy minutes add load.
 */
export function injuryChance(
  durability: number,
  age: number,
  minutesPerGame: number,
  condition = 1,
  yearsPro = 0,
): number {
  // Two effects push the realised miss share below hazard x length, so the base rate is scaled up
  // to compensate: a player who is already out cannot start a new absence, and a long injury late
  // in the year is cut short by the end of the season. The constant is measured, not guessed —
  // it is what makes an average player land on LEAGUE_MISS_SHARE over a simulated 82 games, and
  // the calibration test in this package fails if it drifts.
  const OCCUPANCY_CORRECTION = 1.28
  const base = (LEAGUE_MISS_SHARE / MEAN_ABSENCE_GAMES) * OCCUPANCY_CORRECTION
  const dur = clamp(durability, 5, 99)
  // 50 durability = league average. 90 ≈ half the rate, 20 ≈ 1.8x.
  const durFactor = (50 / dur) ** 0.85
  const ageFactor = 1 + Math.max(0, age - 31) * 0.05 + Math.max(0, 21 - age) * 0.03
  // Mileage. The first eight seasons are already in the age term; after that the body keeps a
  // ledger the calendar does not. Default 0 so the league-average calibration (age 27, no years
  // passed in) does not move.
  const milesFactor = 1 + Math.max(0, yearsPro - 8) * 0.025
  // Load. Uncapped to 48 and convex, so a 44-minute night is not merely "a bit more" than 30 —
  // riding a starter has to cost something, and the cost has to grow faster than the minutes.
  // 30 minutes is the anchor and scores exactly 1.
  const loadFactor = ((0.85 + clamp(minutesPerGame, 0, 48) / 60) / LOAD_ANCHOR) ** LOAD_CURVE
  // Tiredness. A man at 70% condition pulls up lame where a fresh one runs it off.
  const condFactor = (1 / clamp(condition, 0.4, 1)) ** 1.5
  return clamp(base * durFactor * ageFactor * loadFactor * condFactor * milesFactor, 0.002, 0.5)
}

/**
 * One sentence for the roster card: is this man a candidate to miss time? Durability is the
 * rating; yearsPro and last year's games played are the history the rating cannot see.
 */
export function injuryOutlook(
  durability: number,
  age: number,
  yearsPro: number,
  lastGp?: number,
): string {
  if (lastGp !== undefined && lastGp < 40)
    return `Missed most of last year (${lastGp} games). Treat him as an injury candidate.`
  const risk = injuryChance(durability, age, 30, 1, yearsPro)
  const avg = injuryChance(50, 27, 30, 1, 0)
  if (durability >= 80 && risk <= avg)
    return yearsPro <= 1
      ? 'No injury history in the book yet. Looks like an iron man.'
      : `Iron man. ${yearsPro} seasons in, still a safe bet to dress.`
  if (risk > avg * 1.5)
    return `Injury candidate. Durability ${Math.round(durability)} with ${yearsPro} year${yearsPro === 1 ? '' : 's'} in the league.`
  if (age >= 33 || yearsPro >= 12)
    return `Mileage. At ${age} with ${yearsPro} years in, manage his nights.`
  if (yearsPro <= 1) return 'No injury history in the book yet. League-average availability.'
  return `Typical availability for a ${yearsPro}-year veteran.`
}

/** Roll a new injury. Severity is weighted; the exact length is uniform inside the band. */
export function rollInjury(rng: Rng, durability: number): Injury {
  const severities = Object.keys(CATALOGUE) as InjurySeverity[]
  // Fragile players suffer worse injuries, not just more of them.
  const tilt = clamp((50 - durability) / 200, -0.2, 0.25)
  const weights = severities.map((s, i) => {
    const w = CATALOGUE[s].weight
    return i === 0 ? Math.max(0.05, w - tilt) : w + tilt * (i / 3)
  })
  const severity = severities[rng.weighted(weights)] ?? 'knock'
  const spec = CATALOGUE[severity]
  const games = spec.min + rng.int(spec.max - spec.min + 1)
  const name = spec.names[rng.int(spec.names.length)] ?? 'injury'
  const returnCondition =
    severity === 'knock' ? 0.95 : severity === 'strain' ? 0.85 : severity === 'break' ? 0.75 : 0.65
  return { severity, name, games, returnCondition }
}

export interface Availability {
  /** Games available, out of the schedule. */
  gamesAvailable: number
  /** Every absence, in the order it happened. */
  spells: { startGame: number; injury: Injury }[]
  gamesMissed: number
}

/** Walk a whole season one game at a time. Deterministic for a seed. */
export function seasonAvailability(
  ratings: Ratings,
  age: number,
  minutesPerGame: number,
  scheduleGames: number,
  rng: Rng,
): Availability {
  const chance = injuryChance(ratings.durability, age, minutesPerGame)
  const spells: { startGame: number; injury: Injury }[] = []
  let missed = 0
  let out = 0
  for (let g = 1; g <= scheduleGames; g++) {
    if (out > 0) {
      out--
      missed++
      continue
    }
    if (rng.chance(chance)) {
      const injury = rollInjury(rng, ratings.durability)
      spells.push({ startGame: g, injury })
      out = injury.games - 1
      missed++
    }
  }
  return { gamesAvailable: scheduleGames - missed, spells, gamesMissed: missed }
}

/** Nobody drops below this. Past it a coach would sit him whatever the manager asked for. */
export const CONDITION_FLOOR = 0.62

/** What a 36-minute night costs a league-average player, in condition. */
const FATIGUE_PER_36 = 0.1

/** What a day off gives back. Four days is as much rest as anyone banks. */
const RECOVER_PER_DAY = 0.05

/**
 * Condition after one night's work.
 *
 * The two constants are set against the real calendar: 82 games in about 165 days is a game every
 * two days, so two days of recovery (0.10) exactly pays for a 36-minute night (0.10). A 36-minute
 * starter therefore holds his condition all year, a 30-minute one gains on it, and anyone asked for
 * 44 slides until he hits the floor. A back-to-back costs half a night's recovery, which is why the
 * second night of one is a bad night to ride anybody.
 *
 * `ceiling` is the most a player may hold right now — below 1 while he is working his way back from
 * a serious injury (see `conditionAfterReturn`).
 */
export function nextCondition(opts: {
  condition: number
  minutesPlayed: number
  daysRest: number
  stamina: number
  ceiling?: number
}): number {
  const staminaFactor = clamp(1 - ((opts.stamina - 50) / 50) * 0.35, 0.6, 1.5)
  const drain = (Math.max(0, opts.minutesPlayed) / 36) * FATIGUE_PER_36 * staminaFactor
  const rest = RECOVER_PER_DAY * clamp(opts.daysRest, 0, 4)
  const ceiling = clamp(opts.ceiling ?? 1, CONDITION_FLOOR, 1)
  return clamp(opts.condition - drain + rest, CONDITION_FLOOR, ceiling)
}

/**
 * Condition recovers over the games after a return. Call with how many games ago he came back.
 */
export function conditionAfterReturn(injury: Injury, gamesSinceReturn: number): number {
  const ramp = injury.severity === 'season' ? 20 : injury.severity === 'break' ? 12 : 5
  const t = clamp(gamesSinceReturn / ramp, 0, 1)
  return clamp(injury.returnCondition + (1 - injury.returnCondition) * t, 0, 1)
}

/**
 * A long injury leaves a mark. Returns the rating penalty to carry into next season — mostly
 * athleticism, and only for the serious ones.
 */
export function lingeringPenalty(injury: Injury, age: number): Partial<Ratings> {
  if (injury.severity === 'knock' || injury.severity === 'strain') return {}
  const old = age >= 30 ? 1.6 : 1
  const hit = injury.severity === 'season' ? 4 : 2
  return {
    speed: -Math.round(hit * old),
    stamina: -Math.round(hit * 0.75 * old),
    durability: -Math.round(hit * 0.5 * old),
  }
}
