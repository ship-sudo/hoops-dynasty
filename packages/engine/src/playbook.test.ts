// The playbook, proved in box scores.
//
// The transforms in `@hoops/core/playbook` are arithmetic on ratings and tendencies. This file
// builds the GameInput the way `packages/game/src/rotation.ts` does and plays hundreds of games,
// because "shooting more threes changes his efficiency" is a claim about a box score and nothing
// else. Every assertion here is a measured number with slack, not a direction.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assignRoles,
  DEFAULT_TACTICS,
  type GameInput,
  instructedRatings,
  instructedTendencies,
  instructedWorkRate,
  NEUTRAL_INSTRUCTION,
  type OffenseSystemId,
  outOfPosition,
  type PlayerGameInput,
  type PlayerInstruction,
  type Position,
  type Ratings,
  rankSystems,
  roleOf,
  systemTactics,
  systemTendencies,
  type Tactics,
  type Tendencies,
} from '@hoops/core'
import { simulateGameWith } from './index.ts'
import { ERA_2016, referenceRatings } from './testkit.ts'

const POS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C', 'PG', 'SG', 'SF', 'PF', 'C']
const MINUTES = [36, 34, 32, 30, 28, 22, 18, 16, 12, 12]

interface Man {
  id: string
  pos: Position
  ratings: Ratings
  tendencies: Tendencies
  minutes: number
}

function tend(o: Partial<Tendencies> = {}): Tendencies {
  return {
    usage: 0.2,
    shotRim: ERA_2016.zoneShare.rim,
    shotClose: ERA_2016.zoneShare.close,
    shotMid: ERA_2016.zoneShare.mid,
    shotThree: ERA_2016.zoneShare.three,
    assist: 0.2,
    postUp: 0.1,
    ...o,
  }
}

function roster(prefix: string, tweak: (i: number, m: Man) => void = () => {}): Man[] {
  const men = MINUTES.map((m, i) => ({
    id: `${prefix}${i}`,
    pos: POS[i] as Position,
    ratings: referenceRatings(0),
    tendencies: tend(),
    minutes: m,
  }))
  for (const [i, m] of men.entries()) tweak(i, m)
  return men
}

interface Plan {
  system?: OffenseSystemId
  lineup?: Partial<Record<Position, string>>
  instructions?: Record<string, PlayerInstruction>
  tactics?: Partial<Tactics>
}

/** The same pipeline `buildTeamInput` runs, kept here so the engine can be tested without it. */
function build(teamId: string, men: Man[], plan: Plan = {}) {
  const system = plan.system ?? 'balanced'
  const roles =
    system === 'balanced'
      ? { hubId: null, handlerId: null }
      : assignRoles(
          men.map((m) => ({
            playerId: m.id,
            pos: m.pos,
            ratings: m.ratings,
            tendencies: m.tendencies,
          })),
        )
  const slotOf = (id: string): Position | null => {
    for (const p of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[])
      if (plan.lineup?.[p] === id) return p
    return null
  }
  const players: PlayerGameInput[] = men.map((m, i) => {
    const slot = slotOf(m.id)
    let ratings = slot ? outOfPosition(m.ratings, m.pos, slot) : m.ratings
    let tendencies =
      system === 'balanced'
        ? m.tendencies
        : systemTendencies(system, m.tendencies, roleOf(m.id, roles))
    let workRate = 1
    const ins = plan.instructions?.[m.id]
    if (ins) {
      tendencies = instructedTendencies(tendencies, ins)
      ratings = instructedRatings(ratings, ins)
      workRate = instructedWorkRate(ins)
    }
    return {
      playerId: m.id,
      name: m.id,
      pos: slot ?? m.pos,
      heightIn: 78,
      weightLb: 220,
      age: 27,
      ratings,
      tendencies,
      minutesTarget: m.minutes,
      starter: i < 5,
      condition: 1,
      workRate,
    }
  })
  const base = { ...DEFAULT_TACTICS, ...plan.tactics }
  return {
    teamId,
    name: teamId,
    players,
    tactics: system === 'balanced' ? base : systemTactics(system, base),
  }
}

interface Season {
  threeRate: number
  ppp: number
  ts: number
  pts: number
  poss: number
  orbPct: number
  oppPts: number
  oppPpp: number
  drebPct: number
  net: number
  per: Record<
    string,
    { fg3a: number; fg3pct: number; fga: number; pts: number; efg: number; reb: number }
  >
}

function play(men: Man[], plan: Plan, opp: Man[], games: number): Season {
  let fg3a = 0
  let fg3m = 0
  let fga = 0
  let fta = 0
  let pts = 0
  let poss = 0
  let oreb = 0
  let dreb = 0
  let oppOreb = 0
  let oppDreb = 0
  let oppPts = 0
  let oppPoss = 0
  const per: Record<
    string,
    { fg3a: number; fg3m: number; fga: number; fgm: number; pts: number; reb: number }
  > = {}
  for (let i = 0; i < games; i++) {
    const input: GameInput = {
      era: ERA_2016,
      home: build('HOM', men, plan),
      away: build('AWY', opp),
      seasonType: 'regular',
      neutralSite: true,
    }
    const r = simulateGameWith(input, i + 1, { pbp: false })
    fg3a += r.home.totals.fg3a
    fg3m += r.home.totals.fg3m
    fga += r.home.totals.fga
    fta += r.home.totals.fta
    pts += r.home.pts
    poss += r.home.possessions
    oreb += r.home.totals.oreb
    dreb += r.home.totals.dreb
    oppOreb += r.away.totals.oreb
    oppDreb += r.away.totals.dreb
    oppPts += r.away.pts
    oppPoss += r.away.possessions
    for (const p of r.home.players) {
      per[p.playerId] ??= { fg3a: 0, fg3m: 0, fga: 0, fgm: 0, pts: 0, reb: 0 }
      const e = per[p.playerId] as {
        fg3a: number
        fg3m: number
        fga: number
        fgm: number
        pts: number
        reb: number
      }
      e.fg3a += p.fg3a
      e.fg3m += p.fg3m
      e.fga += p.fga
      e.fgm += p.fgm
      e.pts += p.pts
      e.reb += p.oreb + p.dreb
    }
  }
  return {
    threeRate: fg3a / fga,
    ppp: pts / poss,
    ts: pts / (2 * (fga + 0.44 * fta)),
    pts: pts / games,
    poss: poss / games,
    orbPct: oreb / (oreb + oppDreb),
    oppPts: oppPts / games,
    oppPpp: oppPts / oppPoss,
    drebPct: dreb / (dreb + oppOreb),
    net: (pts - oppPts) / games,
    per: Object.fromEntries(
      Object.entries(per).map(([k, v]) => [
        k,
        {
          fg3a: v.fg3a / games,
          fg3pct: v.fg3a ? v.fg3m / v.fg3a : 0,
          fga: v.fga / games,
          pts: v.pts / games,
          efg: v.fga ? (v.fgm + 0.5 * v.fg3m) / v.fga : 0,
          reb: v.reb / games,
        },
      ]),
    ),
  }
}

/** Eight hundred games. Net points per game has a standard error of about 0.4 at this sample, so
 *  no claim below rests on a difference smaller than that. */
const N = 800
const OPPONENT = roster('A')
const BOMB: PlayerInstruction = { ...NEUTRAL_INSTRUCTION, threes: 2 }

describe('a defaulted plan plays exactly as it always did', () => {
  it('the whole pipeline with nothing set is byte-identical to a plain input', () => {
    for (let i = 1; i <= 5; i++) {
      const withPipeline = simulateGameWith(
        {
          era: ERA_2016,
          home: build('HOM', roster('H')),
          away: build('AWY', OPPONENT),
          seasonType: 'regular',
        },
        i,
        { pbp: false },
      )
      const plain: GameInput = {
        era: ERA_2016,
        home: {
          teamId: 'HOM',
          name: 'HOM',
          players: roster('H').map((m, j) => ({
            playerId: m.id,
            name: m.id,
            pos: m.pos,
            heightIn: 78,
            weightLb: 220,
            age: 27,
            ratings: m.ratings,
            tendencies: m.tendencies,
            minutesTarget: m.minutes,
            starter: j < 5,
            condition: 1,
          })),
          tactics: { ...DEFAULT_TACTICS },
        },
        away: {
          teamId: 'AWY',
          name: 'AWY',
          players: OPPONENT.map((m, j) => ({
            playerId: m.id,
            name: m.id,
            pos: m.pos,
            heightIn: 78,
            weightLb: 220,
            age: 27,
            ratings: m.ratings,
            tendencies: m.tendencies,
            minutesTarget: m.minutes,
            starter: j < 5,
            condition: 1,
          })),
          tactics: { ...DEFAULT_TACTICS },
        },
        seasonType: 'regular',
      }
      const bare = simulateGameWith(plain, i, { pbp: false })
      assert.equal(withPipeline.home.pts, bare.home.pts)
      assert.equal(withPipeline.away.pts, bare.away.pts)
      assert.deepEqual(withPipeline.home.totals, bare.home.totals)
    }
  })
})

describe('telling a man to shoot threes', () => {
  // One roster, two very different men: a 80-rated shooter who already lives out there, and a
  // 20-rated centre who finishes everything at the rim.
  const men = roster('H', (i, m) => {
    if (i === 1) {
      m.ratings = { ...m.ratings, three: 80, mid: 62 }
      m.tendencies = tend({
        usage: 0.27,
        shotRim: 0.22,
        shotClose: 0.1,
        shotMid: 0.2,
        shotThree: 0.48,
      })
    }
    if (i === 2) {
      m.ratings = { ...m.ratings, three: 20, rim: 86, close: 76, drawFoul: 72 }
      m.tendencies = tend({
        usage: 0.28,
        shotRim: 0.52,
        shotClose: 0.26,
        shotMid: 0.16,
        shotThree: 0.06,
      })
    }
  })
  const base = play(men, {}, OPPONENT, N)
  const shooterBombs = play(men, { instructions: { H1: BOMB } }, OPPONENT, N)
  const bigBombs = play(men, { instructions: { H2: BOMB } }, OPPONENT, N)

  it('the shooter takes far more threes and the team shoots more of them', () => {
    const before = (base.per.H1 as { fg3a: number }).fg3a
    const after = (shooterBombs.per.H1 as { fg3a: number }).fg3a
    assert.ok(after > before * 1.4, `3PA ${before.toFixed(2)} -> ${after.toFixed(2)}`)
    assert.ok(
      shooterBombs.threeRate > base.threeRate + 0.03,
      `team 3PAr ${base.threeRate.toFixed(3)} -> ${shooterBombs.threeRate.toFixed(3)}`,
    )
  })

  it('and because he can shoot, it pays — his efficiency and the team’s both rise', () => {
    const a = base.per.H1 as { efg: number }
    const b = shooterBombs.per.H1 as { efg: number }
    assert.ok(b.efg > a.efg + 0.02, `his eFG ${a.efg.toFixed(3)} -> ${b.efg.toFixed(3)}`)
    assert.ok(
      shooterBombs.ts > base.ts + 0.002,
      `team TS ${base.ts.toFixed(3)} -> ${shooterBombs.ts.toFixed(3)}`,
    )
    assert.ok(
      shooterBombs.ppp > base.ppp + 0.005,
      `team PPP ${base.ppp.toFixed(3)} -> ${shooterBombs.ppp.toFixed(3)}`,
    )
  })

  it('the centre’s shot mix moves too — a multiplier alone would have left him where he was', () => {
    const before = (base.per.H2 as { fg3a: number }).fg3a
    const after = (bigBombs.per.H2 as { fg3a: number }).fg3a
    assert.ok(after > before * 2, `3PA ${before.toFixed(2)} -> ${after.toFixed(2)}`)
    assert.ok(after > 1.8, 'he is genuinely shooting them now')
  })

  it('and because he cannot shoot, it costs you', () => {
    const a = base.per.H2 as { efg: number; pts: number }
    const b = bigBombs.per.H2 as { efg: number; pts: number }
    assert.ok(b.efg < a.efg - 0.008, `his eFG ${a.efg.toFixed(3)} -> ${b.efg.toFixed(3)}`)
    assert.ok(b.pts < a.pts - 0.2, `his points ${a.pts.toFixed(1)} -> ${b.pts.toFixed(1)}`)
    assert.ok(
      bigBombs.ppp < base.ppp,
      `team PPP ${base.ppp.toFixed(3)} -> ${bigBombs.ppp.toFixed(3)}`,
    )
    assert.ok(
      bigBombs.net < base.net - 0.3,
      `net points ${base.net.toFixed(2)} -> ${bigBombs.net.toFixed(2)}`,
    )
  })

  it('told to stop shooting them, he stops', () => {
    const quiet = play(
      men,
      { instructions: { H2: { ...NEUTRAL_INSTRUCTION, threes: -2 } } },
      OPPONENT,
      150,
    )
    assert.ok(
      (quiet.per.H2 as { fg3a: number }).fg3a < (base.per.H2 as { fg3a: number }).fg3a * 0.6,
    )
  })
})

describe('an offensive system moves the game the way its name says', () => {
  const postTeam = roster('H', (i, m) => {
    if (i === 4) {
      m.ratings = {
        ...m.ratings,
        close: 78,
        rim: 76,
        strength: 80,
        drawFoul: 74,
        three: 25,
        oreb: 68,
      }
      m.tendencies = tend({
        usage: 0.3,
        postUp: 0.55,
        shotRim: 0.42,
        shotClose: 0.32,
        shotMid: 0.22,
        shotThree: 0.04,
      })
    } else {
      m.ratings = { ...m.ratings, three: 45, passing: 46, iq: 47 }
    }
  })
  // Five out. Shooters and passers, and not one man who can score with his back to the basket.
  const smallTeam = roster('H', (i, m) => {
    m.ratings = {
      ...m.ratings,
      three: 66,
      passing: 62,
      iq: 62,
      stamina: 66,
      speed: 64,
      close: 38,
      rim: 44,
      strength: 40,
      drawFoul: 42,
    }
    if (i === 0) m.ratings = { ...m.ratings, passing: 76, handling: 74 }
  })
  // One man takes a third of the possessions and is the worst scorer of the five.
  const hogTeam = roster('H', (i, m) => {
    m.ratings = { ...m.ratings, three: 62, passing: 62, iq: 62 }
    if (i === 0) {
      m.ratings = { ...m.ratings, rim: 42, close: 40, mid: 40, three: 38 }
      m.tendencies = tend({ usage: 0.34 })
    }
  })
  // One man takes a third of the possessions and deserves every one of them.
  const starTeam = roster('H', (i, m) => {
    m.ratings = { ...m.ratings, three: 46, rim: 46, close: 46, mid: 46 }
    if (i === 0) {
      m.ratings = { ...m.ratings, rim: 82, close: 78, mid: 72, three: 76, drawFoul: 72 }
      m.tendencies = tend({ usage: 0.34 })
    }
  })

  const flat = play(postTeam, {}, OPPONENT, N)
  const inside = play(postTeam, { system: 'insideOut' }, OPPONENT, N)
  const early = play(postTeam, { system: 'early' }, OPPONENT, N)

  it('inside-out slows the game, shoots fewer threes and feeds the post', () => {
    assert.ok(
      inside.poss < flat.poss - 1.5,
      `pace ${flat.poss.toFixed(1)} -> ${inside.poss.toFixed(1)}`,
    )
    assert.ok(
      inside.threeRate < flat.threeRate - 0.015,
      `3PAr ${flat.threeRate.toFixed(3)} -> ${inside.threeRate.toFixed(3)}`,
    )
    const before = (flat.per.H4 as { fga: number }).fga
    const after = (inside.per.H4 as { fga: number }).fga
    assert.ok(after > before * 1.2, `the hub's shots ${before.toFixed(1)} -> ${after.toFixed(1)}`)
    assert.ok(inside.orbPct > flat.orbPct + 0.015, 'and it crashes the glass')
  })

  it('pushing the tempo really does raise the possession count and the three-point rate', () => {
    assert.ok(
      early.poss > flat.poss + 2,
      `pace ${flat.poss.toFixed(1)} -> ${early.poss.toFixed(1)}`,
    )
    assert.ok(
      early.threeRate > flat.threeRate + 0.05,
      `3PAr ${flat.threeRate.toFixed(3)} -> ${early.threeRate.toFixed(3)}`,
    )
    assert.ok(
      early.pts > flat.pts + 1.5,
      `points ${flat.pts.toFixed(1)} -> ${early.pts.toFixed(1)}`,
    )
  })

  it('a post offence with a real post raises points per possession', () => {
    assert.ok(
      inside.ppp > flat.ppp + 0.012,
      `PPP ${flat.ppp.toFixed(3)} -> ${inside.ppp.toFixed(3)}`,
    )
  })

  it('the systems that suit a shooting team beat the default for it', () => {
    const smallFlat = play(smallTeam, {}, OPPONENT, N)
    for (const sys of ['pickRoll', 'early'] as OffenseSystemId[]) {
      const r = play(smallTeam, { system: sys }, OPPONENT, N)
      assert.ok(
        r.net > smallFlat.net + 1,
        `${sys} net ${smallFlat.net.toFixed(2)} -> ${r.net.toFixed(2)}`,
      )
    }
  })

  it('a post offence with nobody to post up takes worse shots and scores less', () => {
    const smallFlat = play(smallTeam, {}, OPPONENT, N)
    const smallInside = play(smallTeam, { system: 'insideOut' }, OPPONENT, N)
    assert.ok(
      smallInside.ts < smallFlat.ts,
      `TS ${smallFlat.ts.toFixed(4)} -> ${smallInside.ts.toFixed(4)}`,
    )
    assert.ok(
      smallInside.pts < smallFlat.pts - 1,
      `points ${smallFlat.pts.toFixed(1)} -> ${smallInside.pts.toFixed(1)}`,
    )
  })

  it('motion pays when the man taking all the shots is not the man who should be', () => {
    const flatHog = play(hogTeam, {}, OPPONENT, N)
    const motionHog = play(hogTeam, { system: 'motion' }, OPPONENT, N)
    assert.ok(
      (motionHog.per.H0 as { fga: number }).fga < (flatHog.per.H0 as { fga: number }).fga - 3,
      `the ball comes off him: ${(flatHog.per.H0 as { fga: number }).fga.toFixed(1)} -> ${(motionHog.per.H0 as { fga: number }).fga.toFixed(1)}`,
    )
    assert.ok(
      motionHog.ppp > flatHog.ppp + 0.002,
      `PPP ${flatHog.ppp.toFixed(4)} -> ${motionHog.ppp.toFixed(4)}`,
    )
    assert.ok(
      motionHog.ts > flatHog.ts + 0.001,
      `TS ${flatHog.ts.toFixed(4)} -> ${motionHog.ts.toFixed(4)}`,
    )
  })

  it('and it costs you when he is exactly the man who should be shooting', () => {
    const flatStar = play(starTeam, {}, OPPONENT, N)
    const motionStar = play(starTeam, { system: 'motion' }, OPPONENT, N)
    assert.ok(
      motionStar.ppp < flatStar.ppp - 0.002,
      `PPP ${flatStar.ppp.toFixed(4)} -> ${motionStar.ppp.toFixed(4)}`,
    )
    assert.ok(
      motionStar.ts < flatStar.ts - 0.001,
      `TS ${flatStar.ts.toFixed(4)} -> ${motionStar.ts.toFixed(4)}`,
    )
    assert.ok(
      motionStar.net < flatStar.net - 0.4,
      `net ${flatStar.net.toFixed(2)} -> ${motionStar.net.toFixed(2)}`,
    )
  })

  it('the fit panel and the engine agree: what it likes helps, what it dislikes does not', () => {
    // The whole honesty claim, tested on four rosters at once. The screen scores a system before
    // a single game is played; this checks that the scoreboard says the same thing afterwards.
    const squads: [string, Man[]][] = [
      ['post', postTeam],
      ['five-out', smallTeam],
      ['one-man (bad)', hogTeam],
      ['one-man (good)', starTeam],
    ]
    for (const [label, men] of squads) {
      const asRoles = men.map((m) => ({
        playerId: m.id,
        pos: m.pos,
        ratings: m.ratings,
        tendencies: m.tendencies,
      }))
      const ranked = rankSystems(asRoles).filter((r) => r.id !== 'balanced')
      const best = ranked[0] as { id: OffenseSystemId; score: number }
      const worst = ranked[ranked.length - 1] as { id: OffenseSystemId; score: number }
      const base = play(men, {}, OPPONENT, N).net
      const bestNet = play(men, { system: best.id }, OPPONENT, N).net
      const worstNet = play(men, { system: worst.id }, OPPONENT, N).net
      assert.ok(
        bestNet > base + 0.4,
        `${label}: best fit ${best.id} (${best.score}) should beat the default, ${base.toFixed(2)} -> ${bestNet.toFixed(2)}`,
      )
      assert.ok(
        worstNet < base + 0.4,
        `${label}: worst fit ${worst.id} (${worst.score}) should not beat the default, ${base.toFixed(2)} -> ${worstNet.toFixed(2)}`,
      )
      assert.ok(
        bestNet > worstNet,
        `${label}: ${best.id} (${best.score}) ${bestNet.toFixed(2)} vs ${worst.id} (${worst.score}) ${worstNet.toFixed(2)}`,
      )
    }
  })

  it('running costs a thin, tired roster more than it costs a deep one', () => {
    const deep = roster('H')
    const thin = roster('H', (i, m) => {
      m.minutes = [44, 44, 42, 40, 38, 14, 8, 5, 3, 2][i] as number
      m.ratings = { ...m.ratings, stamina: 44 }
    })
    const deepGain =
      play(deep, { system: 'early' }, OPPONENT, N).net - play(deep, {}, OPPONENT, N).net
    const thinGain =
      play(thin, { system: 'early' }, OPPONENT, N).net - play(thin, {}, OPPONENT, N).net
    assert.ok(
      thinGain < deepGain - 0.4,
      `deep gains ${deepGain.toFixed(2)}, thin only ${thinGain.toFixed(2)}`,
    )
  })
})

describe('a man out of position', () => {
  const men = roster('H', (_i, m) => {
    m.ratings = { ...m.ratings, dreb: 58, oreb: 55, interiorD: 58, block: 56, perimD: 55 }
  })
  const right = { PG: 'H0', SG: 'H1', SF: 'H2', PF: 'H3', C: 'H4' } as const
  const wrong = { PG: 'H4', SG: 'H1', SF: 'H2', PF: 'H3', C: 'H0' } as const
  const ok = play(men, { lineup: { ...right } }, OPPONENT, N)
  const bad = play(men, { lineup: { ...wrong } }, OPPONENT, N)

  it('a point guard at centre gives up the defensive glass', () => {
    assert.ok(
      bad.drebPct < ok.drebPct - 0.015,
      `DRB% ${ok.drebPct.toFixed(3)} -> ${bad.drebPct.toFixed(3)}`,
    )
    assert.ok(
      bad.orbPct < ok.orbPct - 0.01,
      `own ORB% ${ok.orbPct.toFixed(3)} -> ${bad.orbPct.toFixed(3)}`,
    )
  })

  it('and concedes points, because nobody is protecting the rim', () => {
    assert.ok(
      bad.oppPts > ok.oppPts + 1.5,
      `opponent points ${ok.oppPts.toFixed(1)} -> ${bad.oppPts.toFixed(1)}`,
    )
    assert.ok(bad.net < ok.net - 1.5, `net ${ok.net.toFixed(2)} -> ${bad.net.toFixed(2)}`)
  })

  it('the right five in the right slots costs nothing at all', () => {
    const none = play(men, {}, OPPONENT, N)
    assert.ok(
      Math.abs(none.net - ok.net) < 0.01,
      `no lineup ${none.net.toFixed(3)} vs in-position ${ok.net.toFixed(3)}`,
    )
  })
})

describe('defensive effort and the offensive glass', () => {
  const men = roster('H')
  const all = (i: PlayerInstruction) => Object.fromEntries(men.map((m) => [m.id, i]))

  it('a team told to get after it concedes fewer points', () => {
    const normal = play(men, {}, OPPONENT, N)
    const locked = play(
      men,
      { instructions: all({ ...NEUTRAL_INSTRUCTION, effort: 1 }) },
      OPPONENT,
      N,
    )
    assert.ok(
      locked.oppPts < normal.oppPts - 1.5,
      `opponent points ${normal.oppPts.toFixed(1)} -> ${locked.oppPts.toFixed(1)}`,
    )
  })

  it('a team told to crash the glass gets more of it', () => {
    const normal = play(men, {}, OPPONENT, N)
    const crash = play(
      men,
      { instructions: all({ ...NEUTRAL_INSTRUCTION, crash: 1 }) },
      OPPONENT,
      N,
    )
    const back = play(
      men,
      { instructions: all({ ...NEUTRAL_INSTRUCTION, crash: -1 }) },
      OPPONENT,
      N,
    )
    assert.ok(
      crash.orbPct > normal.orbPct + 0.02,
      `ORB% ${normal.orbPct.toFixed(3)} -> ${crash.orbPct.toFixed(3)}`,
    )
    assert.ok(
      back.orbPct < normal.orbPct - 0.02,
      `ORB% ${normal.orbPct.toFixed(3)} -> ${back.orbPct.toFixed(3)}`,
    )
  })

  it('a team tactic of crashing now concedes transition, so it is a trade and not a free lunch', () => {
    const normal = play(men, {}, OPPONENT, N)
    const crash = play(men, { tactics: { crashGlass: 1 } }, OPPONENT, N)
    assert.ok(crash.orbPct > normal.orbPct + 0.025, 'second chances go up')
    assert.ok(
      crash.oppPpp > normal.oppPpp + 0.008,
      `and the other end gets easier: ${normal.oppPpp.toFixed(3)} -> ${crash.oppPpp.toFixed(3)}`,
    )
  })
})
