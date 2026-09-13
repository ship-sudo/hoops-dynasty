// The coach: who dresses and for how long.
//
// By default the team picks itself — rank the fit men by what they are worth at their position,
// blended with last season's real minutes while that is still fresh, and hand out minutes down a
// ladder that stretches for a star and collapses for a twelfth man. A TeamSettings overrides any
// part of that: a depth order, explicit minutes, players made inactive, and the tactics the engine
// reads.
//
// Three things this file used to get wrong, all of which showed up in the box scores:
//
//   * One ladder for everybody. `[35,34,33,...]` meant no player in any era ever passed 35.0 mpg.
//     The real leaders are 41.5 (1998), 42.5 (2004), 42.0 (2016) and 37.9 (2024), and half the
//     league's best players sat six minutes a night below their real load.
//   * Ranking by a flat mean of nineteen ratings. That buries a specialist and rewards being
//     adequate at everything: Dennis Rodman 1998, the league's rebounding champion at 35.7 mpg,
//     came out twelfth man on his own team and played 2.9 minutes a night. Ranking is now
//     `roleRating` — position-weighted, volume-aware, standardised inside the position.
//   * Capping the real-minutes hint at 12 and halving it. A hint that says "this man really played
//     35.7 minutes a night" is the best information there is on opening night, and it was being
//     thrown away. It now dominates the first simulated season and fades over the next two.

import {
  assignRoles,
  clamp,
  DEFAULT_TACTICS,
  hasNamedLineups,
  instructedRatings,
  instructedTendencies,
  instructedWorkRate,
  isNeutralInstruction,
  LINEUP_UNIT_IDS,
  type LineupSlots,
  type NamedLineups,
  normaliseInstruction,
  outOfPosition,
  type PlayerGameInput,
  POSITIONS,
  type Position,
  positionGap,
  RATING_KEYS,
  type RolePlayer,
  type RotationSituation,
  type RotationUnits,
  roleOf,
  type SystemRoles,
  systemTactics,
  systemTendencies,
  type TeamGameInput,
  unitForSituation,
  type YearEnd,
} from '@hoops/core'
import { roleRating } from '@hoops/progression'
import { daysBetween } from './dates.ts'
import {
  jitterFor,
  moraleFactor,
  rotationNoise,
  type StaffProfile,
  type StaffState,
  staffBias,
  staffTactics,
  tiltFactor,
} from './staff.ts'
import type { LeaguePlayer, LeagueTeam, PlayerAvailability, TeamSettings } from './state.ts'

/** A basketball game is 240 man-minutes. Every rotation is renormalised to it. */
const TEAM_MINUTES = 240

/**
 * In uniform tonight. The roster can be 15; only twelve suit up. The engine needs eight
 * bodies when the treatment table is full.
 */
export const DRESS_MAX = 12
export const DRESS_MIN = 8

/** The regular-season ladder: eleven men, 36 down to 5, summing to 240 before any tilt. */
const LADDER_REGULAR = [36, 34, 32, 30, 28, 22, 18, 15, 12, 8, 5]

/** The playoffs tighten to nine, and the top of the ladder goes up, not down. */
const LADDER_PLAYOFFS = [42, 39, 37, 35, 33, 20, 16, 10, 8]

/** How hard the ladder tilts toward the best men on the team, per sd of depth score. */
const TILT = 0.14

/**
 * The most one man may play, by era. Coaches have ridden their stars less every decade: the league
 * minutes leader was 41.5 in 1998, 42.5 in 2004, 38.1 in 2016 (bar a one-game oddity) and 37.9 in
 * 2024. A straight line through those, held flat at both ends.
 */
export function maxMinutes(yearEnd: YearEnd): number {
  return clamp(42.5 - (yearEnd - 2004) * 0.22, 37.5, 42.5)
}

export function overallOf(p: LeaguePlayer): number {
  let s = 0
  for (const k of RATING_KEYS) s += p.ratings[k]
  return s / RATING_KEYS.length
}

/** What a player is worth to this team, at his position and with the ball he actually gets. */
export function abilityOf(p: LeaguePlayer): number {
  return roleRating(p.ratings, p.tendencies, p.pos)
}

/**
 * How much of the depth order the real-minutes hint still decides. It is the whole story on
 * opening night of the season the hint came from, a third of it a year later, and gone after that.
 */
export function hintWeight(p: LeaguePlayer, yearEnd: YearEnd): number {
  if (p.hintYear == null || p.mpgHint <= 0) return 0
  const age = yearEnd - p.hintYear
  return age <= 0 ? 0.75 : age === 1 ? 0.3 : 0
}

/** The hint, on the same 5–99 scale as `abilityOf`, so the two can be blended. */
function hintScore(mpgHint: number): number {
  return clamp(24 + mpgHint * 1.25, 5, 99)
}

/**
 * Rank by ability at the player's position, blended with what he really played in his first
 * simulated season. Uncapped, unlike the old `Math.min(12, mpgHint) * 0.5`: a 35-minute starter
 * outranks a 14-minute reserve by the width of the hint, which is the point of having one.
 */
export function depthScore(p: LeaguePlayer, yearEnd: YearEnd): number {
  const f = hintWeight(p, yearEnd)
  return f === 0 ? abilityOf(p) : abilityOf(p) * (1 - f) + hintScore(p.mpgHint) * f
}

/**
 * The ladder, tilted toward the better men. Not yet normalised: a caller may still blend it with
 * what a player really played, or with what the manager asked for.
 */
export function ladderTargets(scores: number[], playoffs: boolean, tilt = TILT): number[] {
  const n = scores.length
  if (n === 0) return []
  const base = playoffs ? LADDER_PLAYOFFS : LADDER_REGULAR
  const mean = scores.reduce((a, b) => a + b, 0) / n
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  // A floor under the sd so a squad of clones does not have its ladder blown apart by noise.
  const sd = Math.max(8, Math.sqrt(variance))
  return scores.map((s, i) => {
    const slot = base[i] ?? base[base.length - 1] ?? 8
    return Math.max(0, slot * (1 + (tilt * (s - mean)) / sd))
  })
}

/**
 * Make a wish list add up to a basketball game: 240 minutes, nobody over the era's ceiling.
 * Clamping and renormalising fight each other, so it is a short fixed-point loop — whatever a
 * capped star cannot use is handed back to the rest of the rotation.
 */
export function fitTo240(want: number[], cap: number): number[] {
  let out = want.map((m) => Math.max(0, m))
  for (let pass = 0; pass < 8; pass++) {
    const total = out.reduce((a, b) => a + b, 0) || 1
    out = out.map((m) => (m * TEAM_MINUTES) / total)
    if (!out.some((m) => m > cap + 1e-6)) break
    const free = out.filter((m) => m <= cap).reduce((a, b) => a + b, 0)
    const spare = TEAM_MINUTES - out.filter((m) => m > cap).length * cap
    out = out.map((m) => (m > cap ? cap : free > 0 ? (m * spare) / free : m))
  }
  return out
}

/** The whole allocation: ladder, tilt, era cap, 240. Kept exported so tests can read it alone. */
export function shareMinutes(scores: number[], playoffs: boolean, yearEnd: YearEnd): number[] {
  return fitTo240(ladderTargets(scores, playoffs), maxMinutes(yearEnd))
}

function slotsInOrder(slots: LineupSlots | undefined): string[] {
  if (!slots) return []
  const out: string[] = []
  for (const pos of POSITIONS) {
    const id = slots[pos]
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Starters by slot: the named unit if it exists, otherwise the old starting five. */
export function starterSlots(settings: TeamSettings | undefined): LineupSlots | undefined {
  return settings?.lineups?.starters ?? settings?.lineup
}

/** The named starting five as a flat list, PG through C, with blanks and duplicates dropped. */
export function lineupOrder(settings: TeamSettings | undefined): string[] {
  return slotsInOrder(starterSlots(settings))
}

/**
 * Everyone named in a unit, starters then bench then closing, then the old starting five.
 * Used to pull those men to the front of the dressed list so they actually play.
 */
export function namedRotation(settings: TeamSettings | undefined): string[] {
  const out: string[] = []
  const push = (id: string | undefined) => {
    if (id && !out.includes(id)) out.push(id)
  }
  const lineups: NamedLineups | undefined = settings?.lineups
  if (lineups) {
    for (const unit of LINEUP_UNIT_IDS) {
      for (const id of slotsInOrder(lineups[unit])) push(id)
    }
  }
  for (const id of slotsInOrder(settings?.lineup)) push(id)
  return out
}

/** Which slot a man has been asked to fill, or null if the manager never said. */
export function slotOf(settings: TeamSettings | undefined, playerId: string): Position | null {
  const lineups = settings?.lineups
  if (lineups) {
    for (const unit of LINEUP_UNIT_IDS) {
      const slots = lineups[unit]
      if (!slots) continue
      for (const pos of POSITIONS) if (slots[pos] === playerId) return pos
    }
  }
  const l = settings?.lineup
  if (!l) return null
  for (const pos of POSITIONS) if (l[pos] === playerId) return pos
  return null
}

/** Next man at this slot: first dressed body whose natural position is closest, rank order. */
function nextManAt(
  slot: Position,
  dressed: LeaguePlayer[],
  used: Set<string>,
): LeaguePlayer | undefined {
  let best: LeaguePlayer | undefined
  let bestGap = 99
  for (const p of dressed) {
    if (used.has(p.playerId)) continue
    const g = Math.abs(positionGap(p.pos, slot))
    if (g < bestGap) {
      best = p
      bestGap = g
      if (g === 0) break
    }
  }
  return best
}

/** Five player ids, PG through C. Named men first; holes filled next-man-up from the dressed list. */
export function fillFive(slots: LineupSlots | undefined, dressed: LeaguePlayer[]): string[] {
  const out: string[] = []
  const used = new Set<string>()
  for (const pos of POSITIONS) {
    const id = slots?.[pos]
    const named = id ? dressed.find((p) => p.playerId === id) : undefined
    const pick = named && !used.has(named.playerId) ? named : nextManAt(pos, dressed, used)
    if (!pick) continue
    out.push(pick.playerId)
    used.add(pick.playerId)
  }
  for (const p of dressed) {
    if (out.length >= 5) break
    if (used.has(p.playerId)) continue
    out.push(p.playerId)
    used.add(p.playerId)
  }
  return out.slice(0, 5)
}

function blowoutFive(bench: string[], starters: Set<string>, dressed: LeaguePlayer[]): string[] {
  const used = new Set<string>()
  const out: string[] = []
  for (const id of bench) {
    if (starters.has(id) || used.has(id)) continue
    if (!dressed.some((p) => p.playerId === id)) continue
    out.push(id)
    used.add(id)
  }
  for (const skipStars of [true, false]) {
    for (const p of dressed) {
      if (out.length >= 5) break
      if (used.has(p.playerId)) continue
      if (skipStars && starters.has(p.playerId)) continue
      out.push(p.playerId)
      used.add(p.playerId)
    }
  }
  return out.slice(0, 5)
}

/**
 * Turn named lineups into five-man groups the engine can play. Undefined when the manager
 * never opted in, so the minutes-share path is the only one that runs.
 */
export function resolveUnits(
  settings: TeamSettings | undefined,
  dressed: LeaguePlayer[],
): RotationUnits | undefined {
  if (!hasNamedLineups(settings?.lineups)) return undefined
  const starters = fillFive(starterSlots(settings), dressed)
  const starterSet = new Set(starters)
  const benchSlots = settings?.lineups?.bench
  const bench = fillFive(
    benchSlots && POSITIONS.some((p) => benchSlots[p])
      ? benchSlots
      : defaultBenchSlots(dressed, starterSet),
    dressed,
  )
  const closingSlots = settings?.lineups?.closing
  const closing = fillFive(
    closingSlots && POSITIONS.some((p) => closingSlots[p]) ? closingSlots : starterSlots(settings),
    dressed,
  )
  return {
    starters,
    bench,
    closing,
    blowout: blowoutFive(bench, starterSet, dressed),
  }
}

function defaultBenchSlots(dressed: LeaguePlayer[], starters: Set<string>): LineupSlots {
  const rest = dressed.filter((p) => !starters.has(p.playerId))
  const slots: LineupSlots = {}
  const used = new Set<string>()
  for (const pos of POSITIONS) {
    const man = nextManAt(pos, rest, used)
    if (!man) continue
    slots[pos] = man.playerId
    used.add(man.playerId)
  }
  return slots
}

/**
 * Who is on the floor for this situation. Null when lineups were never set — the caller
 * should use the minutes-share rotation, which is what calibration still measures.
 */
export function onFloorFor(
  roster: LeaguePlayer[],
  settings: TeamSettings | undefined,
  situation: RotationSituation,
  opts: RotationOptions,
): string[] | null {
  const dressed = chooseSquad(roster, opts, settings)
  const units = resolveUnits(settings, dressed)
  if (!units) return null
  let starterCondition = situation.starterCondition
  if (starterCondition == null) {
    let t = 0
    let n = 0
    for (const id of units.starters) {
      t += opts.availability?.[id]?.condition ?? 1
      n++
    }
    starterCondition = n ? t / n : 1
  }
  const unit = unitForSituation({ ...situation, starterCondition })
  return units[unit] ?? units.starters
}

/**
 * Expected minutes from the stint schedule, when units are in play.
 * Starters 30, bench 12, closing 6: a man in two units gets the sum, then fitTo240.
 */
const UNIT_MINUTES = { starters: 30, bench: 12, closing: 6 } as const

function expectedUnitMinutes(id: string, units: RotationUnits): number {
  let m = 0
  if (units.starters.includes(id)) m += UNIT_MINUTES.starters
  if (units.bench.includes(id)) m += UNIT_MINUTES.bench
  if (units.closing.includes(id)) m += UNIT_MINUTES.closing
  return m
}

export interface RotationOptions {
  /** The season being played. Sets the era's minutes ceiling and ages the real-minutes hint. */
  yearEnd: YearEnd
  /** Who is fit and how fit, by player id. Missing means fit. */
  availability?: Record<string, PlayerAvailability>
  /**
   * The league's coaching staff. Only `profiles` is read — thirty small arrays of numbers, so this
   * costs a property lookup per game and no decoding at all. Absent means every club is average and
   * the rotation behaves exactly as it did before staff existed.
   */
  staff?: StaffState
  /** Whether the zone is legal this season, for the defensive coach's scheme. */
  zoneLegal?: boolean
  /** Tonight's date, so a back-to-back is a real calendar fact. Absent means nobody is sat for rest. */
  date?: string
}

/**
 * Why this man is held out tonight, or null if he dresses. Load management lives here, not in the
 * playbook: sitting him is not a rating transform.
 */
export function restReason(
  playerId: string,
  settings: TeamSettings | undefined,
  opts: RotationOptions,
): 'bench' | 'hurt' | 'sat' | 'b2b' | 'tired' | null {
  if (settings?.inactive?.includes(playerId)) return 'bench'
  if ((opts.availability?.[playerId]?.out ?? 0) > 0) return 'hurt'
  if (settings?.sitNext?.includes(playerId)) return 'sat'
  const policy = settings?.rest?.[playerId]
  if (!policy || !opts.date) return null
  const last = opts.availability?.[playerId]?.lastGame
  const days = last ? daysBetween(last, opts.date) : 99
  const b2b = days <= 1
  if (policy === 'b2b') return b2b ? 'b2b' : null
  if (b2b) return 'b2b'
  const cond = opts.availability?.[playerId]?.condition ?? 1
  return cond < 0.78 ? 'tired' : null
}

/**
 * What a coach does to the depth chart, as one function from player to rating points.
 *
 * Two things at once, both centred on a 50-rated staff so an average league is unchanged:
 *   - a poor head coach *misranks* his squad. The jitter is deterministic, not random: he makes
 *     the same mistake every night of the season, which is what makes it a bad rotation rather
 *     than noise, and what keeps a draw out of the rng.
 *   - the assistants pull the order toward their end of the floor: a good defensive coach gets his
 *     defenders on the floor, a good offensive coach his scorers.
 */
export function coachAdjust(
  profile: StaffProfile | null,
  yearEnd: YearEnd,
): ((p: LeaguePlayer) => number) | undefined {
  if (!profile) return undefined
  const noise = rotationNoise(profile.rotation)
  return (p) => jitterFor(p.playerId, yearEnd) * noise + staffBias(p, profile)
}

/** Who is fit enough to dress, best first, and who was kept out. */
export function chooseSquad(
  roster: LeaguePlayer[],
  opts: RotationOptions,
  settings?: TeamSettings,
  adjust?: (p: LeaguePlayer) => number,
): LeaguePlayer[] {
  const score = adjust
    ? (p: LeaguePlayer) => depthScore(p, opts.yearEnd) + adjust(p)
    : (p: LeaguePlayer) => depthScore(p, opts.yearEnd)
  const held = (p: LeaguePlayer) => restReason(p.playerId, settings, opts) != null
  const out = (p: LeaguePlayer) => (opts.availability?.[p.playerId]?.out ?? 0) > 0
  let available = roster.filter((p) => !held(p))
  // Eight bodies if we can get them without dressing a man who is Out. Rest nights and a
  // healthy inactive come back first; a walking boot does not.
  if (available.length < DRESS_MIN) {
    const bench = roster
      .filter((p) => !available.includes(p) && !out(p))
      .sort((a, b) => {
        const ar = restReason(a.playerId, settings, opts)
        const br = restReason(b.playerId, settings, opts)
        const rank = (r: typeof ar) =>
          r === 'b2b' || r === 'tired' || r === 'sat' ? 0 : r === 'bench' ? 1 : 2
        return rank(ar) - rank(br) || score(b) - score(a)
      })
    available = [...available, ...bench.slice(0, DRESS_MIN - available.length)]
  }
  const pool = available.length >= 5 ? available : available.length > 0 ? available : roster.filter((p) => !out(p))
  // A coach's depth order wins; anyone he did not rank falls in behind, by ability. A named
  // starting five outranks the depth order — you cannot name a man your centre and then leave him
  // eighth in the rotation — so the five slots go to the front, PG first. Named units (bench,
  // closing) sit right behind the starters so they dress.
  const named = namedRotation(settings)
  const ranked = [...named, ...(settings?.depth ?? []).filter((id) => !named.includes(id))]
  const order = ranked.length ? new Map(ranked.map((id, i) => [id, i])) : null
  const sorted = [...pool].sort((a, b) => {
    if (order) {
      const ai = order.get(a.playerId) ?? Number.MAX_SAFE_INTEGER
      const bi = order.get(b.playerId) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
    }
    return score(b) - score(a) || (a.playerId < b.playerId ? -1 : 1)
  })
  return sorted.slice(0, Math.min(DRESS_MAX, sorted.length))
}

export function buildTeamInput(
  team: LeagueTeam,
  roster: LeaguePlayer[],
  playoffs: boolean,
  settings: TeamSettings | undefined,
  opts: RotationOptions,
): TeamGameInput {
  // One property lookup: `profiles` is a plain array of numbers per club, so the per-game path
  // never decodes a coach.
  const raw = opts.staff?.profiles[team.teamId] ?? null
  const profile: StaffProfile | null = raw
    ? {
        rotation: raw[0] ?? 50,
        adjust: raw[1] ?? 50,
        morale: raw[2] ?? 50,
        offense: raw[3] ?? 50,
        defense: raw[4] ?? 50,
        development: raw[5] ?? 50,
        scouting: raw[6] ?? 50,
        style: {
          pace: clamp(raw[7] ?? 0, -1, 1) as -1 | 0 | 1,
          threes: clamp(raw[8] ?? 0, -1, 1) as -1 | 0 | 1,
          scheme: (['press', 'balanced', 'pack'] as const)[raw[9] ?? 1] ?? 'balanced',
        },
      }
    : null
  const adjust = coachAdjust(profile, opts.yearEnd)
  const sorted = chooseSquad(roster, opts, settings, adjust).filter(
    (p) => (opts.availability?.[p.playerId]?.out ?? 0) <= 0,
  )
  const chosen = sorted.slice(0, Math.min(DRESS_MAX, sorted.length))
  const ladder = ladderTargets(
    chosen.map((p) => depthScore(p, opts.yearEnd) + (adjust?.(p) ?? 0)),
    playoffs,
    // In-game adjustments: a coach who reads a game rides his best men, one who does not spreads
    // the minutes about. TILT x0.75 at 0, x1.00 at 50, x1.25 at 100.
    TILT * (profile ? tiltFactor(profile.adjust) : 1),
  )
  // While the real-minutes hint is fresh it sets the load as well as the order. A ladder can only
  // ever say "the best man plays a lot"; the hint says Luc Longley played 29.4 and Scott Burrell
  // 13.7, which is the difference between a rotation that looks like the real one and one that
  // merely ranks the same men in the same order.
  const units = resolveUnits(settings, chosen)
  // Named units replace the ladder: minutes fall out of who is in which group. The old
  // share path — ladder, hint, tilt — is the only one that runs when lineups were never set.
  const want = chosen.map((p, i) => {
    if (units) return expectedUnitMinutes(p.playerId, units)
    const f = hintWeight(p, opts.yearEnd)
    const l = ladder[i] ?? 0
    return f > 0 ? l * (1 - f) + p.mpgHint * f : l
  })
  // Explicit minutes override everything. They are renormalised to 240, so what matters is the
  // share a coach gives each man, not whether his numbers happen to add up.
  const explicit = settings?.minutes
  let capped = maxMinutes(opts.yearEnd)
  for (let i = 0; i < chosen.length; i++) {
    const asked = explicit?.[(chosen[i] as LeaguePlayer).playerId]
    if (asked == null) continue
    want[i] = clamp(asked, 0, 48)
    // A manager who insists on 44 minutes gets 44 minutes. He also gets the bill; see play.ts.
    capped = Math.max(capped, want[i] as number)
  }
  const minutes = fitTo240(want, capped)

  // The playbook. A system picks its own hub and ball-handler out of the men who are actually
  // dressing, so an injury to your post really does hand the job to somebody else.
  const system = settings?.system ?? 'balanced'
  const roles: SystemRoles =
    system === 'balanced'
      ? { hubId: null, handlerId: null }
      : assignRoles(chosen.map((p): RolePlayer => ({ ...p })))

  // Man management, through the one input that carries it: a squad that likes its coach turns up
  // fresher. x0.97 at 0, x1.00 at 50, x1.03 at 100 — a nudge, not a cheat.
  const morale = profile ? moraleFactor(profile.morale) : 1

  const players: PlayerGameInput[] = chosen.map((p, i) => {
    // Ratings first: being out of position is a fact about the man, and an instruction is layered
    // on top of whatever he is once he has been asked to guard a centre.
    const slot = slotOf(settings, p.playerId)
    let ratings = slot ? outOfPosition(p.ratings, p.pos, slot) : p.ratings
    // Tendencies: the system reshapes the offence, then the coach overrides one man inside it.
    let tendencies =
      system === 'balanced'
        ? p.tendencies
        : systemTendencies(system, p.tendencies, roleOf(p.playerId, roles))
    let workRate = 1
    const ins = settings?.instructions?.[p.playerId]
    if (!isNeutralInstruction(ins)) {
      const n = normaliseInstruction(ins)
      tendencies = instructedTendencies(tendencies, n)
      ratings = instructedRatings(ratings, n)
      workRate = instructedWorkRate(n)
    }
    const out: PlayerGameInput = {
      playerId: p.playerId,
      name: p.name,
      pos: slot ?? p.pos,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      age: p.age,
      ratings,
      tendencies,
      minutesTarget: minutes[i] ?? 0,
      starter: units ? units.starters.includes(p.playerId) : i < 5,
      condition: clamp((opts.availability?.[p.playerId]?.condition ?? 1) * morale, 0.3, 1),
    }
    // Left off entirely at the default so an untouched save produces a byte-identical input.
    if (workRate !== 1) out.workRate = workRate
    return out
  })

  // A club the manager has never touched plays the way its coaches want it to. That is where the
  // offensive and defensive coaches actually land: `Tactics`, the input the engine already reads.
  const base =
    settings?.tactics ??
    (profile ? staffTactics(profile, roster, opts.zoneLegal ?? false) : DEFAULT_TACTICS)
  const input: TeamGameInput = {
    teamId: team.teamId,
    name: team.name,
    players,
    tactics: system === 'balanced' ? base : systemTactics(system, base),
  }
  if (units) input.units = units
  const style = settings?.unitTactics
  if (style && (style.starters || style.bench || style.closing)) input.unitStyle = style
  return input
}
