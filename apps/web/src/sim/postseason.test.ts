/**
 * The playoffs have to be told, not tabulated.
 *
 * Home used to answer a live playoff run with "No games left on your schedule", because playoff
 * games are never on the calendar's schedule. These are the sentences that replaced it: the series
 * score, what tonight settles, whose building it is in, and the honest version of a season that
 * ended without a trophy.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  eliminatedLine,
  missedLine,
  nextIsHome,
  ordinal,
  playInStake,
  roundName,
  seriesAction,
  seriesLine,
  stakeLine,
} from './postseason.ts'

test('the series score reads like a sentence at every scoreline', () => {
  assert.equal(seriesLine('Celtics', 0, 0), 'Series level at 0–0')
  assert.equal(seriesLine('Celtics', 2, 1), 'Celtics lead 2–1')
  assert.equal(seriesLine('Celtics', 1, 3), 'Celtics trail 1–3')
  assert.equal(seriesLine('Celtics', 2, 2), 'Series tied 2–2')
  assert.equal(seriesLine('Celtics', 3, 3), 'Series tied 3–3')
})

test('match point is named, both ways round', () => {
  assert.equal(stakeLine('Celtics', 0, 0, 7), null)
  assert.equal(stakeLine('Celtics', 2, 1, 7), null)
  assert.equal(stakeLine('Celtics', 3, 1, 7), 'Celtics can close it out tonight.')
  assert.equal(stakeLine('Celtics', 1, 3, 7), 'Celtics must win to stay alive.')
  assert.equal(stakeLine('Celtics', 3, 3, 7), 'One game for the series. Win or go home.')
})

test('a best-of-five reaches match point a game sooner', () => {
  assert.equal(stakeLine('Celtics', 1, 0, 5), null)
  assert.equal(stakeLine('Celtics', 2, 0, 5), 'Celtics can close it out tonight.')
  assert.equal(stakeLine('Celtics', 0, 2, 5), 'Celtics must win to stay alive.')
  assert.equal(stakeLine('Celtics', 2, 2, 5), 'One game for the series. Win or go home.')
})

test('rounds are named the way a fan names them', () => {
  assert.equal(roundName(0, 'East', 3), 'Eastern Conference First Round')
  assert.equal(roundName(1, 'East', 3), 'Eastern Conference Semi-finals')
  assert.equal(roundName(2, 'East', 3), 'Eastern Conference Finals')
  assert.equal(roundName(0, 'West', 3), 'Western Conference First Round')
  assert.equal(roundName(2, 'West', 3), 'Western Conference Finals')
  assert.equal(roundName(3, 'Finals', 3), 'The Finals')
})

test('a smaller field still names its last conference round the conference finals', () => {
  assert.equal(roundName(0, 'East', 2), 'Eastern Conference First Round')
  assert.equal(roundName(1, 'East', 2), 'Eastern Conference Finals')
})

/**
 * Home court is the sim's own 2-2-1-1-1, not a guess: the higher seed hosts games 1, 2, 5 and 7.
 * The Finals through 2012-13 were 2-3-2, and the preview has to follow that too.
 */
test('the higher seed hosts games one, two, five and seven', () => {
  const at = (gamesPlayed: number) =>
    nextIsHome({ bestOf: 7, bracket: 'East', yearEnd: 2011, youAreHigh: true, gamesPlayed })
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(at), [true, true, false, false, true, false, true])
})

test('the lower seed sees the same pattern inverted', () => {
  const at = (gamesPlayed: number) =>
    nextIsHome({ bestOf: 7, bracket: 'East', yearEnd: 2011, youAreHigh: false, gamesPlayed })
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(at), [false, false, true, true, false, true, false])
})

test('a best-of-five is 2-2-1, and the old Finals are 2-3-2', () => {
  const five = (gamesPlayed: number) =>
    nextIsHome({ bestOf: 5, bracket: 'East', yearEnd: 2000, youAreHigh: true, gamesPlayed })
  assert.deepEqual([0, 1, 2, 3, 4].map(five), [true, true, false, false, true])

  const old = (gamesPlayed: number) =>
    nextIsHome({ bestOf: 7, bracket: 'Finals', yearEnd: 2011, youAreHigh: true, gamesPlayed })
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(old), [true, true, false, false, false, true, true])

  const modern = (gamesPlayed: number) =>
    nextIsHome({ bestOf: 7, bracket: 'Finals', yearEnd: 2014, youAreHigh: true, gamesPlayed })
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(modern), [true, true, false, false, true, false, true])
})

test('the button says which game it is about to play', () => {
  assert.equal(seriesAction(1), 'Play game 1 ▸')
  assert.equal(seriesAction(4), 'Play game 4 ▸')
})

test('a play-in game says what it is for', () => {
  assert.equal(
    playInStake('seven_eight').stake,
    'Win and you are the 7 seed; lose and you play again for the 8th.',
  )
  assert.equal(
    playInStake('nine_ten').stake,
    'Win and you play again for the 8 seed; lose and your season is over.',
  )
  assert.equal(
    playInStake('elimination').stake,
    'Win and you are the 8 seed; lose and your season is over.',
  )
  assert.equal(playInStake('elimination').action, 'Play for the 8 seed ▸')
  assert.match(playInStake('bubble_nine').stake, /win twice/)
})

test('being knocked out names the club and the scoreline', () => {
  const out = eliminatedLine({
    theirName: 'Bulls',
    yourWins: 2,
    theirWins: 4,
    round: 'Eastern Conference Semi-finals',
  })
  assert.equal(out.headline, 'Bulls knocked you out.')
  assert.equal(
    out.detail,
    'They beat you 4–2 in the Eastern Conference Semi-finals. Your season is over.',
  )
})

test('missing the playoffs is reported as a result, not as an absence', () => {
  const out = missedLine({ wins: 31, losses: 51, rank: 12, conference: 'East' })
  assert.equal(out.headline, 'Your season is over.')
  assert.equal(
    out.detail,
    'You finished 31–51, 12th in the Eastern Conference, and missed the playoffs.',
  )
  assert.doesNotMatch(out.detail, /No games left/)
})

test('ordinals survive the teens', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal), [
    '1st',
    '2nd',
    '3rd',
    '4th',
    '11th',
    '12th',
    '13th',
    '21st',
  ])
})
