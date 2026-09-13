/**
 * Home is the front page of the league, not a summary of your own club.
 *
 * You land here and, without clicking anything, you know: whether you play tonight and against
 * whom, what happened last time out, where you sit, who is winning the MVP, what the league's
 * leaders are doing, and what the papers are saying — including the deals somebody is actually
 * offering you, which are one button from the trade desk.
 *
 * Everything on it comes from the seam in `sim/api.ts`. Nothing is computed here that the sim
 * already knows.
 */
import type { GameResult, TeamBox } from '@hoops/core'
import { useEffect, useMemo, useState } from 'react'
import type {
  AwardRace,
  GamePreview,
  LeaderRow,
  NewsItem,
  OffseasonState,
  PostseasonSummary,
  RosterRow,
  ScheduleEntry,
} from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { addDays, longDate, n1, ordinal, shortDate, signed1, streakText } from '../ui/format.ts'
import { useBoxScore } from './BoxScore.tsx'
import { barWidth, Form, priVar, useCareerModal } from './leaguebits.tsx'
import { verdict } from './verdict.ts'

/** The three boards a fan checks first. More than that belongs on the League screen. */
const BRIEF = [
  { key: 'pts', label: 'Points' },
  { key: 'reb', label: 'Rebounds' },
  { key: 'ast', label: 'Assists' },
] as const

function topScorers(box: TeamBox, n: number) {
  return [...box.players].sort((a, b) => b.pts - a.pts).slice(0, n)
}

/** One side of tonight's scoreboard card. */
function Side({
  label,
  abbr,
  seed,
  wins,
  losses,
  form,
  best,
  mine,
  onOpen,
}: {
  label: string
  abbr: string | undefined
  /** Playoff seed, when there is one. The regular season has none. */
  seed: number | null
  wins: number
  losses: number
  form: boolean[]
  best: GamePreview['yourBest']
  mine: boolean
  onOpen: (id: string) => void
}) {
  return (
    <div className={mine ? 'lg-side me' : 'lg-side'} style={priVar(abbr)}>
      <div className="club">
        {seed ? <span className="sd">{seed}</span> : null}
        {label}
      </div>
      <div className="rec">
        {wins}–{losses}
      </div>
      <div className="rowline" style={{ gap: 8 }}>
        <Form results={form} label={label} />
        <span className="faint" style={{ fontSize: 11 }}>
          last five
        </span>
      </div>
      <div className="man">
        {best ? (
          <>
            <div className="mn">
              <button type="button" className="lg-link" onClick={() => onOpen(best.playerId)}>
                {best.name}
              </button>
            </div>
            <div className="dim num" style={{ fontSize: 11 }}>
              {n1(best.pts)} pts · {n1(best.reb)} reb · {n1(best.ast)} ast
            </div>
          </>
        ) : (
          <span className="faint">no games played</span>
        )}
      </div>
    </div>
  )
}

/**
 * The series under the scoreboard: where it stands, what tonight settles, and every game played
 * so far as a door into its box score. The words come from the sim, not from here.
 */
function SeriesStory({
  po,
  home,
  onOpen,
  onBracket,
}: {
  po: NonNullable<GamePreview['playoff']>
  home: boolean
  onOpen: (id: string) => void
  onBracket: () => void
}) {
  return (
    <div className="lg-po">
      <div className="hd">
        {po.seriesLine ? <strong className="sl">{po.seriesLine}</strong> : null}
        <span className="faint">
          {po.kind === 'series'
            ? `Best of ${po.bestOf} · game ${po.gameNumber} ${home ? 'at home' : 'on the road'}`
            : `One game · ${home ? 'at home' : 'on the road'}`}
        </span>
      </div>
      {po.stake ? <div className="stake">{po.stake}</div> : null}
      {po.kind === 'series' ? (
        <ol className="games">
          {po.games.length === 0 ? (
            <li className="faint">No games played yet.</li>
          ) : (
            po.games.map((g, i) => (
              <li key={g.gameId}>
                <button type="button" className="lg-link" onClick={() => onOpen(g.gameId)}>
                  <span className="gn">Game {i + 1}</span>
                  <span className={g.yourPts > g.theirPts ? 'num win' : 'num loss'}>
                    {g.yourPts > g.theirPts ? 'W' : 'L'} {g.yourPts}–{g.theirPts}
                  </span>
                  <span className="faint">{g.home ? 'home' : 'away'}</span>
                </button>
              </li>
            ))
          )}
        </ol>
      ) : null}
      <button type="button" className="lg-link brk" onClick={onBracket}>
        See the full bracket ▸
      </button>
    </div>
  )
}

export function Home() {
  const { client, snapshot, teamById, advance, advanceTo, busy, setScreen } = useStore()
  const openBox = useBoxScore()
  const [career, openCareer] = useCareerModal()
  const [games, setGames] = useState<ScheduleEntry[]>([])
  const [off, setOff] = useState<OffseasonState | null>(null)
  const [lastBox, setLastBox] = useState<GameResult | null>(null)
  const [preview, setPreview] = useState<GamePreview | null>(null)
  const [post, setPost] = useState<PostseasonSummary | null>(null)
  const [race, setRace] = useState<AwardRace | null>(null)
  const [brief, setBrief] = useState<LeaderRow[][]>([])
  const [squad, setSquad] = useState<RosterRow[]>([])

  const state = snapshot?.state
  const me = state?.userTeamId

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!me) return
    let live = true
    client
      .schedule(me)
      .then((s) => live && setGames(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, me, snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!me) return
    let live = true
    client
      .roster(me)
      .then((rows) => live && setSquad(rows))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, me, snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    Promise.all([
      client.manager<OffseasonState | null>('offseason').catch(() => null),
      client.manager<GamePreview | null>('nextGame').catch(() => null),
      client.manager<AwardRace>('awardRace', 4).catch(() => null),
      Promise.all(
        BRIEF.map((b) => client.manager<LeaderRow[]>('leaders', b.key, 3).catch(() => [])),
      ),
      client.manager<PostseasonSummary | null>('postseason').catch(() => null),
    ])
      .then(([offseason, next, awards, boards, season]) => {
        if (!live) return
        setOff(offseason)
        setPreview(next)
        setRace(awards)
        setBrief(boards)
        setPost(season)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, snapshot])

  const record = useMemo(() => snapshot?.standings.find((r) => r.teamId === me), [snapshot, me])
  const played = useMemo(() => games.filter((g) => g.result !== null), [games])
  const recent = useMemo(() => played.slice(-5).reverse(), [played])
  const lastGame = recent[0] ?? null
  const squadRanked = useMemo(
    () => [...squad].sort((a, b) => b.card.overall - a.card.overall),
    [squad],
  )

  useEffect(() => {
    if (!lastGame) {
      setLastBox(null)
      return
    }
    let live = true
    client
      .boxScore(lastGame.gameId)
      .then((b) => live && setLastBox(b))
      .catch(() => live && setLastBox(null))
    return () => {
      live = false
    }
  }, [client, lastGame])

  /**
   * The inbox. The sim's own log carries league business (trades, injuries, rumours, real offers);
   * the results of your own games come off the schedule, so the mail is never empty after a game.
   */
  const inbox = useMemo<NewsItem[]>(() => {
    if (!me) return []
    const results: NewsItem[] = played.slice(-40).map((g) => {
      const home = g.homeTeamId === me
      const mine = home ? (g.result?.homePts ?? 0) : (g.result?.awayPts ?? 0)
      const theirs = home ? (g.result?.awayPts ?? 0) : (g.result?.homePts ?? 0)
      const them = teamById.get(home ? g.awayTeamId : g.homeTeamId)
      return {
        id: `sched-${g.gameId}`,
        date: g.date,
        kind: 'result',
        headline: `${mine > theirs ? 'Win' : 'Loss'} ${mine}–${theirs} ${home ? 'vs' : 'at'} ${
          them ? `${them.city} ${them.name}` : home ? g.awayTeamId : g.homeTeamId
        }`,
        body: '',
        gameId: g.gameId,
      }
    })
    const seen = new Set(results.map((r) => r.gameId))
    const league = (snapshot?.news ?? []).filter((n) => !n.gameId || !seen.has(n.gameId))
    return [...results, ...league]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 40)
  }, [played, snapshot, me, teamById])

  const offers = useMemo(() => inbox.filter((n) => n.kind === 'offer'), [inbox])

  if (!snapshot || !state || !me) return null
  const team = teamById.get(me)
  const conference = snapshot.standings.filter(
    (r) => teamById.get(r.teamId)?.conference === team?.conference,
  )
  const conferenceRank = conference.findIndex((r) => r.teamId === me) + 1
  const gp = record ? record.wins + record.losses : 0
  const diff = record && gp > 0 ? (record.pointsFor - record.pointsAgainst) / gp : 0
  /** The play-in tournament arrived in 2020-21; before that the top eight simply qualified. */
  const playIn = state.yearEnd >= 2021

  const mineBox =
    lastBox && lastGame ? (lastGame.homeTeamId === me ? lastBox.home : lastBox.away) : null
  const theirsBox =
    lastBox && mineBox ? (mineBox === lastBox.home ? lastBox.away : lastBox.home) : null

  const opponent = preview ? teamById.get(preview.opponentTeamId) : undefined
  const mvp = race?.mvp ?? []
  /** Set only when tonight's game is a postseason game. */
  const po = preview?.playoff ?? null
  /** The story to tell when there is no game to play: knocked out, missed it, or won it. */
  const over = post && post.kind !== 'playing' ? post : null

  return (
    <div className="lg-home">
      <div>
        {/* ── Tonight ─────────────────────────────────────────────────────── */}
        <Panel
          title={
            state.seasonComplete
              ? 'The season is over'
              : po
                ? `${po.title}${po.kind === 'series' ? ` · Game ${po.gameNumber}` : ''}`
                : preview
                  ? `Next up · ${longDate(preview.date)}`
                  : over
                    ? 'Your season'
                    : 'Next up'
          }
          actions={
            <span className="dim" style={{ fontSize: 11 }}>
              {longDate(state.date)} · {state.seasonId}
            </span>
          }
        >
          {state.seasonComplete ? (
            <p style={{ margin: 0 }}>
              <strong className="warn">
                {off
                  ? off.phase === 'lottery'
                    ? 'The draft lottery is next.'
                    : off.phase === 'draft'
                      ? 'The draft is waiting on you.'
                      : off.phase === 'freeagency'
                        ? 'The free-agent market is open.'
                        : 'The new season is ready.'
                  : 'The regular season is done.'}
              </strong>{' '}
              {over ? `${over.headline} ${over.detail} ` : null}
              <button type="button" className="lg-link" onClick={() => setScreen('playoffs')}>
                See the bracket
              </button>
              .
            </p>
          ) : preview ? (
            <>
              <div className="lg-scoreboard">
                <Side
                  label={team ? `${team.city} ${team.name}` : me}
                  abbr={team?.abbr}
                  seed={po?.yourSeed ?? null}
                  wins={preview.yourRecord.wins}
                  losses={preview.yourRecord.losses}
                  form={preview.yourForm}
                  best={preview.yourBest}
                  mine
                  onOpen={openCareer}
                />
                <div className="lg-vs">{preview.home ? 'vs' : 'at'}</div>
                <Side
                  label={opponent ? `${opponent.city} ${opponent.name}` : preview.opponentTeamId}
                  abbr={opponent?.abbr}
                  seed={po?.theirSeed ?? null}
                  wins={preview.theirRecord.wins}
                  losses={preview.theirRecord.losses}
                  form={preview.theirForm}
                  best={preview.theirBest}
                  mine={false}
                  onOpen={openCareer}
                />
              </div>

              {po ? (
                <SeriesStory
                  po={po}
                  home={preview.home}
                  onOpen={openBox}
                  onBracket={() => setScreen('playoffs')}
                />
              ) : null}

              <p className="dim" style={{ margin: '10px 0 0', fontSize: 12 }}>
                {preview.series.length === 0 ? (
                  po ? (
                    'You did not meet in the regular season.'
                  ) : (
                    'First meeting of the season.'
                  )
                ) : (
                  <>
                    {po ? 'Regular season: ' : 'This season: '}
                    {preview.series.map((g, i) => (
                      <span key={g.gameId}>
                        {i > 0 ? ' · ' : ''}
                        <button
                          type="button"
                          className="lg-link num"
                          onClick={() => openBox(g.gameId)}
                        >
                          <span className={g.yourPts > g.theirPts ? 'win' : 'loss'}>
                            {g.yourPts > g.theirPts ? 'W' : 'L'} {g.yourPts}–{g.theirPts}
                          </span>
                        </button>
                      </span>
                    ))}
                  </>
                )}
              </p>
            </>
          ) : over ? (
            <div className="lg-out">
              <p style={{ margin: 0 }}>
                <strong className="warn">{over.headline}</strong> {over.detail}
              </p>
              {over.aliveTeamIds.length > 0 ? (
                <p className="dim" style={{ margin: '8px 0 0', fontSize: 12 }}>
                  Still playing:{' '}
                  {/* Before the first round tips off the whole field is alive, and sixteen chips
                      is a list nobody reads. Name a few and count the rest. */}
                  {over.aliveTeamIds.slice(0, 6).map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ' · ' : ''}
                      <TeamChip team={teamById.get(id)} long />
                    </span>
                  ))}
                  {over.aliveTeamIds.length > 6
                    ? ` and ${over.aliveTeamIds.length - 6} more`
                    : null}
                </p>
              ) : null}
              <p style={{ margin: '8px 0 0', fontSize: 12 }}>
                <button type="button" className="lg-link" onClick={() => setScreen('playoffs')}>
                  See the bracket
                </button>
              </p>
            </div>
          ) : (
            <p className="dim" style={{ margin: 0 }}>
              No games left on your schedule.
            </p>
          )}

          <div className="continue" style={{ marginTop: 12 }}>
            {off ? (
              <button
                type="button"
                className="primary"
                onClick={() => setScreen('offseason')}
                title="Key 7"
              >
                Go to the offseason ▸
              </button>
            ) : null}
            <button
              type="button"
              className="primary"
              disabled={Boolean(busy) || state.seasonComplete}
              onClick={() => advance(1)}
              title="Space"
            >
              {po ? po.action : preview ? 'Play it ▸' : 'Continue ▸'}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || state.seasonComplete}
              onClick={() => advance(7)}
            >
              Sim week
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || state.seasonComplete}
              onClick={() => advanceTo(addDays(state.date, 30))}
            >
              Sim month
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || state.seasonComplete}
              onClick={() => advanceTo(`${state.yearEnd + 1}-01-01`)}
              title="Play the rest of the regular season"
            >
              Sim season
            </button>
          </div>

          <div className="progress" style={{ marginTop: 10 }} aria-hidden={!busy}>
            <span
              className="fill"
              style={{
                width: busy
                  ? `${Math.min(100, (busy.done / Math.max(1, busy.total)) * 100)}%`
                  : `${(state.gamesPlayed / Math.max(1, state.gamesTotal)) * 100}%`,
                background: busy ? 'var(--accent)' : 'var(--line)',
              }}
            />
          </div>
          <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
            {busy
              ? `${busy.label} · ${busy.done}/${busy.total}`
              : `${state.gamesPlayed} of ${state.gamesTotal} games played across the league`}
          </div>
        </Panel>

        {/* ── Where you stand ─────────────────────────────────────────────── */}
        <div className="lg-tiles">
          <div className="lg-tile" style={priVar(team?.abbr)}>
            <div className="k">Record</div>
            <div className="v">{record ? `${record.wins}–${record.losses}` : '0–0'}</div>
            <div className="s">
              {gp === 0
                ? 'no games played'
                : `${ordinal(conferenceRank)} in the ${team?.conference} · ${
                    record ? streakText(record.streak) : '—'
                  }`}
            </div>
          </div>
          <div className="lg-tile">
            <div className="k">Differential</div>
            <div className="v">{signed1(diff)}</div>
            <div className="s">a night</div>
          </div>
          <div className="lg-tile">
            <div className="k">Form</div>
            <div className="v" style={{ paddingTop: 4 }}>
              <Form results={record?.last10.slice(0, 5) ?? []} label="you" />
            </div>
            <div className="s">last five</div>
          </div>
          <div className="lg-tile">
            <div className="k">Offers on the table</div>
            <div className="v">{offers.length}</div>
            <div className="s">
              <button type="button" className="lg-link" onClick={() => setScreen('trade')}>
                trade desk ▸
              </button>
            </div>
          </div>
        </div>

        <Panel title="How it is going">
          <p style={{ margin: 0 }}>
            {verdict(
              record?.wins ?? 0,
              record?.losses ?? 0,
              diff,
              conferenceRank,
              playIn,
              // `postseason()` answers null while the regular season is still on, so this is also
              // true through a playoff run, not only after the last game of the year.
              state.seasonComplete || post !== null,
            )}
          </p>
        </Panel>

        {/* ── Last result ─────────────────────────────────────────────────── */}
        <Panel
          title={lastGame && lastBox ? `Last game · ${shortDate(lastGame.date)}` : 'Last game'}
        >
          {!lastGame || !lastBox || !mineBox || !theirsBox ? (
            <p className="dim" style={{ margin: 0 }}>
              No game played yet. The final score and who did the damage land here after the first
              one.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="rowline" style={{ gap: 14 }}>
                <span
                  className={mineBox.pts > theirsBox.pts ? 'win' : 'loss'}
                  style={{ fontWeight: 700, fontSize: 15 }}
                >
                  {mineBox.pts > theirsBox.pts ? 'Won' : 'Lost'} {mineBox.pts}–{theirsBox.pts}
                </span>
                <span className="dim">
                  {lastGame.homeTeamId === me ? 'at home to' : 'away at'}{' '}
                  <TeamChip team={teamById.get(theirsBox.teamId)} long />
                </span>
                {lastBox.overtimes > 0 ? (
                  <span className="warn">
                    after {lastBox.overtimes === 1 ? 'overtime' : `${lastBox.overtimes} overtimes`}
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                <button type="button" className="ghost" onClick={() => openBox(lastGame.gameId)}>
                  Full box score
                </button>
              </div>
              <div className="cols two">
                <div>
                  <div className="faint" style={{ fontSize: 11, marginBottom: 3 }}>
                    Led you
                  </div>
                  <ul className="leaders">
                    {topScorers(mineBox, 3).map((p) => (
                      <li key={p.playerId}>
                        <button
                          type="button"
                          className="lg-link"
                          onClick={() => openCareer(p.playerId)}
                        >
                          {p.name}
                        </button>
                        <span className="num dim">
                          {p.pts} pts · {p.oreb + p.dreb} reb · {p.ast} ast
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="faint" style={{ fontSize: 11, marginBottom: 3 }}>
                    Hurt you
                  </div>
                  <ul className="leaders">
                    {topScorers(theirsBox, 3).map((p) => (
                      <li key={p.playerId}>
                        <button
                          type="button"
                          className="lg-link"
                          onClick={() => openCareer(p.playerId)}
                        >
                          {p.name}
                        </button>
                        <span className="num dim">
                          {p.pts} pts · {p.oreb + p.dreb} reb · {p.ast} ast
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* ── The mail ────────────────────────────────────────────────────── */}
        <Panel
          title="Around the league"
          actions={
            offers.length > 0 ? (
              <span className="warn" style={{ fontSize: 11 }}>
                {offers.length} offer{offers.length === 1 ? '' : 's'} waiting
              </span>
            ) : null
          }
          flush
        >
          <div className="newsfeed lg-feed">
            {inbox.length === 0 ? (
              <article>
                <p>
                  Nothing has happened yet. Press Continue and the mail fills up with your results
                  and the league's news.
                </p>
              </article>
            ) : (
              inbox.map((n) => (
                <article
                  key={n.id}
                  className={[
                    n.gameId ? 'clickable' : '',
                    n.kind === 'rumour' ? 'rumour' : '',
                    n.kind === 'offer' ? 'offer' : '',
                  ]
                    .join(' ')
                    .trim()}
                  onClick={n.gameId ? () => openBox(n.gameId as string) : undefined}
                  onKeyDown={
                    n.gameId
                      ? (e) => {
                          if (e.key === 'Enter') openBox(n.gameId as string)
                        }
                      : undefined
                  }
                  tabIndex={n.gameId ? 0 : undefined}
                >
                  <div className="meta">
                    <span>{shortDate(n.date)}</span>
                    <span>{n.kind === 'result' ? 'your game' : n.kind}</span>
                  </div>
                  <h4>{n.headline}</h4>
                  {n.body ? <p>{n.body}</p> : null}
                  {n.kind === 'offer' ? (
                    <div className="act">
                      <button
                        type="button"
                        className="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          setScreen('trade')
                        }}
                      >
                        Open the trade desk ▸
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* ── The sidebar: your men first, then the league ─────────────────── */}
      <div>
        <Panel
          title="Your squad"
          actions={
            <button type="button" className="ghost" onClick={() => setScreen('roster')}>
              Full roster
            </button>
          }
          flush
        >
          {squadRanked.length === 0 ? (
            <p className="dim" style={{ margin: 0, padding: '8px 10px' }}>
              Roster is loading.
            </p>
          ) : (
            <table className="grid">
              <tbody>
                {squadRanked.map((r) => (
                  <tr
                    key={r.player.playerId}
                    className="clickable"
                    onClick={() => openCareer(r.player.playerId)}
                  >
                    <td className="text dim">{r.player.pos}</td>
                    <td className="text">
                      <button
                        type="button"
                        className="lg-link"
                        onClick={(e) => {
                          e.stopPropagation()
                          openCareer(r.player.playerId)
                        }}
                      >
                        {r.player.name}
                      </button>
                    </td>
                    <td className="num">{r.card.overall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title="MVP race"
          actions={
            <button type="button" className="ghost" onClick={() => setScreen('awards')}>
              All races
            </button>
          }
        >
          {mvp.length === 0 ? (
            <p className="dim" style={{ margin: 0 }}>
              No race yet.
            </p>
          ) : (
            <div className="lg-race">
              {mvp.map((c, i) => (
                <div key={c.playerId} className={i === 0 ? 'lg-cand lead' : 'lg-cand'}>
                  <span className="rank">{i + 1}</span>
                  <span className="who">
                    <button
                      type="button"
                      className="lg-link"
                      onClick={() => openCareer(c.playerId)}
                    >
                      {c.name}
                    </button>
                  </span>
                  <span className="share">{Math.round(c.share * 100)}%</span>
                  <span className="track">
                    <span style={{ width: `${barWidth(c.share, mvp[0]?.share)}%` }} />
                  </span>
                  <span className="line num">
                    <TeamChip team={teamById.get(c.teamId)} /> {n1(c.pts)}/{n1(c.reb)}/{n1(c.ast)} ·{' '}
                    {c.teamWins}–{c.teamLosses}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="League leaders"
          actions={
            <button type="button" className="ghost" onClick={() => setScreen('league')}>
              All stats
            </button>
          }
          flush
        >
          <div style={{ display: 'grid' }}>
            {BRIEF.map((b, bi) => (
              <div key={b.key} style={{ padding: '7px 10px' }}>
                <div
                  className="faint"
                  style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.09em' }}
                >
                  {b.label}
                </div>
                <ul className="leaders">
                  {(brief[bi] ?? []).length === 0 ? (
                    <li className="faint">—</li>
                  ) : (
                    (brief[bi] ?? []).map((r) => (
                      <li key={r.playerId}>
                        <button
                          type="button"
                          className="lg-link"
                          onClick={() => openCareer(r.playerId)}
                        >
                          {r.name}
                        </button>
                        <span className="num dim">{n1(r.value)}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title={`${team?.conference ?? ''}ern Conference`}
          actions={
            <button type="button" className="ghost" onClick={() => setScreen('standings')}>
              Full table
            </button>
          }
          flush
        >
          <table className="grid">
            <tbody>
              {conference.slice(0, 10).map((r, i) => (
                <tr
                  key={r.teamId}
                  className={[r.teamId === me ? 'me' : '', i === (playIn ? 5 : 7) ? 'sep' : '']
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
          <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
            {playIn
              ? 'The line is the playoff cut: the top six go straight through, 7th–10th play off for the last two places. '
              : 'The line is the playoff cut: the top eight go through. '}
            The last columns are games behind, and the last five.
          </p>
        </Panel>

        <Panel title="Last five" flush>
          <table className="grid">
            <tbody>
              {recent.length === 0 ? (
                <tr>
                  <td className="text dim">No games played.</td>
                </tr>
              ) : (
                recent.map((g) => {
                  const home = g.homeTeamId === me
                  const mine = home ? (g.result?.homePts ?? 0) : (g.result?.awayPts ?? 0)
                  const theirs = home ? (g.result?.awayPts ?? 0) : (g.result?.homePts ?? 0)
                  return (
                    <tr key={g.gameId} className="clickable" onClick={() => openBox(g.gameId)}>
                      <td className="text dim">{shortDate(g.date)}</td>
                      <td className="text">
                        {home ? 'vs' : 'at'}{' '}
                        <TeamChip team={teamById.get(home ? g.awayTeamId : g.homeTeamId)} />
                      </td>
                      <td className={mine > theirs ? 'num win' : 'num loss'}>
                        {mine > theirs ? 'W' : 'L'} {mine}–{theirs}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      {career}
    </div>
  )
}
