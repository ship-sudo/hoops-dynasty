/**
 * The bracket, drawn as a bracket: rounds left to right, East above West, the Finals in the last
 * column. Click a series and its games open underneath, each one a door into its box score.
 *
 * While the regular season is still on there is no bracket, so the screen shows the race for it
 * instead — the field as it stands today, with the play-in line where the era puts it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Bracket, BracketSeries } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { ordinal, shortDate } from '../ui/format.ts'
import { useBoxScore } from './BoxScore.tsx'
import { Form, priVar } from './leaguebits.tsx'

const ROUND_NAMES = ['First round', 'Conference semi-finals', 'Conference finals', 'The Finals']

function Series({
  s,
  me,
  selected,
  onSelect,
}: {
  s: BracketSeries
  me: string
  selected: boolean
  onSelect: () => void
}) {
  const { teamById } = useStore()
  const high = teamById.get(s.highTeamId)
  const low = teamById.get(s.lowTeamId)
  const target = Math.ceil(s.bestOf / 2)
  const done = s.winnerTeamId !== null
  const side = (
    teamId: string,
    seed: number | null,
    wins: number,
    team: ReturnType<typeof teamById.get>,
  ) => (
    <span
      className={[
        'team',
        done && s.winnerTeamId === teamId ? 'won' : done ? 'out' : '',
        teamId === me ? 'mine' : '',
      ]
        .join(' ')
        .trim()}
      style={priVar(team?.abbr)}
    >
      <span className="sd">{seed ?? '—'}</span>
      <span className="nm">{team ? `${team.city} ${team.name}` : teamId}</span>
      <span className="wn">{wins}</span>
    </span>
  )
  return (
    <button
      type="button"
      className="lg-series"
      aria-pressed={selected}
      onClick={onSelect}
      title={`${s.games.length} game${s.games.length === 1 ? '' : 's'} played`}
    >
      {side(s.highTeamId, s.highSeed, s.highWins, high)}
      {side(s.lowTeamId, s.lowSeed, s.lowWins, low)}
      <span className="foot">
        {done
          ? `${teamById.get(s.winnerTeamId as string)?.abbr ?? ''} win ${Math.max(s.highWins, s.lowWins)}–${Math.min(s.highWins, s.lowWins)}`
          : s.games.length === 0
            ? `Best of ${s.bestOf} · to come`
            : `First to ${target} · game ${s.games.length + 1} next`}
      </span>
    </button>
  )
}

export function Playoffs() {
  const { client, snapshot, teamById } = useStore()
  const openBox = useBoxScore()
  const [bracket, setBracket] = useState<Bracket | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .manager<Bracket | null>('bracket')
      .then((b) => live && setBracket(b))
      .catch(() => live && setBracket(null))
    return () => {
      live = false
    }
  }, [client, snapshot])

  const me = snapshot?.state.userTeamId ?? ''
  const playIn = (snapshot?.state.yearEnd ?? 0) >= 2021

  /** Every series in the bracket, keyed so one can be selected and its games shown. */
  const byKey = useMemo(() => {
    const map = new Map<string, BracketSeries>()
    bracket?.rounds.forEach((round, ri) => {
      round.forEach((s, si) => {
        map.set(`${ri}-${si}`, s)
      })
    })
    return map
  }, [bracket])

  const chosen = open ? byKey.get(open) : undefined

  if (!snapshot) return null

  // ── Nothing to draw yet: show the race for the field instead. ──────────────
  if (!bracket || bracket.rounds.length === 0) {
    const conferences: ('East' | 'West')[] = ['East', 'West']
    return (
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        <Panel title="The playoff race">
          <p style={{ margin: 0 }}>
            The bracket is drawn when the regular season ends. This is the field as it stands today
            —{' '}
            {playIn
              ? 'the top six in each conference go straight through, 7th to 10th play off for the last two places.'
              : 'the top eight in each conference go through.'}
          </p>
        </Panel>
        <div className="cols two">
          {conferences.map((conf) => {
            const rows = snapshot.standings.filter(
              (r) => teamById.get(r.teamId)?.conference === conf,
            )
            return (
              <Panel key={conf} title={`${conf}ern Conference`} flush>
                <table className="grid">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }}>#</th>
                      <th className="text">Team</th>
                      <th>W–L</th>
                      <th title="Games behind the conference leader">GB</th>
                      <th className="text" title="Last five, newest first">
                        Form
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, playIn ? 12 : 10).map((r, i) => (
                      <tr
                        key={r.teamId}
                        className={[
                          r.teamId === me ? 'me' : '',
                          i === (playIn ? 5 : 7) || (playIn && i === 9) ? 'sep' : '',
                        ]
                          .join(' ')
                          .trim()}
                      >
                        <td className="num faint">{i + 1}</td>
                        <td className="text">
                          <TeamChip team={teamById.get(r.teamId)} long />
                        </td>
                        <td className="num">
                          {r.wins}–{r.losses}
                        </td>
                        <td className="num dim">{r.gb === 0 ? '—' : r.gb.toFixed(1)}</td>
                        <td className="text">
                          <Form results={r.last10.slice(0, 5)} label={r.teamId} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )
          })}
        </div>
      </div>
    )
  }

  // ── The bracket itself. ───────────────────────────────────────────────────
  const champion = bracket.championTeamId ? teamById.get(bracket.championTeamId) : undefined
  const runnerUp = bracket.runnerUpTeamId ? teamById.get(bracket.runnerUpTeamId) : undefined

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {champion ? (
        <Panel title="Champions">
          <div className="lg-champ">
            <span className="cup">★</span>
            <span className="cn">
              {champion.city} {champion.name}
            </span>
            <span className="dim">
              {runnerUp ? `beat the ${runnerUp.city} ${runnerUp.name} in the Finals` : ''}
              {bracket.championTeamId === me ? ' — and they are yours.' : ''}
            </span>
          </div>
        </Panel>
      ) : null}

      <Panel title="The bracket" flush>
        <div className="lg-bracket" style={{ padding: 10 }}>
          {bracket.rounds.map((round, ri) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rounds are positional, and there are four
            <div className="lg-round" key={ri}>
              <h4>{ROUND_NAMES[ri] ?? `Round ${ri + 1}`}</h4>
              {round.length === 0 ? (
                <p className="faint" style={{ textAlign: 'center', fontSize: 11 }}>
                  to come
                </p>
              ) : (
                round.map((s, si) => (
                  <Series
                    key={`${s.highTeamId}-${s.lowTeamId}`}
                    s={s}
                    me={me}
                    selected={open === `${ri}-${si}`}
                    onSelect={() => setOpen(open === `${ri}-${si}` ? null : `${ri}-${si}`)}
                  />
                ))
              )}
            </div>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 11, padding: '0 10px 8px', margin: 0 }}>
          The small number on the left of a team is its seed; the big one on the right is games won
          in the series. Click a series to see its games.
        </p>
      </Panel>

      {chosen ? (
        <Panel
          title={`${teamById.get(chosen.highTeamId)?.name ?? chosen.highTeamId} vs ${
            teamById.get(chosen.lowTeamId)?.name ?? chosen.lowTeamId
          } · ${chosen.highWins}–${chosen.lowWins}`}
          actions={
            <button type="button" className="ghost" onClick={() => setOpen(null)}>
              Close
            </button>
          }
          flush
        >
          <table className="grid">
            <thead>
              <tr>
                <th className="text">Game</th>
                <th className="text">Date</th>
                <th className="text">At</th>
                <th className="text">Result</th>
              </tr>
            </thead>
            <tbody>
              {chosen.games.length === 0 ? (
                <tr>
                  <td className="text dim" colSpan={4}>
                    Not played yet.
                  </td>
                </tr>
              ) : (
                chosen.games.map((g, i) => {
                  const homeWon = g.homePts > g.awayPts
                  const winner = homeWon
                    ? g.homeTeamId
                    : g.homeTeamId === chosen.highTeamId
                      ? chosen.lowTeamId
                      : chosen.highTeamId
                  return (
                    <tr key={g.gameId} className="clickable" onClick={() => openBox(g.gameId)}>
                      <td className="text dim">Game {i + 1}</td>
                      <td className="text dim">{shortDate(g.date)}</td>
                      <td className="text">
                        <TeamChip team={teamById.get(g.homeTeamId)} long />
                      </td>
                      <td className="text">
                        <span className={winner === me ? 'win' : ''}>
                          {teamById.get(winner)?.abbr ?? winner} win{' '}
                          <span className="num">
                            {Math.max(g.homePts, g.awayPts)}–{Math.min(g.homePts, g.awayPts)}
                          </span>
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
            Click a game for its box score.
          </p>
        </Panel>
      ) : null}

      <Panel title="The field" flush>
        <div className="cols two">
          {(['East', 'West'] as const).map((conf) => (
            <table className="grid" key={conf}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th className="text">{conf}ern Conference</th>
                </tr>
              </thead>
              <tbody>
                {bracket.seeds[conf].length === 0 ? (
                  <tr>
                    <td className="text dim" colSpan={2}>
                      Not set.
                    </td>
                  </tr>
                ) : (
                  bracket.seeds[conf].map((teamId, i) => (
                    <tr key={teamId} className={teamId === me ? 'me' : undefined}>
                      <td className="num faint">{ordinal(i + 1)}</td>
                      <td className="text">
                        <TeamChip team={teamById.get(teamId)} long />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ))}
        </div>
      </Panel>
    </div>
  )
}
