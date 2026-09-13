import type { TeamRecord } from '@hoops/core'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { teamColors } from './teamColors.ts'

export function TeamChip({ team, long = false }: { team: TeamRecord | undefined; long?: boolean }) {
  if (!team) return <span className="faint">—</span>
  const [pri] = teamColors(team.abbr)
  return (
    <span className="chip" title={`${team.city} ${team.name}`}>
      <span className="swatch" style={{ background: pri }} />
      {team.abbr}
      {long ? <span className="nm">{team.name}</span> : null}
    </span>
  )
}

/**
 * A fixture, drawn the way a broadcast draws one: both clubs in their own colour, the score in
 * the display face, and the state of the game — FINAL, tip-off, the round — down the middle.
 * Used for the next game and the last result, so a win looks like a win.
 */
export function Scoreboard({
  away,
  home,
  awayPts,
  homePts,
  state,
  when,
  awayNote,
  homeNote,
}: {
  away: TeamRecord | undefined
  home: TeamRecord | undefined
  /** Null on both sides means the game has not been played: the board shows the fixture instead. */
  awayPts?: number | null
  homePts?: number | null
  state: string
  when?: ReactNode
  awayNote?: ReactNode
  homeNote?: ReactNode
}) {
  const played = awayPts != null && homePts != null
  const side = (t: TeamRecord | undefined, pts: number | null, note: ReactNode, which: string) => {
    const [pri] = teamColors(t?.abbr ?? '')
    const lost =
      played && pts != null && (which === 'away' ? pts < (homePts ?? 0) : pts < (awayPts ?? 0))
    return (
      <div className={`side ${which}${lost ? ' lost' : ''}`} style={{ ['--c' as string]: pri }}>
        <span className="mark">{t?.abbr ?? '—'}</span>
        <span className="who">
          <span className="name">{t ? `${t.city} ${t.name}` : '—'}</span>
          {note ? <span className="rec">{note}</span> : null}
        </span>
        {played ? <span className="pts">{pts}</span> : null}
      </div>
    )
  }
  return (
    <div className={played ? 'scoreboard' : 'scoreboard upcoming'}>
      {side(away, awayPts ?? null, awayNote, 'away')}
      <div className="middle">
        <span className="state">{state}</span>
        {when ? <span className="when">{when}</span> : null}
      </div>
      {side(home, homePts ?? null, homeNote, 'home')}
    </div>
  )
}

/** A row of headline figures. `note` is the small grey line under the number. */
export function StatRow({
  tiles,
}: {
  tiles: {
    k: string
    v: ReactNode
    note?: ReactNode
    tone?: 'win' | 'loss' | 'warn' | undefined
  }[]
}) {
  return (
    <div className="statrow">
      {tiles.map((t) => (
        <div className="tile" key={t.k}>
          <span className="k">{t.k}</span>
          <span className={t.tone ? `v ${t.tone}` : 'v'}>{t.v}</span>
          {t.note ? <span className="note">{t.note}</span> : null}
        </div>
      ))}
    </div>
  )
}

/**
 * A number that arrives rather than appears. Two hundred milliseconds of counting when a figure
 * changes is enough to make a simmed day feel like something happened, and it never delays
 * anything: the final value is on screen either way by the time you have read the label.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      Math.abs(value - start) > 60
    ) {
      from.current = value
      setShown(value)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 260)
      const eased = 1 - (1 - p) ** 3
      setShown(Math.round(start + (value - start) * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className={className}>{shown}</span>
}

/** The last few results as squares, oldest first. */
export function FormRun({ results }: { results: boolean[] }) {
  return (
    <span className="form" title={results.map((w) => (w ? 'W' : 'L')).join('')}>
      {results.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a run of results has no other identity
        <i key={i} className={w ? 'w' : 'l'} />
      ))}
    </span>
  )
}

export function Panel({
  title,
  actions,
  flush,
  /** The hero of its column: the club's colour washes the header. One per screen at most. */
  feature,
  children,
}: {
  title?: ReactNode
  actions?: ReactNode
  flush?: boolean
  feature?: boolean
  children: ReactNode
}) {
  return (
    <section className={feature ? 'panel feature' : 'panel'}>
      {title != null || actions != null ? (
        <header>
          <h3>{title}</h3>
          <span style={{ flex: 1 }} />
          {actions}
        </header>
      ) : null}
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  )
}

export function RatingBar({ label, value }: { label: string; value: number }) {
  const cls = value >= 80 ? 'bar hi' : value <= 68 ? 'bar lo' : 'bar'
  return (
    <>
      <span className="dim">{label}</span>
      <span className={cls}>
        <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="num" style={{ textAlign: 'right' }}>
        {Math.round(value)}
      </span>
    </>
  )
}

export function Modal({
  title,
  onClose,
  wide,
  narrow,
  children,
}: {
  title: ReactNode
  onClose: () => void
  /** For a dialog that holds a wide table — a career is fifteen columns before it says anything. */
  wide?: boolean
  /** A player popover: identity, a handful of ratings, and the few things you can change. */
  narrow?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the dialog; the backdrop click is a convenience
    // biome-ignore lint/a11y/useKeyWithClickEvents: same
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={wide ? 'modal wide' : narrow ? 'modal narrow' : 'modal'}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>
            Close (Esc)
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}
