import { useState } from 'react'
import type { SimInterrupt } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Modal } from './bits.tsx'
import { seasonLabel } from './format.ts'

function interruptKey(date: string, hit: SimInterrupt): string {
  if (hit.kind === 'injury') return `${date}:injury:${hit.playerId}:${hit.games}`
  if (hit.kind === 'allstar') return `${date}:allstar:${hit.yearEnd}`
  return `${date}:season:${hit.yearEnd}`
}

/**
 * After a multi-day sim, stop for a recap the manager should actually see: a week-plus injury,
 * All-Star weekend, or the end of the regular season.
 */
export function useInjuryPause(): {
  interrupt: SimInterrupt | null
  dismiss: () => void
  go: (screen: 'tactics' | 'allstar' | 'awards') => void
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

export function InjuryPause() {
  const { interrupt, dismiss, go } = useInjuryPause()
  if (!interrupt) return null

  if (interrupt.kind === 'injury') {
    const n = interrupt.games
    const games = `${n} game${n === 1 ? '' : 's'}`
    return (
      <Modal title="Injury" onClose={dismiss} narrow>
        <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
            {interrupt.name} is out {games} ({interrupt.injuryName}). Adjust your lineup.
          </p>
          <div className="continue" style={{ margin: 0 }}>
            <button type="button" className="primary" onClick={() => go('tactics')}>
              Adjust lineup
            </button>
            <button type="button" onClick={dismiss}>
              Dismiss
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

  return (
    <Modal title={`${seasonLabel(interrupt.yearEnd)} wrap-up`} onClose={dismiss} narrow>
      <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
          Regular season over. You finished {interrupt.userWins}–{interrupt.userLosses}.
          {interrupt.mvpName ? ` ${interrupt.mvpName} is MVP.` : ''}
        </p>
        <p className="dim" style={{ margin: 0 }}>
          Awards are in. The playoffs are next.
        </p>
        <div className="continue" style={{ margin: 0 }}>
          <button type="button" className="primary" onClick={() => go('awards')}>
            See the awards
          </button>
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </Modal>
  )
}
