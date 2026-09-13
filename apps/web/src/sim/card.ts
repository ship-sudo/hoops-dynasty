/**
 * The player card: what a rating *reads* as.
 *
 * The simulation thinks in z-scores — 50 is the pooled league mean, 15 points is a standard
 * deviation. That is the right scale for a model and the wrong one for a person. Measured on the
 * 2003-04 league, the median rotation player came out at 50 and the best player in basketball at
 * 74, so every screen said "everyone here is mediocre". Nobody wants to run a team of 52s.
 *
 * Basketball games have always solved this by compressing upward: an average starter reads in the
 * mid-seventies, a good one in the eighties, a superstar in the nineties, and the last man on a
 * bench still clears sixty. The underlying model is untouched — this is a lens over it, applied at
 * the edge, so the engine keeps its honest numbers and the user gets numbers he can feel.
 *
 *   internal 30 → 60      the twelfth man
 *   internal 50 → 73      an average rotation player
 *   internal 62 → 81      a good starter
 *   internal 72 → 88      an All-Star
 *   internal 85 → 96      the best player in the league
 */
import type { Position, Ratings, Tendencies } from '@hoops/core'
import { roleParts, roleRating } from '@hoops/progression'

/**
 * Internal (z-anchored) to displayed (basketball-game) scale.
 *
 * Linear through the body of the league, then compressive at the top: without that the five best
 * players in a strong season all clipped to 99 and the very top of the league read flat, which is
 * the one place a rating has to discriminate.
 */
export function display(internal: number): number {
  const KNEE = 70
  const shown =
    internal <= KNEE
      ? 60 + (internal - 30) * 0.66
      : 60 + (KNEE - 30) * 0.66 + (internal - KNEE) * 0.32
  return Math.round(Math.min(99, Math.max(52, shown)))
}

/** The eight things a card shows, in the order a fan reads them. */
export interface RatingCard {
  /** Headline number, 52–99. */
  overall: number
  /** Where he can get to, same scale. Only ever shown for players you employ. */
  potential: number | null
  /** True when he still has real room to grow — the reason to play a young man. */
  rising: boolean
  categories: {
    inside: number
    outside: number
    playmaking: number
    perimeterDefence: number
    interiorDefence: number
    rebounding: number
    athleticism: number
    basketballIq: number
  }
  /** The two or three things he is genuinely good at, for a one-line summary. */
  strengths: string[]
  /** Where he is exposed. */
  weaknesses: string[]
}

const LABELS: Record<keyof RatingCard['categories'], string> = {
  inside: 'inside scoring',
  outside: 'outside shooting',
  playmaking: 'playmaking',
  perimeterDefence: 'perimeter defence',
  interiorDefence: 'rim protection',
  rebounding: 'rebounding',
  athleticism: 'athleticism',
  basketballIq: 'basketball IQ',
}

/**
 * Build a card. `potential` is the hidden ceiling on the internal scale; pass null for players the
 * user does not employ — a rival's ceiling is not his to know.
 */
export function ratingCard(
  ratings: Ratings,
  tendencies: Tendencies,
  pos: Position,
  potential: number | null,
): RatingCard {
  const parts = roleParts(ratings, tendencies)
  const overallInternal = roleRating(ratings, tendencies, pos)

  // Category scores are built from the same aggregates the simulation ranks players on, so a card
  // that says "rim protection 91" belongs to a man the engine really does treat that way.
  const categories = {
    inside: display(ratings.rim * 0.55 + ratings.close * 0.3 + ratings.drawFoul * 0.15),
    outside: display(ratings.three * 0.62 + ratings.mid * 0.24 + ratings.ft * 0.14),
    playmaking: display(parts.creation),
    perimeterDefence: display(ratings.perimD * 0.7 + ratings.steal * 0.3),
    interiorDefence: display(ratings.interiorD * 0.65 + ratings.block * 0.35),
    rebounding: display(parts.boards),
    athleticism: display(parts.athletic),
    basketballIq: display(ratings.iq),
  }

  const ranked = (Object.keys(categories) as (keyof typeof categories)[]).sort(
    (a, b) => categories[b] - categories[a],
  )
  const strengths = ranked
    .filter((k) => categories[k] >= 80)
    .slice(0, 3)
    .map((k) => LABELS[k])
  const weaknesses = ranked
    .reverse()
    .filter((k) => categories[k] <= 65)
    .slice(0, 2)
    .map((k) => LABELS[k])

  const shown = display(overallInternal)
  const ceiling = potential == null ? null : Math.max(shown, display(potential))
  return {
    overall: shown,
    potential: ceiling,
    rising: ceiling != null && ceiling >= shown + 4,
    categories,
    strengths: strengths.length > 0 ? strengths : [LABELS[ranked.at(-1) ?? 'athleticism']],
    weaknesses,
  }
}
