/**
 * The league's memory, in four views: your franchise season by season, the record book, the hall of
 * fame, and an index of everyone who has ever played a minute in this save.
 *
 * Every name on this screen opens a career page. That is the point of it.
 */
import {
  allCareers,
  type Career,
  FRANCHISE_KEYS,
  franchiseLeaders,
  franchiseSeasons,
  GAME_RECORDS,
  type GameRecordKey,
  leagueRecords,
  totalsOf,
} from '@hoops/game'
import { useMemo, useState } from 'react'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { n1, per, plainDate, seasonLabel } from '../ui/format.ts'
import { PlayerCareer } from './Career.tsx'

type Tab = 'franchise' | 'records' | 'hall' | 'players'

const TABS: [Tab, string][] = [
  ['franchise', 'Franchise history'],
  ['records', 'Records'],
  ['hall', 'Hall of Fame'],
  ['players', 'Every player'],
]

const thousands = (n: number): string => Math.round(n).toLocaleString('en-US')

/** A run of seasons, by the year each one ended: '2004–17'. Short enough to sit in a column. */
const span = (from: number, to: number): string =>
  from ? `${from}–${String(to % 100).padStart(2, '0')}` : '—'

const STAT_LABEL: Record<string, string> = {
  pts: 'Points',
  reb: 'Rebounds',
  ast: 'Assists',
  stl: 'Steals',
  blk: 'Blocks',
  fg3m: 'Threes',
  gp: 'Games',
  min: 'Minutes',
}

/** One row in the player index. Flattened out of the packed careers so the grid can sort it. */
interface IndexRow {
  playerId: string
  name: string
  pos: string
  from: number
  to: number
  seasons: number
  gp: number
  pts: number
  reb: number
  ast: number
  ppg: number
  titles: number
  allNba: number
  status: string
}

function indexRow(c: Career, active: Set<string>, hall: Set<string>): IndexRow {
  const t = totalsOf(c.seasons)
  return {
    playerId: c.playerId,
    name: c.name,
    pos: c.pos,
    from: c.seasons[0]?.yearEnd ?? 0,
    to: c.seasons[c.seasons.length - 1]?.yearEnd ?? 0,
    seasons: t.seasons,
    gp: t.gp,
    pts: t.pts,
    reb: t.reb,
    ast: t.ast,
    ppg: t.gp > 0 ? t.pts / t.gp : 0,
    titles: t.titles,
    allNba: t.allNba,
    status: hall.has(c.playerId)
      ? 'Hall of Fame'
      : active.has(c.playerId)
        ? 'Playing'
        : c.retiredYear
          ? `Retired ${c.retiredYear}`
          : 'Out of the league',
  }
}

function indexColumns(): Column<IndexRow>[] {
  return [
    { id: 'name', header: 'Player', accessorFn: (r) => r.name, meta: { text: true }, size: 180 },
    { id: 'pos', header: 'Pos', accessorFn: (r) => r.pos, meta: { text: true } },
    {
      id: 'span',
      header: 'Seasons',
      accessorFn: (r) => r.from,
      cell: (c) => span(c.row.original.from, c.row.original.to),
      meta: { text: true, title: 'First and last season' },
    },
    { id: 'yrs', header: 'Yrs', accessorFn: (r) => r.seasons },
    {
      id: 'gp',
      header: 'GP',
      accessorFn: (r) => r.gp,
      cell: (c) => thousands(c.getValue<number>()),
    },
    {
      id: 'pts',
      header: 'Pts',
      accessorFn: (r) => r.pts,
      cell: (c) => thousands(c.getValue<number>()),
      meta: { title: 'Career points' },
    },
    {
      id: 'reb',
      header: 'Reb',
      accessorFn: (r) => r.reb,
      cell: (c) => thousands(c.getValue<number>()),
    },
    {
      id: 'ast',
      header: 'Ast',
      accessorFn: (r) => r.ast,
      cell: (c) => thousands(c.getValue<number>()),
    },
    { id: 'ppg', header: 'PPG', accessorFn: (r) => r.ppg, cell: (c) => n1(c.getValue<number>()) },
    { id: 'titles', header: 'Titles', accessorFn: (r) => r.titles },
    {
      id: 'allNba',
      header: 'All-NBA',
      accessorFn: (r) => r.allNba,
      meta: { title: 'All-NBA selections' },
    },
    { id: 'status', header: 'Status', accessorFn: (r) => r.status, meta: { text: true } },
  ]
}

export function Dynasty() {
  const { game, snapshot, teamById } = useStore()
  const [tab, setTab] = useState<Tab>('franchise')
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [recordKey, setRecordKey] = useState<GameRecordKey>('pts')

  const me = snapshot?.state.userTeamId ?? ''
  const careers = useMemo(() => (game ? allCareers(game) : []), [game])
  const seasons = useMemo(() => (game ? franchiseSeasons(game, me) : []), [game, me])
  const records = useMemo(() => (game ? leagueRecords(game) : null), [game])
  const leaders = useMemo(
    () =>
      game ? FRANCHISE_KEYS.map((key) => ({ key, rows: franchiseLeaders(game, me, key, 10) })) : [],
    [game, me],
  )
  const rows = useMemo(() => {
    if (!game) return []
    const active = new Set(game.league.players.map((p) => p.playerId))
    const hall = new Set((game.hallOfFame ?? []).map((h) => h.playerId))
    const all = careers.map((c) => indexRow(c, active, hall))
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all
  }, [game, careers, query])
  const cols = useMemo(indexColumns, [])

  if (!snapshot || !game) return null
  const team = teamById.get(me)
  const titles = seasons.filter((s) => s.finish === 'Champions').length
  const wins = seasons.reduce((t, s) => t + s.wins, 0)
  const losses = seasons.reduce((t, s) => t + s.losses, 0)
  const hall = game.hallOfFame ?? []

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pagehead">
        <h1>Dynasty</h1>
        <span className="dim">
          {team ? `${team.city} ${team.name}` : ''} · {careers.length} player
          {careers.length === 1 ? '' : 's'} on file
        </span>
        <span style={{ flex: 1 }} />
        <div className="picklist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'franchise' ? (
        <>
          <Panel
            title={`${team ? `${team.city} ${team.name}` : 'Your club'} · season by season`}
            actions={
              <span className="dim">
                {seasons.length} season{seasons.length === 1 ? '' : 's'} · {wins}–{losses} ·{' '}
                {titles} title{titles === 1 ? '' : 's'}
              </span>
            }
            flush
          >
            <div className="table-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="text">Season</th>
                    <th>W</th>
                    <th>L</th>
                    <th title="Winning percentage">Pct</th>
                    <th title="Playoff seed">Seed</th>
                    <th className="text">Finish</th>
                    <th className="text">Leading scorer</th>
                    <th title="Points per game">PPG</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.length === 0 ? (
                    <tr>
                      <td className="text dim" colSpan={8}>
                        No season has finished yet. Play one through and it lands here for good.
                      </td>
                    </tr>
                  ) : (
                    seasons.map((s) => (
                      <tr
                        key={s.yearEnd}
                        className={s.finish === 'Champions' ? 'me clickable' : 'clickable'}
                        onClick={() => s.leadingScorer && setOpen(s.leadingScorer.playerId)}
                      >
                        <td className="text">{seasonLabel(s.yearEnd)}</td>
                        <td className="num">{s.wins}</td>
                        <td className="num">{s.losses}</td>
                        <td className="num dim">
                          {s.wins + s.losses > 0
                            ? (s.wins / (s.wins + s.losses)).toFixed(3).replace(/^0/, '')
                            : '—'}
                        </td>
                        <td className="num dim">{s.seed ?? '—'}</td>
                        <td className={s.finish === 'Champions' ? 'text win' : 'text'}>
                          {s.finish}
                        </td>
                        <td className="text">{s.leadingScorer?.name ?? '—'}</td>
                        <td className="num">
                          {s.leadingScorer ? per(s.leadingScorer.pts, s.leadingScorer.gp) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="cols two">
            {leaders.map(({ key, rows: list }) => (
              <Panel key={key} title={`All-time ${STAT_LABEL[key]?.toLowerCase() ?? key}`} flush>
                <table className="grid">
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td className="text dim">Nobody yet.</td>
                      </tr>
                    ) : (
                      list.map((l, i) => (
                        <tr
                          key={l.playerId}
                          className="clickable"
                          onClick={() => setOpen(l.playerId)}
                        >
                          <td className="num faint">{i + 1}</td>
                          <td className="text">{l.name}</td>
                          <td className="num dim">{span(l.from, l.to)}</td>
                          <td className="num">{thousands(l.value)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </Panel>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'records' && records ? (
        <>
          <Panel title="Single game" flush>
            <table className="grid">
              <thead>
                <tr>
                  <th className="text">Record</th>
                  <th>Best</th>
                  <th className="text">Player</th>
                  <th className="text">Team</th>
                  <th className="text">Opponent</th>
                  <th className="text">Date</th>
                </tr>
              </thead>
              <tbody>
                {GAME_RECORDS.map((key) => {
                  const r = records.game[key]
                  return (
                    <tr
                      key={key}
                      className={r ? 'clickable' : undefined}
                      onClick={r ? () => setOpen(r.playerId) : undefined}
                    >
                      <td className="text">{STAT_LABEL[key] ?? key}</td>
                      <td className="num">{r ? r.value : '—'}</td>
                      <td className="text">{r?.name ?? '—'}</td>
                      <td className="text">
                        <TeamChip team={r ? teamById.get(r.teamId) : undefined} />
                      </td>
                      <td className="text">
                        <TeamChip team={r ? teamById.get(r.opponentTeamId) : undefined} />
                      </td>
                      <td className="text dim">
                        {r ? plainDate(r.date) : '—'}
                        {r?.playoffs ? <span className="warn"> playoffs</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
              Every line of every game is checked against this book as it is played, so these are
              real single-game highs, not the best season averaged out.
            </p>
          </Panel>

          <div className="rowline">
            <span className="dim">Season and career lists for</span>
            <div className="picklist">
              {GAME_RECORDS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={recordKey === key}
                  onClick={() => setRecordKey(key)}
                >
                  {STAT_LABEL[key] ?? key}
                </button>
              ))}
            </div>
          </div>

          <div className="cols two">
            <Panel title={`Best season · ${STAT_LABEL[recordKey]?.toLowerCase()}`} flush>
              <table className="grid">
                <tbody>
                  {(records.season[recordKey] ?? []).map((r, i) => (
                    <tr
                      key={`${r.playerId}-${r.yearEnd}`}
                      className="clickable"
                      onClick={() => setOpen(r.playerId)}
                    >
                      <td className="num faint">{i + 1}</td>
                      <td className="text">{r.name}</td>
                      <td className="text dim">{seasonLabel(r.yearEnd)}</td>
                      <td className="text">
                        <TeamChip team={teamById.get(r.teamId)} />
                      </td>
                      <td className="num">{thousands(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title={`Career · ${STAT_LABEL[recordKey]?.toLowerCase()}`} flush>
              <table className="grid">
                <tbody>
                  {(records.career[recordKey] ?? []).map((r, i) => (
                    <tr key={r.playerId} className="clickable" onClick={() => setOpen(r.playerId)}>
                      <td className="num faint">{i + 1}</td>
                      <td className="text">{r.name}</td>
                      <td className="num">{thousands(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        </>
      ) : null}

      {tab === 'hall' ? (
        <Panel title={`Hall of Fame · ${hall.length} member${hall.length === 1 ? '' : 's'}`} flush>
          <div className="newsfeed">
            {hall.length === 0 ? (
              <article>
                <p>
                  Nobody is in yet. The ballot opens three years after a man plays his last game, so
                  the first inductions come a few seasons into a dynasty.
                </p>
              </article>
            ) : (
              [...hall]
                .sort((a, b) => b.year - a.year || b.score - a.score)
                .map((h) => (
                  <article
                    key={h.playerId}
                    className="clickable"
                    onClick={() => setOpen(h.playerId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setOpen(h.playerId)
                    }}
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: the whole card is the link to his career page
                    tabIndex={0}
                  >
                    <div className="meta">
                      <span>Class of {h.year}</span>
                      <span>retired {h.retiredYear}</span>
                    </div>
                    <h4>{h.name}</h4>
                    <p>{h.case}</p>
                  </article>
                ))
            )}
          </div>
        </Panel>
      ) : null}

      {tab === 'players' ? (
        <>
          <div className="rowline">
            <input
              type="search"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <span className="dim">
              {rows.length} of {careers.length}
            </span>
          </div>
          <Panel flush>
            <DataTable
              data={rows}
              columns={cols}
              initialSort={[{ id: 'pts', desc: true }]}
              onRowClick={(r) => setOpen(r.playerId)}
              empty="Nobody has played a game yet."
            />
          </Panel>
          <p className="faint" style={{ fontSize: 11 }}>
            Everyone who has played a minute in this save, retired or not. Click a row for his
            career.
          </p>
        </>
      ) : null}

      {open ? <PlayerCareer playerId={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
