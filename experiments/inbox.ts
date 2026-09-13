// Does the dressing room actually reach the inbox? Sim a season through the real seam and grep
// the news the manager would have read.
//
//   npx tsx experiments/inbox.ts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SeasonBundle } from '@hoops/core'
import { realModule } from '../apps/web/src/sim/real.ts'

const bundlesDir = path.resolve(process.env.HOOPS_DATA_DIR ?? 'data', 'bundles')
const bundle = JSON.parse(readFileSync(path.join(bundlesDir, '2004.json'), 'utf8')) as SeasonBundle
const teamId = bundle.teams.find((t) => t.abbr === 'SAS')?.teamId as string

const d = realModule().newGame(bundle, { yearEnd: 2004, teamId, seed: 3 })
while (d.simDay()) {
  /* the whole season */
}

const news = d.news(400)
const morale = news.filter((n) => /unhappy|wants out|dressing room is/i.test(n.headline))
console.log(`${news.length} items in the inbox, ${morale.length} of them about the dressing room\n`)
for (const n of morale.slice(0, 6)) console.log(`  ${n.date}  ${n.headline}\n      ${n.body}\n`)

const mood = d.squadMood(teamId)
console.log(`end of season: ${mood.label} (${mood.average.toFixed(0)}) — ${mood.summary}`)
const unhappy = d.roster(teamId).filter((r) => (r.mood?.value ?? 100) < 36)
for (const r of unhappy)
  console.log(
    `  ${r.player.name.padEnd(20)} ${(r.mood?.role ?? '').padEnd(9)} ${Math.round(
      r.mood?.value ?? 0,
    )
      .toString()
      .padStart(3)}  ${r.mood?.wantsOut ? 'WANTS OUT  ' : '           '}${r.mood?.why}`,
  )
