import { useState } from 'react'
import type { InjuryInterrupt } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Modal } from './bits.tsx'

/**
 * After a multi-day sim, if one of yours is out a week or more, stop and say so.
 * Dismiss lets the calendar run again; the primary button opens Tactics.
 */
export function useInjuryPause(): {
  interrupt: InjuryInterrupt | null
  dismiss: () => void
  adjustLineup: () => void
} {
  const { snapshot, setScreen } = useStore()
  const hit = snapshot?.lastDay?.interrupt ?? null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const key = hit ? `${snapshot?.lastDay?.date}:${hit.playerId}:${hit.games}` : null
  const interrupt = hit && key && key !== dismissed ? hit : null
  return {
    interrupt,
    dismiss: () => {
      if (key) setDismissed(key)
    },
    adjustLineup: () => {
      if (key) setDismissed(key)
      setScreen('tactics')
    },
  }
}

export function InjuryPause() {
  const { interrupt, dismiss, adjustLineup } = useInjuryPause()
  if (!interrupt) return null
  const n = interrupt.games
  const games = `${n} game${n === 1 ? '' : 's'}`
  return (
    <Modal title="Injury" onClose={dismiss} narrow>
      <div style={{ padding: '16px 18px 18px', display: 'grid', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
          {interrupt.name} is out {games} ({interrupt.injuryName}). Adjust your lineup.
        </p>
        <div className="continue" style={{ margin: 0 }}>
          <button type="button" className="primary" onClick={adjustLineup}>
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
