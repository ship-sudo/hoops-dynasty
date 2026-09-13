import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Contract } from '@hoops/core'
import { canSign, canWaive, deadFromWaive } from './transactions.ts'

const deal = (over: Partial<Contract> = {}): Contract => ({
  teamId: 'SAS',
  kind: 'standard',
  source: 'generated',
  years: [
    { yearEnd: 2004, amount: 5_000_000, option: null, guaranteed: true },
    { yearEnd: 2005, amount: 5_500_000, option: null, guaranteed: true },
    { yearEnd: 2006, amount: 6_000_000, option: null, guaranteed: false },
  ],
  ...over,
})

test('a waiver leaves guaranteed years on the cap and drops the rest', () => {
  const dead = deadFromWaive('SAS', deal(), 2004)
  assert.deepEqual(
    dead.map((d) => d.yearEnd),
    [2004, 2005],
  )
  assert.equal(
    dead.reduce((a, d) => a + d.amount, 0),
    10_500_000,
  )
  assert.equal(deadFromWaive('SAS', null, 2004).length, 0)
})

test('you cannot cut below the minimum or sign past the maximum', () => {
  const rules = { roster_min: 13, roster_max: 15 }
  assert.equal(canWaive(13, rules).ok, false)
  assert.equal(canWaive(14, rules).ok, true)
  assert.equal(canSign(15, rules).ok, false)
  assert.equal(canSign(14, rules).ok, true)
})
