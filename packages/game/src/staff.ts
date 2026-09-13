/**
 * The coaching staff: five men per club, a carousel that never stops turning, and the places where
 * a coach actually changes what happens on the floor.
 *
 * DESIGN-THEMES §3 asks for former players returning as coaches and one day running a rival, and
 * §4 asks for the league to generate its own stories. A staff is the cheapest way to get both: it
 * gives a club an identity that outlives its roster, and it gives a retired legend somewhere to go.
 *
 * WHY THE STORE IS PACKED STRINGS, LIKE `history.ts`
 * Every reducer `structuredClone`s the whole save once per simulated day — about 190 times a season.
 * Clone cost tracks the *number of objects*, not their size. Two hundred coaches as objects (each
 * with nested ratings, style, contract and record) is ~1,000 extra objects per clone, which measured
 * at roughly a millisecond a clone: nearly two seconds added to a 20-season headless run. So a coach
 * lives as one packed line, decoded only when something asks a question of him — which is never in
 * the hot loop.
 *
 * WHAT THE HOT LOOP READS INSTEAD
 * `StaffState.profiles` is a denormalised `teamId -> number[10]`: the seven effective ratings plus
 * the style the staff would call for. Thirty small arrays, rebuilt only when a staff changes. The
 * rotation reads that and never touches a packed line.
 *
 * WHERE A COACH REACHES THE GAME
 * Every effect goes through an input the engine already has — tactics, minutes, condition. There is
 * no fudge factor on the scoreboard anywhere in this file.
 *
 *   rotation     misranks the depth chart. 0 -> ±5.5 rating points of noise, 100 -> none, 50 -> ±2.75.
 *   adjust       tilts the minutes ladder toward the best men: 0.75x at 0, 1.0x at 50, 1.25x at 100.
 *   morale       the condition the engine is handed: x0.97 at 0, x1.00 at 50, x1.03 at 100.
 *   offense      sets pace / shot selection, and pulls the depth chart toward offensive players.
 *   defense      sets pressure / zone, and pulls the depth chart toward defenders.
 *   development  scales what a young player gains in the summer (wired in apps/web's develop hook).
 *   scouting     the accuracy of the draft board (wired to `scout()` in @hoops/draftclass).
 *
 * Everything is centred on 50, so a league of average coaches plays the game it played before.
 */

import { clamp, type Rng, type Tactics } from '@hoops/core'
import { type Career, HOF_THRESHOLD, hofScore, isNotable, totalsOf } from './history.ts'
import type { GameState, LeaguePlayer } from './state.ts'
import { pushLog, teamOf } from './state.ts'

// ── Shape ────────────────────────────────────────────────────────────────────

export const STAFF_ROLES = ['head', 'offense', 'defense', 'development', 'scout'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const ROLE_LABEL: Record<StaffRole, string> = {
  head: 'Head coach',
  offense: 'Offensive coach',
  defense: 'Defensive coach',
  development: 'Player development',
  scout: 'Head scout',
}

/** What each man is employed to do, said plainly. The screen prints these verbatim. */
export const ROLE_JOB: Record<StaffRole, string> = {
  head: 'Sets the rotation, makes the in-game calls and keeps the dressing room.',
  offense: 'Decides how you attack: tempo, shot selection, whether you crash the glass.',
  defense: 'Decides how you defend: ball pressure, and zone where the rules allow it.',
  development: 'Runs the summer programme. How much your young players improve is his work.',
  scout: 'Runs the draft board. How close your reports are to the truth is his work.',
}

export interface CoachRatings {
  /** How well the automatic depth chart is set. */
  rotation: number
  /** In-game adjustments: how hard he leans on his best men. */
  adjust: number
  /** Man management. A happy squad plays fresher. */
  morale: number
  offense: number
  defense: number
  development: number
  scouting: number
}

export const RATING_ORDER = [
  'rotation',
  'adjust',
  'morale',
  'offense',
  'defense',
  'development',
  'scouting',
] as const satisfies readonly (keyof CoachRatings)[]

export type DefScheme = 'press' | 'balanced' | 'pack'
export const SCHEMES: DefScheme[] = ['press', 'balanced', 'pack']

export interface CoachStyle {
  pace: -1 | 0 | 1
  threes: -1 | 0 | 1
  scheme: DefScheme
}

export interface Coach {
  coachId: string
  name: string
  /** What he is known for. Any coach may be hired into any slot; this is the job he is built for. */
  role: StaffRole
  age: number
  /** The career store's id, when he used to play. */
  playerId: string | null
  /** One phrase about where he came from. */
  background: string
  hallOfFamer: boolean
  /** 5–99. Drives what he costs and who he will work for. */
  reputation: number
  /** Seasons on a staff anywhere in this save. */
  seasons: number
  /** His record as a head coach in this save. */
  record: { w: number; l: number }
  /** Titles won as a head coach in this save. */
  titles: number
  /** null = out of work. */
  teamId: string | null
  /** Dollars per year. 0 when out of work. */
  salary: number
  yearsLeft: number
  ratings: CoachRatings
  style: CoachStyle
}

export interface StaffState {
  /** coachId -> packed line. See `packCoach`. */
  coaches: Record<string, string>
  /** teamId -> the five coachIds in `STAFF_ROLES` order, ';'-joined. '' marks a vacancy. */
  byTeam: Record<string, string>
  /**
   * teamId -> [rotation, adjust, morale, offense, defense, development, scouting, pace, threes,
   * scheme]. The only thing the per-game path ever reads. Rebuilt by `rebuildProfile`.
   */
  profiles: Record<string, number[]>
  /** Coaches out of work, best first. */
  pool: string[]
  /** What firing people has cost each club, cumulative. */
  deadMoney: Record<string, number>
  nextId: number
}

/** Vacant slots are not neutral: nobody is doing the job. */
export const VACANT_RATING = 35

/** The seven ratings a club's staff actually gives it, plus the style they would call for. */
export interface StaffProfile {
  rotation: number
  adjust: number
  morale: number
  offense: number
  defense: number
  development: number
  scouting: number
  style: CoachStyle
}

// ── Packing ──────────────────────────────────────────────────────────────────

const clean = (s: string): string => s.replace(/[|;]/g, ' ')

export function packCoach(c: Coach): string {
  return [
    clean(c.name),
    c.role,
    c.age,
    c.playerId ?? '',
    clean(c.background),
    c.hallOfFamer ? 1 : 0,
    c.reputation,
    c.seasons,
    c.record.w,
    c.record.l,
    c.titles,
    c.teamId ?? '',
    c.salary,
    c.yearsLeft,
    ...RATING_ORDER.map((k) => c.ratings[k]),
    c.style.pace,
    c.style.threes,
    SCHEMES.indexOf(c.style.scheme),
  ].join('|')
}

export function unpackCoach(coachId: string, line: string): Coach {
  const f = line.split('|')
  const n = (i: number): number => Number(f[i] ?? 0)
  const ratings = {} as CoachRatings
  RATING_ORDER.forEach((k, i) => {
    ratings[k] = n(14 + i)
  })
  return {
    coachId,
    name: f[0] ?? '',
    role: (f[1] ?? 'head') as StaffRole,
    age: n(2),
    playerId: f[3] ? (f[3] as string) : null,
    background: f[4] ?? '',
    hallOfFamer: n(5) === 1,
    reputation: n(6),
    seasons: n(7),
    record: { w: n(8), l: n(9) },
    titles: n(10),
    teamId: f[11] ? (f[11] as string) : null,
    salary: n(12),
    yearsLeft: n(13),
    ratings,
    style: {
      pace: clamp(n(21), -1, 1) as -1 | 0 | 1,
      threes: clamp(n(22), -1, 1) as -1 | 0 | 1,
      scheme: SCHEMES[n(23)] ?? 'balanced',
    },
  }
}

export function coachOf(state: GameState, coachId: string): Coach | null {
  const line = state.staff?.coaches[coachId]
  return line ? unpackCoach(coachId, line) : null
}

export function putCoach(staff: StaffState, c: Coach): void {
  staff.coaches[c.coachId] = packCoach(c)
}

/** The five coachIds a club employs, in `STAFF_ROLES` order. */
export function slotsOf(staff: StaffState, teamId: string): (string | null)[] {
  const raw = staff.byTeam[teamId]
  if (!raw) return [null, null, null, null, null]
  const parts = raw.split(';')
  return STAFF_ROLES.map((_, i) => (parts[i] ? (parts[i] as string) : null))
}

function setSlots(staff: StaffState, teamId: string, ids: (string | null)[]): void {
  staff.byTeam[teamId] = ids.map((x) => x ?? '').join(';')
}

// ── The rating that matters, per role ────────────────────────────────────────

/** What a man is worth in one particular job, 0–100. */
export function roleRatingOf(c: Coach, role: StaffRole): number {
  switch (role) {
    case 'head':
      return (c.ratings.rotation + c.ratings.adjust + c.ratings.morale) / 3
    case 'offense':
      return c.ratings.offense
    case 'defense':
      return c.ratings.defense
    case 'development':
      return c.ratings.development
    case 'scout':
      return c.ratings.scouting
  }
}

// ── Profiles: the only thing the per-game path reads ─────────────────────────

export function rebuildProfile(staff: StaffState, teamId: string): void {
  const ids = slotsOf(staff, teamId)
  const coaches = ids.map((id) => (id ? unpackCoach(id, staff.coaches[id] ?? '') : null))
  const head = coaches[0] ?? null
  const off = coaches[1] ?? null
  const def = coaches[2] ?? null
  const dev = coaches[3] ?? null
  const sco = coaches[4] ?? null
  const or = (c: Coach | null, k: keyof CoachRatings): number => (c ? c.ratings[k] : VACANT_RATING)
  // The offensive coach calls the attack; if there is nobody in the chair the head coach does it.
  const attacker = off ?? head
  const defender = def ?? head
  staff.profiles[teamId] = [
    head ? head.ratings.rotation : VACANT_RATING,
    head ? head.ratings.adjust : VACANT_RATING,
    head ? head.ratings.morale : VACANT_RATING,
    or(off, 'offense'),
    or(def, 'defense'),
    or(dev, 'development'),
    or(sco, 'scouting'),
    attacker ? attacker.style.pace : 0,
    attacker ? attacker.style.threes : 0,
    defender ? SCHEMES.indexOf(defender.style.scheme) : 1,
  ]
}

export function profileOf(state: GameState, teamId: string): StaffProfile | null {
  const p = state.staff?.profiles[teamId]
  if (!p) return null
  return {
    rotation: p[0] ?? 50,
    adjust: p[1] ?? 50,
    morale: p[2] ?? 50,
    offense: p[3] ?? 50,
    defense: p[4] ?? 50,
    development: p[5] ?? 50,
    scouting: p[6] ?? 50,
    style: {
      pace: clamp(p[7] ?? 0, -1, 1) as -1 | 0 | 1,
      threes: clamp(p[8] ?? 0, -1, 1) as -1 | 0 | 1,
      scheme: SCHEMES[p[9] ?? 1] ?? 'balanced',
    },
  }
}

/** The draft-board accuracy a club is entitled to. 65 was hardcoded before there were scouts. */
export function scoutingOf(state: GameState, teamId: string): number {
  return state.staff?.profiles[teamId]?.[6] ?? 65
}

/** How much of the model's summer gain a club's young players actually keep. 1.0 at 50. */
export function developmentFactor(state: GameState, teamId: string | null): number {
  if (!teamId) return 1
  const d = state.staff?.profiles[teamId]?.[5]
  if (d == null) return 1
  return 1 + (0.4 * (d - 50)) / 50
}

// ── The effects, as pure functions the rotation can call ─────────────────────

/** Rating points of misranking a coach of this quality introduces. 0 at 100, 5.5 at 0. */
export function rotationNoise(rotation: number): number {
  return 5.5 * (1 - clamp(rotation, 0, 100) / 100)
}

/** Multiplier on the minutes ladder's tilt toward the best men. 1.0 at 50. */
export function tiltFactor(adjust: number): number {
  return 0.75 + (0.5 * clamp(adjust, 0, 100)) / 100
}

/** Multiplier on the condition the engine is handed. 1.0 at 50, 0.97–1.03 across the range. */
export function moraleFactor(morale: number): number {
  return 0.97 + 0.0006 * clamp(morale, 0, 100)
}

/**
 * A deterministic ±1 for one man in one season. The depth chart a bad coach sets is *wrong*, not
 * *random*: he makes the same mistake every night, which is what makes it visible and what keeps
 * it out of the rng (a draw here would desync every save).
 */
export function jitterFor(playerId: string, salt: number): number {
  let h = (salt * 0x9e3779b9) | 0
  for (let i = 0; i < playerId.length; i++) h = (Math.imul(h, 31) + playerId.charCodeAt(i)) | 0
  // A finalising avalanche, or ids that differ only in their last character — "T00-9" and "T00-8",
  // or two sequential generated players — all come out with the same jitter.
  h ^= h >>> 16
  h = Math.imul(h, 0x21f0aaad)
  h ^= h >>> 15
  h = Math.imul(h, 0x735a2d97)
  h ^= h >>> 15
  return ((h >>> 0) % 2001) / 1000 - 1
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * How much a man helps at each end, roughly ±1.2 either way. Written without an array in sight: it
 * is called for every man on both benches of every game, about 700,000 times in a 20-season run.
 */
export function endBias(p: LeaguePlayer): { off: number; def: number } {
  const r = p.ratings
  const off = (r.rim + r.close + r.mid + r.three + r.passing + r.handling) / 6
  const def = (r.perimD + r.interiorD + r.steal + r.block + r.dreb) / 5
  return {
    off: clamp((off - 60) / 12, -1.2, 1.2),
    def: clamp((def - 60) / 12, -1.2, 1.2),
  }
}

/**
 * Depth-chart points a staff adds to one man: a good defensive coach gets his defenders on the
 * floor, a good offensive coach his scorers. ±1.9 per end at the extremes, 0 at 50.
 */
export function staffBias(p: LeaguePlayer, profile: StaffProfile): number {
  const b = endBias(p)
  return 1.6 * (((profile.offense - 50) / 50) * b.off + ((profile.defense - 50) / 50) * b.def)
}

/**
 * What the staff would call for, when the club has set no tactics of its own. A coach who is good
 * enough reads his roster and plays to it; one who is not imposes the way he likes to play, whether
 * or not the men he has can do it. That is the whole difference between a good assistant and a bad
 * one, and it reaches the engine through `Tactics` — nothing else.
 */
export function staffTactics(
  profile: StaffProfile,
  roster: readonly LeaguePlayer[],
  zoneLegal: boolean,
): Tactics {
  const ADAPTIVE = 60
  const pick = (skill: number): -1 | 0 | 1 => (skill >= 62 ? 1 : skill <= 52 ? -1 : 0)
  // One pass, no arrays: this runs twice a game, sixty times a night.
  let three = 0
  let legs = 0
  let hands = 0
  let glass = 0
  for (const p of roster) {
    const r = p.ratings
    three += r.three
    legs += (r.speed + r.stamina) / 2
    hands += (r.steal + r.speed) / 2
    glass += r.oreb
  }
  const n = Math.max(1, roster.length)
  const shooting = three / n
  const pace = legs / n
  const press = hands / n
  const boards = glass / n

  const smartOff = profile.offense >= ADAPTIVE
  const smartDef = profile.defense >= ADAPTIVE
  const scheme = profile.style.scheme
  return {
    pace: smartOff ? pick(pace) : profile.style.pace,
    threes: smartOff ? pick(shooting) : profile.style.threes,
    crashGlass: smartOff ? pick(boards) : 0,
    pressure: smartDef ? pick(press) : scheme === 'press' ? 1 : scheme === 'pack' ? -1 : 0,
    zone: zoneLegal && scheme === 'pack' && profile.defense >= ADAPTIVE,
  }
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * What a coach of this reputation asks for, as a share of the salary cap. Real head coaches earn
 * 3–17% of a cap; assistants a tenth of that. Quadratic in reputation, because the market for the
 * handful of men who have won something is not linear.
 */
export function askingSalary(reputation: number, role: StaffRole, cap: number): number {
  const r = clamp(reputation, 5, 99) / 100
  const share = role === 'head' ? 0.03 + 0.16 * r * r : 0.004 + 0.022 * r * r
  return Math.round((cap * share) / 10_000) * 10_000
}

/** Sacking a man costs every guaranteed dollar left on his deal. */
export function severanceOf(c: Coach): number {
  return c.salary * Math.max(0, c.yearsLeft)
}

// ── Will he take the job? ────────────────────────────────────────────────────

/**
 * How attractive a club is, 0–100: mostly how it has been playing, then what it has won, then the
 * money. A coach with a reputation above a club's appeal will not sign — which is the rule that
 * stops a 30-win team hiring a hall-of-famer the summer after it lost sixty.
 */
export function clubAppeal(state: GameState, teamId: string, salary = 0): number {
  const recent = state.history.slice(-3)
  const pcts: number[] = []
  let deep = 0
  let titles = 0
  for (const h of recent) {
    const row = h.standings?.find((s) => s.teamId === teamId)
    if (row && row.wins + row.losses > 0) pcts.push(row.wins / (row.wins + row.losses))
    if (h.championTeamId === teamId) titles++
    if ((h.rounds?.[teamId] ?? 0) >= 2) deep++
  }
  // Before any season is in the books, this season's record is all there is.
  if (pcts.length === 0) {
    const rec = state.records[teamId]
    if (rec && rec.wins + rec.losses >= 10) pcts.push(rec.wins / (rec.wins + rec.losses))
  }
  const form = pcts.length ? mean(pcts) : 0.5
  const money = state.league.cap.cap > 0 ? salary / state.league.cap.cap : 0
  return clamp(
    Math.round(20 + 70 * form + titles * 9 + deep * 4 + clamp((money / 0.2) * 22, 0, 26)),
    0,
    100,
  )
}

export interface Verdict {
  willing: boolean
  /** Plain words, for the screen. */
  reason: string
}

/**
 * The answer, and why. A man will drop a little below his standing for a job — everyone wants to
 * work — but not far, and the gap he will accept narrows the bigger his name is.
 */
export function joinVerdict(
  state: GameState,
  c: Coach,
  teamId: string,
  role: StaffRole,
  salary: number,
): Verdict {
  const appeal = clubAppeal(state, teamId, salary)
  const team = teamOf(state, teamId)
  const club = team ? `${team.city} ${team.name}` : teamId
  // A big name will stoop this far and no further.
  const slack = 16 - (c.reputation / 100) * 6
  // An assistant's job is an easier sell than the top one.
  const bar = c.reputation - slack - (role === 'head' ? 0 : 6)
  if (appeal >= bar) {
    return {
      willing: true,
      reason:
        appeal >= c.reputation + 6
          ? `He would take it tomorrow: ${club} is a better job than he could expect.`
          : `He will take it. ${club} is about where a man of his standing sits.`,
    }
  }
  const short = Math.round(bar - appeal)
  return {
    willing: false,
    reason:
      `He says no. His standing is ${c.reputation}; ${club} rates ${appeal} as a job, ${short} short of what he will accept. ` +
      (salary > 0 ? 'More money, or a better team, would change that.' : 'More money would help.'),
  }
}

// ── Making coaches ───────────────────────────────────────────────────────────

const FIRST = [
  'Larry',
  'Phil',
  'Gregg',
  'Pat',
  'Doc',
  'Rick',
  'Jerry',
  'Don',
  'Mike',
  'Steve',
  'Erik',
  'Tom',
  'Nate',
  'Dave',
  'Byron',
  'Scott',
  'Frank',
  'Terry',
  'Stan',
  'Alvin',
  'Lionel',
  'Maurice',
  'Sam',
  'Kevin',
  'Brian',
  'Chris',
  'Monty',
  'Quin',
  'Taylor',
  'Willie',
  'Dwane',
  'Nick',
  'Jason',
  'Tyronn',
  'Billy',
  'Luke',
  'Fred',
  'Wes',
  'Darvin',
  'Ime',
  'Chauncey',
  'Adrian',
  'Charles',
  'Vincent',
  'Elston',
  'Marcus',
  'Reggie',
  'Curtis',
  'Emanuel',
  'Hal',
  'Ron',
  'Joe',
  'Bob',
  'Art',
  'Gene',
  'Milt',
  'Dean',
  'Roy',
  'Walt',
  'Cliff',
]

const LAST = [
  'Carlisle',
  'Thibodeau',
  'Van Gundy',
  'Popovich',
  'Karl',
  'Sloan',
  'Nelson',
  'Adelman',
  'Brown',
  'Riley',
  'Jackson',
  'Rivers',
  'Casey',
  'Stotts',
  'Budenholzer',
  'Malone',
  'Snyder',
  'Vogel',
  'Clifford',
  'Donovan',
  'Kerr',
  'Spoelstra',
  'Stevens',
  'Lue',
  'Nurse',
  'Atkinson',
  'Finch',
  'Mosley',
  'Hardy',
  'Udoka',
  'Borrego',
  'Griffin',
  'Prunty',
  'Kokoskov',
  'Bickerstaff',
  'Dorsey',
  'Weaver',
  'Quinn',
  'Larranaga',
  'Ollie',
  'Bzdelik',
  'Hollins',
  'Cheeks',
  'Ewing',
  'Gentry',
  'Hornacek',
  'Jordan',
  'Kidd',
  'Laimbeer',
  'McMillan',
  'Mullin',
  'Porter',
  'Saunders',
  'Silas',
  'Skiles',
  'Tomjanovich',
  'Unseld',
  'Westphal',
  'Woodson',
  'Young',
  'Dantoni',
  'Fratello',
  'Musselman',
  'Pitino',
  'Calipari',
  'Wright',
  'Beilein',
  'Boeheim',
  'Izzo',
  'Self',
]

function makeName(staff: StaffState, rng: Rng): string {
  const taken = new Set(Object.values(staff.coaches).map((l) => l.split('|')[0]))
  for (let i = 0; i < 40; i++) {
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`
    if (!taken.has(name)) return name
  }
  return `${rng.pick(FIRST)} ${rng.pick(LAST)} Jr.`
}

function newId(staff: StaffState): string {
  staff.nextId += 1
  return `c${staff.nextId}`
}

function randomStyle(rng: Rng): CoachStyle {
  const three = (): -1 | 0 | 1 => rng.pick([-1, 0, 0, 1]) as -1 | 0 | 1
  return { pace: three(), threes: three(), scheme: rng.pick(SCHEMES) }
}

function makeRatings(rng: Rng, base: number, role: StaffRole): CoachRatings {
  const r = {} as CoachRatings
  for (const k of RATING_ORDER) r[k] = Math.round(clamp(base + rng.normal(0, 9), 5, 99))
  const lift = Math.round(clamp(rng.normal(9, 4), 2, 18))
  const keys: (keyof CoachRatings)[] =
    role === 'head'
      ? ['rotation', 'adjust', 'morale']
      : role === 'offense'
        ? ['offense']
        : role === 'defense'
          ? ['defense']
          : role === 'development'
            ? ['development']
            : ['scouting']
  for (const k of keys) r[k] = Math.round(clamp(r[k] + lift, 5, 99))
  return r
}

function reputationFrom(c: Omit<Coach, 'reputation'>, fame = 0): number {
  const key = roleRatingOf({ ...c, reputation: 50 } as Coach, c.role)
  const all = mean(RATING_ORDER.map((k) => c.ratings[k]))
  return Math.round(clamp(0.62 * key + 0.2 * all + fame + c.titles * 5, 5, 99))
}

/** A coach out of nowhere: a college job, an overseas job, twenty years as somebody's number two. */
export function makeCoach(staff: StaffState, rng: Rng, role?: StaffRole): Coach {
  const r = role ?? rng.pick(STAFF_ROLES)
  const base = clamp(rng.normal(50, 15), 12, 92)
  const ratings = makeRatings(rng, base, r)
  const age = 34 + rng.int(28)
  const seasons = Math.max(0, Math.min(age - 32, rng.int(14)))
  const draft: Omit<Coach, 'reputation'> = {
    coachId: newId(staff),
    name: makeName(staff, rng),
    role: r,
    age,
    playerId: null,
    background: seasons >= 6 ? `${seasons} seasons on a bench` : 'College and the G League',
    hallOfFamer: false,
    seasons,
    record: { w: 0, l: 0 },
    titles: 0,
    teamId: null,
    salary: 0,
    yearsLeft: 0,
    ratings,
    style: randomStyle(rng),
  }
  return { ...draft, reputation: reputationFrom(draft) }
}

const thousands = (n: number): string => Math.round(n).toLocaleString('en-US')

/**
 * A player who has just hung them up, walking back through the door with a clipboard.
 *
 * What he was decides what he is good at, which is the part that makes this worth building: a
 * pass-first guard with a high basketball IQ becomes an offensive coach, a shot-blocking centre a
 * defensive one, a long-serving journeyman the man the kids work with, and a star with trophies is
 * handed a team of his own. A hall-of-famer walks in with a reputation nobody else in the pool has.
 */
export function coachFromCareer(staff: StaffState, c: Career, rng: Rng): Coach {
  const t = totalsOf(c.seasons)
  const gp = Math.max(1, t.gp)
  const astPg = t.ast / gp
  const blkPg = t.blk / gp
  const rebPg = t.reb / gp
  const stlPg = t.stl / gp
  const ptsPg = t.pts / gp
  const star = t.mvps > 0 || t.allNba >= 3
  // How long he actually played, not how much of it this save watched. A man who retires in the
  // third season of a dynasty has a career line three seasons long and fifteen years of football
  // behind it; `debutYear` is the only place that shows.
  const years = Math.max(t.seasons, c.retiredYear - c.debutYear)
  // With only a season or two on file the per-game rates are noise, so position carries it: a guard
  // teaches the offence, a big man the defence. Otherwise what he did decides.
  const thin = t.gp < 200
  const guard = c.pos === 'PG' || c.pos === 'SG'
  const big = c.pos === 'C' || c.pos === 'PF'

  // What he did on the floor is what he will teach.
  const role: StaffRole = star
    ? 'head'
    : astPg >= 4.5 || (ptsPg >= 16 && astPg >= 3) || (thin && guard)
      ? 'offense'
      : blkPg >= 1.0 || rebPg >= 7.5 || t.dpoys > 0 || (thin && big)
        ? 'defense'
        : years >= 10
          ? 'development'
          : 'scout'

  const hof = hofScore(c) >= HOF_THRESHOLD
  // A playing career is not coaching ability, but it is a head start: he has seen the thing done
  // properly for fifteen years. A modest lift, wider for the men who thought the game through.
  const base = clamp(46 + Math.min(12, years * 0.7) + rng.normal(0, 12), 15, 92)
  const ratings = makeRatings(rng, base, role)
  // The specific things a career actually teaches.
  ratings.offense = Math.round(clamp(ratings.offense + Math.min(10, astPg * 1.6), 5, 99))
  ratings.defense = Math.round(
    clamp(ratings.defense + Math.min(10, blkPg * 4 + stlPg * 3 + t.dpoys * 3), 5, 99),
  )
  ratings.morale = Math.round(clamp(ratings.morale + (t.titles > 0 ? 6 : 0), 5, 99))
  ratings.rotation = Math.round(clamp(ratings.rotation + (star ? 5 : 0), 5, 99))

  // Fame is not skill, but it is what gets him interviewed, and it is what the market pays for.
  const fame = clamp(
    t.mvps * 7 + t.allNba * 2.5 + t.titles * 2 + t.pts / 2800 + years * 0.4 + (hof ? 14 : 0),
    0,
    36,
  )

  const honours: string[] = []
  if (t.mvps) honours.push(`${t.mvps} MVP${t.mvps === 1 ? '' : 's'}`)
  if (t.allNba) honours.push(`${t.allNba} All-NBA`)
  if (t.titles) honours.push(`${t.titles} title${t.titles === 1 ? '' : 's'}`)
  // Say only what is true. The career store starts when the save does, so for a man who was already
  // playing on opening night the games and points are what this league saw, not what he did.
  const line =
    years > t.seasons
      ? `${years} seasons in the league · ${thousands(t.gp)} games and ${thousands(t.pts)} points of them under your watch`
      : `${years} season${years === 1 ? '' : 's'}, ${thousands(t.gp)} games, ${thousands(t.pts)} points`
  const background =
    (hof ? 'Hall of Famer. ' : '') + line + (honours.length ? ` · ${honours.join(', ')}` : '')

  const draft: Omit<Coach, 'reputation'> = {
    coachId: newId(staff),
    name: c.name,
    role,
    age: (c.seasons[c.seasons.length - 1]?.age ?? 34) + 2,
    playerId: c.playerId,
    background,
    hallOfFamer: hof,
    seasons: 0,
    record: { w: 0, l: 0 },
    titles: 0,
    teamId: null,
    salary: 0,
    yearsLeft: 0,
    ratings,
    style: randomStyle(rng),
  }
  return { ...draft, reputation: reputationFrom(draft, fame) }
}

// ── Setting the league up ────────────────────────────────────────────────────

/** How many men sit in the pool between summers. Enough to choose from, few enough to read. */
export const POOL_SIZE = 30

export function emptyStaff(): StaffState {
  return { coaches: {}, byTeam: {}, profiles: {}, pool: [], deadMoney: {}, nextId: 0 }
}

/** Give every club a staff and fill the pool. Idempotent: a save that has one keeps it. */
export function initStaff(state: GameState, rng: Rng): StaffState {
  if (state.staff) return state.staff
  const staff = emptyStaff()
  state.staff = staff
  const cap = state.league.cap.cap
  for (const team of state.league.teams) {
    const ids: string[] = []
    for (const role of STAFF_ROLES) {
      const c = makeCoach(staff, rng, role)
      c.teamId = team.teamId
      c.salary = askingSalary(c.reputation, role, cap)
      c.yearsLeft = 1 + rng.int(4)
      putCoach(staff, c)
      ids.push(c.coachId)
    }
    setSlots(staff, team.teamId, ids)
    rebuildProfile(staff, team.teamId)
    staff.deadMoney[team.teamId] = 0
  }
  for (let i = 0; i < POOL_SIZE; i++) {
    const c = makeCoach(staff, rng)
    putCoach(staff, c)
    staff.pool.push(c.coachId)
  }
  sortPool(state)
  return staff
}

/** The pool a save may not have. Never creates one during a game: callers hold the rng. */
export function staffOf(state: GameState): StaffState | null {
  return state.staff ?? null
}

function sortPool(state: GameState): void {
  const staff = state.staff
  if (!staff) return
  const rep = new Map(
    staff.pool.map((id) => [id, Number(staff.coaches[id]?.split('|')[6] ?? 0)] as const),
  )
  staff.pool.sort((a, b) => (rep.get(b) ?? 0) - (rep.get(a) ?? 0))
}

// ── Hiring and firing ────────────────────────────────────────────────────────

export interface HireResult {
  ok: boolean
  reason: string
  /** What it will cost per year. */
  salary: number
  years: number
}

/**
 * Put a man in a chair. Refuses when the chair is taken, when he is already under contract
 * somewhere, or when he will not have you.
 */
export function hireCoach(
  state: GameState,
  teamId: string,
  coachId: string,
  role: StaffRole,
  years: number,
  offer?: number,
): HireResult {
  const staff = state.staff
  if (!staff) return { ok: false, reason: 'This save has no staff.', salary: 0, years: 0 }
  const c = coachOf(state, coachId)
  if (!c) return { ok: false, reason: 'No such coach.', salary: 0, years: 0 }
  if (c.teamId)
    return {
      ok: false,
      reason: `${c.name} is under contract elsewhere. You would have to wait for his deal to run out.`,
      salary: 0,
      years: 0,
    }
  const slots = slotsOf(staff, teamId)
  const idx = STAFF_ROLES.indexOf(role)
  if (slots[idx])
    return {
      ok: false,
      reason: `You already have a ${ROLE_LABEL[role].toLowerCase()}. Sack him first — and pay him off.`,
      salary: 0,
      years: 0,
    }
  const ask = askingSalary(c.reputation, role, state.league.cap.cap)
  const salary = Math.max(ask, Math.round(offer ?? 0))
  const term = clamp(Math.round(years), 1, 5)
  const verdict = joinVerdict(state, c, teamId, role, salary)
  if (!verdict.willing) return { ok: false, reason: verdict.reason, salary, years: term }

  c.teamId = teamId
  c.salary = salary
  c.yearsLeft = term
  putCoach(staff, c)
  slots[idx] = coachId
  setSlots(staff, teamId, slots)
  staff.pool = staff.pool.filter((id) => id !== coachId)
  rebuildProfile(staff, teamId)
  return {
    ok: true,
    reason: `${c.name} signs as ${ROLE_LABEL[role].toLowerCase()} for ${term} year${term === 1 ? '' : 's'} at $${(salary / 1_000_000).toFixed(2)}M.`,
    salary,
    years: term,
  }
}

export interface FireResult {
  ok: boolean
  reason: string
  /** The pay-off, in dollars. */
  cost: number
}

/** Sack a man. He is paid off in full and goes straight back into the pool. */
export function fireCoach(state: GameState, teamId: string, role: StaffRole): FireResult {
  const staff = state.staff
  if (!staff) return { ok: false, reason: 'This save has no staff.', cost: 0 }
  const slots = slotsOf(staff, teamId)
  const idx = STAFF_ROLES.indexOf(role)
  const id = slots[idx]
  if (!id) return { ok: false, reason: 'Nobody holds that job.', cost: 0 }
  const c = coachOf(state, id)
  if (!c) return { ok: false, reason: 'Nobody holds that job.', cost: 0 }
  const cost = severanceOf(c)
  const owed = c.yearsLeft
  c.teamId = null
  c.salary = 0
  c.yearsLeft = 0
  putCoach(staff, c)
  slots[idx] = null
  setSlots(staff, teamId, slots)
  if (!staff.pool.includes(id)) staff.pool.push(id)
  sortPool(state)
  staff.deadMoney[teamId] = (staff.deadMoney[teamId] ?? 0) + cost
  rebuildProfile(staff, teamId)
  return {
    ok: true,
    reason:
      cost > 0
        ? `${c.name} is sacked. The ${owed} guaranteed year${owed === 1 ? '' : 's'} left on his deal cost you $${(cost / 1_000_000).toFixed(2)}M, and he is free to join anyone.`
        : `${c.name} is sacked. His deal was up anyway, so it costs you nothing.`,
    cost,
  }
}

// ── The carousel ─────────────────────────────────────────────────────────────

/** A club this bad, this long, sacks its head coach. */
const SACK_PCT = 0.34
/** A club this mediocre does not renew an expiring deal. */
const RENEW_PCT = 0.44

function winPctOf(state: GameState, teamId: string): number {
  const rec = state.records[teamId]
  if (!rec || rec.wins + rec.losses === 0) return 0.5
  return rec.wins / (rec.wins + rec.losses)
}

/** Rank the pool for one job at one club: ability first, and he has to be willing. */
function bestCandidate(
  state: GameState,
  teamId: string,
  role: StaffRole,
): { coach: Coach; salary: number } | null {
  const staff = state.staff
  if (!staff) return null
  const cap = state.league.cap.cap
  let best: { coach: Coach; salary: number; score: number } | null = null
  for (const id of staff.pool) {
    const c = coachOf(state, id)
    if (!c || c.teamId) continue
    const salary = askingSalary(c.reputation, role, cap)
    if (!joinVerdict(state, c, teamId, role, salary).willing) continue
    const score = roleRatingOf(c, role) + (c.role === role ? 6 : 0)
    if (!best || score > best.score) best = { coach: c, salary, score }
  }
  return best ? { coach: best.coach, salary: best.salary } : null
}

/**
 * One summer of the coaching carousel, run for the whole league. This is the thing that makes a
 * staff feel like a league rather than a menu: a man you sack in July turns up in a rival's chair
 * in August, and the coach of a 20-win team spends his winter reading his own obituary.
 *
 * The user's own staff is never touched. He is the one who does the sacking.
 */
export function runCarousel(state: GameState, rng: Rng): string[] {
  const staff = state.staff
  if (!staff) return []
  const news: string[] = []
  const cap = state.league.cap.cap
  const nameOf = (teamId: string) => {
    const t = teamOf(state, teamId)
    return t ? `${t.city} ${t.name}` : teamId
  }

  // 1. The season that just finished goes on the head coach's record, and everyone ages a year.
  for (const team of state.league.teams) {
    const slots = slotsOf(staff, team.teamId)
    const headId = slots[0]
    if (!headId) continue
    const c = coachOf(state, headId)
    if (!c) continue
    const rec = state.records[team.teamId]
    if (rec) {
      c.record.w += rec.wins
      c.record.l += rec.losses
    }
    const last = state.history[state.history.length - 1]
    if (last?.championTeamId === team.teamId) c.titles += 1
    putCoach(staff, c)
  }
  for (const [id, line] of Object.entries(staff.coaches)) {
    const c = unpackCoach(id, line)
    c.age += 1
    if (c.teamId) {
      c.seasons += 1
      c.yearsLeft = Math.max(0, c.yearsLeft - 1)
    }
    putCoach(staff, c)
  }

  // 2. Who gets moved on. Contracts that have run out, and men whose clubs have had enough.
  for (const team of state.league.teams) {
    const teamId = team.teamId
    const isUser = teamId === state.userTeamId
    const slots = slotsOf(staff, teamId)
    let changed = false
    for (const [i, role] of STAFF_ROLES.entries()) {
      const id = slots[i]
      if (!id) continue
      const c = coachOf(state, id)
      if (!c) continue
      const pct = winPctOf(state, teamId)
      const champion = state.history[state.history.length - 1]?.championTeamId === teamId
      let out = false
      let why = ''
      if (c.yearsLeft <= 0) {
        // An expiring deal is renewed when the work has been good enough.
        const keep = champion || pct >= RENEW_PCT || c.role !== 'head'
        if (keep && (isUser || rng.chance(0.85))) {
          c.yearsLeft = 2 + rng.int(3)
          c.salary = askingSalary(c.reputation, role, cap)
          putCoach(staff, c)
          continue
        }
        out = true
        why = 'his contract was not renewed'
      } else if (!isUser && role === 'head' && !champion && pct < SACK_PCT && c.seasons >= 2) {
        // Under pressure all year, and the board runs out of patience in the summer.
        if (rng.chance(0.75)) {
          out = true
          why = `${Math.round(pct * 100)}% of his games was not enough`
        }
      }
      if (!out) continue
      c.teamId = null
      c.salary = 0
      c.yearsLeft = 0
      putCoach(staff, c)
      slots[i] = null
      if (!staff.pool.includes(id)) staff.pool.push(id)
      changed = true
      if (role === 'head')
        news.push(
          `${nameOf(teamId)} part company with ${c.name}: ${why} (${c.record.w}-${c.record.l}).`,
        )
    }
    if (changed) {
      setSlots(staff, teamId, slots)
      rebuildProfile(staff, teamId)
    }
  }

  // 3. Top the pool back up, then fill every vacancy in the league bar the user's.
  sortPool(state)
  while (staff.pool.length < POOL_SIZE) {
    const c = makeCoach(staff, rng)
    putCoach(staff, c)
    staff.pool.push(c.coachId)
  }
  // The best jobs are filled first, which is why a good coach rarely ends up at a bad club.
  const hiring = state.league.teams
    .filter((t) => t.teamId !== state.userTeamId)
    .sort((a, b) => clubAppeal(state, b.teamId) - clubAppeal(state, a.teamId))
  for (const team of hiring) {
    const slots = slotsOf(staff, team.teamId)
    for (const [i, role] of STAFF_ROLES.entries()) {
      if (slots[i]) continue
      const found = bestCandidate(state, team.teamId, role)
      if (!found) continue
      const years = role === 'head' ? 3 + rng.int(2) : 2 + rng.int(2)
      const res = hireCoach(state, team.teamId, found.coach.coachId, role, years, found.salary)
      if (res.ok && role === 'head')
        news.push(
          `${nameOf(team.teamId)} hire ${found.coach.name} as head coach${found.coach.hallOfFamer ? ', a hall-of-famer taking his first job' : ''}.`,
        )
      // hireCoach rewrote the slots; re-read them.
      slots.splice(0, slots.length, ...slotsOf(staff, team.teamId))
    }
  }

  // 4. The men who are simply too old for it.
  for (const id of [...staff.pool]) {
    const c = coachOf(state, id)
    if (!c) continue
    if (c.age >= 68 && rng.chance(0.5)) {
      staff.pool = staff.pool.filter((x) => x !== id)
      delete staff.coaches[id]
    }
  }
  // Anyone left over at the bottom of a long pool goes back to college.
  sortPool(state)
  if (staff.pool.length > POOL_SIZE + 12) {
    for (const id of staff.pool.slice(POOL_SIZE + 12)) delete staff.coaches[id]
    staff.pool = staff.pool.slice(0, POOL_SIZE + 12)
  }
  return news
}

/** How likely a retired player is to turn up in the pool. A great one nearly always does. */
export function coachingChance(c: Career): number {
  if (hofScore(c) >= HOF_THRESHOLD) return 0.75
  if (isNotable(c)) return 0.3
  return 0.05
}

/**
 * The summer's whole staff step: former players into the pool, then the carousel. Called from
 * `rolloverBegin` so the CLI, the headless run and the web app all get the same league.
 */
export function staffOffseason(state: GameState, rng: Rng, retired: readonly Career[]): void {
  const staff = initStaff(state, rng)
  for (const career of retired) {
    if (!rng.chance(coachingChance(career))) continue
    const c = coachFromCareer(staff, career, rng)
    putCoach(staff, c)
    staff.pool.push(c.coachId)
    pushLog(state, {
      date: state.calendar.date,
      yearEnd: state.season.yearEnd,
      kind: 'note',
      text: `${c.name} is going into coaching. He enters the market as ${ROLE_LABEL[c.role].toLowerCase()} material${c.hallOfFamer ? ', and a hall-of-famer is a draw' : ''}.`,
    })
  }
  for (const text of runCarousel(state, rng))
    pushLog(state, {
      date: state.calendar.date,
      yearEnd: state.season.yearEnd,
      kind: 'note',
      text,
    })
}
