/**
 * The real implementation of the seam in `api.ts`: @hoops/game driving the season, with the Phase 4
 * and 5 packages plugged into its hooks.
 *
 * Two things the adapter still owns, behind local modules:
 *   - Box scores. The season state stores totals, not boxes.
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
  type SeasonBundle,
} from '@hoops/core'
import { NameBank } from '@hoops/draftclass'
import { canWaive, maxSalary, minSalary } from '@hoops/frontoffice'
import {
  allStarDate,
  availabilityOf,
  candidates,
  careerOf,
  chooseSquad,
  type GameState,
  newGame as gameNewGame,
  squadMood as gameSquadMood,
  makePick,
  moraleValue,
  onTheClock,
  pickAllStars,
  restReason,
  rolloverFinish,
  runDraft,
  type SeasonStatLine,
  summarise,
  type TeamSettings,
  wantsOut,
} from '@hoops/game'
import { injuryOutlook, injuryRisk, isWarning } from '@hoops/injury'
import { draftPotential, overall } from '@hoops/progression'
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
  PlayerDesk,
  PostseasonSummary,
  RosterRow,
  ScheduleEntry,
  SimSeason,
  SquadMoodView,
  StatCategory,
  TeamPlan,
  TeamStatRow,
  TradeAssessment,
  TradePackage,
} from './api.ts'
import { ratingCard } from './card.ts'
import { buildHooks } from './hooks.ts'
import {
  askingFrom,
  askingToStay,
  extendPlayer,
  freeAgentPool,
  type Potentials,
  runMarket,
  type UserOffer,
} from './market.ts'
import { ensureDraftOpen, financeOf, offseasonView, openMarket, stepMarket } from './offseason.ts'
import { decodeSave, encodeSave } from './persist.ts'
import type { RealOptions } from './session.ts'
import { type DynastySession, PLAYING, rngFor } from './session.ts'
import { fire, hire, staffView } from './staff.ts'
import { applyComputerLineup, playOneDay } from './step.ts'
import { applyTrade, assess, incomingOffers, picksOf, tradeBlock } from './trades.ts'
import { applySignMinimum, applyWaive, unsignedPool } from './transactions.ts'
import {
  emptyTotals,
  liveInjury,
  moodOf,
  nextFixture,
  postseasonOf,
  standingsFrom,
  toPlayerRecord,
  withTeamNames,
} from './views.ts'

export type { Potentials, RealOptions }

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
  const names = new NameBank()
  names.reserve(state.league.players.map((p) => p.name))
  const s: DynastySession = {
    bundle,
    current: state,
    potentials,
    opts,
    boxes: new Map(savedBoxes as [string, GameResult][]),
    userBoxes: new Map(savedBoxes as [string, GameResult][]),
    feed: [],
    lastRumourDate: '',
    userOffers: new Map(resume.offers.map((o) => [o.playerId, o])),
    marketOpen: resume.marketOpen,
    marketDay: resume.marketDay ?? 0,
    lastPicks: [],
    scoutCache: new Map(),
    firedByUser: new Set(resume.fired ?? []),
    pending: [],
    names,
    hooks: undefined as unknown as DynastySession['hooks'],
  }
  s.hooks = buildHooks(potentials, (r) => s.pending.push(r), opts, names)

  const listedOf = (): string[] => {
    const mine = new Set(
      s.current.league.players
        .filter((p) => p.teamId === s.current.userTeamId)
        .map((p) => p.playerId),
    )
    return (s.current.listed ?? []).filter((id) => mine.has(id))
  }

  const deskOf = (playerId: string): PlayerDesk | null => {
    const p = s.current.league.players.find((x) => x.playerId === playerId)
    if (!p) return null
    const yours = p.teamId === s.current.userTeamId
    const listed = yours && listedOf().includes(playerId)
    const offers = listed
      ? incomingOffers(
          s.current,
          s.potentials,
          makeRng(s.current.seed ^ s.current.calendar.results.length ^ playerId.length),
          6,
          playerId,
        )
      : []
    const names: Record<string, string> = {}
    for (const o of offers) {
      for (const id of [...o.user.players, ...o.other.players]) {
        const n = s.current.league.players.find((x) => x.playerId === id)?.name
        if (n) names[id] = n
      }
    }
    const rules = s.current.season.rules
    const yearEnd = s.current.season.yearEnd
    const remaining = p.contract?.years.filter((y) => y.yearEnd >= yearEnd) ?? []
    const hasNext = p.contract?.years.some((y) => y.yearEnd === yearEnd + 1) ?? false
    const out = wantsOut(moraleValue(s.current, playerId))
    const ask = askingToStay(s.current, p, s.potentials)
    let kind: PlayerDesk['contract']['kind'] = 'none'
    if (yours && s.marketOpen && !hasNext) kind = 'fa'
    else if (yours && remaining.length > 0 && remaining.length < 5) kind = 'extend'
    const rosterCount = s.current.league.players.filter(
      (x) => x.teamId === s.current.userTeamId,
    ).length
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
        offer: s.userOffers.get(playerId) ?? null,
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
    const byId = new Map(s.current.league.players.map((p) => [p.playerId, p]))
    const rows: LeaderRow[] = []
    for (const [playerId, line] of Object.entries(s.current.stats)) {
      const p = byId.get(playerId)
      if (!p || line.gp === 0) continue
      const record = s.current.records[line.teamId]
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
    const seasonGames = s.current.season.rules.games || 82
    const played = Math.max(...Object.values(s.current.records).map((r) => r.wins + r.losses), 1)
    const through = Math.min(1, played / seasonGames)
    if (category === 'fgPct' || category === 'tsPct')
      return line.fga >= gp * 6 && line.fga >= Math.round(300 * through)
    if (category === 'fg3Pct') return line.fg3a >= gp * 1.5 && line.fg3a >= Math.round(82 * through)
    if (category === 'ftPct') return line.fta >= gp * 1.5 && line.fta >= Math.round(125 * through)
    return true
  }

  const scoreCandidates = (limit: number): AwardRace => {
    const all = candidates(s.current)
    const byId = new Map(s.current.league.players.map((p) => [p.playerId, p]))
    const toCandidate = (list: typeof all, key: 'mvp' | 'mvpVote' | 'dpoy'): AwardCandidate[] => {
      const top = [...list].sort((a, b) => b[key] - a[key]).slice(0, limit)
      // Vote share among the shortlist, so the gap between first and second is visible.
      const total = top.reduce((acc, c) => acc + Math.max(0, c[key]), 0) || 1
      return top.map((c) => {
        const line = s.current.stats[c.playerId]
        const record = s.current.records[c.teamId]
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
      const total = s.current.calendar.schedule.length
      const played = s.current.calendar.next
      const next = s.current.calendar.schedule[played]?.date ?? null
      return {
        yearEnd: s.current.season.yearEnd,
        seasonId: s.current.season.seasonId,
        userTeamId: s.current.userTeamId,
        seed: s.current.seed,
        date: s.current.calendar.date,
        nextGameDate: next,
        gamesPlayed: played,
        gamesTotal: total,
        seasonComplete: !PLAYING.has(s.current.phase),
        autoLineup: Boolean(s.current.autoLineup),
      }
    },

    teams: () =>
      s.current.league.teams.map((t) => ({
        teamId: t.teamId,
        abbr: t.abbr,
        name: t.name,
        city: t.city,
        conference: t.conference,
        division: t.division,
        real: s.bundle.teams.find((b) => b.teamId === t.teamId)?.real ?? {
          wins: 0,
          losses: 0,
          playoffSeed: null,
        },
      })),

    simDay() {
      return playOneDay(s)
    },

    simToDate(isoDate, onDay) {
      const reports: DayReport[] = []
      let index = 0
      // Same door as Continue: rumours, incoming offers, AI-AI trades. A Sim to date that
      // skipped this used to walk past a live offer while the rest of the league moved.
      while (s.current.calendar.date <= isoDate && PLAYING.has(s.current.phase)) {
        const r = playOneDay(s)
        if (!r) break
        reports.push(r)
        const cont = onDay?.(r, index++)
        if (r.interrupt || cont === false) break
      }
      return reports
    },

    standings: () => standingsFrom(s.current),
    boxScore: (gameId) => s.userBoxes.get(gameId) ?? s.boxes.get(gameId) ?? null,

    gameLog(playerId, limit = 120): GameLogRow[] {
      const rows: GameLogRow[] = []
      const teamId = s.current.league.players.find((p) => p.playerId === playerId)?.teamId
      const dnpRow = (
        g: (typeof s.current.calendar.results)[number],
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
      for (let i = s.current.calendar.results.length - 1; i >= 0 && rows.length < limit; i--) {
        const g = s.current.calendar.results[i]
        if (!g) continue
        const seasonType = g.seasonType ?? 'regular'
        const hisTeam = Boolean(teamId && (g.homeTeamId === teamId || g.awayTeamId === teamId))
        const box = s.userBoxes.get(g.gameId) ?? s.boxes.get(g.gameId)
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
        if (hisTeam && seasonType !== 'regular')
          rows.push(dnpRow(g, g.homeTeamId === teamId, seasonType))
      }
      return rows
    },

    schedule(teamId) {
      const played = new Map(s.current.calendar.results.map((r) => [r.gameId, r]))
      // Playoff games are never on the schedule — they are created as the bracket resolves — so
      // they are folded in from the results, or a finished season ends on its last April fixture.
      const scheduled = new Set(s.current.calendar.schedule.map((g) => g.gameId))
      const extra = s.current.calendar.results
        .filter((r) => !scheduled.has(r.gameId))
        .map((r) => ({
          gameId: r.gameId,
          date: r.date,
          homeTeamId: r.homeTeamId,
          awayTeamId: r.awayTeamId,
          seasonType: r.seasonType,
          real: null,
        }))
      return [...s.current.calendar.schedule, ...extra]
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
      return s.current.league.players
        .filter((p) => p.teamId === teamId)
        .map((p): RosterRow => {
          const stat = s.current.stats[p.playerId]
          const contractYear = p.contract?.years.find((y) => y.yearEnd === s.current.season.yearEnd)
          const injury = liveInjury(s.current, p.playerId)
          return {
            player: toPlayerRecord(p, s.bundle),
            mood: moodOf(s.current, p),
            // Your own players show their ceiling; everyone else's is their own business.
            card: ratingCard(
              p.ratings,
              p.tendencies,
              p.pos,
              teamId === s.current.userTeamId ? (s.potentials.get(p.playerId) ?? null) : null,
            ),
            totals: stat ? { ...emptyTotals(), ...stat } : emptyTotals(),
            salary: contractYear?.amount ?? null,
            contractYears:
              p.contract?.years.filter((y) => y.yearEnd >= s.current.season.yearEnd).length ?? 0,
            injuryHint: injuryOutlook(
              p.ratings.durability,
              p.age,
              p.yearsPro,
              careerOf(s.current, p.playerId)?.seasons.at(-1)?.gp,
              s.current.teamSettings[teamId]?.minutes[p.playerId],
              s.current.season.rules.games,
            ),
            injuryRisk: injuryRisk(
              p.ratings.durability,
              p.age,
              p.yearsPro,
              careerOf(s.current, p.playerId)?.seasons.at(-1)?.gp,
              s.current.teamSettings[teamId]?.minutes[p.playerId],
              s.current.season.rules.games,
            ),
            ...(injury ? { injury } : {}),
          }
        })
        .sort((a, b) => (b.totals.min || b.player.realMpg) - (a.totals.min || a.player.realMpg))
    },

    finance: (teamId) => financeOf(s, teamId),

    squadMood(teamId): SquadMoodView {
      const m = gameSquadMood(s.current, teamId)
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
      const mine = s.current.userTeamId
      const myTeam = s.current.league.teams.find((t) => t.teamId === mine)
      const myNames = new Set(
        s.current.league.players.filter((p) => p.teamId === mine).map((p) => p.name),
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

      const fromLog: { item: NewsItem; rank: number }[] = s.current.log.slice(-300).map((e, i) => {
        const text = withTeamNames(s.current, e.text)
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
      const fromFeed = s.feed.map((item) => ({
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
      const st = s.current.teamSettings[teamId]
      return {
        tactics: st?.tactics ?? { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
        depth: st?.depth ?? [],
        minutes: st?.minutes ?? {},
        inactive: st?.inactive ?? [],
        lineup: st?.lineup ?? {},
        lineups: st?.lineups ?? {},
        unitTactics: st?.unitTactics ?? {},
        system: st?.system ?? 'balanced',
        instructions: st?.instructions ?? {},
        rest: st?.rest ?? {},
        sitNext: st?.sitNext ?? [],
      }
    },

    setPlan(teamId, plan) {
      const existing: TeamSettings = s.current.teamSettings[teamId] ?? {
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
      s.current.teamSettings[teamId] = next
    },

    resolveInjury(playerId, choice) {
      const p = s.current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== s.current.userTeamId) return
      const a = availabilityOf(s.current, playerId)
      if (choice === 'playThrough') {
        if (!a.injury || !isWarning(a.injury)) return
        a.out = 0
        a.playingThrough = true
        return
      }
      if (choice === 'restore') {
        a.playingThrough = false
        applyComputerLineup(s)
        return
      }
      a.playingThrough = false
      if (a.out === 0 && a.injury) a.out = Math.max(1, a.injury.games)
      applyComputerLineup(s, [playerId])
    },

    setAutoLineup(on) {
      s.current.autoLineup = on
    },

    sitTonight(playerId, sit) {
      const p = s.current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== s.current.userTeamId) return
      const existing: TeamSettings = s.current.teamSettings[s.current.userTeamId] ?? {
        tactics: { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false },
        depth: [],
        minutes: {},
        inactive: [],
      }
      const held = new Set(existing.sitNext ?? [])
      if (sit) held.add(playerId)
      else held.delete(playerId)
      s.current.teamSettings[s.current.userTeamId] = { ...existing, sitNext: [...held] }
    },

    // ── Trades ───────────────────────────────────────────────────────────────

    tradeBlock: (teamId) => tradeBlock(s.current, teamId, s.potentials),

    assessTrade: (user, other) => assess(s.current, user, other, s.potentials),

    executeTrade(user, other): TradeAssessment {
      const verdict = assess(s.current, user, other, s.potentials)
      if (verdict.legal && verdict.accepted) {
        applyTrade(s.current, user, other)
        const names = (pack: TradePackage) =>
          pack.players
            .map((id) => s.current.league.players.find((p) => p.playerId === id)?.name ?? id)
            .join(', ')
        s.current.log.push({
          date: s.current.calendar.date,
          yearEnd: s.current.season.yearEnd,
          kind: 'trade',
          text: `Trade: ${names(user)} to ${s.current.league.teams.find((t) => t.teamId === other.teamId)?.name ?? other.teamId} for ${names(other)}`,
        })
      }
      return verdict
    },

    incomingOffers: (limit = 6) =>
      incomingOffers(
        s.current,
        s.potentials,
        makeRng(s.current.seed ^ s.current.calendar.results.length),
        limit,
      ),

    listedOnBlock: () => listedOf(),

    listOnBlock(playerId, on): PlayerDesk | null {
      const p = s.current.league.players.find((x) => x.playerId === playerId)
      if (!p || p.teamId !== s.current.userTeamId) return deskOf(playerId)
      const next = new Set(listedOf())
      if (on) next.add(playerId)
      else next.delete(playerId)
      s.current.listed = [...next]
      return deskOf(playerId)
    },

    playerDesk: (playerId) => deskOf(playerId),

    waivePlayer(playerId) {
      const res = applyWaive(s.current, playerId)
      return { ...res, desk: deskOf(playerId) }
    },

    inSeasonFreeAgents(): FreeAgentView[] {
      if (!PLAYING.has(s.current.phase)) return []
      const rules = s.current.season.rules
      return unsignedPool(s.current)
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
      if (!PLAYING.has(s.current.phase))
        return { ok: false, message: 'Signings in the summer go through free agency.' }
      return applySignMinimum(s.current, playerId)
    },

    extendContract(playerId, amount, years) {
      const res = extendPlayer(s.current, playerId, amount, years, s.potentials)
      return { ...res, desk: deskOf(playerId) }
    },

    picksOf: (teamId: string) => picksOf(s.current, teamId),

    // ── The staff ────────────────────────────────────────────────────────────

    staff: (teamId) => staffView(s.current, teamId ?? s.current.userTeamId, s.firedByUser),

    hireCoach(coachId, role, years, salary) {
      const me = s.current.userTeamId
      const res = hire(s.current, me, coachId, role, years, salary)
      if (res.ok) {
        s.firedByUser.delete(coachId)
        // A new head scout writes new reports. The cache exists so a report does not improve every
        // time somebody else drafts; a change of scout is a real change in who is looking.
        if (role === 'scout') s.scoutCache.clear()
        s.current.log.push({
          date: s.current.calendar.date,
          yearEnd: s.current.season.yearEnd,
          kind: 'contract',
          text: res.message,
        })
      }
      return { ok: res.ok, message: res.message, view: staffView(s.current, me, s.firedByUser) }
    },

    fireCoach(role) {
      const me = s.current.userTeamId
      const before = s.current.staff ? staffView(s.current, me, s.firedByUser) : null
      const sacked = before?.slots.find((s) => s.role === role)?.coach?.coachId ?? null
      const res = fire(s.current, me, role)
      if (res.ok) {
        if (sacked) s.firedByUser.add(sacked)
        if (role === 'scout') s.scoutCache.clear()
        s.current.log.push({
          date: s.current.calendar.date,
          yearEnd: s.current.season.yearEnd,
          kind: 'contract',
          text: res.message,
        })
      }
      return { ok: res.ok, message: res.message, view: staffView(s.current, me, s.firedByUser) }
    },

    // ── The offseason ────────────────────────────────────────────────────────

    offseason(): OffseasonState | null {
      if (PLAYING.has(s.current.phase)) return null
      return offseasonView(s)
    },

    advanceDraft(): OffseasonState {
      ensureDraftOpen(s)
      if (s.current.phase === 'draft' && s.current.draft) {
        runDraft(s.current, s.hooks, rngFor(s, 'draft'), s.current.userTeamId)
        if (s.current.draft.done) openMarket(s)
      }
      return offseasonView(s)
    },

    draftPlayer(prospectId): OffseasonState {
      ensureDraftOpen(s)
      const clock = onTheClock(s.current)
      if (clock?.teamId === s.current.userTeamId) {
        const taken = makePick(s.current, prospectId)
        if (taken)
          s.current.log.push({
            date: s.current.calendar.date,
            yearEnd: s.current.season.yearEnd,
            kind: 'draft',
            text: `You take ${taken.name} at ${clock.overall}`,
          })
        // Then the rest of the room picks until you are up again.
        runDraft(s.current, s.hooks, rngFor(s, 'draft'), s.current.userTeamId)
        if (s.current.draft?.done) openMarket(s)
      }
      return offseasonView(s)
    },

    makeOffer(playerId, amount, years): OffseasonState {
      if (s.marketOpen) {
        s.userOffers.set(playerId, { playerId, amount, years })
        const yearEnd = s.current.season.yearEnd + 1
        const fa = freeAgentPool(s.current, yearEnd, s.potentials).find(
          (p) => p.playerId === playerId,
        )
        if (fa) {
          const ask = askingFrom(s.current, fa, s.current.userTeamId)
          if (amount + 1 >= ask.amount) stepMarket(s)
        }
      }
      return offseasonView(s)
    },

    withdrawOffer(playerId): OffseasonState {
      s.userOffers.delete(playerId)
      return offseasonView(s)
    },

    advanceMarket(): OffseasonState {
      if (s.current.phase === 'draft' && s.current.draft && !s.current.draft.done)
        return offseasonView(s)
      stepMarket(s)
      return offseasonView(s)
    },

    finishOffseason(): OffseasonState {
      // Anything still unplayed in the offseason happens now: an unfinished draft, then the market.
      ensureDraftOpen(s)
      if (s.current.phase === 'draft' && s.current.draft && !s.current.draft.done) {
        runDraft(s.current, s.hooks, rngFor(s, 'draft'))
        // Snapshot the finished board before the rollover clears it, so the summary can still
        // show what you took.
        s.lastPicks = s.current.draft.picks.map((p) => ({
          overall: p.overall,
          round: p.round,
          teamId: p.teamId,
          prospectId: p.prospectId,
          name: p.name,
        }))
        // Log your own picks, whoever made them: the summary is built from these.
        for (const pick of s.current.draft.picks)
          if (pick.teamId === s.current.userTeamId && pick.name)
            s.current.log.push({
              date: s.current.calendar.date,
              yearEnd: s.current.season.yearEnd,
              kind: 'draft',
              text: `Drafted ${pick.name} at ${pick.overall}`,
            })
        openMarket(s)
      }
      if (!s.marketOpen) openMarket(s)
      const rng = rngFor(s, 'market')
      const outcome = runMarket(s.current, s.current.season.yearEnd + 1, rng, s.potentials, [
        ...s.userOffers.values(),
      ])
      for (const miss of outcome.rejected)
        s.current.log.push({
          date: s.current.calendar.date,
          yearEnd: s.current.season.yearEnd,
          kind: 'signing',
          text: `No deal for ${miss.name}: ${miss.reason}`,
        })
      for (const signing of outcome.signings.filter((x) => x.teamId === s.current.userTeamId))
        s.current.log.push({
          date: s.current.calendar.date,
          yearEnd: s.current.season.yearEnd,
          kind: 'signing',
          text: `Signed ${s.current.league.players.find((p) => p.playerId === signing.playerId)?.name ?? signing.playerId} for $${(signing.amount / 1_000_000).toFixed(1)}M over ${signing.years} year${signing.years === 1 ? '' : 's'}`,
        })
      s.userOffers.clear()
      s.marketOpen = false
      rolloverFinish(s.current, s.hooks, rng)
      // A new season: last year's game logs belong to last year.
      s.userBoxes.clear()
      s.boxes.clear()
      return offseasonView(s)
    },

    seasonHistory: (): SimSeason[] => {
      // The season just finished is only written into history when the league rolls over, which
      // happens at the end of the offseason. Until then the user has won a title the comparison
      // screen cannot see — so the finished-but-not-rolled season is summarised on the fly.
      const done =
        !PLAYING.has(s.current.phase) &&
        !s.current.history.some((h) => h.yearEnd === s.current.season.yearEnd)
      const seasons = done ? [...s.current.history, summarise(s.current)] : s.current.history
      const me = s.current.userTeamId
      return seasons.map((h) => ({
        yearEnd: h.yearEnd,
        standings: (h.standings ?? []).map((row) => ({
          teamId: row.teamId,
          wins: row.wins,
          losses: row.losses,
        })),
        championTeamId: h.championTeamId ?? null,
        mvp: h.awards?.mvp ? { playerId: h.awards.mvp.playerId, name: h.awards.mvp.name } : null,
        userWins: h.standings?.find((row) => row.teamId === me)?.wins ?? 0,
        userLosses: h.standings?.find((row) => row.teamId === me)?.losses ?? 0,
      }))
    },

    // ── The league as a spectacle ────────────────────────────────────────────

    leaders(category, limit = 10): LeaderRow[] {
      const rows = leaderRows()
      const out: LeaderRow[] = []
      for (const row of rows) {
        const line = s.current.stats[row.playerId]
        if (!line) continue
        if (!volumeFloor(category, line, line.gp)) continue
        out.push({ ...row, value: statValue(category, line) })
      }
      return out.sort((a, b) => b.value - a.value).slice(0, limit)
    },

    teamStats(): TeamStatRow[] {
      const rows: TeamStatRow[] = []
      for (const team of s.current.league.teams) {
        const record = s.current.records[team.teamId]
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
        for (const line of Object.values(s.current.stats)) {
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
      const p = s.current.playoffs
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
      const schedule = s.current.calendar.schedule
      const first = schedule[0]?.date
      const last = schedule.at(-1)?.date
      if (!first || !last) return null
      const stored = s.current.allStar
      const date =
        stored?.yearEnd === s.current.season.yearEnd ? stored.date : allStarDate(first, last)
      if (!date) return null

      const byId = new Map(s.current.league.players.map((p) => [p.playerId, p]))
      const hydrate = (picks: { playerId: string; starter: boolean }[]): AllStarPick[] =>
        picks.map((sel) => {
          const p = byId.get(sel.playerId)
          const line = s.current.stats[sel.playerId]
          const gp = line && line.gp > 0 ? line.gp : 1
          return {
            playerId: sel.playerId,
            name: p?.name ?? sel.playerId,
            teamId: p?.teamId ?? '',
            pos: p?.pos ?? 'SF',
            starter: sel.starter,
            pts: line ? line.pts / gp : 0,
            reb: line ? (line.oreb + line.dreb) / gp : 0,
            ast: line ? line.ast / gp : 0,
            selections:
              1 +
              s.current.history.filter((h) =>
                h.awards?.allNba?.some((team) => team.some((w) => w.playerId === sel.playerId)),
              ).length,
          }
        })

      if (stored?.yearEnd === s.current.season.yearEnd) {
        return {
          yearEnd: s.current.season.yearEnd,
          played: stored.result != null,
          date: stored.date,
          east: hydrate(stored.east),
          west: hydrate(stored.west),
          result: stored.result,
        }
      }

      const live = pickAllStars(s.current)
      return {
        yearEnd: s.current.season.yearEnd,
        played: false,
        date,
        east: hydrate(live.east),
        west: hydrate(live.west),
        result: null,
      }
    },

    nextGame(): GamePreview | null {
      const me = s.current.userTeamId
      const next = nextFixture(s.current, me)
      if (!next) return null
      const home = next.home
      const them = next.opponentTeamId
      const myRecord = s.current.records[me]
      const theirRecord = s.current.records[them]

      const formOf = (teamId: string): boolean[] =>
        s.current.calendar.results
          .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
          .slice(-5)
          .reverse()
          .map((g) => (g.homeTeamId === teamId ? g.homePts > g.awayPts : g.awayPts > g.homePts))

      const bestOf = (teamId: string) => {
        let best: GamePreview['yourBest'] = null
        for (const [playerId, line] of Object.entries(s.current.stats)) {
          if (line.teamId !== teamId || line.gp === 0) continue
          const pts = line.pts / line.gp
          if (best && pts <= best.pts) continue
          const player = s.current.league.players.find((p) => p.playerId === playerId)
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
        series: s.current.calendar.results
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
          const settings = s.current.teamSettings[me]
          const opts = {
            yearEnd: s.current.season.yearEnd,
            availability: s.current.availability ?? {},
            date: next.date,
            ...(s.current.staff ? { staff: s.current.staff } : {}),
          }
          const games = s.current.season.rules.games
          const mine = s.current.league.players.filter((p) => p.teamId === me)
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
              careerOf(s.current, p.playerId)?.seasons.at(-1)?.gp,
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

    postseason: (): PostseasonSummary | null => postseasonOf(s.current, s.current.userTeamId),

    save: () => encodeSave(s),
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
      const rng = makeRng(options.seed ^ 0x5eed)
      for (const p of state.league.players)
        potentials.set(p.playerId, draftPotential(p.ratings, p.age, rng))
      return dynastyOf(bundle, state, potentials, opts)
    },

    loadGame(bundle, save) {
      const loaded = decodeSave(save)
      return dynastyOf(bundle, loaded.game, loaded.potentials, opts, loaded.boxes, loaded.resume)
    },
  }
}
