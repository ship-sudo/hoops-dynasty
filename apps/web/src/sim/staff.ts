/**
 * The staff seam: @hoops/game's coaching module turned into something a screen can print.
 *
 * Everything here is a view or an action over one `GameState`. The rules — who will work for whom,
 * what a man costs, what firing him costs, what he does to the team — all live in
 * `packages/game/src/staff.ts`. This file only translates, and it is the one place that turns a
 * rating into the sentence the screen shows ("+24% on what a 21-year-old gains each summer"), so
 * the numbers a user reads are the numbers the sim uses.
 */
import type { GameState } from '@hoops/game'
import {
  askingSalary,
  type Coach,
  clubAppeal,
  coachOf,
  developmentFactor,
  fireCoach as gameFire,
  hireCoach as gameHire,
  joinVerdict,
  moraleFactor,
  ROLE_JOB,
  ROLE_LABEL,
  roleRatingOf,
  rotationNoise,
  STAFF_ROLES,
  type StaffRole,
  scoutingOf,
  severanceOf,
  slotsOf,
  tiltFactor,
} from '@hoops/game'
import type {
  CandidateView,
  CoachView,
  RivalCoachView,
  StaffRoleId,
  StaffSlotView,
  StaffView,
} from './api.ts'

/** A signed percentage that never rounds a real effect away to "0%". */
const pct = (x: number, dp = 0): string =>
  `${x >= 0 ? '+' : '−'}${(Math.abs(x) * 100).toFixed(dp)}%`

/** "3% more" / "12% less" / "no different" — for a multiplier a person is meant to act on. */
const moreOrLess = (f: number): string => {
  const d = Math.round(Math.abs(f - 1) * 100)
  if (d === 0) return 'no more and no less than'
  return `${d}% ${f > 1 ? 'more' : 'less'} than`
}

/** How he likes his teams to play, in one sentence. */
function styleText(c: Coach): string {
  const pace =
    c.style.pace > 0
      ? 'pushes the tempo'
      : c.style.pace < 0
        ? 'walks it up'
        : 'plays at a fair pace'
  const threes =
    c.style.threes > 0
      ? 'wants threes'
      : c.style.threes < 0
        ? 'wants the ball inside'
        : 'takes what is there'
  const scheme =
    c.style.scheme === 'press'
      ? 'presses the ball'
      : c.style.scheme === 'pack'
        ? 'packs the paint, and will play zone where the rules allow it'
        : 'defends straight up'
  return `He ${pace} and ${threes}; at the other end he ${scheme}.`
}

/**
 * What a man is worth in one particular chair, with the arithmetic shown. Each line is the effect
 * the sim actually applies, not a description of one.
 */
function effectsOf(c: Coach, role: StaffRole): string[] {
  const r = c.ratings
  switch (role) {
    case 'head': {
      const noise = rotationNoise(r.rotation)
      const tilt = tiltFactor(r.adjust)
      const mor = moraleFactor(r.morale)
      return [
        `Rotation ${Math.round(r.rotation)} — sets the depth chart to within ±${noise.toFixed(1)} rating points of the right order. A perfect coach is ±0.0; the worst in the league is ±5.5.`,
        `Adjustments ${Math.round(r.adjust)} — rides the best men ${tilt.toFixed(2)}× as hard as an average bench (1.00× is average, 1.25× is the ceiling).`,
        `Morale ${Math.round(r.morale)} — your men take the floor at ${pct(mor - 1, 1)} condition against an average dressing room (the range is −3.0% to +3.0%).`,
      ]
    }
    case 'offense':
      return [
        `Offence ${Math.round(r.offense)} — ${r.offense >= 60 ? 'reads the roster and sets tempo, shot selection and the offensive glass to suit it.' : 'imposes his own way of playing whether the men he has can do it or not.'}`,
        `${styleText(c)}`,
        `He pulls the rotation toward your scorers by up to ${(1.6 * Math.abs(r.offense - 50) * 0.024).toFixed(1)} depth points a man.`,
      ]
    case 'defense':
      return [
        `Defence ${Math.round(r.defense)} — ${r.defense >= 60 ? 'reads the roster and sets ball pressure (and the zone, where it is legal) to suit it.' : 'runs his own scheme regardless of the personnel.'}`,
        `${styleText(c)}`,
        `He pulls the rotation toward your defenders by up to ${(1.6 * Math.abs(r.defense - 50) * 0.024).toFixed(1)} depth points a man.`,
      ]
    case 'development': {
      const f = 1 + (0.4 * (r.development - 50)) / 50
      return [
        `Development ${Math.round(r.development)} — your under-26s gain ${moreOrLess(f)} they would under an average programme each summer. The range runs from 40% less to 40% more.`,
        r.development >= 65
          ? 'A young roster is worth keeping while he is here.'
          : r.development <= 42
            ? 'Your prospects will stall under him.'
            : 'Neither much help nor much hindrance.',
      ]
    }
    case 'scout': {
      const skill = Math.max(0.05, Math.min(1, r.scouting / 100))
      const noise = Math.max(1.2, Math.min(16, 11 * (1 - skill * 0.75)))
      return [
        `Scouting ${Math.round(r.scouting)} — his reports on a lottery prospect are within about ${noise.toFixed(1)} rating points of the truth. The league's hard-coded default used to be 65 (${(11 * (1 - 0.65 * 0.75)).toFixed(1)} points).`,
        r.scouting >= 75
          ? 'You will know what you are drafting.'
          : 'Expect the board to lie to you at the margins.',
      ]
    }
  }
}

export function coachView(c: Coach, role: StaffRole): CoachView {
  return {
    coachId: c.coachId,
    name: c.name,
    role: c.role as StaffRoleId,
    roleLabel: ROLE_LABEL[c.role],
    job: ROLE_JOB[role],
    age: c.age,
    ratings: { ...c.ratings },
    quality: Math.round(roleRatingOf(c, role)),
    reputation: c.reputation,
    styleText: styleText(c),
    background: c.background,
    hallOfFamer: c.hallOfFamer,
    playerId: c.playerId,
    salary: c.salary,
    yearsLeft: c.yearsLeft,
    seasons: c.seasons,
    record: { ...c.record },
    titles: c.titles,
    effects: effectsOf(c, role),
  }
}

/** Your five chairs, the men in them, and what emptying one would cost. */
function slotViews(state: GameState, teamId: string): StaffSlotView[] {
  const staff = state.staff
  const ids = staff ? slotsOf(staff, teamId) : [null, null, null, null, null]
  return STAFF_ROLES.map((role, i) => {
    const id = ids[i]
    const c = id ? coachOf(state, id) : null
    return {
      role: role as StaffRoleId,
      roleLabel: ROLE_LABEL[role],
      job: ROLE_JOB[role],
      coach: c ? coachView(c, role) : null,
      severance: c ? severanceOf(c) : 0,
    }
  })
}

/**
 * The market. Every man out of work, with what he would cost in each of your five chairs and
 * whether he would take it — the refusal spelled out, because "no" without a reason is a bug
 * report waiting to happen.
 */
function poolViews(state: GameState, teamId: string, limit: number): CandidateView[] {
  const staff = state.staff
  if (!staff) return []
  const cap = state.league.cap.cap
  const out: CandidateView[] = []
  for (const id of staff.pool) {
    const c = coachOf(state, id)
    if (!c || c.teamId) continue
    const base = coachView(c, c.role)
    out.push({
      ...base,
      salary: askingSalary(c.reputation, c.role, cap),
      interest: STAFF_ROLES.map((role) => {
        const salary = askingSalary(c.reputation, role, cap)
        const v = joinVerdict(state, c, teamId, role, salary)
        return { role: role as StaffRoleId, willing: v.willing, reason: v.reason, salary }
      }),
    })
  }
  return out.sort((a, b) => b.reputation - a.reputation).slice(0, limit)
}

function rivalViews(
  state: GameState,
  teamId: string,
  fired: ReadonlySet<string>,
): RivalCoachView[] {
  const staff = state.staff
  if (!staff) return []
  const rows: RivalCoachView[] = []
  for (const team of state.league.teams) {
    if (team.teamId === teamId) continue
    const id = slotsOf(staff, team.teamId)[0]
    const c = id ? coachOf(state, id) : null
    rows.push({
      teamId: team.teamId,
      coachName: c?.name ?? 'Vacant',
      reputation: c?.reputation ?? 0,
      record: c ? { ...c.record } : { w: 0, l: 0 },
      titles: c?.titles ?? 0,
      playerId: c?.playerId ?? null,
      hallOfFamer: c?.hallOfFamer ?? false,
      formerlyYours: Boolean(id && fired.has(id)),
    })
  }
  return rows.sort((a, b) => b.reputation - a.reputation)
}

export function staffView(
  state: GameState,
  teamId: string,
  fired: ReadonlySet<string>,
  poolLimit = 40,
): StaffView {
  const slots = slotViews(state, teamId)
  return {
    teamId,
    slots,
    wages: slots.reduce((t, s) => t + (s.coach?.salary ?? 0), 0),
    deadMoney: state.staff?.deadMoney[teamId] ?? 0,
    pool: poolViews(state, teamId, poolLimit),
    rivals: rivalViews(state, teamId, fired),
    cap: state.league.cap.cap,
    appeal: clubAppeal(state, teamId),
  }
}

export function hire(
  state: GameState,
  teamId: string,
  coachId: string,
  role: StaffRoleId,
  years: number,
  salary?: number,
): { ok: boolean; message: string } {
  const res = gameHire(state, teamId, coachId, role as StaffRole, years, salary)
  return { ok: res.ok, message: res.reason }
}

export function fire(
  state: GameState,
  teamId: string,
  role: StaffRoleId,
): { ok: boolean; message: string; cost: number } {
  const res = gameFire(state, teamId, role as StaffRole)
  return { ok: res.ok, message: res.reason, cost: res.cost }
}

export { developmentFactor, scoutingOf }
