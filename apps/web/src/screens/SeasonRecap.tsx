/**
 * The night you win it: a club-coloured lockup, then the film of the year.
 * Pattern: Apple TV MLS Cup (score on a celebration field) then DAZN's Champions headline
 * into a highlights list. No photos — we do not have them — so type and the club colour do the job.
 */
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.tsx'
import { teamColors } from '../ui/teamColors.ts'
import { type RecapFilm, recapFilm } from './seasonRecap.ts'
import './seasonRecap.css'

export function SeasonRecap({
  onClose,
  onContinue,
  onBracket,
  seed,
}: {
  onClose: () => void
  onContinue?: () => void
  onBracket?: () => void
  /** Interrupt copy, used until the save's GameState has the champion. */
  seed?: RecapFilm | null
}) {
  const { game } = useStore()
  const film = useMemo(() => (game ? recapFilm(game) : null) ?? seed ?? null, [game, seed])
  const reduce = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [act, setAct] = useState<'lockup' | 'film'>(reduce ? 'film' : 'lockup')
  const [shown, setShown] = useState(reduce ? 99 : 0)

  useEffect(() => {
    if (reduce || act === 'film') return
    const t = window.setTimeout(() => setAct('film'), 1600)
    return () => window.clearTimeout(t)
  }, [act, reduce])

  useEffect(() => {
    if (act !== 'film' || reduce || !film) return
    if (shown >= film.beats.length) return
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 280 : 1500)
    return () => window.clearTimeout(t)
  }, [act, film, reduce, shown])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (film && shown < film.beats.length) {
        setAct('film')
        setShown(99)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [film, onClose, shown])

  if (!film) return null

  const [pri] = teamColors(film.championAbbr)
  const skip = () => {
    setAct('film')
    setShown(99)
  }
  const lockup =
    film.yours === 'won'
      ? { title: 'Champions', sub: `${film.championCity} ${film.championName}` }
      : { title: film.championName, sub: 'are champions' }
  const visible = film.beats.slice(0, Math.min(shown, film.beats.length))
  const filmDone = act === 'film' && shown >= film.beats.length

  return (
    <div
      className={act === 'film' ? 'sr-root is-film' : 'sr-root'}
      style={{ ['--sr-pri' as string]: pri }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sr-title"
    >
      <div className="sr-stage">
        <div className="sr-kicker">{film.seasonLabel} · NBA Finals</div>
        <h2 className="sr-title" id="sr-title">
          {lockup.title}
        </h2>
        <p className="sr-sub">{lockup.sub}</p>
        <div className="sr-score">
          <span>
            <div className="club">{film.championAbbr}</div>
            <div className="n win">{film.champWins}</div>
          </span>
          <span className="dash">–</span>
          <span>
            <div className="club">{film.runnerAbbr}</div>
            <div className="n">{film.runnerWins}</div>
          </span>
        </div>
      </div>

      {act === 'film' ? (
        <div className="sr-film">
          {visible.map((b) => (
            <div className="sr-beat" key={b.k}>
              <span className="k">{b.k}</span>
              <span className="v">
                {b.v}
                {b.note ? <span className="note">{b.note}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="sr-bar">
        {!filmDone ? (
          <button type="button" className="ghost" onClick={skip}>
            Skip
          </button>
        ) : (
          <>
            {onContinue ? (
              <button type="button" className="primary" onClick={onContinue}>
                Continue ▸
              </button>
            ) : null}
            {onBracket ? (
              <button type="button" onClick={onBracket}>
                See the bracket
              </button>
            ) : null}
            <button type="button" className={onContinue ? 'ghost' : 'primary'} onClick={onClose}>
              {onContinue ? 'Dismiss' : 'Close'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
