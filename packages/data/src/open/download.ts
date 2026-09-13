// Fetch every open CSV we rely on into data/raw/github/sumitrodatta/<repo>/<file>.
// Idempotent: cachedFetch never refetches a cached key.
// Run: npx tsx packages/data/src/open/download.ts

import { cachedFetch, cachePath, isCached } from '../fetch.ts'
import { currentContractsCached, ensureCurrentContracts } from './contracts-current.ts'

export const GITHUB_SOURCE = 'github'

export interface OpenCsv {
  owner: string
  repo: string
  branch: string
  /** Path inside the repo, may contain spaces. */
  path: string
}

export const BREF_DATASETS_FILES = [
  'Advanced.csv',
  'All-Star Selections.csv',
  'Draft Pick History.csv',
  'End of Season Teams.csv',
  'End of Season Teams (Voting).csv',
  'Per 100 Poss.csv',
  'Per 36 Minutes.csv',
  'Player Award Shares.csv',
  'Player Career Info.csv',
  'Player Per Game.csv',
  'Player Play By Play.csv',
  'Player Season Info.csv',
  'Player Shooting.csv',
  'Player Totals.csv',
  'Team Abbrev.csv',
  'Team Stats Per 100 Poss.csv',
  'Team Stats Per Game.csv',
  'Team Summaries.csv',
  'Team Totals.csv',
  'Opponent Stats Per 100 Poss.csv',
  'Opponent Totals.csv',
] as const

export const SALARY_FILES = ['Player Salaries.csv', 'Team Abbrev.csv'] as const

export const OPEN_CSVS: OpenCsv[] = [
  ...BREF_DATASETS_FILES.map((f) => ({
    owner: 'sumitrodatta',
    repo: 'bball-reference-datasets',
    branch: 'master',
    path: `Data/${f}`,
  })),
  ...SALARY_FILES.map((f) => ({
    owner: 'sumitrodatta',
    repo: 'nba-player-salaries',
    branch: 'main',
    path: f,
  })),
]

export function rawUrl(c: OpenCsv): string {
  const p = c.path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${p}`
}

/** Cache key: owner/repo/<basename>. Folder prefix inside the repo is dropped. */
export function cacheKey(c: OpenCsv): string {
  const base = c.path.split('/').pop() as string
  return `${c.owner}/${c.repo}/${base}`
}

/** Fetch one CSV (cached). Rejects HTML bodies so a 404 page never lands in the cache. */
export async function fetchCsv(c: OpenCsv): Promise<string> {
  return cachedFetch(GITHUB_SOURCE, cacheKey(c), rawUrl(c), {
    validate: (b) => !b.trimStart().startsWith('<') && b.includes(','),
  })
}

/** Find a registered CSV by repo and basename. */
export function findCsv(repo: string, base: string): OpenCsv {
  const c = OPEN_CSVS.find((x) => x.repo === repo && x.path.endsWith(base))
  if (!c) throw new Error(`unknown csv ${repo}/${base}`)
  return c
}

export async function downloadAll(): Promise<void> {
  for (const c of OPEN_CSVS) {
    const had = isCached(GITHUB_SOURCE, cacheKey(c))
    const body = await fetchCsv(c)
    const lines = body.split('\n').length - 1
    console.log(`${had ? 'cached ' : 'fetched'} ${cacheKey(c)} ${body.length} bytes ${lines} lines`)
  }
  try {
    const had = currentContractsCached()
    const page = await ensureCurrentContracts()
    console.log(
      `${had ? 'cached ' : 'fetched'} bref/contracts-players.html y1=${page.columns.y1} ${page.rows.length} rows`,
    )
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    console.log(`bref/contracts-players.html SKIP ${reason.slice(0, 200)}`)
  }
  console.log(`cache dir: ${cachePath(GITHUB_SOURCE, 'sumitrodatta')}`)
}

if (process.argv[1]?.endsWith('download.ts')) {
  downloadAll().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
