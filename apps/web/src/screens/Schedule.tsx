import { useEffect, useMemo, useState } from 'react'
import type { ScheduleEntry } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { shortDate } from '../ui/format.ts'
import { useBoxScore } from './BoxScore.tsx'

export function Schedule() {
  const { client, snapshot, teams, teamById } = useStore()
  const openBox = useBoxScore()
  const me = snapshot?.state.userTeamId ?? ''
  const [scope, setScope] = useState<string>(me)
  const [rows, setRows] = useState<ScheduleEntry[]>([])

  useEffect(() => setScope(me), [me])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .schedule(scope || undefined)
      .then((s) => live && setRows(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, scope, snapshot])

  const cols = useMemo<Column<ScheduleEntry>[]>(
    () => [
      {
        id: 'date',
        header: 'Date',
        accessorKey: 'date',
        meta: { text: true },
        cell: (c) => shortDate(c.getValue<string>()),
        size: 110,
      },
      {
        id: 'away',
        header: 'Away',
        accessorFn: (r) => teamById.get(r.awayTeamId)?.abbr ?? r.awayTeamId,
        meta: { text: true },
        cell: (c) => <TeamChip team={teamById.get(c.row.original.awayTeamId)} long />,
        size: 180,
      },
      {
        id: 'awayPts',
        header: '',
        accessorFn: (r) => r.result?.awayPts ?? -1,
        cell: (c) => {
          const r = c.row.original.result
          if (!r) return <span className="faint">—</span>
          return <strong className={r.awayPts > r.homePts ? 'win' : undefined}>{r.awayPts}</strong>
        },
        size: 44,
      },
      {
        id: 'homePts',
        header: '',
        accessorFn: (r) => r.result?.homePts ?? -1,
        cell: (c) => {
          const r = c.row.original.result
          if (!r) return <span className="faint">—</span>
          return <strong className={r.homePts > r.awayPts ? 'win' : undefined}>{r.homePts}</strong>
        },
        size: 44,
      },
      {
        id: 'home',
        header: 'Home',
        accessorFn: (r) => teamById.get(r.homeTeamId)?.abbr ?? r.homeTeamId,
        meta: { text: true },
        cell: (c) => <TeamChip team={teamById.get(c.row.original.homeTeamId)} long />,
        size: 180,
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (r) => (r.result ? 1 : 0),
        meta: { text: true },
        cell: (c) => {
          const row = c.row.original
          if (!row.result) return <span className="faint">scheduled</span>
          if (!scope) return <span className="dim">final</span>
          const home = row.homeTeamId === scope
          const mine = home ? row.result.homePts : row.result.awayPts
          const theirs = home ? row.result.awayPts : row.result.homePts
          return <span className={mine > theirs ? 'win' : 'loss'}>{mine > theirs ? 'W' : 'L'}</span>
        },
      },
      {
        id: 'ot',
        header: 'OT',
        accessorFn: (r) => r.result?.overtimes ?? 0,
        cell: (c) => (c.getValue<number>() > 0 ? `${c.getValue<number>()}OT` : ''),
      },
    ],
    [teamById, scope],
  )

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)),
    [teams],
  )
  const played = rows.filter((r) => r.result).length

  if (!snapshot) return null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pagehead">
        <h1>Schedule</h1>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Whole league</option>
          {sortedTeams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.abbr} — {t.city} {t.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <span className="dim num">
          {played} played · {rows.length - played} to go
        </span>
      </div>
      <Panel flush>
        <DataTable
          data={rows}
          columns={cols}
          initialSort={[{ id: 'date', desc: false }]}
          onRowClick={(r) => r.result && openBox(r.gameId)}
          empty="No fixtures."
        />
      </Panel>
      <p className="faint" style={{ fontSize: 11 }}>
        Click a finished game for the full box score. Regular season only — playoffs come with
        packages/game.
      </p>
    </div>
  )
}
