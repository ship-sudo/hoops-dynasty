/**
 * The stats hub: who is leading what, and what every club in the league actually does on a court.
 *
 * The sim qualifies and sorts the leaderboards itself (`leaders`), so this screen's only jobs are
 * to let you switch category, to show all eleven at once for the fan who just wants to browse, and
 * to put a career page behind every name.
 */
import { useEffect, useMemo, useState } from 'react'
import type { LeaderRow, StatCategory, TeamStatRow } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { n1, ordinal, pct3, signed1 } from '../ui/format.ts'
import { CATEGORIES, categoryOf, priVar, useCareerModal } from './leaguebits.tsx'

/** The eleven boards, each three deep, for the at-a-glance panel. */
type Glance = Record<string, LeaderRow[]>

function LeaderTable({
  rows,
  category,
  me,
  onOpen,
}: {
  rows: LeaderRow[]
  category: StatCategory
  me: string | undefined
  onOpen: (id: string) => void
}) {
  const { teamById } = useStore()
  const def = categoryOf(category)
  /** The headline line always follows, minus whichever of it the category already is. */
  const line = (['pts', 'reb', 'ast', 'min'] as const).filter((k) => k !== category)
  const LINE_TITLE = {
    pts: 'Points per game',
    reb: 'Rebounds per game',
    ast: 'Assists per game',
    min: 'Minutes per game',
  } as const
  return (
    <table className="grid">
      <thead>
        <tr>
          <th style={{ width: 34 }}>#</th>
          <th className="text">Player</th>
          <th className="text">Pos</th>
          <th className="text">Team</th>
          <th title="Games played">GP</th>
          <th title={def.title}>{def.short}</th>
          {line.map((k) => (
            <th key={k} title={LINE_TITLE[k]}>
              {k.toUpperCase()}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="text dim" colSpan={6 + line.length}>
              Nobody qualifies yet. A man needs to have played 55% of his club's games.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => (
            <tr
              key={r.playerId}
              className={`clickable${r.teamId === me ? ' me' : ''}`}
              onClick={() => onOpen(r.playerId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpen(r.playerId)
              }}
              tabIndex={0}
            >
              <td className="num faint">{i + 1}</td>
              <td className="text">{r.name}</td>
              <td className="text dim">{r.pos}</td>
              <td className="text">
                <TeamChip team={teamById.get(r.teamId)} />
              </td>
              <td className="num dim">{r.gp}</td>
              <td className="num" style={{ fontWeight: 700 }}>
                {def.format(r.value)}
              </td>
              {line.map((k) => (
                <td className="num dim" key={k}>
                  {n1(r[k])}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

export function League() {
  const { client, snapshot, teamById } = useStore()
  const [career, openCareer] = useCareerModal()
  const [category, setCategory] = useState<StatCategory>('pts')
  const [rows, setRows] = useState<LeaderRow[]>([])
  const [glance, setGlance] = useState<Glance>({})
  const [teamRows, setTeamRows] = useState<TeamStatRow[]>([])

  const me = snapshot?.state.userTeamId

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .manager<LeaderRow[]>('leaders', category, 20)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [client, category, snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    Promise.all([
      Promise.all(CATEGORIES.map((c) => client.manager<LeaderRow[]>('leaders', c.key, 3))),
      client.manager<TeamStatRow[]>('teamStats'),
    ])
      .then(([boards, teams]) => {
        if (!live) return
        const next: Glance = {}
        CATEGORIES.forEach((c, i) => {
          next[c.key] = boards[i] ?? []
        })
        setGlance(next)
        setTeamRows(teams)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, snapshot])

  const teamColumns = useMemo<Column<TeamStatRow>[]>(
    () => [
      {
        id: 'team',
        header: 'Team',
        accessorFn: (r) => r.teamId,
        meta: { text: true },
        cell: (c) => <TeamChip team={teamById.get(c.row.original.teamId)} long />,
      },
      {
        id: 'rec',
        header: 'W–L',
        accessorFn: (r) => (r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0),
        meta: { title: 'Record' },
        cell: (c) => `${c.row.original.wins}–${c.row.original.losses}`,
      },
      {
        id: 'pts',
        header: 'PTS',
        accessorFn: (r) => r.pts,
        meta: { title: 'Points scored per game' },
        cell: (c) => n1(c.row.original.pts),
      },
      {
        id: 'opp',
        header: 'OPP',
        accessorFn: (r) => r.oppPts,
        meta: { title: 'Points conceded per game' },
        cell: (c) => n1(c.row.original.oppPts),
      },
      {
        id: 'diff',
        header: 'DIFF',
        accessorFn: (r) => r.diff,
        meta: { title: 'Point differential per game' },
        cell: (c) => (
          <span className={c.row.original.diff >= 0 ? 'win' : 'loss'}>
            {signed1(c.row.original.diff)}
          </span>
        ),
      },
      {
        id: 'pace',
        header: 'PACE',
        accessorFn: (r) => r.pace,
        meta: { title: 'Estimated possessions per game' },
        cell: (c) => n1(c.row.original.pace),
      },
      {
        id: 'fg',
        header: 'FG%',
        accessorFn: (r) => r.fgPct,
        meta: { title: 'Field goal percentage' },
        cell: (c) => pct3(c.row.original.fgPct),
      },
      {
        id: 'fg3',
        header: '3P%',
        accessorFn: (r) => r.fg3Pct,
        meta: { title: 'Three-point percentage' },
        cell: (c) => pct3(c.row.original.fg3Pct),
      },
      {
        id: 'reb',
        header: 'REB',
        accessorFn: (r) => r.reb,
        meta: { title: 'Rebounds per game' },
        cell: (c) => n1(c.row.original.reb),
      },
      {
        id: 'ast',
        header: 'AST',
        accessorFn: (r) => r.ast,
        meta: { title: 'Assists per game' },
        cell: (c) => n1(c.row.original.ast),
      },
      {
        id: 'tov',
        header: 'TOV',
        accessorFn: (r) => r.tov,
        meta: { title: 'Turnovers per game' },
        cell: (c) => n1(c.row.original.tov),
      },
    ],
    [teamById],
  )

  /** Where your own club ranks in the things a fan argues about. */
  const mine = useMemo(() => {
    if (!me || teamRows.length === 0) return null
    const rankBy = (key: keyof TeamStatRow, high = true) => {
      const sorted = [...teamRows].sort((a, b) =>
        high ? (b[key] as number) - (a[key] as number) : (a[key] as number) - (b[key] as number),
      )
      return sorted.findIndex((r) => r.teamId === me) + 1
    }
    const row = teamRows.find((r) => r.teamId === me)
    if (!row) return null
    return {
      row,
      offence: rankBy('pts'),
      defence: rankBy('oppPts', false),
      diff: rankBy('diff'),
      pace: rankBy('pace'),
      three: rankBy('fg3Pct'),
    }
  }, [teamRows, me])

  if (!snapshot) return null
  const played = snapshot.state.gamesPlayed > 0

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {mine ? (
        <div className="lg-tiles">
          <div className="lg-tile" style={priVar(teamById.get(mine.row.teamId)?.abbr)}>
            <div className="k">Your record</div>
            <div className="v">
              {mine.row.wins}–{mine.row.losses}
            </div>
            <div className="s">{signed1(mine.row.diff)} a night</div>
          </div>
          <div className="lg-tile">
            <div className="k">Offence</div>
            <div className="v">{n1(mine.row.pts)}</div>
            <div className="s">{ordinal(mine.offence)} in the league</div>
          </div>
          <div className="lg-tile">
            <div className="k">Defence</div>
            <div className="v">{n1(mine.row.oppPts)}</div>
            <div className="s">{ordinal(mine.defence)} fewest conceded</div>
          </div>
          <div className="lg-tile">
            <div className="k">Net rating</div>
            <div className="v">{signed1(mine.row.diff)}</div>
            <div className="s">{ordinal(mine.diff)} in the league</div>
          </div>
          <div className="lg-tile">
            <div className="k">Pace</div>
            <div className="v">{n1(mine.row.pace)}</div>
            <div className="s">{ordinal(mine.pace)} fastest</div>
          </div>
          <div className="lg-tile">
            <div className="k">From three</div>
            <div className="v">{pct3(mine.row.fg3Pct)}</div>
            <div className="s">{ordinal(mine.three)} in the league</div>
          </div>
        </div>
      ) : null}

      <div className="lg-split">
        <Panel
          title={`${categoryOf(category).long} · league leaders`}
          actions={
            <div className="lg-switch">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={category === c.key}
                  title={c.title}
                  onClick={() => setCategory(c.key)}
                >
                  {c.short}
                </button>
              ))}
            </div>
          }
          flush
        >
          <div className="table-x">
            <LeaderTable rows={rows} category={category} me={me} onOpen={openCareer} />
          </div>
          <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
            {played
              ? 'Click a name for his career. Qualified players only: 55% of his club’s games, and a real volume of shots behind any percentage.'
              : 'Nothing has been played yet. Press Continue and the boards fill up.'}
          </p>
        </Panel>

        <Panel title="Every board, three deep" flush>
          <div className="lg-glance">
            {CATEGORIES.map((c) => (
              <section key={c.key}>
                <h4 title={c.title}>{c.long}</h4>
                <ol>
                  {(glance[c.key] ?? []).length === 0 ? (
                    <li className="faint">—</li>
                  ) : (
                    (glance[c.key] ?? []).map((r, i) => (
                      <li key={r.playerId}>
                        <span className="faint num" style={{ fontSize: 11 }}>
                          {i + 1}
                        </span>
                        <button
                          type="button"
                          className="lg-link nm"
                          onClick={() => openCareer(r.playerId)}
                        >
                          {r.name}
                        </button>
                        <span className="vl dim">{c.format(r.value)}</span>
                      </li>
                    ))
                  )}
                </ol>
              </section>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Team stats" flush>
        <DataTable
          data={teamRows}
          columns={teamColumns}
          initialSort={[{ id: 'diff', desc: true }]}
          rowClass={(r) => (r.teamId === me ? 'me' : undefined)}
          scroll={false}
        />
        <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
          Per game, sorted by point differential — the number that predicts next month better than
          the record does. Click a column to sort by it. Pace is the standard possession estimate.
        </p>
      </Panel>

      {career}
    </div>
  )
}
