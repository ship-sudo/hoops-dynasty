// npm run dynasty -- --start 2003 --team SAS --seasons 20 --seed 1
// Loads a bundle from data/bundles, injects the naive engine, sims N seasons, prints one table.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { HistoryBundle, SeasonBundle, SimulateGame } from '@hoops/core'
import { ERA } from '@hoops/data'
import { simulateGame } from '@hoops/engine/naive'
import { allCareers, leagueRecords, totalsOf } from './history.ts'
import { newGame } from './newgame.ts'
import { simSeason } from './sim.ts'
import type { GameHooks } from './state.ts'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : dflt
}

const start = Number(arg('start', '2004'))
const seasons = Number(arg('seasons', '5'))
const seed = Number(arg('seed', '1'))
const bundlesDir = arg('bundles', path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles'))
const bundle = JSON.parse(
  readFileSync(path.join(bundlesDir, `${start}.json`), 'utf8'),
) as SeasonBundle
let history: HistoryBundle | null = null
try {
  history = JSON.parse(readFileSync(path.join(bundlesDir, 'history.json'), 'utf8')) as HistoryBundle
} catch {
  history = null
}
// --team takes a tricode (SAS) or a raw team id.
const wanted = arg('team', bundle.teams[0]?.abbr ?? '')
const team =
  bundle.teams.find((t) => t.teamId === wanted || t.abbr === wanted)?.teamId ??
  (() => {
    throw new Error(`no team ${wanted} in ${bundle.seasonId}`)
  })()
const abbr = new Map(bundle.teams.map((t) => [t.teamId, t.abbr]))
const ab = (id: string | null | undefined) => (id ? (abbr.get(id) ?? id) : '-')

const hooks: GameHooks = {
  engine: simulateGame as SimulateGame,
  // Real rules per season while the era table has them; frozen with 7% money growth after 2025-26.
  // League baselines stay on the bundle's EraContext: those come from the database, not this table.
  nextSeason: (yearEnd) => (ERA[yearEnd] ? { rules: ERA[yearEnd] } : null),
}
let state = newGame(bundle, team, seed, { history })
const t0 = Date.now()

const rows: string[] = []
for (let i = 0; i < seasons; i++) {
  const id = state.season.seasonId
  const r = simSeason(state, hooks)
  state = r.state
  const s = r.summary
  if (!s) break
  const mvp = s.awards?.mvp
  rows.push(
    [
      id.padEnd(8),
      ab(s.championTeamId).padEnd(4),
      ab(s.runnerUpTeamId).padEnd(4),
      `${ab(s.bestRecord?.teamId)} ${s.bestRecord?.wins ?? 0}-${s.bestRecord?.losses ?? 0}`.padEnd(
        12,
      ),
      `${mvp?.name ?? '-'} (${ab(mvp?.teamId)})`,
    ].join('  '),
  )
}

console.log(`${bundle.seasonId} -> ${seasons} seasons, team ${ab(team)}, seed ${seed}`)
console.log(['season  ', 'chmp', 'rnup', 'best record ', 'MVP'].join('  '))
for (const r of rows) console.log(r)
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`)

// What the league remembers when it is over. The default hooks never retire anybody, so this is a
// check on the career store and the record book, not on the hall of fame.
const careers = allCareers(state)
const book = leagueRecords(state, 3)
const saveBytes = JSON.stringify(state).length
const careerBytes = JSON.stringify(state.careers ?? {}).length
console.log(
  `\n${careers.length} careers on file · ${careers.reduce((n, c) => n + c.seasons.length, 0)} season lines · ` +
    `${(careerBytes / 1024).toFixed(0)} KB of a ${(saveBytes / 1024 / 1024).toFixed(1)} MB save · ` +
    `${(state.hallOfFame ?? []).length} in the hall of fame`,
)
for (const leader of book.career.pts?.slice(0, 3) ?? []) {
  const c = careers.find((x) => x.playerId === leader.playerId)
  const t = c ? totalsOf(c.seasons) : null
  console.log(
    `  ${leader.name.padEnd(24)} ${String(leader.value).padStart(6)} pts` +
      (t ? ` in ${t.seasons} seasons · ${t.titles} title(s) · ${t.allNba} All-NBA` : ''),
  )
}
const high = book.game.pts
if (high) console.log(`  single game: ${high.name} ${high.value} on ${high.date}`)
