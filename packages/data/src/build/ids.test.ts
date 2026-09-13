import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type BrefRef,
  matchIds,
  type NbaRef,
  nbaAbbr,
  normaliseName,
  surname,
  tokenKey,
} from './ids.ts'

test('normaliseName strips diacritics, punctuation and suffixes', () => {
  assert.equal(normaliseName('Nikola Jokić'), 'nikola jokic')
  assert.equal(normaliseName('A.C. Green'), 'ac green')
  assert.equal(normaliseName('Michael Porter Jr.'), 'michael porter')
  assert.equal(normaliseName('Tim Hardaway, Jr.'), 'tim hardaway')
  assert.equal(normaliseName('Otto Porter III'), 'otto porter')
  assert.equal(normaliseName("Shaquille O'Neal"), 'shaquille oneal')
  assert.equal(normaliseName('Amar’e Stoudemire'), 'amare stoudemire')
  assert.equal(normaliseName('Karl-Anthony Towns'), 'karlanthony towns')
  assert.equal(normaliseName('  LeBron   James '), 'lebron james')
  assert.equal(normaliseName('Nenê'), 'nene')
  assert.equal(normaliseName('Ömer Aşık'), 'omer asik')
  assert.equal(normaliseName('Tibor Pleiß'), 'tibor pleiss')
  assert.equal(normaliseName('Egor Dёmin'), 'egor demin')
  assert.equal(tokenKey('Sun Yue'), tokenKey('Yue Sun'))
  assert.equal(surname('Kiwane Lemorris Garris'), 'garris')
})

test('matchIds: token order and surname fall back, still keyed on season and team', () => {
  const nbaSide: NbaRef[] = [
    { nbaId: '10', name: 'Yue Sun', draftYear: null, seasons: [{ yearEnd: 2009, abbr: 'LAL' }] },
    { nbaId: '11', name: 'Ike Austin', draftYear: null, seasons: [{ yearEnd: 1998, abbr: 'MIA' }] },
    {
      nbaId: '12',
      name: 'Flip Murray',
      draftYear: null,
      seasons: [{ yearEnd: 2003, abbr: 'SEA' }],
    },
    {
      nbaId: '13',
      name: 'Tracy Murray',
      draftYear: null,
      seasons: [{ yearEnd: 2003, abbr: 'SEA' }],
    },
  ]
  const brefSide: BrefRef[] = [
    {
      brefId: 'yuesu01',
      name: 'Sun Yue',
      draftYear: null,
      seasons: [{ yearEnd: 2009, abbr: 'LAL' }],
    },
    {
      brefId: 'austiis01',
      name: 'Isaac Austin',
      draftYear: null,
      seasons: [{ yearEnd: 1998, abbr: 'MIA' }],
    },
    {
      brefId: 'murraro01',
      name: 'Ronald Murray',
      draftYear: null,
      seasons: [{ yearEnd: 2003, abbr: 'SEA' }],
    },
  ]
  const { matches, unmatched } = matchIds(nbaSide, brefSide)
  const by = new Map(matches.map((m) => [m.brefId, [m.nbaId, m.method]]))
  assert.deepEqual(by.get('yuesu01'), ['10', 'tokens_season_team'])
  assert.deepEqual(by.get('austiis01'), ['11', 'surname_season_team'])
  // Two Murrays on the same team that season: the surname step cannot pick one.
  assert.deepEqual(
    unmatched.map((u) => u.brefId),
    ['murraro01'],
  )
})

test('nbaAbbr maps the few bref codes that differ', () => {
  assert.equal(nbaAbbr('BRK'), 'BKN')
  assert.equal(nbaAbbr('CHO'), 'CHA')
  assert.equal(nbaAbbr('PHO'), 'PHX')
  assert.equal(nbaAbbr('LAL'), 'LAL')
})

const nba: NbaRef[] = [
  { nbaId: '1', name: 'Mike Smith', draftYear: 1995, seasons: [{ yearEnd: 1998, abbr: 'PHX' }] },
  { nbaId: '2', name: 'Mike Smith', draftYear: 2001, seasons: [{ yearEnd: 2003, abbr: 'BOS' }] },
  { nbaId: '3', name: 'Nikola Jokić', draftYear: 2014, seasons: [{ yearEnd: 2016, abbr: 'DEN' }] },
  {
    nbaId: '4',
    name: 'Kelly Oubre Jr.',
    draftYear: 2015,
    seasons: [{ yearEnd: 2016, abbr: 'WAS' }],
  },
  { nbaId: '5', name: 'Nene', draftYear: 2002, seasons: [{ yearEnd: 2003, abbr: 'DEN' }] },
  { nbaId: '6', name: 'Gary Payton', draftYear: null, seasons: [] },
]

test('matchIds: season+team, then draft year, then unique name, then unmatched; overrides first', () => {
  const brefs: BrefRef[] = [
    {
      brefId: 'smithmi01',
      name: 'Mike Smith',
      draftYear: 1995,
      seasons: [{ yearEnd: 1998, abbr: 'PHO' }],
    },
    {
      brefId: 'smithmi02',
      name: 'Mike Smith',
      draftYear: 2001,
      seasons: [{ yearEnd: 2003, abbr: 'NYK' }],
    },
    {
      brefId: 'jokicni01',
      name: 'Nikola Jokic',
      draftYear: 2014,
      seasons: [{ yearEnd: 2016, abbr: 'DEN' }],
    },
    {
      brefId: 'oubreke01',
      name: 'Kelly Oubre',
      draftYear: 2015,
      seasons: [{ yearEnd: 2017, abbr: 'WAS' }],
    },
    {
      brefId: 'hilarne01',
      name: 'Nene Hilario',
      draftYear: 2002,
      seasons: [{ yearEnd: 2003, abbr: 'DEN' }],
    },
    {
      brefId: 'paytoga01',
      name: 'Gary Payton',
      draftYear: 1990,
      seasons: [{ yearEnd: 1998, abbr: 'SEA' }],
    },
    { brefId: 'nobody01', name: 'Nobody Here', draftYear: null, seasons: [] },
  ]
  const { matches, unmatched } = matchIds(nba, brefs, { hilarne01: '5' })
  const by = new Map(matches.map((m) => [m.brefId, m]))
  assert.deepEqual(
    [by.get('smithmi01')?.nbaId, by.get('smithmi01')?.method],
    ['1', 'name_season_team'],
  )
  assert.deepEqual([by.get('smithmi02')?.nbaId, by.get('smithmi02')?.method], ['2', 'name_draft'])
  assert.deepEqual(
    [by.get('jokicni01')?.nbaId, by.get('jokicni01')?.method],
    ['3', 'name_season_team'],
  )
  assert.deepEqual([by.get('oubreke01')?.nbaId, by.get('oubreke01')?.method], ['4', 'name_draft'])
  assert.deepEqual([by.get('hilarne01')?.nbaId, by.get('hilarne01')?.method], ['5', 'manual'])
  assert.deepEqual([by.get('paytoga01')?.nbaId, by.get('paytoga01')?.method], ['6', 'name'])
  assert.deepEqual(
    unmatched.map((u) => u.brefId),
    ['nobody01'],
  )
})

test('matchIds: ambiguous names stay unmatched', () => {
  const brefs: BrefRef[] = [
    {
      brefId: 'smithmi03',
      name: 'Mike Smith',
      draftYear: null,
      seasons: [{ yearEnd: 2010, abbr: 'MIA' }],
    },
  ]
  const { matches, unmatched } = matchIds(nba, brefs)
  assert.equal(matches.length, 0)
  assert.equal(unmatched.length, 1)
})
