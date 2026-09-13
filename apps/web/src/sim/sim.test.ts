// The adapter that the interface talks to: a whole year through the real packages.
//
// These need the data pipeline to have run (data/bundles). They skip themselves when it has not,
// so a fresh checkout still passes.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SeasonBundle } from '@hoops/core'
import { realModule } from './real.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const bundlePath = join(dataDir, 'bundles', '2004.json')
const havePipeline = existsSync(bundlePath)
const bundle: SeasonBundle | null = havePipeline
  ? (JSON.parse(readFileSync(bundlePath, 'utf8')) as SeasonBundle)
  : null

const skip = !havePipeline
const SAS = () => bundle!.teams.find((t) => t.abbr === 'SAS')!.teamId

function start(seed = 5) {
  return realModule().newGame(bundle!, { yearEnd: 2004, teamId: SAS(), seed })
}

/** Play until Continue stops, which is the end of the playoffs. */
function playSeason(d: ReturnType<typeof start>): number {
  let games = 0
  for (;;) {
    const r = d.simDay()
    if (!r) break
    games += r.games.length
  }
  return games
}

test('a season plays out and the standings look like a league', { skip }, () => {
  const d = start()
  const games = playSeason(d)
  assert.ok(games > 1200, `expected a full season, got ${games} games`)
  assert.equal(d.getState().seasonComplete, true)

  const table = d.standings()
  assert.equal(table.length, bundle!.teams.length)
  const wins = table.map((r) => r.wins)
  const mean = wins.reduce((a, b) => a + b, 0) / wins.length
  assert.ok(Math.abs(mean - 41) < 2, `mean wins should sit near 41, got ${mean.toFixed(1)}`)
  const sd = Math.sqrt(wins.reduce((a, w) => a + (w - mean) ** 2, 0) / wins.length)
  assert.ok(sd > 8, `real leagues spread out; sim sd was ${sd.toFixed(1)}`)
  for (const row of table) assert.equal(row.wins + row.losses, 82)
})

test('every game a player plays lands in his game log', { skip }, () => {
  const d = start()
  playSeason(d)
  const roster = d.roster(SAS())
  const best = roster.sort((a, b) => b.totals.min - a.totals.min)[0]!
  const log = d.gameLog(best.player.playerId, 200)
  assert.ok(log.length >= 70, `expected a full season of lines, got ${log.length}`)
  const totalPts = log.reduce((a, g) => a + g.line.pts, 0)
  // The log covers the playoffs too, so it is at least the regular-season total.
  assert.ok(totalPts >= best.totals.pts, 'the log should account for every point he scored')
  const first = log[0]!
  assert.ok(first.date && first.opponentTeamId !== SAS())
  assert.equal(typeof first.won, 'boolean')
})

test('the coach controls minutes', { skip }, () => {
  const d = start(9)
  const roster = d.roster(SAS())
  const star = roster[0]!.player
  const deep = roster[9]!.player
  d.setPlan(SAS(), { minutes: { [star.playerId]: 10, [deep.playerId]: 40 } })
  for (let i = 0; i < 20; i++) d.simDay()

  const after = d.roster(SAS())
  const starLine = after.find((r) => r.player.playerId === star.playerId)!.totals
  const deepLine = after.find((r) => r.player.playerId === deep.playerId)!.totals
  const mpg = (t: { min: number; gp: number }) => (t.gp > 0 ? t.min / t.gp : 0)
  assert.ok(mpg(deepLine) > mpg(starLine) + 10, 'the man you gave the minutes to should play them')
  assert.ok(mpg(starLine) < 20, `a 10-minute order should stick, got ${mpg(starLine).toFixed(1)}`)
})

test('benching a player keeps him out of the box score', { skip }, () => {
  const d = start(4)
  const star = d.roster(SAS())[0]!.player
  d.setPlan(SAS(), { inactive: [star.playerId] })
  for (let i = 0; i < 15; i++) d.simDay()
  const line = d.roster(SAS()).find((r) => r.player.playerId === star.playerId)!.totals
  assert.equal(line.min, 0, 'an inactive player does not play')
})

test('a fleecing is refused and a fair deal goes through', { skip }, () => {
  const d = start(3)
  const other = d.teams().find((t) => t.teamId !== SAS())!.teamId
  const mine = d.tradeBlock(SAS())
  const theirs = d.tradeBlock(other)

  const junk = [...mine].sort((a, b) => a.surplus - b.surplus)[0]!
  const prize = [...theirs].sort((a, b) => b.surplus - a.surplus)[0]!
  const fleece = d.assessTrade(
    { teamId: SAS(), players: [junk.playerId], picks: [] },
    { teamId: other, players: [prize.playerId], picks: [] },
  )
  assert.equal(fleece.accepted, false, 'nobody hands over their best player for nothing')
  assert.ok(fleece.reason.length > 0)
  // The refusal must name the team, not print a raw id.
  assert.ok(!/\d{10}/.test(fleece.reason), `raw team id leaked: ${fleece.reason}`)

  const offers = d.incomingOffers(5)
  if (offers.length > 0) {
    const deal = offers[0]!
    const wanted = deal.user.players[0]!
    const incoming = deal.other.players[0]!
    const done = d.executeTrade(deal.user, deal.other)
    assert.equal(done.accepted, true)
    const roster = d.roster(SAS()).map((r) => r.player.playerId)
    assert.ok(!roster.includes(wanted), 'the player you sent should be gone')
    assert.ok(roster.includes(incoming), 'the player you got should be here')
  }
})

test('the offseason is the manager’s to run', { skip }, () => {
  const d = start(7)
  playSeason(d)

  let off = d.offseason()
  assert.ok(off, 'the offseason should be open once the season ends')
  assert.equal(d.simDay(), null, 'Continue must not play the summer for you')

  // Draft: advance to your pick, then take someone other than the top of the board.
  let guard = 0
  let tookSomeone = false
  while (off && off.phase !== 'freeagency' && guard++ < 12) {
    if (off.yourPick && off.board.length > 0) {
      // Deliberately not the top of the board: the point of picking yourself is disagreeing.
      const target = off.board[Math.min(2, off.board.length - 1)]!
      off = d.draftPlayer(target.prospectId)
      tookSomeone = true
      assert.ok(
        off.picks.some((p) => p.prospectId === target.prospectId),
        'your pick should be recorded',
      )
    } else {
      off = d.advanceDraft()
    }
  }
  assert.ok(tookSomeone, 'you should have had a pick of your own')

  assert.equal(off?.phase, 'freeagency', 'the market opens once the draft is done')
  assert.ok((off?.freeAgents.length ?? 0) > 0, 'there should be players to sign')
  // Someone you can actually pay: the cap binds the manager as much as it binds the AI.
  const room = off!.finance!.cap - off!.finance!.payroll
  const target = off!.freeAgents.find((f) => f.asking < room * 0.6) ?? off!.freeAgents.at(-1)!
  const withOffer = d.makeOffer(target.playerId, target.asking, 3)
  assert.equal(withOffer.freeAgents.find((f) => f.playerId === target.playerId)?.offer?.years, 3)

  d.finishOffseason()
  const state = d.getState()
  assert.equal(state.seasonComplete, false, 'a new season should be under way')
  assert.equal(state.yearEnd, 2005)
  assert.equal(d.offseason(), null)

  const roster = d.roster(SAS())
  assert.ok(
    roster.length >= 12 && roster.length <= 15,
    `roster should be legal, got ${roster.length}`,
  )
  assert.ok(
    roster.some((r) => r.player.playerId === target.playerId),
    'the man you paid his asking price should be yours',
  )
})

test('the league stays a league over several seasons', { skip }, () => {
  const d = start(2)
  for (let year = 0; year < 4; year++) {
    playSeason(d)
    let off = d.offseason()
    let guard = 0
    while (off && off.phase !== 'freeagency' && guard++ < 12) {
      off =
        off.yourPick && off.board.length > 0
          ? d.draftPlayer(off.board[0]!.prospectId)
          : d.advanceDraft()
    }
    d.finishOffseason()
  }
  const sizes = d.teams().map((t) => d.roster(t.teamId).length)
  assert.ok(
    Math.min(...sizes) >= 9,
    `every club should field a squad, smallest was ${Math.min(...sizes)}`,
  )
  assert.ok(
    Math.max(...sizes) <= 15,
    `nobody may exceed the roster limit, largest was ${Math.max(...sizes)}`,
  )

  const history = d.seasonHistory()
  assert.equal(history.length, 4)
  for (const season of history) {
    assert.ok(season.championTeamId, `${season.yearEnd} should have a champion`)
    assert.ok(season.standings.length > 0)
  }
})

test('the cap binds the manager too', { skip }, () => {
  const d = start(7)
  playSeason(d)
  let off = d.offseason()
  let guard = 0
  while (off && off.phase !== 'freeagency' && guard++ < 12) {
    off =
      off.yourPick && off.board.length > 0
        ? d.draftPlayer(off.board[0]!.prospectId)
        : d.advanceDraft()
  }
  assert.equal(off?.phase, 'freeagency')
  const finance = off!.finance!
  const room = finance.cap - finance.payroll

  // Offers are honoured in the order they were placed, so bid for the man you can afford first —
  // exactly as a real front office would.
  const affordable = off!.freeAgents.find((f) => f.asking < room * 0.5)
  if (affordable) d.makeOffer(affordable.playerId, affordable.asking, 2)
  // Then a bid far beyond what the CBA allows. It is clamped, not honoured: you may still end up
  // with him, but never at the number you typed.
  const star = off!.freeAgents[0]!
  d.makeOffer(star.playerId, finance.cap * 2, 4)

  d.finishOffseason()
  const roster = d.roster(SAS())
  if (affordable) {
    assert.ok(
      roster.some((r) => r.player.playerId === affordable.playerId),
      'a bid you can afford should be',
    )
  }
  const after = d.finance(SAS())
  // A contender may sit well over the cap and into the tax — real ones do. What must not happen
  // is the original bug, where a single unchecked bid put payroll at three times the cap.
  assert.ok(
    after.payroll < after.cap * 1.9,
    `payroll should stay in the realm of the cap, got ${(after.payroll / 1e6).toFixed(1)}M against ${(after.cap / 1e6).toFixed(1)}M`,
  )
  // An over-the-top bid is clamped to what the CBA allows rather than honoured: whoever he ends
  // up signing with, nobody is paid twice the cap.
  const paid = d.roster(SAS()).find((r) => r.player.playerId === star.playerId)?.salary ?? 0
  assert.ok(
    paid < after.cap,
    `no player may be paid more than the cap itself, he got ${(paid / 1e6).toFixed(1)}M`,
  )
})

test('draft picks from both rounds reach the roster', { skip }, () => {
  const d = start(12)
  playSeason(d)
  let off = d.offseason()
  const taken: string[] = []
  let guard = 0
  while (off && off.phase !== 'freeagency' && guard++ < 12) {
    if (off.yourPick && off.board.length > 0) {
      const pick = off.board[0]!
      taken.push(pick.prospectId)
      off = d.draftPlayer(pick.prospectId)
    } else {
      off = d.advanceDraft()
    }
  }
  assert.ok(taken.length >= 1, 'you should have had at least one pick')
  d.finishOffseason()
  const roster = d.roster(SAS()).map((r) => r.player.playerId)
  for (const id of taken) {
    assert.ok(roster.includes(id), `a player you drafted (${id}) should be on your roster`)
  }
})

test('a save remembers the season, not just the scoreboard', { skip }, () => {
  const mod = realModule()
  const d = mod.newGame(bundle!, { yearEnd: 2004, teamId: SAS(), seed: 5 })
  const roster = d.roster(SAS())
  d.setPlan(SAS(), {
    minutes: { [roster[9]!.player.playerId]: 40 },
    tactics: { pace: 1, threes: 1, crashGlass: 0, pressure: 0, zone: false },
  })
  for (let i = 0; i < 40; i++) d.simDay()

  const star = d.roster(SAS()).sort((a, b) => b.totals.pts - a.totals.pts)[0]!
  const logBefore = d.gameLog(star.player.playerId)
  const lastGame = d
    .schedule(SAS())
    .filter((g) => g.result)
    .at(-1)!
  const save = JSON.parse(JSON.stringify(d.save()))

  const back = mod.loadGame(bundle!, save)
  assert.equal(back.getState().date, d.getState().date)
  assert.equal(
    back.roster(SAS()).find((r) => r.player.playerId === star.player.playerId)!.totals.pts,
    star.totals.pts,
  )
  assert.deepEqual(back.getPlan(SAS()).tactics, d.getPlan(SAS()).tactics, 'tactics survive')
  assert.equal(
    back.gameLog(star.player.playerId).length,
    logBefore.length,
    'the game log must survive a reload — otherwise closing the tab erases the season',
  )
  const box = back.boxScore(lastGame.gameId)
  assert.ok(box, 'past box scores must survive a reload')
  assert.ok(box.home.players.length > 5)
  // Play on from the save.
  for (let i = 0; i < 5; i++) back.simDay()
  assert.ok(back.getState().gamesPlayed > d.getState().gamesPlayed)
})

test('a reload mid-market keeps the bids you have placed', { skip }, () => {
  const mod = realModule()
  const d = mod.newGame(bundle!, { yearEnd: 2004, teamId: SAS(), seed: 5 })
  playSeason(d)
  let off = d.offseason()
  let guard = 0
  while (off && off.phase !== 'freeagency' && guard++ < 12) {
    off =
      off.yourPick && off.board.length > 0
        ? d.draftPlayer(off.board[0]!.prospectId)
        : d.advanceDraft()
  }
  const room = off!.finance!.cap - off!.finance!.payroll
  const target = off!.freeAgents.find((f) => f.asking < room * 0.5)
  if (!target) return // nobody affordable this run; nothing to assert
  d.makeOffer(target.playerId, target.asking, 3)

  const back = mod.loadGame(bundle!, JSON.parse(JSON.stringify(d.save())))
  const resumed = back.offseason()
  assert.equal(resumed?.phase, 'freeagency', 'you should come back into the market, not the draft')
  assert.ok(
    resumed?.freeAgents.find((f) => f.playerId === target.playerId)?.offer,
    'your offer should still be on the table',
  )
  back.finishOffseason()
  assert.ok(
    back.roster(SAS()).some((r) => r.player.playerId === target.playerId),
    'and it should still be honoured',
  )
})

test('the league moves through real CBAs as the years pass', { skip }, () => {
  const mod = realModule()
  const start = JSON.parse(
    readFileSync(join(dataDir, 'bundles', '2016.json'), 'utf8'),
  ) as SeasonBundle
  const gsw = start.teams.find((t) => t.abbr === 'GSW')!.teamId
  const d = mod.newGame(start, { yearEnd: 2016, teamId: gsw, seed: 4 })

  const caps: number[] = [d.finance(gsw).cap]
  for (let year = 0; year < 4; year++) {
    playSeason(d)
    let off = d.offseason()
    let guard = 0
    while (off && off.phase !== 'freeagency' && guard++ < 12) {
      off =
        off.yourPick && off.board.length > 0
          ? d.draftPlayer(off.board[0]!.prospectId)
          : d.advanceDraft()
    }
    d.finishOffseason()
    caps.push(d.finance(gsw).cap)
  }
  // The 2016 cap spike is the obvious one: $70M to $94M in a single summer.
  assert.ok(caps[1]! > caps[0]! * 1.25, `expected the 2016 spike, went ${caps[0]} → ${caps[1]}`)
  assert.ok(caps.at(-1)! > caps[0]! * 1.5, 'the cap should keep climbing through the CBAs')
  // A frozen league was the bug: every season identical to the one you started in.
  assert.equal(new Set(caps).size >= 4, true, `the cap stood still: ${caps.join(', ')}`)
  const finance = d.finance(gsw)
  assert.ok(finance.taxLine > finance.cap, 'the tax line sits above the cap')
  assert.ok(finance.apron1 && finance.apron1 > finance.taxLine, 'and the apron above that')
})

test('the league talks about itself every week', { skip }, () => {
  const d = start(12)
  for (let i = 0; i < 80; i++) d.simDay()
  const news = d.news(60)
  const talk = news.filter((n) => n.kind === 'rumour' || n.kind === 'offer' || n.kind === 'streak')
  assert.ok(talk.length >= 5, `a fortnight of basketball should produce talk, got ${talk.length}`)
  assert.ok(
    talk.every((n) => n.headline.length > 10 && !/\d{10}/.test(n.headline)),
    'no raw ids in the copy',
  )
  // An offer is a real one: the trade desk should be showing the same thing.
  const offer = talk.find((n) => n.kind === 'offer')
  if (offer) {
    assert.ok(offer.body.includes('trade desk'), 'an offer should tell you where to answer it')
    assert.ok(d.incomingOffers(6).length > 0, 'and the desk should have offers in it')
  }
})

test('the inbox leads with your own club, not the league drizzle', { skip }, () => {
  const d = start(12)
  for (let i = 0; i < 60; i++) d.simDay()
  const top = d.news(12)
  const mine = d.teams().find((t) => t.teamId === SAS())
  const aboutMe = top.filter(
    (n) => n.headline.includes(mine!.name) || n.kind === 'result' || n.kind === 'offer',
  )
  assert.ok(
    aboutMe.length >= 3,
    `the top of the inbox should be about you; only ${aboutMe.length} of 12 were`,
  )
})

test('the league is a spectacle: leaders, a race, All-Stars and a preview', { skip }, () => {
  const d = start(8)
  for (let i = 0; i < 120; i++) d.simDay()

  const scorers = d.leaders('pts', 5)
  assert.equal(scorers.length, 5)
  assert.ok(scorers[0]!.value > scorers[4]!.value, 'a leaderboard is sorted')
  assert.ok(
    scorers[0]!.value > 15 && scorers[0]!.value < 45,
    `implausible scoring lead: ${scorers[0]!.value}`,
  )
  // Percentage categories need volume behind them or a 2-for-2 night leads the league.
  const shooters = d.leaders('fg3Pct', 5)
  assert.ok(
    shooters.every((r) => r.value > 0.25 && r.value < 0.65),
    'three-point leaders look real',
  )

  const race = d.awardRace(5)
  assert.equal(race.mvp.length, 5)
  assert.ok(race.mvp[0]!.share >= race.mvp[4]!.share, 'vote share is ordered')
  assert.ok(race.mvp[0]!.pts > 0 && race.mvp[0]!.teamWins > 0)

  const allStars = d.allStars()
  assert.ok(allStars, 'there should be an All-Star weekend')
  assert.equal(allStars.east.filter((p) => p.starter).length, 5)
  assert.ok(allStars.west.length >= 8)
  if (allStars.played) {
    assert.ok(allStars.result, 'once the break has passed, the game has been played')
    assert.ok(allStars.result.eastPts > 60 && allStars.result.westPts > 60)
  }

  const preview = d.nextGame()
  assert.ok(preview, 'there should be a next game')
  assert.notEqual(preview.opponentTeamId, SAS())
  assert.ok(preview.yourRecord.wins + preview.yourRecord.losses > 0)
  assert.ok(preview.yourBest, 'a preview names your best player')

  const teams = d.teamStats()
  assert.equal(teams.length, d.teams().length)
  assert.ok(teams[0]!.diff >= teams.at(-1)!.diff, 'team stats are sorted by margin')
})

test('ratings read like a basketball game, not a z-score', { skip }, () => {
  const d = start(3)
  const cards: number[] = []
  for (const team of d.teams()) {
    for (const row of d.roster(team.teamId)) {
      if (row.player.realMpg > 12) cards.push(row.card.overall)
    }
  }
  cards.sort((a, b) => b - a)
  const median = cards[Math.floor(cards.length / 2)]!
  assert.ok(
    median >= 68 && median <= 78,
    `an average rotation player should read mid-70s, got ${median}`,
  )
  assert.ok(cards[0]! >= 90, `the best player in the league should clear 90, got ${cards[0]}`)
  assert.ok(cards.at(-1)! >= 50, `nobody in the NBA should read below 50, got ${cards.at(-1)}`)
  assert.ok(
    cards.filter((c) => c >= 90).length <= 14,
    `90 should mean something: ${cards.filter((c) => c >= 90).length} players cleared it`,
  )

  // A card explains itself: categories, and a couple of things he is good at.
  const shaqish = d
    .roster(d.teams().find((t) => t.abbr === 'SAS')!.teamId)
    .sort((a, b) => b.card.overall - a.card.overall)[0]!
  assert.ok(shaqish.card.strengths.length > 0, 'a card names what he is good at')
  assert.ok(Object.values(shaqish.card.categories).every((v) => v >= 40 && v <= 99))
})

test('you see your own players’ ceilings, and nobody else’s', { skip }, () => {
  const d = start(3)
  const mine = d.roster(SAS())
  assert.ok(
    mine.every((r) => r.card.potential !== null),
    'your own men show a ceiling',
  )
  assert.ok(
    mine.every((r) => (r.card.potential ?? 0) >= r.card.overall),
    'a ceiling is never below where he already is',
  )
  const theirs = d.roster(d.teams().find((t) => t.teamId !== SAS())!.teamId)
  assert.ok(
    theirs.every((r) => r.card.potential === null),
    "a rival's ceiling is not yours to know",
  )
})

test('a leaderboard needs volume behind it, even in November', { skip }, () => {
  const d = start(5)
  for (let i = 0; i < 40; i++) d.simDay()
  for (const category of ['ftPct', 'fg3Pct', 'fgPct'] as const) {
    const top = d.leaders(category, 3)
    assert.ok(top.length > 0, `${category} should have leaders a month in`)
    assert.ok(
      top.every((r) => r.value < 0.98),
      `${category} led by ${top[0]?.value}: somebody with nine attempts is topping the league`,
    )
  }
})

test('the All-Star break is in February', { skip }, () => {
  const d = start(5)
  const weekend = d.allStars()
  assert.ok(weekend, 'there should be a break')
  assert.equal(
    weekend.date.slice(5, 7),
    '02',
    `the break should be in February, got ${weekend.date}`,
  )
})

test('the schedule carries the playoffs', { skip }, () => {
  const d = start(5)
  const regular = d.schedule(SAS()).length
  playSeason(d)
  const withPlayoffs = d.schedule(SAS()).filter((g) => g.result).length
  assert.ok(
    withPlayoffs > 82,
    `a team that reached the playoffs plays more than 82: got ${withPlayoffs} of ${regular}`,
  )
})

// ── The postseason, as the Home panel sees it ────────────────────────────────
//
// Playoff games are never on the calendar's schedule, so `nextGame` used to return null the moment
// the regular season ended and Home said "No games left on your schedule" through a live playoff
// run. These prove it now says something true instead.

function startAs(abbr: string, seed: number) {
  const teamId = bundle?.teams.find((t) => t.abbr === abbr)?.teamId as string
  return realModule().newGame(bundle as SeasonBundle, { yearEnd: 2004, teamId, seed })
}

/** Sim a day at a time until `stop` holds, or the season runs out. */
function playUntil(d: ReturnType<typeof start>, stop: () => boolean): void {
  for (let i = 0; i < 400 && !stop(); i++) if (!d.simDay()) return
}

test('a live playoff series reaches the preview, with its own games', { skip }, () => {
  const d = start(5)
  playUntil(d, () => (d.nextGame()?.playoff?.games.length ?? 0) > 0)

  const preview = d.nextGame()
  assert.ok(preview, 'expected a preview during the playoffs, got null')
  const po = preview.playoff
  assert.ok(po, 'the preview should carry the series')
  assert.equal(po.kind, 'series')
  assert.match(po.title, /Conference|The Finals/)
  assert.equal(po.games.length, po.yourWins + po.theirWins)
  assert.equal(po.gameNumber, po.games.length + 1)
  assert.match(po.seriesLine, /lead|trail|tied|level/)
  assert.ok(po.yourSeed && po.yourSeed >= 1 && po.yourSeed <= 8)
  assert.equal(d.postseason()?.kind, 'playing')

  // The fixture the preview promises is the one the sim actually plays next — same id, same venue.
  d.simDay()
  const box = d.boxScore(preview.gameId)
  assert.ok(box, `the preview's gameId ${preview.gameId} should be the game that just played`)
  assert.equal(box.home.teamId === SAS(), preview.home)
})

test('a club knocked out is told who did it, not that its schedule is empty', { skip }, () => {
  const d = startAs('BOS', 11)
  playUntil(d, () => {
    const k = d.postseason()?.kind
    return k === 'eliminated' || k === 'runnerUp' || k === 'champion'
  })

  const out = d.postseason()
  assert.ok(out)
  if (out.kind === 'eliminated') {
    assert.equal(d.nextGame(), null, 'a beaten club has no next game')
    assert.match(out.headline, /knocked you out\.$/)
    assert.match(out.detail, /They beat you \d–\d in the .+\. Your season is over\./)
    assert.ok(out.aliveTeamIds.length > 0, 'somebody is still playing')
  } else {
    assert.match(out.detail, /Finals/)
  }
})

test('a club that misses the playoffs is given its record, not a blank', { skip }, () => {
  const d = startAs('ORL', 3)
  playUntil(d, () => d.bracket() !== null)

  const out = d.postseason()
  assert.ok(out)
  assert.equal(out.kind, 'missed', `Orlando were 21-61; got ${out.kind}: ${out.detail}`)
  assert.equal(d.nextGame(), null)
  assert.equal(out.headline, 'Your season is over.')
  assert.match(
    out.detail,
    /^You finished \d+–\d+, \d+\w\w in the (Eastern|Western) Conference, and missed the playoffs\.$/,
  )
  assert.ok(out.aliveTeamIds.length > 0)
})

// ── The play-in ──────────────────────────────────────────────────────────────

const b2021Path = join(dataDir, 'bundles', '2021.json')
const b2021: SeasonBundle | null = existsSync(b2021Path)
  ? (JSON.parse(readFileSync(b2021Path, 'utf8')) as SeasonBundle)
  : null

test('a play-in game says what it is for, and is the game that gets played', {
  skip: !b2021,
}, () => {
  // Which mid-table club lands in the 7–10 bracket moves with the sim, so try a few and assert on
  // the first one that gets there. Six candidates over eight slots is not a close-run thing.
  for (const abbr of ['WAS', 'IND', 'CHA', 'BOS', 'MEM', 'SAS']) {
    const teamId = b2021?.teams.find((t) => t.abbr === abbr)?.teamId as string
    const d = realModule().newGame(b2021 as SeasonBundle, { yearEnd: 2021, teamId, seed: 7 })
    for (let i = 0; i < 400 && d.nextGame()?.playoff?.kind !== 'playin'; i++) if (!d.simDay()) break

    const preview = d.nextGame()
    if (preview?.playoff?.kind !== 'playin') continue

    const po = preview.playoff
    assert.equal(po.title, 'The play-in')
    assert.match(po.stake ?? '', /seed/)
    assert.match(po.action, /^Play (for the [78] seed|to stay alive) ▸$/)

    d.simDay()
    const box = d.boxScore(preview.gameId)
    assert.ok(box, `the preview's gameId ${preview.gameId} should be the game that just played`)
    assert.equal(box.home.teamId === teamId, preview.home)
    return
  }
  assert.fail('none of six mid-table clubs reached the play-in')
})
