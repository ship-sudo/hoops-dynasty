import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deriveStints, type GameLine } from './stints.ts'

const g = (
  player_id: number,
  team_id: number,
  game_date: string,
  game_id: string,
  min: number,
  pts: number,
): GameLine => ({ player_id, team_id, game_date, game_id, min, pts, fga: 10, ast: null })

test('stints follow team changes in date order, first team is stint 1', () => {
  const rows: GameLine[] = [
    g(1, 20, '1998-01-10', '003', 30, 12), // traded to 20
    g(1, 10, '1997-11-01', '001', 35, 20),
    g(1, 10, '1997-11-03', '002', 33, 18),
    g(1, 20, '1998-01-12', '004', 28, 9),
    g(1, 10, '1998-03-01', '005', 20, 5), // back to 10: third stint
    g(2, 30, '1997-11-01', '001', 12, 4),
  ]
  const stints = deriveStints(rows)
  const p1 = stints.filter((s) => s.playerId === '1')
  assert.deepEqual(
    p1.map((s) => [s.teamId, s.order, s.gp, s.min, s.totals.pts]),
    [
      ['10', 1, 2, 68, 38],
      ['20', 2, 2, 58, 21],
      ['10', 3, 1, 20, 5],
    ],
  )
  assert.equal(p1[0]?.firstDate, '1997-11-01')
  assert.equal(p1[0]?.lastDate, '1997-11-03')
  assert.equal(p1[0]?.totals.fga, 20)
  assert.equal(p1[0]?.totals.ast, 0) // nulls read as 0
  const p2 = stints.filter((s) => s.playerId === '2')
  assert.equal(p2.length, 1)
  assert.equal(p2[0]?.order, 1)
})

test('same-day rows order by game id', () => {
  const rows: GameLine[] = [
    g(1, 20, '1997-11-01', '002', 1, 0),
    g(1, 10, '1997-11-01', '001', 1, 0),
  ]
  const s = deriveStints(rows)
  assert.deepEqual(
    s.map((x) => x.teamId),
    ['10', '20'],
  )
})
