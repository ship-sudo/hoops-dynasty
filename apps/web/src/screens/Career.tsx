/**
 * A player's career, in one place: every season he ever played, his peak, his clubs, his honours,
 * where he stands in his franchise's all-time lists.
 */
import {
  type Career,
  type CareerSeason,
  careerOf,
  FLAG,
  FRANCHISE_KEYS,
  franchiseRank,
  type GameState,
  isOneClubMan,
  peakSeason,
  totalsOf,
} from '@hoops/game'
import { useMemo } from 'react'
import { useStore } from '../store.tsx'
import { Modal, Panel, TeamChip } from '../ui/bits.tsx'
import { ordinal, pct1, per, seasonLabel } from '../ui/format.ts'
import { PlayerActions } from './PlayerActions.tsx'

const thousands = (n: number): string => Math.round(n).toLocaleString('en-US')

/** The honours on one season, shortest first: this column has to stay narrow. */
function badges(flags: number): { label: string; cls: string; title: string }[] {
  const out: { label: string; cls: string; title: string }[] = []
  if (flags & FLAG.champion) out.push({ label: '★', cls: 'win', title: 'Champion' })
  if (flags & FLAG.mvp) out.push({ label: 'MVP', cls: 'warn', title: 'Most Valuable Player' })
  if (flags & FLAG.dpoy)
    out.push({ label: 'DPOY', cls: 'warn', title: 'Defensive Player of the Year' })
  if (flags & FLAG.roy) out.push({ label: 'ROY', cls: 'warn', title: 'Rookie of the Year' })
  if (flags & FLAG.allNba1) out.push({ label: 'All-NBA 1', cls: '', title: 'All-NBA first team' })
  else if (flags & FLAG.allNba2)
    out.push({ label: 'All-NBA 2', cls: '', title: 'All-NBA second team' })
  else if (flags & FLAG.allNba3)
    out.push({ label: 'All-NBA 3', cls: '', title: 'All-NBA third team' })
  if (flags & FLAG.playoffs && !(flags & FLAG.champion))
    out.push({ label: 'po', cls: 'dim', title: 'Made the playoffs' })
  return out
}

/**
 * The season in progress is not in the career store yet — a career line is written when the season
 * closes. Splice the running totals on the end so a career page is never a year out of date.
 */
function withCurrentSeason(
  game: GameState,
  career: Career | null,
  playerId: string,
): Career | null {
  const live = game.stats[playerId]
  const player = game.league.players.find((p) => p.playerId === playerId)
  const base: Career =
    career ??
    (player
      ? {
          playerId,
          name: player.name,
          pos: player.pos,
          debutYear: player.debutYear,
          retiredYear: 0,
          draft: player.draft,
          seasons: [],
        }
      : {
          playerId,
          name: playerId,
          pos: '—',
          debutYear: 0,
          retiredYear: 0,
          draft: null,
          seasons: [],
        })
  if (!live || live.gp <= 0) return base.seasons.length || player ? base : null
  if (base.seasons.some((s) => s.yearEnd === game.season.yearEnd)) return base
  const current: CareerSeason = {
    yearEnd: game.season.yearEnd,
    teamId: live.teamId,
    age: player?.age ?? 0,
    gp: live.gp,
    gs: live.gs,
    min: live.min,
    pts: live.pts,
    fgm: live.fgm,
    fga: live.fga,
    fg3m: live.fg3m,
    fg3a: live.fg3a,
    ftm: live.ftm,
    fta: live.fta,
    oreb: live.oreb,
    dreb: live.dreb,
    ast: live.ast,
    stl: live.stl,
    blk: live.blk,
    tov: live.tov,
    pf: live.pf,
    flags: 0,
  }
  return { ...base, seasons: [...base.seasons, current] }
}

export function PlayerCareer({ playerId, onClose }: { playerId: string; onClose: () => void }) {
  const { game, teamById } = useStore()

  const career = useMemo(
    () => (game ? withCurrentSeason(game, careerOf(game, playerId), playerId) : null),
    [game, playerId],
  )

  if (!game || !career) return null
  const totals = totalsOf(career.seasons)
  const peak = peakSeason(career.seasons)
  const active = game.league.players.find((p) => p.playerId === playerId)
  const hall = (game.hallOfFame ?? []).find((h) => h.playerId === playerId)

  // The club he is most a part of: where he played the most seasons, ties going to the latest.
  const mainTeamId = [...totals.teams].sort((a, b) => {
    const count = (id: string) => career.seasons.filter((s) => s.teamId === id).length
    return count(b) - count(a)
  })[0]
  const mainTeam = mainTeamId ? teamById.get(mainTeamId) : undefined
  const ranks = mainTeamId
    ? FRANCHISE_KEYS.map((key) => ({ key, ...franchiseRank(game, mainTeamId, playerId, key) }))
    : []

  const RANK_LABEL: Record<(typeof FRANCHISE_KEYS)[number], string> = {
    pts: 'Points',
    reb: 'Rebounds',
    ast: 'Assists',
    gp: 'Games',
  }

  return (
    <Modal
      title={
        <span>
          {career.name}{' '}
          <span className="dim">
            · {career.pos} ·{' '}
            {active
              ? `${active.age} years old`
              : career.retiredYear
                ? `retired ${career.retiredYear}`
                : 'no longer in the league'}
            {hall ? ' · Hall of Fame' : ''}
          </span>
        </span>
      }
      onClose={onClose}
      wide
    >
      <div
        style={{
          padding: 12,
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 320px',
          gap: 14,
        }}
      >
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <Panel
            title={`Career · ${totals.seasons} season${totals.seasons === 1 ? '' : 's'}`}
            flush
          >
            <div className="table-x">
              <table className="grid career">
                <thead>
                  <tr>
                    <th className="text">Season</th>
                    <th className="text">Team</th>
                    <th>Age</th>
                    <th title="Games played">GP</th>
                    <th title="Games started">GS</th>
                    <th title="Minutes per game">MPG</th>
                    <th title="Points per game">PPG</th>
                    <th title="Rebounds per game">RPG</th>
                    <th title="Assists per game">APG</th>
                    <th title="Steals per game">SPG</th>
                    <th title="Blocks per game">BPG</th>
                    <th title="Field goal percentage">FG%</th>
                    <th title="Three-point percentage">3P%</th>
                    <th title="Free throw percentage">FT%</th>
                    <th className="text" style={{ minWidth: 120 }}>
                      Honours
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {career.seasons.map((s) => (
                    <tr key={s.yearEnd}>
                      <td className="text">{seasonLabel(s.yearEnd)}</td>
                      <td className="text">
                        <TeamChip team={teamById.get(s.teamId)} />
                      </td>
                      <td className="num dim">{s.age || '—'}</td>
                      <td className="num">{s.gp}</td>
                      <td className="num dim">{s.gs}</td>
                      <td className="num">{per(s.min, s.gp)}</td>
                      <td className="num">{per(s.pts, s.gp)}</td>
                      <td className="num">{per(s.oreb + s.dreb, s.gp)}</td>
                      <td className="num">{per(s.ast, s.gp)}</td>
                      <td className="num dim">{per(s.stl, s.gp)}</td>
                      <td className="num dim">{per(s.blk, s.gp)}</td>
                      <td className="num dim">{s.fga ? pct1(s.fgm / s.fga) : '—'}</td>
                      <td className="num dim">{s.fg3a ? pct1(s.fg3m / s.fg3a) : '—'}</td>
                      <td className="num dim">{s.fta ? pct1(s.ftm / s.fta) : '—'}</td>
                      <td className="text">
                        {badges(s.flags).map((b) => (
                          <span key={b.label} className={`badge ${b.cls}`} title={b.title}>
                            {b.label}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                  {career.seasons.length === 0 ? (
                    <tr>
                      <td className="text dim" colSpan={15}>
                        He has not played a professional game yet.
                      </td>
                    </tr>
                  ) : (
                    <tr className="sep totals">
                      <td className="text">Career</td>
                      <td className="text dim">
                        {totals.teams.length} club{totals.teams.length === 1 ? '' : 's'}
                      </td>
                      <td className="num dim">—</td>
                      <td className="num">{thousands(totals.gp)}</td>
                      <td className="num dim">{thousands(totals.gs)}</td>
                      <td className="num">{per(totals.min, totals.gp)}</td>
                      <td className="num">{per(totals.pts, totals.gp)}</td>
                      <td className="num">{per(totals.reb, totals.gp)}</td>
                      <td className="num">{per(totals.ast, totals.gp)}</td>
                      <td className="num dim">{per(totals.stl, totals.gp)}</td>
                      <td className="num dim">{per(totals.blk, totals.gp)}</td>
                      <td className="num dim">
                        {totals.fga ? pct1(totals.fgm / totals.fga) : '—'}
                      </td>
                      <td className="num dim">
                        {totals.fg3a ? pct1(totals.fg3m / totals.fg3a) : '—'}
                      </td>
                      <td className="num dim">
                        {totals.fta ? pct1(totals.ftm / totals.fta) : '—'}
                      </td>
                      <td className="text dim">
                        {thousands(totals.pts)} pts · {thousands(totals.reb)} reb ·{' '}
                        {thousands(totals.ast)} ast
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <PlayerActions playerId={playerId} onChanged={onClose} />
          {hall ? (
            <Panel title={`Hall of Fame · ${hall.year}`}>
              <p style={{ margin: 0 }}>{hall.case}</p>
            </Panel>
          ) : null}

          <Panel title="The short version">
            <dl className="kv">
              <dt>Seasons</dt>
              <dd className="num">
                {totals.seasons}
                {career.seasons.length ? (
                  <span className="dim">
                    {' '}
                    · {seasonLabel(career.seasons[0]?.yearEnd ?? 0)} to{' '}
                    {seasonLabel(career.seasons[career.seasons.length - 1]?.yearEnd ?? 0)}
                  </span>
                ) : null}
              </dd>
              <dt>Peak</dt>
              <dd>
                {peak ? (
                  <>
                    {seasonLabel(peak.yearEnd)} —{' '}
                    <span className="num">{per(peak.pts, peak.gp)}</span> pts,{' '}
                    <span className="num">{per(peak.oreb + peak.dreb, peak.gp)}</span> reb,{' '}
                    <span className="num">{per(peak.ast, peak.gp)}</span> ast
                  </>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Drafted</dt>
              <dd>
                {career.draft
                  ? `${career.draft.year} · round ${career.draft.round}, pick ${career.draft.pick}`
                  : 'Undrafted'}
              </dd>
              <dt>Clubs</dt>
              <dd>
                {totals.teams.length === 0
                  ? '—'
                  : totals.teams.map((id) => (
                      <span key={id} style={{ marginRight: 6 }}>
                        <TeamChip team={teamById.get(id)} />
                      </span>
                    ))}
              </dd>
              <dt>Titles</dt>
              <dd className="num">{totals.titles}</dd>
              <dt>MVP</dt>
              <dd className="num">{totals.mvps}</dd>
              <dt>All-NBA</dt>
              <dd className="num">{totals.allNba}</dd>
              <dt>DPOY</dt>
              <dd className="num">{totals.dpoys}</dd>
            </dl>
            {isOneClubMan(career) ? (
              <p className="warn" style={{ marginBottom: 0, marginTop: 8 }}>
                A one-club man: {totals.seasons} seasons, one shirt
                {mainTeam ? `, ${mainTeam.city} ${mainTeam.name}` : ''}.
              </p>
            ) : null}
          </Panel>

          {mainTeam ? (
            <Panel title={`Where he ranks at ${mainTeam.city} ${mainTeam.name}`} flush>
              <table className="grid">
                <tbody>
                  {ranks.map((r) => (
                    <tr key={r.key}>
                      <td className="text">{RANK_LABEL[r.key]}</td>
                      <td className="num">{thousands(r.value)}</td>
                      <td className={r.rank <= 5 ? 'num win' : 'num dim'}>
                        {r.rank > 0 ? `${ordinal(r.rank)} of ${r.of}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
                All-time club lists, counting only the seasons he spent here.
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
