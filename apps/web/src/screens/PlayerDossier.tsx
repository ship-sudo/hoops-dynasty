/**
 * The first screenful of a player: healthy or not, legs, risk, role, the last ten.
 * Roster and career both open with this so a name-click anywhere agrees.
 */
import { careerOf, PLAYER_ROLE_LABEL, type Role } from '@hoops/game'
import { injuryRisk } from '@hoops/injury'
import { useEffect, useMemo, useState } from 'react'
import type { GameLogRow, RosterRow } from '../sim/api.ts'
import { ratingCard } from '../sim/card.ts'
import { useStore } from '../store.tsx'
import { Panel, StatRow, TeamChip } from '../ui/bits.tsx'
import { money, n0, n1, shortDate } from '../ui/format.ts'
import { useBoxScore } from './BoxScore.tsx'
import {
  absenceMark,
  healthCopy,
  injuryFromAvail,
  lastNAverages,
  legsOf,
  logsOf,
  recentGames,
} from './playerDossier.ts'
import './morale.css'
import './playercard.css'

const moodClass = (label: string) => `mr-${label}`

const roleLabel = (role: string): string =>
  PLAYER_ROLE_LABEL[role as Role] ?? role.replace(/_/g, ' ')

export function PlayerDossier({
  playerId,
  row: given,
}: {
  playerId: string
  row?: RosterRow | null
}) {
  const { client, game, snapshot, teamById, refresh } = useStore()
  const openBox = useBoxScore()
  const [fetched, setFetched] = useState<RosterRow | null>(null)
  const [logs, setLogs] = useState<GameLogRow[]>([])
  const [sitting, setSitting] = useState(false)
  const [picked, setPicked] = useState<'regular' | 'postseason' | null>(null)

  const player = game?.league.players.find((p) => p.playerId === playerId)
  const teamId = player?.teamId ?? given?.player.teamId ?? null

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is the refetch trigger
  useEffect(() => {
    if (given || !teamId) {
      setFetched(null)
      return
    }
    let live = true
    client
      .roster(teamId)
      .then((rows) => {
        if (live) setFetched(rows.find((r) => r.player.playerId === playerId) ?? null)
      })
      .catch(() => {
        if (live) setFetched(null)
      })
    return () => {
      live = false
    }
  }, [client, given, playerId, teamId, snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is the refetch trigger
  useEffect(() => {
    let live = true
    client
      .manager<GameLogRow[]>('gameLog', playerId, 120)
      .then((rows) => {
        if (live) setLogs(rows)
      })
      .catch(() => {
        if (live) setLogs([])
      })
    return () => {
      live = false
    }
  }, [client, playerId, snapshot])

  useEffect(() => {
    setPicked(null)
  }, [playerId])

  const row = given ?? fetched
  const avail = game?.availability?.[playerId]
  const injury = row?.injury ?? (avail ? injuryFromAvail(avail) : undefined)
  const health = healthCopy(injury)
  const legs = legsOf(avail?.condition ?? 1)
  const sat = Boolean(
    game && playerId && game.teamSettings[game.userTeamId]?.sitNext?.includes(playerId),
  )
  const yours = Boolean(game && player?.teamId && player.teamId === game.userTeamId)
  const canSit = yours && health.kind !== 'out'

  const risk = useMemo(() => {
    if (row?.injuryRisk) return row.injuryRisk
    if (!game || !player) return null
    const lastGp = careerOf(game, playerId)?.seasons.at(-1)?.gp
    const mpg = player.teamId ? game.teamSettings[player.teamId]?.minutes[playerId] : undefined
    return injuryRisk(
      player.ratings.durability,
      player.age,
      player.yearsPro,
      lastGp,
      mpg,
      game.season.rules.games,
    )
  }, [game, player, playerId, row])

  const card = useMemo(() => {
    if (row?.card) return row.card
    if (!player) return null
    return ratingCard(player.ratings, player.tendencies, player.pos, null)
  }, [player, row])

  const mood = row?.mood
  const inPostseason = game?.phase === 'playoffs' || game?.phase === 'playin'
  const postseasonLogs = useMemo(() => logsOf(logs, 'postseason'), [logs])
  const regularLogs = useMemo(() => logsOf(logs, 'regular'), [logs])
  const hasPostseason = postseasonLogs.length > 0 || Boolean(inPostseason)
  const split = picked ?? (postseasonLogs.length > 0 ? 'postseason' : 'regular')
  const recent = useMemo(() => {
    const src = split === 'postseason' ? postseasonLogs : regularLogs
    return recentGames(src, split === 'postseason' ? 40 : 10)
  }, [split, postseasonLogs, regularLogs])
  const form = useMemo(
    () => lastNAverages(recent, split === 'postseason' ? recent.length : 5),
    [recent, split],
  )
  const miss = useMemo(
    () => absenceMark(recent, health.kind === 'out'),
    [recent, health.kind],
  )

  const sit = async (next: boolean) => {
    setSitting(true)
    try {
      await client.manager('sitTonight', playerId, next)
      await refresh()
    } finally {
      setSitting(false)
    }
  }

  if (!game) return null
  if (!player && !row) {
    return (
      <div className="pc-head">
        <div className="pc-chips">
          <span className="badge dim">Retired</span>
        </div>
      </div>
    )
  }

  const salary = row?.salary ?? null
  const years = row?.contractYears ?? 0
  const overall = card?.overall
  const potential = card?.potential
  const missed = avail?.missed ?? 0

  return (
    <div className="pc-head">
      <div className="pc-chips">
        <span className={`badge ${health.badge}`}>{health.chip}</span>
        {sat ? <span className="badge warn">Sat tonight</span> : null}
        {risk ? (
          <span
            className={`badge ${risk.label === 'fragile' || risk.label === 'candidate' ? 'warn' : 'dim'}`}
            title={risk.text}
          >
            {risk.short}
          </span>
        ) : null}
        {mood ? (
          <span
            className="badge dim"
            title={
              health.kind === 'out'
                ? `Due ${mood.expectedMpg} mpg when he is back`
                : `Expects ${mood.expectedMpg} mpg`
            }
          >
            {roleLabel(mood.role)}
          </span>
        ) : null}
        {mood ? (
          <span className={`mr-label ${moodClass(mood.label)}`} title={mood.why}>
            {mood.label}
          </span>
        ) : null}
        {mood?.wantsOut ? <span className="badge loss">Wants out</span> : null}
        {canSit && !health.headline && !sat ? (
          <>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="ghost tiny"
              disabled={sitting}
              onClick={() => void sit(true)}
            >
              Sit tonight
            </button>
          </>
        ) : null}
      </div>

      <div className="pc-meta">
        {teamId ? <TeamChip team={teamById.get(teamId)} long /> : <span>Free agent</span>}
        {player ? <span>{player.yearsPro} seasons in</span> : null}
        {card?.strengths.length ? (
          <span className="strengths">{card.strengths.join(' · ')}</span>
        ) : null}
      </div>

      <StatRow
        tiles={[
          {
            k: 'Health',
            v: health.chip,
            note: injury
              ? `${injury.name}${health.kind === 'out' ? ` · ${injury.games}` : ''}`
              : missed > 0
                ? `${missed} missed this year`
                : 'Can dress',
            tone: health.badge === 'win' ? 'win' : health.badge,
          },
          {
            k: 'Legs',
            v: legs.v,
            note: legs.note,
            tone: legs.tone,
          },
          {
            k: 'Durability',
            v: risk?.short ?? '—',
            note: risk ? `~${risk.gamesOut} games out` : undefined,
            tone:
              risk?.label === 'fragile' || risk?.label === 'candidate'
                ? 'warn'
                : risk?.label === 'iron'
                  ? 'win'
                  : undefined,
          },
          {
            k: 'Role',
            v: mood ? roleLabel(mood.role) : '—',
            note:
              health.kind === 'out'
                ? mood
                  ? `due ${mood.expectedMpg} mpg when he is back`
                  : 'Cannot dress'
                : mood
                  ? mood.mpg > 0
                    ? `${mood.mpg.toFixed(1)} mpg · due ${mood.expectedMpg}`
                    : `due ${mood.expectedMpg} mpg`
                  : undefined,
            tone: health.kind === 'out' ? 'warn' : undefined,
          },
          {
            k: 'Deal',
            v: money(salary),
            note: years > 0 ? `${years} yr${years === 1 ? '' : 's'} left` : 'No deal on file',
          },
          {
            k: 'Ovr',
            v: overall ?? '—',
            note:
              yours && potential != null && potential > (overall ?? 0)
                ? `pot ${potential}`
                : card?.rising
                  ? 'still rising'
                  : undefined,
          },
        ]}
      />

      {health.headline || sat ? (
        <div className={`pc-alert ${sat && health.kind === 'healthy' ? 'sat' : health.kind}`}>
          <div>
            <div className="hd">
              {sat && health.kind === 'healthy' ? 'Sat tonight' : health.headline}
            </div>
            <div className="dt">
              {sat && health.kind === 'healthy'
                ? 'Held out of the next game. Dress him if you need him.'
                : health.detail}
              {row?.injuryHint && health.kind !== 'healthy' ? ` ${row.injuryHint}` : null}
            </div>
          </div>
          {canSit ? (
            <button
              type="button"
              className="ghost tiny"
              disabled={sitting}
              onClick={() => void sit(!sat)}
            >
              {sat ? 'Play' : 'Sit tonight'}
            </button>
          ) : null}
        </div>
      ) : null}

      <Panel
        title={
          hasPostseason
            ? 'Game log'
            : recent.length === 0
              ? 'Game log'
              : `Last ${recent.length} game${recent.length === 1 ? '' : 's'}`
        }
        actions={
          <>
            {hasPostseason ? (
              <div className="pc-log-tabs" role="tablist" aria-label="Season type">
                <button
                  type="button"
                  className={`ghost tiny${split === 'regular' ? ' on' : ''}`}
                  role="tab"
                  aria-selected={split === 'regular'}
                  onClick={() => setPicked('regular')}
                >
                  Regular
                </button>
                <button
                  type="button"
                  className={`ghost tiny${split === 'postseason' ? ' on' : ''}`}
                  role="tab"
                  aria-selected={split === 'postseason'}
                  onClick={() => setPicked('postseason')}
                >
                  Playoffs
                </button>
              </div>
            ) : null}
            {form && form.gp >= 2 ? (
              <span
                className="pc-form"
                title={
                  split === 'postseason'
                    ? 'Per game this postseason, nights he played'
                    : 'Per game over the last five nights he played'
                }
              >
                {n1(form.pts)} pts · {n1(form.reb)} reb · {n1(form.ast)} ast
              </span>
            ) : null}
          </>
        }
        flush
      >
        {recent.length === 0 ? (
          <p className="dim" style={{ margin: 0, padding: '10px 12px', fontSize: 12 }}>
            {split === 'postseason'
              ? 'No playoff games yet.'
              : 'No games yet this season.'}
          </p>
        ) : (
          <div className="table-x">
            <table className="grid pc-log">
              <thead>
                <tr>
                  <th className="text">Date</th>
                  <th className="text">Matchup</th>
                  <th>W/L</th>
                  <th>MIN</th>
                  <th>PTS</th>
                  <th>REB</th>
                  <th>AST</th>
                  <th>STL</th>
                  <th>BLK</th>
                  <th>FG</th>
                  <th>3P</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((g, i) => {
                  const opp = teamById.get(g.opponentTeamId)
                  const line = g.log?.line
                  const thin = g.thin || Boolean(g.log?.thin)
                  const skipped = miss[i]
                  return (
                    <tr
                      key={g.gameId}
                      className="clickable"
                      onClick={() => openBox(g.gameId)}
                      title={`${g.teamPts}–${g.opponentPts}`}
                    >
                      <td className="text dim">{shortDate(g.date)}</td>
                      <td className="text opp">
                        {g.home ? 'vs' : '@'} {opp?.abbr ?? g.opponentTeamId}
                        {g.seasonType === 'playin' ? (
                          <span className="faint"> · PI</span>
                        ) : null}
                        {g.started ? <span className="faint"> ·</span> : null}
                      </td>
                      <td className={g.won ? 'num win' : 'num loss'}>{g.won ? 'W' : 'L'}</td>
                      {skipped ? (
                        <td className={`text ${skipped === 'out' ? 'out' : 'dnp'}`} colSpan={8}>
                          {skipped === 'out' ? 'Out' : 'DNP'}
                        </td>
                      ) : line ? (
                        <>
                          <td className="num">{n0(line.min)}</td>
                          <td className={`num pts${line.pts >= 20 ? ' hot' : ''}`}>
                            {n0(line.pts)}
                          </td>
                          <td className="num">{n0(line.oreb + line.dreb)}</td>
                          <td className="num">{n0(line.ast)}</td>
                          <td className="num">{thin ? '—' : n0(line.stl)}</td>
                          <td className="num">{thin ? '—' : n0(line.blk)}</td>
                          <td className="num">
                            {thin ? '—' : `${n0(line.fgm)}-${n0(line.fga)}`}
                          </td>
                          <td className="num">
                            {thin ? '—' : `${n0(line.fg3m)}-${n0(line.fg3a)}`}
                          </td>
                        </>
                      ) : (
                        <td className="text dnp" colSpan={8}>
                          DNP
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
