// The "How it is going" line: one sentence telling the manager what his season is.
//
// Split out of Home.tsx so it can be tested in node — Home.tsx imports a stylesheet, which node
// cannot load.
import { n1, ordinal, signed1 } from '../ui/format.ts'

export function verdict(
  wins: number,
  losses: number,
  diff: number,
  rankInConf: number,
  playIn: boolean,
  /**
   * True once the regular season is done — including while a playoff run is still going. Every
   * clause below this point is a forecast ("straight into the playoffs on this form"), and a
   * forecast about a thing that has already happened reads as a bug. Past tense from here.
   */
  over: boolean,
): string {
  const played = wins + losses
  if (played === 0) return 'Nothing played yet. Press Continue and find out.'
  if (over)
    return `You finished ${wins}–${losses}, ${ordinal(rankInConf)} in the conference, ${
      diff >= 0 ? 'outscoring' : 'outscored by'
      // No sign here: "outscored by your opponents by +6.4" put a plus on a deficit. The verb
      // already carries the direction.
    } your opponents by ${n1(Math.abs(diff))} a night.`
  const shape =
    diff >= 6
      ? 'a genuine contender'
      : diff >= 2.5
        ? 'a good side'
        : diff >= -1
          ? 'a middling side'
          : diff >= -5
            ? 'a poor side'
            : 'one of the worst in the league'
  const cut = playIn ? 6 : 8
  const places =
    rankInConf > 0
      ? rankInConf <= cut
        ? ' Straight into the playoffs on this form.'
        : playIn && rankInConf <= 10
          ? ' In the play-in places on this form.'
          : ' Missing the playoffs on this form.'
      : ''
  const scoreline =
    diff >= 0
      ? `You are outscoring teams by ${signed1(diff)} a night`
      : `Teams are outscoring you by ${signed1(-diff)} a night`
  return `${scoreline} — ${shape}.${places}`
}
