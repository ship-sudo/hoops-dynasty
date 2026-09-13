// Fold the basketball-reference-derived open data (Lane B, packages/data/src/open) into the NBA-keyed
// tables. Runs after load-nba: it needs players, team_seasons and player_seasons to exist.
//
// 1. id_map: bref slug → NBA person id through matchIds (name + season + team, then draft year, then
//    unique name; build/id-overrides.json wins). players gets bref_id, hof, and bio fallbacks.
// 2. player_seasons: gs, bref position, years_pro, shooting_json, pbp_json and a `bref` block inside
//    advanced_json, all season-level (the TOT row for traded players), copied onto every stint.
// 3. seasons.shooting_json: league shot mix and FG% by zone, FGA-weighted over stint rows.
// 4. awards: winners with vote share, All-NBA / All-Defensive / All-Rookie teams, All-Stars.
// 5. salaries: 1998–2020 from the salary CSV, 2021–2026 from the Wayback contracts snapshots.
// 6. contracts: Wayback rows carry real forward years and option flags; earlier seasons are inferred
//    from forward salary history (contracts-infer.ts) and flagged.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { all, prepareInsert, transaction } from '../db/db.ts'
import { ERA } from '../era/era.ts'
import { loadAllStarSelections, loadAwardShares, loadEndOfSeasonTeams } from '../open/awards.ts'
import * as bref from '../open/bref.ts'
import { loadAllSalaries, type SalaryRow, WAYBACK_SEASONS } from '../open/salaries.ts'
import { loadWaybackContracts } from '../open/wayback.ts'
import { contractKind, inferYears } from './contracts-infer.ts'
import { type BrefRef, type IdOverrides, matchIds, type NbaRef, nbaAbbr } from './ids.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ID_OVERRIDES_PATH = path.join(here, 'id-overrides.json')

export interface BrefLoadOptions {
  from?: number
  to?: number
  log?: (line: string) => void
}

type Gap = [yearEnd: number | null, table: string, reason: string]

const AWARD_NAMES: Record<string, string> = {
  'nba mvp': 'MVP',
  'nba roy': 'ROY',
  'nba dpoy': 'DPOY',
  'nba smoy': 'SMOY',
  'nba mip': 'MIP',
  'nba clutch_poy': 'CPOY',
}
const TEAM_AWARD_NAMES: Record<string, string> = {
  'All-NBA': 'All-NBA',
  'All-Defense': 'All-Defensive',
  'All-Rookie': 'All-Rookie',
}
const TEAM_RANK: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3 }

/** Season-level row per (season, player): the TOT/2TM row when traded, else the single stint row. */
function seasonRows<R extends { season: number; player_id: string; team: string }>(
  rows: readonly R[],
): Map<string, R> {
  const out = new Map<string, R>()
  for (const r of rows) {
    const k = `${r.season}|${r.player_id}`
    const cur = out.get(k)
    if (!cur || bref.isTotalRow(r.team)) out.set(k, r)
  }
  return out
}

function readOverrides(): IdOverrides {
  try {
    return JSON.parse(readFileSync(ID_OVERRIDES_PATH, 'utf8')) as IdOverrides
  } catch {
    return {}
  }
}

const pctOrNull = (x: number | null): number | null => (x === null ? null : x / 100)

export async function loadBref(
  db: DatabaseSync,
  opts: BrefLoadOptions = {},
): Promise<Record<string, number>> {
  const from = opts.from ?? bref.DEFAULT_RANGE.from
  const to = opts.to ?? bref.DEFAULT_RANGE.to
  const range = { from, to }
  const log = opts.log ?? (() => {})
  const gaps: Gap[] = []
  const counts: Record<string, number> = {}
  const t0 = performance.now()

  // ---- teams: bref abbreviation → NBA team id per season ---------------------------------------
  const teamRows = all<{ year_end: number; team_id: string; abbr: string }>(
    db,
    'SELECT year_end, team_id, abbr FROM team_seasons',
  )
  const teamByAbbr = new Map(teamRows.map((t) => [`${t.year_end}|${t.abbr}`, t.team_id]))
  const teamIdOf = (yearEnd: number, brefTeam: string): string | null =>
    teamByAbbr.get(`${yearEnd}|${nbaAbbr(brefTeam)}`) ?? null
  const brefAbbrOf = new Map<string, string>()
  for (const a of bref.loadTeamAbbrev(range)) {
    if (!a.abbreviation) continue
    const id = teamIdOf(a.season, a.abbreviation)
    if (id) brefAbbrOf.set(`${a.season}|${id}`, a.abbreviation)
  }

  // ---- ids ----------------------------------------------------------------------------------------
  const totals = bref.loadTotals(range)
  const stints = bref.totalsStints(totals)
  const draft = bref.loadDraft({ from: 1947, to })
  const draftYearOf = new Map<string, number>()
  for (const d of draft)
    if (d.player_id && !draftYearOf.has(d.player_id)) draftYearOf.set(d.player_id, d.season)
  const career = new Map(bref.loadCareerInfo(range).map((c) => [c.player_id, c]))
  const brefRefs = new Map<string, BrefRef>()
  for (const s of stints) {
    let ref = brefRefs.get(s.player_id)
    if (!ref) {
      ref = {
        brefId: s.player_id,
        name: s.player,
        draftYear: draftYearOf.get(s.player_id) ?? null,
        seasons: [],
      }
      brefRefs.set(s.player_id, ref)
    }
    ref.seasons.push({ yearEnd: s.season, abbr: nbaAbbr(s.team) })
  }
  const nbaPlayers = all<{
    player_id: string
    name: string
    draft_year: number | null
    birth_date: string | null
    height_in: number | null
    weight_lb: number | null
  }>(db, 'SELECT player_id, name, draft_year, birth_date, height_in, weight_lb FROM players')
  const nbaSeasons = all<{ player_id: string; year_end: number; abbr: string }>(
    db,
    `SELECT DISTINCT s.player_id, s.year_end, t.abbr FROM player_seasons s
     JOIN team_seasons t ON t.year_end = s.year_end AND t.team_id = s.team_id
     WHERE s.season_type = 'regular'`,
  )
  const seasonsByNba = new Map<string, { yearEnd: number; abbr: string }[]>()
  for (const s of nbaSeasons) {
    const list = seasonsByNba.get(s.player_id)
    if (list) list.push({ yearEnd: s.year_end, abbr: s.abbr })
    else seasonsByNba.set(s.player_id, [{ yearEnd: s.year_end, abbr: s.abbr }])
  }
  const nbaRefs: NbaRef[] = nbaPlayers.map((p) => ({
    nbaId: p.player_id,
    name: p.name,
    draftYear: p.draft_year,
    seasons: seasonsByNba.get(p.player_id) ?? [],
  }))
  const { matches, unmatched } = matchIds(nbaRefs, [...brefRefs.values()], readOverrides(), {})
  const nbaIdOf = new Map(matches.map((m) => [m.brefId, m.nbaId]))
  counts.id_map = matches.length + unmatched.length
  if (unmatched.length > 0)
    gaps.push([
      null,
      'id_map',
      `${unmatched.length} bref players with a 1998+ season have no NBA id match (listed with method unmatched); add to build/id-overrides.json`,
    ])
  const byMethod = new Map<string, number>()
  for (const m of matches) byMethod.set(m.method, (byMethod.get(m.method) ?? 0) + 1)
  log(
    `id_map: ${matches.length} matched (${[...byMethod].map(([k, v]) => `${k}=${v}`).join(' ')}), ${unmatched.length} unmatched`,
  )

  // ---- player seasons ---------------------------------------------------------------------------
  const totBy = seasonRows(totals)
  const advBy = seasonRows(bref.loadAdvanced(range))
  const shootBy = seasonRows(bref.loadShooting(range))
  const pbpBy = seasonRows(bref.loadPlayByPlay(range))
  const infoBy = seasonRows(bref.loadSeasonInfo(range))
  const psRows = all<{
    year_end: number
    player_id: string
    stint: number
    team_id: string
    advanced_json: string | null
    years_pro: number | null
  }>(
    db,
    `SELECT year_end, player_id, stint, team_id, advanced_json, years_pro FROM player_seasons
     WHERE season_type = 'regular' AND year_end BETWEEN ? AND ?`,
    [from, to],
  )
  const brefIdOf = new Map(matches.map((m) => [m.nbaId, m.brefId]))
  const psUpdates: (string | number | null)[][] = []
  let psMissing = 0
  const seen = new Set<string>()
  for (const r of psRows) {
    const bid = brefIdOf.get(r.player_id)
    const k = bid ? `${r.year_end}|${bid}` : ''
    const t = bid ? totBy.get(k) : undefined
    if (!t) {
      if (!seen.has(`${r.year_end}|${r.player_id}`)) psMissing++
      seen.add(`${r.year_end}|${r.player_id}`)
      continue
    }
    const a = advBy.get(k)
    const sh = shootBy.get(k)
    const pb = pbpBy.get(k)
    const info = infoBy.get(k)
    const advanced = r.advanced_json ? (JSON.parse(r.advanced_json) as Record<string, unknown>) : {}
    if (a)
      advanced.bref = {
        per: a.per,
        ts_pct: a.ts_percent,
        fg3a_rate: a.x3p_ar,
        ft_rate: a.f_tr,
        orb_pct: a.orb_percent,
        drb_pct: a.drb_percent,
        trb_pct: a.trb_percent,
        ast_pct: a.ast_percent,
        stl_pct: a.stl_percent,
        blk_pct: a.blk_percent,
        tov_pct: a.tov_percent,
        usg_pct: a.usg_percent,
        ows: a.ows,
        dws: a.dws,
        ws: a.ws,
        ws_48: a.ws_48,
        obpm: a.obpm,
        dbpm: a.dbpm,
        bpm: a.bpm,
        vorp: a.vorp,
      }
    const shooting = sh
      ? {
          avgDist: sh.avg_dist_fga,
          share0_3: sh.percent_fga_from_x0_3_range,
          share3_10: sh.percent_fga_from_x3_10_range,
          share10_16: sh.percent_fga_from_x10_16_range,
          share16_3p: sh.percent_fga_from_x16_3p_range,
          share3p: sh.percent_fga_from_x3p_range,
          pct0_3: sh.fg_percent_from_x0_3_range,
          pct3_10: sh.fg_percent_from_x3_10_range,
          pct10_16: sh.fg_percent_from_x10_16_range,
          pct16_3p: sh.fg_percent_from_x16_3p_range,
          pct3p: sh.fg_percent_from_x3p_range,
          assisted2p: sh.percent_assisted_x2p_fg,
          assisted3p: sh.percent_assisted_x3p_fg,
          dunkShare: sh.percent_dunks_of_fga,
          corner3Share: sh.percent_corner_3s_of_3pa,
        }
      : null
    const pbp = pb
      ? {
          posShares:
            pb.pg_percent === null
              ? null
              : {
                  pg: pctOrNull(pb.pg_percent) ?? 0,
                  sg: pctOrNull(pb.sg_percent) ?? 0,
                  sf: pctOrNull(pb.sf_percent) ?? 0,
                  pf: pctOrNull(pb.pf_percent) ?? 0,
                  c: pctOrNull(pb.c_percent) ?? 0,
                },
          onCourtNet: pb.on_court_plus_minus_per_100_poss,
          shootingFoulsDrawn: pb.shooting_foul_drawn,
          and1: pb.and1,
          fgaBlocked: pb.fga_blocked,
          badPassTov: pb.bad_pass_turnover,
          lostBallTov: pb.lost_ball_turnover,
          shootingFoulsCommitted: pb.shooting_foul_committed,
          offFoulsCommitted: pb.offensive_foul_committed,
        }
      : null
    const yearsPro =
      r.years_pro ??
      (info?.experience !== null && info?.experience !== undefined ? info.experience - 1 : null)
    psUpdates.push([
      t.gs,
      t.pos && t.pos !== '' ? t.pos : null,
      yearsPro,
      shooting ? JSON.stringify(shooting) : null,
      pbp ? JSON.stringify(pbp) : null,
      JSON.stringify(advanced),
      r.year_end,
      r.player_id,
      r.stint,
      r.team_id,
    ])
  }
  counts.player_seasons_bref = psUpdates.length
  if (psMissing > 0)
    gaps.push([
      null,
      'player_seasons',
      `${psMissing} NBA player-seasons have no bref row (unmatched id or missing from the dataset): gs, shooting_json, pbp_json stay null`,
    ])

  // ---- league zone baselines per season ---------------------------------------------------------
  // Box columns of the bref tables are computed keys, so the row type does not name them.
  const fgaOf = (s: bref.Totals) => (s as unknown as { fga: number | null }).fga ?? 0
  const fgaByStint = new Map(stints.map((s) => [`${s.season}|${s.player_id}|${s.team}`, fgaOf(s)]))
  interface ZoneAcc {
    fga: number
    rim: number
    close: number
    mid: number
    three: number
    rimM: number
    closeM: number
    midM: number
    threeM: number
    dist: number
  }
  const zone = new Map<number, ZoneAcc>()
  for (const sh of bref.loadShooting(range)) {
    if (bref.isTotalRow(sh.team)) continue
    const fga = fgaByStint.get(`${sh.season}|${sh.player_id}|${sh.team}`) ?? 0
    if (fga <= 0) continue
    let z = zone.get(sh.season)
    if (!z) {
      z = {
        fga: 0,
        rim: 0,
        close: 0,
        mid: 0,
        three: 0,
        rimM: 0,
        closeM: 0,
        midM: 0,
        threeM: 0,
        dist: 0,
      }
      zone.set(sh.season, z)
    }
    const rim = fga * (sh.percent_fga_from_x0_3_range ?? 0)
    const close = fga * (sh.percent_fga_from_x3_10_range ?? 0)
    const mid10 = fga * (sh.percent_fga_from_x10_16_range ?? 0)
    const mid16 = fga * (sh.percent_fga_from_x16_3p_range ?? 0)
    const three = fga * (sh.percent_fga_from_x3p_range ?? 0)
    z.fga += fga
    z.rim += rim
    z.close += close
    z.mid += mid10 + mid16
    z.three += three
    z.rimM += rim * (sh.fg_percent_from_x0_3_range ?? 0)
    z.closeM += close * (sh.fg_percent_from_x3_10_range ?? 0)
    z.midM +=
      mid10 * (sh.fg_percent_from_x10_16_range ?? 0) +
      mid16 * (sh.fg_percent_from_x16_3p_range ?? 0)
    z.threeM += three * (sh.fg_percent_from_x3p_range ?? 0)
    z.dist += fga * (sh.avg_dist_fga ?? 0)
  }
  const seasonShooting: [number, string][] = []
  for (const [y, z] of zone) {
    const f = z.fga || 1
    seasonShooting.push([
      y,
      JSON.stringify({
        share: { rim: z.rim / f, close: z.close / f, mid: z.mid / f, three: z.three / f },
        pct: {
          rim: z.rimM / (z.rim || 1),
          close: z.closeM / (z.close || 1),
          mid: z.midM / (z.mid || 1),
          three: z.threeM / (z.three || 1),
        },
        avgDist: z.dist / f,
      }),
    ])
  }
  counts.seasons_shooting = seasonShooting.length

  // ---- awards -------------------------------------------------------------------------------------
  const awardRows: (string | number | null)[][] = []
  const recipient = (brefId: string | null, name: string) => {
    const nba = brefId ? (nbaIdOf.get(brefId) ?? null) : null
    return { recipient: nba ?? brefId ?? name, player_id: nba }
  }
  let awardUnmatched = 0
  const pushAward = (
    yearEnd: number,
    award: string,
    brefId: string | null,
    name: string,
    rank: number | null,
    share: number | null,
  ) => {
    const r = recipient(brefId, name)
    if (r.player_id === null) awardUnmatched++
    awardRows.push([yearEnd, award, r.recipient, r.player_id, rank, share])
  }
  for (const a of loadAwardShares(range)) {
    const name = AWARD_NAMES[a.award]
    if (!name || a.winner !== true) continue
    pushAward(a.season, name, a.player_id, a.player, null, a.share)
  }
  for (const t of loadEndOfSeasonTeams(range)) {
    const name = TEAM_AWARD_NAMES[t.type]
    if (!name) continue
    pushAward(t.season, name, t.player_id, t.player, TEAM_RANK[t.number_tm] ?? null, null)
  }
  for (const s of loadAllStarSelections(range))
    pushAward(s.season, 'All-Star', s.player_id, s.player, null, null)
  counts.awards = awardRows.length
  if (awardUnmatched > 0)
    gaps.push([
      null,
      'awards',
      `${awardUnmatched} award rows whose bref id has no NBA match (player_id null)`,
    ])
  const awardSeasons = new Set(awardRows.map((r) => r[0] as number))
  for (let y = from; y <= to; y++)
    if (!awardRows.some((r) => r[0] === y && r[1] === 'MVP'))
      gaps.push([
        y,
        'awards',
        'no MVP/ROY/DPOY/All-NBA rows: the source dataset stops before this season',
      ])
  void awardSeasons

  // ---- salaries -----------------------------------------------------------------------------------
  const salaryRows = await loadAllSalaries(
    stints.map((s) => ({
      season: s.season,
      team: s.team,
      player: s.player,
      player_id: s.player_id,
    })),
  )
  const salaryInserts = new Map<string, (string | number | null)[]>()
  let salaryUnmatched = 0
  let salaryDupes = 0
  const history = new Map<string, Map<number, { amount: number; teamId: string | null }>>()
  const addSalary = (r: SalaryRow) => {
    if (r.salary <= 0 || r.season_end < from || r.season_end > to) return
    const nba = r.player_id ? (nbaIdOf.get(r.player_id) ?? null) : null
    if (!nba) {
      salaryUnmatched++
      return
    }
    const source = r.source === 'csv' ? 'bref' : 'wayback'
    const key = `${r.season_end}|${nba}|${source}`
    const teamId = teamIdOf(r.season_end, r.team)
    const prev = salaryInserts.get(key)
    if (prev) {
      salaryDupes++
      if ((prev[3] as number) >= r.salary) return
    }
    salaryInserts.set(key, [r.season_end, nba, teamId, r.salary, source])
    let h = history.get(nba)
    if (!h) {
      h = new Map()
      history.set(nba, h)
    }
    const cur = h.get(r.season_end)
    if (!cur || source === 'wayback' || cur.amount < r.salary)
      h.set(r.season_end, { amount: r.salary, teamId })
  }
  for (const r of salaryRows) addSalary(r)
  counts.salaries = salaryInserts.size
  if (salaryUnmatched > 0)
    gaps.push([
      null,
      'salaries',
      `${salaryUnmatched} salary rows dropped: no NBA id (bref CSV has names only; see open/COVERAGE.md)`,
    ])
  if (salaryDupes > 0)
    gaps.push([
      null,
      'salaries',
      `${salaryDupes} duplicate player-season salary rows collapsed to the larger amount`,
    ])
  gaps.push([
    null,
    'salaries',
    '2020-21 onward lists standard contracts only (two-way, Exhibit 10, 10-day absent)',
  ])

  // ---- contracts ----------------------------------------------------------------------------------
  const draftBy = new Map(
    all<{ player_id: string; draft_year: number | null; draft_round: number | null }>(
      db,
      'SELECT player_id, draft_year, draft_round FROM players',
    ).map((p) => [p.player_id, p]),
  )
  const kindOf = (nba: string, yearEnd: number, amount: number) => {
    const d = draftBy.get(nba)
    const era = ERA[yearEnd]
    if (!era) throw new Error(`no era rules for ${yearEnd}`)
    return contractKind({
      amount,
      yearEnd,
      draftYear: d?.draft_year ?? null,
      draftRound: d?.draft_round ?? null,
      minSalary0yr: era.min_salary_0yr,
      minSalary10yr: era.min_salary_10yr,
      // The scale for a draft is filed under the season that ended with it.
      rookieScalePick1: d?.draft_year ? (ERA[d.draft_year]?.rookie_scale_pick1 ?? null) : null,
    })
  }
  const contractRows: (string | number | null)[][] = []
  const waybackSeasons = new Set(WAYBACK_SEASONS.filter((y) => y >= from && y <= to))
  let contractsNoTeam = 0
  for (const y of waybackSeasons) {
    const page = await loadWaybackContracts(y)
    if (!page) {
      gaps.push([y, 'contracts', 'no Wayback snapshot near opening night'])
      continue
    }
    for (const row of page.rows) {
      const nba = row.player_id ? (nbaIdOf.get(row.player_id) ?? null) : null
      if (!nba) continue
      const years = row.seasons
        .filter((s) => s.season_end >= y && s.salary > 0)
        .sort((a, b) => a.season_end - b.season_end)
        .map((s) => ({
          yearEnd: s.season_end,
          amount: s.salary,
          option: s.option,
          guaranteed: true,
        }))
      const first = years[0]
      if (!first || first.yearEnd !== y) continue
      const teamId = teamIdOf(y, row.team)
      if (!teamId) {
        contractsNoTeam++
        continue
      }
      contractRows.push([
        y,
        nba,
        teamId,
        kindOf(nba, y, first.amount),
        JSON.stringify(years),
        'wayback',
      ])
    }
  }
  for (const [nba, h] of history) {
    for (const [y, s] of h) {
      if (waybackSeasons.has(y) || !s.teamId) continue
      const amounts = new Map([...h].map(([yy, v]) => [yy, v.amount]))
      const years = inferYears(amounts, y).map((x) => ({ ...x, option: null, guaranteed: true }))
      if (years.length === 0) continue
      contractRows.push([
        y,
        nba,
        s.teamId,
        kindOf(nba, y, s.amount),
        JSON.stringify(years),
        'inferred',
      ])
    }
  }
  counts.contracts = contractRows.length
  if (contractsNoTeam > 0)
    gaps.push([
      null,
      'contracts',
      `${contractsNoTeam} Wayback rows dropped: team code not in that season`,
    ])
  gaps.push([
    null,
    'contracts',
    `1997-98 to 2019-20 contracts are inferred from forward salary history (years while the next salary stays within ±20%, max 5); source 'inferred'. Options unknown.`,
  ])
  gaps.push([
    null,
    'contracts',
    'kind from the era table: minimum at or under the 10-year minimum, two_way under 75% of the 0-year minimum (2017-18+), rookie_scale within 4 seasons of a first-round pick and under 1.25 × the #1-pick scale; years of service are not used, so a 0-year player paid between the two minimums reads as standard',
  ])
  gaps.push([
    null,
    'contracts',
    'every contract year is marked guaranteed; partial guarantees are not in any free source',
  ])

  // ---- write --------------------------------------------------------------------------------------
  transaction(db, () => {
    db.exec('DELETE FROM id_map; DELETE FROM awards; DELETE FROM salaries; DELETE FROM contracts')
    db.prepare(
      "DELETE FROM pipeline_gaps WHERE table_name IN ('id_map','awards','salaries','contracts') OR reason LIKE '%bref%'",
    ).run()
    const idIns = prepareInsert(
      db,
      'id_map',
      ['nba_id', 'bref_id', 'name', 'method'],
      'INSERT OR IGNORE',
    )
    for (const m of matches) idIns.run(m.nbaId, m.brefId, m.name, m.method)
    for (const u of unmatched) idIns.run(null, u.brefId, u.name, 'unmatched')
    const pUpd = db.prepare(
      `UPDATE players SET bref_id = ?, hof = ?, birth_date = COALESCE(birth_date, ?),
         height_in = COALESCE(height_in, ?), weight_lb = COALESCE(weight_lb, ?) WHERE player_id = ?`,
    )
    for (const m of matches) {
      const c = career.get(m.brefId)
      pUpd.run(
        m.brefId,
        c?.hof ? 1 : 0,
        c?.birth_date ?? null,
        c?.ht_in_in ?? null,
        c?.wt ?? null,
        m.nbaId,
      )
    }
    const tUpd = db.prepare(
      'UPDATE team_seasons SET bref_abbr = ? WHERE year_end = ? AND team_id = ?',
    )
    for (const [k, abbr] of brefAbbrOf) {
      const [y, id] = k.split('|') as [string, string]
      tUpd.run(abbr, Number(y), id)
    }
    const psUpd = db.prepare(
      `UPDATE player_seasons SET gs = ?, pos = COALESCE(?, pos), years_pro = ?, shooting_json = ?, pbp_json = ?,
         advanced_json = ? WHERE year_end = ? AND player_id = ? AND stint = ? AND team_id = ? AND season_type = 'regular'`,
    )
    for (const u of psUpdates) psUpd.run(...u)
    const sUpd = db.prepare('UPDATE seasons SET shooting_json = ? WHERE year_end = ?')
    for (const [y, json] of seasonShooting) sUpd.run(json, y)
    const aIns = prepareInsert(db, 'awards', [
      'year_end',
      'award',
      'recipient',
      'player_id',
      'team_rank',
      'share',
    ])
    for (const r of awardRows) aIns.run(...r)
    const sIns = prepareInsert(db, 'salaries', [
      'year_end',
      'player_id',
      'team_id',
      'amount',
      'source',
    ])
    for (const r of salaryInserts.values()) sIns.run(...r)
    const cIns = prepareInsert(db, 'contracts', [
      'year_end',
      'player_id',
      'team_id',
      'kind',
      'years_json',
      'source',
    ])
    for (const r of contractRows) cIns.run(...r)
    const gIns = prepareInsert(db, 'pipeline_gaps', ['year_end', 'table_name', 'reason'])
    for (const g of gaps) gIns.run(...g)
  })
  log(
    `bref: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')} ${(performance.now() - t0).toFixed(0)}ms`,
  )
  return counts
}
