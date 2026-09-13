// The bake-off entry: the possession-level engine.
// `naive.ts` stays as the untouched baseline and is reachable at `@hoops/engine/naive`.

export { type Anchors, computeAnchors } from './anchors.ts'
export { type SimOptions, simulateGame, simulateGameWith } from './possession.ts'
