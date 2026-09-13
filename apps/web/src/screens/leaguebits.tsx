/**
 * The pieces the five spectacle screens share: the stat categories and how each one is written,
 * a five-game form strip, a vote-share bar, and the one hook that puts a career page behind every
 * player's name in the game.
 */
import { type CSSProperties, type ReactNode, useCallback, useState } from 'react'
import type { AwardCandidate, StatCategory } from '../sim/api.ts'
import { n1, pct1, pct3 } from '../ui/format.ts'
import { teamColors } from '../ui/teamColors.ts'
import { PlayerCareer } from './Career.tsx'
import './league.css'

export interface CategoryDef {
  key: StatCategory
  /** The switcher's label: short enough for a row of eleven. */
  short: string
  /** What the leaderboard is called when it has a title of its own. */
  long: string
  title: string
  format: (v: number) => string
}

/** Percentages read as `.486` the way a leaderboard has always written them; rates to one decimal. */
const rate = (v: number) => n1(v)

export const CATEGORIES: CategoryDef[] = [
  { key: 'pts', short: 'PTS', long: 'Points', title: 'Points per game', format: rate },
  { key: 'reb', short: 'REB', long: 'Rebounds', title: 'Rebounds per game', format: rate },
  { key: 'ast', short: 'AST', long: 'Assists', title: 'Assists per game', format: rate },
  { key: 'stl', short: 'STL', long: 'Steals', title: 'Steals per game', format: rate },
  { key: 'blk', short: 'BLK', long: 'Blocks', title: 'Blocks per game', format: rate },
  {
    key: 'fg3m',
    short: '3PM',
    long: 'Threes made',
    title: 'Three-pointers per game',
    format: rate,
  },
  { key: 'min', short: 'MIN', long: 'Minutes', title: 'Minutes per game', format: rate },
  {
    key: 'fgPct',
    short: 'FG%',
    long: 'Field goal %',
    title: 'Field goal percentage',
    format: pct3,
  },
  {
    key: 'fg3Pct',
    short: '3P%',
    long: 'Three-point %',
    title: 'Three-point percentage',
    format: pct3,
  },
  {
    key: 'ftPct',
    short: 'FT%',
    long: 'Free throw %',
    title: 'Free throw percentage',
    format: pct3,
  },
  {
    key: 'tsPct',
    short: 'TS%',
    long: 'True shooting',
    title: 'True shooting percentage',
    format: pct1,
  },
]

export const categoryOf = (key: StatCategory): CategoryDef =>
  CATEGORIES.find((c) => c.key === key) ?? (CATEGORIES[0] as CategoryDef)

/**
 * A vote bar is drawn against the favourite's share, not against 100%: in a six-man race nobody
 * has more than a quarter of the vote, and six stubs tell you nothing about who is winning.
 */
export const barWidth = (share: number, lead?: number): number =>
  Math.max(3, Math.min(100, (share / Math.max(share, lead ?? share, 0.0001)) * 100))

/** Five squares, newest first. Green won, red lost, grey not played. */
export function Form({ results, label }: { results: boolean[]; label?: string }) {
  const five = [...results.slice(0, 5), ...Array<null>(Math.max(0, 5 - results.length)).fill(null)]
  const won = results.filter(Boolean).length
  return (
    <span
      className="lg-form"
      title={`${label ? `${label}: ` : ''}${won}–${results.length - won} in the last ${results.length || 5}`}
    >
      {five.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: five fixed slots, newest first
        <i key={i} className={r === null ? '' : r ? 'w' : 'l'} />
      ))}
    </span>
  )
}

/** A team's primary colour, for the coloured edge of a card. */
export const priVar = (abbr: string | undefined): CSSProperties =>
  abbr ? ({ '--pri': teamColors(abbr)[0] } as CSSProperties) : {}

/**
 * The case for a candidate, in one sentence. Everything in it is a fact the sim already knows: his
 * line, his club's record, and where his side sits. No adjectives the data does not earn.
 */
export function awardCase(
  award: 'mvp' | 'roy' | 'dpoy',
  c: AwardCandidate,
  rank: number,
  best: AwardCandidate | undefined,
): string {
  const games = c.teamWins + c.teamLosses
  const pct = games > 0 ? c.teamWins / games : 0
  const club =
    games === 0
      ? 'a side that has not played'
      : pct >= 0.6
        ? `a ${c.teamWins}–${c.teamLosses} side`
        : pct >= 0.5
          ? `a ${c.teamWins}–${c.teamLosses} side in the mix`
          : `a ${c.teamWins}–${c.teamLosses} side going nowhere`
  const line =
    award === 'dpoy'
      ? `${n1(c.reb)} boards a night`
      : award === 'roy'
        ? `${n1(c.pts)} a night as a rookie`
        : `${n1(c.pts)}, ${n1(c.reb)} and ${n1(c.ast)} a night`
  if (rank === 1) return `${line} for ${club}. He holds ${Math.round(c.share * 100)}% of the vote.`
  const gap = best ? Math.round((best.share - c.share) * 100) : 0
  return `${line} for ${club}. ${
    gap <= 6 ? 'Within touching distance of' : `${gap} points of the vote behind`
  } the favourite.`
}

/** One candidate in a race: rank, name, share, the bar, his line, and the argument for him. */
export function Candidate({
  c,
  rank,
  caseFor,
  onOpen,
  teamLabel,
  leadShare,
}: {
  c: AwardCandidate
  rank: number
  caseFor?: string | undefined
  onOpen: (playerId: string) => void
  teamLabel: ReactNode
  /** The favourite's share. Bars are drawn against it so a tight race looks tight. */
  leadShare?: number | undefined
}) {
  return (
    <div className={rank === 1 ? 'lg-cand lead' : 'lg-cand'}>
      <span className="rank">{rank}</span>
      <span className="who">
        <button type="button" className="lg-link" onClick={() => onOpen(c.playerId)}>
          {c.name}
        </button>{' '}
        <span className="dim" style={{ fontWeight: 400, fontSize: 12 }}>
          {c.pos} · {teamLabel}
        </span>
      </span>
      <span className="share">{Math.round(c.share * 100)}%</span>
      <span className="track">
        <span style={{ width: `${barWidth(c.share, leadShare)}%` }} />
      </span>
      <span className="line num">
        {n1(c.pts)} pts · {n1(c.reb)} reb · {n1(c.ast)} ast · {c.gp} gp · {c.teamWins}–
        {c.teamLosses}
      </span>
      {caseFor ? <p className="case">{caseFor}</p> : null}
    </div>
  )
}

/**
 * Every player's name in these screens is a door into the career page that already exists. One
 * hook so no screen has to own the modal state itself.
 */
export function useCareerModal(): [ReactNode, (playerId: string) => void] {
  const [open, setOpen] = useState<string | null>(null)
  const show = useCallback((playerId: string) => setOpen(playerId), [])
  const node = open ? <PlayerCareer playerId={open} onClose={() => setOpen(null)} /> : null
  return [node, show]
}
