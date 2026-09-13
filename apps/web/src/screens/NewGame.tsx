import type { TeamRecord } from '@hoops/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readSaveFile, saves } from '../save/db.ts'
import type { RosterRow, TeamFinance } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel } from '../ui/bits.tsx'
import { type Column, DataTable } from '../ui/DataTable.tsx'
import { height, money, n1, pct0, seasonLabel } from '../ui/format.ts'
import { teamColors } from '../ui/teamColors.ts'
import { applyTeamAccent } from '../ui/theme.ts'

const SEASONS = [...__SEASONS__].sort((a, b) => b - a)

const previewColumns: Column<RosterRow>[] = [
  {
    id: 'name',
    header: 'Player',
    accessorFn: (r) => r.player.name,
    meta: { text: true },
    cell: (c) => c.getValue<string>(),
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
    id: 'mpg',
    header: 'MPG',
    accessorFn: (r) => r.player.realMpg,
    cell: (c) => n1(c.getValue<number>()),
  },
  {
    id: 'ppg',
    header: 'PPG',
    accessorFn: (r) =>
      r.player.real ? r.player.real.totals.pts / Math.max(1, r.player.real.gp) : 0,
    cell: (c) => n1(c.getValue<number>()),
  },
  {
    id: 'salary',
    header: 'Salary',
    accessorFn: (r) => r.salary ?? 0,
    cell: (c) => money(c.getValue<number>() || null),
  },
  { id: 'yrs', header: 'Yrs', accessorFn: (r) => r.contractYears },
]

export function NewGame() {
  const { client, startGame, resume, hasAutosave, busy } = useStore()
  const [yearEnd, setYearEnd] = useState<number>(SEASONS[0] ?? 2027)
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [teamId, setTeamId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ roster: RosterRow[]; finance: TeamFinance } | null>(null)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000) + 1)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setTeams([])
    setTeamId(null)
    setPreview(null)
    setErr(null)
    client
      .openSeason(yearEnd)
      .then((info) => {
        if (!live) return
        const sorted = [...info.teams].sort((a, b) => a.abbr.localeCompare(b.abbr))
        setTeams(sorted)
        setTeamId(sorted[0]?.teamId ?? null)
      })
      .catch((e: Error) => live && setErr(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [client, yearEnd])

  useEffect(() => {
    if (!teamId) return
    let live = true
    client
      .preview(yearEnd, teamId)
      .then((p) => live && setPreview(p))
      .catch((e: Error) => live && setErr(e.message))
    return () => {
      live = false
    }
  }, [client, yearEnd, teamId])

  const team = useMemo(() => teams.find((t) => t.teamId === teamId), [teams, teamId])

  // Picking a club recolours the menu in its colours, before you have committed to anything.
  useEffect(() => {
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
    applyTeamAccent(team?.abbr, theme)
  }, [team])

  const onImport = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        await resume(await readSaveFile(file))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [resume],
  )

  const capUsed =
    preview && preview.finance.cap > 0 ? preview.finance.payroll / preview.finance.cap : null
  /** A tax line equal to the cap is the sim's "this era had no luxury tax" fallback. */
  const hasTax = preview != null && preview.finance.taxLine > preview.finance.cap

  return (
    <div className="newgame">
      <div className="hero">
        <div className="kicker">Take the job</div>
        <h1>Hoops Dynasty</h1>
        <p>
          Pick a season and a franchise. The world is real up to opening night. After that it is
          yours.
        </p>
      </div>

      {err ? (
        <div className="banner">
          <span>{err}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={() => setErr(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="cols sidebar">
        <Panel
          title={`Franchises — ${seasonLabel(yearEnd)}`}
          actions={
            <>
              <label className="dim" htmlFor="season">
                Season
              </label>
              <select
                id="season"
                value={yearEnd}
                onChange={(e) => setYearEnd(Number(e.target.value))}
                disabled={loading}
              >
                {SEASONS.map((y) => (
                  <option key={y} value={y}>
                    {seasonLabel(y)}
                  </option>
                ))}
              </select>
            </>
          }
        >
          {loading ? (
            <p className="dim">Loading season bundle…</p>
          ) : (
            <div className="teamgrid">
              {teams.map((t) => {
                const [pri] = teamColors(t.abbr)
                return (
                  <button
                    key={t.teamId}
                    type="button"
                    aria-pressed={t.teamId === teamId}
                    style={{ ['--pri' as string]: pri }}
                    onClick={() => setTeamId(t.teamId)}
                  >
                    <span className="abbr">{t.abbr}</span>
                    <span className="nm">{t.name}</span>
                    <span className="rec">
                      {t.real.wins}-{t.real.losses}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <Panel title="Start" feature>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <h1 style={{ fontSize: 20 }}>{team ? `${team.city} ${team.name}` : '—'}</h1>
                <div className="dim">
                  {team ? `${team.conference}ern Conference · ${team.division} Division` : ''}
                </div>
              </div>
              <dl className="kv">
                <dt>Season</dt>
                <dd>{seasonLabel(yearEnd)}</dd>
                <dt>Real record that year</dt>
                <dd>{team ? `${team.real.wins}-${team.real.losses}` : '—'}</dd>
                <dt>Players on the books</dt>
                <dd>
                  {preview ? `${preview.finance.roster} of ${preview.finance.rosterMax}` : '—'}
                </dd>
                <dt>Payroll</dt>
                <dd>{money(preview?.finance.payroll)}</dd>
                <dt>Salary cap</dt>
                <dd>{money(preview?.finance.cap || null)}</dd>
                {hasTax ? (
                  <>
                    <dt>Luxury tax starts at</dt>
                    <dd>{money(preview?.finance.taxLine || null)}</dd>
                  </>
                ) : null}
                <dt>Payroll against the cap</dt>
                <dd className={capUsed != null && capUsed > 1 ? 'warn' : undefined}>
                  {capUsed != null ? pct0(capUsed) : '—'}
                </dd>
              </dl>
              {capUsed != null && capUsed > 1 ? (
                <p className="faint" style={{ fontSize: 11, margin: 0 }}>
                  Over the cap is normal, and not a problem: a club may always go past it to keep
                  its own players. It only limits what you can spend on someone else's.
                </p>
              ) : null}
              <div className="rowline">
                <label
                  className="dim"
                  htmlFor="seed"
                  title="Every random thing in this save — which shots fall, who gets hurt, who wins the lottery — is generated from this number. The same seed and the same decisions replay the same season. Change it for a different world."
                >
                  Seed
                </label>
                <input
                  id="seed"
                  type="number"
                  min={1}
                  value={seed}
                  style={{ width: 110 }}
                  onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setSeed(Math.floor(Math.random() * 1e6) + 1)}
                  title="Pick a new random seed"
                >
                  New number
                </button>
              </div>
              <p className="dim small">
                The seed decides every bounce of the ball in this save — which shots fall, who gets
                hurt, who wins the lottery. Start the same season with the same seed and make the
                same decisions, and it plays out identically. Change it for a different world.
              </p>
              <button
                type="button"
                className="primary"
                disabled={!teamId || Boolean(busy)}
                onClick={() => teamId && startGame(yearEnd, teamId, seed)}
              >
                Start dynasty
              </button>
            </div>
          </Panel>

          <Panel title="Continue">
            <div style={{ display: 'grid', gap: 8 }}>
              <button
                type="button"
                disabled={!hasAutosave || Boolean(busy)}
                onClick={async () => {
                  const s = await saves.get()
                  if (s) await resume(s)
                }}
              >
                {hasAutosave ? 'Load autosave' : 'No autosave yet'}
              </button>
              <label className="dim" style={{ display: 'grid', gap: 4 }}>
                Import a save file
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => onImport(e.target.files?.[0])}
                />
              </label>
            </div>
          </Panel>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <Panel title={team ? `${team.city} ${team.name} — opening-night roster` : 'Roster'} flush>
          <DataTable
            data={preview?.roster ?? []}
            columns={previewColumns}
            initialSort={[{ id: 'mpg', desc: true }]}
            empty="Pick a franchise."
          />
        </Panel>
      </div>
      <p className="faint" style={{ marginTop: 10 }}>
        Ratings, minutes and salaries come from that season's real data bundle.{' '}
        {preview ? `${preview.roster.length} players on the books.` : ''}
      </p>
    </div>
  )
}
