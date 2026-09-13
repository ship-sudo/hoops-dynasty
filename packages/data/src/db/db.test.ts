import assert from 'node:assert/strict'
import { test } from 'node:test'
import { count, insertMany, openDb } from './db.ts'

test('schema applies and insertMany round-trips', () => {
  const db = openDb(':memory:')
  const n = insertMany(
    db,
    'seasons',
    ['year_end', 'season_id', 'games', 'teams', 'rules_json'],
    [
      [1998, '1997-98', 82, 29, '{}'],
      [1999, '1998-99', 50, 29, '{}'],
    ],
  )
  assert.equal(n, 2)
  assert.equal(count(db, 'seasons'), 2)
  assert.equal(count(db, 'seasons', 'games = ?', [50]), 1)
})
