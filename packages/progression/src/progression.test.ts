import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng, RATING_KEYS, type Ratings, type Tendencies } from '@hoops/core'
import {
  blendToFate,
  curveFor,
  develop,
  draftPotential,
  overall,
  retireChance,
  retires,
  roleRating,
} from './index.ts'

function flat(v: number): Ratings {
  return Object.fromEntries(RATING_KEYS.map((k) => [k, v])) as unknown as Ratings
}

const TEND: Tendencies = {
  usage: 0.2,
  shotRim: 0.32,
  shotClose: 0.13,
  shotMid: 0.3,
  shotThree: 0.25,
  assist: 0.2,
  postUp: 0.1,
}

test('curves exist across the playable age range and are smooth', () => {
  for (let age = 18; age <= 44; age++) {
    const c = curveFor(age)
    for (const k of RATING_KEYS) {
      assert.ok(Number.isFinite(c.delta[k]), `${age} ${k} delta`)
      assert.ok((c.sd[k] ?? 0) >= 1, `${age} ${k} sd`)
    }
  }
  // Speed should fall faster at 33 than at 23 — the data says so, smoothing must not erase it.
  assert.ok((curveFor(33).delta.speed ?? 0) < (curveFor(23).delta.speed ?? 0))
})

test('young players with headroom improve, old players decline', () => {
  const rng = makeRng(7)
  let youngGain = 0
  let oldGain = 0
  for (let i = 0; i < 200; i++) {
    const young = develop({ ratings: flat(50), age: 21, potential: 75, minutes: 2000, rng })
    const old = develop({ ratings: flat(50), age: 34, potential: 55, minutes: 2000, rng })
    youngGain += overall(young.ratings) - 50
    oldGain += overall(old.ratings) - 50
  }
  assert.ok(youngGain / 200 > 0.5, `young should improve, got ${(youngGain / 200).toFixed(2)}`)
  assert.ok(oldGain / 200 < 0, `34-year-old should decline, got ${(oldGain / 200).toFixed(2)}`)
})

test('potential caps growth: a capped prospect gains less than an open one', () => {
  const rng = makeRng(11)
  let capped = 0
  let open = 0
  for (let i = 0; i < 200; i++) {
    capped += overall(
      develop({ ratings: flat(50), age: 21, potential: 52, minutes: 2000, rng }).ratings,
    )
    open += overall(
      develop({ ratings: flat(50), age: 21, potential: 85, minutes: 2000, rng }).ratings,
    )
  }
  assert.ok(open / 200 > capped / 200 + 1, `open ${open / 200} vs capped ${capped / 200}`)
})

test('minutes matter: a deep reserve develops more slowly', () => {
  const rng = makeRng(3)
  let starter = 0
  let reserve = 0
  for (let i = 0; i < 200; i++) {
    starter += overall(
      develop({ ratings: flat(50), age: 22, potential: 80, minutes: 2400, rng }).ratings,
    )
    reserve += overall(
      develop({ ratings: flat(50), age: 22, potential: 80, minutes: 200, rng }).ratings,
    )
  }
  assert.ok(starter / 200 > reserve / 200, `starter ${starter / 200} vs reserve ${reserve / 200}`)
})

test('development is deterministic for a given seed', () => {
  const a = develop({ ratings: flat(50), age: 23, potential: 70, minutes: 1800, rng: makeRng(42) })
  const b = develop({ ratings: flat(50), age: 23, potential: 70, minutes: 1800, rng: makeRng(42) })
  assert.deepEqual(a, b)
})

test('ratings stay inside 5–99 even after a long career', () => {
  const rng = makeRng(5)
  let r = flat(90)
  for (let age = 22; age <= 40; age++)
    r = develop({ ratings: r, age, potential: 99, minutes: 2500, rng }).ratings
  for (const k of RATING_KEYS) {
    assert.ok(r[k] >= 5 && r[k] <= 99, `${k} out of range: ${r[k]}`)
  }
})

test('retirement rises with age and falls with quality', () => {
  assert.ok(retireChance(38, flat(50), 1000) > retireChance(27, flat(50), 1000))
  assert.ok(retireChance(34, flat(35), 400) > retireChance(34, flat(80), 2400))
  assert.ok(retireChance(41, flat(80), 2000) >= 0.45, 'everyone is close to done at 41')
  const rng = makeRng(9)
  let count = 0
  for (let i = 0; i < 500; i++)
    if (retires({ age: 24, ratings: flat(60), minutes: 2000, rng })) count++
  assert.ok(count < 150, `24-year-old starters should rarely retire, got ${count}/500`)
})

test('a good young player is safer than a good old one, at every age', () => {
  // This used to be upside down: a 60-overall 24-year-old was 2.5x more likely to leave the league
  // than the same player at 34, so the mean age fell year on year and the best ratings drained away.
  const at = (age: number) => retireChance(age, flat(60), 1500)
  for (let age = 23; age <= 38; age++) {
    assert.ok(
      at(age) >= at(22) - 1e-9,
      `${age} should not be safer than 22: ${at(age).toFixed(4)} vs ${at(22).toFixed(4)}`,
    )
  }
  assert.ok(
    at(34) > at(24) * 1.6,
    `34 ${at(34).toFixed(4)} should clearly beat 24 ${at(24).toFixed(4)}`,
  )
  assert.ok(at(24) < 0.03, `a 60-overall 24-year-old starter should almost never go, got ${at(24)}`)
  assert.ok(at(22) < at(30) && at(30) < at(36), 'the whole curve should slope up with age')
})

test('a fringe player still washes out, or nobody ever leaves', () => {
  assert.ok(retireChance(24, flat(40), 300) > 0.2, 'a replacement-level 24-year-old is not safe')
  assert.ok(retireChance(24, flat(40), 300) > retireChance(24, flat(60), 300) * 5)
})

test('roleRating judges a player at his position, not on a flat mean', () => {
  // A rebounding specialist: elite on the glass, poor everywhere else. A flat mean buries him.
  const rodman = { ...flat(40), oreb: 87, dreb: 99, strength: 64, perimD: 48, interiorD: 49 }
  const adequate = flat(56)
  assert.ok(
    overall(adequate) > overall(rodman),
    'the flat mean prefers the man who is adequate at everything — that is the bug',
  )
  assert.ok(
    roleRating(rodman, { ...TEND, usage: 0.09 }, 'PF') >
      roleRating(adequate, { ...TEND, usage: 0.09 }, 'PF'),
    'at power forward, the rebounding champion should win',
  )
})

test('roleRating pays for volume and for the right skills at the right spot', () => {
  const scorer = { ...flat(50), rim: 80, close: 75, mid: 72, three: 70, ft: 75, drawFoul: 70 }
  const low = roleRating(scorer, { ...TEND, usage: 0.12 }, 'SG')
  const high = roleRating(scorer, { ...TEND, usage: 0.32 }, 'SG')
  assert.ok(
    high > low + 3,
    `carrying the offence should pay: ${low.toFixed(1)} -> ${high.toFixed(1)}`,
  )

  // The same man is worth more where his skills are wanted.
  const big = { ...flat(45), oreb: 80, dreb: 82, interiorD: 85, block: 85, strength: 80 }
  assert.ok(roleRating(big, TEND, 'C') > roleRating(big, TEND, 'PG'))
  const guard = { ...flat(45), passing: 85, handling: 80, three: 80, perimD: 78, steal: 80 }
  assert.ok(roleRating(guard, TEND, 'PG') > roleRating(guard, TEND, 'C'))
})

test('roleRating stays inside its scale', () => {
  for (const pos of ['PG', 'SG', 'SF', 'PF', 'C'] as const) {
    for (const v of [5, 50, 99]) {
      const r = roleRating(flat(v), TEND, pos)
      assert.ok(r >= 5 && r <= 99 && Number.isFinite(r), `${pos} ${v} -> ${r}`)
    }
    // An average man at an average load should sit near the middle of the scale.
    const mid = roleRating(flat(50), TEND, pos)
    assert.ok(mid > 25 && mid < 70, `${pos} average should be mid-scale, got ${mid.toFixed(1)}`)
  }
})

test('fate 0 keeps the real career, fate 100 keeps the model, 50 sits between', () => {
  const model = flat(80)
  const real = flat(40)
  assert.deepEqual(blendToFate(model, real, 0), real)
  assert.deepEqual(blendToFate(model, real, 100), model)
  assert.equal(blendToFate(model, real, 50).three, 60)
  assert.deepEqual(blendToFate(model, null, 0), model, 'no real career means the model decides')
})

test('a star with years left on his real career does not randomly retire', () => {
  const star = retireChance(28, flat(80), 2500, { lastRealYear: 2016, yearEnd: 2004, fate: 0 })
  assert.ok(star <= 0.002 + 1e-9, `Duncan in 2004 should stay, got ${star}`)
  const done = retireChance(37, flat(55), 800, { lastRealYear: 2004, yearEnd: 2004, fate: 0 })
  assert.ok(done >= 0.7, `his last real season should usually be the end, got ${done}`)
  const model = retireChance(34, flat(60), 1500)
  const biased = retireChance(34, flat(60), 1500, { lastRealYear: 2016, yearEnd: 2008, fate: 100 })
  assert.ok(biased < model, 'even at fate 100, years left on the book cut the chance')
})

test('draft potential leaves room for young prospects and never sits below current form', () => {
  const rng = makeRng(2)
  const young = draftPotential(flat(45), 19, rng)
  const old = draftPotential(flat(45), 24, rng)
  assert.ok(young >= 45 && old >= 45)
  let youngSum = 0
  let oldSum = 0
  for (let i = 0; i < 100; i++) {
    youngSum += draftPotential(flat(45), 19, rng)
    oldSum += draftPotential(flat(45), 24, rng)
  }
  assert.ok(youngSum / 100 > oldSum / 100, 'younger prospects should carry more headroom')
})
