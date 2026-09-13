/**
 * The league's memory: every season a player ever played, the records he set, and the hall he
 * ends up in. Nothing in here is ever thrown away, so a name you remember in year 30 can still be
 * looked up in year 1.
 *
 * WHY THE CAREER STORE IS A BAG OF STRINGS
 * Every reducer `structuredClone`s the whole save, once per simulated day — about 5,000 times in a
 * 30-season run. Cloning is dominated by the *number of objects*, not their size: 15,000 small
 * objects cost 13 ms a clone, the same data as 15,000 strings costs 0.3 ms, and one string per
 * player (a few thousand) costs nothing measurable. So a career lives packed:
 *
 *     name|pos|debutYear|retiredYear|draftYear:round:pick;season;season;…
 *
 * with each season a comma-separated fixed-order row. It is decoded only when something asks a
 * question of it, which is never in the hot loop.
 */

import type { HistoryBundle, Position, YearEnd } from '@hoops/core'
import type { GameState, SeasonAwards, SeasonSummary } from './state.ts'
import { pushLog, teamOf } from './state.ts'

// ── What one season of a career holds ────────────────────────────────────────

/** Badges on a season, packed into one integer so a season stays one short row. */
export const FLAG = {
  champion: 1,
  playoffs: 2,
  mvp: 4,
  roy: 8,
  dpoy: 16,
  allNba1: 32,
  allNba2: 64,
  allNba3: 128,
} as const

export type FlagName = keyof typeof FLAG

export const ALL_NBA_FLAGS = FLAG.allNba1 | FLAG.allNba2 | FLAG.allNba3

export interface CareerSeason {
  yearEnd: YearEnd
  teamId: string
  age: number
  gp: number
  gs: number
  min: number
  pts: number
  fgm: number
  fga: number
  fg3m: number
  fg3a: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  ast: number
  stl: number
  blk: number
  tov: number
  pf: number
  flags: number
}

export interface Career {
  playerId: string
  name: string
  pos: string
  debutYear: YearEnd
  /** 0 while he is still playing. */
  retiredYear: number
  draft: { year: number; round: number; pick: number } | null
  seasons: CareerSeason[]
}

/** The counting stats, summed. Everything the record book and the career page rank on. */
export interface CareerTotals {
  seasons: number
  gp: number
  gs: number
  min: number
  pts: number
  fgm: number
  fga: number
  fg3m: number
  fg3a: number
  ftm: number
  fta: number
  reb: number
  oreb: number
  dreb: number
  ast: number
  stl: number
  blk: number
  tov: number
  titles: number
  mvps: number
  allNba: number
  roys: number
  dpoys: number
  /** Teams he played for, in the order he first appeared for them. */
  teams: string[]
}

// ── Packing ──────────────────────────────────────────────────────────────────

/** The separators are structural, so they can never appear inside a field. */
const clean = (s: string): string => s.replace(/[|;,]/g, ' ')

const SEASON_FIELDS = [
  'yearEnd',
  'teamId',
  'age',
  'gp',
  'gs',
  'min',
  'pts',
  'fgm',
  'fga',
  'fg3m',
  'fg3a',
  'ftm',
  'fta',
  'oreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'tov',
  'pf',
  'flags',
] as const

function packSeason(s: CareerSeason): string {
  const out: (string | number)[] = []
  for (const f of SEASON_FIELDS) {
    const v = s[f]
    out.push(typeof v === 'number' ? Math.round(v) : v)
  }
  return out.join(',')
}

function unpackSeason(row: string): CareerSeason | null {
  const parts = row.split(',')
  if (parts.length < SEASON_FIELDS.length) return null
  const num = (i: number) => Number(parts[i]) || 0
  return {
    yearEnd: num(0),
    teamId: parts[1] ?? '',
    age: num(2),
    gp: num(3),
    gs: num(4),
    min: num(5),
    pts: num(6),
    fgm: num(7),
    fga: num(8),
    fg3m: num(9),
    fg3a: num(10),
    ftm: num(11),
    fta: num(12),
    oreb: num(13),
    dreb: num(14),
    ast: num(15),
    stl: num(16),
    blk: num(17),
    tov: num(18),
    pf: num(19),
    flags: num(20),
  }
}

export function encodeCareer(c: Career): string {
  const d = c.draft ? `${c.draft.year}:${c.draft.round}:${c.draft.pick}` : ''
  const head = [clean(c.name), c.pos, c.debutYear, c.retiredYear, d].join('|')
  return [head, ...c.seasons.map(packSeason)].join(';')
}

export function decodeCareer(playerId: string, packed: string): Career {
  const [head = '', ...rows] = packed.split(';')
  const [name = playerId, pos = 'SF', debut = '0', retired = '0', draft = ''] = head.split('|')
  const d = draft ? draft.split(':').map(Number) : null
  return {
    playerId,
    name,
    pos,
    debutYear: Number(debut) || 0,
    retiredYear: Number(retired) || 0,
    draft:
      d && d.length === 3
        ? { year: d[0] as number, round: d[1] as number, pick: d[2] as number }
        : null,
    seasons: rows.map(unpackSeason).filter((s): s is CareerSeason => s !== null),
  }
}

// ── Reading the store ────────────────────────────────────────────────────────

export function careerOf(state: GameState, playerId: string): Career | null {
  const packed = state.careers?.[playerId]
  return packed ? decodeCareer(playerId, packed) : null
}

export function allCareers(state: GameState): Career[] {
  return Object.entries(state.careers ?? {}).map(([id, packed]) => decodeCareer(id, packed))
}

export function emptyTotals(): CareerTotals {
  return {
    seasons: 0,
    gp: 0,
    gs: 0,
    min: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fg3a: 0,
    ftm: 0,
    fta: 0,
    reb: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    titles: 0,
    mvps: 0,
    allNba: 0,
    roys: 0,
    dpoys: 0,
    teams: [],
  }
}

/** Sum a run of seasons. Pass a filter first to get a player's numbers for one club. */
export function totalsOf(seasons: readonly CareerSeason[]): CareerTotals {
  const t = emptyTotals()
  for (const s of seasons) {
    t.seasons++
    t.gp += s.gp
    t.gs += s.gs
    t.min += s.min
    t.pts += s.pts
    t.fgm += s.fgm
    t.fga += s.fga
    t.fg3m += s.fg3m
    t.fg3a += s.fg3a
    t.ftm += s.ftm
    t.fta += s.fta
    t.oreb += s.oreb
    t.dreb += s.dreb
    t.reb += s.oreb + s.dreb
    t.ast += s.ast
    t.stl += s.stl
    t.blk += s.blk
    t.tov += s.tov
    if (s.flags & FLAG.champion) t.titles++
    if (s.flags & FLAG.mvp) t.mvps++
    if (s.flags & ALL_NBA_FLAGS) t.allNba++
    if (s.flags & FLAG.roy) t.roys++
    if (s.flags & FLAG.dpoy) t.dpoys++
    if (s.teamId && !t.teams.includes(s.teamId)) t.teams.push(s.teamId)
  }
  return t
}

/** His best season by points per game, which is what people mean by "his peak". */
export function peakSeason(seasons: readonly CareerSeason[]): CareerSeason | null {
  let best: CareerSeason | null = null
  let bestPpg = -1
  for (const s of seasons) {
    if (s.gp < 20) continue
    const ppg = s.pts / s.gp
    if (ppg > bestPpg) {
      bestPpg = ppg
      best = s
    }
  }
  return best ?? seasons[0] ?? null
}

/** True when every season he ever played was for the same club. The one thing people cherish. */
export function isOneClubMan(c: Career): boolean {
  const teams = new Set(c.seasons.map((s) => s.teamId).filter(Boolean))
  return teams.size === 1 && c.seasons.length >= 3
}

// ── Writing the store ────────────────────────────────────────────────────────

/** Which awards a player picked up in the season being closed. */
function flagsFor(playerId: string, teamId: string, state: GameState): number {
  let flags = 0
  const po = state.playoffs
  if (po) {
    if (po.championTeamId === teamId) flags |= FLAG.champion
    const field = [...po.seeds.East, ...po.seeds.West]
    if (field.includes(teamId)) flags |= FLAG.playoffs
  }
  const a: SeasonAwards | null = state.awards
  if (a) {
    if (a.mvp?.playerId === playerId) flags |= FLAG.mvp
    if (a.roy?.playerId === playerId) flags |= FLAG.roy
    if (a.dpoy?.playerId === playerId) flags |= FLAG.dpoy
    const tiers = [FLAG.allNba1, FLAG.allNba2, FLAG.allNba3]
    a.allNba.forEach((team, i) => {
      if (team.some((w) => w.playerId === playerId)) flags |= tiers[i] ?? FLAG.allNba3
    })
  }
  return flags
}

/**
 * Write one season line for everyone who played. Called once, at the top of the rollover, before
 * ages move and before anybody retires — so the age on the line is the age he played at.
 */
export function recordSeason(state: GameState): void {
  state.careers ??= {}
  const store = state.careers
  const byId = new Map(state.league.players.map((p) => [p.playerId, p]))
  const yearEnd = state.season.yearEnd

  for (const [playerId, line] of Object.entries(state.stats)) {
    if (line.gp <= 0) continue
    const p = byId.get(playerId)
    const packed = store[playerId]
    const career: Career = packed
      ? decodeCareer(playerId, packed)
      : {
          playerId,
          name: p?.name ?? playerId,
          pos: (p?.pos ?? 'SF') as Position,
          debutYear: p?.debutYear ?? yearEnd,
          retiredYear: 0,
          draft: p?.draft ?? null,
          seasons: [],
        }
    // A season is written once. Re-closing a season that is already in the book must not double it.
    if (career.seasons.some((s) => s.yearEnd === yearEnd)) continue
    career.seasons.push({
      yearEnd,
      teamId: line.teamId,
      age: p?.age ?? 0,
      gp: line.gp,
      gs: line.gs,
      min: line.min,
      pts: line.pts,
      fgm: line.fgm,
      fga: line.fga,
      fg3m: line.fg3m,
      fg3a: line.fg3a,
      ftm: line.ftm,
      fta: line.fta,
      oreb: line.oreb,
      dreb: line.dreb,
      ast: line.ast,
      stl: line.stl,
      blk: line.blk,
      tov: line.tov,
      pf: line.pf,
      flags: flagsFor(playerId, line.teamId, state),
    })
    store[playerId] = encodeCareer(career)
  }
}

/** Awards and series results from the real world, packed the same way a simulated season is. */
export function flagsFromHistory(
  playerId: string,
  teamId: string,
  yearEnd: YearEnd,
  history: HistoryBundle,
): number {
  const season = history.seasons[yearEnd]
  if (!season) return 0
  let flags = 0
  if (season.champion === teamId) flags |= FLAG.champion
  if (season.playoffs.some((s) => s.highTeamId === teamId || s.lowTeamId === teamId))
    flags |= FLAG.playoffs
  for (const a of season.awards) {
    if (a.playerId !== playerId) continue
    if (a.award === 'MVP') flags |= FLAG.mvp
    else if (a.award === 'ROY') flags |= FLAG.roy
    else if (a.award === 'DPOY') flags |= FLAG.dpoy
    else if (a.award === 'All-NBA') {
      if (a.teamRank === 1) flags |= FLAG.allNba1
      else if (a.teamRank === 2) flags |= FLAG.allNba2
      else flags |= FLAG.allNba3
    }
  }
  return flags
}

/**
 * Opening night should already know what everyone did before you arrived. Without this the career
 * page is empty until the first rollover, years in the league is a number with no rows behind it,
 * and a farewell letter has nothing to say.
 */
export function seedPriorCareers(state: GameState, history: HistoryBundle): void {
  const yearEnd = state.season.yearEnd
  const byId = new Map(history.careers.map((c) => [c.playerId, c]))
  state.careers ??= {}
  for (const p of state.league.players) {
    const arc = byId.get(p.playerId)
    if (!arc) continue
    const prior = arc.seasons.filter((s) => s.yearEnd < yearEnd && s.gp > 0)
    if (!prior.length) continue
    const seasons: CareerSeason[] = prior.map((s) => {
      const box = s.box
      return {
        yearEnd: s.yearEnd,
        teamId: s.teamId,
        age: s.age,
        gp: s.gp,
        gs: box?.gs ?? 0,
        min: box?.min ?? s.mpg * s.gp,
        pts: box?.pts ?? 0,
        fgm: box?.fgm ?? 0,
        fga: box?.fga ?? 0,
        fg3m: box?.fg3m ?? 0,
        fg3a: box?.fg3a ?? 0,
        ftm: box?.ftm ?? 0,
        fta: box?.fta ?? 0,
        oreb: box?.oreb ?? 0,
        dreb: box?.dreb ?? 0,
        ast: box?.ast ?? 0,
        stl: box?.stl ?? 0,
        blk: box?.blk ?? 0,
        tov: box?.tov ?? 0,
        pf: box?.pf ?? 0,
        flags: flagsFromHistory(p.playerId, s.teamId, s.yearEnd, history),
      }
    })
    state.careers[p.playerId] = encodeCareer({
      playerId: p.playerId,
      name: p.name,
      pos: p.pos,
      debutYear: Math.min(p.debutYear || yearEnd, seasons[0]?.yearEnd ?? yearEnd),
      retiredYear: 0,
      draft: p.draft,
      seasons,
    })
  }
}

/** Stamp a career closed. Returns the finished career, or null if the man never played a game. */
export function markRetired(state: GameState, playerId: string, yearEnd: number): Career | null {
  const c = careerOf(state, playerId)
  if (!c || c.seasons.length === 0) return null
  c.retiredYear = yearEnd
  ;(state.careers as Record<string, string>)[playerId] = encodeCareer(c)
  return c
}

// ── The record book ──────────────────────────────────────────────────────────

export const GAME_RECORDS = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg3m'] as const
export type GameRecordKey = (typeof GAME_RECORDS)[number]

export interface GameRecord {
  playerId: string
  name: string
  value: number
  teamId: string
  opponentTeamId: string
  date: string
  yearEnd: YearEnd
  /** True when it was set in the playoffs. */
  playoffs: boolean
}

export interface StatRecord {
  playerId: string
  name: string
  value: number
  teamId: string
  yearEnd: YearEnd
}

export interface LeagueRecords {
  game: Partial<Record<GameRecordKey, GameRecord>>
  /** Best single season, by total. */
  season: Partial<Record<GameRecordKey | 'min', StatRecord[]>>
  /** Career leaders, best first. */
  career: Partial<Record<GameRecordKey | 'gp' | 'min', StatRecord[]>>
}

const gameValue = (
  key: GameRecordKey,
  line: {
    pts: number
    oreb: number
    dreb: number
    ast: number
    stl: number
    blk: number
    fg3m: number
  },
): number =>
  key === 'reb' ? line.oreb + line.dreb : (line[key as Exclude<GameRecordKey, 'reb'>] as number)

/**
 * Check one finished box score against the single-game book. Six comparisons a man: cheap enough
 * to run on every line of every game, which is the only way a single-game record can be true.
 */
export function noteGameRecords(
  state: GameState,
  players: readonly {
    playerId: string
    name: string
    pts: number
    oreb: number
    dreb: number
    ast: number
    stl: number
    blk: number
    fg3m: number
  }[],
  teamId: string,
  opponentTeamId: string,
  date: string,
  playoffs: boolean,
): void {
  state.gameRecords ??= {}
  const book = state.gameRecords
  for (const p of players) {
    for (const key of GAME_RECORDS) {
      const v = gameValue(key, p)
      const held = book[key]
      if (held && held.value >= v) continue
      book[key] = {
        playerId: p.playerId,
        name: p.name,
        value: v,
        teamId,
        opponentTeamId,
        date,
        yearEnd: state.season.yearEnd,
        playoffs,
      }
    }
  }
}

const seasonValue = (key: GameRecordKey | 'min', s: CareerSeason): number =>
  key === 'reb' ? s.oreb + s.dreb : (s[key as Exclude<GameRecordKey | 'min', 'reb'>] as number)

const careerValue = (key: GameRecordKey | 'gp' | 'min', t: CareerTotals): number =>
  t[key as keyof CareerTotals] as number

/**
 * The book, derived. Single-game records are kept live because they cannot be recovered from
 * totals; season and career records are recomputed from the career store, which is cheap and can
 * never drift out of step with it.
 */
export function leagueRecords(state: GameState, depth = 10): LeagueRecords {
  const careers = allCareers(state)
  const season: LeagueRecords['season'] = {}
  const career: LeagueRecords['career'] = {}

  for (const key of [...GAME_RECORDS, 'min'] as const) {
    const rows: StatRecord[] = []
    for (const c of careers)
      for (const s of c.seasons)
        rows.push({
          playerId: c.playerId,
          name: c.name,
          value: seasonValue(key, s),
          teamId: s.teamId,
          yearEnd: s.yearEnd,
        })
    rows.sort((a, b) => b.value - a.value)
    season[key] = rows.slice(0, depth)
  }

  for (const key of [...GAME_RECORDS, 'gp', 'min'] as const) {
    const rows: StatRecord[] = []
    for (const c of careers) {
      const t = totalsOf(c.seasons)
      rows.push({
        playerId: c.playerId,
        name: c.name,
        value: careerValue(key, t),
        teamId: c.seasons[c.seasons.length - 1]?.teamId ?? '',
        yearEnd: c.seasons[c.seasons.length - 1]?.yearEnd ?? 0,
      })
    }
    rows.sort((a, b) => b.value - a.value)
    career[key] = rows.slice(0, depth)
  }

  return { game: state.gameRecords ?? {}, season, career }
}

// ── Franchise history ────────────────────────────────────────────────────────

export interface FranchiseSeason {
  yearEnd: YearEnd
  wins: number
  losses: number
  seed: number | null
  /** 'Champions', 'Lost the finals', 'Lost in round 1', 'Missed the playoffs'. */
  finish: string
  leadingScorer: { playerId: string; name: string; pts: number; gp: number } | null
}

const ROUND_NAMES = ['round 1', 'the conference semi-finals', 'the conference finals', 'the finals']

function finishOf(h: SeasonSummary, teamId: string): string {
  if (h.championTeamId === teamId) return 'Champions'
  const rounds = h.rounds?.[teamId]
  if (rounds === undefined) {
    const seed = h.standings.find((s) => s.teamId === teamId)?.seed ?? null
    return seed === null ? 'Missed the playoffs' : `Made the playoffs (${seed} seed)`
  }
  return `Lost in ${ROUND_NAMES[rounds] ?? 'round 1'}`
}

export function franchiseSeasons(state: GameState, teamId: string): FranchiseSeason[] {
  const careers = allCareers(state)
  return state.history.map((h) => {
    const row = h.standings.find((s) => s.teamId === teamId)
    let leading: FranchiseSeason['leadingScorer'] = null
    for (const c of careers) {
      const s = c.seasons.find((x) => x.yearEnd === h.yearEnd && x.teamId === teamId)
      if (!s) continue
      if (!leading || s.pts > leading.pts)
        leading = { playerId: c.playerId, name: c.name, pts: s.pts, gp: s.gp }
    }
    return {
      yearEnd: h.yearEnd,
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      seed: row?.seed ?? null,
      finish: finishOf(h, teamId),
      leadingScorer: leading,
    }
  })
}

export interface FranchiseLeader {
  playerId: string
  name: string
  value: number
  seasons: number
  from: YearEnd
  to: YearEnd
}

export const FRANCHISE_KEYS = ['pts', 'reb', 'ast', 'gp'] as const
export type FranchiseKey = (typeof FRANCHISE_KEYS)[number]

/** All-time leaders for one club: only the seasons a man spent there count. */
export function franchiseLeaders(
  state: GameState,
  teamId: string,
  key: FranchiseKey,
  depth = 10,
): FranchiseLeader[] {
  const out: FranchiseLeader[] = []
  for (const c of allCareers(state)) {
    const here = c.seasons.filter((s) => s.teamId === teamId)
    if (here.length === 0) continue
    const t = totalsOf(here)
    const value = key === 'reb' ? t.reb : key === 'pts' ? t.pts : key === 'ast' ? t.ast : t.gp
    if (value <= 0) continue
    out.push({
      playerId: c.playerId,
      name: c.name,
      value,
      seasons: here.length,
      from: here[0]?.yearEnd ?? 0,
      to: here[here.length - 1]?.yearEnd ?? 0,
    })
  }
  out.sort((a, b) => b.value - a.value)
  return out.slice(0, depth)
}

/** Where a man stands in his club's all-time list. 1-based; 0 when he never played there. */
export function franchiseRank(
  state: GameState,
  teamId: string,
  playerId: string,
  key: FranchiseKey,
): { rank: number; of: number; value: number } {
  const all = franchiseLeaders(state, teamId, key, Number.MAX_SAFE_INTEGER)
  const i = all.findIndex((r) => r.playerId === playerId)
  return { rank: i + 1, of: all.length, value: all[i]?.value ?? 0 }
}

// ── The hall of fame ─────────────────────────────────────────────────────────

export interface HallOfFamer {
  playerId: string
  name: string
  /** Season in which he was inducted. */
  year: YearEnd
  retiredYear: YearEnd
  score: number
  /** Why he is in, in plain words. */
  case: string
}

/** Years between the last game and the ballot. Long enough to feel earned, short enough to see. */
export const HOF_WAIT = 3
/** Nobody below this gets in, however thin the ballot. */
export const HOF_THRESHOLD = 26
/** A ballot can only carry so many, so a weak year inducts nobody. */
export const HOF_PER_YEAR = 3

/**
 * One number for a whole career. Accolades dominate — that is how halls of fame actually behave —
 * with counting stats as the tiebreak that lets a great compiler in without a trophy.
 */
export function hofScore(c: Career): number {
  const t = totalsOf(c.seasons)
  let allNba1 = 0
  let allNba2 = 0
  let allNba3 = 0
  for (const s of c.seasons) {
    if (s.flags & FLAG.allNba1) allNba1++
    else if (s.flags & FLAG.allNba2) allNba2++
    else if (s.flags & FLAG.allNba3) allNba3++
  }
  return (
    t.mvps * 20 +
    allNba1 * 8 +
    allNba2 * 5 +
    allNba3 * 3 +
    t.titles * 3 +
    t.dpoys * 4 +
    t.roys * 2 +
    t.pts / 1500 +
    (t.reb + t.ast) / 3000 +
    t.gp / 400
  )
}

const thousands = (n: number): string => Math.round(n).toLocaleString('en-US')

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** The case for a man, in sentences a person would actually say. */
export function hofCase(state: GameState, c: Career): string {
  const t = totalsOf(c.seasons)
  const peak = peakSeason(c.seasons)
  const honours: string[] = []
  if (t.mvps) honours.push(plural(t.mvps, 'MVP award'))
  if (t.allNba) honours.push(`${plural(t.allNba, 'All-NBA selection')}`)
  if (t.titles) honours.push(plural(t.titles, 'championship'))
  if (t.dpoys) honours.push(plural(t.dpoys, 'Defensive Player of the Year award'))
  if (t.roys) honours.push('Rookie of the Year')

  const clubs = t.teams
    .map((id) => {
      const team = teamOf(state, id)
      return team ? `${team.city} ${team.name}` : id
    })
    .filter(Boolean)

  const where = isOneClubMan(c)
    ? `He never played for anyone but ${clubs[0] ?? 'one club'} — ${plural(t.seasons, 'season')}, one shirt.`
    : clubs.length <= 3
      ? `He played for ${clubs.join(', ')}.`
      : `He played for ${clubs.length} clubs.`

  const peakLine = peak
    ? `His best year was ${peak.yearEnd - 1}-${String(peak.yearEnd % 100).padStart(2, '0')}: ${(peak.pts / Math.max(1, peak.gp)).toFixed(1)} points, ${((peak.oreb + peak.dreb) / Math.max(1, peak.gp)).toFixed(1)} rebounds and ${(peak.ast / Math.max(1, peak.gp)).toFixed(1)} assists a night.`
    : ''

  const body = honours.length
    ? `${honours.join(', ')} in ${plural(t.seasons, 'season')}.`
    : `${plural(t.seasons, 'season')} of it, and ${thousands(t.gp)} games.`

  return `${body} ${thousands(t.pts)} career points, ${thousands(t.reb)} rebounds and ${thousands(t.ast)} assists. ${peakLine} ${where}`.replace(
    /\s+/g,
    ' ',
  )
}

/**
 * Run the ballot for the season that has just closed. Anyone who retired `HOF_WAIT` years ago is
 * considered; the best few get in. Returns the new inductees so the caller can announce them.
 */
export function runHallOfFameBallot(state: GameState): HallOfFamer[] {
  const year = state.season.yearEnd
  const eligibleYear = year - HOF_WAIT
  if (eligibleYear <= 0) return []
  state.hallOfFame ??= []
  const already = new Set(state.hallOfFame.map((h) => h.playerId))

  const ballot = allCareers(state)
    .filter((c) => c.retiredYear === eligibleYear && !already.has(c.playerId))
    .map((c) => ({ c, score: hofScore(c) }))
    .filter((x) => x.score >= HOF_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, HOF_PER_YEAR)

  const inducted: HallOfFamer[] = ballot.map(({ c, score }) => ({
    playerId: c.playerId,
    name: c.name,
    year,
    retiredYear: c.retiredYear,
    score: Math.round(score * 10) / 10,
    case: hofCase(state, c),
  }))
  state.hallOfFame.push(...inducted)
  for (const h of inducted)
    pushLog(state, {
      date: state.calendar.date,
      yearEnd: year,
      kind: 'award',
      text: `Hall of Fame: ${h.name} is inducted. ${h.case}`,
    })
  return inducted
}

// ── Retirement ───────────────────────────────────────────────────────────────

/** Below this a retirement is a roster move, not news. */
export const NOTABLE_GAMES = 500
export const NOTABLE_POINTS = 8000
/** A man who never left keeps his farewell at a much lower bar. That is the whole point of him. */
export const LOYAL_GAMES = 300
/** However many hang them up in one summer, only this many get a letter. */
export const MAX_FAREWELLS = 10

export function isNotable(c: Career): boolean {
  const t = totalsOf(c.seasons)
  return (
    t.gp >= NOTABLE_GAMES ||
    t.pts >= NOTABLE_POINTS ||
    t.mvps > 0 ||
    t.allNba > 0 ||
    t.dpoys > 0 ||
    t.roys > 0 ||
    (isOneClubMan(c) && t.gp >= LOYAL_GAMES)
  )
}

/**
 * The sentence the inbox gets when a man of substance walks away. Team ids are left in the text on
 * purpose: the web app swaps them for club names on the way to the inbox.
 */
export function retirementNote(state: GameState, c: Career): string {
  const t = totalsOf(c.seasons)
  const last = c.seasons[c.seasons.length - 1]
  const age = (last?.age ?? 0) + 1
  const club = last?.teamId ?? ''
  const rank = club ? franchiseRank(state, club, c.playerId, 'pts') : { rank: 0, of: 0, value: 0 }
  const honours: string[] = []
  if (t.mvps) honours.push(plural(t.mvps, 'MVP'))
  if (t.titles) honours.push(plural(t.titles, 'title'))
  if (t.allNba) honours.push(`${plural(t.allNba, 'All-NBA pick')}`)
  const parts = [
    `${c.name} retires at ${age} after ${plural(t.seasons, 'season')}: ${thousands(t.pts)} points, ${thousands(t.reb)} rebounds, ${thousands(t.ast)} assists in ${thousands(t.gp)} games.`,
  ]
  if (honours.length) parts.push(`${honours.join(', ')}.`)
  if (isOneClubMan(c)) parts.push(`A one-club man: every one of those seasons with ${club}.`)
  if (rank.rank > 0 && rank.rank <= 10)
    parts.push(`He leaves ${ordinalOf(rank.rank)} in ${club} history for points.`)
  return parts.join(' ')
}

function ordinalOf(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * Close the books on everyone who has just left the league. `before` is the roster of player ids
 * as it stood before the development hook ran; anyone missing now has retired.
 */
export function recordRetirements(state: GameState, before: readonly string[]): Career[] {
  const still = new Set(state.league.players.map((p) => p.playerId))
  const year = state.season.yearEnd
  const gone: Career[] = []
  for (const id of before) {
    if (still.has(id)) continue
    const c = markRetired(state, id, year)
    if (c) gone.push(c)
  }
  // Forty men hang them up in a summer and the inbox is not a wire service: only the ones worth a
  // paragraph get one, biggest career first, and only so many of those.
  const farewells = gone
    .filter(isNotable)
    .map((c) => ({ c, pts: totalsOf(c.seasons).pts }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, MAX_FAREWELLS)
  for (const { c } of farewells)
    pushLog(state, {
      date: state.calendar.date,
      yearEnd: year,
      kind: 'note',
      text: retirementNote(state, c),
    })
  return gone
}
