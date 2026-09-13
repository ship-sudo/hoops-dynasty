import type { TeamRecord } from '@hoops/core'
import { useMemo, useState } from 'react'
import type { StandingsRow } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { FormRun, Panel, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { n1, pct3, signed1, streakText } from '../ui/format.ts'

/** `cut` is where the club sits against the postseason line: straight in, the play-in, or out. */
type Row = StandingsRow & {
  team: TeamRecord | undefined
  rank: number
  cut?: 'in' | 'play' | 'out' | undefined
}

/**
 * Two column sets. Fifteen columns do not fit in half a screen, so the side-by-side conference view
 * gets the nine a fan actually reads and the full-width views get everything.
 */
function columns(full: boolean): Column<Row>[] {
  const splits: Column<Row>[] = [
    {
      id: 'home',
      header: 'Home',
      accessorFn: (r) => r.homeWins,
      cell: (c) => `${c.row.original.homeWins}-${c.row.original.homeLosses}`,
      meta: { title: 'Record at home' },
    },
    {
      id: 'away',
      header: 'Away',
      accessorFn: (r) => r.wins - r.homeWins,
      cell: (c) =>
        `${c.row.original.wins - c.row.original.homeWins}-${c.row.original.losses - c.row.original.homeLosses}`,
      meta: { title: 'Record on the road' },
    },
    {
      id: 'conf',
      header: 'Conf',
      accessorFn: (r) => r.confWins,
      cell: (c) => `${c.row.original.confWins}-${c.row.original.confLosses}`,
      meta: { title: 'Record against the same conference' },
    },
    {
      id: 'div',
      header: 'Div',
      accessorFn: (r) => r.divWins,
      cell: (c) => `${c.row.original.divWins}-${c.row.original.divLosses}`,
      meta: { title: 'Record against the same division' },
    },
    {
      id: 'ppg',
      header: 'PPG',
      accessorFn: (r) => (r.wins + r.losses > 0 ? r.pointsFor / (r.wins + r.losses) : 0),
      cell: (c) => n1(c.getValue<number>()),
      meta: { title: 'Points scored per game' },
    },
    {
      id: 'papg',
      header: 'OPP',
      accessorFn: (r) => (r.wins + r.losses > 0 ? r.pointsAgainst / (r.wins + r.losses) : 0),
      cell: (c) => n1(c.getValue<number>()),
      meta: { title: 'Points conceded per game' },
    },
  ]
  return [
    {
      id: 'rank',
      header: '#',
      accessorKey: 'rank',
      size: 42,
      meta: { text: true },
      cell: (c) => {
        const r = c.row.original
        return (
          <span className={`seed ${r.cut === 'in' ? 'in' : r.cut === 'play' ? 'play' : ''}`.trim()}>
            {r.rank}
          </span>
        )
      },
    },
    {
      id: 'team',
      header: 'Team',
      accessorFn: (r) => r.team?.abbr ?? r.teamId,
      meta: { text: true },
      cell: (c) => <TeamChip team={c.row.original.team} long />,
      size: 180,
    },
    { id: 'w', header: 'W', accessorKey: 'wins', meta: { title: 'Wins' } },
    { id: 'l', header: 'L', accessorKey: 'losses', meta: { title: 'Losses' } },
    {
      id: 'pct',
      header: 'Pct',
      accessorKey: 'pct',
      cell: (c) => pct3(c.getValue<number>()),
      meta: { title: 'Share of games won' },
    },
    {
      id: 'gb',
      header: 'GB',
      accessorKey: 'gb',
      cell: (c) => (c.getValue<number>() === 0 ? '—' : c.getValue<number>().toFixed(1)),
      meta: { title: 'Games behind the conference leader' },
    },
    ...(full ? splits : []),
    {
      id: 'diff',
      header: 'Diff',
      accessorFn: (r) =>
        r.wins + r.losses > 0 ? (r.pointsFor - r.pointsAgainst) / (r.wins + r.losses) : 0,
      cell: (c) => {
        const v = Math.round(c.getValue<number>() * 10) / 10
        return <span className={v > 0 ? 'win' : v < 0 ? 'loss' : undefined}>{signed1(v)}</span>
      },
      meta: { title: 'Points scored minus points conceded, per game' },
    },
    {
      id: 'l10',
      header: 'L10',
      accessorFn: (r) => r.last10.filter(Boolean).length,
      cell: (c) => {
        const l10 = c.row.original.last10
        const w = l10.filter(Boolean).length
        return (
          <span className="formcell">
            <FormRun results={l10.slice(-5)} />
            {w}-{l10.length - w}
          </span>
        )
      },
      meta: { title: 'Record over the last ten games' },
    },
    {
      id: 'strk',
      header: 'Strk',
      accessorKey: 'streak',
      cell: (c) => {
        const v = c.getValue<number>()
        return <span className={v > 0 ? 'win' : v < 0 ? 'loss' : undefined}>{streakText(v)}</span>
      },
      meta: { title: 'Current run of wins or losses' },
    },
  ]
}

export function Standings() {
  const { snapshot, teamById } = useStore()
  const [group, setGroup] = useState<'conference' | 'division' | 'league'>('conference')
  const me = snapshot?.state.userTeamId ?? ''

  const rows: Row[] = useMemo(
    () =>
      (snapshot?.standings ?? []).map((r, i) => ({
        ...r,
        team: teamById.get(r.teamId),
        rank: i + 1,
      })),
    [snapshot, teamById],
  )

  const cols = useMemo(() => columns(group !== 'conference'), [group])
  const rowClass = (r: Row) => (r.teamId === me ? 'me' : undefined)

  /** The play-in tournament arrived in 2020-21; before that the top eight simply qualified. */
  const playIn = (snapshot?.state.yearEnd ?? 0) >= 2021

  const groups: { title: string; rows: Row[]; seeded: boolean }[] = useMemo(() => {
    if (group === 'league') return [{ title: 'League', rows, seeded: false }]
    if (group === 'conference') {
      return (['East', 'West'] as const).map((c) => ({
        title: `${c}ern Conference`,
        seeded: true,
        rows: rows
          .filter((r) => r.team?.conference === c)
          .map((r, i) => ({
            ...r,
            rank: i + 1,
            cut: (i < (playIn ? 6 : 8) ? 'in' : playIn && i < 10 ? 'play' : 'out') as Row['cut'],
          })),
      }))
    }
    const divs = new Map<string, Row[]>()
    for (const r of rows) {
      const key = `${r.team?.conference ?? '?'} · ${r.team?.division ?? '?'}`
      const list = divs.get(key)
      if (list) list.push(r)
      else divs.set(key, [r])
    }
    return [...divs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, list]) => ({
        title,
        seeded: false,
        rows: list.map((r, i) => ({ ...r, rank: i + 1 })),
      }))
  }, [rows, group, playIn])

  if (!snapshot) return null

  /**
   * The cutlines, drawn where they belong. The index check is the honest part: sort the table by
   * something other than its own order and the line would be a lie, so it simply does not appear.
   */
  const cutlineFor = (seeded: boolean) =>
    seeded
      ? (r: Row, i: number) => {
          if (r.rank !== i + 1) return null
          if (playIn && r.rank === 6)
            return (
              <tr key={`${r.teamId}-cut`} className="cutline playoff">
                <td colSpan={cols.length}>
                  <span className="rule">Play-in</span>
                </td>
              </tr>
            )
          if (r.rank === (playIn ? 10 : 8))
            return (
              <tr key={`${r.teamId}-cut`} className="cutline playin">
                <td colSpan={cols.length}>
                  <span className="rule">Lottery</span>
                </td>
              </tr>
            )
          return null
        }
      : undefined

  return (
    <div className="stack">
      <div className="pagehead">
        <h1>Standings</h1>
        <span className="sub">{snapshot.state.seasonId}</span>
        <span style={{ flex: 1 }} />
        <div className="nav">
          {(['conference', 'division', 'league'] as const).map((g) => (
            <button key={g} type="button" aria-current={group === g} onClick={() => setGroup(g)}>
              {g[0]?.toUpperCase()}
              {g.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={group === 'conference' ? 'cols two' : 'cols'}>
        {groups.map((g) => (
          <Panel key={g.title} title={g.title} flush>
            <DataTable
              data={g.rows}
              columns={cols}
              initialSort={[{ id: 'pct', desc: true }]}
              rowClass={rowClass}
              scroll={false}
              rowAfter={cutlineFor(g.seeded)}
            />
          </Panel>
        ))}
      </div>
      <p className="faint" style={{ fontSize: 11 }}>
        {playIn
          ? 'The top six are through; seventh to tenth play off for the last two places. '
          : 'The top eight are through. '}
        Pct is the share of games won, GB the games behind the leader, Diff the points scored minus
        points conceded per game, L10 the last ten games and Strk the current run. Hover a heading
        for what it means, or click it to sort.
        {group === 'conference'
          ? ' Switch to League or Division for the home, away, conference and division splits.'
          : ''}
      </p>
    </div>
  )
}
