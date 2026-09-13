// The "How it is going" line. Its whole job is to be true on the day it is read.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verdict } from './verdict.ts'

test('mid-season it forecasts', () => {
  const s = verdict(40, 12, 9.1, 2, true, false)
  assert.match(s, /outscoring teams by \+9\.1 a night/)
  assert.match(s, /genuine contender/)
  assert.match(s, /Straight into the playoffs on this form/)
})

test('once the regular season is done it stops forecasting', () => {
  // The bug: a 65-17 club three games into a playoff series was told it was heading "into the
  // playoffs on this form" — a prediction about something already settled.
  const s = verdict(65, 17, 9.1, 2, true, true)
  assert.doesNotMatch(s, /on this form/)
  assert.match(s, /You finished 65–17, 2nd in the conference/)
  assert.match(s, /outscoring your opponents by 9\.1 a night/)
})

test('a bad season reads as one, in the past tense', () => {
  const s = verdict(21, 61, -6.4, 15, true, true)
  assert.match(s, /You finished 21–61, 15th in the conference/)
  assert.match(s, /outscored by your opponents by 6\.4 a night/)
  assert.doesNotMatch(s, /on this form/)
})

test('the play-in cut moves the forecast', () => {
  const eighth = verdict(30, 22, 0.4, 8, true, false)
  assert.match(eighth, /In the play-in places on this form/)
  // Same record, an era without a play-in: eighth is straight through.
  assert.match(verdict(30, 22, 0.4, 8, false, false), /Straight into the playoffs on this form/)
})

test('nothing played yet says so', () => {
  assert.match(verdict(0, 0, 0, 0, true, false), /Nothing played yet/)
})
