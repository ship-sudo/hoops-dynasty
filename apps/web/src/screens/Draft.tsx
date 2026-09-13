import type { RATING_KEYS } from '@hoops/core'
import { useEffect, useMemo, useState } from 'react'
import type { OffseasonState, ScoutedView } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, RatingBar, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { height } from '../ui/format.ts'
import { RATING_LABELS } from './Roster.tsx'

export interface PhaseProps {
  off: OffseasonState
  act: (method: string, ...args: unknown[]) => void
  working: boolean
  me: string
}

const GROUPS: [string, (typeof RATING_KEYS)[number][]][] = [
  ['Scoring', ['rim', 'close', 'mid', 'three', 'ft', 'drawFoul']],
  ['Playmaking', ['passing', 'handling', 'iq']],
  ['Defence & glass', ['perimD', 'interiorD', 'steal', 'block', 'oreb', 'dreb']],
  ['Physical', ['speed', 'strength', 'stamina', 'durability']],
]

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/**
 * What the scouts will commit to: a band from low to high with a tick at today's rating. The width
 * of the band is the whole point — a narrow one is a scouted player, a wide one is a guess.
 */
function PotentialBand({ p, wide = false }: { p: ScoutedView; wide?: boolean }) {
  const lo = clamp(p.potentialLow)
  const hi = clamp(p.potentialHigh)
  return (
    <span className={wide ? 'potband wide' : 'potband'} title={`${lo}–${hi}, now ${p.overall}`}>
      <span className="track">
        <span className="band" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} />
        <span className="now" style={{ left: `${clamp(p.overall)}%` }} />
      </span>
      <span className="num">
        {lo}–{hi}
      </span>
    </span>
  )
}

const confWord = (v: number) => (v >= 75 ? 'firm' : v >= 50 ? 'fair' : v >= 30 ? 'thin' : 'a guess')

function Confidence({ value }: { value: number }) {
  const v = Math.round(value <= 1 ? value * 100 : value)
  return (
    <span
      title={`Your scouts are ${v}% sure of this report — ${confWord(v)}`}
      className={v < 40 ? 'warn' : undefined}
    >
      {confWord(v)}
    </span>
  )
}

function columns(): Column<ScoutedView>[] {
  return [
    { id: 'name', header: 'Prospect', accessorFn: (p) => p.name, meta: { text: true }, size: 150 },
    { id: 'pos', header: 'Pos', accessorFn: (p) => p.pos, meta: { text: true }, size: 40 },
    { id: 'age', header: 'Age', accessorFn: (p) => p.age, size: 40 },
    {
      id: 'ht',
      header: 'Ht',
      accessorFn: (p) => p.heightIn,
      cell: (c) => height(c.getValue() as number),
      size: 48,
    },
    {
      id: 'ovr',
      header: 'Now',
      accessorFn: (p) => p.overall,
      meta: { title: 'How good he is today, 0–100' },
      size: 44,
    },
    {
      id: 'pot',
      header: 'Could become',
      accessorFn: (p) => (p.potentialLow + p.potentialHigh) / 2,
      cell: (c) => <PotentialBand p={c.row.original} />,
      meta: {
        title: 'The range your scouts will commit to. A wide range means they do not really know.',
      },
      size: 150,
    },
    {
      id: 'conf',
      header: 'Scouting',
      accessorFn: (p) => p.confidence,
      cell: (c) => <Confidence value={c.getValue() as number} />,
      meta: { text: true, title: 'How sure the scouts are' },
      size: 64,
    },
  ]
}

export function Draft({ off, act, working, me }: PhaseProps) {
  const { teamById } = useStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const cols = useMemo(columns, [])

  const selected = useMemo(
    () => off.board.find((p) => p.prospectId === selectedId) ?? null,
    [off.board, selectedId],
  )

  // Drop a selection once that prospect is off the board.
  useEffect(() => {
    if (selectedId && !off.board.some((p) => p.prospectId === selectedId)) setSelectedId(null)
  }, [off.board, selectedId])

  const canDraft = off.yourPick && selected != null && !working

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return
      if (e.key === 'a' && !off.yourPick && !working) act('advanceDraft')
      if (e.key === 'd' && off.yourPick && selectedId && !working) act('draftPlayer', selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, off.yourPick, selectedId, working])

  if (off.phase === 'lottery') {
    return (
      <Panel title="Draft lottery">
        <p className="dim" style={{ maxWidth: 560 }}>
          The teams that missed the playoffs go into a weighted draw for the first picks: the worse
          your record, the better your odds. Draw the balls to set the order and open the board.
        </p>
        <button
          type="button"
          className="primary"
          disabled={working}
          onClick={() => act('advanceDraft')}
        >
          Draw the lottery ▸
        </button>
      </Panel>
    )
  }

  const yourPicks = off.picks.filter((p) => p.teamId === me)
  const made = off.picks.filter((p) => p.prospectId).length

  return (
    <>
      {off.yourPick && off.onTheClock ? (
        <div className="onclock">
          <div>
            <div className="label">You are on the clock</div>
            <div className="pickno">
              Pick {off.onTheClock.overall} · round {off.onTheClock.round}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <div className="dim" style={{ textAlign: 'right' }}>
            {selected ? (
              <>
                Taking <strong>{selected.name}</strong>
              </>
            ) : (
              'Pick a name off the board.'
            )}
          </div>
          <button
            type="button"
            className="primary"
            disabled={!canDraft}
            onClick={() => selectedId && act('draftPlayer', selectedId)}
            title="Key D"
          >
            {selected ? `Draft ${selected.name}` : 'Draft'}
          </button>
        </div>
      ) : (
        <div className="onclock waiting">
          <div>
            <div className="label">On the clock</div>
            <div className="pickno">
              {off.onTheClock ? (
                <>
                  <TeamChip team={teamById.get(off.onTheClock.teamId)} long /> at{' '}
                  {off.onTheClock.overall}
                </>
              ) : (
                'The draft is over.'
              )}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <span className="dim">
            {made} of {off.picks.length} picks made · you hold{' '}
            {yourPicks.filter((p) => !p.prospectId).length} more
          </span>
          <button
            type="button"
            className="primary"
            disabled={working || !off.onTheClock}
            onClick={() => act('advanceDraft')}
            title="Key A"
          >
            Advance ▸
          </button>
        </div>
      )}

      <div className="draftgrid">
        <Panel title="Order" flush>
          <div className="table-scroll" style={{ maxHeight: 460 }}>
            <table className="grid draftorder">
              <thead>
                <tr>
                  <th title="Pick number">#</th>
                  <th className="text">Team</th>
                  <th className="text">Taken</th>
                </tr>
              </thead>
              <tbody>
                {off.picks.map((p) => (
                  <tr
                    key={p.overall}
                    className={[
                      p.teamId === me ? 'me' : '',
                      off.onTheClock?.overall === p.overall ? 'oncl' : '',
                    ]
                      .join(' ')
                      .trim()}
                  >
                    <td className="num faint">{p.overall}</td>
                    <td className="text">
                      <TeamChip team={teamById.get(p.teamId)} />
                    </td>
                    <td className="text name" title={p.name ?? undefined}>
                      {p.name ?? (
                        <span className="faint">
                          {off.onTheClock?.overall === p.overall ? 'on the clock' : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title={`Board · ${off.board.length} available`}
          actions={<span className="faint">Ranges, not numbers. Your scouts are guessing.</span>}
          flush
        >
          <DataTable
            data={off.board}
            columns={cols}
            initialSort={[{ id: 'ovr', desc: true }]}
            onRowClick={(p) => setSelectedId(p.prospectId)}
            rowClass={(p) => (p.prospectId === selectedId ? 'me' : undefined)}
            empty="The board is empty."
          />
        </Panel>

        <Panel title="Prospect">
          {!selected ? (
            <p className="dim">Select a prospect to see the report.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.name}</div>
                <div className="dim">
                  {selected.pos} · {selected.age} · {height(selected.heightIn)}
                </div>
              </div>
              <dl className="kv">
                <dt>How good he is now</dt>
                <dd className="num">{selected.overall}</dd>
                <dt>Could become</dt>
                <dd>
                  <PotentialBand p={selected} wide />
                </dd>
                <dt>Scouting report</dt>
                <dd>
                  <Confidence value={selected.confidence} />
                </dd>
              </dl>
              <p className="faint" style={{ fontSize: 11, margin: 0 }}>
                The bar is the range your scouts will commit to; the white tick is where he is
                today. A wide band means nobody really knows.
              </p>
              {GROUPS.map(([label, keys]) => (
                <div key={label}>
                  <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>
                    {label}
                  </div>
                  <div className="ratings">
                    {keys.map((k) => (
                      <RatingBar
                        key={k}
                        label={RATING_LABELS[k]}
                        value={selected.ratings[k] ?? 0}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="primary"
                disabled={!canDraft}
                onClick={() => act('draftPlayer', selected.prospectId)}
              >
                {off.yourPick ? `Draft ${selected.name}` : 'Not your pick'}
              </button>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
