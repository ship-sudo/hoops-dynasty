import { fmt, type SeasonMetrics } from './metrics.ts'

export function renderReport(
  engineName: string,
  minutesMode: string,
  all: SeasonMetrics[],
  elapsedMs: number,
): string {
  const lines: string[] = []
  lines.push(
    '# CALIBRATION.md',
    '',
    `Engine: \`${engineName}\`. Minutes mode: \`${minutesMode}\`. Generated ${new Date().toISOString().slice(0, 16)}Z in ${(elapsedMs / 1000).toFixed(0)} s.`,
    '',
  )
  const fails = all.flatMap((m) => m.outOfBand.map((o) => `- ${m.yearEnd}: ${o}`))
  lines.push('## Out of band', '', ...(fails.length ? fails : ['- none']), '')
  lines.push(
    '## Summary',
    '',
    '| season | runs | win r (expected) | win r (per run) | wins sd real/sim | out of band |',
    '|---|---|---|---|---|---|',
  )
  for (const m of all)
    lines.push(
      `| ${m.yearEnd} | ${m.runs} | ${m.winCorrExpected.toFixed(3)} | ${m.winCorrPerRun.toFixed(3)} | ${m.winSdReal.toFixed(1)} / ${m.winSdSim.toFixed(1)} | ${m.outOfBand.length} |`,
    )
  lines.push('')
  for (const m of all) {
    lines.push(`## ${m.yearEnd}`, '', '| stat | real | sim | tol | ok |', '|---|---|---|---|---|')
    for (const b of [...m.league, m.topScorers, m.topMinutes, m.topShooters])
      lines.push(
        `| ${b.name} | ${fmt(b.real)} | ${fmt(b.sim)} | ${b.tol} | ${b.ok ? 'yes' : '**NO**'} |`,
      )
    lines.push(
      '',
      `Monotonicity (rating delta → win%): ${m.monotonic.deltas.map((d, i) => `${d >= 0 ? '+' : ''}${d}: ${(m.monotonic.winPct[i] as number).toFixed(2)}`).join(', ')} — ${m.monotonic.ok ? 'ok' : '**NOT monotonic**'}`,
      '',
    )
  }
  return lines.join('\n')
}
