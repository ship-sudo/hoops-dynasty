/**
 * In season: the three races as races.
 * Once the vote is in: winners and All-NBA first, the ballot underneath.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AwardRace } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { seasonLabel } from '../ui/format.ts'
import { awardCase, Candidate, useCareerModal } from './leaguebits.tsx'
import { AwardPodium, SeasonWrap } from './SeasonWrap.tsx'
import { wrapFromGame } from './seasonWrap.ts'

const AWARDS: { key: 'mvp' | 'roy' | 'dpoy'; title: string; blurb: string }[] = [
  {
    key: 'mvp',
    title: 'Most Valuable Player',
    blurb: 'The face of a winning club. Voters name one man a night, not a duo.',
  },
  {
    key: 'roy',
    title: 'Rookie of the Year',
    blurb: 'First-year men only. Minutes count for as much as points.',
  },
  {
    key: 'dpoy',
    title: 'Defensive Player of the Year',
    blurb: 'Blocks, steals, the defensive glass, and what his side concedes.',
  },
]

export function Awards() {
  const { client, snapshot, teamById, game, setScreen } = useStore()
  const [race, setRace] = useState<AwardRace | null>(null)
  const [career, openCareer] = useCareerModal()
  const [wrap, setWrap] = useState(false)
  const model = useMemo(() => (game ? wrapFromGame(game) : null), [game])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    let live = true
    client
      .manager<AwardRace>('awardRace', 6)
      .then((r) => live && setRace(r))
      .catch(() => live && setRace(null))
    return () => {
      live = false
    }
  }, [client, snapshot])

  if (!snapshot) return null
  const state = snapshot.state
  const history = (game?.history ?? []).filter((h) => h.awards)
  const done = Boolean(game?.awards)

  const races = (
    <div className="lg-three">
      {AWARDS.map((a) => {
        const list = race?.[a.key] ?? []
        const best = list[0]
        const body = (
          <>
            {list.length === 0 ? (
              <p className="dim" style={{ margin: 0 }}>
                {state.gamesPlayed === 0
                  ? 'Nothing has been played. There is no race yet.'
                  : 'Not enough has been played for a shortlist.'}
              </p>
            ) : (
              <div className="lg-race">
                {list.map((c, i) => (
                  <Candidate
                    key={c.playerId}
                    c={c}
                    rank={i + 1}
                    caseFor={i < 3 ? awardCase(a.key, c, i + 1, best) : undefined}
                    onOpen={openCareer}
                    teamLabel={<TeamChip team={teamById.get(c.teamId)} />}
                    leadShare={best?.share}
                  />
                ))}
              </div>
            )}
            <p className="faint" style={{ fontSize: 11, margin: '8px 0 0' }}>
              {a.blurb}{' '}
              {done
                ? 'The season is over: this is how the vote finished.'
                : 'The vote is a snapshot of today and will move.'}
            </p>
          </>
        )
        return done ? (
          <div key={a.key}>
            <h3 className="sw-vote-title">{a.title}</h3>
            {body}
          </div>
        ) : (
          <Panel key={a.key} title={a.title}>
            {body}
          </Panel>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      {done && model ? (
        <Panel
          title={`${model.seasonLabel} winners`}
          actions={
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ghost" onClick={() => setWrap(true)}>
                Season wrap-up
              </button>
              <button type="button" className="ghost" onClick={() => setScreen('playoffs')}>
                The bracket
              </button>
            </span>
          }
        >
          <AwardPodium wrap={model} onOpen={openCareer} heading={false} />
        </Panel>
      ) : null}

      {done ? <Panel title="How they voted">{races}</Panel> : races}

      <Panel title="Past winners" flush>
        <div className="table-x">
          <table className="grid">
            <thead>
              <tr>
                <th className="text">Season</th>
                <th className="text">Champion</th>
                <th className="text">Finals MVP</th>
                <th className="text">MVP</th>
                <th className="text">Rookie of the Year</th>
                <th className="text">Defensive Player</th>
                <th className="text">All-NBA first team</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td className="text dim" colSpan={7}>
                    No season has finished yet. Play one out and every winner will be listed here,
                    season by season.
                  </td>
                </tr>
              ) : (
                [...history]
                  .sort((a, b) => b.yearEnd - a.yearEnd)
                  .map((h) => {
                    const aw = h.awards
                    const name = (w: { playerId: string; name: string } | null | undefined) =>
                      w ? (
                        <button
                          type="button"
                          className="lg-link"
                          onClick={() => openCareer(w.playerId)}
                        >
                          {w.name}
                        </button>
                      ) : (
                        <span className="faint">—</span>
                      )
                    return (
                      <tr key={h.yearEnd}>
                        <td className="text">{seasonLabel(h.yearEnd)}</td>
                        <td className="text">
                          {h.championTeamId ? (
                            <TeamChip team={teamById.get(h.championTeamId)} long />
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="text">{name(aw?.finalsMvp)}</td>
                        <td className="text">{name(aw?.mvp)}</td>
                        <td className="text">{name(aw?.roy)}</td>
                        <td className="text">{name(aw?.dpoy)}</td>
                        <td className="text dim">
                          {(aw?.allNba?.[0] ?? []).length === 0 ? (
                            <span className="faint">—</span>
                          ) : (
                            (aw?.allNba?.[0] ?? []).map((w, i) => (
                              <span key={w.playerId}>
                                {i > 0 ? ', ' : ''}
                                <button
                                  type="button"
                                  className="lg-link"
                                  onClick={() => openCareer(w.playerId)}
                                >
                                  {w.name}
                                </button>
                              </span>
                            ))
                          )}
                        </td>
                      </tr>
                    )
                  })
              )}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 11, padding: '6px 10px', margin: 0 }}>
          Every award this save has handed out. Click a name for his career.
        </p>
      </Panel>

      {career}
      {wrap ? (
        <SeasonWrap
          onClose={() => setWrap(false)}
          onPlayoffs={() => {
            setWrap(false)
            setScreen('playoffs')
          }}
          onOffseason={() => {
            setWrap(false)
            setScreen('offseason')
          }}
        />
      ) : null}
    </div>
  )
}
