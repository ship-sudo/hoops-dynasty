// In-season cuts and minimum signings. The summer market is `market.ts`.

import { canSign, canWaive, contractFrom, deadFromWaive, minSalary } from '@hoops/frontoffice'
import { dropFromRoster, type GameState, type LeaguePlayer, pushLog, rosterOf } from '@hoops/game'

export function unsignedPool(state: GameState): LeaguePlayer[] {
  const yearEnd = state.season.yearEnd
  return state.league.players.filter((p) => {
    if (p.teamId) return false
    const owed = p.contract?.years.some((y) => y.yearEnd >= yearEnd)
    return !owed
  })
}

function stripPlan(state: GameState, teamId: string, playerId: string): void {
  const settings = state.teamSettings[teamId]
  if (settings) state.teamSettings[teamId] = dropFromRoster(settings, playerId)
  if (state.listed) state.listed = state.listed.filter((id) => id !== playerId)
}

export function applyWaive(state: GameState, playerId: string): { ok: boolean; message: string } {
  const p = state.league.players.find((x) => x.playerId === playerId)
  if (!p || p.teamId !== state.userTeamId)
    return { ok: false, message: 'He is not yours to waive.' }
  const rules = state.season.rules
  const count = rosterOf(state, state.userTeamId).length
  const gate = canWaive(count, rules)
  if (!gate.ok) return { ok: false, message: gate.reason }
  const dead = deadFromWaive(state.userTeamId, p.contract, state.season.yearEnd)
  state.deadMoney = [...(state.deadMoney ?? []), ...dead]
  stripPlan(state, state.userTeamId, playerId)
  p.teamId = null
  p.contract = null
  p.yearsWithTeam = 0
  const thisYear = dead.filter((d) => d.yearEnd === state.season.yearEnd)
  const hit = thisYear.reduce((a, d) => a + d.amount, 0)
  pushLog(state, {
    date: state.calendar.date,
    yearEnd: state.season.yearEnd,
    kind: 'note',
    text:
      hit > 0
        ? `Waived ${p.name}. $${(hit / 1_000_000).toFixed(1)}M stays on the cap this year.`
        : `Waived ${p.name}.`,
  })
  return {
    ok: true,
    message: hit > 0 ? `Waived. $${(hit / 1_000_000).toFixed(1)}M dead cap this year.` : 'Waived.',
  }
}

export function applySignMinimum(
  state: GameState,
  playerId: string,
): { ok: boolean; message: string } {
  const p = unsignedPool(state).find((x) => x.playerId === playerId)
  if (!p) return { ok: false, message: 'He is not a free agent.' }
  const rules = state.season.rules
  const count = rosterOf(state, state.userTeamId).length
  const gate = canSign(count, rules)
  if (!gate.ok) return { ok: false, message: gate.reason }
  const amount = minSalary(rules, p.yearsPro)
  const yearEnd = state.season.yearEnd
  p.teamId = state.userTeamId
  p.contract = contractFrom(
    {
      teamId: state.userTeamId,
      playerId: p.playerId,
      amount,
      years: 1,
      kind: 'minimum',
    },
    yearEnd,
  )
  p.yearsWithTeam = 0
  pushLog(state, {
    date: state.calendar.date,
    yearEnd,
    kind: 'signing',
    text: `Signed ${p.name} for the rest of the season at $${(amount / 1_000_000).toFixed(2)}M.`,
  })
  return { ok: true, message: `Signed ${p.name} at the minimum for the rest of the season.` }
}
