// Possession-level simulation engine.
//
// The game is a clock. Possessions alternate until 48 minutes are gone, then 5-minute
// overtimes while the score is tied. Each possession picks a user by usage, resolves a
// turnover, then a shot zone, then a make, a foul, free throws and a rebound battle.
//
// Every probability is an era anchor (see anchors.ts) perturbed by a log-odds term built
// from ratings. Each term is measured against a reference rating (see REFERENCE below), so
// a league of players sitting at their references reproduces the EraContext exactly.
// Ratings move the game, never a hidden constant.

import {
  emptyStatLine,
  type GameInput,
  type GameResult,
  makeRng,
  type PbpEvent,
  type PlayerBox,
  type PlayerGameInput,
  type Ratings,
  type Rng,
  type StatLine,
  type TeamBox,
  type TeamGameInput,
  unitForSituation,
} from '@hoops/core'
import {
  type Anchors,
  CLOSE,
  computeAnchors,
  FT_ORB_Z,
  MID,
  ORB_SECONDS,
  RIM,
  THREE,
} from './anchors.ts'

export interface SimOptions {
  /** Build the play-by-play log. Default true. Turning it off is ~25% faster. */
  pbp?: boolean
}

/** Scale on log-odds terms driven by one player's own rating. Held near 1 so the best
 *  shooter in the league shoots like the best shooter in the league and no better. */
const GAIN = 1.3

/** Scale on log-odds terms driven by a five-man aggregate — team defence, the glass, ball
 *  pressure. A five-man mean varies far less than one rating, so this can be larger without
 *  producing superhuman individuals, and it is where a team's identity actually lives.
 *  Tuned against the real spread of team wins. */
const TEAM_GAIN = 3.5

/** Rating sd in the pooled anchor, as a dv. Used only for the convexity correction below. */
const RATING_DV_SD = 0.3

/** oddsAdj is not linear, so spreading z around 0 moves the *mean* probability away from
 *  the anchor (up when p < 0.5, down when p > 0.5). This is the second-order correction
 *  that puts it back, so a league of real players still reproduces the EraContext. */
function jensen(p: number, sigmaZ: number): number {
  return -0.5 * sigmaZ * sigmaZ * (1 - 2 * p)
}

/** Per-zone weight on the shooter's own zone rating. */
const SHOT_K = [0.5, 0.48, 0.48, 0.46] as const
/** Per-zone weight on the defence (interiorD inside, perimD outside). */
const DEF_K = [0.24, 0.23, 0.2, 0.18] as const

// ---- reference ratings ----
// 50 is the *all-player pooled* anchor from packages/ratings, but the league average of any
// anchored rate is taken over the players who actually do the thing, and those players are
// better than average at it. Shots are taken by good shooters, free throws by good foul
// shooters. These are the opportunity-weighted league means measured over 1998–2026; they
// drift by under 1.5 points across the whole range, so they are properties of the ratings
// anchor rather than per-season tuning. A player at his reference reproduces the era exactly.
const REF_ZONE = [52.3, 54.1, 54.6, 55.6] as const
const REF_FT = 51.3
const REF_HANDLING = 51.0
const REF_IQ = 52.6
const REF_DRAWFOUL = 50.5
/** drawFoul is the one reference that really drifts: the shot-event-weighted league mean
 *  climbs from 50.3 in 1998 to 52.4 in 2024 as the whistle follows the primary option, and
 *  at GAIN * 0.75 that alone lifts the modern league's free-throw rate by about 4%. The
 *  engine recentres on the mean it measures from the two rosters in front of it, shrunk
 *  toward the pooled constant because two rosters are a noisy estimate of a league. */
const FOUL_RECENTRE = 0.6
const REF_PASSING = 52.0
/** Minutes-weighted league mean of any five-man on-floor aggregate. */
const REF_ONFLOOR = 50.5
const REF_STAMINA = 55.0

/** The reference rating for each key, exported so a test can build the league-average
 *  player that must reproduce the EraContext exactly. */
export const REFERENCE: Readonly<Record<keyof Ratings, number>> = {
  rim: REF_ZONE[0],
  close: REF_ZONE[1],
  mid: REF_ZONE[2],
  three: REF_ZONE[3],
  ft: REF_FT,
  passing: REF_PASSING,
  handling: REF_HANDLING,
  drawFoul: REF_DRAWFOUL,
  oreb: REF_ONFLOOR,
  dreb: REF_ONFLOOR,
  perimD: REF_ONFLOOR,
  interiorD: REF_ONFLOOR,
  steal: REF_ONFLOOR,
  block: REF_ONFLOOR,
  speed: 50,
  strength: 50,
  stamina: REF_STAMINA,
  iq: REF_IQ,
  durability: 50,
}

/** Game-to-game pace noise: officiating, whistle, rest, style clash. Shared by both teams,
 *  which is where the real positive correlation between the two scores comes from
 *  (real 2016: r = 0.35 between home and away points). */
const PACE_SD = 0.05

/** Score effects. Real NBA games are under-dispersed against an independent-possession
 *  model: leads get answered, the trailing team's defence tightens, the leader coasts.
 *  A small restoring force on the running margin reproduces that. It compresses noise
 *  faster than it compresses a genuine talent edge, so the standings spread survives. */
const REVERT = 0.013
const REVERT_CAP = 25

/** Share of live rebounds that never reach a player's box score. A miss that caroms out of
 *  bounds, a tip that beats the buzzer, a ball wrestled loose and thrown away — the official
 *  scorer books these as a *team* rebound. Player rebound totals therefore sum to well under
 *  the number of missed shots: over 1998–2026 the real player lines add up to 86–88% of the
 *  misses. The share comes off both ends, so ORB% is untouched. */
export const TEAM_REB_SHARE = 0.135

/** Share of the *unstolen* turnovers charged to the team rather than to a player: shot-clock
 *  violations, offensive three seconds, five-second inbounds, backcourt. A steal is never one
 *  of these, so the era's steal share is untouched. Exported because it is the one place
 *  where the recorded box score is deliberately below the EraContext rate. */
export const TEAM_TOV_SHARE = 0.1

/** Spread of the rebound draw over the five men on the floor, in log-weight per unit of
 *  rating deviation. A 99-rated glass-eater takes boards off a wing at several times the
 *  wing's rate; a linear weight cannot reach that ratio and flattens every leader board. */
const REB_K = 1.22

/** Superlinearity of the assist draw. The best passer on the floor collects a larger share
 *  of his team's assists than his rate alone implies: he has the ball on the possessions
 *  that end in a catch-and-shoot, and the other four defer the read to him. */
const AST_EXP = 1.32
/** Assists per *team* possession for a league-average rotation player, the scale AST_EXP
 *  is measured against (mean assist tendency 0.245 x mean usage 0.20). */
const AST_REF = 0.049
/** Weight on the passing rating on top of the measured tendency, for generated players
 *  whose tendencies have drifted away from their ratings. */
const AST_PASS_K = 0.5

/** Extra stamina drain per step of the pace tactic, on the team that called it. Running is work;
 *  before this, "push it" was free and a thin roster could sprint all season for nothing. */
const PACE_DRAIN = 0.35

/** The price of crashing the offensive glass, charged where it is really paid: the *other* team's
 *  shot quality on the next trip. Sending three men to the boards means nobody is back, and the
 *  outlet pass finds a runner. Before this, `crashGlass: 1` bought second chances and cost nothing
 *  at all — a free lunch that made the knob a one-way choice. Zero at the default. */
const TRANSITION_K = 0.045

const FAT_REF = 0.95
const FAT_K = 0.5
const DRAIN = 1.25e-4
const RECOVER = 6e-4

const SUB_THRESHOLD = 420 // seconds of minute-share debt before a swap
const SUB_EVERY = 6 // possessions between substitution checks
const FOUL_OUT = 6

/** Rating deviation from a reference: 0 at the reference, 1.0 per 50 rating points. */
function dv(r: number, ref = 50): number {
  return (r - ref) * 0.02
}

/** Shift a probability by a log-odds amount. z = 0 returns p untouched. */
function oddsAdj(p: number, z: number): number {
  if (z === 0) return p
  const e = Math.exp(z)
  return (p * e) / (1 - p + p * e)
}

function pickWeighted(rng: Rng, w: Float64Array, n: number): number {
  let total = 0
  for (let i = 0; i < n; i++) total += w[i]!
  if (total <= 0) return 0
  let r = rng.next() * total
  for (let i = 0; i < n; i++) {
    r -= w[i]!
    if (r < 0) return i
  }
  return n - 1
}

interface Side {
  team: TeamGameInput
  players: PlayerGameInput[]
  n: number
  box: PlayerBox[]
  sec: Float64Array
  target: Float64Array
  energy: Float64Array
  pf: Int32Array
  onFloor: Int32Array
  isOn: Uint8Array
  need: Float64Array
  /** n * 4 shot-zone weights after tactics. */
  zoneW: Float64Array
  /** Per-player stamina drain multiplier: PlayerGameInput.workRate, times the team's tempo. */
  work: Float64Array
  pts: number
  quarters: number[]
  possessions: number
  // On-floor aggregates, refreshed on every substitution.
  defSteal: number
  defPerim: number
  defInterior: number
  defBlock: number
  defDreb: number
  defIq: number
  offOreb: number
  offPassing: number
  label: 'home' | 'away'
  /** Offset from team tactics.threes for the five currently on the floor. 0 when inheriting. */
  unitThreesExtra: number
  /** Offset from team tactics.pace for the five currently on the floor. 0 when inheriting. */
  unitPaceExtra: number
}

const SCRATCH = new Float64Array(8)

/** How likely a player is to end the possession. Usage is superlinear: a primary option
 *  shoulders a larger share on the floor than his season usage rate implies, because his
 *  team-mates defer to him and he is the one the last-second action runs through. */
const USAGE_EXP = 1.18
function usageWeight(s: Side, i: number): number {
  return (Math.max(0.02, s.players[i]!.tendencies.usage) / 0.2) ** USAGE_EXP
}

function makeSide(team: TeamGameInput, label: 'home' | 'away', anch: Anchors): Side {
  const players = team.players
  const n = players.length
  const s: Side = {
    team,
    players,
    n,
    box: players.map((p) => ({
      ...emptyStatLine(),
      playerId: p.playerId,
      name: p.name,
      starter: p.starter,
      plusMinus: 0,
    })),
    sec: new Float64Array(n),
    target: new Float64Array(n),
    energy: new Float64Array(n),
    pf: new Int32Array(n),
    onFloor: new Int32Array(5),
    isOn: new Uint8Array(n),
    need: new Float64Array(n),
    zoneW: new Float64Array(n * 4),
    work: new Float64Array(n),
    pts: 0,
    quarters: [],
    possessions: 0,
    defSteal: 0,
    defPerim: 0,
    defInterior: 0,
    defBlock: 0,
    defDreb: 0,
    defIq: 0,
    offOreb: 0,
    offPassing: 0,
    label,
    unitThreesExtra: 0,
    unitPaceExtra: 0,
  }
  const threes = team.tactics.threes
  // Tendencies are shares of *recorded FGA*, but a shot event only becomes an FGA when it
  // is not a shooting foul on a miss — and rim shots draw far more fouls than threes. Divide
  // each share by its FGA-per-event factor so the recorded box score recovers the tendency.
  const perEvent = new Float64Array(4)
  for (let z = 0; z < 4; z++) {
    const f = anch.foulP[z]!
    perEvent[z] = 1 / (1 - f + f * anch.andOne[z]!)
  }
  // A team that pushes the tempo runs further for the same forty-eight minutes, and the bill
  // arrives in the fourth quarter. At the default pace this is exactly 1 and nothing changes.
  const tempoDrain = 1 + PACE_DRAIN * team.tactics.pace
  for (let i = 0; i < n; i++) {
    const p = players[i]!
    s.target[i] = p.minutesTarget * 60
    s.energy[i] = p.condition
    s.work[i] = Math.max(0.4, Math.min(2, p.workRate ?? 1)) * tempoDrain
    const t = p.tendencies
    const w0 = Math.max(0, t.shotRim) * perEvent[0]!
    const w1 = Math.max(0, t.shotClose) * perEvent[1]!
    const w2 = Math.max(0, t.shotMid) * perEvent[2]!
    const w3 = Math.max(0, t.shotThree) * perEvent[3]! * (1 + 0.18 * threes)
    const sum = w0 + w1 + w2 + w3 || 1
    s.zoneW[i * 4] = w0 / sum
    s.zoneW[i * 4 + 1] = w1 / sum
    s.zoneW[i * 4 + 2] = w2 / sum
    s.zoneW[i * 4 + 3] = w3 / sum
  }
  // Opening five: the flagged starters, then the biggest minute targets.
  let k = 0
  for (let i = 0; i < n && k < 5; i++) if (players[i]!.starter) s.onFloor[k++] = i
  for (let i = 0; i < n && k < 5; i++) {
    let dup = false
    for (let j = 0; j < k; j++) if (s.onFloor[j] === i) dup = true
    if (!dup) s.onFloor[k++] = i
  }
  for (let j = 0; j < 5; j++) s.isOn[s.onFloor[j]!] = 1
  refresh(s)
  return s
}

function refresh(s: Side): void {
  let steal = 0
  let perim = 0
  let interior = 0
  let block = 0
  let dreb = 0
  let iq = 0
  let oreb = 0
  let passing = 0
  for (let j = 0; j < 5; j++) {
    const r = s.players[s.onFloor[j]!]!.ratings
    steal += r.steal
    perim += r.perimD
    interior += r.interiorD
    block += r.block
    dreb += r.dreb
    iq += r.iq
    oreb += r.oreb
    passing += r.passing
  }
  s.defSteal = steal / 5
  s.defPerim = perim / 5
  s.defInterior = interior / 5
  s.defBlock = block / 5
  s.defDreb = dreb / 5
  s.defIq = iq / 5
  s.offOreb = oreb / 5
  s.offPassing = passing / 5
}

const ZONE_TEXT = ['layup', 'floater', 'jumper', '3-pointer'] as const

const SPREAD = new Float64Array(7)
const CENTRE = new Float64Array(7)
const SPREAD_M1 = new Float64Array(7)
const SPREAD_M2 = new Float64Array(7)
const SPREAD_W = new Float64Array(7)

/** Opportunity-weighted sd of the ratings that drive each anchored rate, as a dv.
 *  Slots 0-3 are the shot zones, 4 is ft, 5 is the turnover term, 6 is drawFoul. */
function ratingSpread(input: GameInput): Float64Array {
  SPREAD_M1.fill(0)
  SPREAD_M2.fill(0)
  SPREAD_W.fill(0)
  for (const team of [input.home, input.away]) {
    for (const p of team.players) {
      const use = p.minutesTarget * p.tendencies.usage
      if (use <= 0) continue
      const r = p.ratings
      const t = p.tendencies
      const zr = [r.rim, r.close, r.mid, r.three]
      const zs = [t.shotRim, t.shotClose, t.shotMid, t.shotThree]
      for (let z = 0; z < 4; z++) {
        const w = use * Math.max(0, zs[z]!)
        const d = dv(zr[z]!, REF_ZONE[z]!)
        SPREAD_W[z] = SPREAD_W[z]! + w
        SPREAD_M1[z] = SPREAD_M1[z]! + w * d
        SPREAD_M2[z] = SPREAD_M2[z]! + w * d * d
      }
      // Free throws are weighted by how often the player draws one, not by usage: the
      // spread of ft ratings at the line is wider than the spread across the roster.
      const ftW = use * Math.max(0.1, 0.4 + r.drawFoul * 0.012)
      const pairs: [number, number, number][] = [
        [4, dv(r.ft, REF_FT), ftW],
        [5, dv(r.handling, REF_HANDLING), use],
        [6, dv(r.drawFoul, REF_DRAWFOUL), use],
      ]
      for (const [k, d, w] of pairs) {
        SPREAD_W[k] = SPREAD_W[k]! + w
        SPREAD_M1[k] = SPREAD_M1[k]! + w * d
        SPREAD_M2[k] = SPREAD_M2[k]! + w * d * d
      }
    }
  }
  for (let k = 0; k < 7; k++) {
    const w = SPREAD_W[k]!
    if (w <= 0) {
      SPREAD[k] = RATING_DV_SD
      CENTRE[k] = 0
      continue
    }
    const m = SPREAD_M1[k]! / w
    CENTRE[k] = m
    SPREAD[k] = Math.sqrt(Math.max(0, SPREAD_M2[k]! / w - m * m))
  }
  return SPREAD
}

export function simulateGameWith(
  input: GameInput,
  seed: number,
  opts: SimOptions = {},
): GameResult {
  const wantPbp = opts.pbp !== false
  const rng = makeRng(seed)
  const era = input.era
  const anch = computeAnchors(era, input.home.tactics, input.away.tactics)
  const home = makeSide(input.home, 'home', anch)
  const away = makeSide(input.away, 'away', anch)
  const pbp: PbpEvent[] = []

  const homeZ = input.neutralSite ? 0 : anch.homeZ
  const paceMult = Math.max(0.75, Math.min(1.25, 1 + rng.normal(0, PACE_SD)))
  const baseSeconds = anch.baseSeconds / paceMult

  // Convexity corrections, one per anchored probability, from the spread of the log-odds
  // term that perturbs it. Without these the league drifts off the era as GAIN rises.
  // The spread is measured from the two rosters actually playing, weighted by how often
  // each player will be the one shooting, so it tracks the era instead of assuming it.
  const spread = ratingSpread(input)
  const jShot = new Float64Array(4)
  for (let z = 0; z < 4; z++) {
    jShot[z] = jensen(anch.makeP[z]!, GAIN * SHOT_K[z]! * spread[z]!)
  }
  const jFt = jensen(anch.ftP, GAIN * 1.15 * spread[4]!)
  const jTov = jensen(anch.tovP, GAIN * 1.07 * spread[5]!)
  // The shooting-foul term is the one place where the reference rating drifts with the era:
  // the shot-event-weighted mean drawFoul rises from about 50.3 in 1998 to 52.4 in 2024, and
  // at GAIN * 0.75 that alone lifts the modern league's free-throw rate by 4%. Recentre on the
  // mean actually measured from the two rosters rather than on the constant, so the league
  // reproduces era.ftr in every era. Differences between the two teams survive untouched —
  // the mean is taken over both of them.
  const jFoul = new Float64Array(4)
  for (let z = 0; z < 4; z++) {
    jFoul[z] =
      jensen(anch.foulP[z]!, GAIN * 0.75 * spread[6]!) - GAIN * 0.75 * FOUL_RECENTRE * CENTRE[6]!
  }
  const playoffs = input.seasonType === 'playoffs'

  let period = 0
  let clock = 0
  let elapsed = 0
  let plannedSec = 2880
  let offIsHome = rng.chance(0.5)
  let sinceSub = 0
  let garbage = false

  function log(
    team: 'home' | 'away',
    type: PbpEvent['type'],
    text: string,
    playerId?: string,
    made?: boolean,
    points?: number,
  ): void {
    if (!wantPbp) return
    const e: PbpEvent = { period, clock: Math.max(0, Math.round(clock)), team, type, text }
    if (playerId !== undefined) e.playerId = playerId
    if (made !== undefined) e.made = made
    if (points !== undefined) e.points = points
    pbp.push(e)
  }

  function score(s: Side, other: Side, pts: number, i: number): void {
    s.pts += pts
    s.box[i]!.pts += pts
    const q = period - 1
    while (s.quarters.length <= q) s.quarters.push(0)
    while (other.quarters.length <= q) other.quarters.push(0)
    s.quarters[q] = s.quarters[q]! + pts
    for (let j = 0; j < 5; j++) s.box[s.onFloor[j]!]!.plusMinus += pts
    for (let j = 0; j < 5; j++) other.box[other.onFloor[j]!]!.plusMinus -= pts
  }

  function indexOfPlayer(s: Side, id: string): number {
    for (let i = 0; i < s.n; i++) if (s.players[i]!.playerId === id) return i
    return -1
  }

  function applyNamedUnits(s: Side): void {
    const units = s.team.units
    if (!units) return
    let starterCondition = 1
    let nCond = 0
    let t = 0
    for (const id of units.starters) {
      const i = indexOfPlayer(s, id)
      if (i < 0) continue
      t += s.players[i]!.condition
      nCond++
    }
    if (nCond) starterCondition = t / nCond
    const margin = s.label === 'home' ? home.pts - away.pts : away.pts - home.pts
    const unit = unitForSituation({ period, clock, margin, starterCondition })
    const wanted = units[unit] ?? units.starters
    const style = unit === 'blowout' ? undefined : s.team.unitStyle?.[unit]
    const team = s.team.tactics
    s.unitPaceExtra = (style?.pace ?? team.pace) - team.pace
    s.unitThreesExtra = (style?.threes ?? team.threes) - team.threes
    const floor: number[] = []
    const used = new Set<number>()
    for (const id of wanted) {
      const i = indexOfPlayer(s, id)
      if (i < 0 || s.pf[i]! >= FOUL_OUT || used.has(i)) continue
      floor.push(i)
      used.add(i)
    }
    for (let i = 0; i < s.n && floor.length < 5; i++) {
      if (used.has(i) || s.pf[i]! >= FOUL_OUT) continue
      floor.push(i)
      used.add(i)
    }
    if (floor.length < 5) {
      for (let i = 0; i < s.n && floor.length < 5; i++) {
        if (used.has(i)) continue
        floor.push(i)
        used.add(i)
      }
    }
    const same = floor.length === 5 && floor.every((i, j) => s.onFloor[j] === i)
    if (same) return
    for (let j = 0; j < 5; j++) s.isOn[s.onFloor[j]!] = 0
    for (let j = 0; j < 5; j++) {
      const i = floor[j] ?? s.onFloor[j]!
      const out = s.onFloor[j]!
      if (i !== out) {
        log(
          s.label,
          'sub',
          `${s.players[i]!.name} enters for ${s.players[out]!.name}`,
          s.players[i]!.playerId,
        )
      }
      s.onFloor[j] = i
      s.isOn[i] = 1
    }
    refresh(s)
  }

  /** Greedy minute-share rotation: swap the most over-played starter for the most
   *  under-played reserve whenever the debt between them exceeds SUB_THRESHOLD.
   *  Named units, when present, replace this: the coach puts a group on the floor. */
  function substitute(s: Side, other: Side): void {
    if (s.team.units) {
      applyNamedUnits(s)
      return
    }
    const f = elapsed / plannedSec
    const scale = plannedSec / 2880
    const need = s.need
    let eligible = 0
    for (let i = 0; i < s.n; i++) {
      const fouls = s.pf[i]!
      if (fouls >= FOUL_OUT) {
        need[i] = -1e9
        continue
      }
      eligible++
      // Minute debt, measured in units of the player's own stint length. A 40-minute
      // starter and a 10-minute reserve cycle on and off at very different rates, so a
      // dead band in raw seconds would cost the starter minutes he can never win back.
      const rate = Math.min(1, (s.target[i]! * scale) / plannedSec)
      const cycle = Math.max(0.1, Math.min(rate, 1 - rate))
      let v = s.target[i]! * scale * f - s.sec[i]!
      // Foul trouble: sit a player who is a foul ahead of the period. A coach rides a
      // starter through it longer than a reserve, so the penalty shrinks with his role.
      if (period <= 3 && fouls >= period + 2)
        v -= 300 * (1 - 0.6 * Math.min(1, s.target[i]! / 2400))
      if (garbage) v += s.target[i]! > 1500 ? -600 : 600
      if (playoffs && s.players[i]!.starter) v += 30
      need[i] = v / cycle
    }
    if (eligible < 5) {
      // Short-handed: let the least-fouled disqualified player stay on.
      for (let i = 0; i < s.n; i++) if (s.pf[i]! >= FOUL_OUT) need[i] = -1e6 - s.pf[i]!
    }
    for (let pass = 0; pass < 2; pass++) {
      let worst = -1
      let worstV = Number.POSITIVE_INFINITY
      for (let j = 0; j < 5; j++) {
        const i = s.onFloor[j]!
        if (need[i]! < worstV) {
          worstV = need[i]!
          worst = j
        }
      }
      let best = -1
      let bestV = Number.NEGATIVE_INFINITY
      for (let i = 0; i < s.n; i++) {
        if (s.isOn[i] === 1) continue
        if (need[i]! > bestV) {
          bestV = need[i]!
          best = i
        }
      }
      if (worst < 0 || best < 0) break
      const out = s.onFloor[worst]!
      if (bestV - worstV <= SUB_THRESHOLD) break
      s.isOn[out] = 0
      s.isOn[best] = 1
      s.onFloor[worst] = best
      log(s.label, 'sub', `${s.players[best]!.name} enters for ${s.players[out]!.name}`)
    }
    refresh(s)
    void other
  }

  function fatigueZ(s: Side, i: number): number {
    return FAT_K * (s.energy[i]! - FAT_REF)
  }

  /** Pick the defender charged with a foul: bigs inside, everyone outside, sloppier
   *  decision-makers more often. */
  function foulDefender(d: Side, zone: number, rng2: Rng): number {
    for (let j = 0; j < 5; j++) {
      const i = d.onFloor[j]!
      const r = d.players[i]!.ratings
      const size = zone <= CLOSE ? 0.65 + r.block * 0.007 : 0.95
      // A player in foul trouble gives up the contest rather than pick up another.
      const care = d.pf[i]! >= 4 ? 0.6 : d.pf[i]! === 3 ? 0.82 : 1
      SCRATCH[j] = size * (1 + (50 - r.iq) * 0.003) * care
    }
    return d.onFloor[pickWeighted(rng2, SCRATCH, 5)]!
  }

  function creditFoul(d: Side, o: Side, i: number, text: string): void {
    d.pf[i] = d.pf[i]! + 1
    d.box[i]!.pf++
    log(d.label, 'foul', text, d.players[i]!.playerId)
    if (d.pf[i]! >= FOUL_OUT) {
      log(d.label, 'foul', `${d.players[i]!.name} fouls out`, d.players[i]!.playerId)
      substitute(d, o)
    }
  }

  /** Returns true if the offence keeps the ball. */
  function rebound(o: Side, d: Side, orbZ: number): boolean {
    const p = oddsAdj(
      anch.orbP,
      TEAM_GAIN * (0.7 * dv(o.offOreb, REF_ONFLOOR) - 0.7 * dv(d.defDreb, REF_ONFLOOR)) +
        0.18 * o.team.tactics.crashGlass +
        orbZ,
    )
    // One draw decides both which side got it and whether a player is credited: the top
    // TEAM_REB_SHARE slice of each side's interval is a team rebound. Folding it into the
    // same uniform keeps the random stream identical to a run without team rebounds.
    const u = rng.next()
    if (u < p) {
      for (let j = 0; j < 5; j++)
        SCRATCH[j] = Math.exp(REB_K * dv(o.players[o.onFloor[j]!]!.ratings.oreb, REF_ONFLOOR))
      const i = o.onFloor[pickWeighted(rng, SCRATCH, 5)]!
      if (u >= p * (1 - TEAM_REB_SHARE)) {
        log(o.label, 'reb', 'offensive team rebound')
        return true
      }
      o.box[i]!.oreb++
      log(o.label, 'reb', `${o.players[i]!.name} offensive rebound`, o.players[i]!.playerId)
      return true
    }
    for (let j = 0; j < 5; j++)
      SCRATCH[j] = Math.exp(REB_K * dv(d.players[d.onFloor[j]!]!.ratings.dreb, REF_ONFLOOR))
    const i = d.onFloor[pickWeighted(rng, SCRATCH, 5)]!
    if (u < p + (1 - p) * TEAM_REB_SHARE) {
      log(d.label, 'reb', 'defensive team rebound')
      return false
    }
    d.box[i]!.dreb++
    log(d.label, 'reb', `${d.players[i]!.name} defensive rebound`, d.players[i]!.playerId)
    return false
  }

  function assist(o: Side, shooter: number, pts: number, zone: number): void {
    const p = oddsAdj(anch.astP, TEAM_GAIN * 0.35 * dv(o.offPassing, REF_PASSING))
    if (rng.next() >= p) return
    let any = 0
    for (let j = 0; j < 5; j++) {
      const i = o.onFloor[j]!
      if (i === shooter) {
        SCRATCH[j] = 0
        continue
      }
      const pl = o.players[i]!
      // tendencies.assist is assists per possession the player *uses*, so a high-usage
      // creator's number is deflated by his own shot volume: Dončić and a backup point
      // guard can share a tendency while the box scores differ threefold. Multiplying by
      // usage recovers assists per *team* possession, which is what an assist draw needs.
      const rate = Math.max(0.002, pl.tendencies.assist * pl.tendencies.usage)
      const w =
        (rate / AST_REF) ** AST_EXP * Math.exp(AST_PASS_K * dv(pl.ratings.passing, REF_PASSING))
      SCRATCH[j] = w
      any += w
    }
    if (any <= 0) return
    const i = o.onFloor[pickWeighted(rng, SCRATCH, 5)]!
    o.box[i]!.ast++
    log(o.label, 'other', `${o.players[i]!.name} assist`, o.players[i]!.playerId)
    void pts
    void zone
  }

  /** Free throws. Returns true if the offence keeps the ball (missed last FT rebounded). */
  function freeThrows(o: Side, d: Side, i: number, count: number): boolean {
    const pl = o.players[i]!
    const p = oddsAdj(
      anch.ftP,
      GAIN * 1.15 * dv(pl.ratings.ft, REF_FT) + fatigueZ(o, i) * 0.5 + jFt,
    )
    let keep = false
    for (let k = 0; k < count; k++) {
      const made = rng.next() < p
      o.box[i]!.fta++
      if (made) {
        o.box[i]!.ftm++
        score(o, d, 1, i)
      }
      log(
        o.label,
        'ft',
        `${pl.name} ${made ? 'makes' : 'misses'} free throw ${k + 1} of ${count}`,
        pl.playerId,
        made,
        made ? 1 : 0,
      )
      if (k === count - 1 && !made) keep = rebound(o, d, FT_ORB_Z)
    }
    return keep
  }

  /** One possession. Returns the game-clock seconds it consumed. */
  function possession(o: Side, d: Side, limit: number): number {
    o.possessions++
    let dur = baseSeconds * (0.35 + 1.3 * rng.next())
    if (o.unitPaceExtra) dur *= 1 - 0.03 * o.unitPaceExtra
    const zHome = o.label === 'home' ? homeZ : -homeZ
    // Score effect: a lead is a headwind, a deficit a tailwind.
    const zRevert = -REVERT * Math.max(-REVERT_CAP, Math.min(REVERT_CAP, o.pts - d.pts))

    // Pick the user by usage among the five on the floor.
    for (let j = 0; j < 5; j++) SCRATCH[j] = usageWeight(o, o.onFloor[j]!)
    let user = o.onFloor[pickWeighted(rng, SCRATCH, 5)]!

    // Non-shooting foul on the defence: a reach-in, a loose ball, an off-ball grab. Does
    // not end the possession, and can happen on a possession that ends in a turnover too.
    if (rng.next() < anch.otherFoulP * (1 + 0.12 * d.team.tactics.pressure)) {
      const fi = foulDefender(d, MID, rng)
      creditFoul(d, o, fi, `${d.players[fi]!.name} personal foul`)
      dur += 2
    }

    // Turnover.
    const ur = o.players[user]!.ratings
    const tovZ =
      GAIN * (-1.0 * dv(ur.handling, REF_HANDLING) - 0.4 * dv(ur.iq, REF_IQ)) +
      TEAM_GAIN * 0.55 * dv(d.defSteal, REF_ONFLOOR) -
      zHome * 0.5 +
      0.1 * d.team.tactics.pressure +
      jTov
    if (rng.next() < oddsAdj(anch.tovP, tovZ)) {
      // One draw again: a steal, then a slice of what is left for the turnovers the scorer
      // charges to the team rather than to the ball handler.
      const u = rng.next()
      if (u < anch.stealShare) {
        o.box[user]!.tov++
        for (let j = 0; j < 5; j++)
          SCRATCH[j] = 0.2 + d.players[d.onFloor[j]!]!.ratings.steal * 0.02
        const s = d.onFloor[pickWeighted(rng, SCRATCH, 5)]!
        d.box[s]!.stl++
        log(
          o.label,
          'tov',
          `${o.players[user]!.name} turnover, stolen by ${d.players[s]!.name}`,
          o.players[user]!.playerId,
        )
      } else if (u < anch.stealShare + (1 - anch.stealShare) * TEAM_TOV_SHARE) {
        // Nobody stole it and nobody is charged: a shot-clock violation, offensive three
        // seconds, a five-second inbounds, a backcourt call. The possession still ends.
        log(o.label, 'tov', 'team turnover')
      } else {
        o.box[user]!.tov++
        log(o.label, 'tov', `${o.players[user]!.name} turnover`, o.players[user]!.playerId)
      }
      return Math.min(limit, dur * 0.85)
    }

    let events = 0
    for (;;) {
      events++
      if (events > 12) break
      const sh = o.players[user]!
      const r = sh.ratings

      // Shot zone from tendencies, with a legal-zone defence pushing shots outward.
      let z: number
      const base = user * 4
      if (d.team.tactics.zone && era.zoneLegal) {
        SCRATCH[0] = o.zoneW[base]! * 0.9
        SCRATCH[1] = o.zoneW[base + 1]! * 0.97
        SCRATCH[2] = o.zoneW[base + 2]! * 1.05
        SCRATCH[3] = o.zoneW[base + 3]! * 1.06
      } else {
        SCRATCH[0] = o.zoneW[base]!
        SCRATCH[1] = o.zoneW[base + 1]!
        SCRATCH[2] = o.zoneW[base + 2]!
        SCRATCH[3] = o.zoneW[base + 3]!
      }
      if (o.unitThreesExtra) {
        const teamT = o.team.tactics.threes
        SCRATCH[3] *= (1 + 0.18 * (teamT + o.unitThreesExtra)) / (1 + 0.18 * teamT)
      }
      z = pickWeighted(rng, SCRATCH, 4)
      const three = z === THREE
      const value = three ? 3 : 2
      const zoneRating = z === RIM ? r.rim : z === CLOSE ? r.close : z === MID ? r.mid : r.three
      const defRating = z <= CLOSE ? d.defInterior : d.defPerim
      const shotZ =
        GAIN * (SHOT_K[z]! * dv(zoneRating, REF_ZONE[z]!) + 0.15 * dv(r.iq, REF_IQ)) -
        TEAM_GAIN * DEF_K[z]! * dv(defRating, REF_ONFLOOR) +
        fatigueZ(o, user) +
        zHome +
        zRevert +
        // The defence's own glass policy, paid for here: a team that crashes is a team that is
        // not back, and this possession is the transition it conceded.
        TRANSITION_K * d.team.tactics.crashGlass +
        jShot[z]!

      // Shooting foul.
      const foulZ =
        GAIN * 0.75 * dv(r.drawFoul, REF_DRAWFOUL) -
        TEAM_GAIN * 0.15 * dv(d.defIq, REF_IQ) +
        jFoul[z]! +
        0.12 * d.team.tactics.pressure
      if (rng.next() < oddsAdj(anch.foulP[z]!, foulZ)) {
        const fi = foulDefender(d, z, rng)
        const completed = rng.next() < oddsAdj(anch.andOne[z]!, shotZ * 0.5)
        creditFoul(d, o, fi, `${d.players[fi]!.name} shooting foul on ${sh.name}`)
        if (completed) {
          o.box[user]!.fga++
          o.box[user]!.fgm++
          if (three) {
            o.box[user]!.fg3a++
            o.box[user]!.fg3m++
          }
          score(o, d, value, user)
          log(o.label, 'shot', `${sh.name} makes ${ZONE_TEXT[z]} and one`, sh.playerId, true, value)
          assist(o, user, value, z)
          if (freeThrows(o, d, user, 1)) {
            user = nextUser(o, user)
            dur += ORB_SECONDS
            continue
          }
          return Math.min(limit, dur)
        }
        if (freeThrows(o, d, user, three ? 3 : 2)) {
          user = nextUser(o, user)
          dur += ORB_SECONDS
          continue
        }
        return Math.min(limit, dur)
      }

      // Live shot.
      o.box[user]!.fga++
      if (three) o.box[user]!.fg3a++
      if (rng.next() < oddsAdj(anch.makeP[z]!, shotZ)) {
        o.box[user]!.fgm++
        if (three) o.box[user]!.fg3m++
        score(o, d, value, user)
        log(o.label, 'shot', `${sh.name} makes ${ZONE_TEXT[z]}`, sh.playerId, true, value)
        assist(o, user, value, z)
        return Math.min(limit, dur)
      }
      // Miss, possibly blocked.
      let blocked = false
      if (rng.next() < oddsAdj(anch.blockP[z]!, TEAM_GAIN * 1.0 * dv(d.defBlock, REF_ONFLOOR))) {
        for (let j = 0; j < 5; j++)
          SCRATCH[j] = 0.15 + d.players[d.onFloor[j]!]!.ratings.block * 0.02
        const bi = d.onFloor[pickWeighted(rng, SCRATCH, 5)]!
        d.box[bi]!.blk++
        blocked = true
        log(
          o.label,
          'shot',
          `${sh.name} ${ZONE_TEXT[z]} blocked by ${d.players[bi]!.name}`,
          sh.playerId,
          false,
          0,
        )
      } else {
        log(o.label, 'shot', `${sh.name} misses ${ZONE_TEXT[z]}`, sh.playerId, false, 0)
      }
      if (rebound(o, d, blocked ? -0.15 : 0)) {
        user = nextUser(o, user)
        dur += ORB_SECONDS
        continue
      }
      return Math.min(limit, dur)
    }
    return Math.min(limit, dur)
  }

  /** After an offensive rebound the rebounder often finishes; otherwise usage decides. */
  function nextUser(o: Side, prev: number): number {
    if (rng.next() < 0.45) return prev
    for (let j = 0; j < 5; j++) SCRATCH[j] = usageWeight(o, o.onFloor[j]!)
    return o.onFloor[pickWeighted(rng, SCRATCH, 5)]!
  }

  function advance(s: Side, dur: number): void {
    for (let i = 0; i < s.n; i++) {
      if (s.isOn[i] === 1) {
        s.sec[i] = s.sec[i]! + dur
        const st = s.players[i]!.ratings.stamina
        s.energy[i] = Math.max(
          0.35,
          s.energy[i]! - DRAIN * s.work[i]! * (1 - 0.45 * dv(st, REF_STAMINA)) * dur,
        )
      } else {
        s.energy[i] = Math.min(s.players[i]!.condition, s.energy[i]! + RECOVER * dur)
      }
    }
  }

  // ---- the clock ----
  for (;;) {
    period++
    const len = period <= 4 ? 720 : 300
    if (period > 4) plannedSec += 300
    clock = len
    while (home.quarters.length < period) home.quarters.push(0)
    while (away.quarters.length < period) away.quarters.push(0)
    log('home', 'period', period <= 4 ? `Start of Q${period}` : `Start of OT${period - 4}`)
    if (home.team.units) applyNamedUnits(home)
    if (away.team.units) applyNamedUnits(away)
    while (clock > 0.5) {
      if (sinceSub >= SUB_EVERY) {
        substitute(home, away)
        substitute(away, home)
        sinceSub = 0
      }
      sinceSub++
      const margin = Math.abs(home.pts - away.pts)
      garbage =
        period >= 4 &&
        ((clock < 240 && margin >= 22) ||
          (clock < 120 && margin >= 16) ||
          (clock < 60 && margin >= 10))
      const o = offIsHome ? home : away
      const d = offIsHome ? away : home
      const dur = Math.max(1, possession(o, d, clock))
      advance(home, dur)
      advance(away, dur)
      clock -= dur
      elapsed += dur
      offIsHome = !offIsHome
    }
    if (period >= 4 && home.pts !== away.pts) break
    if (period >= 14) break // guard; cannot happen with live scoring
  }

  return {
    home: toBox(home, period),
    away: toBox(away, period),
    winner: home.pts > away.pts ? 'home' : 'away',
    overtimes: Math.max(0, period - 4),
    pbp,
  }
}

function toBox(s: Side, periods: number): TeamBox {
  const totals = emptyStatLine()
  const keys = Object.keys(totals) as (keyof StatLine)[]
  for (let i = 0; i < s.n; i++) {
    const b = s.box[i]!
    b.min = Math.round((s.sec[i]! / 60) * 10) / 10
    for (const k of keys) totals[k] += b[k]
  }
  while (s.quarters.length < periods) s.quarters.push(0)
  return {
    teamId: s.team.teamId,
    pts: s.pts,
    quarters: s.quarters,
    possessions: s.possessions,
    players: s.box,
    totals,
  }
}

export function simulateGame(input: GameInput, seed: number): GameResult {
  return simulateGameWith(input, seed, { pbp: true })
}
