// Load every season from the stats.nba.com cache into sqlite. Re-runnable: each season's rows are
// deleted and rewritten. Player and draft tables are rebuilt at the end from everything seen.
//
// seasons.rules_json is the era table (packages/data/src/era). load-bref runs last and folds in the
// basketball-reference-derived data: id_map, bref_abbr, shooting/pbp, awards, salaries, contracts.

import type { DatabaseSync } from 'node:sqlite'
import { all, prepareInsert, transaction } from '../db/db.ts'
import { ERA } from '../era/era.ts'
import { seasonId } from '../nba/client.ts'
import { FIRST_SEASON, fetchTeamCoaches, fetchTeamIds, LAST_SEASON } from '../nba/endpoints.ts'
import * as nba from '../nba/parse.ts'
import { loadBref } from './load-bref.ts'
import { openingNightRosters } from './opening-night.ts'
import { champion, checkBracket, deriveSeries, type PlayoffGame, playoffSeeds } from './playoffs.ts'
import { BOX_KEYS, type BoxTotals, deriveStints } from './stints.ts'

export interface LoadOptions {
  from?: number
  to?: number
  log?: (line: string) => void
}

export interface SeasonLoad {
  yearEnd: number
  counts: Record<string, number>
  champion: string | null
  ms: number
}

/** Best-known bio per person, accumulated across seasons. Later seasons win. */
export interface Person {
  id: string
  name: string
  birthDate: string | null
  heightIn: number | null
  weightLb: number | null
  pos: string | null
  country: string | null
  college: string | null
  seen: number
}

type Gap = [yearEnd: number | null, table: string, reason: string]

const SEASON_TABLES = [
  'team_seasons',
  'player_seasons',
  'games',
  'player_games',
  'playoff_series',
  'coaches',
  'rosters',
  'pipeline_gaps',
]

function boxOf(r: nba.BoxLine): BoxTotals & { min: number } {
  const out = { min: r.min ?? 0 } as BoxTotals & { min: number }
  for (const k of BOX_KEYS) out[k] = r[k] ?? 0
  return out
}

function mode(xs: number[]): number {
  const c = new Map<number, number>()
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1)
  let best = 0
  let bestN = -1
  for (const [x, n] of c) if (n > bestN || (n === bestN && x > best)) [best, bestN] = [x, n]
  return best
}

function clearSeason(db: DatabaseSync, y: number): void {
  transaction(db, () => {
    for (const t of SEASON_TABLES) db.prepare(`DELETE FROM ${t} WHERE year_end = ?`).run(y)
    db.prepare('DELETE FROM seasons WHERE year_end = ?').run(y)
  })
}

export async function loadSeason(
  db: DatabaseSync,
  y: number,
  people: Map<string, Person>,
): Promise<SeasonLoad> {
  const t0 = performance.now()
  const [
    standings,
    teamTotals,
    teamAdvanced,
    teamGames,
    playerGames,
    bio,
    totals,
    per100,
    adv,
    ro,
  ] = await Promise.all([
    nba.standings(y),
    nba.teamTotals(y),
    nba.teamAdvanced(y),
    nba.teamGames(y),
    nba.playerGames(y),
    nba.playerBio(y),
    nba.playerTotals(y),
    nba.playerPer100(y),
    nba.playerAdvanced(y),
    nba.rosters(y),
  ])
  const gaps: Gap[] = []
  const counts: Record<string, number> = {}
  clearSeason(db, y)

  // ---- games: two log rows per game, home row has 'vs.' ---------------------------------------
  const byGame = new Map<string, nba.TeamGame[]>()
  for (const g of teamGames) {
    const list = byGame.get(g.game_id)
    if (list) list.push(g)
    else byGame.set(g.game_id, [g])
  }
  const abbrOf = new Map<string, string>()
  for (const g of teamGames)
    if (g.team_abbr && !abbrOf.has(String(g.team_id))) abbrOf.set(String(g.team_id), g.team_abbr)
  const gameRows: (string | number | null)[][] = []
  const playoffGames: PlayoffGame[] = []
  const gamesPerTeam = new Map<string, number>()
  let badGames = 0
  let neutralGames = 0
  for (const [gameId, rows] of byGame) {
    let home = rows.find((r) => r.home)
    let away = rows.find((r) => !r.home)
    if (rows.length === 2 && (!home || !away)) {
      // Neutral site (Paris, Mexico City, NBA Cup): both logs say '@'. Lower team id is the nominal home.
      neutralGames++
      const sorted = [...rows].sort((a, b) => a.team_id - b.team_id)
      home = sorted[0]
      away = sorted[1]
    }
    if (rows.length !== 2 || !home || !away) {
      badGames++
      continue
    }
    const homeId = String(home.team_id)
    const awayId = String(away.team_id)
    const hp = home.pts ?? 0
    const ap = away.pts ?? 0
    gameRows.push([
      gameId,
      y,
      home.game_date,
      home.season_type,
      homeId,
      awayId,
      hp,
      ap,
      JSON.stringify(boxOf(home)),
      JSON.stringify(boxOf(away)),
    ])
    if (home.season_type === 'regular') {
      gamesPerTeam.set(homeId, (gamesPerTeam.get(homeId) ?? 0) + 1)
      gamesPerTeam.set(awayId, (gamesPerTeam.get(awayId) ?? 0) + 1)
    }
    if (home.season_type === 'playoffs')
      playoffGames.push({
        gameId,
        date: home.game_date,
        homeTeamId: homeId,
        awayTeamId: awayId,
        homePts: hp,
        awayPts: ap,
      })
  }
  if (badGames > 0) gaps.push([y, 'games', `${badGames} games without a matched home/away pair`])
  if (neutralGames > 0)
    gaps.push([
      y,
      'games',
      `${neutralGames} neutral-site games (both logs '@'): lower team id set as nominal home`,
    ])
  if (y === 2020)
    gaps.push([
      y,
      'games',
      'bubble: home/away after 2020-07-30 is nominal (neutral site); games per team 64-75',
    ])

  // ---- playoff series and seeds ----------------------------------------------------------------
  let series: ReturnType<typeof deriveSeries> = []
  try {
    series = deriveSeries(playoffGames)
    for (const p of checkBracket(series)) gaps.push([y, 'playoff_series', p])
  } catch (e) {
    gaps.push([y, 'playoff_series', `derivation failed: ${(e as Error).message}`])
  }
  const confOf = new Map(standings.map((s) => [String(s.team_id), s.conference ?? '']))
  const seeds = playoffSeeds(
    standings.map((s) => ({
      teamId: String(s.team_id),
      conference: s.conference ?? '',
      confRank: s.playoff_rank,
    })),
    series,
  )
  const champ = champion(series)
  if (champ && series.length === 15) {
    const finals = series.find((s) => s.round === 4)
    if (finals && confOf.get(finals.highTeamId) === confOf.get(finals.lowTeamId))
      gaps.push([y, 'playoff_series', 'finals teams share a conference'])
  }

  // ---- team seasons -----------------------------------------------------------------------------
  const totalsByTeam = new Map(
    teamTotals.filter((t) => t.season_type === 'regular').map((t) => [String(t.team_id), t]),
  )
  const poByTeam = new Map(
    teamTotals.filter((t) => t.season_type === 'playoffs').map((t) => [String(t.team_id), t]),
  )
  const advByTeam = new Map(teamAdvanced.map((t) => [String(t.team_id), t]))
  const teamRows: (string | number | null)[][] = []
  for (const s of standings) {
    const id = String(s.team_id)
    const tot = totalsByTeam.get(id)
    const a = advByTeam.get(id)
    const po = poByTeam.get(id)
    const abbr = abbrOf.get(id) ?? bio.find((b) => String(b.team_id) === id)?.team_abbr ?? '???'
    if (!tot || !a) gaps.push([y, 'team_seasons', `${abbr}: missing team totals or advanced`])
    teamRows.push([
      y,
      id,
      abbr,
      null, // bref_abbr: Lane B
      s.team_name ?? '',
      s.team_city ?? '',
      s.conference ?? '',
      s.division ?? '',
      s.wins,
      s.losses,
      seeds.get(id) ?? null,
      JSON.stringify({
        conf_rank: s.playoff_rank,
        totals: tot ? { gp: tot.gp, ...boxOf(tot) } : null,
        advanced: a
          ? {
              gp: a.gp,
              pace: a.pace,
              poss: a.poss,
              off_rating: a.off_rating,
              def_rating: a.def_rating,
              net_rating: a.net_rating,
              ast_pct: a.ast_pct,
              oreb_pct: a.oreb_pct,
              dreb_pct: a.dreb_pct,
              tm_tov_pct: a.tm_tov_pct,
              efg_pct: a.efg_pct,
              ts_pct: a.ts_pct,
            }
          : null,
        playoffs: po ? { gp: po.gp, w: po.w, l: po.l, ...boxOf(po) } : null,
      }),
    ])
  }
  const teamIds = new Set(standings.map((s) => String(s.team_id)))

  // ---- player seasons: stints from game logs; per-100 and advanced are season-level -----------
  const regularLogs = playerGames.filter((g) => g.season_type === 'regular')
  const stints = deriveStints(regularLogs)
  const bioById = new Map(bio.map((b) => [String(b.player_id), b]))
  const per100ById = new Map(per100.map((p) => [String(p.player_id), p]))
  const advById = new Map(adv.map((p) => [String(p.player_id), p]))
  const rosterPos = new Map<string, string | null>()
  const rosterExp = new Map<string, number | null>()
  for (const r of ro) {
    if (rosterPos.has(String(r.player_id))) continue
    rosterPos.set(String(r.player_id), r.position)
    rosterExp.set(String(r.player_id), r.experience)
  }
  const psRows: (string | number | null)[][] = []
  let missingBio = 0
  for (const s of stints) {
    const b = bioById.get(s.playerId)
    if (!b) missingBio++
    const p = per100ById.get(s.playerId)
    const a = advById.get(s.playerId)
    // per100_json and advanced_json are the leaguedash season lines (all teams summed),
    // attached to every stint of the player. Per-stint rates are not available from stats.nba.com.
    psRows.push([
      y,
      s.playerId,
      s.teamId,
      s.order,
      'regular',
      b?.age ?? null,
      rosterPos.get(s.playerId) ?? null,
      rosterExp.get(s.playerId) ?? null,
      s.gp,
      null, // gs: not in leaguedash; load-bref fills it
      s.min,
      JSON.stringify(s.totals),
      p ? JSON.stringify(boxOf(p)) : null,
      a
        ? JSON.stringify({
            min_pg: a.min,
            off_rating: a.off_rating,
            def_rating: a.def_rating,
            net_rating: a.net_rating,
            ast_pct: a.ast_pct,
            ast_to: a.ast_to,
            ast_ratio: a.ast_ratio,
            oreb_pct: a.oreb_pct,
            dreb_pct: a.dreb_pct,
            reb_pct: a.reb_pct,
            tm_tov_pct: a.tm_tov_pct,
            efg_pct: a.efg_pct,
            ts_pct: a.ts_pct,
            usg_pct: a.usg_pct,
            pace: a.pace,
            pie: a.pie,
            poss: a.poss,
          })
        : null,
      null, // shooting_json: Lane B
    ])
  }
  if (missingBio > 0) gaps.push([y, 'player_seasons', `${missingBio} stints without a bio row`])
  for (const t of totals) {
    if (t.season_type !== 'playoffs') continue
    psRows.push([
      y,
      String(t.player_id),
      String(t.team_id),
      1,
      'playoffs',
      t.age,
      rosterPos.get(String(t.player_id)) ?? null,
      rosterExp.get(String(t.player_id)) ?? null,
      t.gp,
      null,
      t.min,
      JSON.stringify(boxOf(t)),
      null,
      null,
      null,
    ])
  }

  // ---- player games -----------------------------------------------------------------------------
  const pgRows: (string | number | null)[][] = playerGames.map((g) => [
    g.game_id,
    String(g.player_id),
    String(g.team_id),
    y,
    g.season_type,
    g.min,
    g.pts,
    g.fgm,
    g.fga,
    g.fg3m,
    g.fg3a,
    g.ftm,
    g.fta,
    g.oreb,
    g.dreb,
    g.ast,
    g.stl,
    g.blk,
    g.tov,
    g.pf,
  ])
  if (y >= 2020)
    gaps.push([y, 'player_games', 'play-in games: team logs only, no player logs cached'])

  // ---- rosters, coaches ------------------------------------------------------------------------
  const rosterRows: (string | number | null)[][] = ro.map((r) => [
    y,
    String(r.team_id),
    String(r.player_id),
    r.jersey,
    r.position,
    r.height_in,
    r.weight,
    r.birth_date,
    r.age,
    r.experience,
    r.school,
    r.how_acquired,
  ])
  if (y <= 2009) gaps.push([y, 'rosters', 'how_acquired null for every row (stats.nba.com)'])
  const stintKeys = new Set(stints.map((s) => `${s.playerId}:${s.teamId}`))
  const playedAny = new Set(stints.map((s) => s.playerId))
  const rosterNoGame = ro.filter(
    (r) => playedAny.has(String(r.player_id)) && !stintKeys.has(`${r.player_id}:${r.team_id}`),
  ).length
  if (rosterNoGame > 0)
    gaps.push([
      y,
      'rosters',
      `${rosterNoGame} roster rows for players who played that season but never for that team`,
    ])
  const coachRows: (string | number | null)[][] = []
  const seenCoach = new Set<string>()
  const teamsWithHead = new Set<string>()
  for (const teamId of await fetchTeamIds(y)) {
    for (const c of await fetchTeamCoaches(y, teamId)) {
      const name = String(c.COACH_NAME ?? '').trim()
      const role = String(c.COACH_TYPE ?? 'Coach')
      if (!name || seenCoach.has(`${teamId}:${name}`)) continue
      seenCoach.add(`${teamId}:${name}`)
      if (role === 'Head Coach') teamsWithHead.add(String(teamId))
      coachRows.push([y, String(teamId), name, role])
    }
  }
  const noHead = [...teamIds].filter((id) => !teamsWithHead.has(id)).length
  if (noHead > 0) gaps.push([y, 'coaches', `${noHead} teams without a head coach row`])

  // ---- opening-night overflow (same rule the bundle applies) -----------------------------------
  const on = openingNightRosters(
    stints.map((s) => ({
      playerId: s.playerId,
      teamId: s.teamId,
      order: s.order,
      gp: s.gp,
      min: s.min,
    })),
    ro.map((r) => ({ playerId: String(r.player_id), teamId: String(r.team_id) })),
  )
  if (on.dropped.length > 0)
    gaps.push([
      y,
      'bundle',
      `${on.dropped.length} first-stint players beyond the 20-man opening-night cap dropped from the bundle`,
    ])

  // ---- people accumulator ----------------------------------------------------------------------
  const rosterById = new Map(ro.map((r) => [String(r.player_id), r]))
  const names = new Map<string, string>()
  for (const g of playerGames) names.set(String(g.player_id), g.player_name)
  for (const b of bio) names.set(String(b.player_id), b.player_name)
  for (const r of ro) names.set(String(r.player_id), r.player_name)
  for (const [id, name] of names) {
    const b = bioById.get(id)
    const r = rosterById.get(id)
    const prev = people.get(id)
    if (prev && prev.seen > y) continue
    people.set(id, {
      id,
      name,
      birthDate: r?.birth_date ?? prev?.birthDate ?? null,
      heightIn: b?.height_in ?? r?.height_in ?? prev?.heightIn ?? null,
      weightLb: b?.weight ?? r?.weight ?? prev?.weightLb ?? null,
      pos: r?.position ?? prev?.pos ?? null,
      country: b?.country ?? prev?.country ?? null,
      college: b?.college ?? r?.school ?? prev?.college ?? null,
      seen: y,
    })
  }

  // ---- era rules: schedule length and team count must agree with the hand-curated table ----------
  const era = ERA[y] ?? null
  const gamesPerTeamMode = mode([...gamesPerTeam.values()])
  if (!era) gaps.push([y, 'seasons', 'no era rules for this season; rules_json is {}'])
  else {
    if (era.games !== gamesPerTeamMode)
      gaps.push([
        y,
        'seasons',
        `games per team: schedule ${gamesPerTeamMode} (kept) vs era table ${era.games}`,
      ])
    if (era.teams !== standings.length)
      gaps.push([
        y,
        'seasons',
        `teams: standings ${standings.length} (kept) vs era table ${era.teams}`,
      ])
  }

  // ---- write ------------------------------------------------------------------------------------
  transaction(db, () => {
    const run = (table: string, cols: string[], rows: (string | number | null)[][]) => {
      const stmt = prepareInsert(db, table, cols)
      for (const r of rows) stmt.run(...r)
      counts[table] = rows.length
    }
    db.prepare(
      'INSERT INTO seasons (year_end, season_id, games, teams, rules_json) VALUES (?, ?, ?, ?, ?)',
    ).run(y, seasonId(y), gamesPerTeamMode, standings.length, era ? JSON.stringify(era) : '{}')
    counts.seasons = 1
    run(
      'team_seasons',
      [
        'year_end',
        'team_id',
        'abbr',
        'bref_abbr',
        'name',
        'city',
        'conference',
        'division',
        'wins',
        'losses',
        'playoff_seed',
        'stats_json',
      ],
      teamRows,
    )
    run(
      'games',
      [
        'game_id',
        'year_end',
        'date',
        'season_type',
        'home_team_id',
        'away_team_id',
        'home_pts',
        'away_pts',
        'home_box_json',
        'away_box_json',
      ],
      gameRows,
    )
    run(
      'playoff_series',
      [
        'year_end',
        'round',
        'high_team_id',
        'low_team_id',
        'winner_team_id',
        'high_wins',
        'low_wins',
      ],
      series.map((s) => [
        y,
        s.round,
        s.highTeamId,
        s.lowTeamId,
        s.winnerTeamId,
        s.highWins,
        s.lowWins,
      ]),
    )
    run(
      'player_seasons',
      [
        'year_end',
        'player_id',
        'team_id',
        'stint',
        'season_type',
        'age',
        'pos',
        'years_pro',
        'gp',
        'gs',
        'min',
        'totals_json',
        'per100_json',
        'advanced_json',
        'shooting_json',
      ],
      psRows,
    )
    run(
      'player_games',
      [
        'game_id',
        'player_id',
        'team_id',
        'year_end',
        'season_type',
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
      ],
      pgRows,
    )
    run(
      'rosters',
      [
        'year_end',
        'team_id',
        'player_id',
        'jersey',
        'pos',
        'height_in',
        'weight_lb',
        'birth_date',
        'age',
        'experience',
        'school',
        'how_acquired',
      ],
      rosterRows,
    )
    run('coaches', ['year_end', 'team_id', 'name', 'role'], coachRows)
    run('pipeline_gaps', ['year_end', 'table_name', 'reason'], gaps)
  })
  return { yearEnd: y, counts, champion: champ, ms: performance.now() - t0 }
}

/** Players and draft picks from the once-only endpoints plus everything the seasons saw. */
export async function loadPeople(db: DatabaseSync, people: Map<string, Person>): Promise<void> {
  const [allPlayers, draft] = await Promise.all([nba.allPlayers(), nba.draft()])
  const span = new Map(allPlayers.map((a) => [String(a.person_id), a]))
  const draftById = new Map<string, nba.DraftPick>()
  for (const d of draft)
    if (!draftById.has(String(d.person_id))) draftById.set(String(d.person_id), d)
  // Bio draft fields as a fallback for players the draft table does not list.
  const bioDraft = new Map<
    string,
    { year: number | null; round: number | null; pick: number | null }
  >()
  for (const y of all<{ year_end: number }>(db, 'SELECT year_end FROM seasons ORDER BY year_end')) {
    for (const b of await nba.playerBio(y.year_end))
      if (b.draft_year !== null)
        bioDraft.set(String(b.player_id), {
          year: b.draft_year,
          round: b.draft_round,
          pick: b.draft_number,
        })
  }
  const ids = new Set<string>([...people.keys(), ...span.keys()])
  for (const d of draft) if (d.season >= 1997) ids.add(String(d.person_id))
  transaction(db, () => {
    db.exec('DELETE FROM players; DELETE FROM draft_picks')
    const ins = prepareInsert(db, 'players', [
      'player_id',
      'bref_id',
      'name',
      'birth_date',
      'height_in',
      'weight_lb',
      'pos',
      'draft_year',
      'draft_round',
      'draft_pick',
      'from_year',
      'to_year',
      'hof',
      'country',
      'college',
    ])
    for (const id of ids) {
      const p = people.get(id)
      const a = span.get(id)
      const d = draftById.get(id)
      const bd = bioDraft.get(id)
      const name = p?.name ?? a?.name ?? d?.player_name
      if (!name) continue
      ins.run(
        id,
        null, // bref_id: Lane B via id_map
        name,
        p?.birthDate ?? null,
        p?.heightIn ?? null,
        p?.weightLb ?? null,
        p?.pos ?? null,
        d?.season ?? bd?.year ?? null,
        d?.round_number ?? bd?.round ?? null,
        d?.overall_pick ?? bd?.pick ?? null,
        a?.from_year !== undefined && a.from_year !== null ? a.from_year + 1 : null,
        a?.to_year !== undefined && a.to_year !== null ? a.to_year + 1 : null,
        0,
        p?.country ?? d?.organization ?? null,
        p?.college ?? null,
      )
    }
    const dp = prepareInsert(db, 'draft_picks', [
      'draft_year',
      'round',
      'pick',
      'overall',
      'team_id',
      'player_id',
      'player_name',
      'college',
    ])
    for (const d of draft) {
      if (d.overall_pick === null || d.round_number === null || d.round_pick === null) continue
      dp.run(
        d.season,
        d.round_number,
        d.round_pick,
        d.overall_pick,
        String(d.team_id),
        String(d.person_id),
        d.player_name,
        d.organization,
      )
    }
    db.prepare('DELETE FROM pipeline_gaps WHERE year_end IS NULL').run()
    const gap = prepareInsert(db, 'pipeline_gaps', ['year_end', 'table_name', 'reason'])
    for (const [table, reason] of GLOBAL_GAPS) gap.run(null, table, reason)
    const noBirth = all<{ c: number }>(
      db,
      `SELECT COUNT(*) AS c FROM players p WHERE p.birth_date IS NULL
       AND EXISTS (SELECT 1 FROM player_seasons s WHERE s.player_id = p.player_id)`,
    )[0]?.c
    if (noBirth)
      gap.run(
        null,
        'players',
        `${noBirth} players with games but no birth date (never on a season-end roster); bundle age falls back to the leaguedash bio age`,
      )
  })
}

/** Holes that are not per season. */
export const GLOBAL_GAPS: [table: string, reason: string][] = [
  ['players', 'from_year/to_year come from commonallplayers (career span, not just 1998+)'],
  [
    'bundle',
    'yearsWithTeam counts only seasons in the data window (0 for everyone in 1997-98); yearsPro uses roster EXP, else bref experience, else seasons in window plus the career span before it',
  ],
  [
    'bundle',
    'pos is the bref PG/SG/SF/PF/C where matched; otherwise the NBA G/F/C string is mapped by height (bundle.ts toPosition)',
  ],
  [
    'player_seasons',
    'per100_json, advanced_json, shooting_json and pbp_json are season-level lines copied onto every stint',
  ],
  ['injuries', 'no free bulk source proven'],
  ['draft_picks', 'future traded picks unknown; every team owns its own picks'],
  [
    'games',
    'play-in team logs are empty before 2019-20 because the play-in did not exist (not a gap)',
  ],
]

export async function loadNba(db: DatabaseSync, opts: LoadOptions = {}): Promise<SeasonLoad[]> {
  const from = opts.from ?? FIRST_SEASON
  const to = opts.to ?? LAST_SEASON
  const log = opts.log ?? (() => {})
  const people = new Map<string, Person>()
  const out: SeasonLoad[] = []
  for (let y = from; y <= to; y++) {
    const s = await loadSeason(db, y, people)
    out.push(s)
    log(
      `${seasonId(y)} ${Object.entries(s.counts)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')} champion=${s.champion ?? '-'} ${s.ms.toFixed(0)}ms`,
    )
  }
  const t0 = performance.now()
  await loadPeople(db, people)
  log(`people+draft ${(performance.now() - t0).toFixed(0)}ms`)
  await loadBref(db, { from, to, log })
  return out
}
