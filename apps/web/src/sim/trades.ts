/**
 * Trades: what your players are worth, whether a deal is legal, whether the other side says yes,
 * and what they would propose to you.
 *
 * The valuation and the rule-checking live in @hoops/frontoffice. This file is the bridge: it turns
 * league state into the shapes that package wants, and applies a deal once both sides agree.
 */
import type { Rng } from '@hoops/core'
import {
  evaluateTrade,
  isLegalTrade,
  outgoingSalary,
  type PickAsset,
  playerValue,
  salariesFor,
  seasonValue,
  type TradeAsset,
  type TradeSide,
  tradeValue,
} from '@hoops/frontoffice'
import { type GameState, type LeaguePlayer, pickKey } from '@hoops/game'
import { overall } from '@hoops/progression'
import type { PickRef, TradeAssessment, TradeBlockPlayer, TradePackage } from './api.ts'
import type { Potentials } from './market.ts'

function asset(p: LeaguePlayer, potentials: Potentials): TradeAsset {
  return {
    playerId: p.playerId,
    name: p.name,
    ratings: p.ratings,
    age: p.age,
    potential: potentials.get(p.playerId) ?? overall(p.ratings) + 3,
    contract: p.contract,
  }
}

function toPick(ref: PickRef): PickAsset {
  return {
    draftYear: ref.draftYear,
    round: ref.round,
    expectedSlot: ref.expectedSlot,
    fromTeamId: ref.fromTeamId,
  }
}

function rosterOf(state: GameState, teamId: string): LeaguePlayer[] {
  return state.league.players.filter((p) => p.teamId === teamId)
}

function side(state: GameState, pack: TradePackage, potentials: Potentials): TradeSide {
  const roster = rosterOf(state, pack.teamId)
  const salaries = salariesFor(
    roster.map((p) => ({ playerId: p.playerId, contract: p.contract })),
    state.season.yearEnd,
  )
  const players = pack.players
    .map((id) => roster.find((p) => p.playerId === id))
    .filter((p): p is LeaguePlayer => Boolean(p))
    .map((p) => asset(p, potentials))
  return {
    teamId: pack.teamId,
    salaries,
    outPlayers: players,
    outPicks: pack.picks.map(toPick),
  }
}

/** How hard the AI is chasing wins: from last season's record, 0 rebuilding to 1 all in. */
export function winNowOf(state: GameState, teamId: string): number {
  const wins = state.history.at(-1)?.standings?.find((s) => s.teamId === teamId)?.wins ?? 41
  return Math.min(1, Math.max(0, (wins - 25) / 30))
}

/**
 * The rule engine speaks in team ids, because it has no idea who anyone is. It already writes
 * money the way people do; this just puts the names in.
 */
function readable(state: GameState, reason: string): string {
  let out = reason
  for (const t of state.league.teams) out = out.replaceAll(t.teamId, `${t.city} ${t.name}`)
  return out
}

export function assess(
  state: GameState,
  user: TradePackage,
  other: TradePackage,
  potentials: Potentials,
): TradeAssessment {
  const userSide = side(state, user, potentials)
  const otherSide = side(state, other, potentials)
  const opts = {
    yearEnd: state.season.yearEnd,
    rules: state.season.rules,
    winNow: winNowOf(state, other.teamId),
  }
  const legality = isLegalTrade(userSide, otherSide, state.season.rules, state.season.yearEnd)
  const verdict = evaluateTrade(otherSide, userSide, opts)
  const reasons = legality.reasons.map((r) => readable(state, r))
  return {
    legal: legality.legal,
    reasons,
    accepted: legality.legal && verdict.accepted,
    reason: legality.legal ? verdict.reason : (reasons[0] ?? 'illegal trade'),
    net: verdict.net,
    outgoing: {
      user: outgoingSalary(userSide, state.season.yearEnd),
      other: outgoingSalary(otherSide, state.season.yearEnd),
    },
  }
}

/** Move the players and the picks. Call only on an assessment that came back legal and accepted. */
export function applyTrade(state: GameState, user: TradePackage, other: TradePackage): void {
  const move = (pack: TradePackage, toTeamId: string) => {
    for (const id of pack.players) {
      const p = state.league.players.find((x) => x.playerId === id)
      if (!p) continue
      p.teamId = toTeamId
      p.yearsWithTeam = 0
      if (p.contract) p.contract = { ...p.contract, teamId: toTeamId }
    }
    for (const pick of pack.picks) {
      state.pickOwners[pickKey(pick.draftYear, pick.round, pick.fromTeamId)] = toTeamId
    }
  }
  move(user, other.teamId)
  move(other, user.teamId)
  if (state.listed?.length) {
    const mine = new Set(
      state.league.players.filter((p) => p.teamId === state.userTeamId).map((p) => p.playerId),
    )
    state.listed = state.listed.filter((id) => mine.has(id))
  }
}

/** A block row plus the number a trade is actually scored on. */
type Priced = TradeBlockPlayer & { trade: number }

function pricedBlock(state: GameState, teamId: string, potentials: Potentials): Priced[] {
  const opts = {
    yearEnd: state.season.yearEnd,
    rules: state.season.rules,
    winNow: winNowOf(state, teamId),
  }
  return rosterOf(state, teamId)
    .map((p) => {
      const a = asset(p, potentials)
      const value = playerValue(a, opts)
      const year = p.contract?.years.find((y) => y.yearEnd === state.season.yearEnd)
      return {
        playerId: p.playerId,
        name: p.name,
        teamId,
        value: value.production,
        surplus: value.surplus,
        trade: Math.round(tradeValue(a, opts)),
        salary: year?.amount ?? 0,
        contractYears:
          p.contract?.years.filter((y) => y.yearEnd >= state.season.yearEnd).length ?? 0,
      }
    })
    .sort((a, b) => b.trade - a.trade)
}

export function tradeBlock(
  state: GameState,
  teamId: string,
  potentials: Potentials,
): TradeBlockPlayer[] {
  return pricedBlock(state, teamId, potentials).map(({ trade: _trade, ...row }) => row)
}

/**
 * Where each club's own pick is expected to land, 1 (worst record) to 30 (best).
 *
 * Records are used the moment there are any: this season's pace once enough games have been played,
 * otherwise last season's finish. Before either exists — opening night of a new game, where
 * `state.history` is empty — teams are ranked by the strength of the roster they open with, because
 * the alternative was to call every team average and price the defending champion's first like a
 * lottery pick.
 */
export function expectedSlots(state: GameState): Map<string, number> {
  const scored = state.league.teams.map((t) => {
    const record = state.records[t.teamId]
    const played = record ? record.wins + record.losses : 0
    const prior = state.history.at(-1)?.standings?.find((s) => s.teamId === t.teamId)?.wins ?? null
    let score: number
    if (played >= 10 || prior != null) {
      const pace = record && played > 0 ? (record.wins / played) * 82 : 41
      // Early in a season the record is noise; last year's finish carries most of the weight.
      const w = Math.min(1, played / 41)
      score = prior == null ? pace : pace * w + prior * (1 - w)
    } else {
      // No league history at all: rank by talent on hand, in dollars of production.
      const roster = rosterOf(state, t.teamId)
        .map((p) => seasonValue(p.ratings, state.season.rules))
        .sort((a, b) => b - a)
        .slice(0, 9)
      score = roster.reduce((a, b) => a + b, 0) / 1_000_000
    }
    return { teamId: t.teamId, score }
  })
  // Worst first: the worst team picks first.
  scored.sort((a, b) => a.score - b.score)
  const n = Math.max(1, scored.length)
  const out = new Map<string, number>()
  for (let i = 0; i < scored.length; i++) {
    const row = scored[i]
    if (row) out.set(row.teamId, Math.round(1 + (i * 29) / Math.max(1, n - 1)))
  }
  return out
}

/**
 * Every pick this team holds in the next three drafts — its own and any it has acquired.
 *
 * `state.pickOwners` is the ledger and it is keyed by the team that *earned* the pick, so the only
 * way to find what you bought is to sweep every team's keys and keep the ones that now point at
 * you. Looking up your own key alone made acquired picks invisible: you could not re-trade a first
 * you had just paid a star for, and the AI never offered one.
 */
export function picksOf(state: GameState, teamId: string): PickRef[] {
  const out: PickRef[] = []
  const rounds = Math.min(2, state.season.rules.draft.rounds)
  const slots = expectedSlots(state)
  for (let year = state.season.yearEnd; year < state.season.yearEnd + 3; year++) {
    const yearsOut = year - state.season.yearEnd
    for (let round = 1; round <= rounds; round++) {
      for (const from of state.league.teams) {
        const owner = state.pickOwners[pickKey(year, round, from.teamId)] ?? from.teamId
        if (owner !== teamId) continue
        // Nobody knows where a pick three years out lands, so it regresses toward the middle.
        const slot = slots.get(from.teamId) ?? 15
        out.push({
          draftYear: year,
          round: round as 1 | 2,
          fromTeamId: from.teamId,
          expectedSlot: Math.round(slot + (15.5 - slot) * Math.min(1, 0.35 * yearsOut)),
        })
      }
    }
  }
  return out
}

/**
 * What the AI would like from you.
 *
 * A market, not a list. Each other club takes a couple of swings at a player of yours it wants,
 * drawn from anywhere on your roster rather than only the top of it, and builds a package it would
 * actually do: a player of matching money, sweetened with a pick — or a pick on its own, or a pick
 * *from* you if they are the ones being asked to pay. How many land depends on what is on the board
 * and who is chasing what, which is why the number moves from week to week instead of being
 * whatever the limit was.
 *
 * The old version made exactly one attempt per club, always for one of your six best, never
 * offering a pick unless the deal was already short, and so returned nothing in year one and the
 * same five deals every year after.
 */
export function incomingOffers(
  state: GameState,
  potentials: Potentials,
  rng: Rng,
  limit = 6,
  forPlayerId?: string,
): { other: TradePackage; user: TradePackage; assessment: TradeAssessment }[] {
  const userTeamId = state.userTeamId
  const mine = pricedBlock(state, userTeamId, potentials)
  const out: { other: TradePackage; user: TradePackage; assessment: TradeAssessment }[] = []
  if (mine.length === 0) return out
  const listed = (state.listed ?? []).filter((id) => mine.some((p) => p.playerId === id))
  const hunt = forPlayerId
    ? mine.filter((p) => p.playerId === forPlayerId)
    : listed.length > 0
      ? mine.filter((p) => listed.includes(p.playerId))
      : mine
  if (hunt.length === 0) return out
  const seen = new Set<string>()
  const swings = forPlayerId || listed.length > 0 ? 5 : 3

  for (const team of state.league.teams) {
    if (team.teamId === userTeamId) continue
    const theirs = pricedBlock(state, team.teamId, potentials)
    if (theirs.length === 0) continue
    const theirPicks = picksOf(state, team.teamId)
    const myPicks = picksOf(state, userTeamId)

    for (let attempt = 0; attempt < swings; attempt++) {
      // Listed men are the ones you put on the block; otherwise one swing at a star, then anyone.
      const want =
        hunt.length < mine.length || forPlayerId
          ? hunt[rng.int(hunt.length)]
          : attempt === 0
            ? mine[rng.int(Math.min(3, mine.length))]
            : mine[rng.int(mine.length)]
      if (!want) continue
      const candidates = theirs.filter(
        (p) => Math.abs(p.salary - want.salary) < want.salary * 0.4 + 2_000_000,
      )
      const user: TradePackage = { teamId: userTeamId, players: [want.playerId], picks: [] }
      const other: TradePackage = { teamId: team.teamId, players: [], picks: [] }
      // Usually a body back; sometimes picks alone, which is what a rebuild actually offers.
      const match = candidates[rng.int(Math.max(1, Math.min(4, candidates.length)))]
      if (match && (candidates.length > 0 || rng.next() < 0.5)) other.players.push(match.playerId)
      if (other.players.length === 0 && theirPicks.length === 0) continue

      // Both books are kept. `theirs` is the deal seen from their side; `yours` is the same deal
      // seen from yours, which is the half the old code never looked at. An offer nobody but the
      // proposer would take is not an offer, and it is why the AI could ask for your best player
      // and call it a market.
      let theirView = assess(state, user, other, potentials)
      let yourView = assess(state, other, user, potentials)

      // They are short: sweeten with picks, best first, until they have paid enough for you.
      if (theirView.legal && (!theirView.accepted || yourView.net < 0)) {
        for (const pick of [...theirPicks].sort((a, b) => a.expectedSlot - b.expectedSlot)) {
          other.picks.push(pick)
          const nextTheirs = assess(state, user, other, potentials)
          if (!nextTheirs.accepted) {
            // One pick too many: they would not do it, so take it back and stop.
            other.picks.pop()
            break
          }
          theirView = nextTheirs
          yourView = assess(state, other, user, potentials)
          if (yourView.net > 0 || other.picks.length >= 4) break
        }
      }

      // They are ahead by a distance: they ask for one pick back. One — a club that demands every
      // pick you own is not making an offer, it is making a joke.
      if (
        theirView.legal &&
        theirView.accepted &&
        yourView.net > 0 &&
        myPicks.length > 0 &&
        rng.chance(0.6)
      ) {
        // The back of the round first: the cheapest thing that closes the gap. They only ask if
        // the deal still works for you afterwards — otherwise it is a demand, not an offer.
        const pick = [...myPicks].sort((a, b) => b.expectedSlot - a.expectedSlot)[0]
        if (pick) {
          const greedier = { ...user, picks: [pick] }
          const next = assess(state, greedier, other, potentials)
          const yoursAfter = assess(state, other, greedier, potentials)
          if (next.accepted && yoursAfter.net > 0) {
            user.picks.push(pick)
            theirView = next
            yourView = yoursAfter
          }
        }
      }

      const assessment = theirView
      if (!assessment.accepted) continue
      const key = [
        team.teamId,
        ...user.players,
        ...user.picks.map((p) => `${p.draftYear}-${p.round}-${p.fromTeamId}`),
        '|',
        ...other.players,
        ...other.picks.map((p) => `${p.draftYear}-${p.round}-${p.fromTeamId}`),
      ].join(',')
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ other, user, assessment })
    }
  }

  // Best for you first: the deal they are least ahead on is the one worth reading.
  return out.sort((a, b) => a.assessment.net - b.assessment.net).slice(0, limit)
}

/**
 * A round of business between the AI clubs.
 *
 * Without this the only trades in the league are yours, and every other roster is frozen from
 * opening night to the summer. Each round samples a few pairs of teams, looks for a swap where each
 * side gives up someone the other values more — a rebuilding team moving a veteran for youth, a
 * contender doing the reverse — and executes the ones both sides accept.
 */
export function aiTradeRound(
  state: GameState,
  potentials: Potentials,
  rng: Rng,
  maxDeals = 2,
): { a: string; b: string; text: string }[] {
  const done: { a: string; b: string; text: string }[] = []
  const teams = state.league.teams.filter((t) => t.teamId !== state.userTeamId)
  if (teams.length < 2) return done

  for (let attempt = 0; attempt < 10 && done.length < maxDeals; attempt++) {
    const a = teams[rng.int(teams.length)]
    const b = teams[rng.int(teams.length)]
    if (!a || !b || a.teamId === b.teamId) continue

    const blockA = pricedBlock(state, a.teamId, potentials)
    const blockB = pricedBlock(state, b.teamId, potentials)
    if (blockA.length < 8 || blockB.length < 8) continue // nobody trades down to an illegal roster

    // Each side offers from the middle of its roster, where the spare parts are.
    const fromA = blockA[3 + rng.int(Math.max(1, Math.min(6, blockA.length - 3)))]
    if (!fromA) continue
    const fromB = blockB
      .filter((p) => Math.abs(p.salary - fromA.salary) < fromA.salary * 0.35 + 1_500_000)
      .sort((x, y) => y.trade - x.trade)[0]
    if (!fromB) continue

    const packA: TradePackage = { teamId: a.teamId, players: [fromA.playerId], picks: [] }
    const packB: TradePackage = { teamId: b.teamId, players: [fromB.playerId], picks: [] }

    // Both sides must want it: evaluate from each direction.
    const bWants = assess(state, packA, packB, potentials)
    const aWants = assess(state, packB, packA, potentials)
    if (!bWants.legal || !bWants.accepted || !aWants.accepted) continue

    applyTrade(state, packA, packB)
    done.push({
      a: a.teamId,
      b: b.teamId,
      text: `${a.city} ${a.name} trade ${fromA.name} to ${b.city} ${b.name} for ${fromB.name}`,
    })
  }
  return done
}
