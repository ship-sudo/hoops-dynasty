/**
 * Vs reality: your timeline beside the one that actually happened.
 *
 * The real record lives in `history.json`, which sits next to the season bundles and weighs about
 * 7 MB, so it is fetched only when this screen is opened and only once per session. If it is not
 * there the screen still shows your own seasons and says plainly that the comparison is missing.
 */
import type { HistoryBundle } from '@hoops/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SimSeason } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { n1, seasonLabel } from '../ui/format.ts'
import { loadRealHistory, type RealHistory, realHistory } from '../ui/realhistory.ts'

/** What this screen needs out of the 7 MB: the seasons table and a playerId → name index. */
type RealRecord = RealHistory

interface Row {
  yearEnd: number
  sim: SimSeason
  real: HistoryBundle['seasons'][number] | null
  realMvp: { playerId: string; name: string } | null
  /** Your franchise as it really went that year. */
  realUser: { wins: number; losses: number } | null
  /** Mean absolute win difference across every team that appears in both tables. */
  drift: number
  /** The teams that moved furthest from their real record, worst first. */
  movers: { teamId: string; simWins: number; realWins: number; delta: number }[]
}

function build(sims: SimSeason[], real: RealRecord | null, userTeamId: string): Row[] {
  return sims.map((sim) => {
    const r = real?.seasons[sim.yearEnd] ?? null
    const realWins = new Map((r?.standings ?? []).map((s) => [s.teamId, s]))
    const movers = sim.standings
      .map((s) => {
        const rw = realWins.get(s.teamId)
        return rw
          ? { teamId: s.teamId, simWins: s.wins, realWins: rw.wins, delta: s.wins - rw.wins }
          : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    const drift = movers.length
      ? movers.reduce((t, m) => t + Math.abs(m.delta), 0) / movers.length
      : 0
    const mvpId = r?.awards.find((a) => a.award === 'MVP')?.playerId ?? null
    const ru = realWins.get(userTeamId)
    return {
      yearEnd: sim.yearEnd,
      sim,
      real: r,
      realMvp: mvpId ? { playerId: mvpId, name: real?.names.get(mvpId) ?? mvpId } : null,
      realUser: ru ? { wins: ru.wins, losses: ru.losses } : null,
      drift,
      movers: movers.slice(0, 8),
    }
  })
}

function Delta({ v, unit = '' }: { v: number; unit?: string }) {
  if (v === 0) return <span className="dim num">level</span>
  return (
    <span className={v > 0 ? 'num win' : 'num loss'}>
      {v > 0 ? '+' : ''}
      {n1(v).replace('.0', '')}
      {unit}
    </span>
  )
}

export function History() {
  const { client, snapshot, teamById } = useStore()
  const me = snapshot?.state.userTeamId ?? ''

  const [sims, setSims] = useState<SimSeason[]>([])
  const [real, setReal] = useState<RealRecord | null>(realHistory())
  const [loading, setLoading] = useState(!realHistory())
  const [problem, setProblem] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .seasonHistory()
      .then((s) => live && setSims(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, snapshot])

  const fetchReal = useCallback(() => {
    setLoading(true)
    setProblem(null)
    loadRealHistory()
      .then((r) => {
        setReal(r)
        setLoading(false)
      })
      .catch((e: unknown) => {
        setProblem(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!realHistory()) fetchReal()
  }, [fetchReal])

  const rows = useMemo(() => build(sims, real, me), [sims, real, me])
  const maxDrift = Math.max(1, ...rows.map((r) => r.drift))
  const detail = rows.find((r) => r.yearEnd === open) ?? rows[rows.length - 1] ?? null

  if (!snapshot) return null
  const team = teamById.get(me)
  const name = (id: string | null | undefined) => {
    const t = id ? teamById.get(id) : undefined
    return t ? `${t.city} ${t.name}` : (id ?? '—')
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pagehead">
        <h1>Vs reality</h1>
        <span className="dim">
          {team ? `${team.city} ${team.name}` : ''} · {rows.length} season
          {rows.length === 1 ? '' : 's'} completed
        </span>
        <span style={{ flex: 1 }} />
        {problem ? (
          <button type="button" className="ghost" onClick={fetchReal}>
            Retry
          </button>
        ) : null}
      </div>

      {problem ? (
        <div className="banner">
          <span className="warn">
            The real record could not be loaded ({problem}). Your own seasons are shown; the
            comparison columns are blank.
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Panel>
          <p className="dim">
            Nothing to compare yet. Play a season through to the end and this fills in: your record
            against the real one, your champion against the real champion, season by season.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="How far your league has drifted" flush>
            <div className="table-x">
              <table className="grid vsreality">
                <thead>
                  <tr>
                    <th className="text">Season</th>
                    <th title="Your record that season">You</th>
                    <th title="What this franchise really did that season">Really</th>
                    <th title="Wins gained or lost against history">+/− wins</th>
                    <th className="text">Your champion</th>
                    <th className="text">Real champion</th>
                    <th className="text">Your MVP</th>
                    <th className="text">Real MVP</th>
                    <th title="Average wins per club away from the real season">Drift</th>
                    <th className="text" style={{ minWidth: 140 }}>
                      How far the league has moved
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const champMatch =
                      r.real?.champion != null && r.sim.championTeamId === r.real.champion
                    const mvpMatch =
                      r.realMvp != null &&
                      r.sim.mvp != null &&
                      r.sim.mvp.playerId === r.realMvp.playerId
                    return (
                      <tr
                        key={r.yearEnd}
                        className={`clickable${detail?.yearEnd === r.yearEnd ? ' me' : ''}`}
                        onClick={() => setOpen(r.yearEnd)}
                      >
                        <td className="text">{seasonLabel(r.yearEnd)}</td>
                        <td className="num">
                          {r.sim.userWins}-{r.sim.userLosses}
                        </td>
                        <td className="num dim">
                          {r.realUser ? `${r.realUser.wins}-${r.realUser.losses}` : '—'}
                        </td>
                        <td className="num">
                          {r.realUser ? <Delta v={r.sim.userWins - r.realUser.wins} /> : '—'}
                        </td>
                        <td className={champMatch ? 'text dim' : 'text'}>
                          <TeamChip team={teamById.get(r.sim.championTeamId ?? '')} />
                        </td>
                        <td className="text">
                          {r.real ? (
                            <TeamChip team={teamById.get(r.real.champion ?? '')} />
                          ) : (
                            <span className="faint">—</span>
                          )}
                          {champMatch ? <span className="faint"> same</span> : null}
                        </td>
                        <td className="text">{r.sim.mvp?.name ?? '—'}</td>
                        <td className={mvpMatch ? 'text dim' : 'text'}>
                          {r.realMvp?.name ?? '—'}
                          {mvpMatch ? <span className="faint"> same</span> : null}
                        </td>
                        <td className="num">{n1(r.drift)}</td>
                        <td className="text">
                          <span className="bar">
                            <span style={{ width: `${(r.drift / maxDrift) * 100}%` }} />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {detail ? (
            <div className="cols two">
              <Panel title={`${seasonLabel(detail.yearEnd)} — what changed most`} flush>
                <table className="grid">
                  <thead>
                    <tr>
                      <th className="text">Team</th>
                      <th>You</th>
                      <th>Really</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.movers.length === 0 ? (
                      <tr>
                        <td className="text dim" colSpan={4}>
                          No real standings for this season.
                        </td>
                      </tr>
                    ) : (
                      detail.movers.map((m) => (
                        <tr key={m.teamId} className={m.teamId === me ? 'me' : undefined}>
                          <td className="text">
                            <TeamChip team={teamById.get(m.teamId)} long />
                          </td>
                          <td className="num">{m.simWins}</td>
                          <td className="num dim">{m.realWins}</td>
                          <td className="num">
                            <Delta v={m.delta} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Panel>

              <Panel title={`${seasonLabel(detail.yearEnd)} — the headlines`}>
                <dl className="kv">
                  <dt>Your record</dt>
                  <dd className="num">
                    {detail.sim.userWins}-{detail.sim.userLosses}
                    {detail.realUser ? (
                      <span className="dim">
                        {' '}
                        · really {detail.realUser.wins}-{detail.realUser.losses}
                      </span>
                    ) : null}
                  </dd>
                  <dt>Champion</dt>
                  <dd>
                    {name(detail.sim.championTeamId)}
                    {detail.real ? (
                      <span className="dim"> · really {name(detail.real.champion)}</span>
                    ) : null}
                  </dd>
                  <dt>MVP</dt>
                  <dd>
                    {detail.sim.mvp?.name ?? '—'}
                    {detail.realMvp ? (
                      <span className="dim"> · really {detail.realMvp.name}</span>
                    ) : null}
                  </dd>
                  <dt>League drift</dt>
                  <dd className="num">
                    {n1(detail.drift)} wins per team, on average, away from history
                  </dd>
                  <dt>Biggest swing</dt>
                  <dd>
                    {detail.movers[0]
                      ? `${name(detail.movers[0].teamId)} — ${detail.movers[0].simWins} wins against a real ${detail.movers[0].realWins}`
                      : '—'}
                  </dd>
                </dl>
                {loading ? <p className="faint">Loading the real record…</p> : null}
              </Panel>
            </div>
          ) : null}
        </>
      )}

      <p className="faint" style={{ fontSize: 11 }}>
        Real records come from <code>history.json</code>, fetched once when this screen opens.
        Divergence is the mean absolute difference in wins between your league and the real one,
        over every team that played in both.
      </p>
    </div>
  )
}
