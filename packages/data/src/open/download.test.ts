import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BREF_DATASETS_FILES,
  cacheKey,
  findCsv,
  OPEN_CSVS,
  rawUrl,
  SALARY_FILES,
} from './download.ts'

test('raw urls encode spaces and parentheses; cache keys drop the Data/ prefix', () => {
  const c = findCsv('bball-reference-datasets', 'End of Season Teams (Voting).csv')
  assert.equal(
    rawUrl(c),
    'https://raw.githubusercontent.com/sumitrodatta/bball-reference-datasets/master/Data/End%20of%20Season%20Teams%20(Voting).csv',
  )
  assert.equal(
    cacheKey(c),
    'sumitrodatta/bball-reference-datasets/End of Season Teams (Voting).csv',
  )
  const s = findCsv('nba-player-salaries', 'Player Salaries.csv')
  assert.equal(
    rawUrl(s),
    'https://raw.githubusercontent.com/sumitrodatta/nba-player-salaries/main/Player%20Salaries.csv',
  )
  assert.equal(cacheKey(s), 'sumitrodatta/nba-player-salaries/Player Salaries.csv')
})

test('registry covers every file once', () => {
  assert.equal(OPEN_CSVS.length, BREF_DATASETS_FILES.length + SALARY_FILES.length)
  assert.equal(new Set(OPEN_CSVS.map(cacheKey)).size, OPEN_CSVS.length)
  assert.throws(() => findCsv('nope', 'x.csv'))
})
