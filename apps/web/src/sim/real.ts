/**
 * The real implementation of the seam in `api.ts`: @hoops/game driving the season, with the Phase 4
 * and 5 packages plugged into its hooks.
 *
 *   engine       @hoops/engine        plays the games
 *   develop      @hoops/progression   ageing, development, retirement, plus injury after-effects
 *   prospects    @hoops/draftclass    real draft classes while history lasts, invented after
 *   freeAgency   @hoops/frontoffice   the summer market, inside the era's cap rules
 *
 * Two things this file owns that the game package deliberately does not:
 *   - Box scores. The season state stores totals, not boxes, so the engine is wrapped on the way
 *     in and its results are paired with the day's summaries and kept in a bounded cache.
 *   - News. The state keeps a structured log; the inbox wants sentences.
 */
import {
  emptyStatLine,
  type GameResult,
  isNeutralInstruction,
  makeRng,
  normaliseInstruction,
  normaliseLineups,
  normaliseUnitTactics,
  type PlayerRecord,
  RATING_KEYS,
  type Ratings,
  type Rng,
  type SeasonBundle,
  type SimulateGame,
} from '@hoops/core'
import { ERA, ERA_FIRST, ERA_LAST } from '@hoops/data/era'
import { classFor, fictionalClass, NameBank, scout } from '@hoops/draftclass'
import { simulateGame } from '@hoops/engine'
import { canWaive, maxSalary, minSalary, salariesFor } from '@hoops/frontoffice'
import {
  allStarDate,
  askingMultiplier,
  availabilityOf,
  autoAdjustSettings,
  markInjuryCover,
  type Conference,
  candidates,
  careerOf,
  chooseSquad,
  conferenceOrder,
  daysBetween,
  type GameHooks,
  type GameState,
  newGame as gameNewGame,
  simDay as gameSimDay,
  squadMood as gameSquadMood,
  type LeaguePlayer,
  makePick,
  moodLabel,
  moraleOf,
  moraleTarget,
  moraleValue,
  onTheClock,
  openDraft,
  pickAllStars,
  ROLE_MINUTES,
  restReason,
  rolloverBegin,
  rolloverFinish,
  runDraft,
  type SeasonStatLine,
  type SeriesState,
  seedConference,
  summarise,
  type TeamSettings,
  wantsOut,
} from '@hoops/game'
import { injuryOutlook, injuryRisk, isWarning, lingeringPenalty } from '@hoops/injury'
import { blendToFate, develop, draftPotential, overall, retires } from '@hoops/progression'
import type {
  AllStarGame,
  AllStarPick,
  AwardCandidate,
  AwardRace,
  Bracket,
  BracketSeries,
  DayReport,
  Dynasty,
  DynastyModule,
  DynastyState,
  FreeAgentView,
  GameLogRow,
  GamePreview,
  LeaderRow,
  NewGameOptions,
  NewsItem,
  OffseasonState,
  PlayedGame,
  PlayerDesk,
  PlayerMood,
  PlayoffPreview,
  PostseasonSummary,
  RosterRow,
  SaveFile,
  ScheduleEntry,
  ScoutedView,
  SeasonTotals,
  SimInterrupt,
  SimSeason,
  SquadMoodView,
  StandingsRow,
  StatCategory,
  TeamFinance,
  TeamPlan,
  TeamStatRow,
  TradeAssessment,
  TradePackage,
} from './api.ts'
import { ratingCard } from './card.ts'
import {
  askingFrom,
  askingToStay,
  backfillPool,
  extendPlayer,
  freeAgentPool,
  type Potentials,
  runMarket,
  runMarketDay,
  seasonTaxBills,
  signRookies,
  type UserOffer,
} from './market.ts'
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
import { tradeAlert, weeklyRumours } from './rumours.ts'
import { developmentFactor, fire, hire, scoutingOf, staffView } from './staff.ts'
import { aiTradeRound, applyTrade, assess, incomingOffers, picksOf, tradeBlock } from './trades.ts'
import { applySignMinimum, applyWaive, unsignedPool } from './transactions.ts'

/** How many recent box scores to keep. Enough for the inbox to stay clickable; small enough to hold. */
const BOX_CACHE = 400

/** Phases where pressing continue plays basketball. */
const PLAYING = new Set(['regular', 'playin', 'playoffs'])

/** Hidden ceilings are not part of the save's player record, so they live alongside it. */
export type { Potentials }

export interface RealOptions {
  /** Career arcs for historical draft classes and the fate slider. Optional: costs 7MB to load. */
  history?: Parameters<typeof classFor>[0] | null
  /** 0 = real careers, 100 = the model decides everything. */
  fate?: number
}

function emptyTotals(): SeasonTotals {
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
function toPlayerRecord(p: LeaguePlayer, bundle: SeasonBundle): PlayerRecord {
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

/** The hooks that turn a bare season loop into a dynasty. */
function buildHooks(
  potentials: Potentials,
  capture: (r: GameResult) => void,
  opts: RealOptions,
  names: NameBank,
): GameHooks {
  const fate = opts.fate ?? 100
  const history = opts.history ?? null

  const engine: SimulateGame = (input, seed) => {
    const result = simulateGame(input, seed)
    capture(result)
    return result
  }

  return {
    engine,

    prospects: ({ yearEnd, count, rng }) => {
      const cls = history
        ? classFor(history, yearEnd, rng, 'historical', names)
        : fictionalClass(yearEnd, rng, { size: count, bank: names })
      return cls.slice(0, count).map((p) => {
        potentials.set(p.prospectId, p.potential)
        return {
          prospectId: p.prospectId,
          name: p.name,
          pos: p.pos,
          age: p.age,
          heightIn: p.heightIn,
          weightLb: p.weightLb,
          ratings: p.ratings,
          tendencies: p.tendencies,
          // The board must rank on what a prospect will become, not on what an 18-year-old is
          // today: without this LeBron slides behind a 24-year-old role player.
          potential: p.potential,
        }
      })
    },

    develop: (state, rng) => {
      const games = state.season.rules.games
      const keep: LeaguePlayer[] = []
      for (const p of state.league.players) {
        // A player drafted moments ago has not played a professional minute, and the retirement
        // check reads minutes as "nobody wants him". Left alone, a quarter of every draft class
        // retired on draft night — including first overall picks — with no message to the team
        // that spent three seasons losing for the pick.
        const neverPlayed = p.debutYear > state.season.yearEnd
        if (neverPlayed) {
          keep.push(p)
          continue
        }
        const stat = state.stats[p.playerId]
        const minutes = stat?.min ?? p.mpgHint * games * 0.6

        // Last season's injuries leave a mark on the serious ones. These are the games he really
        // missed — the season now tracks availability game by game. This used to invent a second,
        // fictional season of absences here, so a man could be hurt in the ledger and healthy on
        // the floor, or punished twice for one bad year.
        const record = state.availability?.[p.playerId]
        const penalty: Partial<Ratings> = {}
        if (record?.injury) {
          for (const [k, v] of Object.entries(lingeringPenalty(record.injury, p.age)))
            penalty[k as keyof Ratings] = (penalty[k as keyof Ratings] ?? 0) + (v ?? 0)
        }

        const arc = history?.careers.find((c) => c.playerId === p.playerId)
        const lastRealYear = arc
          ? arc.seasons.reduce((m, s) => Math.max(m, s.yearEnd), 0)
          : undefined
        if (
          retires({
            age: p.age,
            ratings: p.ratings,
            minutes,
            rng,
            fate,
            yearEnd: state.season.yearEnd,
            ...(lastRealYear !== undefined ? { lastRealYear } : {}),
          })
        )
          continue

        const potential = potentials.get(p.playerId) ?? overall(p.ratings) + 4
        const grown = develop({ ratings: p.ratings, age: p.age, potential, minutes, rng })
        potentials.set(p.playerId, grown.potential)

        // The development coach. He does not invent improvement out of nothing: he scales what the
        // age curve was going to give a young player anyway — x1.0 at a rating of 50, x1.4 at 100,
        // x0.6 at 0 — and only while a man is still young enough to be taught. An old player's
        // decline is his own business.
        const coached = { ...grown.ratings }
        const factor = developmentFactor(state, p.teamId)
        if (factor !== 1 && p.age <= 25) {
          for (const k of RATING_KEYS) {
            const delta = grown.ratings[k] - p.ratings[k]
            if (delta > 0) coached[k] = Math.min(99, p.ratings[k] + delta * factor)
          }
        }

        const hurt = { ...coached }
        for (const [k, v] of Object.entries(penalty))
          hurt[k as keyof Ratings] = Math.max(5, hurt[k as keyof Ratings] + (v ?? 0))

        // The fate slider pulls a real player back toward the career he actually had.
        const realNext = arc?.seasons.find((s) => s.yearEnd === state.season.yearEnd + 1)?.ratings
        p.ratings = blendToFate(hurt, realNext ?? null, fate)
        keep.push(p)
      }
      state.league.players = keep
    },

    // The whole summer lives in market.ts so the automatic path and the interactive one stay
    // identical: rookie-scale deals, a backfill of undrafted players, then the market.
    freeAgency: (state, rng) => {
      runMarket(state, state.season.yearEnd + 1, rng, potentials, [], names)
    },

    /**
     * The league moves through real CBAs as the years pass. Without this the rules froze at
     * whatever season you started in: a 2016 save was still playing a $70M cap with no play-in
     * tournament in 2022, and the aprons never arrived. The era table runs 1998-2027; past its
     * end the last real season's rules stand and only the money grows (DECISIONS, 2026-09-11).
     */
    nextSeason: (yearEnd) => {
      const rules = yearEnd >= ERA_FIRST && yearEnd <= ERA_LAST ? ERA[yearEnd] : undefined
      return rules ? { rules } : null
    },
  }
}

/** "1 rebound", "11 rebounds". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The game package logs team ids. People read names. */
function withTeamNames(state: GameState, text: string): string {
  let out = text
  for (const t of state.league.teams) out = out.replaceAll(t.teamId, `${t.city} ${t.name}`)
  return out
}

/** Sentences for the inbox, from the day's games. */
function newsFor(
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

function standingsFrom(state: GameState): StandingsRow[] {
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
function moodOf(state: GameState, p: LeaguePlayer): PlayerMood {
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
function liveInjury(
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
function clubName(state: GameState, teamId: string): string {
  return state.league.teams.find((t) => t.teamId === teamId)?.name ?? teamId
}

/** Rounds a conference plays before the Finals: three in a sixteen-team field, two in an eight. */
function confRounds(state: GameState): number {
  const slots = Math.max(2, state.season.rules.playoffs.teams / 2)
  return Math.max(1, Math.round(Math.log2(slots)))
}

function confOf(state: GameState, teamId: string): Conference {
  return state.league.teams.find((t) => t.teamId === teamId)?.conference ?? 'East'
}

/** The user's undecided series, whichever round it sits in. Null once he is out. */
function liveSeries(state: GameState, me: string): SeriesState | null {
  for (const round of state.playoffs?.rounds ?? [])
    for (const s of round)
      if (!s.winnerTeamId && (s.highTeamId === me || s.lowTeamId === me)) return s
  return null
}

/** The last series the user played and lost. Null if he never lost one. */
function lostSeries(state: GameState, me: string): SeriesState | null {
  let out: SeriesState | null = null
  for (const round of state.playoffs?.rounds ?? [])
    for (const s of round)
      if (s.winnerTeamId && s.winnerTeamId !== me && (s.highTeamId === me || s.lowTeamId === me))
        out = s
  return out
}

/** Clubs still playing: both sides of a live series, or the winners waiting on the next round. */
function stillAlive(state: GameState): string[] {
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
function playInFixture(
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
function seriesGames(s: SeriesState, me: string): PlayoffPreview['games'] {
  return s.games.map((g) => ({
    gameId: g.gameId,
    date: g.date,
    yourPts: g.homeTeamId === me ? g.homePts : g.awayPts,
    theirPts: g.homeTeamId === me ? g.awayPts : g.homePts,
    home: g.homeTeamId === me,
  }))
}

/** Tonight's fixture for the user, wherever it comes from: the schedule, a series, or a play-in. */
function nextFixture(
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
function postseasonOf(state: GameState, me: string): PostseasonSummary | null {
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

function dynastyOf(
  bundle: SeasonBundle,
  state: GameState,
  potentials: Potentials,
  opts: RealOptions,
  savedBoxes: readonly (readonly [string, GameResult])[] = [],
  resume: { offers: UserOffer[]; marketOpen: boolean; fired?: string[]; marketDay?: number } = {
    offers: [],
    marketOpen: false,
  },
): Dynasty {
  const boxes = new Map<string, GameResult>(savedBoxes as [string, GameResult][])
  // Every box score involving the user's team this season, so his own players have a full game log
  // however long the season runs. Cleared when the league rolls into a new year.
  const userBoxes = new Map<string, GameResult>(savedBoxes as [string, GameResult][])
  // Everything the inbox has been told this season. `news()` used to return only the state's
  // structured log — phase and league events — so a user who simmed a week saw "opening night"
  // and nothing else until the playoffs arrived all at once.
  const feed: NewsItem[] = []
  // The date the beat writers last filed, so the league talks about itself once a week.
  let lastRumourDate = ''
  // Offers the user has placed in the market, resolved when the summer is settled.
  const userOffers = new Map<string, UserOffer>(resume.offers.map((o) => [o.playerId, o]))
  // True once the draft is done and the market has been opened for bidding.
  let marketOpen = resume.marketOpen
  let marketDay = resume.marketDay ?? 0
  // The draft board is cleared when the league rolls into the new season, but the summary screen
  // still has to be able to say who you took — including picks made for you when you pressed
  // "start the season" while you were on the clock.
  let lastPicks: OffseasonState['picks'] = []
  // A scouting report is written once and does not change afterwards. Scouting live off the
  // shrinking board meant a prospect's report improved every time some other team drafted —
  // his confidence climbed from 0.29 to 0.53 while nothing whatever was learned about him.
  const scoutCache = new Map<string, ScoutedView>()
  // Every coach the user has sacked, so the staff screen can point at the man now beating him with
  // somebody else's team. DESIGN-THEMES §3: that is the whole reason the carousel is worth building.
  const firedByUser = new Set<string>(resume.fired ?? [])
  let pending: GameResult[] = []
  // One name bank per save: nobody is handed a name twice, and no invented player is ever
  // confused with a real one (DESIGN-THEMES.md §1 — the name is what people remember).
  const names = new NameBank()
  names.reserve(state.league.players.map((p) => p.name))
  const hooks = buildHooks(potentials, (r) => pending.push(r), opts, names)
  let current = state

  /** Pair the engine's outputs with the day's summaries — they come back in the same order. */
  const absorb = (games: { gameId: string; homeTeamId?: string; awayTeamId?: string }[]): void => {
    for (let i = 0; i < games.length; i++) {
      const r = pending[i]
      const g = games[i]
      if (!r || !g) continue
      boxes.set(g.gameId, r)
      if (g.homeTeamId === current.userTeamId || g.awayTeamId === current.userTeamId)
        userBoxes.set(g.gameId, r)
    }
    pending = []
    if (boxes.size > BOX_CACHE) {
      const drop = boxes.size - BOX_CACHE
      let i = 0
      for (const key of boxes.keys()) {
        if (i++ >= drop) break
        boxes.delete(key)
      }
    }
  }

  const report = (
    results: typeof current.calendar.results,
    date: string,
    interrupt?: DayReport['interrupt'],
  ): DayReport => {
    const games: PlayedGame[] = results.map((g) => ({
      gameId: g.gameId,
      date: g.date,
      homeTeamId: g.homeTeamId,
      awayTeamId: g.awayTeamId,
      homePts: g.homePts,
      awayPts: g.awayPts,
      overtimes: g.overtimes,
    }))
    const items = newsFor(current, games, boxes, current.userTeamId)
    feed.push(...items)
    // A season's worth is plenty; the inbox reads from the end.
    if (feed.length > 400) feed.splice(0, feed.length - 400)
    return interrupt ? { date, games, news: items, interrupt } : { date, games, news: items }
  }

  /** A deterministic rng for an offseason step, so the same save replays the same summer. */
  const rngFor = (tag: string): Rng => {
    let h = current.seed ^ current.season.yearEnd
    for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0
    return makeRng(h)
  }

  const playerName = (id: string): string =>
    current.league.players.find((p) => p.playerId === id)?.name ?? id

  const blankSettings = (): TeamSettings => ({
    tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
    depth: [],
    minutes: {},
    inactive: [],
  })

  const applyComputerLineup = (extraSkip: string[] = []): void => {
    const teamId = current.userTeamId
    const roster = current.league.players.filter((p) => p.teamId === teamId)
    const skip = new Set(extraSkip)
    for (const p of roster) {
      if (availabilityOf(current, p.playerId).out > 0) skip.add(p.playerId)
    }
    for (const id of skip) markInjuryCover(current, id)
    const existing = current.teamSettings[teamId] ?? blankSettings()
    const playoffs = current.phase === 'playoffs' || current.phase === 'playin'
    current.teamSettings[teamId] = autoAdjustSettings(existing, roster, skip, playoffs)
  }

  const swallowLineupHit = (interrupt: SimInterrupt | null | undefined): SimInterrupt | null => {
    if (!interrupt || !current.autoLineup) return interrupt ?? null
    if (interrupt.kind === 'injury') {
      const a = availabilityOf(current, interrupt.playerId)
      a.playingThrough = false
      if (a.out === 0 && a.injury) a.out = Math.max(1, a.injury.games)
      applyComputerLineup([interrupt.playerId])
      return null
    }
    if (interrupt.kind === 'return') {
      applyComputerLineup()
      return null
    }
    return interrupt
  }

  /**
   * One calendar day: games, then the weekly paper, then maybe a live offer that stops Continue.
   * Accepting that offer is executeTrade — it never plays another night.
   */
  const playOneDay = (): DayReport | null => {
    // Once the season is over, Continue stops. The offseason is played through its own screens
    // (offseason / advanceDraft / draftPlayer / makeOffer / finishOffseason) so the draft and the
    // market are the user's to run, not something that happens to him while he is not looking.
    if (!PLAYING.has(current.phase)) return null
    const before = current.calendar.date
    const out = gameSimDay(current, hooks)
    current = out.state
    absorb(out.results)
    if (out.results.length === 0 && current.calendar.date === before) return null

    let offerHit: SimInterrupt | undefined
    if (current.phase === 'regular' && lastRumourDate === '') {
      lastRumourDate = current.calendar.date
    } else if (
      current.phase === 'regular' &&
      daysBetween(lastRumourDate, current.calendar.date) >= 7
    ) {
      lastRumourDate = current.calendar.date
      const ctx = {
        state: current,
        potentials,
        rng: rngFor(`rumours-${current.calendar.date}`),
        nameOf: (teamId) => clubName(current, teamId),
      }
      const talk = weeklyRumours(ctx)
      // A concrete offer lands every few weeks rather than every week, so it stays an event.
      if (ctx.rng.chance(0.35)) {
        const alert = tradeAlert(ctx)
        if (alert) {
          talk.push(alert.item)
          // Injury / return / All-Star / champion already stopped the week. An offer waits its turn.
          if (!out.interrupt) {
            offerHit = {
              kind: 'offer',
              otherTeamId: alert.offer.other.teamId,
              otherName: clubName(current, alert.offer.other.teamId),
              user: alert.offer.user,
              other: alert.offer.other,
              theyWant: alert.offer.user.players.map(playerName),
              theyGive: alert.offer.other.players.map(playerName),
              theyWantPicks: alert.offer.user.picks.length,
              theyGivePicks: alert.offer.other.picks.length,
              reason: alert.assessment.reason,
              net: alert.assessment.net,
            }
          }
        }
      }
      feed.push(...talk)
    }

    // Skip AI-AI business on a day we paused for an offer, so the packages on the table still exist.
    if (
      !offerHit &&
      current.phase === 'regular' &&
      current.calendar.next > 0 &&
      current.calendar.next % 90 === 0
    ) {
      for (const deal of aiTradeRound(
        current,
        potentials,
        rngFor(`trades-${current.calendar.date}`),
      ))
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'trade',
          text: deal.text,
        })
    }

    const interrupt = swallowLineupHit((out.interrupt as SimInterrupt | null) ?? offerHit)
    return report(out.results, current.calendar.date, interrupt ?? undefined)
  }

  /** The lottery, then the board. Safe to call repeatedly. */
  const ensureDraftOpen = (): void => {
    if (current.phase === 'lottery') {
      const out = gameSimDay(current, hooks)
      current = out.state
    }
    if (current.phase === 'draft' && current.draft) openDraft(current, hooks, rngFor('board'))
  }

  /**
   * Close the books on last season and open the market: ages, contracts and development happen
   * here, then rookie deals and the undrafted backfill, so what the user sees is the real pool.
   */
  const openMarket = (): void => {
    if (marketOpen) return
    const rng = rngFor('rollover')
    rolloverBegin(current, hooks, rng)
    const yearEnd = current.season.yearEnd + 1
    signRookies(current, yearEnd)
    backfillPool(current, yearEnd, rng, potentials)
    marketOpen = true
  }

  const clubName = (teamId: string): string => {
    const t = current.league.teams.find((x) => x.teamId === teamId)
    return t ? `${t.city} ${t.name}` : teamId
  }

  const logSigning = (playerId: string, amount: number, years: number, teamId: string): void => {
    const name = current.league.players.find((p) => p.playerId === playerId)?.name ?? playerId
    const yours = teamId === current.userTeamId
    current.log.push({
      date: current.calendar.date,
      yearEnd: current.season.yearEnd,
      kind: 'signing',
      text: yours
        ? `Signed ${name} for $${(amount / 1_000_000).toFixed(1)}M over ${years} year${years === 1 ? '' : 's'}`
        : `${name} signed with ${clubName(teamId)}`,
    })
  }

  /** One day of the market. Ready bids land; everyone else takes a round. */
  const stepMarket = (): void => {
    if (!marketOpen) openMarket()
    marketDay++
    const yearEnd = current.season.yearEnd + 1
    const outcome = runMarketDay(current, yearEnd, rngFor(`market-${marketDay}`), potentials, [
      ...userOffers.values(),
    ])
    userOffers.clear()
    for (const o of outcome.pending) userOffers.set(o.playerId, o)
    const stolenIds = new Set(outcome.stolen.map((x) => x.playerId))
    let quiet = 0
    for (const s of outcome.signings) {
      if (stolenIds.has(s.playerId) || s.teamId === current.userTeamId) continue
      const p = current.league.players.find((x) => x.playerId === s.playerId)
      if (p && overall(p.ratings) >= 58) logSigning(s.playerId, s.amount, s.years, s.teamId)
      else quiet++
    }
    if (quiet > 0)
      current.log.push({
        date: current.calendar.date,
        yearEnd: current.season.yearEnd,
        kind: 'signing',
        text: `${quiet} other deal${quiet === 1 ? '' : 's'} around the league`,
      })
    // Your own outcomes last, so they sit at the top of the wire instead of falling off it
    // when the rest of the league signs twenty men in a day.
    for (const miss of outcome.rejected)
      current.log.push({
        date: current.calendar.date,
        yearEnd: current.season.yearEnd,
        kind: 'signing',
        text: `No deal for ${miss.name}: ${miss.reason}`,
      })
    for (const s of outcome.stolen)
      current.log.push({
        date: current.calendar.date,
        yearEnd: current.season.yearEnd,
        kind: 'signing',
        text: `${s.name} signed with ${clubName(s.teamId)} — they beat your offer`,
      })
    for (const s of outcome.signings) {
      if (s.teamId === current.userTeamId) logSigning(s.playerId, s.amount, s.years, s.teamId)
    }
  }

  const offseasonView = (): OffseasonState => {
    const yearEnd = current.season.yearEnd
    const draft = current.draft
    if (draft?.picks.length)
      lastPicks = draft.picks.map((p) => ({
        overall: p.overall,
        round: p.round,
        teamId: p.teamId,
        prospectId: p.prospectId,
        name: p.name,
      }))
    const clock = onTheClock(current)
    const phase: OffseasonState['phase'] = PLAYING.has(current.phase)
      ? 'done'
      : marketOpen
        ? 'freeagency'
        : current.phase === 'lottery'
          ? 'lottery'
          : 'draft'

    // The board is shown through your scouts, never as it really is. Each man is scouted once, at
    // his standing in the class as published, and that report is kept: scouting live off the
    // shrinking board meant a prospect's numbers improved every time another team drafted, with
    // nothing whatever having been learned about him.
    const board: ScoutedView[] = marketOpen
      ? []
      : (draft?.board ?? []).slice(0, 60).map((p, i) => {
          const cached = scoutCache.get(p.prospectId)
          if (cached) return cached
          // A per-prospect seed, so the same man always scouts the same way in this save.
          let h = current.seed ^ yearEnd
          for (let c = 0; c < p.prospectId.length; c++)
            h = (h * 31 + p.prospectId.charCodeAt(c)) | 0
          const seen = scout(
            {
              ...p,
              potential: potentials.get(p.prospectId) ?? overall(p.ratings) + 5,
              realPick: null,
              playerId: null,
              origin: 'fictional',
            },
            // Your own head scout, not a hardcoded 65. A 90-rated department reports a lottery
            // prospect to within ~3.3 rating points; a 30-rated one is out by ~8.5.
            scoutingOf(current, current.userTeamId),
            makeRng(h),
            // Where he stands in the published class, not in what is left of it.
            (draft?.next ?? 0) + i + 1,
          )
          const view: ScoutedView = {
            prospectId: p.prospectId,
            name: p.name,
            pos: p.pos,
            age: p.age,
            heightIn: p.heightIn,
            ratings: seen.ratings as unknown as Record<string, number>,
            overall: Math.round(overall(seen.ratings)),
            potentialLow: seen.potentialLow,
            potentialHigh: seen.potentialHigh,
            confidence: seen.confidence,
          }
          scoutCache.set(p.prospectId, view)
          return view
        })

    const marketYear = yearEnd + 1
    const freeAgents = marketOpen
      ? freeAgentPool(current, marketYear, potentials)
          .map((fa) => {
            // His price to *you*: a man you left on the bench wants paying for the year.
            const ask = askingFrom(current, fa, current.userTeamId)
            const offer = userOffers.get(fa.playerId)
            return {
              playerId: fa.playerId,
              name: fa.name,
              pos: current.league.players.find((p) => p.playerId === fa.playerId)?.pos ?? 'SF',
              age: fa.age,
              overall: Math.round(overall(fa.ratings)),
              asking: ask.amount,
              askingYears: ask.years,
              offer: offer ? { amount: offer.amount, years: offer.years } : null,
              incumbentTeamId: fa.incumbentTeamId,
            }
          })
          .sort((a, b) => b.overall - a.overall)
          .slice(0, 120)
      : []

    return {
      phase,
      yearEnd,
      picks: draft?.picks.length
        ? draft.picks.map((p) => ({
            overall: p.overall,
            round: p.round,
            teamId: p.teamId,
            prospectId: p.prospectId,
            name: p.name,
          }))
        : lastPicks,
      onTheClock: clock
        ? {
            overall: clock.overall,
            round: clock.round,
            teamId: clock.teamId,
            prospectId: clock.prospectId,
            name: clock.name,
          }
        : null,
      yourPick: clock?.teamId === current.userTeamId,
      board,
      freeAgents,
      finance:
        marketOpen || phase !== 'done'
          ? financeOf(current.userTeamId, marketOpen ? marketYear : yearEnd)
          : null,
      news: current.log.slice(-25).map((e, i) => ({
        id: `off-${yearEnd}-${i}`,
        date: e.date,
        kind: e.kind === 'phase' ? ('system' as const) : ('league' as const),
        headline: withTeamNames(current, e.text),
        body: '',
      })),
    }
  }

  /**
   * Shared by the finance view and the offseason screen. `yearEnd` is a parameter because once the
   * market opens the rollover has already moved every contract on a year: the payroll that matters
   * then is next season's, not the one just played.
   */
  const financeOf = (teamId: string, yearEnd = current.season.yearEnd): TeamFinance => {
    const squad = current.league.players.filter((p) => p.teamId === teamId)
    const rules = current.season.rules
    const salaries = salariesFor(
      squad.map((p) => ({ playerId: p.playerId, contract: p.contract })),
      yearEnd,
    )
    const payrollAmt = salaries.reduce((t, x) => (x.kind === 'two_way' ? t : t + x.amount), 0)
    const deadCap = (current.deadMoney ?? [])
      .filter((d) => d.teamId === teamId && d.yearEnd === yearEnd)
      .reduce((t, d) => t + d.amount, 0)
    const bills = seasonTaxBills(current, yearEnd)
    const mine = bills.find((b) => b.teamId === teamId)
    return {
      teamId,
      payroll: payrollAmt + deadCap,
      cap: rules.cap,
      taxLine: rules.tax_line ?? rules.cap,
      apron1: rules.apron_1,
      apron2: rules.apron_2,
      roster: squad.length,
      rosterMin: rules.roster_min,
      rosterMax: rules.roster_max,
      rosterActive: rules.roster_active,
      deadCap,
      taxBill: mine?.bill ?? 0,
      repeater: mine?.repeater ?? false,
    }
  }

  const listedOf = (): string[] => {
    const mine = new Set(
      current.league.players.filter((p) => p.teamId === current.userTeamId).map((p) => p.playerId),
    )
    return (current.listed ?? []).filter((id) => mine.has(id))
  }

  const deskOf = (playerId: string): PlayerDesk | null => {
    const p = current.league.players.find((x) => x.playerId === playerId)
    if (!p) return null
    const yours = p.teamId === current.userTeamId
    const listed = yours && listedOf().includes(playerId)
    const offers = listed
      ? incomingOffers(
          current,
          potentials,
          makeRng(current.seed ^ current.calendar.results.length ^ playerId.length),
          6,
          playerId,
        )
      : []
    const names: Record<string, string> = {}
    for (const o of offers) {
      for (const id of [...o.user.players, ...o.other.players]) {
        const n = current.league.players.find((x) => x.playerId === id)?.name
        if (n) names[id] = n
      }
    }
    const rules = current.season.rules
    const yearEnd = current.season.yearEnd
    const remaining = p.contract?.years.filter((y) => y.yearEnd >= yearEnd) ?? []
    const hasNext = p.contract?.years.some((y) => y.yearEnd === yearEnd + 1) ?? false
    const out = wantsOut(moraleValue(current, playerId))
    const ask = askingToStay(current, p, potentials)
    let kind: PlayerDesk['contract']['kind'] = 'none'
    if (yours && marketOpen && !hasNext) kind = 'fa'
    else if (yours && remaining.length > 0 && remaining.length < 5) kind = 'extend'
    const rosterCount = current.league.players.filter((x) => x.teamId === current.userTeamId).length
    const cut = yours ? canWaive(rosterCount, rules) : null
    return {
      playerId,
      yours,
      listed,
      offers,
      names,
      waive: cut,
      contract: {
        kind: out && kind !== 'none' ? 'none' : kind,
        asking: ask.amount,
        askingYears: ask.years,
        max: maxSalary(rules, p.yearsPro),
        min: minSalary(rules, p.yearsPro),
        offer: userOffers.get(playerId) ?? null,
        reason: out ? 'He will not re-sign here, whatever you offer.' : null,
      },
    }
  }

  // ── The league as a spectacle ────────────────────────────────────────────

  /** A player must have played this share of his team's games to hold a leaderboard place. */
  const QUALIFY = 0.55

  /** A per-game rate from a season line. `key` is any counting stat on it. */
  const perGame = (line: SeasonStatLine, key: keyof SeasonStatLine): number =>
    line.gp > 0 ? ((line[key] as number) ?? 0) / line.gp : 0

  const leaderRows = (): LeaderRow[] => {
    const byId = new Map(current.league.players.map((p) => [p.playerId, p]))
    const rows: LeaderRow[] = []
    for (const [playerId, line] of Object.entries(current.stats)) {
      const p = byId.get(playerId)
      if (!p || line.gp === 0) continue
      const record = current.records[line.teamId]
      const teamGames = record ? record.wins + record.losses : 82
      if (teamGames > 20 && line.gp < teamGames * QUALIFY) continue
      rows.push({
        playerId,
        name: p.name,
        teamId: line.teamId,
        pos: p.pos,
        gp: line.gp,
        value: 0,
        pts: perGame(line, 'pts'),
        reb: perGame(line, 'oreb') + perGame(line, 'dreb'),
        ast: perGame(line, 'ast'),
        min: perGame(line, 'min'),
      })
    }
    return rows
  }

  const statValue = (category: StatCategory, line: SeasonStatLine): number => {
    switch (category) {
      case 'reb':
        return perGame(line, 'oreb') + perGame(line, 'dreb')
      case 'fgPct':
        return line.fga > 0 ? line.fgm / line.fga : 0
      case 'fg3Pct':
        return line.fg3a > 0 ? line.fg3m / line.fg3a : 0
      case 'ftPct':
        return line.fta > 0 ? line.ftm / line.fta : 0
      case 'tsPct': {
        // True shooting: points per shooting possession, free throws included.
        const shots = 2 * (line.fga + 0.44 * line.fta)
        return shots > 0 ? line.pts / shots : 0
      }
      default:
        return perGame(line, category as keyof SeasonStatLine)
    }
  }

  /**
   * Percentage categories need real volume behind them. A per-game ratio alone is not enough:
   * fifteen games into a season it let a man who had taken nine free throws lead the league at
   * 1.000. So both a rate and an absolute floor, the absolute one scaled to how far the season
   * has actually gone.
   */
  const volumeFloor = (category: StatCategory, line: SeasonStatLine, gp: number): boolean => {
    const seasonGames = current.season.rules.games || 82
    const played = Math.max(...Object.values(current.records).map((r) => r.wins + r.losses), 1)
    const through = Math.min(1, played / seasonGames)
    if (category === 'fgPct' || category === 'tsPct')
      return line.fga >= gp * 6 && line.fga >= Math.round(300 * through)
    if (category === 'fg3Pct') return line.fg3a >= gp * 1.5 && line.fg3a >= Math.round(82 * through)
    if (category === 'ftPct') return line.fta >= gp * 1.5 && line.fta >= Math.round(125 * through)
    return true
  }

  const scoreCandidates = (limit: number): AwardRace => {
    const all = candidates(current)
    const byId = new Map(current.league.players.map((p) => [p.playerId, p]))
    const toCandidate = (list: typeof all, key: 'mvp' | 'mvpVote' | 'dpoy'): AwardCandidate[] => {
      const top = [...list].sort((a, b) => b[key] - a[key]).slice(0, limit)
      // Vote share among the shortlist, so the gap between first and second is visible.
      const total = top.reduce((acc, c) => acc + Math.max(0, c[key]), 0) || 1
      return top.map((c) => {
        const line = current.stats[c.playerId]
        const record = current.records[c.teamId]
        const player = byId.get(c.playerId)
        return {
          playerId: c.playerId,
          name: c.name,
          teamId: c.teamId,
          pos: player?.pos ?? c.pos,
          share: Math.max(0, c[key]) / total,
          gp: c.gp,
          pts: line ? perGame(line, 'pts') : 0,
          reb: line ? perGame(line, 'oreb') + perGame(line, 'dreb') : 0,
          ast: line ? perGame(line, 'ast') : 0,
          teamWins: record?.wins ?? 0,
          teamLosses: record?.losses ?? 0,
        }
      })
    }
    return {
      mvp: toCandidate(all, 'mvpVote'),
      roy: toCandidate(
        all.filter((c) => c.rookie),
        'mvp',
      ),
      dpoy: toCandidate(all, 'dpoy'),
    }
  }

  return {
    getState(): DynastyState {
      const total = current.calendar.schedule.length
      const played = current.calendar.next
      const next = current.calendar.schedule[played]?.date ?? null
      return {
        yearEnd: current.season.yearEnd,
        seasonId: current.season.seasonId,
        userTeamId: current.userTeamId,
        seed: current.seed,
        date: current.calendar.date,
        nextGameDate: next,
        gamesPlayed: played,
        gamesTotal: total,
        seasonComplete: !PLAYING.has(current.phase),
        autoLineup: Boolean(current.autoLineup),
      }
    },

    teams: () =>
      current.league.teams.map((t) => ({
        teamId: t.teamId,
        abbr: t.abbr,
        name: t.name,
        city: t.city,
        conference: t.conference,
        division: t.division,
        real: bundle.teams.find((b) => b.teamId === t.teamId)?.real ?? {
          wins: 0,
          losses: 0,
          playoffSeed: null,
        },
      })),

    simDay() {
      return playOneDay()
    },

    simToDate(isoDate, onDay) {
      const reports: DayReport[] = []
      let index = 0
      // Same door as Continue: rumours, incoming offers, AI-AI trades. A Sim to date that
      // skipped this used to walk past a live offer while the rest of the league moved.
      while (current.calendar.date <= isoDate && PLAYING.has(current.phase)) {
        const r = playOneDay()
        if (!r) break
        reports.push(r)
        const cont = onDay?.(r, index++)
        if (r.interrupt || cont === false) break
      }
      return reports
    },

    standings: () => standingsFrom(current),
    boxScore: (gameId) => userBoxes.get(gameId) ?? boxes.get(gameId) ?? null,

    gameLog(playerId, limit = 120): GameLogRow[] {
      const rows: GameLogRow[] = []
      const teamId = current.league.players.find((p) => p.playerId === playerId)?.teamId
      const dnpRow = (
        g: (typeof current.calendar.results)[number],
        home: boolean,
        seasonType: NonNullable<GameLogRow['seasonType']>,
      ): GameLogRow => {
        const teamPts = home ? g.homePts : g.awayPts
        const opponentPts = home ? g.awayPts : g.homePts
        return {
          gameId: g.gameId,
          date: g.date,
          opponentTeamId: home ? g.awayTeamId : g.homeTeamId,
          home,
          won: teamPts > opponentPts,
          teamPts,
          opponentPts,
          started: false,
          seasonType,
          dnp: true,
          line: emptyStatLine(),
        }
      }
      // Newest first. A box is the full line; playoff summaries still carry pts/reb/ast/min
      // after the box cache has moved on, so a playoff card does not go blank in June.
      for (let i = current.calendar.results.length - 1; i >= 0 && rows.length < limit; i--) {
        const g = current.calendar.results[i]
        if (!g) continue
        const seasonType = g.seasonType ?? 'regular'
        const hisTeam = Boolean(teamId && (g.homeTeamId === teamId || g.awayTeamId === teamId))
        const box = userBoxes.get(g.gameId) ?? boxes.get(g.gameId)
        if (box) {
          const inHome = box.home.players.some((p) => p.playerId === playerId)
          const inAway = box.away.players.some((p) => p.playerId === playerId)
          if (inHome || inAway) {
            const side = inHome ? box.home : box.away
            const line = side.players.find((p) => p.playerId === playerId)
            if (!line) continue
            const opponent = inHome ? box.away : box.home
            rows.push({
              gameId: g.gameId,
              date: g.date,
              opponentTeamId: opponent.teamId,
              home: inHome,
              won: side.pts > opponent.pts,
              teamPts: side.pts,
              opponentPts: opponent.pts,
              started: line.starter,
              seasonType,
              line: {
                min: line.min,
                pts: line.pts,
                fgm: line.fgm,
                fga: line.fga,
                fg3m: line.fg3m,
                fg3a: line.fg3a,
                ftm: line.ftm,
                fta: line.fta,
                oreb: line.oreb,
                dreb: line.dreb,
                ast: line.ast,
                stl: line.stl,
                blk: line.blk,
                tov: line.tov,
                pf: line.pf,
              },
            })
            continue
          }
          if (hisTeam) rows.push(dnpRow(g, g.homeTeamId === teamId, seasonType))
          continue
        }
        const thin = g.players?.find((p) => p.playerId === playerId)
        if (thin && thin.min > 0) {
          const home = g.homeTeamId === thin.teamId
          const teamPts = home ? g.homePts : g.awayPts
          const opponentPts = home ? g.awayPts : g.homePts
          const line = emptyStatLine()
          line.min = thin.min
          line.pts = thin.pts
          line.dreb = thin.reb
          line.ast = thin.ast
          rows.push({
            gameId: g.gameId,
            date: g.date,
            opponentTeamId: home ? g.awayTeamId : g.homeTeamId,
            home,
            won: teamPts > opponentPts,
            teamPts,
            opponentPts,
            started: false,
            seasonType,
            thin: true,
            line,
          })
          continue
        }
        if (hisTeam && seasonType !== 'regular') rows.push(dnpRow(g, g.homeTeamId === teamId, seasonType))
      }
      return rows
    },

    schedule(teamId) {
      const played = new Map(current.calendar.results.map((r) => [r.gameId, r]))
      // Playoff games are never on the schedule — they are created as the bracket resolves — so
      // they are folded in from the results, or a finished season ends on its last April fixture.
      const scheduled = new Set(current.calendar.schedule.map((g) => g.gameId))
      const extra = current.calendar.results
        .filter((r) => !scheduled.has(r.gameId))
        .map((r) => ({
          gameId: r.gameId,
          date: r.date,
          homeTeamId: r.homeTeamId,
          awayTeamId: r.awayTeamId,
          seasonType: r.seasonType,
          real: null,
        }))
      return [...current.calendar.schedule, ...extra]
        .filter((g) => !teamId || g.homeTeamId === teamId || g.awayTeamId === teamId)
        .map((g): ScheduleEntry => {
          const r = played.get(g.gameId)
          return {
            gameId: g.gameId,
            date: g.date,
            homeTeamId: g.homeTeamId,
            awayTeamId: g.awayTeamId,
            result: r ? { homePts: r.homePts, awayPts: r.awayPts, overtimes: r.overtimes } : null,
          }
        })
    },

    roster(teamId) {
      return current.league.players
        .filter((p) => p.teamId === teamId)
        .map((p): RosterRow => {
          const stat = current.stats[p.playerId]
          const contractYear = p.contract?.years.find((y) => y.yearEnd === current.season.yearEnd)
          const injury = liveInjury(current, p.playerId)
          return {
            player: toPlayerRecord(p, bundle),
            mood: moodOf(current, p),
            // Your own players show their ceiling; everyone else's is their own business.
            card: ratingCard(
              p.ratings,
              p.tendencies,
              p.pos,
              teamId === current.userTeamId ? (potentials.get(p.playerId) ?? null) : null,
            ),
            totals: stat ? { ...emptyTotals(), ...stat } : emptyTotals(),
            salary: contractYear?.amount ?? null,
            contractYears:
              p.contract?.years.filter((y) => y.yearEnd >= current.season.yearEnd).length ?? 0,
            injuryHint: injuryOutlook(
              p.ratings.durability,
              p.age,
              p.yearsPro,
              careerOf(current, p.playerId)?.seasons.at(-1)?.gp,
              current.teamSettings[teamId]?.minutes[p.playerId],
              current.season.rules.games,
            ),
            injuryRisk: injuryRisk(
              p.ratings.durability,
              p.age,
              p.yearsPro,
              careerOf(current, p.playerId)?.seasons.at(-1)?.gp,
              current.teamSettings[teamId]?.minutes[p.playerId],
              current.season.rules.games,
            ),
            ...(injury ? { injury } : {}),
          }
        })
        .sort((a, b) => (b.totals.min || b.player.realMpg) - (a.totals.min || a.player.realMpg))
    },

    finance: (teamId) => financeOf(teamId),

    squadMood(teamId): SquadMoodView {
      const m = gameSquadMood(current, teamId)
      return {
        teamId: m.teamId,
        average: m.average,
        label: m.label,
        unhappy: m.unhappy,
        worst: m.worst.map((w) => ({
          playerId: w.playerId,
          name: w.name,
          value: w.value,
          role: w.role,
          why: w.why,
        })),
        summary: m.summary,
      }
    },

    news(limit = 40) {
      // Two sources: the league's structured log (phases, awards, trades, signings, injuries) and
      // the sentences written about the games as they were played.
      //
      // The mix matters as much as the content. Thirty clubs produce a steady drizzle of minor
      // injuries, and left alone that drizzle is the entire inbox — an unreadable wall of other
      // people's ankles. So items are ranked: anything about your club first, then the talk of the
      // league, then serious news from elsewhere, and only then the rest.
      const mine = current.userTeamId
      const myTeam = current.league.teams.find((t) => t.teamId === mine)
      const myNames = new Set(
        current.league.players.filter((p) => p.teamId === mine).map((p) => p.name),
      )
      const aboutMe = (text: string): boolean => {
        if (myTeam && (text.includes(myTeam.name) || text.includes(myTeam.city))) return true
        for (const name of myNames) if (text.includes(name)) return true
        return false
      }
      /** Games missed, when a line reports an absence. */
      const outFor = (text: string): number => {
        const m = /out (\d+) games/.exec(text)
        return m ? Number(m[1]) : 0
      }

      const fromLog: { item: NewsItem; rank: number }[] = current.log.slice(-300).map((e, i) => {
        const text = withTeamNames(current, e.text)
        const absence = outFor(text)
        let rank = 2
        if (aboutMe(text)) rank = 0
        else if (e.kind === 'phase' || e.kind === 'award' || e.kind === 'draft') rank = 1
        else if (absence >= 20) rank = 2
        else if (absence > 0) rank = 4
        else rank = 3
        return {
          rank,
          item: {
            id: `log-${i}-${e.date}`,
            date: e.date,
            kind: e.kind === 'phase' ? 'system' : 'league',
            headline: text,
            body: '',
          },
        }
      })

      // The beat writers' work and the game reports are always worth reading.
      const fromFeed = feed.map((item) => ({
        item,
        rank: item.kind === 'offer' ? 0 : item.kind === 'result' ? 0 : 1,
      }))

      const merged = [...fromLog, ...fromFeed]
      merged.sort((a, b) => {
        if (a.item.date !== b.item.date) return a.item.date < b.item.date ? 1 : -1
        return a.rank - b.rank
      })
      // Within the window, keep the important things and let the drizzle fill what is left.
      const kept = merged.filter((x) => x.rank <= 2).slice(0, limit)
      if (kept.length < limit) {
        for (const x of merged) {
          if (kept.length >= limit) break
          if (x.rank > 2) kept.push(x)
        }
        kept.sort((a, b) => (a.item.date < b.item.date ? 1 : a.item.date > b.item.date ? -1 : 0))
      }
      return kept.map((x) => x.item)
    },

    // ── Tactics and the depth chart ──────────────────────────────────────────

    getPlan(teamId): TeamPlan {
      const s = current.teamSettings[teamId]
      return {
        tactics: s?.tactics ?? { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
        depth: s?.depth ?? [],
        minutes: s?.minutes ?? {},
        inactive: s?.inactive ?? [],
        lineup: s?.lineup ?? {},
        lineups: s?.lineups ?? {},
        unitTactics: s?.unitTactics ?? {},
        system: s?.system ?? 'balanced',
        instructions: s?.instructions ?? {},
        rest: s?.rest ?? {},
        sitNext: s?.sitNext ?? [],
      }
    },

    setPlan(teamId, plan) {
      const existing: TeamSettings = current.teamSettings[teamId] ?? {
        tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
        depth: [],
        minutes: {},
        inactive: [],
      }
      // A lineup slot set to an empty string means "empty that slot", which is how the screen
      // clears one without having to send a different message.
      const lineup = plan.lineup
        ? Object.fromEntries(Object.entries(plan.lineup).filter(([, id]) => !!id))
        : (existing.lineup ?? {})
      const lineups = plan.lineups !== undefined ? normaliseLineups(plan.lineups) : existing.lineups
      const unitTactics =
        plan.unitTactics !== undefined
          ? normaliseUnitTactics(plan.unitTactics)
          : existing.unitTactics
      // The same for instructions: a neutral instruction is simply dropped, so a plan the manager
      // has reset is stored as nothing at all and the save stays small.
      const instructions = plan.instructions
        ? Object.fromEntries(
            Object.entries(plan.instructions)
              .map(([id, i]) => [id, normaliseInstruction(i)] as const)
              .filter(([, i]) => !isNeutralInstruction(i)),
          )
        : (existing.instructions ?? {})
      const next: TeamSettings = {
        tactics: plan.tactics ?? existing.tactics,
        depth: plan.depth ?? existing.depth,
        minutes: plan.minutes ?? existing.minutes,
        inactive: plan.inactive ?? existing.inactive,
        lineup,
        system: plan.system ?? existing.system ?? 'balanced',
        instructions,
      }
      if (lineups) next.lineups = lineups
      if (unitTactics) next.unitTactics = unitTactics
      const rest = plan.rest !== undefined ? plan.rest : existing.rest
      if (rest && Object.keys(rest).length) next.rest = rest
      const sitNext = plan.sitNext !== undefined ? plan.sitNext : existing.sitNext
      if (sitNext?.length) next.sitNext = sitNext
      current.teamSettings[teamId] = next
    },

    resolveInjury(playerId, choice) {
      const p = current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== current.userTeamId) return
      const a = availabilityOf(current, playerId)
      if (choice === 'playThrough') {
        if (!a.injury || !isWarning(a.injury)) return
        a.out = 0
        a.playingThrough = true
        return
      }
      if (choice === 'restore') {
        a.playingThrough = false
        applyComputerLineup()
        return
      }
      a.playingThrough = false
      if (a.out === 0 && a.injury) a.out = Math.max(1, a.injury.games)
      applyComputerLineup([playerId])
    },

    setAutoLineup(on) {
      current.autoLineup = on
    },

    sitTonight(playerId, sit) {
      const p = current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== current.userTeamId) return
      const existing: TeamSettings = current.teamSettings[current.userTeamId] ?? {
        tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
        depth: [],
        minutes: {},
        inactive: [],
      }
      const held = new Set(existing.sitNext ?? [])
      if (sit) held.add(playerId)
      else held.delete(playerId)
      current.teamSettings[current.userTeamId] = { ...existing, sitNext: [...held] }
    },

    // ── Trades ───────────────────────────────────────────────────────────────

    tradeBlock: (teamId) => tradeBlock(current, teamId, potentials),

    assessTrade: (user, other) => assess(current, user, other, potentials),

    executeTrade(user, other): TradeAssessment {
      const verdict = assess(current, user, other, potentials)
      if (verdict.legal && verdict.accepted) {
        applyTrade(current, user, other)
        const names = (pack: TradePackage) =>
          pack.players
            .map((id) => current.league.players.find((p) => p.playerId === id)?.name ?? id)
            .join(', ')
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'trade',
          text: `Trade: ${names(user)} to ${current.league.teams.find((t) => t.teamId === other.teamId)?.name ?? other.teamId} for ${names(other)}`,
        })
      }
      return verdict
    },

    incomingOffers: (limit = 6) =>
      incomingOffers(
        current,
        potentials,
        makeRng(current.seed ^ current.calendar.results.length),
        limit,
      ),

    listedOnBlock: () => listedOf(),

    listOnBlock(playerId, on): PlayerDesk | null {
      const p = current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== current.userTeamId) return deskOf(playerId)
      const next = new Set(listedOf())
      if (on) next.add(playerId)
      else next.delete(playerId)
      current.listed = [...next]
      return deskOf(playerId)
    },

    playerDesk: (playerId) => deskOf(playerId),

    waivePlayer(playerId) {
      const res = applyWaive(current, playerId)
      return { ...res, desk: deskOf(playerId) }
    },

    inSeasonFreeAgents(): FreeAgentView[] {
      if (!PLAYING.has(current.phase)) return []
      const rules = current.season.rules
      return unsignedPool(current)
        .map((p) => ({
          playerId: p.playerId,
          name: p.name,
          pos: p.pos,
          age: p.age,
          overall: Math.round(overall(p.ratings)),
          asking: minSalary(rules, p.yearsPro),
          askingYears: 1,
          offer: null,
          incumbentTeamId: null,
        }))
        .sort((a, b) => b.overall - a.overall)
        .slice(0, 40)
    },

    signFreeAgent(playerId) {
      if (!PLAYING.has(current.phase))
        return { ok: false, message: 'Signings in the summer go through free agency.' }
      return applySignMinimum(current, playerId)
    },

    extendContract(playerId, amount, years) {
      const res = extendPlayer(current, playerId, amount, years, potentials)
      return { ...res, desk: deskOf(playerId) }
    },

    picksOf: (teamId: string) => picksOf(current, teamId),

    // ── The staff ────────────────────────────────────────────────────────────

    staff: (teamId) => staffView(current, teamId ?? current.userTeamId, firedByUser),

    hireCoach(coachId, role, years, salary) {
      const me = current.userTeamId
      const res = hire(current, me, coachId, role, years, salary)
      if (res.ok) {
        firedByUser.delete(coachId)
        // A new head scout writes new reports. The cache exists so a report does not improve every
        // time somebody else drafts; a change of scout is a real change in who is looking.
        if (role === 'scout') scoutCache.clear()
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'contract',
          text: res.message,
        })
      }
      return { ok: res.ok, message: res.message, view: staffView(current, me, firedByUser) }
    },

    fireCoach(role) {
      const me = current.userTeamId
      const before = current.staff ? staffView(current, me, firedByUser) : null
      const sacked = before?.slots.find((s) => s.role === role)?.coach?.coachId ?? null
      const res = fire(current, me, role)
      if (res.ok) {
        if (sacked) firedByUser.add(sacked)
        if (role === 'scout') scoutCache.clear()
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'contract',
          text: res.message,
        })
      }
      return { ok: res.ok, message: res.message, view: staffView(current, me, firedByUser) }
    },

    // ── The offseason ────────────────────────────────────────────────────────

    offseason(): OffseasonState | null {
      if (PLAYING.has(current.phase)) return null
      return offseasonView()
    },

    advanceDraft(): OffseasonState {
      ensureDraftOpen()
      if (current.phase === 'draft' && current.draft) {
        runDraft(current, hooks, rngFor('draft'), current.userTeamId)
        if (current.draft.done) openMarket()
      }
      return offseasonView()
    },

    draftPlayer(prospectId): OffseasonState {
      ensureDraftOpen()
      const clock = onTheClock(current)
      if (clock?.teamId === current.userTeamId) {
        const taken = makePick(current, prospectId)
        if (taken)
          current.log.push({
            date: current.calendar.date,
            yearEnd: current.season.yearEnd,
            kind: 'draft',
            text: `You take ${taken.name} at ${clock.overall}`,
          })
        // Then the rest of the room picks until you are up again.
        runDraft(current, hooks, rngFor('draft'), current.userTeamId)
        if (current.draft?.done) openMarket()
      }
      return offseasonView()
    },

    makeOffer(playerId, amount, years): OffseasonState {
      if (marketOpen) {
        userOffers.set(playerId, { playerId, amount, years })
        const yearEnd = current.season.yearEnd + 1
        const fa = freeAgentPool(current, yearEnd, potentials).find((p) => p.playerId === playerId)
        if (fa) {
          const ask = askingFrom(current, fa, current.userTeamId)
          if (amount + 1 >= ask.amount) stepMarket()
        }
      }
      return offseasonView()
    },

    withdrawOffer(playerId): OffseasonState {
      userOffers.delete(playerId)
      return offseasonView()
    },

    advanceMarket(): OffseasonState {
      if (current.phase === 'draft' && current.draft && !current.draft.done) return offseasonView()
      stepMarket()
      return offseasonView()
    },

    finishOffseason(): OffseasonState {
      // Anything still unplayed in the offseason happens now: an unfinished draft, then the market.
      ensureDraftOpen()
      if (current.phase === 'draft' && current.draft && !current.draft.done) {
        runDraft(current, hooks, rngFor('draft'))
        // Snapshot the finished board before the rollover clears it, so the summary can still
        // show what you took.
        lastPicks = current.draft.picks.map((p) => ({
          overall: p.overall,
          round: p.round,
          teamId: p.teamId,
          prospectId: p.prospectId,
          name: p.name,
        }))
        // Log your own picks, whoever made them: the summary is built from these.
        for (const pick of current.draft.picks)
          if (pick.teamId === current.userTeamId && pick.name)
            current.log.push({
              date: current.calendar.date,
              yearEnd: current.season.yearEnd,
              kind: 'draft',
              text: `Drafted ${pick.name} at ${pick.overall}`,
            })
        openMarket()
      }
      if (!marketOpen) openMarket()
      const rng = rngFor('market')
      const outcome = runMarket(current, current.season.yearEnd + 1, rng, potentials, [
        ...userOffers.values(),
      ])
      for (const miss of outcome.rejected)
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'signing',
          text: `No deal for ${miss.name}: ${miss.reason}`,
        })
      for (const signing of outcome.signings.filter((x) => x.teamId === current.userTeamId))
        current.log.push({
          date: current.calendar.date,
          yearEnd: current.season.yearEnd,
          kind: 'signing',
          text: `Signed ${current.league.players.find((p) => p.playerId === signing.playerId)?.name ?? signing.playerId} for $${(signing.amount / 1_000_000).toFixed(1)}M over ${signing.years} year${signing.years === 1 ? '' : 's'}`,
        })
      userOffers.clear()
      marketOpen = false
      rolloverFinish(current, hooks, rng)
      // A new season: last year's game logs belong to last year.
      userBoxes.clear()
      boxes.clear()
      return offseasonView()
    },

    seasonHistory: (): SimSeason[] => {
      // The season just finished is only written into history when the league rolls over, which
      // happens at the end of the offseason. Until then the user has won a title the comparison
      // screen cannot see — so the finished-but-not-rolled season is summarised on the fly.
      const done =
        !PLAYING.has(current.phase) &&
        !current.history.some((h) => h.yearEnd === current.season.yearEnd)
      const seasons = done ? [...current.history, summarise(current)] : current.history
      return seasons.map((h) => ({
        yearEnd: h.yearEnd,
        standings: (h.standings ?? []).map((s) => ({
          teamId: s.teamId,
          wins: s.wins,
          losses: s.losses,
        })),
        championTeamId: h.championTeamId ?? null,
        mvp: h.awards?.mvp ? { playerId: h.awards.mvp.playerId, name: h.awards.mvp.name } : null,
        userWins: h.standings?.find((s) => s.teamId === current.userTeamId)?.wins ?? 0,
        userLosses: h.standings?.find((s) => s.teamId === current.userTeamId)?.losses ?? 0,
      }))
    },

    // ── The league as a spectacle ────────────────────────────────────────────

    leaders(category, limit = 10): LeaderRow[] {
      const rows = leaderRows()
      const out: LeaderRow[] = []
      for (const row of rows) {
        const line = current.stats[row.playerId]
        if (!line) continue
        if (!volumeFloor(category, line, line.gp)) continue
        out.push({ ...row, value: statValue(category, line) })
      }
      return out.sort((a, b) => b.value - a.value).slice(0, limit)
    },

    teamStats(): TeamStatRow[] {
      const rows: TeamStatRow[] = []
      for (const team of current.league.teams) {
        const record = current.records[team.teamId]
        if (!record) continue
        const games = record.wins + record.losses
        if (games === 0) {
          rows.push({
            teamId: team.teamId,
            wins: 0,
            losses: 0,
            pts: 0,
            oppPts: 0,
            diff: 0,
            pace: 0,
            fgPct: 0,
            fg3Pct: 0,
            reb: 0,
            ast: 0,
            tov: 0,
          })
          continue
        }
        // Team shooting and ball movement come from the players' own lines.
        let fgm = 0
        let fga = 0
        let fg3m = 0
        let fg3a = 0
        let reb = 0
        let ast = 0
        let tov = 0
        let fta = 0
        for (const line of Object.values(current.stats)) {
          if (line.teamId !== team.teamId) continue
          fgm += line.fgm
          fga += line.fga
          fg3m += line.fg3m
          fg3a += line.fg3a
          fta += line.fta
          reb += line.oreb + line.dreb
          ast += line.ast
          tov += line.tov
        }
        rows.push({
          teamId: team.teamId,
          wins: record.wins,
          losses: record.losses,
          pts: record.pf / games,
          oppPts: record.pa / games,
          diff: (record.pf - record.pa) / games,
          // Possessions, the standard estimate.
          pace: (fga + 0.44 * fta + tov - 0) / games,
          fgPct: fga > 0 ? fgm / fga : 0,
          fg3Pct: fg3a > 0 ? fg3m / fg3a : 0,
          reb: reb / games,
          ast: ast / games,
          tov: tov / games,
        })
      }
      return rows.sort((a, b) => b.diff - a.diff)
    },

    awardRace: (limit = 5) => scoreCandidates(limit),

    bracket(): Bracket | null {
      const p = current.playoffs
      if (!p) return null
      const seedOf = (teamId: string, conference: 'East' | 'West'): number | null => {
        const i = p.seeds[conference]?.indexOf(teamId) ?? -1
        return i >= 0 ? i + 1 : null
      }
      const anySeed = (teamId: string): number | null =>
        seedOf(teamId, 'East') ?? seedOf(teamId, 'West')
      return {
        seeds: { East: p.seeds.East ?? [], West: p.seeds.West ?? [] },
        rounds: p.rounds.map((round) =>
          round.map(
            (s): BracketSeries => ({
              round: s.round,
              bracket: s.bracket,
              highTeamId: s.highTeamId,
              lowTeamId: s.lowTeamId,
              highSeed: anySeed(s.highTeamId),
              lowSeed: anySeed(s.lowTeamId),
              highWins: s.highWins,
              lowWins: s.lowWins,
              bestOf: s.bestOf,
              winnerTeamId: s.winnerTeamId,
              games: s.games.map((g) => ({
                gameId: g.gameId,
                date: g.date,
                homeTeamId: g.homeTeamId,
                homePts: g.homePts,
                awayPts: g.awayPts,
              })),
            }),
          ),
        ),
        championTeamId: p.championTeamId,
        runnerUpTeamId: p.runnerUpTeamId,
      }
    },

    allStars(): AllStarGame | null {
      const schedule = current.calendar.schedule
      const first = schedule[0]?.date
      const last = schedule.at(-1)?.date
      if (!first || !last) return null
      const stored = current.allStar
      const date =
        stored?.yearEnd === current.season.yearEnd ? stored.date : allStarDate(first, last)
      if (!date) return null

      const byId = new Map(current.league.players.map((p) => [p.playerId, p]))
      const hydrate = (picks: { playerId: string; starter: boolean }[]): AllStarPick[] =>
        picks.map((sel) => {
          const p = byId.get(sel.playerId)
          const s = current.stats[sel.playerId]
          const gp = s && s.gp > 0 ? s.gp : 1
          return {
            playerId: sel.playerId,
            name: p?.name ?? sel.playerId,
            teamId: p?.teamId ?? '',
            pos: p?.pos ?? 'SF',
            starter: sel.starter,
            pts: s ? s.pts / gp : 0,
            reb: s ? (s.oreb + s.dreb) / gp : 0,
            ast: s ? s.ast / gp : 0,
            selections:
              1 +
              current.history.filter((h) =>
                h.awards?.allNba?.some((team) => team.some((w) => w.playerId === sel.playerId)),
              ).length,
          }
        })

      if (stored?.yearEnd === current.season.yearEnd) {
        return {
          yearEnd: current.season.yearEnd,
          played: stored.result != null,
          date: stored.date,
          east: hydrate(stored.east),
          west: hydrate(stored.west),
          result: stored.result,
        }
      }

      const live = pickAllStars(current)
      return {
        yearEnd: current.season.yearEnd,
        played: false,
        date,
        east: hydrate(live.east),
        west: hydrate(live.west),
        result: null,
      }
    },

    nextGame(): GamePreview | null {
      const me = current.userTeamId
      const next = nextFixture(current, me)
      if (!next) return null
      const home = next.home
      const them = next.opponentTeamId
      const myRecord = current.records[me]
      const theirRecord = current.records[them]

      const formOf = (teamId: string): boolean[] =>
        current.calendar.results
          .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
          .slice(-5)
          .reverse()
          .map((g) => (g.homeTeamId === teamId ? g.homePts > g.awayPts : g.awayPts > g.homePts))

      const bestOf = (teamId: string) => {
        let best: GamePreview['yourBest'] = null
        for (const [playerId, line] of Object.entries(current.stats)) {
          if (line.teamId !== teamId || line.gp === 0) continue
          const pts = line.pts / line.gp
          if (best && pts <= best.pts) continue
          const player = current.league.players.find((p) => p.playerId === playerId)
          if (!player) continue
          best = {
            playerId,
            name: player.name,
            pts,
            reb: (line.oreb + line.dreb) / line.gp,
            ast: line.ast / line.gp,
          }
        }
        return best
      }

      return {
        gameId: next.gameId,
        date: next.date,
        home,
        opponentTeamId: them,
        yourRecord: { wins: myRecord?.wins ?? 0, losses: myRecord?.losses ?? 0 },
        theirRecord: { wins: theirRecord?.wins ?? 0, losses: theirRecord?.losses ?? 0 },
        // Regular-season meetings only: a live series carries its own games in `playoff`, and
        // showing them twice would say the same thing in two different voices.
        series: current.calendar.results
          .filter(
            (g) =>
              g.seasonType === 'regular' &&
              ((g.homeTeamId === me && g.awayTeamId === them) ||
                (g.homeTeamId === them && g.awayTeamId === me)),
          )
          .slice(-4)
          .reverse()
          .map((g) => ({
            gameId: g.gameId,
            date: g.date,
            yourPts: g.homeTeamId === me ? g.homePts : g.awayPts,
            theirPts: g.homeTeamId === me ? g.awayPts : g.homePts,
          })),
        yourBest: bestOf(me),
        theirBest: bestOf(them),
        yourForm: formOf(me),
        theirForm: formOf(them),
        ...(next.playoff ? { playoff: next.playoff } : {}),
        dressing: (() => {
          const settings = current.teamSettings[me]
          const opts = {
            yearEnd: current.season.yearEnd,
            availability: current.availability ?? {},
            date: next.date,
            staff: current.staff,
          }
          const games = current.season.rules.games
          const mine = current.league.players.filter((p) => p.teamId === me)
          const suited = chooseSquad(mine, opts, settings)
          const suitedIds = new Set(suited.map((p) => p.playerId))
          const extraSit = mine.filter((p) => {
            if (suitedIds.has(p.playerId)) return false
            const why = restReason(p.playerId, settings, opts)
            return why === 'sat' || why === 'b2b' || why === 'tired' || why === 'hurt'
          })
          const listed = [...suited, ...extraSit]
          const rows = []
          for (const p of listed) {
            const why = restReason(p.playerId, settings, opts)
            const risk = injuryRisk(
              p.ratings.durability,
              p.age,
              p.yearsPro,
              careerOf(current, p.playerId)?.seasons.at(-1)?.gp,
              settings?.minutes[p.playerId],
              games,
            )
            rows.push({
              playerId: p.playerId,
              name: p.name,
              pos: p.pos,
              overall: overall(p.ratings),
              sitting: why != null,
              why,
              risk: risk.short,
              riskText: risk.text,
            })
          }
          return rows
        })(),
      }
    },

    postseason: (): PostseasonSummary | null => postseasonOf(current, current.userTeamId),

    save(): SaveFile {
      // Your own team's box scores go in the save. Without them, closing the tab empties every
      // game log and every past box score in the schedule — the season would have no memory of
      // itself. The play-by-play is dropped: it is the bulk of a box and is only ever read for
      // the game you just watched.
      const boxesForSave: [string, GameResult][] = [...userBoxes].map(([id, r]) => [
        id,
        { ...r, pbp: [] },
      ])
      return {
        format: 'hoops-dynasty-save',
        version: 1,
        savedAt: new Date().toISOString(),
        yearEnd: current.season.yearEnd,
        userTeamId: current.userTeamId,
        label: `${current.season.seasonId} · ${current.calendar.date}`,
        state: {
          game: current,
          potentials: [...potentials],
          boxes: boxesForSave,
          // Bids you have placed but not yet resolved, so a reload mid-market keeps them.
          offers: [...userOffers.values()],
          marketOpen,
          marketDay,
          // Who you have sacked. The staff itself lives in the game state; this is only the grudge.
          fired: [...firedByUser],
        },
      }
    },
  }
}

export function realModule(opts: RealOptions = {}): DynastyModule {
  return {
    preview(bundle, teamId) {
      const state = gameNewGame(bundle, teamId, 1, { history: opts.history ?? null })
      const d = dynastyOf(bundle, state, new Map(), opts)
      return { roster: d.roster(teamId), finance: d.finance(teamId) }
    },

    newGame(bundle: SeasonBundle, options: NewGameOptions) {
      const state = gameNewGame(bundle, options.teamId, options.seed, {
        history: opts.history ?? null,
      })
      const potentials: Potentials = new Map()
      // Seed hidden ceilings once, from the ratings each player arrives with.
      const rng = makeRng(options.seed ^ 0x5eed)
      for (const p of state.league.players)
        potentials.set(p.playerId, draftPotential(p.ratings, p.age, rng))
      return dynastyOf(bundle, state, potentials, opts)
    },

    loadGame(bundle, save) {
      const payload = save.state as {
        game: GameState
        potentials: [string, number][]
        boxes?: [string, GameResult][]
        offers?: UserOffer[]
        marketOpen?: boolean
        fired?: string[]
        marketDay?: number
      }
      return dynastyOf(
        bundle,
        payload.game,
        new Map(payload.potentials),
        opts,
        payload.boxes ?? [],
        {
          offers: payload.offers ?? [],
          marketOpen: payload.marketOpen ?? false,
          fired: payload.fired ?? [],
          marketDay: payload.marketDay ?? 0,
        },
      )
    },
  }
}
