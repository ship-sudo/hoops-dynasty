/**
 * The summer as a funnel, not a skip button. Each job is its own page; you can always look at
 * your roster, and the market only opens once the draft is done.
 */
import type { FreeAgentView, OffseasonPhase } from '../sim/api.ts'

export type OffStep = 'lottery' | 'draft' | 'squad' | 'resign' | 'market' | 'done'

export const OFF_STEPS: { id: OffStep; label: string }[] = [
  { id: 'lottery', label: 'Lottery' },
  { id: 'draft', label: 'Draft' },
  { id: 'squad', label: 'Your team' },
  { id: 'resign', label: 'Re-sign' },
  { id: 'market', label: 'Free agency' },
  { id: 'done', label: 'Season' },
]

export type StepTone = 'past' | 'now' | 'open' | 'locked'

/** Where a fresh visit should land. After the draft, that is the squad — not the open market. */
export function landingStep(phase: OffseasonPhase): OffStep {
  if (phase === 'lottery') return 'lottery'
  if (phase === 'draft') return 'draft'
  if (phase === 'freeagency') return 'squad'
  return 'done'
}

/**
 * Follow the sim when it moves, without yanking the manager off a page he chose.
 * Lottery → draft, draft → your team, anything → done.
 */
export function followPhase(step: OffStep, phase: OffseasonPhase): OffStep {
  if (phase === 'done') return 'done'
  if (step === 'lottery' && phase !== 'lottery') return landingStep(phase)
  if (step === 'draft' && phase === 'freeagency') return 'squad'
  if (!stepUnlocked(step, phase)) return landingStep(phase)
  return step
}

export function stepUnlocked(step: OffStep, phase: OffseasonPhase): boolean {
  if (phase === 'done') return step === 'done'
  if (step === 'done') return false
  if (step === 'squad') return true
  if (step === 'lottery') return phase === 'lottery'
  if (step === 'draft') return phase === 'draft' || phase === 'freeagency'
  return phase === 'freeagency'
}

export function stepTone(step: OffStep, current: OffStep, phase: OffseasonPhase): StepTone {
  if (step === current) return 'now'
  const order = OFF_STEPS.map((s) => s.id)
  if (order.indexOf(step) < order.indexOf(current)) return 'past'
  if (!stepUnlocked(step, phase)) return 'locked'
  return 'open'
}

export function ownFreeAgents(agents: FreeAgentView[], me: string): FreeAgentView[] {
  return agents.filter((p) => p.incumbentTeamId === me)
}

export function marketFreeAgents(agents: FreeAgentView[], me: string): FreeAgentView[] {
  return agents.filter((p) => p.incumbentTeamId !== me)
}

export function continueLabel(step: OffStep, phase: OffseasonPhase): string | null {
  if (phase === 'done' || step === 'done') return 'Go to home ▸'
  if (step === 'squad') {
    if (phase === 'freeagency') return 'Re-sign your players ▸'
    if (phase === 'draft') return 'Back to the draft ▸'
    return 'To the lottery ▸'
  }
  if (step === 'resign') return 'To free agency ▸'
  if (step === 'market') return 'Start the season ▸'
  return null
}

export function continueTarget(
  step: OffStep,
  phase: OffseasonPhase,
): OffStep | 'finish' | 'home' | null {
  if (phase === 'done' || step === 'done') return 'home'
  if (step === 'squad') {
    if (phase === 'freeagency') return 'resign'
    if (phase === 'draft') return 'draft'
    return 'lottery'
  }
  if (step === 'resign') return 'market'
  if (step === 'market') return 'finish'
  return null
}
