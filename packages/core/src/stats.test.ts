import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mean, normalCdf, pearson, percentile, sd, weightedMeanSd, zToRating } from './stats.ts'

test('mean and sd', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5)
  assert.ok(Math.abs(sd([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138) < 0.001)
})

test('pearson', () => {
  assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12)
  assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12)
})

test('weighted mean sd', () => {
  const r = weightedMeanSd([1, 3], [1, 3])
  assert.equal(r.mean, 2.5)
})

test('normalCdf', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7)
  assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3)
})

test('zToRating', () => {
  assert.equal(zToRating(0), 50)
  assert.equal(zToRating(2), 80)
  assert.equal(zToRating(-5), 0)
})

test('percentile', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
})
