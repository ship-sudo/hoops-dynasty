/** The two asset grids on the trade screen: players on the block, and future picks. */
import type { PickRef } from '../sim/api.ts'
import { type Column, DataTable } from './DataTable.tsx'
import { money } from './format.ts'

/** One tradeable player, with everything needed to see why a deal is refused. */
export interface AssetRow {
  playerId: string
  name: string
  pos: string
  age: number
  ovr: number
  salary: number
  contractYears: number
  /** Production over the life of the deal. */
  value: number
  /** Production minus what he is owed. */
  surplus: number
}

export const pickKeyOf = (p: PickRef): string => `${p.draftYear}-${p.round}-${p.fromTeamId}`

export const pickLabel = (p: PickRef): string =>
  `${p.draftYear} round ${p.round} (≈ pick ${p.expectedSlot})`

const ASSET_COLUMNS: Column<AssetRow>[] = [
  { id: 'name', header: 'Player', accessorFn: (r) => r.name, meta: { text: true }, size: 150 },
  { id: 'pos', header: 'Pos', accessorFn: (r) => r.pos, meta: { text: true } },
  { id: 'age', header: 'Age', accessorFn: (r) => r.age },
  { id: 'ovr', header: 'Ovr', accessorFn: (r) => r.ovr },
  {
    id: 'salary',
    header: 'Salary',
    accessorFn: (r) => r.salary,
    cell: (c) => money(c.getValue<number>()),
  },
  { id: 'yrs', header: 'Yrs', accessorFn: (r) => r.contractYears },
  {
    id: 'value',
    header: 'Value',
    accessorFn: (r) => r.value,
    cell: (c) => money(c.getValue<number>()),
    meta: { title: 'What he produces over the life of the deal' },
  },
  {
    id: 'surplus',
    header: 'Surplus',
    accessorFn: (r) => r.surplus,
    cell: (c) => <Signed v={c.getValue<number>()} />,
    meta: { title: 'Value minus the salary owed. What a trade is judged on.' },
  },
]

export function Signed({ v }: { v: number }) {
  if (!v) return <span className="dim">—</span>
  return (
    <span className={v > 0 ? 'win' : 'loss'}>
      {v > 0 ? '+' : '−'}
      {money(Math.abs(v))}
    </span>
  )
}

export function AssetTable({
  rows,
  selected,
  onToggle,
  empty,
}: {
  rows: AssetRow[]
  selected: ReadonlySet<string>
  onToggle: (playerId: string) => void
  empty: string
}) {
  return (
    <DataTable
      data={rows}
      columns={ASSET_COLUMNS}
      initialSort={[{ id: 'surplus', desc: true }]}
      rowClass={(r) => (selected.has(r.playerId) ? 'me' : undefined)}
      onRowClick={(r) => onToggle(r.playerId)}
      empty={empty}
    />
  )
}

export function PickList({
  picks,
  selected,
  onToggle,
}: {
  picks: PickRef[]
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  if (picks.length === 0) return <p className="faint">No tradeable picks.</p>
  return (
    <div className="picklist">
      {picks.map((p) => {
        const key = pickKeyOf(p)
        return (
          <button
            key={key}
            type="button"
            aria-pressed={selected.has(key)}
            onClick={() => onToggle(key)}
          >
            {pickLabel(p)}
          </button>
        )
      })}
    </div>
  )
}
