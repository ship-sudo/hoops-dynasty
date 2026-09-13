import type { RATING_KEYS } from '@hoops/core'
import { useEffect, useMemo, useState } from 'react'
import type {
  FreeAgentView,
  PlayerMood,
  RosterRow,
  SquadMoodView,
  TeamFinance,
} from '../sim/api.ts'
import { display } from '../sim/card.ts'
import { useStore } from '../store.tsx'
import { Modal, Panel, RatingBar } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { height, money, n1, pct0, pct1, per, plainDate, seasonLabel } from '../ui/format.ts'
import { InjuryMark } from '../ui/InjuryMark.tsx'
import { PlayerCareer } from './Career.tsx'
import { PlayerActions } from './PlayerActions.tsx'
import { PlayerDossier } from './PlayerDossier.tsx'
import { playoffTotals } from './playerDossier.ts'
import './morale.css'

/** The mood ramp is one class; the pill, the bar and the panel all read `--mr` off it. */
const moodClass = (label: string) => `mr-${label}`

/** A role and a morale number, as they read in a table cell. */
function MoodCell({ mood }: { mood: PlayerMood }) {
  return (
    <span className={`mr-cell ${moodClass(mood.label)}`} title={mood.why}>
      <b>{Math.round(mood.value)}</b>
      <span className="mr-bar">
        <i style={{ width: `${Math.max(2, Math.min(100, mood.value))}%` }} />
      </span>
    </span>
  )
}

/**
 * The room, in a panel the manager can act on. It never asks him to click anything: it tells him
 * who is unhappy and why, and the answer is always somewhere else — minutes, a contract, a trade.
 */
function DressingRoom({ mood }: { mood: SquadMoodView }) {
  return (
    <div className={`mr-room ${moodClass(mood.label)}`}>
      <div className="mr-head">
        <span className="mr-label">{mood.label}</span>
        <span className="mr-avg">{Math.round(mood.average)} / 100</span>
      </div>
      <p>{mood.summary}</p>
      {mood.worst.length > 0 ? (
        <ul className="mr-list">
          {mood.worst
            .filter((w) => w.value < 48)
            .slice(0, 4)
            .map((w) => (
              <li key={w.playerId} className={moodClass(labelFor(w.value))}>
                <span className="n">
                  {w.name} <span className="mr-role">{w.role}</span>
                </span>
                <span className="v">{Math.round(w.value)}</span>
                <span className="w">{w.why}</span>
              </li>
            ))}
        </ul>
      ) : null}
      <p className="faint" style={{ fontSize: 11 }}>
        A player expects a role from what he is and what he is paid. Give him less than it and he
        plays worse, asks for more to re-sign, and eventually will not re-sign at all. Nobody here
        needs a meeting: the answers are minutes, contracts and trades.
      </p>
    </div>
  )
}

/** The same six stops the sim uses, so a screen never disagrees with the number behind it. */
function labelFor(v: number): string {
  if (v >= 78) return 'delighted'
  if (v >= 64) return 'happy'
  if (v >= 48) return 'content'
  if (v >= 36) return 'restless'
  if (v >= 24) return 'unhappy'
  return 'furious'
}

export const RATING_LABELS: Record<(typeof RATING_KEYS)[number], string> = {
  rim: 'Rim',
  close: 'Close',
  mid: 'Mid',
  three: 'Three',
  ft: 'Free throw',
  passing: 'Passing',
  handling: 'Handling',
  drawFoul: 'Draw foul',
  oreb: 'Off. reb',
  dreb: 'Def. reb',
  perimD: 'Perimeter D',
  interiorD: 'Interior D',
  steal: 'Steal',
  block: 'Block',
  speed: 'Speed',
  strength: 'Strength',
  stamina: 'Stamina',
  iq: 'IQ',
  durability: 'Durability',
}

const GROUPS: [string, (typeof RATING_KEYS)[number][]][] = [
  ['Scoring', ['rim', 'close', 'mid', 'three', 'ft', 'drawFoul']],
  ['Playmaking', ['passing', 'handling', 'iq']],
  ['Defence & glass', ['perimD', 'interiorD', 'steal', 'block', 'oreb', 'dreb']],
  ['Physical', ['speed', 'strength', 'stamina', 'durability']],
]

const overall = (r: RosterRow) => r.card.overall

function columns(): Column<RosterRow>[] {
  const rating = (key: (typeof RATING_KEYS)[number], header: string): Column<RosterRow> => ({
    id: key,
    header,
    accessorFn: (r) => r.player.ratings[key],
    cell: (c) => display(c.getValue<number>()),
    meta: { title: RATING_LABELS[key] },
  })
  return [
    {
      id: 'name',
      header: 'Player',
      accessorFn: (r) => r.player.name,
      meta: { text: true },
      size: 170,
    },
    {
      id: 'health',
      header: '',
      accessorFn: (r) => r.injury?.name ?? '',
      cell: (c) => <InjuryMark injury={c.row.original.injury} />,
      meta: { text: true, title: 'Current injury' },
      size: 52,
    },
    {
      id: 'risk',
      header: 'Risk',
      accessorFn: (r) => r.injuryRisk?.gamesOut ?? 99,
      cell: (c) => {
        const risk = c.row.original.injuryRisk
        if (!risk) return '—'
        const tone =
          risk.label === 'fragile' || risk.label === 'candidate'
            ? 'warn'
            : risk.label === 'iron'
              ? 'win'
              : 'dim'
        return (
          <span className={tone} title={risk.text}>
            {risk.short}
          </span>
        )
      },
      meta: { title: 'Expected games missed to injury at this minutes load' },
      size: 88,
    },
    { id: 'pos', header: 'Pos', accessorFn: (r) => r.player.pos, meta: { text: true } },
    { id: 'age', header: 'Age', accessorFn: (r) => r.player.age },
    {
      id: 'ht',
      header: 'Ht',
      accessorFn: (r) => r.player.heightIn,
      cell: (c) => height(c.getValue<number>()),
    },
    { id: 'exp', header: 'Exp', accessorFn: (r) => r.player.yearsPro },
    {
      id: 'ovr',
      header: 'Ovr',
      accessorFn: overall,
      cell: (c) => Math.round(c.getValue<number>()),
    },
    {
      id: 'role',
      header: 'Role',
      accessorFn: (r) => r.mood?.role ?? '',
      cell: (c) => {
        const m = c.row.original.mood
        return m ? <span className={`mr-role ${m.role}`}>{m.role}</span> : '—'
      },
      meta: { text: true, title: 'The role he expects, from what he is and what he is paid' },
      size: 80,
    },
    {
      id: 'mood',
      header: 'Mood',
      accessorFn: (r) => r.mood?.value ?? 0,
      cell: (c) => {
        const m = c.row.original.mood
        return m ? (
          <>
            <MoodCell mood={m} />
            {m.wantsOut ? <span className="mr-out">wants out</span> : null}
          </>
        ) : (
          '—'
        )
      },
      meta: { title: 'Morale, 0-100. Click the row for the reason.' },
      size: 92,
    },
    rating('rim', 'Rim'),
    rating('mid', 'Mid'),
    rating('three', '3PT'),
    rating('passing', 'Pass'),
    rating('perimD', 'Per D'),
    rating('interiorD', 'Int D'),
    rating('dreb', 'Reb'),
    rating('iq', 'IQ'),
    { id: 'gp', header: 'GP', accessorFn: (r) => r.totals.gp, meta: { title: 'Games played' } },
    {
      id: 'mpg',
      header: 'MPG',
      accessorFn: (r) => (r.totals.gp ? r.totals.min / r.totals.gp : 0),
      cell: (c) => per(c.row.original.totals.min, c.row.original.totals.gp),
      meta: { title: 'Minutes per game' },
    },
    {
      id: 'ppg',
      header: 'PPG',
      accessorFn: (r) => (r.totals.gp ? r.totals.pts / r.totals.gp : 0),
      cell: (c) => per(c.row.original.totals.pts, c.row.original.totals.gp),
      meta: { title: 'Points per game' },
    },
    {
      id: 'rpg',
      header: 'RPG',
      accessorFn: (r) => (r.totals.gp ? (r.totals.oreb + r.totals.dreb) / r.totals.gp : 0),
      cell: (c) =>
        per(c.row.original.totals.oreb + c.row.original.totals.dreb, c.row.original.totals.gp),
      meta: { title: 'Rebounds per game' },
    },
    {
      id: 'apg',
      header: 'APG',
      accessorFn: (r) => (r.totals.gp ? r.totals.ast / r.totals.gp : 0),
      cell: (c) => per(c.row.original.totals.ast, c.row.original.totals.gp),
      meta: { title: 'Assists per game' },
    },
    {
      id: 'salary',
      header: 'Salary',
      accessorFn: (r) => r.salary ?? 0,
      cell: (c) => money(c.getValue<number>() || null),
    },
    { id: 'yrs', header: 'Yrs', accessorFn: (r) => r.contractYears },
  ]
}

/**
 * The cap sheet in one line, in words. The luxury tax only exists from 1999-2000 on, and the sim
 * falls back to the cap when a season has no tax line — so a tax figure equal to the cap means
 * "this era had no tax", and printing it would invent a rule that did not exist.
 */
export function CapLine({ finance }: { finance: TeamFinance }) {
  const hasTax = finance.taxLine > finance.cap
  const overCap = finance.payroll - finance.cap
  const spots = `${finance.roster} of ${finance.rosterMax}`
  return (
    <span className="dim" style={{ textAlign: 'right' }}>
      <span className="num">{spots}</span> on the roster ·{' '}
      <span className="num">{finance.rosterActive}</span> dress · payroll{' '}
      <span className="num">{money(finance.payroll)}</span> against a{' '}
      <span className="num">{money(finance.cap || null)}</span> cap
      {hasTax ? (
        <>
          {' '}
          · luxury tax starts at <span className="num">{money(finance.taxLine)}</span>
        </>
      ) : null}
      <br />
      <span className="faint" style={{ fontSize: 11 }}>
        {`Minimum ${finance.rosterMin}. ${finance.rosterActive} dress; the roster cap is ${finance.rosterMax}. `}
        {finance.deadCap > 0 ? `${money(finance.deadCap)} dead cap from waivers. ` : ''}
        {overCap > 0
          ? `${money(overCap)} over the cap — allowed, because you can always re-sign your own men. `
          : `${money(-overCap)} of room under the cap. `}
        {hasTax && finance.payroll > finance.taxLine
          ? finance.taxBill > 0
            ? `Over the tax line: ${money(finance.taxBill)} owed${finance.repeater ? ' at repeater rates' : ''}.`
            : 'Over the tax line, so the owner pays a penalty on every dollar above it.'
          : hasTax
            ? 'Under the tax line, so no penalty.'
            : 'There was no luxury tax in this era.'}
      </span>
    </span>
  )
}

function PlayerCard({
  row,
  onClose,
  onCareer,
}: {
  row: RosterRow
  onClose: () => void
  onCareer: (playerId: string) => void
}) {
  const { game } = useStore()
  const p = row.player
  const t = row.totals
  const po = game ? playoffTotals(game.calendar.results, p.playerId) : null
  return (
    <Modal
      title={
        <span>
          {p.name}
          <InjuryMark injury={row.injury} />{' '}
          <span className="dim">
            · {p.pos} · {p.age} · {height(p.heightIn)}, {p.weightLb} lb
          </span>
        </span>
      }
      onClose={onClose}
    >
      <div className="pc" style={{ padding: 12 }}>
        <PlayerDossier playerId={p.playerId} row={row} />
        <div className="pc-body">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {GROUPS.map(([title, keys]) => (
                <section key={title}>
                  <h3 style={{ marginBottom: 5 }}>{title}</h3>
                  <div className="ratings">
                    {keys.map((k) => (
                      <RatingBar key={k} label={RATING_LABELS[k]} value={display(p.ratings[k])} />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <section>
              <div className="rowline" style={{ marginBottom: 5 }}>
                <h3 style={{ margin: 0 }}>This season</h3>
                <span style={{ flex: 1 }} />
                <button type="button" className="ghost" onClick={() => onCareer(p.playerId)}>
                  Full career ▸
                </button>
              </div>
              <table className="grid">
                <thead>
                  <tr>
                    {po ? <th className="text" /> : null}
                    <th>GP</th>
                    <th>GS</th>
                    <th>MPG</th>
                    <th>PPG</th>
                    <th>RPG</th>
                    <th>APG</th>
                    <th>SPG</th>
                    <th>BPG</th>
                    <th>TO</th>
                    <th>FG%</th>
                    <th>3P%</th>
                    <th>FT%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {po ? <td className="text dim">RS</td> : null}
                    <td className="num">{t.gp}</td>
                    <td className="num">{t.gs}</td>
                    <td className="num">{per(t.min, t.gp)}</td>
                    <td className="num">{per(t.pts, t.gp)}</td>
                    <td className="num">{per(t.oreb + t.dreb, t.gp)}</td>
                    <td className="num">{per(t.ast, t.gp)}</td>
                    <td className="num">{per(t.stl, t.gp)}</td>
                    <td className="num">{per(t.blk, t.gp)}</td>
                    <td className="num">{per(t.tov, t.gp)}</td>
                    <td className="num">{t.fga ? pct1(t.fgm / t.fga) : '—'}</td>
                    <td className="num">{t.fg3a ? pct1(t.fg3m / t.fg3a) : '—'}</td>
                    <td className="num">{t.fta ? pct1(t.ftm / t.fta) : '—'}</td>
                  </tr>
                  {po ? (
                    <tr>
                      <td className="text">Playoffs</td>
                      <td className="num">{po.gp}</td>
                      <td className="num">—</td>
                      <td className="num">{n1(po.min)}</td>
                      <td className="num">{n1(po.pts)}</td>
                      <td className="num">{n1(po.reb)}</td>
                      <td className="num">{n1(po.ast)}</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          </div>

          <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            {row.mood ? (
              <Panel
                title={
                  <span>
                    Dressing room{' '}
                    <span
                      className={`mr-label ${moodClass(row.mood.label)}`}
                      style={{ fontSize: 13 }}
                    >
                      · {row.mood.label}
                    </span>
                  </span>
                }
              >
                <div className={moodClass(row.mood.label)}>
                  <p className="mr-why">{row.mood.why}</p>
                  <ul className="mr-terms">
                    {row.mood.terms.map((t) => (
                      <li key={t.key}>
                        <span className={`d ${t.value < 0 ? 'neg' : 'pos'}`}>
                          {t.value > 0 ? '+' : ''}
                          {t.value.toFixed(0)}
                        </span>
                        <span>{t.text}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mr-gap">
                    <span>
                      role <b>{row.mood.role}</b>
                    </span>
                    <span>
                      expects <b>{row.mood.expectedMpg}</b> mpg
                    </span>
                    <span>
                      getting <b>{row.mood.mpg.toFixed(1)}</b>
                    </span>
                    <span>
                      morale <b>{Math.round(row.mood.value)}</b>
                    </span>
                  </div>
                  <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>
                    {row.mood.wantsOut
                      ? 'He has made his mind up: he will not re-sign here, whatever you offer.'
                      : row.mood.askingMultiple > 1.01
                        ? `Re-signing him here would cost about ${Math.round((row.mood.askingMultiple - 1) * 100)}% over his market price. That premium is yours alone — he would sign elsewhere for the going rate.`
                        : 'He would re-sign here at, or a little under, his market price.'}
                  </p>
                </div>
              </Panel>
            ) : null}
            <Panel title="Contract">
              {p.contract ? (
                <table className="grid">
                  <thead>
                    <tr>
                      <th className="text">Year</th>
                      <th>Salary</th>
                      <th className="text">Option</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.contract.years.map((y) => (
                      <tr key={y.yearEnd}>
                        <td className="text">{seasonLabel(y.yearEnd)}</td>
                        <td className="num">{money(y.amount)}</td>
                        <td className="text dim">
                          {y.option
                            ? `${y.option.replace(/_/g, ' ')} option`
                            : y.guaranteed
                              ? 'guaranteed'
                              : 'not guaranteed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="dim">
                  No contract on file for this player — he is on the roster but the season's salary
                  data does not cover him.
                </p>
              )}
              {p.contract ? (
                <p className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                  A {p.contract.kind.replace(/_/g, ' ')} deal.{' '}
                  {p.contract.source === 'inferred'
                    ? 'The exact terms are estimated: the real salary records for this season are incomplete.'
                    : 'Terms taken from the real salary records.'}
                </p>
              ) : null}
            </Panel>

            <PlayerActions playerId={p.playerId} onChanged={onClose} />

            <Panel title="Bio">
              <dl className="kv">
                <dt>Born</dt>
                <dd>{plainDate(p.birthDate)}</dd>
                <dt>Drafted</dt>
                <dd>
                  {p.draft
                    ? `${p.draft.year} · round ${p.draft.round} · pick ${p.draft.pick}`
                    : 'Undrafted'}
                </dd>
                <dt>Seasons played</dt>
                <dd>{p.yearsPro}</dd>
                <dt>Seasons here</dt>
                <dd>{p.yearsWithTeam}</dd>
                <dt title="Share of his team's possessions he finishes while on the floor">
                  Usage
                </dt>
                <dd>{pct0(p.tendencies.usage)}</dd>
              </dl>
              <div className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 3 }}>
                Where his shots come from
              </div>
              <dl className="kv">
                <dt>At the rim</dt>
                <dd>{pct0(p.tendencies.shotRim)}</dd>
                <dt>Close range</dt>
                <dd>{pct0(p.tendencies.shotClose)}</dd>
                <dt>Mid-range</dt>
                <dd>{pct0(p.tendencies.shotMid)}</dd>
                <dt>Three-point</dt>
                <dd>{pct0(p.tendencies.shotThree)}</dd>
              </dl>
            </Panel>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function InSeasonSign({ finance }: { finance: TeamFinance }) {
  const { client, refresh, snapshot } = useStore()
  const [pool, setPool] = useState<FreeAgentView[]>([])
  const [working, setWorking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const room = finance.roster < finance.rosterMax

  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is the refetch trigger
  useEffect(() => {
    let live = true
    client
      .manager<FreeAgentView[]>('inSeasonFreeAgents')
      .then((rows) => {
        if (live) setPool(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, snapshot])

  const sign = async (id: string) => {
    setWorking(true)
    setNote(null)
    try {
      const res = await client.manager<{ ok: boolean; message: string }>('signFreeAgent', id)
      setNote(res.message)
      if (res.ok) await refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setWorking(false)
    }
  }

  if (pool.length === 0) return null

  return (
    <Panel title="Free agents">
      <p className="dim" style={{ margin: '0 0 8px', fontSize: 12 }}>
        {room
          ? `Rest-of-season minimum. ${finance.rosterMax - finance.roster} spot${
              finance.rosterMax - finance.roster === 1 ? '' : 's'
            } left.`
          : `Roster is full at ${finance.rosterMax}. Waive someone first.`}
      </p>
      {note ? (
        <p className="faint" style={{ fontSize: 12, margin: '0 0 8px' }}>
          {note}
        </p>
      ) : null}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {pool.slice(0, 10).map((p) => (
          <li key={p.playerId} className="rowline" style={{ gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {p.name}{' '}
              <span className="dim">
                {p.pos} · {p.age} · {p.overall}
              </span>
            </span>
            <span className="num faint">{money(p.asking)}</span>
            <button
              type="button"
              className="ghost"
              disabled={working || !room}
              onClick={() => void sign(p.playerId)}
            >
              Sign
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function Roster() {
  const { client, snapshot, teams, teamById, setScreen } = useStore()
  const me = snapshot?.state.userTeamId ?? ''
  const [teamId, setTeamId] = useState(me)
  const [rows, setRows] = useState<RosterRow[]>([])
  const [finance, setFinance] = useState<TeamFinance | null>(null)
  const [mood, setMood] = useState<SquadMoodView | null>(null)
  const [selected, setSelected] = useState<RosterRow | null>(null)
  const [career, setCareer] = useState<string | null>(null)

  useEffect(() => setTeamId(me), [me])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!teamId) return
    let live = true
    Promise.all([
      client.roster(teamId),
      client.finance(teamId),
      client.manager<SquadMoodView>('squadMood', teamId).catch(() => null),
    ])
      .then(([r, f, m]) => {
        if (!live) return
        setRows(r)
        setFinance(f)
        setMood(m)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, teamId, snapshot])

  useEffect(() => {
    setSelected((cur) => {
      if (!cur) return cur
      return rows.find((r) => r.player.playerId === cur.player.playerId) ?? null
    })
  }, [rows])

  const cols = useMemo(columns, [])
  const team = teamById.get(teamId)
  const sorted = useMemo(() => [...teams].sort((a, b) => a.abbr.localeCompare(b.abbr)), [teams])

  if (!snapshot) return null

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pagehead">
        <h1>{team ? `${team.city} ${team.name}` : 'Roster'}</h1>
        <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          {sorted.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.abbr} — {t.city} {t.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        {finance ? <CapLine finance={finance} /> : null}
      </div>

      {snapshot.state.seasonComplete ? (
        <div className="banner">
          You are in the offseason. This roster is still yours — re-sign and free agency live on the{' '}
          <button type="button" className="lg-link" onClick={() => setScreen('offseason')}>
            Offseason
          </button>{' '}
          tab, as their own steps.
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: mood ? 'minmax(0,1fr) 290px' : 'minmax(0,1fr)',
          gap: 12,
          alignItems: 'start',
        }}
      >
        <Panel flush>
          <DataTable
            data={rows}
            columns={cols}
            initialSort={[{ id: 'mpg', desc: true }]}
            onRowClick={setSelected}
            empty="No players."
          />
        </Panel>
        {mood ? (
          <Panel title="Dressing room">
            <DressingRoom mood={mood} />
          </Panel>
        ) : null}
      </div>

      {teamId === me && !snapshot.state.seasonComplete && finance ? (
        <InSeasonSign finance={finance} />
      ) : null}

      <p className="faint" style={{ fontSize: 11 }}>
        Click a row for the player card. Ratings are 0–100 on a fixed 1998–2026 anchor: 50 is the
        pooled league mean, 15 per standard deviation.
      </p>

      {selected ? (
        <PlayerCard
          row={selected}
          onClose={() => setSelected(null)}
          onCareer={(playerId) => {
            setSelected(null)
            setCareer(playerId)
          }}
        />
      ) : null}
      {career ? <PlayerCareer playerId={career} onClose={() => setCareer(null)} /> : null}
    </div>
  )
}
