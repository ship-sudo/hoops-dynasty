// npm run calibrate -- --seasons 1998,2004,2010,2016,2026 --runs 100 [--minutes real|model] [--engine naive|<path>] [--out CALIBRATION.md]
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SeasonBundle, SimulateGame } from '@hoops/core'
import { computeMetrics } from './metrics.ts'
import type { MinutesMode } from './minutes.ts'
import { renderReport } from './report.ts'
import { simSeason } from './season.ts'

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : dflt
}

const seasons = arg('seasons', '1998,2004,2010,2016,2026').split(',').map(Number)
const runs = Number(arg('runs', '100'))
const minutes = arg('minutes', 'real') as MinutesMode
const engineArg = arg('engine', 'engine')
const bundlesDir = arg('bundles', path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles'))
const out = arg('out', 'CALIBRATION.md')

const engineMod =
  engineArg === 'naive'
    ? await import('@hoops/engine/naive')
    : engineArg === 'engine'
      ? await import('@hoops/engine')
      : await import(path.resolve(engineArg))
const engine = engineMod.simulateGame as SimulateGame

const t0 = Date.now()
const all = []
for (const y of seasons) {
  const bundle = JSON.parse(
    readFileSync(path.join(bundlesDir, `${y}.json`), 'utf8'),
  ) as SeasonBundle
  const ts = Date.now()
  const sims = []
  for (let r = 0; r < runs; r++) sims.push(simSeason(bundle, engine, y * 1000 + r, minutes))
  const m = computeMetrics(bundle, sims, engine)
  all.push(m)
  console.log(
    `${y}: ${runs} runs in ${((Date.now() - ts) / 1000).toFixed(1)} s, win r ${m.winCorrExpected.toFixed(3)}, ${m.outOfBand.length} out of band`,
  )
  for (const o of m.outOfBand) console.log(`   - ${o}`)
}
writeFileSync(out, renderReport(engineArg, minutes, all, Date.now() - t0))
console.log(`wrote ${out}`)
