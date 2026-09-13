/**
 * All-Star weekend: the two squads, starters apart from reserves, and — once the calendar has
 * passed the break — the game itself and who took its MVP.
 *
 * Before the break the lists are a projection, and the screen says so: they are today's vote, and
 * a man can play his way in or out of them.
 */
import { useEffect, useState } from 'react'
import type { AllStarGame, AllStarPick } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { longDate, n1, seasonLabel } from '../ui/format.ts'
import { GameBox } from './BoxScore.tsx'
import { useCareerModal } from './leaguebits.tsx'

const allStarName = (id: string) => (id === 'EAST' ? 'East' : id === 'WEST' ? 'West' : id)
const allStarColor = (id: string) =>
  id === 'EAST' ? '#1d428a' : id === 'WEST' ? '#c8102e' : '#5b6472'

const daysBetween = (from: string, to: string): number =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  )

function Squad({
  conference,
  picks,
  me,
  mvpId,
  onOpen,
}: {
  conference: 'East' | 'West'
  picks: AllStarPick[]
  me: string | undefined
  mvpId: string | null
  onOpen: (id: string) => void
}) {
  const { teamById } = useStore()
  const starters = picks.filter((p) => p.starter)
  const reserves = picks.filter((p) => !p.starter)
  const mine = picks.filter((p) => p.teamId === me).length

  const rows = (list: AllStarPick[]) =>
    list.map((p) => (
      <tr
        key={p.playerId}
        className={`clickable${p.teamId === me ? ' me' : ''}`}
        onClick={() => onOpen(p.playerId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(p.playerId)
        }}
        tabIndex={0}
      >
        <td className="text">
          {p.name}
          {p.playerId === mvpId ? (
            <span className="badge warn" style={{ marginLeft: 6 }} title="All-Star Game MVP">
              MVP
            </span>
          ) : null}
        </td>
        <td className="text dim">{p.pos}</td>
        <td className="text">
          <TeamChip team={teamById.get(p.teamId)} />
        </td>
        <td className="num">{n1(p.pts)}</td>
        <td className="num dim">{n1(p.reb)}</td>
        <td className="num dim">{n1(p.ast)}</td>
        <td className="num dim" title="Times selected in this save">
          {p.selections > 1 ? `×${p.selections}` : '—'}
        </td>
      </tr>
    ))

  return (
    <Panel
      title={`${conference} squad`}
      actions={
        mine > 0 ? (
          <span className="dim" style={{ fontSize: 11 }}>
            {mine} of yours
          </span>
        ) : null
      }
      flush
    >
      {picks.length === 0 ? (
        <p className="dim" style={{ padding: 10, margin: 0 }}>
          No squad yet. Nobody has played enough for a vote.
        </p>
      ) : (
        <div className="table-x">
          <table className="grid">
            <thead>
              <tr>
                <th className="text">Player</th>
                <th className="text">Pos</th>
                <th className="text">Team</th>
                <th title="Points per game">PTS</th>
                <th title="Rebounds per game">REB</th>
                <th title="Assists per game">AST</th>
                <th title="Selections in this save">Sel</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text lg-subhead" colSpan={7}>
                  Starters
                </td>
              </tr>
              {rows(starters)}
              <tr>
                <td className="text lg-subhead" colSpan={7}>
                  Reserves
                </td>
              </tr>
              {rows(reserves)}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

export function AllStar() {
  const { client, snapshot, teamById } = useStore()
  const [game, setGame] = useState<AllStarGame | null>(null)
  const [career, openCareer] = useCareerModal()

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .manager<AllStarGame | null>('allStars')
      .then((g) => live && setGame(g))
      .catch(() => live && setGame(null))
    return () => {
      live = false
    }
  }, [client, snapshot])

  if (!snapshot) return null
  const me = snapshot.state.userTeamId
  const today = snapshot.state.date

  if (!game) {
    return (
      <Panel title="All-Star weekend">
        <p className="dim" style={{ margin: 0 }}>
          There is no All-Star break on this calendar yet.
        </p>
      </Panel>
    )
  }

  const result = game.result
  const mvpId = result?.mvpPlayerId ?? null
  const mvp = [...game.east, ...game.west].find((p) => p.playerId === mvpId) ?? null
  const away = daysBetween(today, game.date)
  const mineEast = game.east.filter((p) => p.teamId === me)
  const mineWest = game.west.filter((p) => p.teamId === me)
  const mine = [...mineEast, ...mineWest]

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <Panel title={`${seasonLabel(game.yearEnd)} All-Star Game · ${longDate(game.date)}`}>
        {game.played && result ? (
          <>
            <div className="lg-final">
              <span style={{ textAlign: 'right' }}>
                <div className="conf">East</div>
                <div className={result.eastPts >= result.westPts ? 'pts won' : 'pts'}>
                  {result.eastPts}
                </div>
              </span>
              <span className="faint">—</span>
              <span>
                <div className="conf">West</div>
                <div className={result.westPts >= result.eastPts ? 'pts won' : 'pts'}>
                  {result.westPts}
                </div>
              </span>
            </div>
            <p style={{ margin: 0, textAlign: 'center' }}>
              {mvp ? (
                <>
                  <button
                    type="button"
                    className="lg-link"
                    onClick={() => openCareer(mvp.playerId)}
                  >
                    <strong>{mvp.name}</strong>
                  </button>{' '}
                  <span className="dim">
                    of the <TeamChip team={teamById.get(mvp.teamId)} long /> took the MVP.
                  </span>
                </>
              ) : (
                <span className="dim">No MVP was named.</span>
              )}
            </p>
            {!result.box ? (
              <p className="dim" style={{ margin: '10px 0 0', textAlign: 'center' }}>
                The box wasn't kept on this save.
              </p>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0 }}>
            {away > 0
              ? `The break is ${away} day${away === 1 ? '' : 's'} away. These are the squads on today's vote — a man can still play his way in, or out.`
              : 'The break is here. Continue and the exhibition is played.'}
          </p>
        )}

        {mine.length > 0 ? (
          <p className="warn" style={{ margin: '10px 0 0' }}>
            {mine.length === 1
              ? `${mine[0]?.name} is your All-Star${mine[0]?.starter ? ', and he starts' : ''}.`
              : `You have ${mine.length} All-Stars: ${mine.map((p) => p.name).join(', ')}.`}
          </p>
        ) : (
          <p className="dim" style={{ margin: '10px 0 0' }}>
            Nobody of yours has made it.
          </p>
        )}
      </Panel>

      {result?.box ? (
        <Panel title="Box score">
          <div style={{ display: 'grid', gap: 14 }}>
            <GameBox result={result.box} nameOf={allStarName} colorOf={allStarColor} first="home" />
          </div>
        </Panel>
      ) : null}

      <div className="lg-allstar">
        <Squad conference="East" picks={game.east} me={me} mvpId={mvpId} onOpen={openCareer} />
        <Squad conference="West" picks={game.west} me={me} mvpId={mvpId} onOpen={openCareer} />
      </div>

      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        Twelve a side, the top five in each conference's vote starting. Selections count the All-NBA
        teams a man has made in this save, so a first-timer reads as a first-timer.
      </p>

      {career}
    </div>
  )
}
