// Pipeline CLI. From the repo root:
//   npm run pipeline -- <fetch|load|bundles|report|all> [--from 1998] [--to 2027]
// Set HOOPS_DATA_DIR to share the raw cache across worktrees and HOOPS_OFFLINE=1 to forbid fetching.

import { rmSync } from 'node:fs'
import { writeBundles } from './build/bundle.ts'
import { loadNba } from './build/load-nba.ts'
import { writeReport } from './build/report.ts'
import { openDb } from './db/db.ts'
import { main as fetchAll } from './nba/fetchAll.ts'
import { downloadAll } from './open/download.ts'
import { BUNDLES_DIR, DB_PATH, REPORT_PATH } from './paths.ts'

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(name)
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN
  return Number.isFinite(v) ? v : undefined
}

const log = (line: string) => console.log(line)

async function run(step: string): Promise<void> {
  const from = arg('--from')
  const to = arg('--to')
  const range = { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) }
  const t0 = performance.now()
  if (step === 'fetch') {
    // Both halves, or a cold clone dies in `load`: the NBA API supplies the play, the open CSVs
    // supply salaries and the team-abbreviation map. Cached after the first run, so this is free
    // on every later one.
    await downloadAll()
    await fetchAll()
  } else if (step === 'load') {
    // A full load starts from an empty file so schema changes apply. A ranged load keeps the rest.
    if (from === undefined && to === undefined)
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
    const db = openDb()
    await loadNba(db, { ...range, log })
    db.close()
    log(`load: ${DB_PATH}`)
  } else if (step === 'bundles') {
    const db = openDb()
    const sizes = writeBundles(db, BUNDLES_DIR, { ...range, log })
    db.close()
    log(`bundles: ${BUNDLES_DIR} (${sizes.length} files)`)
  } else if (step === 'report') {
    const db = openDb()
    await writeReport(db, REPORT_PATH)
    db.close()
    log(`report: ${REPORT_PATH}`)
  } else {
    throw new Error(`unknown step ${step}`)
  }
  log(`${step} done in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
}

async function main(): Promise<void> {
  const step = process.argv[2] ?? 'all'
  const steps = step === 'all' ? ['fetch', 'load', 'bundles', 'report'] : [step]
  for (const s of steps) await run(s)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
