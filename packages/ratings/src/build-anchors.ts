// Regenerate src/anchors.json: the frozen pooled distribution every rating is measured against.
//
//   npm run ratings:anchors
//
// Reads every season bundle, turns each player-season into relative proxies (raw ÷ that season's
// league mean), pools them across all seasons weighted by minutes, and stores mean + sd per proxy.
// Run it again only when the data pipeline or the proxy definitions change — the numbers moving
// means every historical rating moves with them.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SeasonBundle } from '@hoops/core'
import { meanByProxy, relativeProxies } from './index.ts'
import {
  leaguePriorsFrom,
  minuteWeight,
  PROXY_KEYS,
  type ProxyInput,
  type ProxyKey,
  rawProxies,
} from './proxies.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const bundleDir = join(dataDir, 'bundles')
const outFile = new URL('./anchors.json', import.meta.url).pathname

/** Weighted mean and sd, with the tails trimmed so one freak season cannot set the scale. */
function weightedStats(values: readonly { v: number; w: number }[]): { mean: number; sd: number } {
  const sorted = [...values].sort((a, b) => a.v - b.v)
  const lo = Math.floor(sorted.length * 0.01)
  const hi = Math.ceil(sorted.length * 0.99)
  const kept = sorted.slice(lo, hi)
  let wsum = 0
  let num = 0
  for (const { v, w } of kept) {
    num += v * w
    wsum += w
  }
  const mean = wsum > 0 ? num / wsum : 1
  let varNum = 0
  for (const { v, w } of kept) varNum += w * (v - mean) ** 2
  const sd = wsum > 0 ? Math.sqrt(varNum / wsum) : 0.2
  return { mean, sd: sd > 1e-6 ? sd : 0.2 }
}

function main(): void {
  const files = readdirSync(bundleDir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort()
  if (files.length === 0) throw new Error(`no season bundles in ${bundleDir}`)

  const pooled = {} as Record<ProxyKey, { v: number; w: number }[]>
  for (const k of PROXY_KEYS) pooled[k] = []
  let players = 0

  for (const f of files) {
    const bundle = JSON.parse(readFileSync(join(bundleDir, f), 'utf8')) as SeasonBundle
    const seasonGames = Math.max(50, ...bundle.players.map((p) => p.real?.gp ?? 0))
    const inputs: ProxyInput[] = bundle.players.map((p) => ({
      playerId: p.playerId,
      pos: p.pos,
      age: p.age,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      stats: p.real,
      teamGames: seasonGames,
    }))
    const priors = leaguePriorsFrom(inputs)
    const raws = inputs.map((p) => rawProxies(p, priors))
    const leagueMean = meanByProxy(raws, inputs)
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i] as ProxyInput
      const w = minuteWeight(input.stats?.min ?? 0)
      if (w <= 0.05) continue // ignore garbage-time seasons entirely
      players++
      const rel = relativeProxies(raws[i] as Record<ProxyKey, number | null>, leagueMean)
      for (const k of PROXY_KEYS) {
        const v = rel[k]
        if (v != null && Number.isFinite(v)) pooled[k].push({ v, w })
      }
    }
  }

  const anchors = {} as Record<ProxyKey, { mean: number; sd: number }>
  for (const k of PROXY_KEYS) anchors[k] = weightedStats(pooled[k])

  writeFileSync(outFile, `${JSON.stringify(anchors, null, 2)}\n`)
  console.log(`anchors from ${files.length} seasons, ${players} player-seasons → ${outFile}`)
  for (const k of PROXY_KEYS)
    console.log(
      `  ${k.padEnd(11)} mean ${anchors[k].mean.toFixed(3)}  sd ${anchors[k].sd.toFixed(3)}  n ${pooled[k].length}`,
    )
}

main()
