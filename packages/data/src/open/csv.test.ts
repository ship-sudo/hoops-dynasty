import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bool, num, parseCsv, parseCsvObjects, str } from './csv.ts'

test('plain rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [
    ['a', 'b', 'c'],
    ['1', '2', '3'],
  ])
})

test('CRLF and no trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4'), [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ])
})

test('quoted fields with commas, quotes, newlines', () => {
  const text = 'name,note\n"Smith, John","said ""hi""\nthen left"\nplain,x\n'
  assert.deepEqual(parseCsv(text), [
    ['name', 'note'],
    ['Smith, John', 'said "hi"\nthen left'],
    ['plain', 'x'],
  ])
})

test('empty cells and trailing comma', () => {
  assert.deepEqual(parseCsv('a,,c\n,,\n'), [
    ['a', '', 'c'],
    ['', '', ''],
  ])
})

test('objects keyed by header', () => {
  assert.deepEqual(parseCsvObjects('x,y\n1,NA\n'), [{ x: '1', y: 'NA' }])
  assert.deepEqual(parseCsvObjects(''), [])
})

test('scalar coercions', () => {
  assert.equal(num('NA'), null)
  assert.equal(num(''), null)
  assert.equal(num('1.5'), 1.5)
  assert.throws(() => num('abc'))
  assert.equal(bool('TRUE'), true)
  assert.equal(bool('FALSE'), false)
  assert.equal(bool('NA'), null)
  assert.equal(str('NA'), null)
  assert.equal(str('BOS'), 'BOS')
})
