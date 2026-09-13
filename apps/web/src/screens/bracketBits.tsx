/**
 * One series cell, and the first-round strip the wrap embeds.
 * Playoffs owns the full bracket; this file is the shared drawing.
 */
import type { BracketSeries } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { priVar } from './leaguebits.tsx'
import './league.css'

export const ROUND_NAMES = [
  'First round',
  'Conference semi-finals',
  'Conference finals',
  'The Finals',
]

export function Series({
  s,
  me,
  selected,
  onSelect,
}: {
  s: BracketSeries
  me: string
  selected: boolean
  onSelect?: () => void
}) {
  const { teamById } = useStore()
  const high = teamById.get(s.highTeamId)
  const low = teamById.get(s.lowTeamId)
  const target = Math.ceil(s.bestOf / 2)
  const done = s.winnerTeamId !== null
  const side = (
    teamId: string,
    seed: number | null,
    wins: number,
    team: ReturnType<typeof teamById.get>,
  ) => (
    <span
      className={[
        'team',
        done && s.winnerTeamId === teamId ? 'won' : done ? 'out' : '',
        teamId === me ? 'mine' : '',
      ]
        .join(' ')
        .trim()}
      style={priVar(team?.abbr)}
    >
      <span className="sd">{seed ?? '—'}</span>
      <span className="nm">{team ? `${team.city} ${team.name}` : teamId}</span>
      <span className="wn">{wins}</span>
    </span>
  )
  const body = (
    <>
      {side(s.highTeamId, s.highSeed, s.highWins, high)}
      {side(s.lowTeamId, s.lowSeed, s.lowWins, low)}
      <span className="foot">
        {done
          ? `${teamById.get(s.winnerTeamId as string)?.abbr ?? ''} win ${Math.max(s.highWins, s.lowWins)}–${Math.min(s.highWins, s.lowWins)}`
          : s.games.length === 0
            ? `Best of ${s.bestOf} · to come`
            : `First to ${target} · game ${s.games.length + 1} next`}
      </span>
    </>
  )
  if (!onSelect) {
    return (
      <div
        className="lg-series"
        title={`${s.games.length} game${s.games.length === 1 ? '' : 's'} played`}
      >
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className="lg-series"
      aria-pressed={selected}
      onClick={onSelect}
      title={`${s.games.length} game${s.games.length === 1 ? '' : 's'} played`}
    >
      {body}
    </button>
  )
}

/** First round only, East and West, for the wrap. Clicking is the Playoffs screen's job. */
export function FirstRound({ series, me }: { series: BracketSeries[]; me: string }) {
  const east = series.filter((s) => s.bracket === 'East')
  const west = series.filter((s) => s.bracket === 'West')
  return (
    <div className="lg-bracket sw-first">
      {(['East', 'West'] as const).map((conf) => {
        const round = conf === 'East' ? east : west
        if (round.length === 0) return null
        return (
          <div className="lg-round" key={conf}>
            <h4>{conf}ern first round</h4>
            {round.map((s) => (
              <Series key={`${s.highTeamId}-${s.lowTeamId}`} s={s} me={me} selected={false} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
