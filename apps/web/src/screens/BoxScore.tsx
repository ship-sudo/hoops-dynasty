import type { GameResult, PlayerBox, TeamBox } from '@hoops/core'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useStore } from '../store.tsx'
import { Modal } from '../ui/bits.tsx'
import { n0, n1 } from '../ui/format.ts'
import { teamColors } from '../ui/teamColors.ts'

const BoxCtx = createContext<(gameId: string) => void>(() => {})
export const useBoxScore = () => useContext(BoxCtx)

function pctOf(m: number, a: number): string {
  return a > 0 ? `${((m / a) * 100).toFixed(0)}%` : '—'
}

function PlayerTable({ box }: { box: TeamBox }) {
  const rows = [...box.players].sort(
    (a, b) => Number(b.starter) - Number(a.starter) || b.min - a.min,
  )
  const t = box.totals
  const cell = (p: PlayerBox) => (
    <tr key={p.playerId}>
      <td className="text">
        {p.name}
        {p.starter ? (
          <span className="faint" title="Started the game">
            {' '}
            ·
          </span>
        ) : null}
      </td>
      <td className="num">{n1(p.min)}</td>
      <td className="num">
        {p.fgm}-{p.fga}
      </td>
      <td className="num">
        {p.fg3m}-{p.fg3a}
      </td>
      <td className="num">
        {p.ftm}-{p.fta}
      </td>
      <td className="num">{p.oreb}</td>
      <td className="num">{p.dreb}</td>
      <td className="num">{p.ast}</td>
      <td className="num">{p.stl}</td>
      <td className="num">{p.blk}</td>
      <td className="num">{p.tov}</td>
      <td className="num">{p.pf}</td>
      <td className="num">{p.plusMinus > 0 ? `+${p.plusMinus}` : p.plusMinus}</td>
      <td className="num" style={{ fontWeight: 700 }}>
        {p.pts}
      </td>
    </tr>
  )
  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="text">Player</th>
          <th title="Minutes played">Min</th>
          <th title="Field goals made and attempted">FG</th>
          <th title="Three-pointers made and attempted">3P</th>
          <th title="Free throws made and attempted">FT</th>
          <th title="Offensive rebounds">OR</th>
          <th title="Defensive rebounds">DR</th>
          <th title="Assists">A</th>
          <th title="Steals">S</th>
          <th title="Blocks">B</th>
          <th title="Turnovers">TO</th>
          <th title="Personal fouls">PF</th>
          <th title="How many points his team outscored the other by while he was on the floor">
            +/−
          </th>
          <th title="Points">Pts</th>
        </tr>
      </thead>
      <tbody>{rows.map(cell)}</tbody>
      <tfoot>
        <tr style={{ borderTop: '1px solid var(--line)' }}>
          <td className="text dim">
            Totals · {pctOf(t.fgm, t.fga)} FG · {pctOf(t.fg3m, t.fg3a)} 3P ·{' '}
            {box.possessions.toFixed(0)} poss
          </td>
          <td className="num dim">{n0(t.min)}</td>
          <td className="num dim">
            {t.fgm}-{t.fga}
          </td>
          <td className="num dim">
            {t.fg3m}-{t.fg3a}
          </td>
          <td className="num dim">
            {t.ftm}-{t.fta}
          </td>
          <td className="num dim">{t.oreb}</td>
          <td className="num dim">{t.dreb}</td>
          <td className="num dim">{t.ast}</td>
          <td className="num dim">{t.stl}</td>
          <td className="num dim">{t.blk}</td>
          <td className="num dim">{t.tov}</td>
          <td className="num dim">{t.pf}</td>
          <td className="num dim" />
          <td className="num" style={{ fontWeight: 700 }}>
            {box.pts}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function QuarterLine({
  result,
  nameOf,
  colorOf,
  first = 'away',
}: {
  result: GameResult
  nameOf?: (teamId: string) => string
  colorOf?: (teamId: string) => string
  first?: 'away' | 'home'
}) {
  const { teamById } = useStore()
  const periods = Math.max(result.home.quarters.length, result.away.quarters.length)
  const label = (i: number) => (i < 4 ? `Q${i + 1}` : `OT${i - 3}`)
  const sides = first === 'home' ? [result.home, result.away] : [result.away, result.home]
  const row = (box: TeamBox) => {
    const t = teamById.get(box.teamId)
    const name = nameOf?.(box.teamId) ?? t?.abbr ?? box.teamId
    const hue = colorOf?.(box.teamId) ?? teamColors(t?.abbr ?? '')[0]
    return (
      <tr key={box.teamId}>
        <td className="text">
          <span className="chip">
            <span className="swatch" style={{ background: hue }} />
            {name}
          </span>
        </td>
        {Array.from({ length: periods }, (_, i) => (
          <td key={label(i)} className="num">
            {box.quarters[i] ?? '—'}
          </td>
        ))}
        <td className="num" style={{ fontWeight: 700 }}>
          {box.pts}
        </td>
      </tr>
    )
  }
  return (
    <table className="grid" style={{ width: 'max-content', minWidth: 320 }}>
      <thead>
        <tr>
          <th className="text">Team</th>
          {Array.from({ length: periods }, (_, i) => (
            <th key={label(i)}>{label(i)}</th>
          ))}
          <th>Final</th>
        </tr>
      </thead>
      <tbody>{sides.map(row)}</tbody>
    </table>
  )
}

/** Quarter line + two player tables. Used by the regular-season modal and the All-Star recap. */
export function GameBox({
  result,
  nameOf,
  colorOf,
  first = 'away',
}: {
  result: GameResult
  nameOf?: (teamId: string) => string
  colorOf?: (teamId: string) => string
  first?: 'away' | 'home'
}) {
  const { teamById } = useStore()
  const sides = first === 'home' ? [result.home, result.away] : [result.away, result.home]
  return (
    <>
      <QuarterLine
        result={result}
        {...(nameOf ? { nameOf } : {})}
        {...(colorOf ? { colorOf } : {})}
        first={first}
      />
      {sides.map((box) => {
        const t = teamById.get(box.teamId)
        const title = nameOf?.(box.teamId) ?? (t ? `${t.city} ${t.name}` : box.teamId)
        const hue = colorOf?.(box.teamId) ?? teamColors(t?.abbr ?? '')[0]
        const role = nameOf ? null : box === result.away ? 'away' : 'home'
        return (
          <div key={box.teamId}>
            <div className="boxsection" style={{ ['--c' as string]: hue }}>
              <h3>{title}</h3>
              {role ? <span className="faint">{role}</span> : null}
            </div>
            <div className="table-x">
              <PlayerTable box={box} />
            </div>
          </div>
        )
      })}
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        A dot after a name means he started. “Poss” is possessions — how many times each side had
        the ball. Hover a column heading for what it counts.
      </p>
    </>
  )
}

function BoxScoreModal({ gameId, onClose }: { gameId: string; onClose: () => void }) {
  const { client, teamById } = useStore()
  const [result, setResult] = useState<GameResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setResult(null)
    client
      .boxScore(gameId)
      .then((r) => live && setResult(r))
      .catch((e: Error) => live && setErr(e.message))
    return () => {
      live = false
    }
  }, [client, gameId])

  const title = useMemo(() => {
    if (!result) return 'Box score'
    const h = teamById.get(result.home.teamId)
    const a = teamById.get(result.away.teamId)
    const awayWon = result.away.pts > result.home.pts
    return (
      <span className="boxscore-teams">
        <span className="chip">
          <span className="swatch" style={{ background: teamColors(a?.abbr ?? '')[0] }} />
          {a?.abbr ?? ''}
        </span>
        <span className="tname">{a ? `${a.city} ${a.name}` : result.away.teamId}</span>
        <span className={awayWon ? 'score' : 'score lost'}>{result.away.pts}</span>
        <span className="faint">at</span>
        <span className="chip">
          <span className="swatch" style={{ background: teamColors(h?.abbr ?? '')[0] }} />
          {h?.abbr ?? ''}
        </span>
        <span className="tname">{h ? `${h.city} ${h.name}` : result.home.teamId}</span>
        <span className={awayWon ? 'score lost' : 'score'}>{result.home.pts}</span>
        {result.overtimes > 0 ? (
          <span className="badge warn">{result.overtimes}OT</span>
        ) : (
          <span className="badge dim">Final</span>
        )}
      </span>
    )
  }, [result, teamById])

  return (
    <Modal title={title} onClose={onClose}>
      <div className="body" style={{ padding: 12, display: 'grid', gap: 14 }}>
        {err ? <div className="banner">{err}</div> : null}
        {!result && !err ? <p className="dim">Loading…</p> : null}
        {result ? <GameBox result={result} /> : null}
      </div>
    </Modal>
  )
}

/** Provides `useBoxScore()` to everything below and hosts the single modal. */
export function BoxScoreHost({ children }: { children: ReactNode }) {
  const [gameId, setGameId] = useState<string | null>(null)
  const open = useCallback((id: string) => setGameId(id), [])
  return (
    <BoxCtx.Provider value={open}>
      {children}
      {gameId ? <BoxScoreModal gameId={gameId} onClose={() => setGameId(null)} /> : null}
    </BoxCtx.Provider>
  )
}
