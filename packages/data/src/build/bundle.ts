// Season and history bundles from db.sqlite. Shapes are packages/core/src/bundle.ts.
//
// Players: everyone on an opening-night roster (see opening-night.ts). Ratings and tendencies come from
// @hoops/ratings rateSeason. Real stats: totals summed over stints (game logs), per-100 and advanced from
// the season-level leaguedash lines, shooting / play-by-play / PER-BPM-WS from the bref lines that
// load-bref attached, contracts from the contracts table (Wayback 2021+, inferred before).
// rules is seasons.rules_json (Lane C).

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CareerArc,
  Contract,
  EraContext,
  EraRules,
  HistoryBundle,
  PlayerRecord,
  PlayerSeasonStats,
  Position,
  RealAward,
  RealPlayoffSeries,
  ScheduledGame,
  SeasonBundle,
  TeamRecord,
} from '@hoops/core'
import { type RateInput, rateSeason } from '@hoops/ratings'
import { all, one } from '../db/db.ts'
import { eraContextFrom, type TeamSeasonLine, type ZoneBaseline } from './era-context.ts'
import { openingNightRosters } from './opening-night.ts'
import { BOX_KEYS, type BoxTotals, emptyTotals } from './stints.ts'

// ---- db row shapes -------------------------------------------------------------------------------

interface SeasonRow {
  year_end: number
  season_id: string
  games: number
  teams: number
  rules_json: string
}
interface TeamRow {
  team_id: string
  abbr: string
  name: string
  city: string
  conference: string
  division: string
  wins: number | null
  losses: number | null
  playoff_seed: number | null
  stats_json: string | null
}
interface PlayerRow {
  player_id: string
  bref_id: string | null
  name: string
  birth_date: string | null
  height_in: number | null
  weight_lb: number | null
  pos: string | null
  draft_year: number | null
  draft_round: number | null
  draft_pick: number | null
  from_year: number | null
  hof: number
}
interface PsRow {
  year_end: number
  player_id: string
  team_id: string
  stint: number
  age: number | null
  pos: string | null
  years_pro: number | null
  gp: number
  gs: number | null
  min: number
  totals_json: string
  per100_json: string | null
  advanced_json: string | null
  shooting_json: string | null
  pbp_json: string | null
}
interface ContractRow {
  player_id: string
  team_id: string
  kind: Contract['kind']
  years_json: string
  source: Contract['source']
}
interface GameRow {
  game_id: string
  date: string
  season_type: 'regular' | 'playin' | 'playoffs'
  home_team_id: string
  away_team_id: string
  home_pts: number
  away_pts: number
}
interface RosterRow {
  team_id: string
  player_id: string
  pos: string | null
  experience: number | null
  height_in: number | null
  weight_lb: number | null
  birth_date: string | null
}
interface SeriesRow {
  round: number
  high_team_id: string
  low_team_id: string
  winner_team_id: string
  high_wins: number
  low_wins: number
}
interface DraftRow {
  draft_year: number
  overall: number
  round: number
  pick: number
  team_id: string
  player_id: string | null
  player_name: string
}
interface AwardRow {
  award: string
  player_id: string | null
  team_rank: number | null
  share: number | null
}

interface Adv {
  off_rating: number | null
  def_rating: number | null
  ast_pct: number | null
  oreb_pct: number | null
  dreb_pct: number | null
  tm_tov_pct: number | null
  usg_pct: number | null
  /** bref block written by load-bref; percentages already 0–100. */
  bref?: {
    per: number | null
    orb_pct: number | null
    drb_pct: number | null
    ast_pct: number | null
    stl_pct: number | null
    blk_pct: number | null
    tov_pct: number | null
    usg_pct: number | null
    ws_48: number | null
    obpm: number | null
    dbpm: number | null
    bpm: number | null
  }
}

// ---- small helpers -------------------------------------------------------------------------------

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
/** 0.333 → 33.3. One decimal, like the source. */
const pct100 = (x: number | null | undefined): number | null =>
  x === null || x === undefined ? null : Math.round(x * 1000) / 10

/** Whole years between an ISO birth date and a date. */
export function ageOn(birthDate: string | null, date: string): number | null {
  if (!birthDate) return null
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [y, m, d] = date.split('-').map(Number)
  if (!by || !bm || !bd || !y || !m || !d) return null
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age--
  return age
}

/**
 * Five-slot Position. bref codes (PG..C, written by load-bref) pass through; the stats.nba.com strings
 * ('G', 'F-C', ...) of unmatched players split by height: 6'3" and under G → PG; 6'8" and under F → SF.
 */
export function toPosition(raw: string | null, heightIn: number | null): Position {
  const h = heightIn ?? 79
  switch (raw) {
    case 'PG':
    case 'SG':
    case 'SF':
    case 'PF':
    case 'C':
      return raw
    case 'G':
      return h <= 75 ? 'PG' : 'SG'
    case 'G-F':
      return 'SG'
    case 'F-G':
      return 'SF'
    case 'F':
      return h <= 80 ? 'SF' : 'PF'
    case 'F-C':
      return 'PF'
    case 'C-F':
      return 'C'
    default:
      return h <= 75 ? 'PG' : h <= 78 ? 'SG' : h <= 80 ? 'SF' : h <= 82 ? 'PF' : 'C'
  }
}

/** Real regular-season line from a player's stint rows. Null when he did not play. */
export function statsFromStints(rows: readonly PsRow[]): PlayerSeasonStats | null {
  const played = rows.filter((r) => r.gp > 0)
  if (played.length === 0) return null
  const totals = emptyTotals()
  let gp = 0
  let min = 0
  for (const r of played) {
    const t = JSON.parse(r.totals_json) as BoxTotals
    for (const k of BOX_KEYS) totals[k] += t[k] ?? 0
    gp += r.gp
    min += r.min
  }
  const withRates = played.find((r) => r.per100_json) ?? played[0]
  const per100 = withRates?.per100_json
    ? (JSON.parse(withRates.per100_json) as BoxTotals)
    : emptyTotals()
  const adv = withRates?.advanced_json ? (JSON.parse(withRates.advanced_json) as Adv) : null
  const b = adv?.bref
  const withBref = played.find((r) => r.shooting_json || r.pbp_json || r.gs !== null)
  const shooting = withBref?.shooting_json
    ? (JSON.parse(withBref.shooting_json) as PlayerSeasonStats['shooting'])
    : null
  const pbp = withBref?.pbp_json
    ? (JSON.parse(withBref.pbp_json) as PlayerSeasonStats['pbp'])
    : null
  const pick = (t: BoxTotals) => ({
    fga: t.fga,
    fgm: t.fgm,
    fg3a: t.fg3a,
    fg3m: t.fg3m,
    fta: t.fta,
    ftm: t.ftm,
    oreb: t.oreb,
    dreb: t.dreb,
    ast: t.ast,
    tov: t.tov,
    stl: t.stl,
    blk: t.blk,
    pf: t.pf,
    pts: t.pts,
  })
  return {
    gp,
    gs: withBref?.gs ?? 0, // bref games started; 0 when unmatched
    min,
    totals: pick(totals),
    per100: pick(per100),
    pct: {
      fg: ratio(totals.fgm, totals.fga),
      fg3: ratio(totals.fg3m, totals.fg3a),
      ft: ratio(totals.ftm, totals.fta),
      ts: ratio(totals.pts, 2 * (totals.fga + 0.44 * totals.fta)),
      efg: ratio(totals.fgm + 0.5 * totals.fg3m, totals.fga),
    },
    // NBA advanced where it exists, bref for what stats.nba.com lacks (STL%/BLK%/PER/BPM/WS).
    adv: {
      usg: pct100(adv?.usg_pct) ?? b?.usg_pct ?? null,
      astPct: pct100(adv?.ast_pct) ?? b?.ast_pct ?? null,
      tovPct: adv?.tm_tov_pct ?? b?.tov_pct ?? null, // already a percentage for players
      orbPct: pct100(adv?.oreb_pct) ?? b?.orb_pct ?? null,
      drbPct: pct100(adv?.dreb_pct) ?? b?.drb_pct ?? null,
      stlPct: b?.stl_pct ?? null,
      blkPct: b?.blk_pct ?? null,
      ortg: adv?.off_rating ?? null,
      drtg: adv?.def_rating ?? null,
      obpm: b?.obpm ?? null,
      dbpm: b?.dbpm ?? null,
      bpm: b?.bpm ?? null,
      per: b?.per ?? null,
      ws48: b?.ws_48 ?? null,
    },
    shooting,
    pbp,
  }
}

// ---- career index: every regular-season stint row, for yearsPro and yearsWithTeam ----------------

export interface CareerIndex {
  /** playerId → seasons ascending: last-stint team and games that season. */
  byPlayer: Map<string, { yearEnd: number; lastTeam: string; gp: number }[]>
}

export function careerIndex(db: DatabaseSync): CareerIndex {
  const rows = all<{
    player_id: string
    year_end: number
    team_id: string
    stint: number
    gp: number
  }>(
    db,
    `SELECT player_id, year_end, team_id, stint, gp FROM player_seasons
     WHERE season_type = 'regular' ORDER BY player_id, year_end, stint`,
  )
  const byPlayer = new Map<string, { yearEnd: number; lastTeam: string; gp: number }[]>()
  for (const r of rows) {
    let list = byPlayer.get(r.player_id)
    if (!list) {
      list = []
      byPlayer.set(r.player_id, list)
    }
    const last = list[list.length - 1]
    if (last && last.yearEnd === r.year_end) {
      last.lastTeam = r.team_id // stints ascend, so the last row wins
      last.gp += r.gp
    } else list.push({ yearEnd: r.year_end, lastTeam: r.team_id, gp: r.gp })
  }
  return { byPlayer }
}

/** Seasons before `yearEnd` with a game, plus seasons before the data window from the career span. */
export function yearsProOf(
  idx: CareerIndex,
  playerId: string,
  yearEnd: number,
  fromYear: number | null,
  firstLoaded: number,
): number {
  const inWindow = (idx.byPlayer.get(playerId) ?? []).filter(
    (s) => s.yearEnd < yearEnd && s.gp > 0,
  ).length
  const before = fromYear !== null && fromYear < firstLoaded ? firstLoaded - fromYear : 0
  return inWindow + before
}

/** Consecutive seasons before `yearEnd` that ended on `teamId`. */
export function yearsWithTeamOf(
  idx: CareerIndex,
  playerId: string,
  yearEnd: number,
  teamId: string,
): number {
  const seasons = idx.byPlayer.get(playerId) ?? []
  let n = 0
  for (let y = yearEnd - 1; ; y--) {
    const s = seasons.find((x) => x.yearEnd === y)
    if (!s || s.lastTeam !== teamId) break
    n++
  }
  return n
}

// ---- era -----------------------------------------------------------------------------------------

export function readEra(db: DatabaseSync, yearEnd: number): EraContext {
  const teams = all<TeamRow>(db, 'SELECT * FROM team_seasons WHERE year_end = ?', [yearEnd])
  const lines: TeamSeasonLine[] = []
  for (const t of teams) {
    const s = t.stats_json ? (JSON.parse(t.stats_json) as Record<string, unknown>) : null
    const tot = s?.totals as (BoxTotals & { gp: number }) | null | undefined
    const adv = s?.advanced as
      | { gp: number; pace: number; poss: number; off_rating: number }
      | null
      | undefined
    if (!tot || !adv) continue
    lines.push({
      gp: tot.gp,
      poss: adv.poss,
      pace: adv.pace,
      ortg: adv.off_rating,
      fgm: tot.fgm,
      fga: tot.fga,
      fg3m: tot.fg3m,
      fg3a: tot.fg3a,
      ftm: tot.ftm,
      fta: tot.fta,
      oreb: tot.oreb,
      dreb: tot.dreb,
      ast: tot.ast,
      tov: tot.tov,
      stl: tot.stl,
      blk: tot.blk,
      pf: tot.pf,
      pts: tot.pts,
    })
  }
  const ha = one<{ games: number; home_wins: number }>(
    db,
    `SELECT COUNT(*) AS games, SUM(home_pts > away_pts) AS home_wins FROM games
     WHERE year_end = ? AND season_type = 'regular'`,
    [yearEnd],
  ) ?? { games: 0, home_wins: 0 }
  const z = one<{ shooting_json: string | null; rules_json: string }>(
    db,
    'SELECT shooting_json, rules_json FROM seasons WHERE year_end = ?',
    [yearEnd],
  )
  const zones = z?.shooting_json ? (JSON.parse(z.shooting_json) as ZoneBaseline) : null
  const rules = z ? (JSON.parse(z.rules_json) as Partial<EraRules>) : null
  const flags = rules?.rules
    ? { handCheckBanned: rules.rules.hand_check_banned, zoneLegal: rules.rules.zone_defense_legal }
    : null
  return eraContextFrom(
    yearEnd,
    lines,
    { homeWins: ha.home_wins ?? 0, games: ha.games },
    zones,
    flags,
  )
}

// ---- per-season player assembly (shared by season bundles and history) ---------------------------

interface SeasonPlayer {
  row: PlayerRow
  stints: PsRow[]
  stats: PlayerSeasonStats | null
  age: number
  heightIn: number
  weightLb: number
  pos: Position
  rosterExp: number | null
  roster: RosterRow | null
}

function seasonPlayers(
  db: DatabaseSync,
  yearEnd: number,
  openingDate: string,
): Map<string, SeasonPlayer> {
  const ps = all<PsRow>(
    db,
    `SELECT year_end, player_id, team_id, stint, age, pos, years_pro, gp, gs, min, totals_json,
            per100_json, advanced_json, shooting_json, pbp_json
     FROM player_seasons WHERE year_end = ? AND season_type = 'regular' ORDER BY player_id, stint`,
    [yearEnd],
  )
  const ro = all<RosterRow>(
    db,
    `SELECT team_id, player_id, pos, experience, height_in, weight_lb, birth_date FROM rosters
     WHERE year_end = ?`,
    [yearEnd],
  )
  const ids = new Set<string>([...ps.map((r) => r.player_id), ...ro.map((r) => r.player_id)])
  const players = new Map(
    all<PlayerRow>(
      db,
      `SELECT player_id, bref_id, name, birth_date, height_in, weight_lb, pos, draft_year, draft_round,
              draft_pick, from_year, hof FROM players`,
    ).map((p) => [p.player_id, p]),
  )
  const stintsBy = new Map<string, PsRow[]>()
  for (const r of ps) {
    const list = stintsBy.get(r.player_id)
    if (list) list.push(r)
    else stintsBy.set(r.player_id, [r])
  }
  const rosterBy = new Map(ro.map((r) => [r.player_id, r]))
  const out = new Map<string, SeasonPlayer>()
  for (const id of ids) {
    const row = players.get(id)
    if (!row) continue
    const stints = stintsBy.get(id) ?? []
    const roster = rosterBy.get(id) ?? null
    const heightIn = row.height_in ?? roster?.height_in ?? 79
    const rawPos = stints[0]?.pos ?? roster?.pos ?? row.pos
    out.set(id, {
      row,
      stints,
      stats: statsFromStints(stints),
      age: ageOn(row.birth_date ?? roster?.birth_date ?? null, openingDate) ?? stints[0]?.age ?? 27,
      heightIn,
      weightLb: row.weight_lb ?? roster?.weight_lb ?? 215,
      pos: toPosition(rawPos, heightIn),
      rosterExp: roster?.experience ?? null,
      roster,
    })
  }
  return out
}

function rateAll(players: Iterable<SeasonPlayer>) {
  const inputs: RateInput[] = []
  for (const p of players)
    inputs.push({
      playerId: p.row.player_id,
      pos: p.pos,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      stats: p.stats,
    })
  return rateSeason(inputs)
}

/** Contracts as of opening night, by player. Wayback rows are real; earlier seasons are inferred. */
export function contractsFor(db: DatabaseSync, yearEnd: number): Map<string, Contract> {
  const out = new Map<string, Contract>()
  for (const c of all<ContractRow>(
    db,
    'SELECT player_id, team_id, kind, years_json, source FROM contracts WHERE year_end = ?',
    [yearEnd],
  )) {
    const years = JSON.parse(c.years_json) as Contract['years']
    if (years.length === 0) continue
    out.set(c.player_id, { teamId: c.team_id, kind: c.kind, years, source: c.source })
  }
  return out
}

function openingDateOf(db: DatabaseSync, yearEnd: number): string {
  const r = one<{ d: string | null }>(
    db,
    `SELECT MIN(date) AS d FROM games WHERE year_end = ? AND season_type = 'regular'`,
    [yearEnd],
  )
  return r?.d ?? `${yearEnd - 1}-10-01`
}

function readSeries(db: DatabaseSync, yearEnd: number): RealPlayoffSeries[] {
  return all<SeriesRow>(
    db,
    'SELECT * FROM playoff_series WHERE year_end = ? ORDER BY round, high_team_id',
    [yearEnd],
  ).map((s) => ({
    round: s.round,
    highTeamId: s.high_team_id,
    lowTeamId: s.low_team_id,
    winnerTeamId: s.winner_team_id,
    highWins: s.high_wins,
    lowWins: s.low_wins,
  }))
}

function readAwards(db: DatabaseSync, yearEnd: number): RealAward[] {
  return all<AwardRow>(
    db,
    'SELECT award, player_id, team_rank, share FROM awards WHERE year_end = ?',
    [yearEnd],
  )
    .filter((a) => a.player_id !== null)
    .map((a) => ({
      award: a.award,
      playerId: a.player_id as string,
      teamRank: a.team_rank,
      share: a.share,
    }))
}

function readDraft(db: DatabaseSync, draftYear: number): SeasonBundle['real']['draft'] {
  return all<DraftRow>(db, 'SELECT * FROM draft_picks WHERE draft_year = ? ORDER BY overall', [
    draftYear,
  ]).map((d) => ({
    draftYear: d.draft_year,
    overall: d.overall,
    round: d.round,
    pick: d.pick,
    teamId: d.team_id,
    playerId: d.player_id,
    name: d.player_name,
  }))
}

// ---- season bundle -------------------------------------------------------------------------------

export function buildSeasonBundle(
  db: DatabaseSync,
  yearEnd: number,
  idx: CareerIndex = careerIndex(db),
): SeasonBundle {
  const season = one<SeasonRow>(db, 'SELECT * FROM seasons WHERE year_end = ?', [yearEnd])
  if (!season) throw new Error(`season ${yearEnd} not loaded`)
  const firstLoaded = one<{ y: number }>(db, 'SELECT MIN(year_end) AS y FROM seasons')?.y ?? yearEnd
  const openingDate = openingDateOf(db, yearEnd)
  const teams: TeamRecord[] = all<TeamRow>(
    db,
    'SELECT * FROM team_seasons WHERE year_end = ? ORDER BY team_id',
    [yearEnd],
  ).map((t) => ({
    teamId: t.team_id,
    abbr: t.abbr,
    name: t.name,
    city: t.city,
    conference: t.conference === 'West' ? 'West' : 'East',
    division: t.division,
    real: { wins: t.wins ?? 0, losses: t.losses ?? 0, playoffSeed: t.playoff_seed },
  }))
  const people = seasonPlayers(db, yearEnd, openingDate)
  const on = openingNightRosters(
    [...people.values()].flatMap((p) =>
      p.stints.map((s) => ({
        playerId: s.player_id,
        teamId: s.team_id,
        order: s.stint,
        gp: s.gp,
        min: s.min,
      })),
    ),
    [...people.values()]
      .filter((p) => p.roster)
      .map((p) => ({ playerId: p.row.player_id, teamId: (p.roster as RosterRow).team_id })),
  )
  const chosen = on.entries
    .map((e) => ({ e, p: people.get(e.playerId) as SeasonPlayer }))
    .filter((x) => x.p !== undefined)
  const rated = rateAll(chosen.map((x) => x.p))
  const contracts = contractsFor(db, yearEnd)
  const players: PlayerRecord[] = chosen.map(({ e, p }) => {
    const r = rated.get(p.row.player_id)
    if (!r) throw new Error(`no rating for ${p.row.player_id}`)
    const row = p.row
    return {
      playerId: row.player_id,
      brefId: row.bref_id,
      name: row.name,
      birthDate: row.birth_date,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      pos: p.pos,
      draft:
        row.draft_year !== null && row.draft_round !== null && row.draft_pick !== null
          ? { year: row.draft_year, round: row.draft_round, pick: row.draft_pick }
          : null,
      yearsPro:
        p.rosterExp ??
        p.stints[0]?.years_pro ??
        yearsProOf(idx, row.player_id, yearEnd, row.from_year, firstLoaded),
      yearsWithTeam: yearsWithTeamOf(idx, row.player_id, yearEnd, e.teamId),
      teamId: e.teamId,
      contract: contracts.get(row.player_id) ?? null,
      ratings: r.ratings,
      tendencies: r.tendencies,
      real: p.stats,
      realMpg: p.stats && p.stats.gp > 0 ? p.stats.min / p.stats.gp : 0,
    }
  })
  const schedule: ScheduledGame[] = all<GameRow>(
    db,
    `SELECT game_id, date, season_type, home_team_id, away_team_id, home_pts, away_pts FROM games
     WHERE year_end = ? AND season_type = 'regular' ORDER BY date, game_id`,
    [yearEnd],
  ).map((g) => ({
    gameId: g.game_id,
    date: g.date,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    seasonType: 'regular',
    real: { homePts: g.home_pts, awayPts: g.away_pts },
  }))
  const stints: SeasonBundle['real']['stints'] = []
  for (const p of people.values())
    for (const s of p.stints)
      stints.push({
        playerId: s.player_id,
        teamId: s.team_id,
        order: s.stint,
        gp: s.gp,
        mpg: s.gp > 0 ? s.min / s.gp : 0,
      })
  return {
    yearEnd,
    seasonId: season.season_id,
    era: readEra(db, yearEnd),
    rules: JSON.parse(season.rules_json) as EraRules, // core keeps the field opaque; data types it
    teams,
    players,
    schedule,
    real: {
      stints,
      playoffs: readSeries(db, yearEnd),
      awards: readAwards(db, yearEnd),
      draft: readDraft(db, yearEnd - 1),
    },
  }
}

// ---- validation ----------------------------------------------------------------------------------

function findNaN(v: unknown, at: string, out: string[]): void {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) out.push(`NaN at ${at}`)
  } else if (Array.isArray(v)) {
    if (out.length < 20) {
      for (const [i, x] of v.entries()) findNaN(x, `${at}[${i}]`, out)
    }
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (out.length < 20) findNaN(x, `${at}.${k}`, out)
  }
}

/** Problems with a bundle. Empty means it passes. `expectedGames` overrides games × teams / 2. */
export function validateBundle(
  b: SeasonBundle,
  gamesPerTeam: number,
  expectedGames?: number,
): string[] {
  const problems: string[] = []
  const teamIds = new Set(b.teams.map((t) => t.teamId))
  const perTeam = new Map<string, number>()
  for (const p of b.players) {
    if (!teamIds.has(p.teamId)) problems.push(`player ${p.playerId} on unknown team ${p.teamId}`)
    perTeam.set(p.teamId, (perTeam.get(p.teamId) ?? 0) + 1)
  }
  for (const t of b.teams) {
    const n = perTeam.get(t.teamId) ?? 0
    if (n < 12 || n > 20) problems.push(`${t.abbr} has ${n} players`)
  }
  const want = expectedGames ?? (gamesPerTeam * b.teams.length) / 2
  if (b.schedule.length !== want)
    problems.push(`schedule has ${b.schedule.length} games, want ${want}`)
  for (const g of b.schedule) {
    if (!teamIds.has(g.homeTeamId) || !teamIds.has(g.awayTeamId))
      problems.push(`game ${g.gameId} has an unknown team`)
    if (problems.length > 20) break
  }
  for (const s of b.real.stints)
    if (!teamIds.has(s.teamId)) {
      problems.push(`stint ${s.playerId} on unknown team ${s.teamId}`)
      break
    }
  findNaN(b, 'bundle', problems)
  return problems
}

// ---- history -------------------------------------------------------------------------------------

export function buildHistory(db: DatabaseSync): HistoryBundle {
  const seasons = all<SeasonRow>(db, 'SELECT * FROM seasons ORDER BY year_end')
  const careers = new Map<string, CareerArc>()
  const history: HistoryBundle = { careers: [], drafts: {}, seasons: {} }
  for (const s of seasons) {
    const y = s.year_end
    const openingDate = openingDateOf(db, y)
    const people = seasonPlayers(db, y, openingDate)
    const played = [...people.values()].filter((p) => p.stats !== null)
    const rated = rateAll(played)
    for (const p of played) {
      const r = rated.get(p.row.player_id)
      const stats = p.stats as PlayerSeasonStats
      const first = p.stints[0] as PsRow
      if (!r) continue
      let arc = careers.get(p.row.player_id)
      if (!arc) {
        const row = p.row
        arc = {
          playerId: row.player_id,
          brefId: row.bref_id,
          name: row.name,
          birthDate: row.birth_date,
          heightIn: p.heightIn,
          weightLb: p.weightLb,
          pos: p.pos,
          draft:
            row.draft_year !== null && row.draft_round !== null && row.draft_pick !== null
              ? { year: row.draft_year, round: row.draft_round, pick: row.draft_pick }
              : null,
          seasons: [],
          hof: row.hof === 1,
        }
        careers.set(row.player_id, arc)
      }
      const tot = stats.totals
      arc.seasons.push({
        yearEnd: y,
        age: p.age,
        teamId: first.team_id, // opening-night team, same as the season bundle
        mpg: stats.gp > 0 ? stats.min / stats.gp : 0,
        gp: stats.gp,
        box: {
          gs: stats.gs,
          min: stats.min,
          pts: tot.pts,
          fgm: tot.fgm,
          fga: tot.fga,
          fg3m: tot.fg3m,
          fg3a: tot.fg3a,
          ftm: tot.ftm,
          fta: tot.fta,
          oreb: tot.oreb,
          dreb: tot.dreb,
          ast: tot.ast,
          stl: tot.stl,
          blk: tot.blk,
          tov: tot.tov,
          pf: tot.pf,
        },
        ratings: r.ratings,
        tendencies: r.tendencies,
      })
    }
    const playoffs = readSeries(db, y)
    const finals = playoffs.find((x) => x.round === 4)
    history.seasons[y] = {
      standings: all<TeamRow>(
        db,
        'SELECT team_id, wins, losses, playoff_seed FROM team_seasons WHERE year_end = ? ORDER BY team_id',
        [y],
      ).map((t) => ({
        teamId: t.team_id,
        wins: t.wins ?? 0,
        losses: t.losses ?? 0,
        playoffSeed: t.playoff_seed,
      })),
      playoffs,
      awards: readAwards(db, y),
      champion: finals?.winnerTeamId ?? null,
      runnerUp: finals
        ? finals.winnerTeamId === finals.highTeamId
          ? finals.lowTeamId
          : finals.highTeamId
        : null,
    }
  }
  for (const d of all<{ y: number }>(
    db,
    'SELECT DISTINCT draft_year AS y FROM draft_picks WHERE draft_year >= 1997 ORDER BY draft_year',
  ))
    history.drafts[d.y] = readDraft(db, d.y)
  history.careers = [...careers.values()]
  return history
}

// ---- write ---------------------------------------------------------------------------------------

export interface WriteOptions {
  from?: number
  to?: number
  log?: (line: string) => void
}

/** Writes <dir>/<yearEnd>.json for each loaded season in range plus <dir>/history.json. */
export function writeBundles(
  db: DatabaseSync,
  dir: string,
  opts: WriteOptions = {},
): { file: string; bytes: number }[] {
  const log = opts.log ?? (() => {})
  mkdirSync(dir, { recursive: true })
  const idx = careerIndex(db)
  const out: { file: string; bytes: number }[] = []
  const seasons = all<SeasonRow>(db, 'SELECT * FROM seasons ORDER BY year_end').filter(
    (s) => s.year_end >= (opts.from ?? 0) && s.year_end <= (opts.to ?? 9999),
  )
  for (const s of seasons) {
    const t0 = performance.now()
    const b = buildSeasonBundle(db, s.year_end, idx)
    const realGames = one<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM games WHERE year_end = ? AND season_type = 'regular'`,
      [s.year_end],
    )?.n
    const problems = validateBundle(b, s.games, s.year_end === 2020 ? realGames : undefined)
    if (problems.length > 0)
      throw new Error(`bundle ${s.year_end} invalid:\n  ${problems.join('\n  ')}`)
    const file = path.join(dir, `${s.year_end}.json`)
    const json = JSON.stringify(b)
    writeFileSync(file, json)
    out.push({ file, bytes: json.length })
    log(
      `${s.year_end}: ${b.players.length} players, ${b.schedule.length} games, ${(json.length / 1e6).toFixed(2)} MB, ${(performance.now() - t0).toFixed(0)}ms`,
    )
  }
  const t0 = performance.now()
  const h = buildHistory(db)
  const file = path.join(dir, 'history.json')
  const json = JSON.stringify(h)
  writeFileSync(file, json)
  out.push({ file, bytes: json.length })
  log(
    `history: ${h.careers.length} careers, ${(json.length / 1e6).toFixed(2)} MB, ${(performance.now() - t0).toFixed(0)}ms`,
  )
  return out
}
