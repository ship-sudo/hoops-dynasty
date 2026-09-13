import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { type HistoryBundle, makeRng } from '@hoops/core'
import { overall } from '@hoops/progression'
import {
  classFor,
  fictionalClass,
  foreignShare,
  historicalClass,
  NameBank,
  pickOrigin,
  scout,
  scoutedBoard,
  undraftedFillers,
} from './index.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
let history: HistoryBundle | null = null
try {
  history = JSON.parse(readFileSync(join(dataDir, 'bundles', 'history.json'), 'utf8'))
} catch {
  history = null // the data pipeline has not been run in this checkout
}

test('fictional classes thin out down the board', () => {
  const rng = makeRng(1)
  const cls = fictionalClass(2030, rng)
  assert.equal(cls.length, 58)
  const top = cls.slice(0, 10).reduce((a, p) => a + overall(p.ratings), 0) / 10
  const back = cls.slice(-10).reduce((a, p) => a + overall(p.ratings), 0) / 10
  assert.ok(top > back + 5, `lottery should beat the back of the second round: ${top} vs ${back}`)
  for (const p of cls) {
    assert.ok(p.potential >= overall(p.ratings), 'potential is a ceiling, never below current form')
    assert.ok(p.age >= 19 && p.age <= 22)
    assert.equal(p.origin, 'fictional')
  }
})

test('fictional classes are deterministic and archetypes differ', () => {
  assert.deepEqual(fictionalClass(2030, makeRng(5)), fictionalClass(2030, makeRng(5)))
  const cls = fictionalClass(2030, makeRng(8), { size: 40 })
  const bigs = cls.filter((p) => p.pos === 'C')
  const guards = cls.filter((p) => p.pos === 'PG')
  if (bigs.length && guards.length) {
    const bigRim = bigs.reduce((a, p) => a + p.ratings.rim, 0) / bigs.length
    const guardPass = guards.reduce((a, p) => a + p.ratings.passing, 0) / guards.length
    const bigPass = bigs.reduce((a, p) => a + p.ratings.passing, 0) / bigs.length
    assert.ok(guardPass > bigPass, 'guards should pass better than centres')
    assert.ok(bigRim > 40)
  }
})

test('scouting adds fog: weak departments are further from the truth', () => {
  const rng = makeRng(3)
  const [p] = fictionalClass(2030, rng, { size: 1 })
  const prospect = p!
  let goodErr = 0
  let badErr = 0
  for (let i = 0; i < 300; i++) {
    goodErr += Math.abs(overall(scout(prospect, 90, rng, 3).ratings) - overall(prospect.ratings))
    badErr += Math.abs(overall(scout(prospect, 20, rng, 3).ratings) - overall(prospect.ratings))
  }
  assert.ok(
    badErr > goodErr * 1.5,
    `weak scouting should be wronger: ${badErr / 300} vs ${goodErr / 300}`,
  )
})

test('the back of the board is scouted worse than the top', () => {
  const rng = makeRng(4)
  const [p] = fictionalClass(2030, rng, { size: 1 })
  const prospect = p!
  let topErr = 0
  let backErr = 0
  for (let i = 0; i < 300; i++) {
    topErr += Math.abs(overall(scout(prospect, 60, rng, 2).ratings) - overall(prospect.ratings))
    backErr += Math.abs(overall(scout(prospect, 60, rng, 55).ratings) - overall(prospect.ratings))
  }
  assert.ok(
    backErr > topErr,
    `deep sleepers should be murkier: ${backErr / 300} vs ${topErr / 300}`,
  )
})

test('a scouted board hides true ratings but stays roughly sorted', () => {
  const rng = makeRng(6)
  const cls = fictionalClass(2030, rng)
  const board = scoutedBoard(cls, 75, rng)
  assert.equal(board.length, cls.length)
  assert.ok(!('potential' in board[0]!), 'true potential must not leak onto the board')
  const topTruth =
    board.slice(0, 12).reduce((a, p) => {
      const real = cls.find((c) => c.prospectId === p.prospectId)!
      return a + overall(real.ratings)
    }, 0) / 12
  const backTruth =
    board.slice(-12).reduce((a, p) => {
      const real = cls.find((c) => c.prospectId === p.prospectId)!
      return a + overall(real.ratings)
    }, 0) / 12
  assert.ok(topTruth > backTruth, 'a decent department should still sort the class broadly right')
})

test('historical class: 2003 contains LeBron at the top with real headroom', {
  skip: !history,
}, () => {
  const rng = makeRng(2)
  const cls = historicalClass(history!, 2003, rng)
  assert.ok(cls.length > 30, `expected a full class, got ${cls.length}`)
  const lebron = cls.find((p) => p.name === 'LeBron James')
  assert.ok(lebron, 'LeBron should be in the 2003 class')
  assert.equal(lebron!.realPick, 1)
  assert.equal(lebron!.origin, 'historical')
  assert.ok(lebron!.age <= 19, `he was 18 on draft night, got ${lebron!.age}`)
  assert.ok(
    lebron!.potential > overall(lebron!.ratings) + 10,
    'his ceiling should be far above his rookie form',
  )
  // Darko went second and did not become LeBron: the class must not be sorted by outcome.
  const darko = cls.find((p) => p.name.startsWith('Darko'))
  if (darko) assert.ok(darko.potential < lebron!.potential)
})

test('classFor falls back to a fictional class when history runs out', { skip: !history }, () => {
  const rng = makeRng(7)
  const future = classFor(history!, 2999, rng, 'historical')
  assert.ok(future.length > 0)
  assert.equal(future[0]?.origin, 'fictional')
  const real = classFor(history!, 2003, rng, 'historical')
  assert.equal(real[0]?.origin, 'historical')
  const forced = classFor(history!, 2003, rng, 'fictional')
  assert.equal(forced[0]?.origin, 'fictional', 'fictional mode ignores history entirely')
})

test('undrafted fillers are replacement level, not prospects', () => {
  const rng = makeRng(31)
  const fillers = undraftedFillers(2005, rng, 200)
  const draftees = fictionalClass(2005, rng, { size: 58 })
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const fillerOv = mean(fillers.map((p) => overall(p.ratings)))
  const lotteryOv = mean(draftees.slice(0, 14).map((p) => overall(p.ratings)))

  assert.ok(
    fillerOv < lotteryOv - 6,
    `fillers (${fillerOv.toFixed(1)}) must be well below lottery picks (${lotteryOv.toFixed(1)})`,
  )
  assert.ok(fillerOv > 30, 'but they are still NBA players')
  // Headroom is the dangerous part: these men flooded the league because they all grew into stars.
  const ceilings = fillers.map((p) => p.potential)
  assert.ok(mean(ceilings) < fillerOv + 4, 'the typical filler has almost nothing left to find')
  assert.ok(Math.max(...ceilings) <= 70, 'and none of them is a future MVP')
  assert.ok(
    ceilings.filter((c) => c > fillerOv + 8).length < fillers.length / 6,
    'late bloomers should be rare',
  )
})

test('the scouting range is about the ceiling, and tracks it', () => {
  const rng = makeRng(77)
  const cls = fictionalClass(2030, rng, { size: 60 })
  // Across a class, where a department puts the middle of its range should follow the truth.
  const points = cls.map((p) => {
    const seen = scout(p, 70, rng, 10)
    return { truth: p.potential, mid: (seen.potentialLow + seen.potentialHigh) / 2 }
  })
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const mt = mean(points.map((p) => p.truth))
  const mm = mean(points.map((p) => p.mid))
  const cov = mean(points.map((p) => (p.truth - mt) * (p.mid - mm)))
  const sdT = Math.sqrt(mean(points.map((p) => (p.truth - mt) ** 2)))
  const sdM = Math.sqrt(mean(points.map((p) => (p.mid - mm) ** 2)))
  const r = cov / (sdT * sdM)
  assert.ok(r > 0.6, `the range must track real potential, correlation was ${r.toFixed(2)}`)
})

test('a better department reports a tighter, truer range', () => {
  const rng = makeRng(5)
  const [p] = fictionalClass(2030, rng, { size: 1 })
  const prospect = p!
  const width = (scouting: number) => {
    let w = 0
    let err = 0
    for (let i = 0; i < 200; i++) {
      const s = scout(prospect, scouting, rng, 8)
      w += s.potentialHigh - s.potentialLow
      err += Math.abs((s.potentialLow + s.potentialHigh) / 2 - prospect.potential)
    }
    return { width: w / 200, err: err / 200 }
  }
  const good = width(90)
  const poor = width(20)
  assert.ok(
    good.width < poor.width,
    `good scouts report a tighter band: ${good.width} vs ${poor.width}`,
  )
  assert.ok(good.err < poor.err, `and a closer one: ${good.err} vs ${poor.err}`)
})

test('a scouting report never claims a ceiling below what it can already see', () => {
  const rng = makeRng(9)
  for (const p of fictionalClass(2030, rng, { size: 40 })) {
    const s = scout(p, 30, rng, 50)
    const seen = Math.round(overall(s.ratings))
    assert.ok(s.potentialLow >= seen - 1, `low ${s.potentialLow} vs seen ${seen}`)
    assert.ok(s.potentialHigh > s.potentialLow)
  }
})

test('invented players have names a person could remember', () => {
  const rng = makeRng(4)
  const cls = fictionalClass(2030, rng)
  for (const p of cls) {
    assert.ok(
      /^\p{Lu}[\p{L}'’.-]+( \p{Lu}\.)? \p{Lu}[\p{L}'’ .-]+$/u.test(p.name),
      `not a name: ${p.name}`,
    )
    assert.ok(!/\d/.test(p.name), `a name should hold no digits: ${p.name}`)
    assert.ok(
      !/shot creator|stretch four|rim-running|three-and-D|raw athlete|lead guard/.test(p.name),
    )
  }
  const unique = new Set(cls.map((p) => p.name))
  assert.equal(unique.size, cls.length, 'no two players in a class share a name')
})

test('a name belongs to one man in a league, across classes and years', () => {
  const rng = makeRng(11)
  // One bank per league is the contract: share it and nobody is ever handed a name twice.
  const bank = new NameBank()
  const seen = new Set<string>()
  for (let year = 2030; year < 2045; year++) {
    for (const p of [
      ...fictionalClass(year, rng, { bank }),
      ...undraftedFillers(year, rng, 60, bank),
    ]) {
      assert.ok(!seen.has(p.name), `${p.name} was handed out twice`)
      seen.add(p.name)
    }
  }
  assert.ok(seen.size > 1500, `expected a deep pool, only made ${seen.size}`)
})

test('the league sounds like its era', () => {
  // The foreign share grows from about a tenth in 1998 to about a third by the mid-2020s.
  assert.ok(foreignShare(1998) < 0.15)
  assert.ok(foreignShare(2025) > 0.25)
  assert.ok(foreignShare(2010) > foreignShare(1999))

  const count = (year: number) => {
    const rng = makeRng(year)
    let foreign = 0
    for (let i = 0; i < 400; i++) if (pickOrigin(year, rng) !== 'us') foreign++
    return foreign / 400
  }
  assert.ok(count(2024) > count(1998) + 0.08, 'a 2024 class should not sound like a 1998 one')
})

test('a name bank can be told which names are already taken', () => {
  const bank = new NameBank()
  const rng = makeRng(3)
  const taken: string[] = []
  for (let i = 0; i < 50; i++) taken.push(bank.next(2005, rng))
  const fresh = new NameBank()
  fresh.reserve(taken)
  for (let i = 0; i < 50; i++) {
    const name = fresh.next(2005, rng)
    assert.ok(!taken.includes(name), `${name} was already in the league`)
  }
})
