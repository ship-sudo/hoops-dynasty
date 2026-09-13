import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contractKind, inferYears } from './contracts-infer.ts'

test('inferYears follows raises inside the band and stops at a jump or a gap', () => {
  const h = new Map<number, number>([
    [2005, 1_000_000],
    [2006, 1_080_000], // 8% raise: same deal
    [2007, 1_160_000],
    [2008, 5_000_000], // new deal
    [2009, 5_400_000],
    [2011, 5_800_000], // 2010 missing: gap ends the run
  ])
  assert.deepEqual(
    inferYears(h, 2005).map((y) => [y.yearEnd, y.amount]),
    [
      [2005, 1_000_000],
      [2006, 1_080_000],
      [2007, 1_160_000],
    ],
  )
  assert.deepEqual(
    inferYears(h, 2008).map((y) => y.yearEnd),
    [2008, 2009],
  )
  assert.deepEqual(inferYears(h, 2010), [])
  assert.deepEqual(
    inferYears(h, 2011).map((y) => y.yearEnd),
    [2011],
  )
})

test('inferYears caps the run', () => {
  const h = new Map<number, number>()
  for (let y = 2000; y < 2010; y++) h.set(y, 2_000_000)
  assert.equal(inferYears(h, 2000).length, 5)
  assert.equal(inferYears(h, 2000, 3).length, 3)
})

test('contractKind from era minimums and rookie scale', () => {
  // 2019-20 era money: 0-yr minimum 898,310; 10-yr minimum 2,564,753; 2017 draft #1 scale 5,855,200.
  const base = {
    yearEnd: 2020,
    draftYear: null,
    draftRound: null,
    minSalary0yr: 898_310,
    minSalary10yr: 2_564_753,
    rookieScalePick1: 5_855_200,
  }
  assert.equal(contractKind({ ...base, amount: 10_000_000 }), 'standard')
  assert.equal(contractKind({ ...base, amount: 2_564_753 }), 'minimum')
  assert.equal(contractKind({ ...base, amount: 1_620_564 }), 'minimum') // 2-yr vet minimum
  assert.equal(contractKind({ ...base, amount: 2_700_000 }), 'standard')
  assert.equal(contractKind({ ...base, amount: 400_000 }), 'two_way')
  assert.equal(contractKind({ ...base, amount: 400_000, yearEnd: 2010 }), 'minimum')
  // First-round pick of 2017: seasons 2018–2021 on the scale are rookie_scale.
  const rookie = { ...base, amount: 4_000_000, draftYear: 2017, draftRound: 1 }
  assert.equal(contractKind({ ...rookie, yearEnd: 2018 }), 'rookie_scale')
  assert.equal(contractKind({ ...rookie, yearEnd: 2021 }), 'rookie_scale')
  assert.equal(contractKind({ ...rookie, yearEnd: 2022 }), 'standard')
  assert.equal(contractKind({ ...rookie, draftRound: 2 }), 'standard')
  // A first-round pick paid far above the scale is not on a rookie deal (renegotiated or extended).
  assert.equal(contractKind({ ...rookie, amount: 12_000_000 }), 'standard')
  // Unknown scale (draft before the table): the season rule alone decides.
  assert.equal(
    contractKind({ ...rookie, amount: 12_000_000, rookieScalePick1: null }),
    'rookie_scale',
  )
})
