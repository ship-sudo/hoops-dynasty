/**
 * What a manager does with one of his own: list him, read the offers, bid on the next contract.
 *
 * Pattern: identity lives in the parent card; this is a footer row of one primary action, then
 * deal cards with a single Accept — the same shape as the trade desk's offer list.
 */
import { useCallback, useEffect, useState } from 'react'
import type { PlayerDesk, TradePackage } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { pickLabel } from '../ui/AssetTable.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { money } from '../ui/format.ts'

const toM = (v: number) => Math.round((v / 1_000_000) * 100) / 100

export function PlayerActions({
  playerId,
  onChanged,
}: {
  playerId: string
  onChanged?: () => void
}) {
  const { client, refresh, setScreen, teamById } = useStore()
  const [desk, setDesk] = useState<PlayerDesk | null>(null)
  const [amountM, setAmountM] = useState('')
  const [years, setYears] = useState(2)
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    client
      .manager<PlayerDesk | null>('playerDesk', playerId)
      .then((d) => {
        setDesk(d)
        if (d) {
          setAmountM(String(toM(d.contract.offer?.amount ?? d.contract.asking)))
          setYears(d.contract.offer?.years ?? d.contract.askingYears)
        }
      })
      .catch(() => setDesk(null))
  }, [client, playerId])

  useEffect(() => {
    load()
  }, [load])

  if (!desk?.yours) return null

  const act = async (fn: () => Promise<unknown>) => {
    setWorking(true)
    setNote(null)
    try {
      await fn()
      await refresh()
      load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  const accept = (user: TradePackage, other: TradePackage) =>
    act(async () => {
      const res = await client.executeTrade(user, other)
      if (!res.legal || !res.accepted) throw new Error(res.reason)
      onChanged?.()
    })

  const submitContract = () =>
    act(async () => {
      const amount = Math.round(Number(amountM) * 1_000_000)
      if (desk.contract.kind === 'fa') {
        await client.manager('makeOffer', playerId, amount, years)
        return
      }
      const res = await client.manager<{ ok: boolean; message: string }>(
        'extendContract',
        playerId,
        amount,
        years,
      )
      setNote(res.message)
      if (!res.ok) return
    })

  const nameOf = (id: string) => desk.names[id] ?? id

  return (
    <Panel title="Front office">
      <div className="continue" style={{ margin: '0 0 10px' }}>
        <button
          type="button"
          className={desk.listed ? undefined : 'primary'}
          disabled={working}
          onClick={() => act(() => client.manager('listOnBlock', playerId, !desk.listed))}
        >
          {desk.listed ? 'Take off the block' : 'Put on the block'}
        </button>
        <button type="button" className="ghost" onClick={() => setScreen('trade')}>
          Trade desk ▸
        </button>
        {desk.waive ? (
          <button
            type="button"
            className="ghost"
            disabled={working || !desk.waive.ok}
            title={
              desk.waive.ok ? 'Guaranteed money stays on the cap this year.' : desk.waive.reason
            }
            onClick={() =>
              void act(async () => {
                const res = await client.manager<{ ok: boolean; message: string }>(
                  'waivePlayer',
                  playerId,
                )
                setNote(res.message)
                if (!res.ok) return
                onChanged?.()
              })
            }
          >
            Waive
          </button>
        ) : null}
      </div>
      {desk.listed ? (
        desk.offers.length === 0 ? (
          <p className="dim" style={{ margin: '0 0 10px' }}>
            On the block. Clubs will come in when they have a matching piece.
          </p>
        ) : (
          <div className="offers" style={{ marginBottom: 10 }}>
            {desk.offers.map((o) => {
              const from = teamById.get(o.other.teamId)
              return (
                <article key={`${o.other.teamId}-${o.other.players.join(',')}`}>
                  <div className="rowline">
                    <strong>
                      <TeamChip team={from} long />
                    </strong>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      className="primary"
                      disabled={working || !o.assessment.legal}
                      onClick={() => void accept(o.user, o.other)}
                    >
                      Accept
                    </button>
                  </div>
                  <p style={{ margin: '4px 0 0' }}>
                    They want {o.user.players.map(nameOf).join(', ')}
                    {o.user.picks.length ? `, ${o.user.picks.map(pickLabel).join(', ')}` : ''}. You
                    get {o.other.players.map(nameOf).join(', ') || 'picks'}
                    {o.other.picks.length ? `, ${o.other.picks.map(pickLabel).join(', ')}` : ''}.
                  </p>
                </article>
              )
            })}
          </div>
        )
      ) : (
        <p className="dim" style={{ margin: '0 0 10px' }}>
          List him and other clubs will make offers for him.
        </p>
      )}

      {desk.contract.kind !== 'none' ? (
        <>
          <h3 style={{ margin: '4px 0 6px' }}>
            {desk.contract.kind === 'fa' ? 'Free agency' : 'Extension'}
          </h3>
          {desk.contract.reason ? (
            <p className="warn" style={{ margin: 0 }}>
              {desk.contract.reason}
            </p>
          ) : (
            <div className="rowline" style={{ gap: 10, flexWrap: 'wrap' }}>
              <label className="field">
                <span>First year</span>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={amountM}
                  onChange={(e) => setAmountM(e.target.value)}
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
              <button
                type="button"
                className="primary"
                disabled={working}
                onClick={() => void submitContract()}
              >
                {desk.contract.kind === 'fa'
                  ? desk.contract.offer
                    ? 'Update offer'
                    : 'Make offer'
                  : 'Extend'}
              </button>
              <span className="dim" style={{ fontSize: 12 }}>
                He wants {money(desk.contract.asking)} × {desk.contract.askingYears}
              </span>
            </div>
          )}
        </>
      ) : null}
      {note ? (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {note}
        </p>
      ) : null}
    </Panel>
  )
}
