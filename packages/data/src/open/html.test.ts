import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  cell,
  decodeEntities,
  findTable,
  parseBrefTable,
  parseDollars,
  playerSlug,
  seasonEndFromLabel,
  stripTags,
} from './html.ts'

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')

test('findTable and parseBrefTable on the cap fixture', () => {
  const html = fx('salary-cap-history.html')
  assert.ok(findTable(html, 'salary_cap_history'))
  assert.equal(findTable(html, 'nope'), null)
  const t = parseBrefTable(html, 'salary_cap_history')
  assert.deepEqual(t.headers, { year_id: 'Year', cap: 'Salary Cap', cap2025: '2025 Dollars' })
  assert.equal(t.rows.length, 5)
  const first = t.rows[0] as NonNullable<(typeof t.rows)[0]>
  assert.equal(cell(first, 'year_id')?.text, '1984-85')
  assert.equal(cell(first, 'year_id')?.href, '/leagues/NBA_1985.html')
  assert.equal(cell(first, 'cap')?.text, '$3,600,000')
})

test('parseBrefTable on the contracts fixture keeps csk, class and data-append-csv', () => {
  const t = parseBrefTable(fx('contracts-players.html'), 'player-contracts')
  assert.equal(t.headers.y1, '2026-27')
  assert.equal(t.headers.y6, '2031-32')
  assert.equal(t.rows.length, 4)
  const curry = t.rows[0] as NonNullable<(typeof t.rows)[0]>
  assert.equal(cell(curry, 'player')?.appendCsv, 'curryst01')
  assert.equal(cell(curry, 'player')?.text, 'Stephen Curry')
  assert.equal(cell(curry, 'y1')?.csk, '62587158')
  assert.equal(cell(curry, 'y2')?.text, '')
  assert.match(cell(curry, 'y2')?.cls ?? '', /iz/)
})

test('helpers', () => {
  assert.equal(decodeEntities('O&#39;Neal &amp; Co'), "O'Neal & Co")
  assert.equal(stripTags('<a href="x"><b>Nikola</b> Jokić</a>'), 'Nikola Jokić')
  assert.equal(parseDollars('$62,587,158'), 62587158)
  assert.equal(parseDollars(''), null)
  assert.equal(parseDollars(null), null)
  assert.equal(seasonEndFromLabel('1999-00'), 2000)
  assert.equal(seasonEndFromLabel('2026-27'), 2027)
  assert.equal(seasonEndFromLabel('Year'), null)
  assert.equal(
    playerSlug({
      stat: 'player',
      text: 'X',
      cls: '',
      csk: null,
      appendCsv: null,
      href: '/players/j/jokicni01.html',
    }),
    'jokicni01',
  )
  assert.equal(playerSlug(undefined), null)
})
