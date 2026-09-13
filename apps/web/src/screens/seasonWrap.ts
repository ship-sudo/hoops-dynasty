/**
 * The regular-season wrap: how you finished, who took the hardware, the field.
 * Pure, so the overlay, the Awards screen, and a test cannot disagree.
 */
import { type AwardWinner, conferenceOrder, type GameState, type SeasonAwards } from '@hoops/game'
import { ordinal, seasonLabel } from '../ui/format.ts'

export type PlayInMode = 'none' | 'bubble_8_v_9' | 'seeds_7_to_10'
export type WrapBand = 'in' | 'playin' | 'out'

export const AWARD_DECK = [
  { key: 'mvp' as const, title: 'Most Valuable Player', short: 'MVP' },
  { key: 'roy' as const, title: 'Rookie of the Year', short: 'ROY' },
  { key: 'dpoy' as const, title: 'Defensive Player of the Year', short: 'DPOY' },
]

const NBA_TEAMS = ['All-NBA first team', 'All-NBA second team', 'All-NBA third team']

export function playoffCuts(mode: PlayInMode): { inCut: number; playCut: number } {
  if (mode === 'seeds_7_to_10') return { inCut: 6, playCut: 10 }
  if (mode === 'bubble_8_v_9') return { inCut: 7, playCut: 9 }
  return { inCut: 8, playCut: 8 }
}

export function wrapBand(place: number, mode: PlayInMode): WrapBand {
  const { inCut, playCut } = playoffCuts(mode)
  if (place <= inCut) return 'in'
  if (place <= playCut) return 'playin'
  return 'out'
}

export function wrapFate(
  place: number,
  conference: string,
  mode: PlayInMode,
  seed: number | null,
): string {
  const band = wrapBand(place, mode)
  const n = seed ?? place
  if (band === 'in') {
    return `Straight into the playoffs as the ${ordinal(n)} seed in the ${conference}.`
  }
  if (band === 'playin') return `${ordinal(place)} in the ${conference}. Play-in next.`
  return `${ordinal(place)} in the ${conference}. Missed the playoffs.`
}

export interface WrapHonor {
  label: string
  playerId: string
  name: string
}

export function honorsOf(awards: SeasonAwards | null, userTeamId: string): WrapHonor[] {
  if (!awards) return []
  const out: WrapHonor[] = []
  const push = (label: string, w: AwardWinner | null | undefined) => {
    if (w && w.teamId === userTeamId) out.push({ label, playerId: w.playerId, name: w.name })
  }
  push('MVP', awards.mvp)
  push('Rookie of the Year', awards.roy)
  push('Defensive Player of the Year', awards.dpoy)
  awards.allNba.forEach((team, i) => {
    for (const w of team) push(NBA_TEAMS[i] ?? 'All-NBA', w)
  })
  push('Finals MVP', awards.finalsMvp)
  return out
}

export interface PictureRow {
  teamId: string
  seed: number
  wins: number
  losses: number
  mine: boolean
  band: WrapBand
  /** Cutline under this row, named the way Standings names it. */
  cut: 'Play-in' | 'Lottery' | null
}

export function pictureRows(
  order: { teamId: string; wins: number; losses: number }[],
  userTeamId: string,
  mode: PlayInMode,
): PictureRow[] {
  const { inCut, playCut } = playoffCuts(mode)
  const shown = Math.min(order.length, playCut + 2)
  return order.slice(0, shown).map((t, i) => {
    const seed = i + 1
    return {
      teamId: t.teamId,
      seed,
      wins: t.wins,
      losses: t.losses,
      mine: t.teamId === userTeamId,
      band: wrapBand(seed, mode),
      cut: seed === inCut && mode !== 'none' ? 'Play-in' : seed === playCut ? 'Lottery' : null,
    }
  })
}

export interface WrapWinner {
  playerId: string
  name: string
  teamId: string | null
  yours: boolean
}

export interface WrapLeader extends WrapWinner {
  score: number
}

export interface SeasonWrapModel {
  yearEnd: number
  seasonLabel: string
  phase: GameState['phase']
  playing: boolean
  yours: {
    teamId: string
    city: string
    name: string
    abbr: string
    conference: 'East' | 'West'
    wins: number
    losses: number
    place: number
    seed: number | null
    band: WrapBand
    fate: string
  }
  awards: { key: 'mvp' | 'roy' | 'dpoy'; title: string; short: string; winner: WrapWinner | null }[]
  allNba: { label: string; players: WrapWinner[] }[]
  honors: WrapHonor[]
  finalsMvp: WrapWinner | null
  finalsLeaders: { pts: WrapLeader | null; reb: WrapLeader | null; ast: WrapLeader | null } | null
  picture: { conference: 'East' | 'West'; rows: PictureRow[] }[]
  playIn: boolean
  hasBracket: boolean
}

export function wrapFromGame(game: GameState): SeasonWrapModel | null {
  try {
    const me = game.userTeamId
    const club = game.league.teams.find((t) => t.teamId === me)
    if (!club) return null
    const rec = game.records[me]
    const mode = game.season.rules.playoffs.play_in
    const ranked = (conf: 'East' | 'West') =>
      conferenceOrder(game, conf).map((id) => ({
        teamId: id,
        wins: game.records[id]?.wins ?? 0,
        losses: game.records[id]?.losses ?? 0,
      }))
    const east = ranked('East')
    const west = ranked('West')
    const mineOrder = club.conference === 'East' ? east : west
    const place = Math.max(1, mineOrder.findIndex((t) => t.teamId === me) + 1)
    const seedList = game.playoffs?.seeds[club.conference]
    const seedIdx = seedList?.indexOf(me) ?? -1
    const seed = seedIdx >= 0 ? seedIdx + 1 : null
    const band = wrapBand(place, mode)
    const mark = (w: AwardWinner | null | undefined): WrapWinner | null =>
      w ? { playerId: w.playerId, name: w.name, teamId: w.teamId, yours: w.teamId === me } : null
    const markLeader = (w: AwardWinner | null | undefined): WrapLeader | null => {
      const base = mark(w)
      return base && w ? { ...base, score: w.score } : null
    }
    const leaders = game.awards?.finalsLeaders
    const playing = game.phase === 'regular' || game.phase === 'playin' || game.phase === 'playoffs'
    return {
      yearEnd: game.season.yearEnd,
      seasonLabel: seasonLabel(game.season.yearEnd),
      phase: game.phase,
      playing,
      yours: {
        teamId: me,
        city: club.city,
        name: club.name,
        abbr: club.abbr,
        conference: club.conference,
        wins: rec?.wins ?? 0,
        losses: rec?.losses ?? 0,
        place,
        seed,
        band,
        fate: wrapFate(place, club.conference, mode, seed),
      },
      awards: AWARD_DECK.map((a) => ({
        ...a,
        winner: mark(game.awards?.[a.key] ?? null),
      })),
      allNba: (game.awards?.allNba ?? []).map((team, i) => ({
        label: NBA_TEAMS[i] ?? `All-NBA team ${i + 1}`,
        players: team.map((w) => mark(w) as WrapWinner),
      })),
      honors: honorsOf(game.awards, me),
      finalsMvp: mark(game.awards?.finalsMvp),
      finalsLeaders: leaders
        ? {
            pts: markLeader(leaders.pts),
            reb: markLeader(leaders.reb),
            ast: markLeader(leaders.ast),
          }
        : null,
      picture: [
        { conference: 'East', rows: pictureRows(east, me, mode) },
        { conference: 'West', rows: pictureRows(west, me, mode) },
      ],
      playIn: mode !== 'none',
      hasBracket: (game.playoffs?.rounds[0]?.length ?? 0) > 0,
    }
  } catch {
    return null
  }
}
