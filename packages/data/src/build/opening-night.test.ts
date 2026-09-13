import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openingNightRosters, type StintSummary } from './opening-night.ts'

const st = (playerId: string, teamId: string, order: number, min: number): StintSummary => ({
  playerId,
  teamId,
  order,
  gp: 1,
  min,
})

test('first stint wins; roster-only players join with source roster', () => {
  const stints = [
    st('a', 'T1', 1, 1000),
    st('a', 'T2', 2, 500), // traded: stays on T1 for opening night
    st('b', 'T2', 1, 800),
    st('c', 'T1', 1, 10),
  ]
  const rosters = [
    { playerId: 'z', teamId: 'T2' }, // never played: joins T2
    { playerId: 'a', teamId: 'T2' }, // season-end roster of a traded player: ignored
  ]
  const { entries, dropped } = openingNightRosters(stints, rosters)
  assert.deepEqual(
    entries.map((e) => [e.playerId, e.teamId, e.source]),
    [
      ['a', 'T1', 'stint'],
      ['c', 'T1', 'stint'],
      ['b', 'T2', 'stint'],
      ['z', 'T2', 'roster'],
    ],
  )
  assert.equal(dropped.length, 0)
})

test('cap keeps the most-used players and drops the rest', () => {
  const stints: StintSummary[] = []
  for (let i = 0; i < 22; i++) stints.push(st(`p${i}`, 'T1', 1, 100 - i))
  const rosters = [{ playerId: 'r', teamId: 'T1' }]
  const { entries, dropped } = openingNightRosters(stints, rosters, 20)
  assert.equal(entries.length, 20)
  assert.deepEqual(dropped.map((d) => d.playerId).sort(), ['p20', 'p21', 'r'])
  assert.ok(entries.every((e) => e.playerId !== 'r'))
})

test('preseason zeros keep last-year minutes and last summer’s draftee, not low ids', () => {
  const ids = ['1640001', '1640002', '2544', '203954', '1642889']
  const rosters = ids.map((playerId) => ({ playerId, teamId: 'PHI' }))
  const weight = new Map([
    ['2544', 1988],
    ['203954', 1197],
    ['1642889', 1_000_000 - 22 * 1000],
    ['1640001', 0],
    ['1640002', 0],
  ])
  const { entries, dropped } = openingNightRosters([], rosters, 3, weight)
  assert.deepEqual(
    entries.map((e) => e.playerId).sort(),
    ['1642889', '203954', '2544'].sort(),
  )
  assert.ok(dropped.some((d) => d.playerId === '1640001'))
})
