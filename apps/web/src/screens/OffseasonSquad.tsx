/**
 * The squad as it stands this summer: who is under contract, who is a free agent, who will not stay.
 */
import { useEffect, useMemo, useState } from 'react'
import type { OffseasonState, RosterRow } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { money } from '../ui/format.ts'
import { ownFreeAgents } from './offseasonFlow.ts'

function statusOf(
  row: RosterRow,
  ownIds: Set<string>,
  leavingIds: Set<string>,
): { label: string; cls: string } {
  if (leavingIds.has(row.player.playerId)) return { label: 'Will not re-sign', cls: 'loss' }
  if (ownIds.has(row.player.playerId) || row.contractYears <= 0)
    return { label: 'Free agent', cls: 'warn' }
  if (row.contractYears === 1) return { label: 'Last year', cls: 'dim' }
  return { label: `Under contract · ${row.contractYears} yr`, cls: 'dim' }
}

export function OffseasonSquad({
  off,
  me,
  onResign,
  onRoster,
}: {
  off: OffseasonState
  me: string
  onResign: () => void
  onRoster: () => void
}) {
  const { client, snapshot } = useStore()
  const [rows, setRows] = useState<RosterRow[]>([])

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is the refetch trigger
  useEffect(() => {
    let live = true
    client
      .roster(me)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [client, me, snapshot, off.freeAgents.length])

  const own = useMemo(() => ownFreeAgents(off.freeAgents, me), [off.freeAgents, me])
  const ownIds = useMemo(() => new Set(own.map((p) => p.playerId)), [own])
  const leavingIds = useMemo(() => {
    const ids = new Set<string>()
    if (off.phase !== 'freeagency') return ids
    for (const r of rows) {
      if (r.contractYears > 0) continue
      if (!ownIds.has(r.player.playerId)) ids.add(r.player.playerId)
    }
    return ids
  }, [off.phase, rows, ownIds])

  const cols = useMemo<Column<RosterRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Player',
        accessorFn: (r) => r.player.name,
        meta: { text: true },
        size: 170,
      },
      {
        id: 'pos',
        header: 'Pos',
        accessorFn: (r) => r.player.pos,
        meta: { text: true },
        size: 44,
      },
      { id: 'age', header: 'Age', accessorFn: (r) => r.player.age, size: 44 },
      { id: 'ovr', header: 'Ovr', accessorFn: (r) => r.card.overall, size: 48 },
      {
        id: 'salary',
        header: 'Salary',
        accessorFn: (r) => r.salary ?? 0,
        cell: (c) => money(c.getValue<number>() || null),
        size: 78,
      },
      {
        id: 'status',
        header: 'Contract',
        accessorFn: (r) => statusOf(r, ownIds, leavingIds).label,
        cell: (c) => {
          const s = statusOf(c.row.original, ownIds, leavingIds)
          return <span className={s.cls}>{s.label}</span>
        },
        meta: { text: true },
        size: 150,
      },
    ],
    [ownIds, leavingIds],
  )

  const marketOpen = off.phase === 'freeagency'
  const leaving = rows.filter((r) => leavingIds.has(r.player.playerId))

  return (
    <>
      <Panel title="This summer">
        <p style={{ margin: 0, maxWidth: 560 }}>
          {marketOpen
            ? own.length > 0
              ? `${own.length} of yours ${own.length === 1 ? 'is a' : 'are'} free agent${own.length === 1 ? '' : 's'}. Re-sign them before the rest of the league bids.`
              : 'Everyone who will stay is under contract. Check the open market next.'
            : 'The draft is still on. This is the room as it stands — rookies and free agency wait until the last pick.'}
        </p>
        {leaving.length > 0 ? (
          <p className="warn" style={{ margin: '8px 0 0' }}>
            {leaving.map((r) => r.player.name).join(', ')} will not re-sign here, whatever you
            offer.
          </p>
        ) : null}
        <div className="rowline" style={{ marginTop: 12 }}>
          {marketOpen && own.length > 0 ? (
            <button type="button" className="primary" onClick={onResign}>
              Re-sign your players ▸
            </button>
          ) : null}
          <button type="button" className="ghost" onClick={onRoster}>
            Open the full roster
          </button>
        </div>
      </Panel>
      <Panel title={`Roster · ${rows.length}`} flush>
        <DataTable
          data={rows}
          columns={cols}
          initialSort={[{ id: 'ovr', desc: true }]}
          rowClass={(r) =>
            ownIds.has(r.player.playerId)
              ? 'oncl'
              : leavingIds.has(r.player.playerId)
                ? 'me'
                : undefined
          }
          empty="Nobody on the roster."
        />
      </Panel>
    </>
  )
}
