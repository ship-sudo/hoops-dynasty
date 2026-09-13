import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RosterRow } from '../sim/api.ts'
import {
  cannotDress,
  injuryOptionTag,
  remainingTeamGames,
  returnWhen,
  trainerRows,
} from './tacticsHealth.ts'

const injury = (
  name: string,
  games: number,
  extra: Partial<NonNullable<RosterRow['injury']>> = {},
): NonNullable<RosterRow['injury']> => ({
  name,
  games,
  warning: false,
  ...extra,
})

test('a short absence is back in N games, not the season', () => {
  const hit = returnWhen(injury('hamstring strain', 6), 'strain', 40)
  assert.equal(hit.kind, 'out')
  assert.equal(hit.when, 'Back in 6 games')
})

test('one game left is back next game', () => {
  assert.equal(returnWhen(injury('ankle', 1), 'knock', 40).when, 'Back next game')
})

test('a catalogue season injury is out for the year even with games left', () => {
  const hit = returnWhen(injury('torn ACL', 50), 'season', 60)
  assert.equal(hit.kind, 'season')
  assert.equal(hit.when, 'Out for the season')
})

test('missing more games than the club has left is out for the season', () => {
  const hit = returnWhen(injury('broken hand', 20), 'break', 12)
  assert.equal(hit.kind, 'season')
})

test('a knock he can dress is day-to-day, not out', () => {
  const hit = returnWhen(injury('sprained ankle', 2, { warning: true }), 'knock', 40)
  assert.equal(hit.kind, 'dtd')
  assert.match(hit.when, /can dress/)
  assert.equal(cannotDress(injury('sprained ankle', 2, { warning: true })), false)
  assert.equal(cannotDress(injury('hamstring', 6)), true)
})

test('remaining games count only this club, from next onward', () => {
  const calendar = {
    next: 1,
    schedule: [
      { homeTeamId: 'SAS', awayTeamId: 'LAL' },
      { homeTeamId: 'SAS', awayTeamId: 'HOU' },
      { homeTeamId: 'DAL', awayTeamId: 'MEM' },
      { homeTeamId: 'MEM', awayTeamId: 'SAS' },
    ],
  }
  assert.equal(remainingTeamGames(calendar, 'SAS'), 2)
  assert.equal(remainingTeamGames(calendar, 'DAL'), 1)
})

test('the trainer list leads with season-ending, then absences', () => {
  const row = (id: string, name: string, hit: NonNullable<RosterRow['injury']>): RosterRow =>
    ({
      player: { playerId: id, name, pos: 'PF' },
      injury: hit,
    }) as RosterRow
  const list = trainerRows(
    [
      row('a', 'Parker', injury('ankle', 2, { warning: true })),
      row('b', 'Duncan', injury('torn ACL', 60)),
      row('c', 'Ginobili', injury('hamstring', 8)),
    ],
    40,
    (id) => (id === 'b' ? 'season' : id === 'c' ? 'strain' : 'knock'),
  )
  assert.deepEqual(
    list.map((x) => x.name),
    ['Duncan', 'Ginobili', 'Parker'],
  )
  assert.equal(list[0]?.when, 'Out for the season')
  assert.equal(injuryOptionTag(injury('torn ACL', 60), 'season', 40), ' · OUT season')
  assert.equal(injuryOptionTag(injury('hamstring', 8), 'strain', 40), ' · OUT 8')
})
