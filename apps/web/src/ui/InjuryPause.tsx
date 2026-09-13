import { useState } from 'react'
import { SeasonRecap } from '../screens/SeasonRecap.tsx'
import { SeasonWrap } from '../screens/SeasonWrap.tsx'
import { recapFromChampion } from '../screens/seasonRecap.ts'
import { wrapFromGame } from '../screens/seasonWrap.ts'
import type { SimInterrupt } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Modal } from './bits.tsx'
import { seasonLabel } from './format.ts'

function interruptKey(date: string, hit: SimInterrupt): string {
  if (hit.kind === 'injury') return `${date}:injury:${hit.playerId}:${hit.games}`
  if (hit.kind === 'return') return `${date}:return:${hit.playerId}`
  if (hit.kind === 'allstar') return `${date}:allstar:${hit.yearEnd}`
  if (hit.kind === 'champion') return `${date}:champion:${hit.yearEnd}`
  if (hit.kind === 'offer') return `${date}:offer:${hit.otherTeamId}:${hit.user.players.join(',')}`
  return `${date}:season:${hit.yearEnd}`
}

/**
 * After a multi-day sim, stop for a recap the manager should actually see: a week-plus absence,
 * that man coming back, a live trade offer, All-Star weekend, the end of the regular season, or a
 * champion. Knocks sit him quietly. Answering an offer never plays another night.
 */
export function useInjuryPause(): {
  interrupt: SimInterrupt | null
  dismiss: () => void
  go: (screen: 'tactics' | 'allstar' | 'awards' | 'playoffs' | 'trade' | 'offseason') => void
} {
  const { snapshot, setScreen } = useStore()
  const hit = snapshot?.lastDay?.interrupt ?? null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const key = hit && snapshot?.lastDay ? interruptKey(snapshot.lastDay.date, hit) : null
  const interrupt = hit && key && key !== dismissed ? hit : null
  return {
    interrupt,
    dismiss: () => {
      if (key) setDismissed(key)
    },
    go: (screen) => {
      if (key) setDismissed(key)
      setScreen(screen)
    },
  }
}

function clubOf(
  teamById: ReturnType<typeof useStore>['teamById'],
  teamId: string,
  fallback: string,
) {
  const t = teamById.get(teamId)
  return {
    teamId,
    city: t?.city ?? '',
    name: t?.name ?? fallback,
    abbr: t?.abbr ?? teamId,
  }
}

export function InjuryPause() {
  const { interrupt, dismiss, go } = useInjuryPause()
  const { client, refresh, teamById, game } = useStore()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!interrupt) return null

  if (interrupt.kind === 'offer') {
    const want =
      interrupt.theyWant.join(' and ') || (interrupt.theyWantPicks ? 'draft picks' : 'nothing')
    const give =
      interrupt.theyGive.join(' and ') || (interrupt.theyGivePicks ? 'draft picks' : 'nothing')
    const extraIn =
      interrupt.theyGivePicks > 0 && interrupt.theyGive.length > 0
        ? ` and ${interrupt.theyGivePicks} pick${interrupt.theyGivePicks === 1 ? '' : 's'}`
        : ''
    const extraOut =
      interrupt.theyWantPicks > 0 && interrupt.theyWant.length > 0
        ? ` and ${interrupt.theyWantPicks} of your picks`
        : ''
    const accept = async () => {
      setBusy(true)
      setNote(null)
      try {
        const res = await client.executeTrade(interrupt.user, interrupt.other)
        if (!res.legal || !res.accepted) {
          setNote(res.reason)
          return
        }
        dismiss()
        await refresh()
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    }
    return (
      <Modal title="Trade offer" onClose={dismiss} narrow>
        <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
            {interrupt.otherName} want {want}
            {extraOut}. On the table: {give}
            {extraIn}.
          </p>
          <p className="dim" style={{ margin: 0 }}>
            “{interrupt.reason}” The league is waiting. Accepting does not play another game.
          </p>
          {note ? (
            <p className="loss" style={{ margin: 0 }}>
              {note}
            </p>
          ) : null}
          <div className="continue" style={{ margin: 0 }}>
            <button type="button" className="primary" disabled={busy} onClick={() => void accept()}>
              Accept
            </button>
            <button type="button" disabled={busy} onClick={dismiss}>
              Not now
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => go('trade')}>
              Open the desk
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (interrupt.kind === 'injury') {
    const n = interrupt.games
    const games = `${n} game${n === 1 ? '' : 's'}`
    const act = async (choice: 'cover' | 'playThrough', then?: 'tactics') => {
      await client.manager('resolveInjury', interrupt.playerId, choice)
      dismiss()
      await refresh()
      if (then === 'tactics') go('tactics')
    }
    if (interrupt.warning) {
      return (
        <Modal title="Day-to-day" onClose={dismiss} narrow>
          <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
              {interrupt.name} has a {interrupt.injuryName} (day-to-day). Sit him, or play through
              and risk a worse injury.
            </p>
            <p className="dim" style={{ margin: 0 }}>
              Keep playing him and a sprain becomes a strain, then worse.
            </p>
            <div className="continue" style={{ margin: 0 }}>
              <button type="button" className="primary" onClick={() => void act('cover')}>
                Sit him — computer adjusts
              </button>
              <button type="button" onClick={() => void act('playThrough')}>
                Play through
              </button>
            </div>
          </div>
        </Modal>
      )
    }
    return (
      <Modal title="Injury" onClose={dismiss} narrow>
        <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
            {interrupt.name} is out {games} ({interrupt.injuryName}).
          </p>
          <div className="continue" style={{ margin: 0 }}>
            <button type="button" className="primary" onClick={() => void act('cover')}>
              Let the computer adjust
            </button>
            <button type="button" onClick={() => go('tactics')}>
              I'll set the lineup
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (interrupt.kind === 'return') {
    const n = interrupt.games
    const games = `${n} game${n === 1 ? '' : 's'}`
    return (
      <Modal title="He's back" onClose={dismiss} narrow>
        <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
            {interrupt.name} is back in the rotation after {games} out ({interrupt.injuryName}).
          </p>
          <p className="dim" style={{ margin: 0 }}>
            He is dressing again. Tweak minutes if you want a different split.
          </p>
          <div className="continue" style={{ margin: 0 }}>
            <button type="button" className="primary" onClick={dismiss}>
              Continue
            </button>
            <button type="button" onClick={() => go('tactics')}>
              Set minutes
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (interrupt.kind === 'allstar') {
    const yours =
      interrupt.yours.length === 0
        ? 'Nobody of yours made the squad.'
        : interrupt.yours.length === 1
          ? `${interrupt.yours[0]} is your All-Star.`
          : `Your All-Stars: ${interrupt.yours.join(', ')}.`
    return (
      <Modal title="All-Star weekend" onClose={dismiss} narrow>
        <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
            East {interrupt.eastPts}–{interrupt.westPts} West.
            {interrupt.mvpName ? ` ${interrupt.mvpName} took MVP.` : ''}
          </p>
          <p className="dim" style={{ margin: 0 }}>
            {yours}
          </p>
          <div className="continue" style={{ margin: 0 }}>
            <button type="button" className="primary" onClick={() => go('allstar')}>
              See the recap
            </button>
            <button type="button" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  if (interrupt.kind === 'champion') {
    const seed = recapFromChampion({
      yearEnd: interrupt.yearEnd,
      yours: interrupt.yours,
      champion: clubOf(teamById, interrupt.championTeamId, interrupt.championName),
      runner: clubOf(teamById, interrupt.runnerUpTeamId, interrupt.runnerUpName),
      champWins: interrupt.championWins,
      runnerWins: interrupt.runnerUpWins,
      finalsMvpName: interrupt.finalsMvpName,
    })
    return (
      <SeasonRecap
        seed={seed}
        onClose={dismiss}
        onContinue={() => go('offseason')}
        onBracket={() => go('playoffs')}
      />
    )
  }

  if (game && wrapFromGame(game)) {
    return (
      <SeasonWrap
        onClose={dismiss}
        onPlayoffs={() => go('playoffs')}
        onOffseason={() => go('offseason')}
      />
    )
  }

  return (
    <Modal title={`${seasonLabel(interrupt.yearEnd)} wrap-up`} onClose={dismiss} narrow>
      <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
          Regular season over. You finished {interrupt.userWins}–{interrupt.userLosses}.
          {interrupt.mvpName ? ` ${interrupt.mvpName} is MVP.` : ''}
        </p>
        <div className="continue" style={{ margin: 0 }}>
          <button type="button" className="primary" onClick={() => go('playoffs')}>
            To the playoffs ▸
          </button>
          <button type="button" onClick={dismiss}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
