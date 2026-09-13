import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OffseasonPhase, OffseasonState } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { shortDate } from '../ui/format.ts'
import { Draft } from './Draft.tsx'
import { FreeAgency } from './FreeAgency.tsx'

/** What one offseason cost you and gave you, assembled on the way through. */
export interface OffseasonSummary {
  yearEnd: number
  drafted: { overall: number; name: string }[]
  signed: string[]
  left: string[]
}

const PHASES: [OffseasonPhase, string][] = [
  ['lottery', 'Lottery'],
  ['draft', 'Draft'],
  ['freeagency', 'Free agency'],
  ['done', 'Season'],
]

function PhaseBar({ phase }: { phase: OffseasonPhase }) {
  const at = PHASES.findIndex(([p]) => p === phase)
  return (
    <div className="phasebar">
      {PHASES.map(([p, label], i) => (
        <span key={p} className={i < at ? 'step past' : i === at ? 'step now' : 'step'}>
          {label}
        </span>
      ))}
    </div>
  )
}

export function Offseason() {
  const { client, snapshot, teamById, refresh, setScreen } = useStore()
  const me = snapshot?.state.userTeamId
  const [off, setOff] = useState<OffseasonState | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [summary, setSummary] = useState<OffseasonSummary | null>(null)
  /** Your picks, remembered as they are made — the draft board is cleared by the rollover. */
  const drafted = useRef(new Map<number, string>())
  /** Once the summary is written the new season has begun, so `offseason()` goes null again. */
  const finished = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .manager<OffseasonState | null>('offseason')
      .then((s) => {
        if (!live) return
        // Hold the last view once the season has rolled, so the summary is not swept away.
        if (s || !finished.current) setOff(s)
        setLoaded(true)
      })
      .catch((e: Error) => live && setErr(e.message))
    return () => {
      live = false
    }
  }, [client, snapshot])

  // Remember every pick of yours that lands, so the summary survives the rollover.
  useEffect(() => {
    if (!off || !me) return
    for (const p of off.picks)
      if (p.teamId === me && p.prospectId && p.name) drafted.current.set(p.overall, p.name)
  }, [off, me])

  const act = useCallback(
    async (method: string, ...args: unknown[]) => {
      setWorking(true)
      setErr(null)
      try {
        setOff(await client.manager<OffseasonState>(method, ...args))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setWorking(false)
      }
    },
    [client],
  )

  const finish = useCallback(async () => {
    if (!me) return
    setWorking(true)
    setErr(null)
    try {
      const before = await client.roster(me)
      const next = await client.manager<OffseasonState>('finishOffseason')
      for (const p of next.picks)
        if (p.teamId === me && p.prospectId && p.name) drafted.current.set(p.overall, p.name)
      finished.current = true
      const after = await client.roster(me)
      const beforeNames = new Set(before.map((r) => r.player.name))
      const afterNames = new Set(after.map((r) => r.player.name))
      const rookies = new Set(drafted.current.values())
      setSummary({
        yearEnd: next.yearEnd,
        drafted: [...drafted.current]
          .sort((a, b) => a[0] - b[0])
          .map(([overall, name]) => ({ overall, name })),
        signed: [...afterNames].filter((n) => !beforeNames.has(n) && !rookies.has(n)),
        left: [...beforeNames].filter((n) => !afterNames.has(n)),
      })
      setOff(next)
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }, [client, me, refresh])

  const news = useMemo(() => (off ? [...off.news].reverse() : []), [off])

  if (!snapshot || !me) return null
  if (!loaded)
    return (
      <div className="dim" style={{ padding: 20 }}>
        Reading the offseason…
      </div>
    )

  if (!off) {
    return (
      <Panel title="Offseason">
        <p className="dim">
          The season is still on. The lottery, the draft and the market open once the last game is
          played.
        </p>
        <button type="button" onClick={() => setScreen('home')}>
          Back to home
        </button>
      </Panel>
    )
  }

  const label = off.phase === 'done' ? 'Preseason' : `${off.yearEnd} offseason`

  return (
    <div className="offseason">
      <div className="offhead">
        <div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{label}</div>
          <div className="dim">
            <TeamChip team={teamById.get(me)} long /> ·{' '}
            {off.phase === 'lottery'
              ? 'Lottery balls are in the drum.'
              : off.phase === 'draft'
                ? 'Draft night.'
                : off.phase === 'freeagency'
                  ? 'The market is open.'
                  : 'The new season is ready.'}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <PhaseBar phase={off.phase} />
        <button
          type="button"
          className="primary"
          disabled={working || off.phase === 'done'}
          onClick={finish}
          title="Resolve the market and roll into the new season"
        >
          Start the season ▸
        </button>
      </div>

      {err ? <div className="banner">{err}</div> : null}

      <div className="cols sidebar">
        <div style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 }}>
          {off.phase === 'lottery' || off.phase === 'draft' ? (
            <Draft off={off} act={act} working={working} me={me} />
          ) : off.phase === 'freeagency' ? (
            <FreeAgency off={off} act={act} working={working} me={me} />
          ) : (
            <Panel title="The new season">
              {summary ? (
                <div className="summary">
                  <div>
                    <h4>Drafted</h4>
                    {summary.drafted.length === 0 ? (
                      <p className="dim">You had no picks land.</p>
                    ) : (
                      <ul>
                        {summary.drafted.map((d) => (
                          <li key={d.overall}>
                            <span className="num faint">#{d.overall}</span> {d.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4>Signed</h4>
                    {summary.signed.length === 0 ? (
                      <p className="dim">Nobody new.</p>
                    ) : (
                      <ul>
                        {summary.signed.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4>Left</h4>
                    {summary.left.length === 0 ? (
                      <p className="dim">The squad held together.</p>
                    ) : (
                      <>
                        <ul>
                          {summary.left.map((n) => (
                            <li key={n} className="dim">
                              {n}
                            </li>
                          ))}
                        </ul>
                        <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                          Their contracts ran out and you were outbid, or nobody offered them one.
                          Re-sign your own men next summer before the market opens.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="dim">
                  The offseason is done and the new season is loaded. Head home and play.
                </p>
              )}
              <div style={{ marginTop: 12 }}>
                <button type="button" className="primary" onClick={() => setScreen('home')}>
                  Go to home ▸
                </button>
              </div>
            </Panel>
          )}
        </div>

        <Panel title="Offseason wire" flush>
          <div className="newsfeed">
            {news.length === 0 ? (
              <article>
                <p>Quiet so far.</p>
              </article>
            ) : (
              news.map((n) => (
                <article key={n.id}>
                  <div className="meta">
                    <span>{shortDate(n.date)}</span>
                    <span>{n.kind}</span>
                  </div>
                  <h4>{n.headline}</h4>
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
