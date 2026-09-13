/**
 * The bracket, drawn as a bracket: rounds left to right, East above West, the Finals in the last
 * column. Click a series and its games open underneath, each one a door into its box score.
 *
 * While the regular season is still on there is no bracket, so the screen shows the race for it
 * instead — the field as it stands today, with the play-in line where the era puts it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Bracket, BracketSeries, PostseasonSummary } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { ordinal, shortDate } from '../ui/format.ts'
import { useBoxScore } from './BoxScore.tsx'
import { ROUND_NAMES, Series } from './bracketBits.tsx'
import { Form, useCareerModal } from './leaguebits.tsx'
import { SeasonRecap } from './SeasonRecap.tsx'
import { FinalsHonors, SeasonWrap } from './SeasonWrap.tsx'
import { wrapFromGame } from './seasonWrap.ts'

function SeriesGames({
  chosen,
  me,
  onBox,
}: {
  chosen: BracketSeries
  me: string
  onBox: (id: string) => void
}) {
  const { teamById } = useStore()
  return (
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
              <tr key={g.gameId} className="clickable" onClick={() => onBox(g.gameId)}>
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
  )
}

function RestOfPlayoffs({ yearEnd }: { yearEnd: number }) {
  const { advance, advanceTo, busy } = useStore()
  return (
    <Panel title="The rest of the playoffs">
      <p style={{ margin: 0 }}>
        You're out. Sim the rest from here — you don't have to go back to Home.
      </p>
      <div className="continue" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="primary"
          disabled={Boolean(busy)}
          onClick={() => void advance(1)}
        >
          Continue ▸
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void advanceTo(`${yearEnd + 1}-01-01`)}
          title="Play every remaining series until someone is champion"
        >
          Finish the playoffs ▸
        </button>
      </div>
    </Panel>
  )
}

export function Playoffs() {
  const { client, snapshot, teamById, setScreen, game } = useStore()
  const openBox = useBoxScore()
  const [career, openCareer] = useCareerModal()
  const wrapModel = useMemo(() => (game ? wrapFromGame(game) : null), [game])
  const [bracket, setBracket] = useState<Bracket | null>(null)
  const [post, setPost] = useState<PostseasonSummary | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [recap, setRecap] = useState(false)
  const [wrap, setWrap] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    Promise.all([
      client.manager<Bracket | null>('bracket'),
      client.manager<PostseasonSummary | null>('postseason').catch(() => null),
    ])
      .then(([b, season]) => {
        if (!live) return
        setBracket(b)
        setPost(season)
      })
      .catch(() => {
        if (live) {
          setBracket(null)
          setPost(null)
        }
      })
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

  const canSimRest =
    !snapshot.state.seasonComplete && (post?.kind === 'eliminated' || post?.kind === 'missed')
  const wrapBtn = game?.awards ? (
    <button type="button" className="ghost" onClick={() => setWrap(true)}>
      Season wrap-up
    </button>
  ) : null
  const wrapLayer = wrap ? (
    <SeasonWrap
      onClose={() => setWrap(false)}
      onPlayoffs={() => setWrap(false)}
      onOffseason={() => {
        setWrap(false)
        setScreen('offseason')
      }}
    />
  ) : null

  // ── Nothing to draw yet: show the race for the field instead. ──────────────
  if (!bracket || bracket.rounds.length === 0) {
    const conferences: ('East' | 'West')[] = ['East', 'West']
    return (
      <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
        {canSimRest ? <RestOfPlayoffs yearEnd={snapshot.state.yearEnd} /> : null}
        <Panel title="The playoff race" actions={wrapBtn}>
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
        {wrapLayer}
      </div>
    )
  }

  // ── The bracket itself. ───────────────────────────────────────────────────
  const champion = bracket.championTeamId ? teamById.get(bracket.championTeamId) : undefined
  const runnerUp = bracket.runnerUpTeamId ? teamById.get(bracket.runnerUpTeamId) : undefined
  const finals = bracket.rounds[bracket.rounds.length - 1]?.[0]
  const champWins =
    finals && bracket.championTeamId === finals.highTeamId
      ? finals.highWins
      : (finals?.lowWins ?? 0)
  const runnerWins =
    finals && bracket.championTeamId === finals.highTeamId
      ? finals.lowWins
      : (finals?.highWins ?? 0)

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {champion ? (
        <Panel
          title="Champions"
          actions={
            <span style={{ display: 'flex', gap: 8 }}>
              {wrapBtn}
              <button type="button" className="ghost" onClick={() => setRecap(true)}>
                Watch the recap
              </button>
              {snapshot.state.seasonComplete ? (
                <button type="button" className="primary" onClick={() => setScreen('offseason')}>
                  Go to the offseason ▸
                </button>
              ) : null}
            </span>
          }
        >
          <div className="lg-champ">
            <span className="cup">★</span>
            <div className="lg-final" style={{ padding: '4px 0 8px' }}>
              <span style={{ textAlign: 'right' }}>
                <div className="conf">{champion.city}</div>
                <div className="pts won">{champWins}</div>
                <div className="nm">{champion.name}</div>
              </span>
              <span className="faint">—</span>
              <span>
                <div className="conf">{runnerUp?.city ?? '—'}</div>
                <div className="pts">{runnerWins}</div>
                <div className="nm">{runnerUp?.name ?? ''}</div>
              </span>
            </div>
            <span className="dim">
              {runnerUp ? `beat the ${runnerUp.city} ${runnerUp.name} in the Finals` : ''}
              {bracket.championTeamId === me
                ? ' — and they are yours.'
                : bracket.runnerUpTeamId === me
                  ? ' — you were the other team.'
                  : ''}
            </span>
          </div>
          {wrapModel ? (
            <FinalsHonors
              mvp={wrapModel.finalsMvp}
              leaders={wrapModel.finalsLeaders}
              onOpen={openCareer}
            />
          ) : null}
          {finals && finals.games.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <SeriesGames chosen={finals} me={me} onBox={openBox} />
              <p className="faint" style={{ fontSize: 11, padding: '6px 0 0', margin: 0 }}>
                The Finals. Click a game for its box score.
              </p>
            </div>
          ) : null}
        </Panel>
      ) : canSimRest ? (
        <RestOfPlayoffs yearEnd={snapshot.state.yearEnd} />
      ) : null}

      <Panel title="The bracket" flush actions={!champion ? wrapBtn : undefined}>
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
          <SeriesGames chosen={chosen} me={me} onBox={openBox} />
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
      {wrapLayer}
      {recap ? (
        <SeasonRecap
          onClose={() => setRecap(false)}
          onContinue={() => {
            setRecap(false)
            setScreen('offseason')
          }}
          onBracket={() => setRecap(false)}
        />
      ) : null}
      {career}
    </div>
  )
}
