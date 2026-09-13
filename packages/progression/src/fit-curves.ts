// Fit age curves from what actually happened: npm run progression:curves
//
// Walks every real career in data/bundles/history.json, takes each pair of consecutive seasons,
// and records how each rating moved at that age. The result is curves.json: the mean and sd of the
// year-over-year change per rating per age, minutes-weighted, plus how often players at each age
// disappeared from the league (the retirement base rate).
//
// This is the empirical spine of development. The model in index.ts adds potential and noise on top.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type HistoryBundle, RATING_KEYS, type Ratings } from '@hoops/core'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const historyFile = join(dataDir, 'bundles', 'history.json')
const outFile = new URL('./curves.json', import.meta.url).pathname

export const MIN_AGE = 18
export const MAX_AGE = 44

interface Bucket {
  n: number
  wsum: number
  sums: Record<string, number>
  sqs: Record<string, number>
}

function bucket(): Bucket {
  const sums: Record<string, number> = {}
  const sqs: Record<string, number> = {}
  for (const k of RATING_KEYS) {
    sums[k] = 0
    sqs[k] = 0
  }
  return { n: 0, wsum: 0, sums, sqs }
}

function main(): void {
  const history = JSON.parse(readFileSync(historyFile, 'utf8')) as HistoryBundle
  const byAge = new Map<number, Bucket>()
  const appear = new Map<number, number>()
  const survive = new Map<number, number>()

  for (const career of history.careers) {
    const seasons = [...career.seasons].sort((a, b) => a.yearEnd - b.yearEnd)
    for (let i = 0; i < seasons.length; i++) {
      const cur = seasons[i]
      if (!cur) continue
      const age = Math.round(cur.age)
      if (age < MIN_AGE || age > MAX_AGE) continue
      appear.set(age, (appear.get(age) ?? 0) + 1)

      const next = seasons[i + 1]
      // Careers that are still running at the end of the data are not retirements.
      const isLastInData = cur.yearEnd >= 2026
      if (next && next.yearEnd === cur.yearEnd + 1) survive.set(age, (survive.get(age) ?? 0) + 1)
      else if (isLastInData) appear.set(age, (appear.get(age) ?? 0) - 1)

      if (!next || next.yearEnd !== cur.yearEnd + 1) continue
      // Weight by the smaller of the two workloads: a 5-minute season says little about growth.
      const w = Math.min(cur.mpg * cur.gp, next.mpg * next.gp) / 1500
      if (w < 0.15) continue
      let b = byAge.get(age)
      if (!b) {
        b = bucket()
        byAge.set(age, b)
      }
      b.n++
      b.wsum += w
      for (const k of RATING_KEYS) {
        const d = (next.ratings[k] ?? 50) - (cur.ratings[k] ?? 50)
        b.sums[k] = (b.sums[k] ?? 0) + d * w
        b.sqs[k] = (b.sqs[k] ?? 0) + d * d * w
      }
    }
  }

  const curves: Record<
    string,
    { n: number; retireRate: number; delta: Record<string, number>; sd: Record<string, number> }
  > = {}
  for (let age = MIN_AGE; age <= MAX_AGE; age++) {
    const b = byAge.get(age)
    const seen = appear.get(age) ?? 0
    const stayed = survive.get(age) ?? 0
    const delta: Record<string, number> = {}
    const sd: Record<string, number> = {}
    for (const k of RATING_KEYS) {
      if (!b || b.wsum <= 0) {
        delta[k] = 0
        sd[k] = 2
        continue
      }
      const m = (b.sums[k] ?? 0) / b.wsum
      const v = (b.sqs[k] ?? 0) / b.wsum - m * m
      delta[k] = round(m)
      sd[k] = round(Math.sqrt(Math.max(0.25, v)))
    }
    curves[String(age)] = {
      n: b?.n ?? 0,
      retireRate: seen > 0 ? round(1 - stayed / seen) : age >= 40 ? 0.5 : 0.05,
      delta,
      sd,
    }
  }

  writeFileSync(outFile, `${JSON.stringify(curves, null, 2)}\n`)
  console.log(`curves from ${history.careers.length} careers → ${outFile}`)
  const show: (keyof Ratings)[] = ['three', 'speed', 'iq', 'interiorD', 'stamina']
  console.log(`age   n     retire  ${show.map((s) => String(s).padStart(9)).join('')}`)
  for (let age = 19; age <= 40; age++) {
    const c = curves[String(age)]
    if (!c) continue
    console.log(
      `${String(age).padEnd(5)} ${String(c.n).padEnd(5)} ${c.retireRate.toFixed(2).padStart(5)}  ` +
        show.map((s) => (c.delta[s] ?? 0).toFixed(2).padStart(9)).join(''),
    )
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000
}

main()
