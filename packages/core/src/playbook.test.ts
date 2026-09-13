// The playbook as arithmetic: every transform is the identity at its default, and each one moves
// the thing its name says. The engine-level proof that these numbers reach a box score lives in
// packages/engine/src/playbook.test.ts.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assignRoles,
  INSTRUCTION_PRESETS,
  instructedRatings,
  instructedTendencies,
  instructedWorkRate,
  matchingPreset,
  NEUTRAL_INSTRUCTION,
  nightlyLoad,
  normaliseInstruction,
  normaliseUnitTactics,
  OFFENSE_SYSTEM_IDS,
  outOfPosition,
  type PlayerInstruction,
  type Position,
  RATING_KEYS,
  type Ratings,
  type RolePlayer,
  suggestPresets,
  systemFit,
  systemTactics,
  systemTendencies,
  type Tendencies,
  unitForSituation,
} from './index.ts'

function ratings(o: Partial<Ratings> = {}): Ratings {
  const r = {} as Ratings
  for (const k of RATING_KEYS) r[k] = 50
  return { ...r, ...o }
}

function tend(o: Partial<Tendencies> = {}): Tendencies {
  return {
    usage: 0.2,
    shotRim: 0.3,
    shotClose: 0.16,
    shotMid: 0.26,
    shotThree: 0.28,
    assist: 0.2,
    postUp: 0.1,
    ...o,
  }
}

const ins = (o: Partial<PlayerInstruction>): PlayerInstruction => ({ ...NEUTRAL_INSTRUCTION, ...o })

function sums(t: Tendencies): number {
  return t.shotRim + t.shotClose + t.shotMid + t.shotThree
}

describe('the playbook leaves a default alone', () => {
  it('a neutral instruction is the identity on tendencies, ratings and work rate', () => {
    const t = tend()
    const r = ratings()
    assert.equal(instructedTendencies(t, NEUTRAL_INSTRUCTION), t)
    assert.equal(instructedRatings(r, NEUTRAL_INSTRUCTION), r)
    assert.equal(instructedWorkRate(NEUTRAL_INSTRUCTION), 1)
    assert.equal(nightlyLoad(undefined, 0), 1)
    assert.equal(nightlyLoad(1, 0), 1)
  })

  it('the balanced system changes nothing at all', () => {
    const t = tend()
    assert.equal(systemTendencies('balanced', t, 'hub'), t)
    assert.equal(systemTendencies('balanced', t, 'other'), t)
    const base = { pace: 0, threes: 0, crashGlass: 0, pressure: 0, zone: false } as const
    assert.deepEqual(systemTactics('balanced', base), base)
  })

  it('a man in his own position is untouched', () => {
    const r = ratings()
    for (const p of ['PG', 'SG', 'SF', 'PF', 'C'] as Position[]) {
      assert.equal(outOfPosition(r, p, p), r)
    }
  })
})

describe('per-player instructions', () => {
  it('more threes really means more threes, and the mix still sums to one', () => {
    const t = tend()
    const up1 = instructedTendencies(t, ins({ threes: 1 }))
    const up2 = instructedTendencies(t, ins({ threes: 2 }))
    const down = instructedTendencies(t, ins({ threes: -2 }))
    assert.ok(up1.shotThree > t.shotThree + 0.06, `+1: ${up1.shotThree}`)
    assert.ok(up2.shotThree > up1.shotThree + 0.06, `+2: ${up2.shotThree}`)
    assert.ok(down.shotThree < t.shotThree * 0.5, `-2: ${down.shotThree}`)
    for (const x of [up1, up2, down]) assert.ok(Math.abs(sums(x) - 1) < 1e-9)
    // The mid-range gives way first.
    assert.ok(up2.shotMid / up2.shotThree < t.shotMid / t.shotThree)
  })

  it('a man who never shoots threes starts shooting some — a multiplier alone could not do that', () => {
    // A centre at 6% from three. Three times 6% is still nothing; the coach said "let it fly".
    const big = tend({ shotRim: 0.52, shotClose: 0.26, shotMid: 0.16, shotThree: 0.06 })
    const told = instructedTendencies(big, ins({ threes: 2 }))
    assert.ok(
      told.shotThree > 0.14,
      `a bombing centre should clear 14% of his shots: ${told.shotThree}`,
    )
    assert.ok(told.shotRim < big.shotRim, 'and they come off the shots he used to take')
  })

  it('working the post moves shots inside and raises postUp', () => {
    const t = tend()
    const post = instructedTendencies(t, ins({ post: 1 }))
    assert.ok(post.shotClose > t.shotClose * 1.2)
    assert.ok(post.shotThree < t.shotThree)
    assert.ok(post.postUp > t.postUp + 0.2)
    assert.ok(Math.abs(sums(post) - 1) < 1e-9)
  })

  it('usage is the share of the offence he takes, and it is bounded', () => {
    const t = tend({ usage: 0.3 })
    assert.ok(instructedTendencies(t, ins({ usage: 2 })).usage > 0.35)
    assert.ok(instructedTendencies(t, ins({ usage: -2 })).usage < 0.23)
    assert.ok(instructedTendencies(tend({ usage: 0.4 }), ins({ usage: 2 })).usage <= 0.42)
  })

  it('effort and the glass are ratings, and they are paid for in legs', () => {
    const r = ratings()
    const hard = instructedRatings(r, ins({ effort: 1 }))
    assert.ok(hard.perimD > r.perimD && hard.interiorD > r.interiorD && hard.steal > r.steal)
    assert.equal(hard.oreb, r.oreb, 'effort is defence, not rebounding')
    assert.ok(instructedRatings(r, ins({ crash: 1 })).oreb > r.oreb)
    assert.ok(instructedRatings(r, ins({ crash: -1 })).oreb < r.oreb)
    assert.ok(instructedWorkRate(ins({ effort: 1, crash: 1 })) > 1.3)
    assert.ok(instructedWorkRate(ins({ effort: -1 })) < 1)
  })

  it('a plan off a save file is clamped into range', () => {
    const n = normaliseInstruction({ usage: 9, threes: -9, post: 4, crash: -3, effort: 0.4 })
    assert.deepEqual(n, { usage: 2, threes: -2, post: 1, crash: -1, effort: 0 })
  })
})

describe('instruction presets', () => {
  const shooter: RolePlayer = {
    playerId: 's',
    name: 'Shooter',
    pos: 'SG',
    ratings: ratings({ three: 78, mid: 70, passing: 48, close: 42, oreb: 35 }),
    tendencies: tend({ shotThree: 0.42, usage: 0.16, postUp: 0.04 }),
  }
  const big: RolePlayer = {
    playerId: 'c',
    name: 'Big',
    pos: 'C',
    ratings: ratings({ close: 78, rim: 75, oreb: 72, three: 28, passing: 40 }),
    tendencies: tend({
      postUp: 0.55,
      shotThree: 0.04,
      shotClose: 0.4,
      shotRim: 0.4,
      shotMid: 0.16,
      usage: 0.24,
    }),
  }
  const point: RolePlayer = {
    playerId: 'g',
    name: 'Point',
    pos: 'PG',
    ratings: ratings({ passing: 80, handling: 76, three: 55, oreb: 30 }),
    tendencies: tend({ assist: 0.45, usage: 0.26, shotThree: 0.22 }),
  }

  it('play his own game is the identity, same as a blank instruction', () => {
    const t = tend()
    const r = ratings()
    const own = INSTRUCTION_PRESETS.own.instruction
    assert.deepEqual(own, NEUTRAL_INSTRUCTION)
    assert.equal(instructedTendencies(t, own), t)
    assert.equal(instructedRatings(r, own), r)
    assert.equal(matchingPreset(undefined), 'own')
    assert.equal(matchingPreset(NEUTRAL_INSTRUCTION), 'own')
  })

  it('each named role is a PlayerInstruction the existing path already understands', () => {
    const t = tend()
    const hunt = instructedTendencies(t, INSTRUCTION_PRESETS.huntThrees.instruction)
    assert.ok(hunt.shotThree > t.shotThree + 0.08, 'hunt threes really hunts threes')
    const post = instructedTendencies(t, INSTRUCTION_PRESETS.postUp.instruction)
    assert.ok(post.shotClose > t.shotClose && post.postUp > t.postUp)
    const crash = instructedRatings(ratings(), INSTRUCTION_PRESETS.crashGlass.instruction)
    assert.ok(crash.oreb > 50)
    const lock = instructedRatings(ratings(), INSTRUCTION_PRESETS.lockD.instruction)
    assert.ok(lock.perimD > 50 && instructedWorkRate(INSTRUCTION_PRESETS.lockD.instruction) > 1)
    const maker = instructedTendencies(t, INSTRUCTION_PRESETS.playmaker.instruction)
    assert.ok(maker.usage > t.usage)
    assert.equal(matchingPreset(INSTRUCTION_PRESETS.spotUp.instruction), 'spotUp')
    assert.equal(matchingPreset(ins({ usage: 2, threes: 1 })), null, 'a mixed lever set is custom')
  })

  it('suggests roles that match what the man is actually good at', () => {
    const forShooter = suggestPresets(shooter).map((p) => p.id)
    assert.equal(forShooter.length, 4)
    assert.ok(!forShooter.includes('own'))
    assert.ok(
      forShooter.includes('huntThrees') || forShooter.includes('spotUp'),
      `shooter got ${forShooter.join(',')}`,
    )
    const forBig = suggestPresets(big).map((p) => p.id)
    assert.ok(forBig.includes('postUp'), `big got ${forBig.join(',')}`)
    const forPoint = suggestPresets(point).map((p) => p.id)
    assert.ok(forPoint.includes('playmaker'), `point got ${forPoint.join(',')}`)
  })
})

describe('out of position', () => {
  it('a point guard at centre stops rebounding and stops protecting the rim', () => {
    const r = ratings({ dreb: 60, oreb: 55, interiorD: 60, block: 55, strength: 60 })
    const atC = outOfPosition(r, 'PG', 'C')
    assert.ok(atC.dreb < r.dreb - 15, `dreb ${r.dreb} -> ${atC.dreb}`)
    assert.ok(atC.interiorD < r.interiorD - 15)
    assert.ok(atC.block < r.block - 15)
    assert.equal(atC.three, r.three, 'his jump shot is his jump shot wherever he stands')
  })

  it('a centre at point guard cannot stay in front of anybody', () => {
    const r = ratings({ perimD: 60, speed: 55, handling: 50, steal: 45 })
    const atPG = outOfPosition(r, 'C', 'PG')
    assert.ok(atPG.perimD < r.perimD - 20)
    assert.ok(atPG.handling < r.handling - 15)
    assert.equal(atPG.dreb, r.dreb, 'he is still the tallest man on the floor')
  })

  it('one slot costs less than four, and nothing leaves the 0–100 scale', () => {
    const r = ratings({ dreb: 20 })
    assert.ok(outOfPosition(r, 'PF', 'C').dreb > outOfPosition(r, 'PG', 'C').dreb)
    assert.ok(outOfPosition(r, 'PG', 'C').dreb >= 1)
  })
})

describe('offensive systems', () => {
  const squad: RolePlayer[] = [
    {
      playerId: 'pg',
      name: 'Guard',
      pos: 'PG',
      ratings: ratings({ passing: 76, handling: 74, iq: 70, three: 60 }),
      tendencies: tend({ usage: 0.24, assist: 0.4 }),
    },
    { playerId: 'sg', pos: 'SG', ratings: ratings({ three: 66 }), tendencies: tend() },
    { playerId: 'sf', pos: 'SF', ratings: ratings(), tendencies: tend() },
    { playerId: 'pf', pos: 'PF', ratings: ratings(), tendencies: tend() },
    {
      playerId: 'c',
      name: 'Big',
      pos: 'C',
      ratings: ratings({ close: 78, rim: 76, strength: 80, drawFoul: 74, three: 25 }),
      tendencies: tend({
        usage: 0.28,
        postUp: 0.5,
        shotRim: 0.42,
        shotClose: 0.32,
        shotMid: 0.22,
        shotThree: 0.04,
      }),
    },
  ]

  it('the system picks its own hub and ball-handler off the roster', () => {
    const roles = assignRoles(squad)
    assert.equal(roles.hubId, 'c')
    assert.equal(roles.handlerId, 'pg')
  })

  it('inside-out feeds the post and slows the game down', () => {
    const big = squad[4] as RolePlayer
    const after = systemTendencies('insideOut', big.tendencies, 'hub')
    assert.ok(after.usage > big.tendencies.usage * 1.3, 'he takes far more of the offence')
    assert.ok(after.shotClose > big.tendencies.shotClose * 1.3)
    assert.ok(after.shotThree < big.tendencies.shotThree)
    const tac = systemTactics('insideOut', {
      pace: 0,
      threes: 0,
      crashGlass: 0,
      pressure: 0,
      zone: false,
    })
    assert.equal(tac.pace, -1)
    assert.equal(tac.crashGlass, 1)
  })

  it('motion takes the ball out of the best player’s hands — that is the cost, not a bug', () => {
    const pg = squad[0] as RolePlayer
    const after = systemTendencies('motion', pg.tendencies, 'handler')
    assert.ok(after.usage < pg.tendencies.usage, 'the star shoots less')
    assert.ok(after.assist > pg.tendencies.assist)
    const sf = squad[2] as RolePlayer
    assert.ok(
      systemTendencies('motion', tend({ usage: 0.14 }), 'other').usage > 0.14,
      'and everyone else shoots more',
    )
    void sf
  })

  it('pick and roll funnels it through the handler and the roll man', () => {
    const pg = squad[0] as RolePlayer
    const big = squad[4] as RolePlayer
    assert.ok(
      systemTendencies('pickRoll', pg.tendencies, 'handler').usage > pg.tendencies.usage * 1.25,
    )
    const roll = systemTendencies('pickRoll', big.tendencies, 'hub')
    assert.ok(roll.shotRim > big.tendencies.shotRim * 1.3)
    assert.ok(roll.shotMid < big.tendencies.shotMid * 0.7)
  })

  it('pushing the tempo shoots earlier and from further out', () => {
    const after = systemTendencies('early', tend(), 'other')
    assert.ok(after.shotThree > tend().shotThree)
    assert.ok(after.shotMid < tend().shotMid)
    const tac = systemTactics('early', {
      pace: 0,
      threes: 0,
      crashGlass: 0,
      pressure: 0,
      zone: false,
    })
    assert.equal(tac.pace, 1)
    assert.equal(tac.crashGlass, -1)
  })

  it('the tactics a system asks for never leave the -1..1 the engine understands', () => {
    for (const id of OFFENSE_SYSTEM_IDS) {
      const tac = systemTactics(id, { pace: 1, threes: 1, crashGlass: 1, pressure: 1, zone: true })
      for (const v of [tac.pace, tac.threes, tac.crashGlass]) assert.ok(v >= -1 && v <= 1)
      assert.equal(tac.pressure, 1, 'the system is an offence; it does not touch the defence')
      assert.equal(tac.zone, true)
    }
  })
})

describe('the fit panel does not lie', () => {
  const postTeam: RolePlayer[] = [
    {
      playerId: 'c',
      name: 'Big',
      pos: 'C',
      ratings: ratings({ close: 78, rim: 76, strength: 80, drawFoul: 74, three: 25 }),
      tendencies: tend({
        usage: 0.3,
        postUp: 0.55,
        shotRim: 0.42,
        shotClose: 0.32,
        shotMid: 0.22,
        shotThree: 0.04,
      }),
    },
    ...['pg', 'sg', 'sf', 'pf'].map((id, i) => ({
      playerId: id,
      pos: (['PG', 'SG', 'SF', 'PF'] as Position[])[i] as Position,
      ratings: ratings({ three: 45, passing: 46, iq: 47 }),
      tendencies: tend(),
    })),
  ]
  const smallTeam: RolePlayer[] = ['pg', 'sg', 'sf', 'pf', 'c'].map((id, i) => ({
    playerId: id,
    pos: (['PG', 'SG', 'SF', 'PF', 'C'] as Position[])[i] as Position,
    ratings: ratings({
      three: 64,
      passing: 62,
      iq: 62,
      stamina: 66,
      speed: 64,
      close: 46,
      rim: 48,
      strength: 42,
    }),
    tendencies: tend(),
  }))

  it('balanced is always the 50 everything else is measured against', () => {
    assert.equal(systemFit('balanced', postTeam).score, 50)
    assert.equal(systemFit('balanced', smallTeam).score, 50)
  })

  it('a post team is offered the post offence and warned off ball movement', () => {
    assert.ok(systemFit('insideOut', postTeam).score > systemFit('insideOut', smallTeam).score + 4)
    assert.ok(systemFit('motion', postTeam).score < 50, 'motion is a misfit here and says so')
  })

  it('a shooting team is told to move the ball and not to post up', () => {
    assert.ok(systemFit('motion', smallTeam).score > 55)
    assert.ok(systemFit('insideOut', smallTeam).score <= 50)
  })

  it('every verdict comes with a sentence a person can read', () => {
    for (const id of OFFENSE_SYSTEM_IDS) {
      const fit = systemFit(id, postTeam)
      assert.ok(fit.lines.length > 0)
      for (const l of fit.lines) assert.ok(l.length > 12 && l.endsWith('.'))
      assert.ok(fit.score >= 0 && fit.score <= 100)
    }
  })

  it('the notes name the man, not his id', () => {
    const lines = systemFit('insideOut', postTeam).lines.join(' ')
    assert.ok(lines.includes('Big'), lines)
  })
})

describe('named units pick a group from the clock and the score', () => {
  it('starters open, bench takes the first TV timeout, starters close the quarter', () => {
    assert.equal(unitForSituation({ period: 1, clock: 720, margin: 0 }), 'starters')
    assert.equal(unitForSituation({ period: 1, clock: 300, margin: 0 }), 'bench')
    assert.equal(unitForSituation({ period: 1, clock: 60, margin: 0 }), 'starters')
    assert.equal(unitForSituation({ period: 2, clock: 700, margin: 0 }), 'bench')
  })

  it('a two-point fourth inside six minutes is the closing five', () => {
    assert.equal(unitForSituation({ period: 4, clock: 120, margin: 2 }), 'closing')
    assert.equal(unitForSituation({ period: 4, clock: 500, margin: 2 }), 'starters')
  })

  it('a blowout sits the stars, and a back-to-back sits them earlier', () => {
    assert.equal(unitForSituation({ period: 4, clock: 180, margin: 22 }), 'blowout')
    assert.equal(
      unitForSituation({ period: 4, clock: 180, margin: 15, starterCondition: 0.7 }),
      'blowout',
    )
    assert.equal(
      unitForSituation({ period: 4, clock: 120, margin: 2, starterCondition: 0.7 }),
      'closing',
      'a close game still closes, even on a back-to-back',
    )
  })
})

describe('unit tactics', () => {
  it('empty and missing both store as nothing', () => {
    assert.equal(normaliseUnitTactics(undefined), undefined)
    assert.equal(normaliseUnitTactics({}), undefined)
  })

  it('keeps a second unit that lights it up', () => {
    const got = normaliseUnitTactics({ bench: { pace: 1, threes: 1 } })
    assert.deepEqual(got, { bench: { pace: 1, threes: 1 } })
  })
})
