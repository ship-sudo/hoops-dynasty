// The staff, end to end through the real packages: does the man in the chair change the game?
//
// These need the data pipeline to have run (data/bundles). They skip themselves when it has not.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SeasonBundle } from '@hoops/core'
import {
  type Coach,
  type CoachRatings,
  coachOf,
  type GameState,
  packCoach,
  rebuildProfile,
  STAFF_ROLES,
  type StaffRole,
  slotsOf,
} from '@hoops/game'
import { overall } from '@hoops/progression'
import type { SaveFile } from './api.ts'
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

const gameOf = (save: SaveFile): GameState => (save.state as { game: GameState }).game

/** Rewrite one of a club's coaches inside a save, so a test can hold everything else equal. */
function setCoach(state: GameState, teamId: string, role: StaffRole, patch: Partial<CoachRatings>) {
  const staff = state.staff!
  const id = slotsOf(staff, teamId)[STAFF_ROLES.indexOf(role)] as string
  const c = coachOf(state, id) as Coach
  c.ratings = { ...c.ratings, ...patch }
  staff.coaches[id] = packCoach(c)
  rebuildProfile(staff, teamId)
}

function playSeason(d: ReturnType<typeof start>): void {
  for (;;) if (!d.simDay()) break
}

test('a staff arrives with a new game and reads back through the seam', { skip }, () => {
  const d = start()
  const view = d.staff()
  assert.equal(view.slots.length, 5)
  for (const s of view.slots) {
    assert.ok(s.coach, `${s.role} should be filled on opening night`)
    assert.ok(s.coach.effects.length >= 2, 'every man says what he does, with numbers')
    assert.ok(s.coach.salary > 0)
  }
  assert.ok(view.wages > 0)
  assert.equal(view.deadMoney, 0)
  assert.ok(view.pool.length > 10, `a market of ${view.pool.length} is too thin`)
  assert.equal(view.rivals.length, bundle!.teams.length - 1)
  for (const c of view.pool)
    assert.equal(c.interest.length, 5, 'a candidate answers for all five chairs')
})

test('hiring and firing survive a save and a reload', { skip }, () => {
  const d = start(6)
  const before = d.staff()
  const head = before.slots.find((s) => s.role === 'head')!
  const cost = head.severance

  const sacked = d.fireCoach('head')
  assert.equal(sacked.ok, true, sacked.message)
  assert.match(sacked.message, /sacked/)
  assert.equal(sacked.view.slots.find((s) => s.role === 'head')!.coach, null)
  assert.equal(sacked.view.deadMoney, cost)

  // Somebody in the market will take the job; the refusals say why not.
  const willing = sacked.view.pool.find((c) => c.interest.find((i) => i.role === 'head')?.willing)
  assert.ok(willing, 'a whole market cannot all say no')
  const hired = d.hireCoach(willing.coachId, 'head', 3)
  assert.equal(hired.ok, true, hired.message)
  const nowHead = hired.view.slots.find((s) => s.role === 'head')!.coach!
  assert.equal(nowHead.coachId, willing.coachId)
  assert.equal(nowHead.yearsLeft, 3)

  const save = d.save()
  const back = realModule().loadGame(bundle!, save)
  const after = back.staff()
  assert.equal(after.slots.find((s) => s.role === 'head')!.coach!.coachId, willing.coachId)
  assert.equal(after.deadMoney, cost)
  // The man you sacked is on the market, and the screen remembers it was you.
  assert.ok(
    after.pool.some((c) => c.coachId === head.coach!.coachId) ||
      after.rivals.some((r) => r.formerlyYours),
    'a sacked coach is still somewhere in the league',
  )
  // And a refusal is still a sentence, not a shrug.
  const no = after.pool.find((c) => c.interest.some((i) => !i.willing))
  if (no) assert.match(no.interest.find((i) => !i.willing)!.reason, /He says no/)
})

test('the development coach changes what a young player gains', { skip }, () => {
  // One season, played twice from the same seed. The only difference between the two runs is the
  // development rating, which nothing in the game loop reads — so the seasons are identical and
  // every rating point of difference in the summer is the coach's doing.
  const base = start(11).save()
  const run = (development: number): Map<string, number> => {
    const save = JSON.parse(JSON.stringify(base)) as SaveFile
    setCoach(gameOf(save), SAS(), 'development', { development })
    const d = realModule().loadGame(bundle!, save)
    playSeason(d)
    d.finishOffseason()
    const out = new Map<string, number>()
    for (const p of gameOf(d.save()).league.players) out.set(p.playerId, overall(p.ratings))
    return out
  }
  const young = new Map(
    gameOf(base)
      .league.players.filter((p) => p.teamId === SAS() && p.age <= 24)
      .map((p) => [p.playerId, overall(p.ratings)] as const),
  )
  assert.ok(young.size > 0, 'the 2003-04 Spurs have some kids')

  const great = run(100)
  const awful = run(0)

  let better = 0
  let worse = 0
  let sumGreat = 0
  let sumAwful = 0
  for (const [id, was] of young) {
    const g = great.get(id)
    const a = awful.get(id)
    if (g == null || a == null) continue
    sumGreat += g - was
    sumAwful += a - was
    if (g > a) better++
    else if (g < a) worse++
  }
  assert.ok(better > 0, 'a great development coach has to help somebody')
  assert.equal(worse, 0, 'and he can never make a young player worse than a hopeless one would')
  assert.ok(
    sumGreat > sumAwful,
    `total gain under a 100 coach (${sumGreat.toFixed(2)}) should beat a 0 coach (${sumAwful.toFixed(2)})`,
  )
})

test('the head scout decides how clearly you see the draft board', { skip }, () => {
  const base = start(12).save()
  const run = (scouting: number) => {
    const save = JSON.parse(JSON.stringify(base)) as SaveFile
    setCoach(gameOf(save), SAS(), 'scout', { scouting })
    const d = realModule().loadGame(bundle!, save)
    playSeason(d)
    // The lottery, then the board — the same call the offseason screen makes.
    return d.advanceDraft().board
  }
  const sharp = run(99)
  const blind = run(10)
  assert.ok(sharp.length > 5 && blind.length > 5, 'there is a board to read')

  const conf = (b: typeof sharp) => b.reduce((t, p) => t + p.confidence, 0) / b.length
  assert.ok(
    conf(sharp) > conf(blind) + 0.4,
    `a 99 department should be far surer than a 10: ${conf(sharp).toFixed(2)} vs ${conf(blind).toFixed(2)}`,
  )
  // And the vaguer department reports much wider ceilings.
  const band = (b: typeof sharp) =>
    b.reduce((t, p) => t + (p.potentialHigh - p.potentialLow), 0) / b.length
  assert.ok(
    band(blind) > band(sharp),
    `a poor scout should be vague: ${band(blind).toFixed(1)} vs ${band(sharp).toFixed(1)} points of band`,
  )
})

test('the carousel turns while you are not looking', { skip }, () => {
  const d = start(13)
  const before = new Map(d.staff().rivals.map((r) => [r.teamId, r.coachName]))
  playSeason(d)
  d.finishOffseason()
  const after = d.staff().rivals
  const moved = after.filter((r) => before.get(r.teamId) !== r.coachName)
  assert.ok(moved.length > 0, 'somebody in a 30-club league loses his job in a summer')
  for (const r of after) assert.notEqual(r.coachName, 'Vacant', `${r.teamId} is short a head coach`)
  // The head coaches now carry a record, because a season has been played under them.
  assert.ok(
    after.some((r) => r.record.w + r.record.l >= 82),
    'a full season should land on somebody',
  )
})
