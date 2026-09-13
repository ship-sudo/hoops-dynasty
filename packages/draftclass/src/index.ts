// Draft classes: the real ones, made-up ones, and the fog you see them through.
//
// Historical mode (BRIEF A3): the 2003 draft really does contain LeBron. His rookie ratings come
// from the season he actually played, and his hidden potential from what his career became — so a
// team that drafts him gets the player, but only if it develops him. The fate slider decides how
// closely the rest of his career follows history; that lives in @hoops/progression.
//
// Fictional mode generates prospects from archetypes once history runs out (or when you want a
// league that owes nothing to the real one).
//
// Either way the user never sees true ratings. Scouting adds noise that shrinks with how good your
// scouts are and how high the prospect is on the board.

import {
  type CareerArc,
  clamp,
  type HistoryBundle,
  type Position,
  RATING_KEYS,
  type Ratings,
  type Rng,
  type Tendencies,
  type YearEnd,
} from '@hoops/core'
import { draftPotential, overall } from '@hoops/progression'
import { NameBank } from './names.ts'

export * from './names.ts'

export interface Prospect {
  prospectId: string
  name: string
  pos: Position
  age: number
  heightIn: number
  weightLb: number
  /** What he actually is. Never show this to the user. */
  ratings: Ratings
  tendencies: Tendencies
  /** Hidden ceiling. */
  potential: number
  /** Real draft slot when this prospect comes from history, else null. */
  realPick: number | null
  /** The real player this prospect is, when historical. Lets the fate slider find his career. */
  playerId: string | null
  origin: 'historical' | 'fictional'
}

export interface ScoutedProspect extends Omit<Prospect, 'ratings' | 'potential'> {
  /** What your scouts think he is. */
  ratings: Ratings
  /** Their read on his ceiling, as a range. */
  potentialLow: number
  potentialHigh: number
  /** 0–1, how confident the department is. */
  confidence: number
}

/**
 * The real draft class for a year, as prospects.
 *
 * A drafted player's rookie ratings are the ones he posted in his first NBA season, pulled back
 * toward a rookie baseline — he arrived worse than he finished. Anyone who never played gets a
 * generated fringe profile, which is what a late second-rounder usually is.
 */
export function historicalClass(
  history: HistoryBundle,
  draftYear: number,
  rng: Rng,
  opts: { size?: number } = {},
): Prospect[] {
  const rows = history.drafts[draftYear] ?? []
  const byPlayer = new Map(history.careers.map((c) => [c.playerId, c]))
  const out: Prospect[] = []
  for (const row of rows) {
    if (opts.size && out.length >= opts.size) break
    const career = row.playerId ? byPlayer.get(row.playerId) : undefined
    out.push(
      career
        ? fromCareer(career, row.overall, draftYear, rng)
        : fringeProspect(row.name, row.overall, draftYear, rng),
    )
  }
  return out
}

function fromCareer(career: CareerArc, pick: number, draftYear: number, rng: Rng): Prospect {
  const seasons = [...career.seasons].sort((a, b) => a.yearEnd - b.yearEnd)
  const rookie = seasons[0]
  const peak = seasons.reduce(
    (best, s) => (overall(s.ratings) > overall(best.ratings) ? s : best),
    rookie ?? seasons[0]!,
  )
  const base = rookie?.ratings ?? peak?.ratings
  if (!base) return fringeProspect(career.name, pick, draftYear, rng)
  // Draft-night ratings: a notch below the rookie season he went on to play.
  const ratings = {} as Ratings
  for (const k of RATING_KEYS) ratings[k] = clamp(Math.round(base[k] - rng.normal(2, 1.5)), 5, 99)
  const age = rookie ? Math.max(18, Math.round(rookie.age - 1)) : 20
  return {
    prospectId: `h-${draftYear}-${career.playerId}`,
    name: career.name,
    pos: career.pos,
    age,
    heightIn: career.heightIn,
    weightLb: career.weightLb,
    ratings,
    tendencies: rookie?.tendencies ?? peak?.tendencies ?? defaultTendencies(),
    // What he really became is his ceiling, with a little slack so history is not a spoiler.
    potential: clamp(overall(peak.ratings) + rng.normal(1, 2.5), overall(ratings), 99),
    realPick: pick,
    playerId: career.playerId,
    origin: 'historical',
  }
}

function defaultTendencies(): Tendencies {
  return {
    usage: 0.18,
    shotRim: 0.32,
    shotClose: 0.16,
    shotMid: 0.27,
    shotThree: 0.25,
    assist: 0.14,
    postUp: 0.1,
  }
}

const ARCHETYPES: {
  name: string
  pos: Position
  height: [number, number]
  weight: [number, number]
  strong: (keyof Ratings)[]
  weak: (keyof Ratings)[]
  tendencies: Partial<Tendencies>
}[] = [
  {
    name: 'lead guard',
    pos: 'PG',
    height: [72, 76],
    weight: [175, 200],
    strong: ['passing', 'handling', 'iq', 'speed'],
    weak: ['interiorD', 'oreb', 'strength'],
    tendencies: { usage: 0.24, assist: 0.3, shotThree: 0.34, shotRim: 0.28 },
  },
  {
    name: 'three-and-D wing',
    pos: 'SG',
    height: [76, 79],
    weight: [195, 220],
    strong: ['three', 'perimD', 'speed'],
    weak: ['passing', 'oreb'],
    tendencies: { usage: 0.16, shotThree: 0.52, shotRim: 0.24, assist: 0.08 },
  },
  {
    name: 'shot creator',
    pos: 'SF',
    height: [77, 81],
    weight: [205, 230],
    strong: ['mid', 'rim', 'drawFoul', 'handling'],
    weak: ['dreb', 'block'],
    tendencies: { usage: 0.3, shotMid: 0.34, shotThree: 0.3, assist: 0.16 },
  },
  {
    name: 'stretch four',
    pos: 'PF',
    height: [79, 82],
    weight: [220, 245],
    strong: ['three', 'dreb', 'iq'],
    weak: ['speed', 'steal'],
    tendencies: { usage: 0.19, shotThree: 0.45, shotClose: 0.18 },
  },
  {
    name: 'rim-running big',
    pos: 'C',
    height: [81, 85],
    weight: [235, 275],
    strong: ['rim', 'oreb', 'dreb', 'block', 'interiorD', 'strength'],
    weak: ['three', 'ft', 'speed', 'handling'],
    tendencies: { usage: 0.18, shotRim: 0.62, shotClose: 0.24, shotThree: 0.02, assist: 0.06 },
  },
  {
    name: 'raw athlete',
    pos: 'SF',
    height: [78, 82],
    weight: [200, 230],
    strong: ['speed', 'rim', 'steal'],
    weak: ['iq', 'three', 'handling'],
    tendencies: { usage: 0.2, shotRim: 0.45, shotThree: 0.2 },
  },
]

/** A made-up class. Talent thins out down the board, the way a real one does. */
export function fictionalClass(
  draftYear: number,
  rng: Rng,
  opts: { size?: number; names?: string[]; bank?: NameBank } = {},
): Prospect[] {
  const size = opts.size ?? 58
  // A league keeps one bank, so no two players ever share a name. Without one the class still
  // gets real names, they just cannot be checked against the rest of the league.
  const bank = opts.bank ?? new NameBank()
  const out: Prospect[] = []
  for (let i = 0; i < size; i++) {
    const slot = i + 1
    const arch = ARCHETYPES[rng.int(ARCHETYPES.length)] ?? ARCHETYPES[0]!
    // Board strength: the top pick is a 55-ish rookie, the last a fringe roster player.
    const tier = clamp(58 - slot * 0.42 + rng.normal(0, 3), 28, 62)
    const ratings = {} as Ratings
    for (const k of RATING_KEYS) {
      const bump = arch.strong.includes(k) ? 9 : arch.weak.includes(k) ? -10 : 0
      ratings[k] = clamp(Math.round(tier + bump + rng.normal(0, 4)), 5, 99)
    }
    const age = 19 + rng.int(4)
    const name = opts.names?.[i] ?? bank.next(draftYear, rng)
    out.push({
      prospectId: `f-${draftYear}-${slot}`,
      name,
      pos: arch.pos,
      age,
      heightIn: Math.round(arch.height[0] + rng.next() * (arch.height[1] - arch.height[0])),
      weightLb: Math.round(arch.weight[0] + rng.next() * (arch.weight[1] - arch.weight[0])),
      ratings,
      tendencies: { ...defaultTendencies(), ...arch.tendencies },
      potential: draftPotential(ratings, age, rng),
      realPick: null,
      playerId: null,
      origin: 'fictional',
    })
  }
  return out
}

function fringeProspect(name: string, pick: number, draftYear: number, rng: Rng): Prospect {
  const [one] = fictionalClass(draftYear, rng, { size: 1 })
  const base = one!
  const tier = clamp(44 - pick * 0.2, 26, 46)
  const ratings = {} as Ratings
  for (const k of RATING_KEYS) ratings[k] = clamp(Math.round(tier + rng.normal(0, 5)), 5, 99)
  return {
    ...base,
    prospectId: `h-${draftYear}-${pick}-${name.replace(/\s+/g, '')}`,
    name,
    ratings,
    potential: draftPotential(ratings, base.age, rng),
    realPick: pick,
    playerId: null,
    origin: 'historical',
  }
}

/**
 * What the scouting department reports. `scouting` is the team's scouting rating, 0–100.
 * Better departments see closer to the truth; every department sees the top of the board more
 * clearly than the back of it, because those players are watched by everyone.
 */
/**
 * What the scouting department reports.
 *
 * Two things matter here and both were wrong once:
 *
 * 1. **The range must be about his ceiling, not his present.** The band is a noisy read of the
 *    prospect's true `potential`. Before, it was computed from the observed current rating plus a
 *    constant, so every player in a draft read `now-2` to `now+9` and the range told you nothing —
 *    there was no reason to take anyone but the top of the board.
 * 2. **A report must not change because someone else got drafted.** Pass a `boardRank` that is the
 *    prospect's standing in the class when it was published, not his index in a shrinking list,
 *    and scout each man once.
 *
 * `scouting` is the department's rating, 0-100. Better departments see closer to the truth, and
 * everyone sees the top of the board more clearly than the back of it.
 */
export function scout(
  prospect: Prospect,
  scouting: number,
  rng: Rng,
  boardRank = 30,
): ScoutedProspect {
  const skill = clamp(scouting / 100, 0.05, 1)
  const exposure = clamp(1.1 - boardRank / 60, 0.45, 1.1)
  // Noise in rating points: a great department on a lottery pick is within a couple of points.
  const noise = clamp(11 * (1 - skill * 0.75) * (1 / exposure), 1.2, 16)
  const ratings = {} as Ratings
  for (const k of RATING_KEYS)
    ratings[k] = clamp(Math.round(prospect.ratings[k] + rng.normal(0, noise)), 5, 99)
  const seen = overall(ratings)

  // The ceiling is harder to judge than present ability, so its error is wider than the error on
  // the ratings — but it is error about the real number, and it stays inside believable bounds. A
  // department that is merely poor should be vague, not deranged: unbounded here it reported
  // bands like "99 to 99" for a 61-rated teenager.
  const ceilingNoise = clamp(noise * 1.1 + 1.5, 2, 9)
  const guess = prospect.potential + rng.normal(0, ceilingNoise)
  const half = clamp(ceilingNoise, 2.5, 9)
  const low = Math.round(Math.max(guess - half, seen))
  const high = Math.round(Math.max(guess + half, low + 3))
  return {
    prospectId: prospect.prospectId,
    name: prospect.name,
    pos: prospect.pos,
    age: prospect.age,
    heightIn: prospect.heightIn,
    weightLb: prospect.weightLb,
    tendencies: prospect.tendencies,
    realPick: prospect.realPick,
    playerId: prospect.playerId,
    origin: prospect.origin,
    ratings,
    // However wrong the department is, it never reports a ceiling beneath what it can already see.
    potentialLow: clamp(low, 20, 96),
    potentialHigh: clamp(high, 23, 99),
    confidence: Math.round(clamp(skill * exposure, 0.05, 1) * 100) / 100,
  }
}

export function scoutedBoard(
  prospects: readonly Prospect[],
  scouting: number,
  rng: Rng,
): ScoutedProspect[] {
  const rough = prospects.map((p, i) => scout(p, scouting, rng, i + 1))
  return rough.sort((a, b) => {
    const av = overall(a.ratings) + (a.potentialHigh - overall(a.ratings)) * 0.45
    const bv = overall(b.ratings) + (b.potentialHigh - overall(b.ratings)) * 0.45
    return bv - av
  })
}

/** Draft classes for a season: real history while it lasts, invented after. */
export function classFor(
  history: HistoryBundle,
  draftYear: YearEnd,
  rng: Rng,
  mode: 'historical' | 'fictional',
  bank: NameBank = new NameBank(),
): Prospect[] {
  if (mode === 'fictional') return fictionalClass(draftYear, rng, { bank })
  const real = historicalClass(history, draftYear, rng)
  return real.length > 0 ? real : fictionalClass(draftYear, rng, { bank })
}

/**
 * Undrafted fillers: the men at the very back of a roster.
 *
 * A league loses more players to retirement each year than two draft rounds replace, so the gap is
 * filled from the G League, Europe and training camp. These are NOT prospects — they are
 * replacement level, and they must stay that way. Generating them at draft-class quality floods
 * the league: in a 1998 dynasty run, invented players held 19 of the top 20 scoring places by
 * 2004, with Kobe, Duncan and Shaq pushed out of their own era.
 *
 * So: rated around the fringe of a rotation, with barely any headroom. A few are late bloomers,
 * which is how the real ones occasionally stick.
 */
export function undraftedFillers(
  year: number,
  rng: Rng,
  count: number,
  bank: NameBank = new NameBank(),
): Prospect[] {
  const out: Prospect[] = []
  for (let i = 0; i < count; i++) {
    const arch = ARCHETYPES[rng.int(ARCHETYPES.length)] ?? ARCHETYPES[0]!
    // Fringe of an NBA roster: a 38 plays in garbage time, a 46 is a useful tenth man.
    const tier = clamp(38 + rng.normal(0, 4), 26, 48)
    const ratings = {} as Ratings
    for (const k of RATING_KEYS) {
      const bump = arch.strong.includes(k) ? 7 : arch.weak.includes(k) ? -8 : 0
      ratings[k] = clamp(Math.round(tier + bump + rng.normal(0, 3.5)), 5, 99)
    }
    const age = 21 + rng.int(6)
    // One in twelve has something left to find; the rest are what they are.
    const headroom = rng.chance(1 / 12) ? rng.normal(8, 3) : rng.normal(1.5, 1.5)
    out.push({
      prospectId: `u-${year}-${i}-${rng.int(1e6)}`,
      name: bank.next(year, rng),
      pos: arch.pos,
      age,
      heightIn: Math.round(arch.height[0] + rng.next() * (arch.height[1] - arch.height[0])),
      weightLb: Math.round(arch.weight[0] + rng.next() * (arch.weight[1] - arch.weight[0])),
      ratings,
      tendencies: { ...defaultTendencies(), ...arch.tendencies },
      potential: clamp(overall(ratings) + Math.max(0, headroom), overall(ratings), 70),
      realPick: null,
      playerId: null,
      origin: 'fictional',
    })
  }
  return out
}
