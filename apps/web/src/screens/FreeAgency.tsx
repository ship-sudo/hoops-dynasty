import { useEffect, useMemo, useState } from 'react'
import type { FreeAgentView } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { money } from '../ui/format.ts'
import type { PhaseProps } from './Draft.tsx'

const toM = (v: number) => Math.round((v / 1_000_000) * 100) / 100

export function FreeAgency({ off, act, working, me }: PhaseProps) {
  const { teamById } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [amountM, setAmountM] = useState('')
  const [years, setYears] = useState(2)

  const selected = useMemo(
    () => off.freeAgents.find((p) => p.playerId === selectedId) ?? null,
    [off.freeAgents, selectedId],
  )

  // Selecting a player loads his existing offer, or his asking price as the opening bid.
  useEffect(() => {
    if (!selected) return
    setAmountM(String(toM(selected.offer?.amount ?? selected.asking)))
    setYears(selected.offer?.years ?? selected.askingYears)
  }, [selected])

  const offers = useMemo(() => off.freeAgents.filter((p) => p.offer), [off.freeAgents])
  const committed = offers.reduce((t, p) => t + (p.offer?.amount ?? 0), 0)

  const fin = off.finance
  const space = fin ? fin.cap - fin.payroll : 0
  /** A tax line equal to the cap is the sim's "this era had no luxury tax" fallback. */
  const hasTax = fin != null && fin.taxLine > fin.cap
  const over = committed - space
  const projected = (fin?.payroll ?? 0) + committed

  const cols = useMemo<Column<FreeAgentView>[]>(
    () => [
      {
        id: 'name',
        header: 'Player',
        accessorFn: (p) => p.name,
        meta: { text: true },
        size: 170,
      },
      { id: 'pos', header: 'Pos', accessorFn: (p) => p.pos, meta: { text: true }, size: 44 },
      { id: 'age', header: 'Age', accessorFn: (p) => p.age, size: 44 },
      { id: 'ovr', header: 'Ovr', accessorFn: (p) => p.overall, size: 48 },
      {
        id: 'asking',
        header: 'Wants',
        accessorFn: (p) => p.asking,
        cell: (c) => money(c.getValue() as number),
        size: 78,
      },
      {
        id: 'yrs',
        header: 'Yrs',
        accessorFn: (p) => p.askingYears,
        size: 42,
        meta: { title: 'How many years he wants' },
      },
      {
        id: 'from',
        header: 'Last club',
        accessorFn: (p) => p.incumbentTeamId ?? '',
        cell: (c) => {
          const id = c.getValue() as string
          return id ? <TeamChip team={teamById.get(id)} /> : <span className="faint">—</span>
        },
        meta: { text: true },
        size: 70,
      },
      {
        id: 'offer',
        header: 'Your offer',
        accessorFn: (p) => p.offer?.amount ?? 0,
        cell: (c) => {
          const o = c.row.original.offer
          return o ? (
            <strong className="win">
              {money(o.amount)} × {o.years}
            </strong>
          ) : (
            <span className="faint">—</span>
          )
        },
        size: 100,
      },
    ],
    [teamById],
  )

  const submit = () => {
    const amount = Math.round(Number(amountM) * 1_000_000)
    if (!selected || !Number.isFinite(amount) || amount <= 0) return
    act('makeOffer', selected.playerId, amount, years)
  }

  return (
    <>
      <div className="cols two">
        <Panel title="What you can spend">
          <dl className="kv">
            <dt>Players under contract</dt>
            <dd className="num">{fin?.roster ?? '—'}</dd>
            <dt>Already committed</dt>
            <dd className="num">{money(fin?.payroll)}</dd>
            <dt>Salary cap</dt>
            <dd className="num">{money(fin?.cap)}</dd>
            <dt>Room under the cap</dt>
            <dd className={space < 0 ? 'num loss' : 'num'}>{money(space)}</dd>
            {hasTax ? (
              <>
                <dt>Luxury tax starts at</dt>
                <dd className="num">{money(fin?.taxLine)}</dd>
              </>
            ) : null}
          </dl>
          <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>
            {space < 0
              ? 'You are already over the cap, so you can only add men on the league minimum or re-sign your own.'
              : 'Room is what you can offer a player from another club without help from any exception.'}
          </p>
        </Panel>
        <Panel title={`Committed · ${offers.length} offer${offers.length === 1 ? '' : 's'}`}>
          <dl className="kv">
            <dt>Offered, first year</dt>
            <dd className="num">{money(committed)}</dd>
            <dt>Payroll if they all sign</dt>
            <dd className={hasTax && projected > (fin?.taxLine ?? Infinity) ? 'num warn' : 'num'}>
              {money(projected)}
            </dd>
            <dt>Room left</dt>
            <dd className={over > 0 ? 'num loss' : 'num'}>{money(space - committed)}</dd>
          </dl>
          {over > 0 ? (
            <p className="warn" style={{ margin: '8px 0 0' }}>
              Your offers are {money(over)} more than you have room for. Sign them all and you are
              hard against the cap; some of these deals will not be allowed to land.
            </p>
          ) : hasTax && projected > (fin?.taxLine ?? Infinity) ? (
            <p className="warn" style={{ margin: '8px 0 0' }}>
              This much salary takes you over the luxury-tax line, and the owner pays a penalty on
              every dollar above it.
            </p>
          ) : (
            <p className="dim" style={{ margin: '8px 0 0' }}>
              Offers are resolved when you start the season. Best bid wins; the player decides.
            </p>
          )}
        </Panel>
      </div>

      <div className="fagrid">
        <Panel title={`Market · ${off.freeAgents.length} available`} flush>
          <DataTable
            data={off.freeAgents}
            columns={cols}
            initialSort={[{ id: 'ovr', desc: true }]}
            onRowClick={(p) => setSelectedId(p.playerId)}
            rowClass={(p) =>
              p.playerId === selectedId ? 'me' : p.incumbentTeamId === me ? 'oncl' : undefined
            }
            empty="Nobody left on the market."
          />
        </Panel>

        <Panel title="Offer">
          {!selected ? (
            <p className="dim">Select a free agent to bid.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</div>
                <div className="dim">
                  {selected.pos} · {selected.age} · overall {selected.overall}
                  {selected.incumbentTeamId === me ? ' · yours' : ''}
                </div>
              </div>
              <dl className="kv">
                <dt>He wants</dt>
                <dd className="num">
                  {money(selected.asking)} × {selected.askingYears}
                </dd>
                <dt>Your offer</dt>
                <dd className="num">
                  {selected.offer
                    ? `${money(selected.offer.amount)} × ${selected.offer.years}`
                    : '—'}
                </dd>
              </dl>

              <label className="field">
                <span>Amount ($M / year)</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={amountM}
                  onChange={(e) => setAmountM(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                />
              </label>
              <label className="field">
                <span>Years</span>
                <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rowline">
                <button type="button" className="primary" disabled={working} onClick={submit}>
                  {selected.offer ? 'Update offer' : 'Make offer'}
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => {
                    setAmountM(String(toM(selected.asking)))
                    setYears(selected.askingYears)
                    act('makeOffer', selected.playerId, selected.asking, selected.askingYears)
                  }}
                >
                  Meet the ask
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={working || !selected.offer}
                  onClick={() => act('withdrawOffer', selected.playerId)}
                >
                  Withdraw
                </button>
              </div>
            </div>
          )}

          {offers.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>
                On the table
              </div>
              <table className="grid">
                <tbody>
                  {offers.map((p) => (
                    <tr
                      key={p.playerId}
                      className="clickable"
                      onClick={() => setSelectedId(p.playerId)}
                    >
                      <td className="text">{p.name}</td>
                      <td className="num">{money(p.offer?.amount)}</td>
                      <td className="num dim">×{p.offer?.years}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>
      </div>
    </>
  )
}
