import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeRng } from './rng.ts'

test('same seed, same sequence', () => {
  const a = makeRng(42),
    b = makeRng(42)
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next())
})

test('different seeds differ', () => {
  assert.notEqual(makeRng(1).next(), makeRng(2).next())
})

test('uniform-ish in [0,1)', () => {
  const r = makeRng(7)
  let sum = 0
  const n = 100_000
  for (let i = 0; i < n; i++) {
    const x = r.next()
    assert.ok(x >= 0 && x < 1)
    sum += x
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01)
})

test('normal has right moments', () => {
  const r = makeRng(9)
  const n = 100_000
  let s = 0,
    s2 = 0
  for (let i = 0; i < n; i++) {
    const x = r.normal(10, 2)
    s += x
    s2 += x * x
  }
  const mean = s / n,
    sd = Math.sqrt(s2 / n - mean * mean)
  assert.ok(Math.abs(mean - 10) < 0.05)
  assert.ok(Math.abs(sd - 2) < 0.05)
})

test('weighted respects weights', () => {
  const r = makeRng(3)
  const counts = [0, 0, 0]
  for (let i = 0; i < 30_000; i++) counts[r.weighted([1, 2, 7])]!++
  assert.ok(Math.abs(counts[2]! / 30_000 - 0.7) < 0.02)
})

test('state round-trips', () => {
  const a = makeRng(11)
  a.next()
  a.next()
  const b = makeRng(a.state())
  assert.equal(a.next(), b.next())
})
