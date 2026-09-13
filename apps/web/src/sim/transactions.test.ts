import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { SeasonBundle } from '@hoops/core'
import { newGame, payrollOf, rosterOf } from '@hoops/game'
import { applySignMinimum, applyWaive, unsignedPool } from './transactions.ts'

const dataDir = process.env.HOOPS_DATA_DIR ?? join(process.cwd(), 'data')
const bundlePath = join(dataDir, 'bundles', '2004.json')
const havePipeline = existsSync(bundlePath)
const bundle: SeasonBundle | null = havePipeline
  ? (JSON.parse(readFileSync(bundlePath, 'utf8')) as SeasonBundle)
  : null
const skip = !havePipeline
const SAS = () => bundle!.teams.find((t) => t.abbr === 'SAS')!.teamId

test('a waiver leaves dead cap and the man can be signed back at the minimum', { skip }, () => {
  const state = newGame(bundle!, SAS(), 3)
  const cheap =
    rosterOf(state, SAS()).find((p) =>
      p.contract?.years.some((y) => y.yearEnd === state.season.yearEnd && y.guaranteed),
    ) ??
    rosterOf(state, SAS())[0]!
  const guaranteed = (cheap.contract?.years ?? []).filter(
    (y) => y.yearEnd >= state.season.yearEnd && y.guaranteed,
  )
  const aboveMin = rosterOf(state, SAS()).length > state.season.rules.roster_min
  const cut = applyWaive(state, cheap.playerId)
  if (!aboveMin) {
    assert.equal(cut.ok, false)
    return
  }
  assert.equal(cut.ok, true, cut.message)
  assert.equal(cheap.teamId, null)
  if (guaranteed.length > 0) {
    assert.ok((state.deadMoney ?? []).some((d) => d.teamId === SAS() && d.amount > 0))
    assert.ok(payrollOf(state, SAS()) > 0)
  }
  assert.ok(unsignedPool(state).some((p) => p.playerId === cheap.playerId))

  while (
    rosterOf(state, SAS()).length >= state.season.rules.roster_max &&
    rosterOf(state, SAS()).length > state.season.rules.roster_min
  ) {
    const next = rosterOf(state, SAS())[0]!
    assert.equal(applyWaive(state, next.playerId).ok, true)
  }
  const signed = applySignMinimum(state, cheap.playerId)
  assert.equal(signed.ok, true, signed.message)
  assert.equal(cheap.teamId, SAS())
  assert.equal(cheap.contract?.kind, 'minimum')
})
