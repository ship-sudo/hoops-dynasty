/**
 * The postseason, in the words a fan uses.
 *
 * The bracket carries the facts. What it does not carry is what they mean: 2–1 is a lead, 2–3 is
 * an elimination game, and that difference is the only reason anyone looks at the screen. The
 * translation lives here alone, so the Home panel and the Playoffs screen can never disagree about
 * what is at stake tonight.
 *
 * Home court is not re-derived here either — `homePatternFor` is the sim's own rule, imported, so
 * a preview that says "at home" cannot be contradicted by the game it previews.
 */
import { homePatternFor } from '@hoops/game'

const CONF_ADJECTIVE: Record<string, string> = { East: 'Eastern', West: 'Western' }

/** Small and local: the worker has no business importing the UI's formatters. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * `confRounds` is how many rounds a conference plays before the Finals — three in a sixteen-team
 * field, two in an eight-team one. Naming from the end rather than a fixed table means an era with
 * a different field size still reads correctly.
 */
export function roundName(round: number, bracket: string, confRounds: number): string {
  if (bracket === 'Finals') return 'The Finals'
  const adj = CONF_ADJECTIVE[bracket] ?? bracket
  if (round === 0) return `${adj} Conference First Round`
  if (round === confRounds - 1) return `${adj} Conference Finals`
  if (round === confRounds - 2) return `${adj} Conference Semi-finals`
  return `${adj} Conference Round ${round + 1}`
}

export function seriesLine(yourName: string, yourWins: number, theirWins: number): string {
  if (yourWins === 0 && theirWins === 0) return 'Series level at 0–0'
  if (yourWins === theirWins) return `Series tied ${yourWins}–${theirWins}`
  if (yourWins > theirWins) return `${yourName} lead ${yourWins}–${theirWins}`
  return `${yourName} trail ${yourWins}–${theirWins}`
}

/** Null when nothing is settled tonight. A sentence when the series can end. */
export function stakeLine(
  yourName: string,
  yourWins: number,
  theirWins: number,
  bestOf: number,
): string | null {
  const need = Math.ceil(bestOf / 2)
  const yours = yourWins === need - 1
  const theirs = theirWins === need - 1
  if (yours && theirs) return 'One game for the series. Win or go home.'
  if (yours) return `${yourName} can close it out tonight.`
  if (theirs) return `${yourName} must win to stay alive.`
  return null
}

/** True when you host the next game of the series, by the sim's own 2-2-1-1-1 pattern. */
export function nextIsHome(opts: {
  bestOf: number
  bracket: string
  yearEnd: number
  youAreHigh: boolean
  gamesPlayed: number
}): boolean {
  const pattern = homePatternFor(opts.bestOf, opts.bracket, opts.yearEnd)
  const highAtHome = pattern[opts.gamesPlayed] ?? true
  return opts.youAreHigh === highAtHome
}

export function seriesAction(gameNumber: number): string {
  return `Play game ${gameNumber} ▸`
}

/** The four shapes a play-in game can take. Each one is worth something different. */
export type PlayInSlot = 'seven_eight' | 'nine_ten' | 'elimination' | 'bubble_eight' | 'bubble_nine'

export function playInStake(slot: PlayInSlot): { stake: string; action: string } {
  switch (slot) {
    case 'seven_eight':
      return {
        stake: 'Win and you are the 7 seed; lose and you play again for the 8th.',
        action: 'Play for the 7 seed ▸',
      }
    case 'nine_ten':
      return {
        stake: 'Win and you play again for the 8 seed; lose and your season is over.',
        action: 'Play to stay alive ▸',
      }
    case 'elimination':
      return {
        stake: 'Win and you are the 8 seed; lose and your season is over.',
        action: 'Play for the 8 seed ▸',
      }
    case 'bubble_eight':
      return {
        stake: 'Win once and the 8 seed is yours. Lose twice and it is theirs.',
        action: 'Play for the 8 seed ▸',
      }
    case 'bubble_nine':
      return {
        stake: 'You must win twice to take the 8 seed. One loss and the season is over.',
        action: 'Play to stay alive ▸',
      }
  }
}

/** Who knocked you out, and in how many games. */
export function eliminatedLine(opts: {
  theirName: string
  yourWins: number
  theirWins: number
  round: string
}): { headline: string; detail: string } {
  return {
    headline: `${opts.theirName} knocked you out.`,
    detail: `They beat you ${opts.theirWins}–${opts.yourWins} in the ${opts.round}. Your season is over.`,
  }
}

/** Missing the playoffs is a result too. Say it, rather than saying nothing. */
export function missedLine(opts: {
  wins: number
  losses: number
  rank: number
  conference: string
}): { headline: string; detail: string } {
  return {
    headline: 'Your season is over.',
    detail: `You finished ${opts.wins}–${opts.losses}, ${ordinal(opts.rank)} in the ${
      opts.conference
    }ern Conference, and missed the playoffs.`,
  }
}
