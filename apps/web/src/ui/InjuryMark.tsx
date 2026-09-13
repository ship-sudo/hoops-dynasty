import type { RosterRow } from '../sim/api.ts'

/** DTD / OUT tag on a roster or rotation row. Hidden when he is fit. */
export function InjuryMark({ injury }: { injury: RosterRow['injury'] }) {
  if (!injury) return null
  const n = injury.games
  const games = `${n} game${n === 1 ? '' : 's'}`
  const title = injury.warning
    ? injury.playingThrough
      ? `${injury.name} — playing through`
      : `${injury.name} · day-to-day`
    : `${injury.name} · out ${games}`
  return (
    <span
      className={injury.warning ? 'badge warn' : 'badge loss'}
      title={title}
      style={{ marginLeft: 6, verticalAlign: 'middle' }}
    >
      {injury.warning ? 'DTD' : `OUT ${n}`}
    </span>
  )
}
