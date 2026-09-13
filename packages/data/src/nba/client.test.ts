import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cacheKey, parseNba, seasonId } from './client.ts'

test('seasonId', () => {
  assert.equal(seasonId(1998), '1997-98')
  assert.equal(seasonId(2000), '1999-00')
  assert.equal(seasonId(2026), '2025-26')
})

test('cacheKey drops empty params and is stable', () => {
  const k = cacheKey('leaguedashplayerstats', {
    Season: '2003-04',
    SeasonType: 'Regular Season',
    College: '',
    TeamID: 0,
  })
  assert.equal(k, 'leaguedashplayerstats/Season=2003-04&SeasonType=Regular_Season.json')
})

test('parseNba maps headers to rows', () => {
  const body = JSON.stringify({
    resultSets: [
      {
        name: 'X',
        headers: ['A', 'B'],
        rowSet: [
          [1, 'x'],
          [2, null],
        ],
      },
    ],
  })
  const r = parseNba(body)
  assert.deepEqual(r.X, [
    { A: 1, B: 'x' },
    { A: 2, B: null },
  ])
})
