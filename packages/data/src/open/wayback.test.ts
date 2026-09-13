import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nearestSnapshot, OPENING_NIGHT, rawSnapshotUrl, snapshotKey } from './wayback.ts'

test('nearestSnapshot picks the closest day, later on ties, null when empty', () => {
  const ts = ['20201208184504', '20201224215147', '20210105000000']
  assert.equal(nearestSnapshot(ts, '20201222'), '20201224215147')
  assert.equal(nearestSnapshot(ts, '20201210'), '20201208184504')
  assert.equal(nearestSnapshot(['20201220000000', '20201224000000'], '20201222'), '20201224000000')
  assert.equal(nearestSnapshot([], '20201222'), null)
})

test('snapshot urls and cache keys', () => {
  const s = { season_end: 2021, timestamp: '20201224215147' }
  assert.equal(
    rawSnapshotUrl(s),
    'https://web.archive.org/web/20201224215147id_/https://www.basketball-reference.com/contracts/players.html',
  )
  assert.equal(snapshotKey(s), 'contracts-players/2021-20201224215147.html')
  assert.deepEqual(Object.keys(OPENING_NIGHT).map(Number), [2021, 2022, 2023, 2024, 2025, 2026])
})
