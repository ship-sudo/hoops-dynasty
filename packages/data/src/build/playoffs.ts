// Playoff series and seeds from playoff game results. Pure.
//
// Series: group games by unordered team pair, count wins per side. Round: a team's series in order of
// first game date are rounds 1, 2, 3, 4; both teams in a series must agree. The high seed is the home
// team of game 1. The finals is the round-4 series (conference champions), so the champion is its winner.

export interface PlayoffGame {
  gameId: string
  date: string
  homeTeamId: string
  awayTeamId: string
  homePts: number
  awayPts: number
}

export interface Series {
  round: number
  highTeamId: string
  lowTeamId: string
  winnerTeamId: string
  highWins: number
  lowWins: number
  firstDate: string
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function deriveSeries(games: readonly PlayoffGame[]): Series[] {
  const sorted = [...games].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.gameId < b.gameId ? -1 : 1,
  )
  const groups = new Map<string, PlayoffGame[]>()
  for (const g of sorted) {
    const k = pairKey(g.homeTeamId, g.awayTeamId)
    const list = groups.get(k)
    if (list) list.push(g)
    else groups.set(k, [g])
  }
  // Round = how many earlier series each team has played, plus one.
  const seriesList = [...groups.values()].sort((a, b) =>
    (a[0] as PlayoffGame).date < (b[0] as PlayoffGame).date ? -1 : 1,
  )
  const played = new Map<string, number>()
  const out: Series[] = []
  for (const list of seriesList) {
    const first = list[0] as PlayoffGame
    const high = first.homeTeamId
    const low = first.awayTeamId
    let highWins = 0
    let lowWins = 0
    for (const g of list) {
      const homeWon = g.homePts > g.awayPts
      const winner = homeWon ? g.homeTeamId : g.awayTeamId
      if (winner === high) highWins++
      else lowWins++
    }
    const rHigh = (played.get(high) ?? 0) + 1
    const rLow = (played.get(low) ?? 0) + 1
    if (rHigh !== rLow)
      throw new Error(`round mismatch ${high} (${rHigh}) vs ${low} (${rLow}) on ${first.date}`)
    played.set(high, rHigh)
    played.set(low, rLow)
    out.push({
      round: rHigh,
      highTeamId: high,
      lowTeamId: low,
      winnerTeamId: highWins > lowWins ? high : low,
      highWins,
      lowWins,
      firstDate: first.date,
    })
  }
  return out
}

/** Problems with a season's bracket. Empty means 15 series shaped 8/4/2/1 with one champion. */
export function checkBracket(series: readonly Series[]): string[] {
  const problems: string[] = []
  const perRound = [0, 0, 0, 0, 0]
  for (const s of series) perRound[s.round] = (perRound[s.round] ?? 0) + 1
  const want = [0, 8, 4, 2, 1]
  for (let r = 1; r <= 4; r++)
    if (perRound[r] !== want[r]) problems.push(`round ${r}: ${perRound[r]} series, want ${want[r]}`)
  if (series.length !== 15) problems.push(`${series.length} series, want 15`)
  for (const s of series) {
    const need = s.round === 1 && s.firstDate < '2003-04-01' ? 3 : 4
    const w = Math.max(s.highWins, s.lowWins)
    if (w !== need) problems.push(`round ${s.round} ${s.highTeamId} v ${s.lowTeamId}: ${w} wins`)
  }
  return problems
}

export function champion(series: readonly Series[]): string | null {
  const finals = series.find((s) => s.round === 4)
  return finals ? finals.winnerTeamId : null
}

export function runnerUp(series: readonly Series[]): string | null {
  const finals = series.find((s) => s.round === 4)
  if (!finals) return null
  return finals.winnerTeamId === finals.highTeamId ? finals.lowTeamId : finals.highTeamId
}

/**
 * Playoff seeds 1–8 per conference from standings rank plus the round-1 bracket.
 * Seeds 1–6 follow conference rank. Seeds 7 and 8 come from the bracket (the 8 seed meets the 1 seed),
 * which is what the play-in changes. Teams outside the bracket get null.
 */
export function playoffSeeds(
  teams: readonly { teamId: string; conference: string; confRank: number | null }[],
  series: readonly Series[],
): Map<string, number | null> {
  const seeds = new Map<string, number | null>(teams.map((t) => [t.teamId, null]))
  const round1 = series.filter((s) => s.round === 1)
  const inBracket = new Set(round1.flatMap((s) => [s.highTeamId, s.lowTeamId]))
  const opponent = new Map<string, string>()
  for (const s of round1) {
    opponent.set(s.highTeamId, s.lowTeamId)
    opponent.set(s.lowTeamId, s.highTeamId)
  }
  const confs = new Set(teams.map((t) => t.conference))
  for (const conf of confs) {
    const inConf = teams
      .filter((t) => t.conference === conf && inBracket.has(t.teamId))
      .sort((a, b) => (a.confRank ?? 99) - (b.confRank ?? 99))
    if (inConf.length !== 8) continue
    const order = inConf.map((t) => t.teamId)
    const one = order[0] as string
    const two = order[1] as string
    const eight = opponent.get(one)
    const seven = opponent.get(two)
    const top6 = order.slice(0, 6)
    if (eight && seven && !top6.includes(eight) && !top6.includes(seven) && eight !== seven) {
      order[6] = seven
      order[7] = eight
    }
    for (const [i, id] of order.entries()) seeds.set(id, i + 1)
  }
  return seeds
}
