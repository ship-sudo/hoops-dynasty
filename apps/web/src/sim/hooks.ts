/** GameHooks the season loop injects. Owned here so real.ts is only the Dynasty object. */
import { type GameResult, RATING_KEYS, type Ratings, type SimulateGame } from '@hoops/core'
import { ERA, ERA_FIRST, ERA_LAST } from '@hoops/data/era'
import { classFor, fictionalClass, type NameBank } from '@hoops/draftclass'
import { simulateGame } from '@hoops/engine'
import type { GameHooks, LeaguePlayer } from '@hoops/game'
import { lingeringPenalty } from '@hoops/injury'
import { blendToFate, develop, overall, retires } from '@hoops/progression'
import { type Potentials, runMarket } from './market.ts'
import type { RealOptions } from './session.ts'
import { developmentFactor } from './staff.ts'

/** The hooks that turn a bare season loop into a dynasty. */
export function buildHooks(
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
