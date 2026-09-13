// Test fixtures for the engine. Not part of the public API.

import {
  DEFAULT_TACTICS,
  type EraContext,
  type GameInput,
  type PlayerGameInput,
  RATING_KEYS,
  type Ratings,
  type TeamGameInput,
} from '@hoops/core'
import { REFERENCE } from './possession.ts'

export const ERA_2016: EraContext = {
  yearEnd: 2016,
  pace: 96.54,
  ortg: 105.56,
  threePAr: 0.2847,
  ftr: 0.2762,
  tovPct: 14.79,
  orbPct: 0.238,
  fg3Pct: 0.3537,
  fg2Pct: 0.4913,
  ftPct: 0.7567,
  astPct: 0.5829,
  stlPer100: 8.067,
  blkPer100: 5.096,
  pfPer100: 20.84,
  zoneShare: { rim: 0.2933, close: 0.1579, mid: 0.2642, three: 0.2847 },
  zonePct: { rim: 0.6243, close: 0.3956, mid: 0.4007, three: 0.3537 },
  homeWinPct: 0.5886,
  handCheckBanned: true,
  zoneLegal: true,
}

const MINUTES = [36, 34, 32, 30, 28, 22, 18, 16, 12, 12] as const

export function flatRatings(v: number): Ratings {
  const r = {} as Ratings
  for (const k of RATING_KEYS) r[k] = v
  return r
}

/** The league-average player: every rating at its reference, shifted by `delta`. */
export function referenceRatings(delta = 0): Ratings {
  const r = {} as Ratings
  for (const k of RATING_KEYS) r[k] = REFERENCE[k] + delta
  return r
}

/** A ten-man roster of identical players, minutes targets summing to 240. */
export function makeTeam(
  teamId: string,
  ratings: Ratings,
  era: EraContext = ERA_2016,
): TeamGameInput {
  const players: PlayerGameInput[] = MINUTES.map((m, i) => ({
    playerId: `${teamId}-${i}`,
    name: `${teamId} P${i}`,
    pos: (['PG', 'SG', 'SF', 'PF', 'C'] as const)[i % 5]!,
    heightIn: 78,
    weightLb: 220,
    age: 27,
    ratings,
    tendencies: {
      usage: 0.2,
      shotRim: era.zoneShare.rim,
      shotClose: era.zoneShare.close,
      shotMid: era.zoneShare.mid,
      shotThree: era.zoneShare.three,
      assist: 0.2,
      postUp: 0.1,
    },
    minutesTarget: m,
    starter: i < 5,
    condition: 1,
  }))
  return { teamId, name: teamId, players, tactics: { ...DEFAULT_TACTICS } }
}

export function makeGame(homeDelta = 0, awayDelta = 0, era: EraContext = ERA_2016): GameInput {
  return {
    era,
    home: makeTeam('HOM', referenceRatings(homeDelta), era),
    away: makeTeam('AWY', referenceRatings(awayDelta), era),
    seasonType: 'regular',
  }
}

/** 1997-98, for the era-fidelity tests: slow, no threes, hand-checking legal. */
export const ERA_1998: EraContext = {
  yearEnd: 1998,
  pace: 91.82,
  ortg: 103.4,
  threePAr: 0.1595,
  ftr: 0.3297,
  tovPct: 16.7,
  orbPct: 0.3138,
  fg3Pct: 0.3456,
  fg2Pct: 0.4704,
  ftPct: 0.7372,
  astPct: 0.6139,
  stlPer100: 9.065,
  blkPer100: 5.485,
  pfPer100: 24.22,
  zoneShare: { rim: 0.3311, close: 0.185, mid: 0.3244, three: 0.1595 },
  zonePct: { rim: 0.5871, close: 0.3839, mid: 0.3947, three: 0.3457 },
  homeWinPct: 0.5951,
  handCheckBanned: false,
  zoneLegal: false,
}
