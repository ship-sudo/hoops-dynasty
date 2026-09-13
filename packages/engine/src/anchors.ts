// Per-game constants derived from EraContext, solved once before the possession loop.
//
// The rule: with flat-50 ratings and neutral tactics, every rate the engine produces must
// collapse to the era baseline. So every probability below is an *anchor* that the rating
// adjustments perturb around, never a number invented from nowhere.

import type { EraContext, Tactics } from '@hoops/core'

export const RIM = 0
export const CLOSE = 1
export const MID = 2
export const THREE = 3

/** Relative shooting-foul draw rate by zone. Shape only; the level is solved for era.ftr. */
const FOUL_W = [1.65, 1.15, 0.65, 0.5] as const
/** P(a fouled shot still goes in) by zone — the and-one rate. */
const AND1 = [0.33, 0.26, 0.2, 0.15] as const
/** Relative block rate by zone. Shape only; the level is solved for era.blkPer100. */
const BLOCK_W = [2.3, 1.6, 0.45, 0.22] as const

/** Seconds added to a possession for each extra shot event won on the offensive glass. */
export const ORB_SECONDS = 3

/** Log-odds penalty on the offensive rebound after a missed last free throw. The defence
 *  has both blocks on the line and the shooter is behind the play, so these are recovered
 *  by the offence roughly half as often as a missed field goal. */
export const FT_ORB_Z = -0.75

export interface Anchors {
  /** Possessions per team over 48 minutes, after both teams' pace tactic. */
  possTarget: number
  /** Mean game-clock seconds drawn for one possession before rebound extensions. */
  baseSeconds: number
  tovP: number
  stealShare: number
  orbP: number
  astP: number
  ftP: number
  /** Per zone. */
  foulP: Float64Array
  /** Per zone: make probability on an *unfouled* attempt, back-solved so recorded FG% = era. */
  makeP: Float64Array
  andOne: Float64Array
  /** Per zone: P(block) on an unfouled attempt that missed. */
  blockP: Float64Array
  /** Non-shooting fouls per possession, the remainder of era.pfPer100. */
  otherFoulP: number
  /** Log-odds shift applied to the home team's shots (and negated for the away team). */
  homeZ: number
  /** Expected shot events per possession. Diagnostic; used for the block and time solves. */
  shotEvents: number
  /** Log-odds shift on every make probability that closes the points-per-possession identity. */
  ortgShift: number
}

/** Shift a probability by a log-odds amount. Shared with the possession loop. */
export function oddsShift(p: number, z: number): number {
  if (z === 0) return p
  const e = Math.exp(z)
  return (p * e) / (1 - p + p * e)
}

/** Tuned so two identical teams reproduce era.homeWinPct. See home-edge.test.ts. */
const HOME_K = 0.46

/** FTA/FGA implied by a shooting-foul level, weighting zones by *shot events* rather than
 *  by recorded FGA: rim events lose more attempts to fouls, so the two differ. */
function ratioAt(era: EraContext, phi: number): number {
  const s = [era.zoneShare.rim, era.zoneShare.close, era.zoneShare.mid, era.zoneShare.three]
  let fga = 0
  let fta = 0
  for (let z = 0; z < 4; z++) {
    const f = Math.min(0.6, phi * FOUL_W[z]!)
    const a = AND1[z]!
    // Event share that reproduces the recorded FGA share s[z].
    const e = s[z]! / (1 - f + f * a)
    fga += e * (1 - f + f * a)
    fta += e * (f * a + f * (1 - a) * (z === THREE ? 3 : 2))
  }
  return fta / fga
}

export function computeAnchors(era: EraContext, home: Tactics, away: Tactics): Anchors {
  const s = [era.zoneShare.rim, era.zoneShare.close, era.zoneShare.mid, era.zoneShare.three]
  const p = [era.zonePct.rim, era.zonePct.close, era.zonePct.mid, era.zonePct.three]

  // 1. Solve the shooting-foul level so FTA/FGA lands on era.ftr.
  let lo = 0
  let hi = 0.45
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (ratioAt(era, mid) < era.ftr) lo = mid
    else hi = mid
  }
  const phi = (lo + hi) / 2

  const foulP = new Float64Array(4)
  const makeP = new Float64Array(4)
  const andOne = new Float64Array(4)
  for (let z = 0; z < 4; z++) {
    const f = Math.min(0.6, phi * FOUL_W[z]!)
    const a = AND1[z]!
    foulP[z] = f
    andOne[z] = a
    // Recorded FGA on a fouled event only exist when the shot was completed, so the
    // unfouled make probability must sit below the era zone percentage.
    const q = (p[z]! * (1 - f + f * a) - f * a) / (1 - f)
    makeP[z] = Math.min(0.98, Math.max(0.02, q))
  }

  const tovP = era.tovPct / 100

  // 2. Zone shares of *shot events*, which is what the possession loop samples from.
  const ev = new Float64Array(4)
  let evSum = 0
  for (let z = 0; z < 4; z++) {
    ev[z] = s[z]! / (1 - foulP[z]! + foulP[z]! * andOne[z]!)
    evSum += ev[z]!
  }
  for (let z = 0; z < 4; z++) ev[z] = ev[z]! / evSum

  // 3. Expected shot events per possession. An offensive rebound extends the possession,
  //    which is a geometric series in the continuation probability. Every trip to the line
  //    ends on one last free throw, so every trip can be rebounded too.
  let reboundable = 0
  let ftTrips = 0
  for (let z = 0; z < 4; z++) {
    reboundable += ev[z]! * (1 - foulP[z]!) * (1 - makeP[z]!)
    ftTrips += ev[z]! * foulP[z]!
  }
  // era.orbPct is measured over every rebound, missed free throws included, and those are
  // recovered by the offence far less often. Solve the field-goal rate so the blend lands
  // on the era number.
  const ftMisses = ftTrips * (1 - era.ftPct)
  let olo = 0
  let ohi = 0.95
  for (let i = 0; i < 40; i++) {
    const mid = (olo + ohi) / 2
    const blended =
      (mid * reboundable + oddsShift(mid, FT_ORB_Z) * ftMisses) / (reboundable + ftMisses)
    if (blended < era.orbPct) olo = mid
    else ohi = mid
  }
  const orbP = (olo + ohi) / 2
  const cont = Math.min(0.6, reboundable * orbP + ftMisses * oddsShift(orbP, FT_ORB_Z))
  const shotEvents = (1 - tovP) / (1 - cont)

  // 4. Block level so blocks per 100 possessions lands on era.blkPer100.
  let bw = 0
  for (let z = 0; z < 4; z++) bw += ev[z]! * (1 - foulP[z]!) * (1 - makeP[z]!) * BLOCK_W[z]!
  const bBase = bw > 0 ? era.blkPer100 / 100 / (shotEvents * bw) : 0
  const blockP = new Float64Array(4)
  for (let z = 0; z < 4; z++) blockP[z] = Math.min(0.95, Math.max(0, bBase * BLOCK_W[z]!))

  // 5. Remaining personal fouls beyond the shooting fouls.
  let shootingFouls = 0
  for (let z = 0; z < 4; z++) shootingFouls += ev[z]! * foulP[z]!
  shootingFouls *= shotEvents
  const otherFoulP = Math.max(0, era.pfPer100 / 100 - shootingFouls)

  // 6. Close the offensive-rating identity. The structure above fixes the shot mix, the
  //    zone percentages, the foul rate and the glass; points per possession then follows,
  //    and lands a little off era.ortg because the rebound extension is not exactly the
  //    league's. Solve one log-odds shift on every make probability so it lands on it.
  const ptsPerEvent = (shift: number): number => {
    let pts = 0
    for (let z = 0; z < 4; z++) {
      const f = foulP[z]!
      const a = Math.min(0.98, oddsShift(andOne[z]!, shift * 0.5))
      const q = Math.min(0.98, oddsShift(makeP[z]!, shift))
      const val = z === THREE ? 3 : 2
      pts += ev[z]! * ((1 - f) * q * val + f * a * val)
      pts += ev[z]! * (f * a + f * (1 - a) * val) * era.ftPct
    }
    return pts
  }
  let slo = -0.6
  let shi = 0.6
  const targetPts = era.ortg / 100 / shotEvents
  for (let i = 0; i < 40; i++) {
    const mid = (slo + shi) / 2
    if (ptsPerEvent(mid) < targetPts) slo = mid
    else shi = mid
  }
  const ortgShift = (slo + shi) / 2
  for (let z = 0; z < 4; z++) {
    makeP[z] = Math.min(0.98, Math.max(0.02, oddsShift(makeP[z]!, ortgShift)))
    andOne[z] = Math.min(0.98, Math.max(0.02, oddsShift(andOne[z]!, ortgShift * 0.5)))
  }

  // 7. Pace. Possessions alternate, so 2880 s of clock over 2 * possTarget possessions.
  const possTarget = era.pace * (1 + 0.03 * (home.pace + away.pace))
  const extraEvents = shotEvents - (1 - tovP)
  const target = 1440 / possTarget
  // Turnovers burn 85% of a drawn possession; rebounds add ORB_SECONDS each. Undo both
  // so the realised mean possession length is still `target`.
  const baseSeconds = Math.max(4, (target - ORB_SECONDS * extraEvents) / (1 - 0.15 * tovP))

  return {
    possTarget,
    baseSeconds,
    tovP,
    stealShare: Math.min(0.95, tovP > 0 ? era.stlPer100 / 100 / tovP : 0.5),
    orbP,
    astP: era.astPct,
    ftP: era.ftPct,
    foulP,
    makeP,
    andOne,
    blockP,
    otherFoulP,
    homeZ: HOME_K * (era.homeWinPct - 0.5),
    shotEvents,
    ortgShift,
  }
}
