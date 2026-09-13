/** Read models: GameState in, the screens' types out. real.ts only steps. */
import type { GameResult, PlayerRecord, SeasonBundle } from '@hoops/core'
import {
  askingMultiplier,
  type Conference,
  conferenceOrder,
  type GameState,
  type LeaguePlayer,
  moodLabel,
  moraleOf,
  moraleTarget,
  ROLE_MINUTES,
  type SeriesState,
  seedConference,
  wantsOut,
} from '@hoops/game'
import { isWarning } from '@hoops/injury'
import type {
  NewsItem,
  PlayedGame,
  PlayerMood,
  PlayoffPreview,
  PostseasonSummary,
  RosterRow,
  SeasonTotals,
  StandingsRow,
} from './api.ts'
import {
  eliminatedLine,
  missedLine,
  nextIsHome,
  ordinal,
  type PlayInSlot,
  playInStake,
  roundName,
  seriesAction,
  seriesLine,
  stakeLine,
} from './postseason.ts'

export function emptyTotals(): SeasonTotals {
  return {
    gp: 0,
    gs: 0,
    min: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
  }
}

/** Rebuild something PlayerRecord-shaped for the UI, using the bundle for bio the save dropped. */
export function toPlayerRecord(p: LeaguePlayer, bundle: SeasonBundle): PlayerRecord {
  const original = bundle.players.find((x) => x.playerId === p.playerId)
  return {
    playerId: p.playerId,
    brefId: original?.brefId ?? null,
    name: p.name,
    birthDate: original?.birthDate ?? null,
    age: p.age,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    pos: p.pos,
    draft: p.draft,
    yearsPro: p.yearsPro,
    yearsWithTeam: p.yearsWithTeam,
    teamId: p.teamId ?? '',
    contract: p.contract,
    ratings: p.ratings,
    tendencies: p.tendencies,
    real: original?.real ?? null,
    realMpg: p.mpgHint,
  }
}
/** "1 rebound", "11 rebounds". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The game package logs team ids. People read names. */
export function withTeamNames(state: GameState, text: string): string {
  let out = text
  for (const t of state.league.teams) out = out.replaceAll(t.teamId, `${t.city} ${t.name}`)
  return out
}

/** Sentences for the inbox, from the day's games. */
export function newsFor(
  state: GameState,
  games: PlayedGame[],
  boxes: Map<string, GameResult>,
  userTeamId: string,
): NewsItem[] {
  const out: NewsItem[] = []
  const nameOf = (teamId: string) =>
    state.league.teams.find((t) => t.teamId === teamId)?.name ?? teamId

  for (const g of games) {
    const box = boxes.get(g.gameId)
    const isUser = g.homeTeamId === userTeamId || g.awayTeamId === userTeamId
    if (isUser) {
      const won =
        (g.homeTeamId === userTeamId && g.homePts > g.awayPts) ||
        (g.awayTeamId === userTeamId && g.awayPts > g.homePts)
      const mine = box ? (g.homeTeamId === userTeamId ? box.home : box.away) : null
      // An engine that returns no player lines (the naive baseline can) must not break the inbox.
      const best = mine?.players.length
        ? mine.players.reduce((a, b) => (b.pts > a.pts ? b : a))
        : null
      out.push({
        id: `r-${g.gameId}`,
        date: g.date,
        kind: 'result',
        headline: `${won ? 'Win' : 'Loss'} ${g.homePts}-${g.awayPts} ${
          g.homeTeamId === userTeamId ? 'vs' : 'at'
        } ${nameOf(g.homeTeamId === userTeamId ? g.awayTeamId : g.homeTeamId)}`,
        body: best
          ? `${best.name} led the way with ${best.pts} points, ${plural(best.dreb + best.oreb, 'rebound')} and ${plural(best.ast, 'assist')}.`
          : `Final score ${g.homePts}-${g.awayPts}.`,
        gameId: g.gameId,
      })
      continue
    }
    // League-wide: only the outrageous lines are news.
    if (!box) continue
    for (const side of [box.home, box.away]) {
      for (const p of side.players) {
        if (p.pts >= 45)
          out.push({
            id: `m-${g.gameId}-${p.playerId}`,
            date: g.date,
            kind: 'milestone',
            headline: `${p.name} drops ${p.pts}`,
            body: `${p.name} scored ${p.pts} on ${p.fgm}-of-${p.fga} shooting for ${nameOf(side.teamId)}.`,
            gameId: g.gameId,
          })
        else if (p.pts >= 20 && p.oreb + p.dreb >= 20)
          out.push({
            id: `m-${g.gameId}-${p.playerId}`,
            date: g.date,
            kind: 'milestone',
            headline: `${p.name} goes for ${p.pts} and ${p.oreb + p.dreb}`,
            body: `A 20-20 night for ${nameOf(side.teamId)}.`,
            gameId: g.gameId,
          })
      }
    }
  }
  return out
}

export function standingsFrom(state: GameState): StandingsRow[] {
  const rows: StandingsRow[] = []
  // conferenceOrder returns team ids, best first.
  const east = conferenceOrder(state, 'East')
  const west = conferenceOrder(state, 'West')
  const order = [...east, ...west]
  const leader = { East: east[0] ?? '', West: west[0] ?? '' }

  for (const teamId of order) {
    const rec = state.records[teamId]
    if (!rec) continue
    const team = state.league.teams.find((t) => t.teamId === teamId)
    const mine = state.calendar.results.filter(
      (g) => g.homeTeamId === teamId || g.awayTeamId === teamId,
    )
    let homeWins = 0
    let homeLosses = 0
    const chron: boolean[] = []
    for (const g of mine) {
      const home = g.homeTeamId === teamId
      const won = home ? g.homePts > g.awayPts : g.awayPts > g.homePts
      if (home) {
        if (won) homeWins++
        else homeLosses++
      }
      chron.push(won)
    }
    let streak = 0
    for (let i = chron.length - 1; i >= 0; i--) {
      if (i === chron.length - 1) streak = chron[i] ? 1 : -1
      else if (chron[i] === chron[chron.length - 1]) streak += chron[i] ? 1 : -1
      else break
    }
    const top = state.records[leader[team?.conference ?? 'East']]
    const leaderWins = top?.wins ?? rec.wins
    const leaderLosses = top?.losses ?? rec.losses
    rows.push({
      teamId,
      wins: rec.wins,
      losses: rec.losses,
      pct: rec.wins + rec.losses > 0 ? rec.wins / (rec.wins + rec.losses) : 0,
      gb: (leaderWins - rec.wins + (rec.losses - leaderLosses)) / 2,
      pointsFor: rec.pf,
      pointsAgainst: rec.pa,
      confWins: rec.confW,
      confLosses: rec.confL,
      divWins: rec.divW,
      divLosses: rec.divL,
      homeWins,
      homeLosses,
      last10: chron.slice(-10).reverse(),
      streak,
    })
  }
  return rows
}

/**
 * One player's dressing-room card. The stored number, the role it is measured against, and every
 * term that built the target — so a screen can show the arithmetic rather than a mood ring.
 */
export function moodOf(state: GameState, p: LeaguePlayer): PlayerMood {
  const m = moraleOf(state, p)
  const b = moraleTarget(state, p, { sinceTrade: m.sinceTrade })
  return {
    value: m.value,
    label: moodLabel(m.value),
    role: m.role,
    expectedMpg: ROLE_MINUTES[m.role],
    mpg: m.mpg,
    why: m.why,
    terms: [...b.terms]
      .sort((a, c) => a.value - c.value)
      .map((t) => ({ key: t.key, value: t.value, text: t.text })),
    wantsOut: wantsOut(m.value),
    askingMultiple: askingMultiplier(m.value),
  }
}

/** A live absence or a warning the manager is playing through. Recovering-but-dressed is hidden. */
export function liveInjury(
  state: GameState,
  playerId: string,
): NonNullable<RosterRow['injury']> | undefined {
  const a = state.availability?.[playerId]
  if (!a?.injury) return undefined
  const playingThrough = Boolean(a.playingThrough)
  if (a.out <= 0 && !playingThrough) return undefined
  const hit: NonNullable<RosterRow['injury']> = {
    name: a.injury.name,
    games: a.out > 0 ? a.out : a.injury.games,
    warning: isWarning(a.injury),
  }
  if (playingThrough) hit.playingThrough = true
  return hit
}

// ──────────────────────────────────────────────────────────────────────────────
// The postseason, read off the state the sim already keeps.
//
// Playoff games are never on the calendar's schedule — they are created a round at a time as the
// bracket resolves — so the Home panel cannot find tonight's game by looking there. It asks here
// instead, and gets the same fixture the next `simDay` will play.
// ──────────────────────────────────────────────────────────────────────────────

/** The short name a headline uses: 'Celtics', not 'Boston Celtics'. */
export function clubName(state: GameState, teamId: string): string {
  return state.league.teams.find((t) => t.teamId === teamId)?.name ?? teamId
}

/** Rounds a conference plays before the Finals: three in a sixteen-team field, two in an eight. */
export function confRounds(state: GameState): number {
  const slots = Math.max(2, state.season.rules.playoffs.teams / 2)
  return Math.max(1, Math.round(Math.log2(slots)))
}

export function confOf(state: GameState, teamId: string): Conference {
  return state.league.teams.find((t) => t.teamId === teamId)?.conference ?? 'East'
}

/** The user's undecided series, whichever round it sits in. Null once he is out. */
export function liveSeries(state: GameState, me: string): SeriesState | null {
  for (const round of state.playoffs?.rounds ?? [])
    for (const s of round)
      if (!s.winnerTeamId && (s.highTeamId === me || s.lowTeamId === me)) return s
  return null
}

/** The last series the user played and lost. Null if he never lost one. */
export function lostSeries(state: GameState, me: string): SeriesState | null {
  let out: SeriesState | null = null
  for (const round of state.playoffs?.rounds ?? [])
    for (const s of round)
      if (s.winnerTeamId && s.winnerTeamId !== me && (s.highTeamId === me || s.lowTeamId === me))
        out = s
  return out
}

/** Clubs still playing: both sides of a live series, or the winners waiting on the next round. */
export function stillAlive(state: GameState): string[] {
  const po = state.playoffs
  if (!po || po.championTeamId) return []
  const last = po.rounds[po.rounds.length - 1] ?? []
  const out: string[] = []
  for (const s of last) {
    if (s.winnerTeamId) out.push(s.winnerTeamId)
    else out.push(s.highTeamId, s.lowTeamId)
  }
  return out
}

/** Tonight's play-in fixture for the user, and what it is worth. Null when he has none. */
export function playInFixture(
  state: GameState,
  me: string,
): { gameId: string; opponent: string; home: boolean; slot: PlayInSlot } | null {
  const pi = state.playIn
  if (!pi || pi.done) return null
  const mode = state.season.rules.playoffs.play_in
  const conf = confOf(state, me)
  const order = seedConference(state, conf)
  const slots = state.season.rules.playoffs.teams / 2
  const y = state.season.yearEnd
  const rank = order.indexOf(me)

  if (mode === 'bubble_8_v_9') {
    const eight = order[slots - 1]
    const nine = order[slots]
    if (!eight || !nine) return null
    const r8 = state.records[eight]
    const r9 = state.records[nine]
    if (!r8 || !r9) return null
    // The same four-game cut the sim applies before it bothers playing the game at all.
    if ((r8.wins - r9.wins + (r9.losses - r8.losses)) / 2 > 4) return null
    if (me === eight)
      return { gameId: `pi${y}-${conf}-1`, opponent: nine, home: true, slot: 'bubble_eight' }
    if (me === nine)
      return { gameId: `pi${y}-${conf}-1`, opponent: eight, home: false, slot: 'bubble_nine' }
    return null
  }

  if (pi.day === 0) {
    const [s7, s8, s9, s10] = [order[slots - 2], order[slots - 1], order[slots], order[slots + 1]]
    if (!s7 || !s8 || !s9 || !s10) return null
    if (rank === slots - 2)
      return { gameId: `pi${y}-${conf}-A`, opponent: s8, home: true, slot: 'seven_eight' }
    if (rank === slots - 1)
      return { gameId: `pi${y}-${conf}-A`, opponent: s7, home: false, slot: 'seven_eight' }
    if (rank === slots)
      return { gameId: `pi${y}-${conf}-B`, opponent: s10, home: true, slot: 'nine_ten' }
    if (rank === slots + 1)
      return { gameId: `pi${y}-${conf}-B`, opponent: s9, home: false, slot: 'nine_ten' }
    return null
  }

  const a = pi.games.find((g) => g.gameId === `pi${y}-${conf}-A`)
  const b = pi.games.find((g) => g.gameId === `pi${y}-${conf}-B`)
  if (!a || !b) return null
  const loserA = a.homePts > a.awayPts ? a.awayTeamId : a.homeTeamId
  const winnerB = b.homePts > b.awayPts ? b.homeTeamId : b.awayTeamId
  if (me === loserA)
    return { gameId: `pi${y}-${conf}-C`, opponent: winnerB, home: true, slot: 'elimination' }
  if (me === winnerB)
    return { gameId: `pi${y}-${conf}-C`, opponent: loserA, home: false, slot: 'elimination' }
  return null
}

/** The series so far, told from the user's side. */
export function seriesGames(s: SeriesState, me: string): PlayoffPreview['games'] {
  return s.games.map((g) => ({
    gameId: g.gameId,
    date: g.date,
    yourPts: g.homeTeamId === me ? g.homePts : g.awayPts,
    theirPts: g.homeTeamId === me ? g.awayPts : g.homePts,
    home: g.homeTeamId === me,
  }))
}

/** Tonight's fixture for the user, wherever it comes from: the schedule, a series, or a play-in. */
export function nextFixture(
  state: GameState,
  me: string,
): {
  gameId: string
  date: string
  home: boolean
  opponentTeamId: string
  playoff?: PlayoffPreview
} | null {
  const scheduled = state.calendar.schedule
    .slice(state.calendar.next)
    .find((g) => g.homeTeamId === me || g.awayTeamId === me)
  if (scheduled) {
    const home = scheduled.homeTeamId === me
    return {
      gameId: scheduled.gameId,
      date: scheduled.date,
      home,
      opponentTeamId: home ? scheduled.awayTeamId : scheduled.homeTeamId,
    }
  }

  if (state.phase === 'playin') {
    const pi = playInFixture(state, me)
    if (!pi) return null
    const { stake, action } = playInStake(pi.slot)
    return {
      gameId: pi.gameId,
      date: state.calendar.date,
      home: pi.home,
      opponentTeamId: pi.opponent,
      playoff: {
        kind: 'playin',
        title: 'The play-in',
        seriesLine: '',
        stake,
        action,
        gameNumber: 1,
        bestOf: 1,
        yourSeed: null,
        theirSeed: null,
        yourWins: 0,
        theirWins: 0,
        games: [],
      },
    }
  }

  if (state.phase !== 'playoffs') return null
  const s = liveSeries(state, me)
  if (!s) return null
  const youAreHigh = s.highTeamId === me
  const them = youAreHigh ? s.lowTeamId : s.highTeamId
  const yourWins = youAreHigh ? s.highWins : s.lowWins
  const theirWins = youAreHigh ? s.lowWins : s.highWins
  const played = s.highWins + s.lowWins
  const seedOf = (teamId: string): number | null => {
    for (const conf of ['East', 'West'] as const) {
      const i = state.playoffs?.seeds[conf].indexOf(teamId) ?? -1
      if (i >= 0) return i + 1
    }
    return null
  }
  return {
    // The id `advanceSeries` will mint for this game, so its box score is findable once played.
    gameId: `p${state.season.yearEnd}-r${s.round}-${s.highTeamId}${s.lowTeamId}-${played + 1}`,
    date: state.calendar.date,
    home: nextIsHome({
      bestOf: s.bestOf,
      bracket: s.bracket,
      yearEnd: state.season.yearEnd,
      youAreHigh,
      gamesPlayed: played,
    }),
    opponentTeamId: them,
    playoff: {
      kind: 'series',
      title: roundName(s.round, s.bracket, confRounds(state)),
      seriesLine: seriesLine(clubName(state, me), yourWins, theirWins),
      stake: stakeLine(clubName(state, me), yourWins, theirWins, s.bestOf),
      action: seriesAction(played + 1),
      gameNumber: played + 1,
      bestOf: s.bestOf,
      yourSeed: seedOf(me),
      theirSeed: seedOf(them),
      yourWins,
      theirWins,
      games: seriesGames(s, me),
    },
  }
}

/** Where the user's season stands once the regular one is done. */
export function postseasonOf(state: GameState, me: string): PostseasonSummary | null {
  if (state.phase === 'regular') return null
  const po = state.playoffs
  const alive = stillAlive(state)
  const final = po?.rounds[po.rounds.length - 1]?.[0]

  if (po?.championTeamId === me) {
    const beaten = po.runnerUpTeamId ? clubName(state, po.runnerUpTeamId) : 'the West'
    const won = final ? Math.max(final.highWins, final.lowWins) : 4
    const lost = final ? Math.min(final.highWins, final.lowWins) : 0
    return {
      kind: 'champion',
      headline: 'You are champions.',
      detail: `You beat the ${beaten} ${won}–${lost} in the Finals.`,
      aliveTeamIds: [],
    }
  }
  if (po?.runnerUpTeamId === me && po.championTeamId) {
    const won = final ? Math.max(final.highWins, final.lowWins) : 4
    const lost = final ? Math.min(final.highWins, final.lowWins) : 0
    return {
      kind: 'runnerUp',
      headline: `${clubName(state, po.championTeamId)} knocked you out.`,
      detail: `They beat you ${won}–${lost} in the Finals. You lost the last game of the year.`,
      aliveTeamIds: [],
    }
  }

  if (nextFixture(state, me)) {
    return { kind: 'playing', headline: 'You are still in it.', detail: '', aliveTeamIds: alive }
  }

  const lost = lostSeries(state, me)
  if (lost) {
    const youAreHigh = lost.highTeamId === me
    const line = eliminatedLine({
      theirName: clubName(state, youAreHigh ? lost.lowTeamId : lost.highTeamId),
      yourWins: youAreHigh ? lost.highWins : lost.lowWins,
      theirWins: youAreHigh ? lost.lowWins : lost.highWins,
      round: roundName(lost.round, lost.bracket, confRounds(state)),
    })
    return { kind: 'eliminated', ...line, aliveTeamIds: alive }
  }

  const conf = confOf(state, me)
  const order = seedConference(state, conf)
  const rank = order.indexOf(me) + 1
  const record = state.records[me]
  const slots = state.season.rules.playoffs.teams / 2

  if (state.phase === 'playin') {
    const pi = state.playIn
    const a = pi?.games.find((g) => g.gameId === `pi${state.season.yearEnd}-${conf}-A`)
    const wonSeven = a ? (a.homePts > a.awayPts ? a.homeTeamId : a.awayTeamId) === me : false
    if (wonSeven || rank <= slots - 2) {
      return {
        kind: 'waiting',
        headline: wonSeven
          ? 'You are through as the 7 seed.'
          : `You are the ${ordinal(rank)} seed.`,
        detail: 'The bracket is drawn once the play-in finishes.',
        aliveTeamIds: [],
      }
    }
    if (rank <= slots + 2) {
      return {
        kind: 'missed',
        headline: 'Your season is over.',
        detail: 'You lost the play-in and missed the playoffs.',
        aliveTeamIds: [],
      }
    }
  }

  if (po && (po.seeds.East.includes(me) || po.seeds.West.includes(me))) {
    return {
      kind: 'waiting',
      headline: 'You are through to the next round.',
      detail: 'Your next series starts when the rest of the round finishes.',
      aliveTeamIds: alive,
    }
  }

  return {
    kind: 'missed',
    ...missedLine({
      wins: record?.wins ?? 0,
      losses: record?.losses ?? 0,
      rank: Math.max(1, rank),
      conference: conf,
    }),
    aliveTeamIds: alive,
  }
}
