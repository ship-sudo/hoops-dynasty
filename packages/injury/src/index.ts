// Injuries and availability.
//
// Real rotation players miss about a quarter of the schedule, but that number is rest, DNP-CD and
// load management as much as it is a sprain. Modelling all of it as injury stopped the week every
// few games. The game keeps the shape — most absences short, a few season-ending — at about half
// that rate, so a Sim week is basketball, not a clinic.
//
// The durability rating does the separating. A 90-durability iron man misses a handful of games; a
// 20-durability player is never available when you need him.

import { clamp, type Ratings, type Rng } from '@hoops/core'

/** Share of games a league-average (50 durability) rotation player misses to injury. */
export const LEAGUE_MISS_SHARE = 0.12

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
    names: ['sprained ankle', 'ankle soreness', 'bruised hip', 'back spasms', 'jammed finger'],
    min: 1,
    max: 3,
    weight: 0.62,
  },
  strain: {
    names: ['hamstring strain', 'groin strain', 'shoulder sprain', 'calf strain'],
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

export type InjuryRiskLabel = 'iron' | 'typical' | 'fragile' | 'mileage' | 'candidate'

/** What the roster column and the tactics row show: a label and how many games he is likely to miss. */
export interface InjuryRisk {
  label: InjuryRiskLabel
  /** Expected games missed to injury over `scheduleGames` at this minutes load. */
  gamesOut: number
  share: number
  /** One sentence. Same copy as the old availability line. */
  text: string
  /** Short cell: "Iron", "~8", "Fragile ~18". */
  short: string
}

/**
 * A games-missed model, not a vibe. The per-game hazard is `injuryChance`; last year's GP is a
 * prior for men who already missed a pile (rest and DNP mixed in, so it is shrunk by half).
 */
export function injuryRisk(
  durability: number,
  age: number,
  yearsPro: number,
  lastGp?: number,
  minutesPerGame = 30,
  scheduleGames = 82,
): InjuryRisk {
  const mpg = minutesPerGame
  const avg = injuryChance(50, 27, 30, 1, 0)
  const p = injuryChance(durability, age, mpg, 1, yearsPro)
  let share = LEAGUE_MISS_SHARE * (p / avg)
  if (lastGp !== undefined) {
    const lastShare = clamp(1 - lastGp / Math.max(50, scheduleGames), 0, 1)
    share = 0.55 * share + 0.45 * lastShare * 0.5
  }
  share = clamp(share, 0.02, 0.55)
  const gamesOut = Math.round(scheduleGames * share)
  const atThirty = injuryChance(durability, age, 30, 1, yearsPro)

  let label: InjuryRiskLabel = 'typical'
  if (lastGp !== undefined && lastGp < 40) label = 'candidate'
  else if (share <= 0.08 && durability >= 75) label = 'iron'
  else if (share > 0.18) label = 'fragile'
  else if (age >= 33 || yearsPro >= 12) label = 'mileage'

  let text: string
  if (label === 'candidate')
    text = `Missed most of last year (${lastGp} games). Treat him as an injury candidate.`
  else if (mpg > 0 && mpg <= 24 && atThirty > p * 1.1)
    text = `On ${Math.round(mpg)} minutes the load is light. At ${age} that is a managed night, not a pounding.`
  else if (label === 'iron')
    text =
      yearsPro <= 1
        ? 'No injury history in the book yet. Looks like an iron man.'
        : `Iron man. ${yearsPro} seasons in, still a safe bet to dress.`
  else if (label === 'fragile')
    text = `Injury candidate. Durability ${Math.round(durability)} with ${yearsPro} year${yearsPro === 1 ? '' : 's'} in the league. Expect about ${gamesOut} games out.`
  else if (label === 'mileage')
    text = `Mileage. At ${age} with ${yearsPro} years in, manage his nights. About ${gamesOut} games out if you ride him.`
  else if (yearsPro <= 1) text = 'No injury history in the book yet. League-average availability.'
  else
    text = `Typical availability for a ${yearsPro}-year veteran. About ${gamesOut} games out at this load.`

  const short =
    label === 'iron'
      ? 'Iron'
      : label === 'candidate'
        ? `Last ${lastGp}`
        : label === 'fragile'
          ? `Fragile ~${gamesOut}`
          : label === 'mileage'
            ? `Miles ~${gamesOut}`
            : `~${gamesOut}`

  return { label, gamesOut, share, text, short }
}

/** One sentence for the roster card. Built from `injuryRisk` so the column and the bio cannot disagree. */
export function injuryOutlook(
  durability: number,
  age: number,
  yearsPro: number,
  lastGp?: number,
  minutesPerGame = 30,
  scheduleGames = 82,
): string {
  return injuryRisk(durability, age, yearsPro, lastGp, minutesPerGame, scheduleGames).text
}

const TIERS: InjurySeverity[] = ['knock', 'strain', 'break', 'season']

const RETURN_CONDITION: Record<InjurySeverity, number> = {
  knock: 0.95,
  strain: 0.85,
  break: 0.75,
  season: 0.65,
}

/** A knock is day-to-day: he can dress, but playing him risks the next tier. */
export function isWarning(injury: Injury): boolean {
  return injury.severity === 'knock'
}

/** Roll one injury of a given tier. */
export function rollInjuryAt(rng: Rng, severity: InjurySeverity): Injury {
  const spec = CATALOGUE[severity]
  const games = spec.min + rng.int(spec.max - spec.min + 1)
  const name = spec.names[rng.int(spec.names.length)] ?? 'injury'
  return { severity, name, games, returnCondition: RETURN_CONDITION[severity] }
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
  return rollInjuryAt(rng, severity)
}

/** The next rung on the ladder. A knock becomes a strain, a strain a break, a break a season. */
export function escalateInjury(rng: Rng, current: Injury): Injury {
  const i = TIERS.indexOf(current.severity)
  const next = TIERS[Math.min(i + 1, TIERS.length - 1)] ?? 'strain'
  return rollInjuryAt(rng, next)
}

/**
 * Chance a warning becomes the next tier if he plays tonight. ~14% on a 30-minute night at
 * league-average durability; minutes, tiredness and a glass body all push it up.
 */
export function playThroughRisk(minutes: number, condition: number, durability: number): number {
  const load = clamp(minutes, 0, 48) / 30
  const dur = (50 / clamp(durability, 5, 99)) ** 0.5
  const cond = (1 / clamp(condition, 0.4, 1)) ** 1.2
  return clamp(0.14 * load * dur * cond, 0.05, 0.6)
}

/** Games of recovery the summer is worth. A November Achilles heals; a May Achilles does not. */
export const SUMMER_HEAL_GAMES = 40

/** Games still to miss on opening night after the offseason. Knocks and strains always heal. */
export function leftoverAfterSummer(out: number, severity: InjurySeverity | null): number {
  if (!severity || severity === 'knock' || severity === 'strain') return 0
  return Math.max(0, out - SUMMER_HEAL_GAMES)
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
