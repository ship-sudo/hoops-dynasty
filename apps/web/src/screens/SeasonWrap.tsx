/**
 * Regular season over: how you finished, the awards, the playoff picture.
 * Championship film stays on SeasonRecap. This is the page you reopen from Home.
 */
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { Bracket } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { TeamChip } from '../ui/bits.tsx'
import { FirstRound } from './bracketBits.tsx'
import { useCareerModal } from './leaguebits.tsx'
import {
  type PictureRow,
  type SeasonWrapModel,
  type WrapLeader,
  type WrapWinner,
  wrapFromGame,
} from './seasonWrap.ts'
import './seasonWrap.css'

export function AwardPodium({
  wrap,
  onOpen,
  heading = true,
}: {
  wrap: SeasonWrapModel
  onOpen: (playerId: string) => void
  heading?: boolean
}) {
  const { teamById } = useStore()
  return (
    <div className="sw-section">
      {heading ? <h2>The awards</h2> : null}
      <div className="sw-podium">
        {wrap.awards.map((a) => {
          const w = a.winner
          return (
            <button
              key={a.key}
              type="button"
              className={['sw-award', a.key, w?.yours ? 'yours' : ''].join(' ').trim()}
              onClick={() => w && onOpen(w.playerId)}
              disabled={!w}
            >
              <span className="kind">{a.title}</span>
              {w ? (
                <>
                  <span className="nm">{w.name}</span>
                  <span className="club">
                    <TeamChip team={w.teamId ? teamById.get(w.teamId) : undefined} long />
                    {w.yours ? ' · yours' : ''}
                  </span>
                </>
              ) : (
                <span className="empty">Not awarded</span>
              )}
            </button>
          )
        })}
      </div>
      {wrap.allNba.length > 0 ? (
        <div className="sw-nba">
          {wrap.allNba.map((row) => (
            <div className="sw-nba-row" key={row.label}>
              <span className="lab">{row.label.replace('All-NBA ', '')}</span>
              <span className="names">
                {row.players.map((p, i) => (
                  <NbaName key={p.playerId} p={p} onOpen={onOpen} first={i === 0} />
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <FinalsHonors mvp={wrap.finalsMvp} leaders={wrap.finalsLeaders} onOpen={onOpen} />
    </div>
  )
}

function NbaName({
  p,
  onOpen,
  first,
}: {
  p: WrapWinner
  onOpen: (playerId: string) => void
  first: boolean
}) {
  return (
    <>
      {first ? '' : ', '}
      <button
        type="button"
        className={p.yours ? 'lg-link yours' : 'lg-link'}
        onClick={() => onOpen(p.playerId)}
      >
        {p.name}
      </button>
    </>
  )
}

const LEADER_LABS: { key: 'pts' | 'reb' | 'ast'; lab: string }[] = [
  { key: 'pts', lab: 'Points' },
  { key: 'reb', lab: 'Rebounds' },
  { key: 'ast', lab: 'Assists' },
]

/** Named when a champion exists. Regular-season wrap has nothing here. */
export function FinalsHonors({
  mvp,
  leaders,
  onOpen,
}: {
  mvp: WrapWinner | null
  leaders: { pts: WrapLeader | null; reb: WrapLeader | null; ast: WrapLeader | null } | null
  onOpen: (playerId: string) => void
}) {
  if (!mvp && !leaders?.pts && !leaders?.reb && !leaders?.ast) return null
  return (
    <div className="sw-finals">
      {mvp ? (
        <button
          type="button"
          className={['sw-finals-mvp', mvp.yours ? 'yours' : ''].join(' ').trim()}
          onClick={() => onOpen(mvp.playerId)}
        >
          <span className="kind">Finals MVP</span>
          <span className="nm">{mvp.name}</span>
        </button>
      ) : null}
      {leaders ? (
        <div className="sw-finals-stats">
          {LEADER_LABS.map(({ key, lab }) => {
            const w = leaders[key]
            return (
              <button
                key={key}
                type="button"
                className={['sw-finals-stat', w?.yours ? 'yours' : ''].join(' ').trim()}
                onClick={() => w && onOpen(w.playerId)}
                disabled={!w}
              >
                <span className="lab">{lab}</span>
                <span className="who">{w?.name ?? '—'}</span>
                <span className="n">{w ? w.score.toFixed(1) : ''}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function PlayoffPicture({ wrap }: { wrap: SeasonWrapModel }) {
  const { teamById } = useStore()
  return (
    <div className="sw-section">
      <h2>The playoff picture</h2>
      <div className="sw-picture">
        {wrap.picture.map((conf) => (
          <table className="grid" key={conf.conference}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th className="text">{conf.conference}</th>
                <th>W–L</th>
              </tr>
            </thead>
            <tbody>
              {conf.rows.map((r) => (
                <PictureRowEl
                  key={r.teamId}
                  r={r}
                  label={<TeamChip team={teamById.get(r.teamId)} long />}
                />
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>
        {wrap.playIn
          ? 'Top six are through; 7th to 10th play off for the last two places.'
          : 'Top eight are through.'}
      </p>
    </div>
  )
}

function PictureRowEl({ r, label }: { r: PictureRow; label: ReactNode }) {
  return (
    <>
      <tr className={r.mine ? 'me' : undefined}>
        <td className="num faint">{r.seed}</td>
        <td className="text">{label}</td>
        <td className="num">
          {r.wins}–{r.losses}
        </td>
      </tr>
      {r.cut ? (
        <tr className={`cutline ${r.cut === 'Play-in' ? 'playoff' : 'playin'}`}>
          <td colSpan={3}>
            <span className="rule">{r.cut}</span>
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function SeasonWrap({
  onClose,
  onPlayoffs,
  onOffseason,
}: {
  onClose: () => void
  onPlayoffs?: () => void
  onOffseason?: () => void
}) {
  const { game, client, snapshot } = useStore()
  const [career, openCareer] = useCareerModal()
  const [bracket, setBracket] = useState<Bracket | null>(null)
  const wrap = useMemo(() => (game ? wrapFromGame(game) : null), [game])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is the refetch trigger
  useEffect(() => {
    let live = true
    client
      .manager<Bracket | null>('bracket')
      .then((b) => live && setBracket(b))
      .catch(() => live && setBracket(null))
    return () => {
      live = false
    }
  }, [client, snapshot])

  if (!wrap) return null
  const me = wrap.yours.teamId
  const first = bracket?.rounds[0] ?? []
  const primary =
    wrap.playing && onPlayoffs
      ? {
          label:
            wrap.phase === 'playin'
              ? wrap.yours.band === 'playin'
                ? 'To the play-in ▸'
                : 'Watch the play-in ▸'
              : wrap.yours.band === 'out'
                ? 'Watch the playoffs ▸'
                : 'To the playoffs ▸',
          go: onPlayoffs,
        }
      : onOffseason
        ? { label: 'To the offseason ▸', go: onOffseason }
        : null

  return (
    <div className="sw-root" role="dialog" aria-labelledby="sw-title">
      <div className="sw-body">
        <div className="sw-page">
          <header className="sw-hero">
            <div className="season">{wrap.seasonLabel} · regular season</div>
            <h1 id="sw-title">
              {wrap.yours.wins}–{wrap.yours.losses}
            </h1>
            <div className="club">
              {wrap.yours.city} {wrap.yours.name}
            </div>
            <p className="fate">{wrap.yours.fate}</p>
            {wrap.honors.length > 0 ? (
              <div className="sw-honors">
                {wrap.honors.map((h) => (
                  <span className="sw-honor" key={`${h.label}-${h.playerId}`}>
                    {h.name}, {h.label}
                  </span>
                ))}
              </div>
            ) : null}
          </header>
          <AwardPodium wrap={wrap} onOpen={openCareer} />
          <PlayoffPicture wrap={wrap} />
          {first.length > 0 ? (
            <div className="sw-section">
              <h2>First round</h2>
              <FirstRound series={first} me={me} />
              {onPlayoffs ? (
                <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>
                  <button type="button" className="lg-link" onClick={onPlayoffs}>
                    Open the full bracket
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="sw-bar">
        <button type="button" onClick={onClose}>
          Close
        </button>
        {primary ? (
          <button type="button" className="primary" onClick={primary.go}>
            {primary.label}
          </button>
        ) : null}
      </div>
      {career}
    </div>
  )
}
