/**
 * The trade desk. Two packages, a live verdict from the sim, and the offers the AI is chasing.
 *
 * Nothing here judges a deal: `assessTrade` owns legality, the answer and the money, and every
 * number on screen comes straight back from it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PickRef, TradeAssessment, TradePackage } from '../sim/api.ts'
import type { IncomingOffer } from '../sim/protocol.ts'
import { useStore } from '../store.tsx'
import {
  type AssetRow,
  AssetTable,
  PickList,
  pickKeyOf,
  pickLabel,
  Signed,
} from '../ui/AssetTable.tsx'
import { Panel } from '../ui/bits.tsx'
import { money } from '../ui/format.ts'

interface SideData {
  rows: AssetRow[]
  picks: PickRef[]
}

const EMPTY: SideData = { rows: [], picks: [] }

/** Join the trade block (money, value, surplus) with the roster (age, position, ratings). */
async function loadSide(
  client: ReturnType<typeof useStore>['client'],
  teamId: string,
): Promise<SideData> {
  const [block, roster, picks] = await Promise.all([
    client.tradeBlock(teamId),
    client.roster(teamId),
    client.picks(teamId),
  ])
  const byRow = new Map(roster.map((r) => [r.player.playerId, r]))
  const rows = block.map((b) => {
    const p = byRow.get(b.playerId)?.player
    const ovr = byRow.get(b.playerId)?.card.overall ?? 0
    return {
      playerId: b.playerId,
      name: b.name,
      pos: p?.pos ?? '—',
      age: p?.age ?? 0,
      ovr,
      salary: b.salary,
      contractYears: b.contractYears,
      value: b.value,
      surplus: b.surplus,
    }
  })
  return { rows, picks }
}

function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function packageOf(
  teamId: string,
  players: ReadonlySet<string>,
  picks: PickRef[],
  pickSel: ReadonlySet<string>,
): TradePackage {
  return {
    teamId,
    players: [...players],
    picks: picks.filter((p) => pickSel.has(pickKeyOf(p))),
  }
}

function Verdict({
  assessment,
  userAbbr,
  otherAbbr,
  stale,
}: {
  assessment: TradeAssessment | null
  userAbbr: string
  otherAbbr: string
  stale: boolean
}) {
  if (!assessment)
    return <p className="dim">Pick players or picks on both sides to see what they say.</p>

  const { legal, reasons, accepted, reason, net, outgoing } = assessment
  // The sim often puts the first illegality straight into `reason`, so printing both repeats it.
  const extra = reasons.filter((r) => r !== reason)
  return (
    <div style={{ display: 'grid', gap: 10, opacity: stale ? 0.55 : 1 }}>
      <div className="rowline" style={{ gap: 14 }}>
        <span className={legal ? 'win' : 'loss'} style={{ fontWeight: 600 }}>
          {legal ? 'The league would allow it' : 'The league would block it'}
        </span>
        <span className={accepted ? 'win' : 'warn'} style={{ fontWeight: 600 }}>
          {accepted ? 'They accept' : 'They refuse'}
        </span>
        <span style={{ flex: 1 }} />
        <span className="dim">
          What {otherAbbr} gain: <Signed v={net} />
        </span>
      </div>

      <p style={{ margin: 0 }}>“{reason}”</p>

      {!legal && extra.length ? (
        <ul className="reasons">
          {extra.map((r) => (
            <li key={r} className="loss">
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      {legal && !accepted ? (
        <p className="dim" style={{ margin: 0 }}>
          {net < 0
            ? `You are about ${money(-net)} of value short of a yes. Add a player or a pick.`
            : 'They value it, but not enough to do it.'}
        </p>
      ) : null}

      <table className="grid">
        <thead>
          <tr>
            <th className="text">Salary</th>
            <th title="Salary this club sends away">Out</th>
            <th title="Salary this club takes on">In</th>
            <th title="What the payroll change works out at">Net</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="text">{userAbbr} (you)</td>
            <td className="num">{money(outgoing.user)}</td>
            <td className="num">{money(outgoing.other)}</td>
            <td className="num">
              <Signed v={outgoing.other - outgoing.user} />
            </td>
          </tr>
          <tr>
            <td className="text">{otherAbbr}</td>
            <td className="num">{money(outgoing.other)}</td>
            <td className="num">{money(outgoing.user)}</td>
            <td className="num">
              <Signed v={outgoing.user - outgoing.other} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function Trade() {
  const { client, snapshot, teams, teamById, refresh } = useStore()
  const me = snapshot?.state.userTeamId ?? ''

  const others = useMemo(
    () => [...teams].filter((t) => t.teamId !== me).sort((a, b) => a.abbr.localeCompare(b.abbr)),
    [teams, me],
  )
  const [otherTeamId, setOtherTeamId] = useState('')
  useEffect(() => {
    const first = others[0]
    if (first && !others.some((t) => t.teamId === otherTeamId)) setOtherTeamId(first.teamId)
  }, [others, otherTeamId])

  const [mine, setMine] = useState<SideData>(EMPTY)
  const [theirs, setTheirs] = useState<SideData>(EMPTY)
  const [minePlayers, setMinePlayers] = useState<ReadonlySet<string>>(new Set())
  const [theirPlayers, setTheirPlayers] = useState<ReadonlySet<string>>(new Set())
  const [minePicks, setMinePicks] = useState<ReadonlySet<string>>(new Set())
  const [theirPicks, setTheirPicks] = useState<ReadonlySet<string>>(new Set())
  const [assessment, setAssessment] = useState<TradeAssessment | null>(null)
  const [stale, setStale] = useState(false)
  const [offers, setOffers] = useState<IncomingOffer[]>([])
  const [offerNames, setOfferNames] = useState<Map<string, string>>(new Map())
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)
  const [working, setWorking] = useState(false)

  const clearDeal = useCallback(() => {
    setMinePlayers(new Set())
    setTheirPlayers(new Set())
    setMinePicks(new Set())
    setTheirPicks(new Set())
    setAssessment(null)
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!me) return
    let live = true
    loadSide(client, me)
      .then((d) => live && setMine(d))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, me, snapshot])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!otherTeamId) return
    let live = true
    loadSide(client, otherTeamId)
      .then((d) => live && setTheirs(d))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, otherTeamId, snapshot])

  // A new trade partner means a new deal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the partner changes
  useEffect(() => clearDeal(), [otherTeamId])

  // Offers come from any club, so pull their blocks too — a package is only ids.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `snapshot` is the refetch trigger, not a read
  useEffect(() => {
    if (!me) return
    let live = true
    client
      .incomingOffers(6)
      .then(async (list) => {
        const ids = [...new Set(list.map((o) => o.other.teamId))]
        const blocks = await Promise.all(ids.map((id) => client.tradeBlock(id)))
        if (!live) return
        const names = new Map<string, string>()
        for (const b of blocks) for (const p of b) names.set(p.playerId, p.name)
        setOfferNames(names)
        setOffers(list)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [client, me, snapshot])

  const userPack = useMemo(
    () => packageOf(me, minePlayers, mine.picks, minePicks),
    [me, minePlayers, mine.picks, minePicks],
  )
  const otherPack = useMemo(
    () => packageOf(otherTeamId, theirPlayers, theirs.picks, theirPicks),
    [otherTeamId, theirPlayers, theirs.picks, theirPicks],
  )
  const empty =
    userPack.players.length +
      userPack.picks.length +
      otherPack.players.length +
      otherPack.picks.length ===
    0

  const dealKey = JSON.stringify([userPack, otherPack])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `dealKey` is the serialised form of both packages
  useEffect(() => {
    if (empty || !otherTeamId) {
      setAssessment(null)
      return
    }
    let live = true
    setStale(true)
    client
      .assessTrade(userPack, otherPack)
      .then((a) => {
        if (!live) return
        setAssessment(a)
        setStale(false)
      })
      .catch(() => live && setStale(false))
    return () => {
      live = false
    }
  }, [client, dealKey, empty, otherTeamId])

  const propose = useCallback(async () => {
    setWorking(true)
    try {
      const res = await client.executeTrade(userPack, otherPack)
      setAssessment(res)
      if (res.legal && res.accepted) {
        setOutcome({ ok: true, text: `Trade agreed. ${res.reason}` })
        clearDeal()
        await refresh()
      } else {
        setOutcome({ ok: false, text: `No deal. ${res.reason}` })
      }
    } catch (e) {
      setOutcome({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setWorking(false)
    }
  }, [client, userPack, otherPack, clearDeal, refresh])

  const acceptOffer = useCallback(
    async (offer: IncomingOffer) => {
      setWorking(true)
      try {
        const res = await client.executeTrade(offer.user, offer.other)
        if (res.legal && res.accepted) {
          setOutcome({
            ok: true,
            text: `Trade agreed with ${teamById.get(offer.other.teamId)?.abbr ?? offer.other.teamId}. ${res.reason}`,
          })
          clearDeal()
          await refresh()
        } else {
          setOutcome({ ok: false, text: `Offer fell through. ${res.reason}` })
        }
      } catch (e) {
        setOutcome({ ok: false, text: e instanceof Error ? e.message : String(e) })
      } finally {
        setWorking(false)
      }
    },
    [client, teamById, clearDeal, refresh],
  )

  if (!snapshot) return null

  const myTeam = teamById.get(me)
  const theirTeam = teamById.get(otherTeamId)
  const myAbbr = myTeam?.abbr ?? 'You'
  const theirAbbr = theirTeam?.abbr ?? 'Them'
  const nameOf = (side: SideData, id: string) =>
    side.rows.find((r) => r.playerId === id)?.name ?? id

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="pagehead">
        <h1>Trade</h1>
        <span className="dim">{myAbbr} and</span>
        <select
          value={otherTeamId}
          onChange={(e) => setOtherTeamId(e.target.value)}
          aria-label="Trade partner"
        >
          {others.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.abbr} — {t.city} {t.name}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <span className="faint">
          Click a row to put a player in the deal, or click him again to take him out.
        </span>
      </div>
      <p className="faint" style={{ fontSize: 11, margin: 0 }}>
        <strong>Value</strong> is what a player is worth over the rest of his contract.{' '}
        <strong>Surplus</strong> is that value minus what he is still owed — a cheap good player has
        a big surplus, an expensive one can be worth less than nothing. Clubs trade on surplus, and
        the league only allows a deal when the two sides' salaries roughly match.
      </p>

      {outcome ? (
        <div className="banner" style={outcome.ok ? { borderColor: 'var(--win)' } : undefined}>
          <span className={outcome.ok ? 'win' : undefined}>{outcome.text}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={() => setOutcome(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="cols two">
        <Panel
          title={`${myAbbr} send`}
          actions={
            <span className="dim num">
              {userPack.players.length + userPack.picks.length} selected ·{' '}
              {money(assessment?.outgoing.user ?? 0)}
            </span>
          }
        >
          <AssetTable
            rows={mine.rows}
            selected={minePlayers}
            onToggle={(id) => setMinePlayers((s) => toggle(s, id))}
            empty="No players."
          />
          <h3 style={{ margin: '10px 0 5px' }}>Picks</h3>
          <PickList
            picks={mine.picks}
            selected={minePicks}
            onToggle={(k) => setMinePicks((s) => toggle(s, k))}
          />
        </Panel>

        <Panel
          title={`${theirAbbr} send`}
          actions={
            <span className="dim num">
              {otherPack.players.length + otherPack.picks.length} selected ·{' '}
              {money(assessment?.outgoing.other ?? 0)}
            </span>
          }
        >
          <AssetTable
            rows={theirs.rows}
            selected={theirPlayers}
            onToggle={(id) => setTheirPlayers((s) => toggle(s, id))}
            empty="No players."
          />
          <h3 style={{ margin: '10px 0 5px' }}>Picks</h3>
          <PickList
            picks={theirs.picks}
            selected={theirPicks}
            onToggle={(k) => setTheirPicks((s) => toggle(s, k))}
          />
        </Panel>
      </div>

      <div className="cols sidebar">
        <Panel
          title="The deal"
          actions={
            <>
              <button type="button" className="ghost" onClick={clearDeal} disabled={empty}>
                Clear
              </button>
              <button
                type="button"
                className="primary"
                onClick={propose}
                disabled={working || empty || !assessment?.legal}
                title={
                  assessment && !assessment.legal
                    ? (assessment.reasons[0] ?? 'Illegal trade')
                    : 'Send the offer'
                }
              >
                {working ? 'Proposing…' : 'Propose'}
              </button>
            </>
          }
        >
          <div className="cols two" style={{ marginBottom: 10 }}>
            <div>
              <h3>{myAbbr} out</h3>
              <PackageList
                players={userPack.players.map((id) => nameOf(mine, id))}
                picks={userPack.picks}
              />
            </div>
            <div>
              <h3>{theirAbbr} out</h3>
              <PackageList
                players={otherPack.players.map((id) => nameOf(theirs, id))}
                picks={otherPack.picks}
              />
            </div>
          </div>
          <Verdict
            assessment={empty ? null : assessment}
            userAbbr={myAbbr}
            otherAbbr={theirAbbr}
            stale={stale}
          />
        </Panel>

        <Panel title="Offers to you">
          {offers.length === 0 ? (
            <p className="dim">Nobody is chasing anything right now.</p>
          ) : (
            <div className="offers">
              {offers.map((o) => {
                const from = teamById.get(o.other.teamId)
                return (
                  <article key={`${o.other.teamId}-${o.other.players.join(',')}`}>
                    <div className="rowline">
                      <strong>{from ? `${from.city} ${from.name}` : o.other.teamId}</strong>
                      <span style={{ flex: 1 }} />
                      <button
                        type="button"
                        onClick={() => acceptOffer(o)}
                        disabled={working || !o.assessment.legal}
                      >
                        Accept
                      </button>
                    </div>
                    <p className="dim" style={{ margin: '3px 0' }}>
                      They get {o.user.players.map((id) => nameOf(mine, id)).join(', ') || '—'}
                      {o.user.picks.length ? `, ${o.user.picks.map(pickLabel).join(', ')}` : ''}.
                    </p>
                    <p style={{ margin: '3px 0' }}>
                      You get{' '}
                      {o.other.players.map((id) => offerNames.get(id) ?? id).join(', ') || '—'}
                      {o.other.picks.length ? `, ${o.other.picks.map(pickLabel).join(', ')}` : ''}.
                    </p>
                    <p className="faint" style={{ margin: '3px 0' }}>
                      “{o.assessment.reason}” · salary {money(o.assessment.outgoing.user)} out,{' '}
                      {money(o.assessment.outgoing.other)} in
                      {o.assessment.legal ? '' : ' · illegal as it stands'}
                    </p>
                  </article>
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function PackageList({ players, picks }: { players: string[]; picks: PickRef[] }) {
  if (players.length === 0 && picks.length === 0) return <p className="faint">Nothing yet.</p>
  return (
    <ul className="packagelist">
      {players.map((n) => (
        <li key={n}>{n}</li>
      ))}
      {picks.map((p) => (
        <li key={pickKeyOf(p)} className="dim">
          {pickLabel(p)}
        </li>
      ))}
    </ul>
  )
}
