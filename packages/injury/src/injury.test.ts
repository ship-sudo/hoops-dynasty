import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng, RATING_KEYS, type Ratings } from '@hoops/core'
import {
  CONDITION_FLOOR,
  conditionAfterReturn,
  injuryChance,
  injuryOutlook,
  LEAGUE_MISS_SHARE,
  lingeringPenalty,
  nextCondition,
  rollInjury,
  seasonAvailability,
} from './index.ts'

function withDurability(d: number): Ratings {
  const r = Object.fromEntries(RATING_KEYS.map((k) => [k, 50])) as unknown as Ratings
  r.durability = d
  return r
}

function missShare(durability: number, age = 27, mpg = 30, seasons = 400): number {
  const rng = makeRng(17)
  let missed = 0
  for (let i = 0; i < seasons; i++) {
    missed += seasonAvailability(withDurability(durability), age, mpg, 82, rng).gamesMissed
  }
  return missed / (seasons * 82)
}

test('an average player misses about a quarter of the season, as in the real data', () => {
  const share = missShare(50)
  assert.ok(
    Math.abs(share - LEAGUE_MISS_SHARE) < 0.05,
    `expected ~${LEAGUE_MISS_SHARE}, got ${share.toFixed(3)}`,
  )
})

test('durability separates iron men from the fragile', () => {
  const tough = missShare(90)
  const fragile = missShare(20)
  assert.ok(tough < 0.16, `an iron man should play most nights, missed ${tough.toFixed(3)}`)
  assert.ok(fragile > 0.32, `a fragile player should miss plenty, missed ${fragile.toFixed(3)}`)
  assert.ok(fragile > tough * 2)
})

test('age and minutes both add risk', () => {
  assert.ok(injuryChance(50, 35, 30) > injuryChance(50, 27, 30))
  assert.ok(injuryChance(50, 20, 30) > injuryChance(50, 25, 30))
  assert.ok(injuryChance(50, 27, 38) > injuryChance(50, 27, 14))
})

test('the load term is convex and the anchor is untouched', () => {
  // 30 minutes at full condition is the calibration point and must score exactly 1.
  const anchor = injuryChance(50, 27, 30, 1)
  const step = (a: number, b: number) => injuryChance(50, 27, b, 1) - injuryChance(50, 27, a, 1)
  assert.ok(step(38, 44) > step(24, 30), 'the last six minutes must cost more than the first six')
  assert.ok(injuryChance(50, 27, 48, 1) > anchor * 1.3, 'forty-eight minutes is not free')
  // The old formula capped the load at 42, so 42 and 48 were identical. They are not.
  assert.ok(injuryChance(50, 27, 48, 1) > injuryChance(50, 27, 42, 1))
})

test('a tired player gets hurt more', () => {
  const fresh = injuryChance(50, 27, 34, 1)
  const spent = injuryChance(50, 27, 34, 0.65)
  assert.ok(
    spent > fresh * 1.5,
    `tiredness should bite: ${fresh.toFixed(4)} -> ${spent.toFixed(4)}`,
  )
  assert.equal(injuryChance(50, 27, 34), fresh, 'full condition is the default')
})

test('years in the league add injury risk after the eighth season', () => {
  assert.equal(injuryChance(50, 27, 30, 1, 0), injuryChance(50, 27, 30, 1))
  assert.ok(injuryChance(50, 34, 30, 1, 14) > injuryChance(50, 34, 30, 1, 6))
})

test('injury outlook names a man who barely played last year', () => {
  assert.match(injuryOutlook(50, 28, 7, 18), /injury candidate/i)
  assert.match(injuryOutlook(90, 26, 5), /iron man/i)
})

test('a 35-year-old on 24 minutes is a managed night, not a pounding', () => {
  assert.match(injuryOutlook(50, 35, 14, 70, 24), /managed night/i)
  assert.doesNotMatch(injuryOutlook(50, 35, 14, 70, 36), /managed night/i)
})

test('condition holds at a sane load and slides at a mad one', () => {
  const hold = (minutes: number, games = 82) => {
    let c = 1
    for (let g = 0; g < games; g++)
      c = nextCondition({ condition: c, minutesPlayed: minutes, daysRest: 2, stamina: 50 })
    return c
  }
  assert.ok(hold(30) > 0.99, 'thirty minutes every other night is sustainable')
  assert.ok(hold(36) > 0.97, 'so is thirty-six, which is what the real minutes leaders play')
  assert.ok(hold(44) <= CONDITION_FLOOR + 1e-9, 'forty-four is not')
  assert.ok(hold(48) <= CONDITION_FLOOR + 1e-9)
})

test('rest recovers, back-to-backs do not, and stamina helps', () => {
  const tired = 0.8
  const oneDay = nextCondition({ condition: tired, minutesPlayed: 36, daysRest: 1, stamina: 50 })
  const threeDays = nextCondition({ condition: tired, minutesPlayed: 36, daysRest: 3, stamina: 50 })
  assert.ok(oneDay < tired, 'a back-to-back costs more than it gives back')
  assert.ok(threeDays > tired, 'a week off puts it back')
  const iron = nextCondition({ condition: tired, minutesPlayed: 44, daysRest: 2, stamina: 90 })
  const weak = nextCondition({ condition: tired, minutesPlayed: 44, daysRest: 2, stamina: 20 })
  assert.ok(iron > weak, 'stamina is what carries a heavy load')
  const capped = nextCondition({
    condition: 1,
    minutesPlayed: 0,
    daysRest: 4,
    stamina: 50,
    ceiling: 0.8,
  })
  assert.equal(capped, 0.8, 'a man working his way back cannot exceed his ceiling')
})

test('most absences are short, a few are seasons', () => {
  const rng = makeRng(5)
  const counts = { knock: 0, strain: 0, break: 0, season: 0 }
  for (let i = 0; i < 2000; i++) counts[rollInjury(rng, 50).severity]++
  assert.ok(counts.knock > counts.strain, 'knocks should dominate')
  assert.ok(counts.strain > counts.break)
  assert.ok(
    counts.season > 0 && counts.season < 200,
    `season-enders should be rare: ${counts.season}`,
  )
})

test('availability is deterministic for a seed', () => {
  const a = seasonAvailability(withDurability(50), 27, 32, 82, makeRng(3))
  const b = seasonAvailability(withDurability(50), 27, 32, 82, makeRng(3))
  assert.deepEqual(a, b)
})

test('a short season means fewer games missed', () => {
  const rng = makeRng(8)
  const lockout = seasonAvailability(withDurability(50), 27, 32, 50, rng)
  assert.ok(lockout.gamesAvailable + lockout.gamesMissed === 50)
})

test('condition ramps back up after a return, slower for serious injuries', () => {
  const rng = makeRng(2)
  let acl = rollInjury(rng, 50)
  while (acl.severity !== 'season') acl = rollInjury(rng, 50)
  assert.ok(conditionAfterReturn(acl, 0) < 0.7)
  assert.ok(conditionAfterReturn(acl, 5) < conditionAfterReturn(acl, 20))
  assert.equal(conditionAfterReturn(acl, 40), 1)
})

test('only serious injuries leave a mark, and it is worse for old players', () => {
  const rng = makeRng(4)
  let knock = rollInjury(rng, 50)
  while (knock.severity !== 'knock') knock = rollInjury(rng, 50)
  assert.deepEqual(lingeringPenalty(knock, 30), {})
  let acl = rollInjury(rng, 50)
  while (acl.severity !== 'season') acl = rollInjury(rng, 50)
  const young = lingeringPenalty(acl, 24)
  const old = lingeringPenalty(acl, 34)
  assert.ok((young.speed ?? 0) < 0)
  assert.ok((old.speed ?? 0) < (young.speed ?? 0))
})
