import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FreeAgentView } from '../sim/api.ts'
import {
  continueLabel,
  continueTarget,
  followPhase,
  landingStep,
  marketFreeAgents,
  ownFreeAgents,
  stepTone,
  stepUnlocked,
} from './offseasonFlow.ts'

test('after the draft you land on your team, not the market', () => {
  assert.equal(landingStep('lottery'), 'lottery')
  assert.equal(landingStep('draft'), 'draft')
  assert.equal(landingStep('freeagency'), 'squad')
  assert.equal(landingStep('done'), 'done')
})

test('your team is always open; the market waits for the draft', () => {
  assert.equal(stepUnlocked('squad', 'lottery'), true)
  assert.equal(stepUnlocked('squad', 'draft'), true)
  assert.equal(stepUnlocked('resign', 'draft'), false)
  assert.equal(stepUnlocked('market', 'draft'), false)
  assert.equal(stepUnlocked('resign', 'freeagency'), true)
  assert.equal(stepUnlocked('market', 'freeagency'), true)
  assert.equal(stepUnlocked('draft', 'lottery'), false)
  assert.equal(stepUnlocked('lottery', 'draft'), false)
})

test('finishing the draft walks you onto the squad, not off a page you chose', () => {
  assert.equal(followPhase('lottery', 'draft'), 'draft')
  assert.equal(followPhase('draft', 'freeagency'), 'squad')
  assert.equal(followPhase('squad', 'freeagency'), 'squad')
  assert.equal(followPhase('market', 'freeagency'), 'market')
  assert.equal(followPhase('resign', 'done'), 'done')
})

test('re-sign is your own men; the market is everyone else', () => {
  const list: FreeAgentView[] = [
    {
      playerId: 'a',
      name: 'Duncan',
      pos: 'PF',
      age: 28,
      overall: 90,
      asking: 1,
      askingYears: 3,
      offer: null,
      incumbentTeamId: 'SAS',
    },
    {
      playerId: 'b',
      name: 'Kidd',
      pos: 'PG',
      age: 31,
      overall: 88,
      asking: 1,
      askingYears: 4,
      offer: null,
      incumbentTeamId: 'NJN',
    },
    {
      playerId: 'c',
      name: 'Walker',
      pos: 'PF',
      age: 27,
      overall: 80,
      asking: 1,
      askingYears: 2,
      offer: null,
      incumbentTeamId: null,
    },
  ]
  assert.deepEqual(
    ownFreeAgents(list, 'SAS').map((p) => p.name),
    ['Duncan'],
  )
  assert.deepEqual(
    marketFreeAgents(list, 'SAS').map((p) => p.name),
    ['Kidd', 'Walker'],
  )
})

test('Start the season is not the button on draft night', () => {
  assert.equal(continueLabel('draft', 'draft'), null)
  assert.equal(continueTarget('draft', 'draft'), null)
  assert.equal(continueLabel('squad', 'freeagency'), 'Re-sign your players ▸')
  assert.equal(continueTarget('squad', 'freeagency'), 'resign')
  assert.equal(continueLabel('market', 'freeagency'), 'Start the season ▸')
  assert.equal(continueTarget('market', 'freeagency'), 'finish')
})

test('the current step is now, locked future steps stay locked', () => {
  assert.equal(stepTone('draft', 'draft', 'draft'), 'now')
  assert.equal(stepTone('market', 'draft', 'draft'), 'locked')
  assert.equal(stepTone('squad', 'draft', 'draft'), 'open')
  assert.equal(stepTone('lottery', 'draft', 'draft'), 'past')
})
