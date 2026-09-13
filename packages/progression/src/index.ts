// Player development, ageing, retirement, and the fate slider.
//
// Three ingredients:
//   1. curves.json — what really happened to ratings at each age, 1998–2026 (fit-curves.ts).
//   2. Potential — a hidden ceiling. Under it, a young player gains faster than the curve; at it,
//      he tracks the curve. Potential itself drifts a little, so scouting is never certain.
//   3. Fate — BRIEF A3. 0 means a real player follows his real career ratings exactly; 100 means the
//      model decides everything. In between the two are blended, so history bends rather than breaks.

import {
  type CareerArc,
  clamp,
  type Position,
  RATING_KEYS,
  type Ratings,
  type Rng,
  type Tendencies,
} from '@hoops/core'
import curvesJson from './curves.json' with { type: 'json' }

export interface AgeCurve {
  n: number
  retireRate: number
  delta: Record<string, number>
  sd: Record<string, number>
}

export const MIN_AGE = 18
export const MAX_AGE = 44

/** Ages with few observations are noisy, so they borrow from their neighbours. */
export function smoothCurves(raw: Record<string, AgeCurve>): Record<number, AgeCurve> {
  const out: Record<number, AgeCurve> = {}
  for (let age = MIN_AGE; age <= MAX_AGE; age++) {
    const here = raw[String(age)]
    const near = [raw[String(age - 1)], here, raw[String(age + 1)]].filter(Boolean) as AgeCurve[]
    if (!here || near.length === 0) continue
    const delta: Record<string, number> = {}
    const sd: Record<string, number> = {}
    // Weight each age by how much evidence it has, capped so a huge bucket cannot swamp its neighbours.
    const weights = near.map((c) => Math.min(1, (c.n ?? 0) / 200))
    const wsum = weights.reduce((a, b) => a + b, 0) || 1
    for (const k of RATING_KEYS) {
      delta[k] = near.reduce((a, c, i) => a + (c.delta[k] ?? 0) * (weights[i] ?? 0), 0) / wsum
      sd[k] = Math.max(
        1,
        near.reduce((a, c, i) => a + (c.sd[k] ?? 2) * (weights[i] ?? 0), 0) / wsum,
      )
    }
    out[age] = { n: here.n, retireRate: here.retireRate, delta, sd }
  }
  return out
}

export const CURVES = smoothCurves(curvesJson as unknown as Record<string, AgeCurve>)

export function curveFor(age: number): AgeCurve {
  const a = clamp(Math.round(age), MIN_AGE, MAX_AGE)
  const c = CURVES[a] ?? CURVES[Math.min(MAX_AGE, MIN_AGE + 20)]
  if (c) return c
  const delta: Record<string, number> = {}
  const sd: Record<string, number> = {}
  for (const k of RATING_KEYS) {
    delta[k] = 0
    sd[k] = 2
  }
  return { n: 0, retireRate: 0.1, delta, sd }
}

/** The skills a player is judged on when we need one number. Kept small and honest. */
const OVERALL_KEYS = [
  'rim',
  'close',
  'mid',
  'three',
  'passing',
  'handling',
  'dreb',
  'perimD',
  'interiorD',
  'iq',
] as const

export function overall(r: Ratings): number {
  let s = 0
  for (const k of OVERALL_KEYS) s += r[k]
  return s / OVERALL_KEYS.length
}

// ---------------------------------------------------------------------------
// roleRating: how good a player is *at his job*.
//
// `overall` is a flat mean, and a flat mean is the wrong tool for ranking a squad. It buries
// volume scoring (a 30%-usage wing and a 12%-usage spot-up man are added up the same way), it
// pays a centre for perimeter defence he never plays, and because the rating anchors are pooled
// across all five positions it hands every point guard a huge passing/steal z and every centre a
// huge block/oreb z. Ranked by that mean, Dennis Rodman 1998 — the league's rebounding champion —
// is his team's twelfth man.
//
// roleRating fixes the three faults in order:
//   1. skills are folded into six aggregates, with shooting weighted by the *value* of each zone
//      a player actually shoots from rather than by raw attempt share;
//   2. the aggregates are weighted per position, so a centre is judged on what a centre does;
//   3. the result is standardised inside the position, against the pooled 1998–2026 distribution
//      of rotation players (500+ minutes), so 50 means "an average rotation player at this spot"
//      in every era and at every position.
// A volume term on top pays for usage: being efficient with a third of the possessions is worth
// more than being efficient with a tenth of them.
// ---------------------------------------------------------------------------

/** Points per attempt by zone: rim, close, mid, three. Shooting skill is weighted by these. */
const PTS_PER_ATTEMPT = [1.3, 0.95, 0.82, 1.08] as const

/** Aggregate weights per position: scoring, creation, defence, boards, iq, athleticism. */
const ROLE_WEIGHTS: Record<Position, readonly [number, number, number, number, number, number]> = {
  PG: [0.34, 0.28, 0.2, 0.06, 0.08, 0.04],
  SG: [0.4, 0.16, 0.26, 0.08, 0.07, 0.03],
  SF: [0.36, 0.15, 0.27, 0.13, 0.06, 0.03],
  PF: [0.32, 0.1, 0.28, 0.21, 0.06, 0.03],
  C: [0.3, 0.08, 0.32, 0.24, 0.05, 0.01],
}

/**
 * Mean and sd of the raw role score inside each position, measured over every player-season with
 * 500+ real minutes in all 29 bundles (1998–2026). Frozen, like the rating anchors, so a number
 * means the same thing in every season. Re-measure if ROLE_WEIGHTS or the aggregates change.
 */
const ROLE_ANCHOR: Record<Position, readonly [number, number]> = {
  PG: [53.67, 5.55],
  SG: [49.92, 4.64],
  SF: [49.93, 4.86],
  PF: [52.17, 5.67],
  C: [55.99, 6.29],
}

/** 1 sd inside a position is worth this many rating points. */
const ROLE_SCALE = 9

export interface RoleParts {
  scoring: number
  creation: number
  defence: number
  boards: number
  iq: number
  athletic: number
}

/** The six things a basketball player is paid for, from the nineteen ratings. */
export function roleParts(r: Ratings, t: Tendencies): RoleParts {
  const mix = [t.shotRim, t.shotClose, t.shotMid, t.shotThree]
  const skill = [r.rim, r.close, r.mid, r.three]
  let w = 0
  let s = 0
  for (let i = 0; i < 4; i++) {
    const wi = Math.max(0, mix[i] ?? 0) * (PTS_PER_ATTEMPT[i] as number)
    w += wi
    s += wi * (skill[i] as number)
  }
  const shot = w > 0 ? s / w : (r.rim + r.close + r.mid + r.three) / 4
  return {
    scoring: shot * 0.72 + r.ft * 0.1 + r.drawFoul * 0.18,
    creation: r.passing * 0.62 + r.handling * 0.38,
    defence: r.perimD * 0.34 + r.interiorD * 0.24 + r.steal * 0.21 + r.block * 0.21,
    boards: r.oreb * 0.35 + r.dreb * 0.65,
    iq: r.iq,
    athletic: r.speed * 0.5 + r.strength * 0.5,
  }
}

/** League-average usage. A player at this share of possessions gets no volume credit either way. */
const REF_USAGE = 0.2

/**
 * How good a player is at his position, 5–99, on a scale where 50 is an average rotation player
 * and the best man in a league lands in the high eighties or low nineties. Use this to rank a
 * roster, not `overall`.
 */
export function roleRating(r: Ratings, t: Tendencies, pos: Position): number {
  const p = roleParts(r, t)
  const w = ROLE_WEIGHTS[pos] ?? ROLE_WEIGHTS.SF
  const base =
    p.scoring * w[0] +
    p.creation * w[1] +
    p.defence * w[2] +
    p.boards * w[3] +
    p.iq * w[4] +
    p.athletic * w[5]
  // Volume. Efficiency is only worth what it is carried on: shooting 48% from three on four
  // attempts a night is a useful role player, not a star, and an additive nudge was not enough to
  // say so — low-usage specialists were reading as All-NBA (Fred Hoiberg 87, above Kobe). The
  // scoring aggregate is scaled by the share of the offence a man actually carries, so being
  // efficient with a third of the possessions beats being efficient with a tenth of them.
  const load = clamp(t.usage / REF_USAGE, 0.5, 1.75)
  const carried = p.scoring * (0.58 + 0.42 * load) - p.scoring
  const volume = carried * 0.85
  const [mean, sd] = ROLE_ANCHOR[pos] ?? ROLE_ANCHOR.SF
  return clamp(50 + (ROLE_SCALE * (base + volume - mean)) / sd, 5, 99)
}

export interface DevelopInput {
  ratings: Ratings
  age: number
  /** Hidden ceiling, on the same scale as `overall`. */
  potential: number
  /** Minutes played last season. Bench players develop more slowly. */
  minutes: number
  rng: Rng
}

export interface DevelopResult {
  ratings: Ratings
  potential: number
}

/**
 * One offseason of change. The curve sets the direction, potential sets how much room is left,
 * and the rng supplies the season-to-season noise that makes two identical prospects diverge.
 */
export function develop(input: DevelopInput): DevelopResult {
  const { ratings, age, minutes, rng } = input
  const curve = curveFor(age)
  const now = overall(ratings)
  const room = input.potential - now
  // Under 25 a player with headroom gains faster; a player already at his ceiling does not.
  const young = age <= 25
  const push = young ? clamp(room / 12, -0.5, 1.6) : clamp(room / 25, -0.4, 0.6)
  // Minutes are opportunity: a man who played 2,000 minutes develops on schedule, a 300-minute
  // deep reserve moves about half as much.
  const playWeight = clamp(0.45 + minutes / 2400, 0.45, 1.15)

  // Survivorship correction. The curves only see players who were still in the league the next
  // season, so they understate decline: the men who fell apart simply vanish from the sample.
  // Two corrections, both growing with age:
  //   - losses are amplified once a player is past 29,
  //   - stars carry an extra tax, because a 62 has further to fall than a 45 and the league
  //     stops giving him the minutes that held his numbers up.
  const past29 = Math.max(0, age - 29)
  const declineBoost = 1 + past29 * 0.11
  const starTax = past29 > 0 ? Math.max(0, now - 48) * 0.018 * past29 : 0

  const next = {} as Ratings
  for (const k of RATING_KEYS) {
    const base = (curve.delta[k] ?? 0) * playWeight
    const growth = base >= 0 ? base * (1 + push) : base * (1 - push * 0.35) * declineBoost
    const noise = rng.normal(0, (curve.sd[k] ?? 2) * 0.55)
    next[k] = clamp(Math.round(ratings[k] + growth + noise - starTax), 5, 99)
  }
  // Potential erodes slowly with age and drifts a touch, so scouting reports go stale.
  const drift = rng.normal(0, 1.2) - (age >= 27 ? 0.8 : 0)
  const potential = clamp(input.potential + drift, overall(next), 99)
  return { ratings: next, potential }
}

export interface RetireInput {
  age: number
  ratings: Ratings
  minutes: number
  rng: Rng
  /** Last real season he played (yearEnd). Omit for fictional players. */
  lastRealYear?: number
  /** Season that just ended. */
  yearEnd?: number
  /** 0 = follow his real last season, 100 = the age-curve model. */
  fate?: number
}

/**
 * Probability a player is out of the league next season.
 *
 * The base rate is "share of players this age who did not appear the following season". On top of
 * that, leaving is strongly selective: teams keep good players and stop calling replacement-level
 * thirty-somethings. That selection is why the average 36-year-old in the real data rates *higher*
 * than the average 26-year-old — the weak ones are gone, not improved. Without a steep quality
 * term here the league fills up with ancient scrubs.
 *
 * The selection used to sharpen *with* age, which inverted the whole thing: a 24-year-old starter
 * was two and a half times more likely to vanish than a 34-year-old, the league's mean age fell to
 * 24.7 and the best rating in it drifted down year on year. It is the other way round. Nobody gives
 * up on a good 24-year-old — he gets chance after chance — while a good 34-year-old is a year or
 * two from the end whatever he is still doing on the floor. So selection is *strongest* when young
 * and relaxes with age, and the base rate carries the rise.
 *
 * The quality term is deliberately asymmetric. Being above average buys a lot of protection; being
 * below it costs less than that protection is worth, because otherwise every fringe twenty-something
 * in the league would be gone inside one summer.
 */
export function retireChance(
  age: number,
  ratings: Ratings,
  minutes: number,
  hist?: { lastRealYear: number; yearEnd: number; fate?: number },
): number {
  const curve = curveFor(age)
  const ov = overall(ratings)
  // How far above or below a keepable player he is, in rating points.
  const edge = (ov - 50) / 10
  // 2.4 through the twenties, easing to 1.45 for the old men the league is already done with.
  const sharpness = clamp(2.4 - Math.max(0, age - 26) * 0.09, 1.45, 2.4)
  const played = clamp(minutes / 1600, 0, 1.2)
  const selection = Math.exp(edge >= 0 ? -sharpness * edge : -sharpness * 0.45 * edge)
  let p = curve.retireRate * selection * (1.3 - 0.5 * played)
  if (hist) {
    // Remaining real seasons after the one that just closed. Positive means he still had a career
    // ahead of him; zero or less means this was the year he actually left.
    const remaining = hist.lastRealYear - hist.yearEnd
    const f = clamp(hist.fate ?? 100, 0, 100) / 100
    if (remaining >= 3) {
      // Duncan in 2004 still has a decade on the book. Fate 0 forbids leaving; fate 100 still
      // cuts the chance, because a random retirement of a 28-year-old star is the bug.
      const protect = (1 - 0.35 * f) * clamp(remaining / 8, 0, 1)
      p *= 1 - protect
    } else if (remaining <= 0) {
      const pull = 1 - 0.45 * f
      p = p * (1 - pull) + 0.85 * pull
    }
  }
  return clamp(age >= 41 ? Math.max(p, 0.45) : p, 0.002, 0.98)
}

export function retires(input: RetireInput): boolean {
  const last = input.lastRealYear
  const yearEnd = input.yearEnd
  if (last === undefined || yearEnd === undefined)
    return input.rng.chance(retireChance(input.age, input.ratings, input.minutes))
  const hist =
    input.fate === undefined
      ? { lastRealYear: last, yearEnd }
      : { lastRealYear: last, yearEnd, fate: input.fate }
  return input.rng.chance(retireChance(input.age, input.ratings, input.minutes, hist))
}

/**
 * Fate: 0 = the real career, 100 = the model's career. Anything between blends the two, so a
 * real player still resembles himself while your league drifts away from history.
 */
export function blendToFate(model: Ratings, real: Ratings | null, fate: number): Ratings {
  if (!real) return model
  const f = clamp(fate, 0, 100) / 100
  const out = {} as Ratings
  for (const k of RATING_KEYS) out[k] = Math.round(real[k] * (1 - f) + model[k] * f)
  return out
}

/** The real ratings a player had in a given season, if he had one. Used by fate < 100. */
export function arcRatings(arc: CareerArc | undefined, yearEnd: number): Ratings | null {
  const s = arc?.seasons.find((x) => x.yearEnd === yearEnd)
  return s?.ratings ?? null
}

/**
 * A draft prospect's hidden potential, from the ratings he arrives with. Younger and better-rated
 * prospects get more headroom; the rng makes busts and steals.
 */
export function draftPotential(ratings: Ratings, age: number, rng: Rng): number {
  const now = overall(ratings)
  const youth = clamp(24 - age, 0, 6)
  const headroom = youth * 2.2 + rng.normal(4, 5)
  return clamp(now + Math.max(-2, headroom), now, 95)
}
