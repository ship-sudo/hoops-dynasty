/**
 * The film of a finished season: champion, the Finals, then the facts a GM actually remembers.
 * Pure, so the overlay and a test cannot disagree about who won or how they got there.
 */
import type { AwardWinner, FinalsLeaders, GameState, SeriesState } from '@hoops/game'
import { ordinal, roundName } from '../sim/postseason.ts'
import { n1, seasonLabel } from '../ui/format.ts'

export interface RecapBeat {
  k: string
  v: string
  note?: string
}

export interface RecapFilm {
  yours: 'won' | 'finals' | 'out'
  yearEnd: number
  seasonLabel: string
  championTeamId: string
  championCity: string
  championName: string
  championAbbr: string
  runnerTeamId: string
  runnerCity: string
  runnerName: string
  runnerAbbr: string
  champWins: number
  runnerWins: number
  beats: RecapBeat[]
}

export interface RecapClub {
  teamId: string
  city: string
  name: string
  abbr: string
}

function club(game: GameState, teamId: string) {
  const t = game.league.teams.find((x) => x.teamId === teamId)
  return {
    teamId,
    city: t?.city ?? teamId,
    name: t?.name ?? teamId,
    abbr: t?.abbr ?? teamId,
    conference: t?.conference ?? 'West',
  }
}

function confRounds(game: GameState): number {
  const slots = Math.max(2, game.season.rules.playoffs.teams / 2)
  return Math.max(1, Math.round(Math.log2(slots)))
}

function seedOf(game: GameState, teamId: string): number | null {
  const po = game.playoffs
  if (!po) return null
  const t = game.league.teams.find((x) => x.teamId === teamId)
  if (!t) return null
  const i = po.seeds[t.conference]?.indexOf(teamId) ?? -1
  return i >= 0 ? i + 1 : null
}

/** The user's series, in the order they were played. */
export function userPath(rounds: SeriesState[][], me: string): SeriesState[] {
  const out: SeriesState[] = []
  for (const round of rounds) {
    for (const s of round) {
      if (s.highTeamId === me || s.lowTeamId === me) out.push(s)
    }
  }
  return out
}

export function pathLine(
  series: SeriesState[],
  me: string,
  oppName: (id: string) => string,
  rounds: number,
): string {
  return series
    .map((s) => {
      const youAreHigh = s.highTeamId === me
      const yours = youAreHigh ? s.highWins : s.lowWins
      const theirs = youAreHigh ? s.lowWins : s.highWins
      const opp = youAreHigh ? s.lowTeamId : s.highTeamId
      const took = s.winnerTeamId === me
      const round = roundName(s.round, s.bracket, rounds)
      return `${took ? 'beat' : 'lost to'} the ${oppName(opp)} ${yours}–${theirs} (${round})`
    })
    .join(' · ')
}

function beat(k: string, v: string, note?: string): RecapBeat {
  return note ? { k, v, note } : { k, v }
}

/** Champion's Finals scoring / board / passing leaders. Null when the series had no lines. */
export function seriesLeadersBeat(leaders: FinalsLeaders | null | undefined): RecapBeat | null {
  if (!leaders) return null
  const { pts, reb, ast } = leaders
  if (!pts && !reb && !ast) return null
  const rates = [
    pts && `${n1(pts.score)} pts`,
    reb && `${n1(reb.score)} reb`,
    ast && `${n1(ast.score)} ast`,
  ]
    .filter(Boolean)
    .join(' · ')
  const swept =
    Boolean(pts && reb && ast) && pts?.playerId === reb?.playerId && pts?.playerId === ast?.playerId
  if (swept && pts) return beat('In the series', pts.name, rates)
  const bits: string[] = []
  if (pts) bits.push(`${pts.name} scored`)
  if (reb) bits.push(`${reb.name} rebounded`)
  if (ast) bits.push(`${ast.name} passed`)
  return beat('In the series', bits.join(' · '), rates || undefined)
}

export function finalsHonorsBeats(input: {
  finalsMvp?: AwardWinner | null | undefined
  finalsLeaders?: FinalsLeaders | null | undefined
  finalsMvpName?: string | null | undefined
}): RecapBeat[] {
  const out: RecapBeat[] = []
  const mvpName = input.finalsMvp?.name ?? input.finalsMvpName ?? null
  if (mvpName) {
    const leaders = input.finalsLeaders
    const swept =
      input.finalsMvp &&
      leaders?.pts?.playerId === input.finalsMvp.playerId &&
      leaders.reb?.playerId === input.finalsMvp.playerId &&
      leaders.ast?.playerId === input.finalsMvp.playerId
    const note = swept
      ? `${n1(leaders?.pts?.score)} / ${n1(leaders?.reb?.score)} / ${n1(leaders?.ast?.score)}`
      : undefined
    out.push(beat('Finals MVP', mvpName, note))
  }
  const series = seriesLeadersBeat(input.finalsLeaders)
  if (series) out.push(series)
  return out
}

/** The lockup from the interrupt, before the save copy of the league has caught up. */
export function recapFromChampion(input: {
  yearEnd: number
  yours: RecapFilm['yours']
  champion: RecapClub
  runner: RecapClub
  champWins: number
  runnerWins: number
  finalsMvpName?: string | null | undefined
  finalsLeaders?: FinalsLeaders | null | undefined
}): RecapFilm {
  const { champion: champ, runner } = input
  return {
    yours: input.yours,
    yearEnd: input.yearEnd,
    seasonLabel: seasonLabel(input.yearEnd),
    championTeamId: champ.teamId,
    championCity: champ.city,
    championName: champ.name,
    championAbbr: champ.abbr,
    runnerTeamId: runner.teamId,
    runnerCity: runner.city,
    runnerName: runner.name,
    runnerAbbr: runner.abbr,
    champWins: input.champWins,
    runnerWins: input.runnerWins,
    beats: [
      {
        k: 'The Finals',
        v: `${champ.name} ${input.champWins}–${input.runnerWins} ${runner.name}`,
        note: `${champ.city || champ.name} beat ${runner.city || runner.name} in ${input.champWins + input.runnerWins} games`,
      },
      ...finalsHonorsBeats({
        finalsMvpName: input.finalsMvpName,
        finalsLeaders: input.finalsLeaders,
      }),
    ],
  }
}

/** Null until a champion exists. */
export function recapFilm(game: GameState): RecapFilm | null {
  const po = game.playoffs
  const champId = po?.championTeamId
  const runnerId = po?.runnerUpTeamId
  if (!po || !champId || !runnerId) return null

  const champ = club(game, champId)
  const runner = club(game, runnerId)
  const final = po.rounds.at(-1)?.[0]
  const champIsHigh = final?.winnerTeamId === final?.highTeamId
  const champWins = final ? (champIsHigh ? final.highWins : final.lowWins) : 4
  const runnerWins = final ? (champIsHigh ? final.lowWins : final.highWins) : 0
  const me = game.userTeamId
  const yours = me === champId ? 'won' : me === runnerId ? 'finals' : 'out'
  const rec = game.records[champId]
  const seed = seedOf(game, champId)
  const rounds = confRounds(game)
  const oppName = (id: string) => club(game, id).name
  const path = userPath(po.rounds, yours === 'out' ? champId : me)
  const awards = game.awards
  const beats: RecapBeat[] = []

  beats.push({
    k: 'The Finals',
    v: `${champ.name} ${champWins}–${runnerWins} ${runner.name}`,
    note: `${champ.city} beat ${runner.city} in ${champWins + runnerWins} games`,
  })
  beats.push(...finalsHonorsBeats(awards ?? {}))

  if (rec && rec.wins + rec.losses > 0) {
    const conf = champ.conference === 'East' ? 'East' : 'West'
    beats.push({
      k: 'The year',
      v: `${rec.wins}–${rec.losses}`,
      note: seed ? `${ordinal(seed)} in the ${conf}` : seasonLabel(game.season.yearEnd),
    })
  }

  if (path.length > 0) {
    beats.push({
      k: yours === 'won' || yours === 'finals' ? 'The run' : 'Their run',
      v: pathLine(path, yours === 'out' ? champId : me, oppName, rounds),
    })
  }

  if (awards?.mvp) {
    const ours = awards.mvp.teamId === champId
    beats.push(
      beat('MVP', awards.mvp.name, ours ? `He did it in a ${champ.name} shirt.` : undefined),
    )
  }

  const first = awards?.allNba[0] ?? []
  const oursAll = first.filter((a) => a.teamId === champId).map((a) => a.name)
  if (oursAll.length > 0) {
    beats.push({
      k: 'All-NBA',
      v: oursAll.join(' · '),
      note: 'First team',
    })
  }

  return {
    yours,
    yearEnd: game.season.yearEnd,
    seasonLabel: seasonLabel(game.season.yearEnd),
    championTeamId: champ.teamId,
    championCity: champ.city,
    championName: champ.name,
    championAbbr: champ.abbr,
    runnerTeamId: runner.teamId,
    runnerCity: runner.city,
    runnerName: runner.name,
    runnerAbbr: runner.abbr,
    champWins,
    runnerWins,
    beats,
  }
}
