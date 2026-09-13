import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyStatLine, type GameInput, type GameResult, type StatLine } from '@hoops/core'
import { simulateGame, simulateGameWith } from './index.ts'
import { ERA_1998, ERA_2016, makeGame, makeTeam, referenceRatings } from './testkit.ts'

const STAT_KEYS = Object.keys(emptyStatLine()) as (keyof StatLine)[]

function checkBox(r: GameResult): void {
  for (const side of [r.home, r.away]) {
    const sum = emptyStatLine()
    for (const p of side.players) for (const k of STAT_KEYS) sum[k] += p[k]
    for (const k of STAT_KEYS) {
      assert.equal(side.totals[k], sum[k], `${side.teamId} totals.${k} must equal the player lines`)
    }
    // The scoreboard reconciles three ways: team points, the box total, and the quarters.
    assert.equal(side.pts, side.totals.pts, `${side.teamId} pts vs totals.pts`)
    const fg2 = side.totals.fgm - side.totals.fg3m
    assert.equal(side.pts, 2 * fg2 + 3 * side.totals.fg3m + side.totals.ftm, 'points from makes')
    assert.equal(
      side.quarters.reduce((a, b) => a + b, 0),
      side.pts,
      `${side.teamId} quarters must sum to the score`,
    )
    assert.equal(side.quarters.length, 4 + r.overtimes, 'one quarters entry per period')
    assert.ok(side.totals.fgm <= side.totals.fga, 'makes cannot exceed attempts')
    assert.ok(side.totals.fg3m <= side.totals.fg3a)
    assert.ok(side.totals.fg3a <= side.totals.fga)
    assert.ok(side.totals.ftm <= side.totals.fta)
    assert.ok(side.totals.ast <= side.totals.fgm, 'cannot assist a miss')
    assert.ok(side.possessions > 50 && side.possessions < 170, 'sane possession count')
    // Minutes: five men on the floor for every second of every period.
    const expected = 5 * (48 + 5 * r.overtimes)
    const played = side.players.reduce((a, p) => a + p.min, 0)
    assert.ok(Math.abs(played - expected) < 1, `minutes sum ${played} vs ${expected}`)
  }
  assert.notEqual(r.home.pts, r.away.pts, 'a game never ends tied')
  assert.equal(r.winner, r.home.pts > r.away.pts ? 'home' : 'away')
  // Steals and blocks are credited to the other side, so they must cross-reconcile.
  assert.ok(r.home.totals.stl <= r.away.totals.tov, 'steals cannot exceed opponent turnovers')
  assert.ok(r.away.totals.stl <= r.home.totals.tov)
  // Plus/minus over the whole roster is five men times the final margin.
  const margin = r.home.pts - r.away.pts
  const homePm = r.home.players.reduce((a, p) => a + p.plusMinus, 0)
  const awayPm = r.away.players.reduce((a, p) => a + p.plusMinus, 0)
  assert.equal(homePm, 5 * margin, 'home plus/minus')
  assert.equal(awayPm, -5 * margin, 'away plus/minus')
}

describe('simulateGame', () => {
  it('is deterministic: the same input and seed give an identical result', () => {
    const a = simulateGame(makeGame(), 12345)
    const b = simulateGame(makeGame(), 12345)
    assert.deepEqual(a, b)
    const c = simulateGame(makeGame(), 12346)
    assert.notDeepEqual(a.pbp, c.pbp, 'a different seed gives a different game')
  })

  it('does not mutate its input', () => {
    const input = makeGame(0, 5)
    const before = JSON.stringify(input)
    simulateGame(input, 9)
    assert.equal(JSON.stringify(input), before)
  })

  it('reconciles the box score with the scoreboard over 200 games', () => {
    for (let seed = 1; seed <= 200; seed++) {
      checkBox(simulateGame(makeGame(0, (seed % 21) - 10), seed))
    }
  })

  it('reconciles in 1998 rules too', () => {
    for (let seed = 1; seed <= 50; seed++) {
      checkBox(simulateGame(makeGame(0, 0, ERA_1998), seed))
    }
  })

  it('turning the play-by-play off does not change the box score', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const withLog = simulateGameWith(makeGame(0, 4), seed, { pbp: true })
      const without = simulateGameWith(makeGame(0, 4), seed, { pbp: false })
      assert.equal(without.pbp.length, 0)
      assert.deepEqual({ ...without, pbp: [] }, { ...withLog, pbp: [] })
    }
  })
})

describe('play-by-play', () => {
  const r = simulateGame(makeGame(), 77)

  it('emits every event kind with sensible text and clock', () => {
    const kinds = new Set(r.pbp.map((e) => e.type))
    for (const k of ['shot', 'ft', 'reb', 'tov', 'foul', 'sub', 'period']) {
      assert.ok(kinds.has(k as (typeof r.pbp)[number]['type']), `missing ${k} events`)
    }
    assert.ok(r.pbp.length > 300 && r.pbp.length < 1400, `pbp length ${r.pbp.length}`)
    for (const e of r.pbp) {
      assert.ok(e.text.length > 0, 'every event has text')
      assert.ok(e.period >= 1 && e.period <= 4 + r.overtimes)
      assert.ok(e.clock >= 0 && e.clock <= 720)
    }
  })

  it('period markers appear once per period, in order', () => {
    const periods = r.pbp.filter((e) => e.type === 'period')
    assert.equal(periods.length, 4 + r.overtimes)
    for (const [i, e] of periods.entries()) assert.equal(e.period, i + 1)
  })

  it('scoring events sum to the final score', () => {
    for (const side of ['home', 'away'] as const) {
      const pts = r.pbp
        .filter((e) => e.team === side && e.points !== undefined)
        .reduce((a, e) => a + (e.points ?? 0), 0)
      assert.equal(pts, r[side].pts, `${side} play-by-play points`)
    }
  })
})

describe('rotation', () => {
  it('lands each player close to his minutes target', () => {
    let worst = 0
    let n = 0
    let biasHigh = 0
    let absError = 0
    for (let seed = 1; seed <= 60; seed++) {
      const input = makeGame()
      const r = simulateGame(input, seed)
      const scale = (48 + 5 * r.overtimes) / 48
      for (const side of [
        [r.home, input.home],
        [r.away, input.away],
      ] as const) {
        for (let i = 0; i < side[0].players.length; i++) {
          const box = side[0].players[i]!
          const target = side[1].players[i]!.minutesTarget * scale
          const err = box.min - target
          absError += Math.abs(err)
          // A disqualified player is allowed to miss his target by however much is left.
          if (box.pf < 6) worst = Math.max(worst, Math.abs(err))
          if (target >= 30) biasHigh += err
          n++
        }
      }
    }
    assert.ok(absError / n < 1.5, `mean minutes error ${(absError / n).toFixed(2)}`)
    assert.ok(worst < 7, `worst minutes error ${worst.toFixed(2)} should be under 7`)
    assert.ok(
      Math.abs(biasHigh / n) < 0.35,
      `high-minute players should not be systematically short (${(biasHigh / n).toFixed(3)})`,
    )
  })

  it('never plays a disqualified player and fouls out a plausible number of times', () => {
    let foulOuts = 0
    const games = 400
    for (let seed = 1; seed <= games; seed++) {
      const r = simulateGame(makeGame(0, 0, ERA_1998), seed)
      for (const side of [r.home, r.away]) {
        for (const p of side.players) {
          assert.ok(p.pf <= 6, `${p.name} has ${p.pf} fouls`)
          if (p.pf === 6) foulOuts++
        }
      }
    }
    const rate = foulOuts / games
    assert.ok(rate > 0.1 && rate < 2, `foul-outs per game ${rate.toFixed(2)} out of range`)
  })

  it('benches the starters in a blowout', () => {
    // A team of scrubs on the road against a juggernaut: the winner rests his best.
    const input: GameInput = {
      era: ERA_2016,
      home: makeTeam('BIG', referenceRatings(28)),
      away: makeTeam('SML', referenceRatings(-28)),
      seasonType: 'regular',
    }
    let starterShare = 0
    let n = 0
    for (let seed = 1; seed <= 40; seed++) {
      const r = simulateGame(input, seed)
      if (r.home.pts - r.away.pts < 25) continue
      const starters = r.home.players.filter((p) => p.starter)
      starterShare += starters.reduce((a, p) => a + p.min, 0)
      n++
    }
    assert.ok(n > 10, 'the juggernaut should win big most nights')
    const perGame = starterShare / n
    assert.ok(perGame < 160, `starters played ${perGame.toFixed(1)} min in blowouts`)
  })

  it('named units put the bench five on to start the second quarter', () => {
    const home = makeTeam('BIG', referenceRatings(0))
    const away = makeTeam('SML', referenceRatings(0))
    home.units = {
      starters: home.players.slice(0, 5).map((p) => p.playerId),
      bench: home.players.slice(5, 10).map((p) => p.playerId),
      closing: home.players.slice(0, 5).map((p) => p.playerId),
      blowout: home.players.slice(5, 10).map((p) => p.playerId),
    }
    const r = simulateGame({ era: ERA_2016, home, away, seasonType: 'regular' }, 1)
    const q2 = r.pbp.findIndex((e) => e.text === 'Start of Q2')
    assert.ok(q2 >= 0, 'the game has a second quarter')
    const bench = new Set(home.units.bench)
    const entered = r.pbp
      .slice(q2 + 1, q2 + 16)
      .filter((e) => e.type === 'sub' && e.team === 'home')
    const benchIn = entered.filter((e) => e.playerId && bench.has(e.playerId)).length
    assert.ok(
      benchIn >= 3,
      `the second unit should take the start of Q2, got ${benchIn} bench entries in ${entered.map((e) => e.text).join('; ')}`,
    )
  })

  it('inheriting team tactics on a unit is the same game as leaving unitStyle off', () => {
    const home = makeTeam('BIG', referenceRatings(0))
    const away = makeTeam('SML', referenceRatings(0))
    home.units = {
      starters: home.players.slice(0, 5).map((p) => p.playerId),
      bench: home.players.slice(5, 10).map((p) => p.playerId),
      closing: home.players.slice(0, 5).map((p) => p.playerId),
      blowout: home.players.slice(5, 10).map((p) => p.playerId),
    }
    const input = { era: ERA_2016, home, away, seasonType: 'regular' as const }
    const a = simulateGame(input, 4)
    home.unitStyle = { bench: { pace: 0, threes: 0 }, starters: { pace: 0, threes: 0 } }
    const b = simulateGame(input, 4)
    assert.equal(a.home.pts, b.home.pts)
    assert.equal(a.away.pts, b.away.pts)
  })
})

describe('overtime', () => {
  it('plays a five-minute overtime and never returns a tie', () => {
    let overtimes = 0
    const games = 1500
    for (let seed = 1; seed <= games; seed++) {
      const r = simulateGame(makeGame(), seed)
      assert.notEqual(r.home.pts, r.away.pts)
      if (r.overtimes > 0) {
        overtimes++
        assert.equal(r.home.quarters.length, 4 + r.overtimes)
        // Extra periods add real playing time.
        const played = r.home.players.reduce((a, p) => a + p.min, 0)
        assert.ok(played > 240, 'overtime adds minutes')
      }
    }
    assert.ok(overtimes > 15, `only ${overtimes} overtimes in ${games} games`)
    assert.ok(overtimes < 200, `${overtimes} overtimes in ${games} games is too many`)
  })
})

describe('ratings drive results', () => {
  it('a better team wins well over half of 200 games', () => {
    let wins = 0
    for (let seed = 1; seed <= 200; seed++) {
      // Alternate venues so the result is not a home-court artefact.
      const home = seed % 2 === 0
      const input = makeGame(home ? 6 : 0, home ? 0 : 6)
      const r = simulateGame(input, seed)
      if ((r.winner === 'home') === home) wins++
    }
    assert.ok(wins > 120, `the better team won only ${wins} of 200`)
  })

  it('is monotonic in ratings', () => {
    const winPct = [-10, -5, 0, 5, 10].map((delta) => {
      let wins = 0
      const n = 150
      for (let seed = 1; seed <= n; seed++) {
        const input = makeGame(delta, 0)
        input.neutralSite = true
        if (simulateGame(input, seed * 31).winner === 'home') wins++
      }
      return wins / n
    })
    for (let i = 1; i < winPct.length; i++) {
      assert.ok(winPct[i]! > winPct[i - 1]!, `not monotonic: ${winPct.join(' ')}`)
    }
    assert.ok(Math.abs(winPct[2]! - 0.5) < 0.1, 'equal teams split at a neutral site')
  })
})
