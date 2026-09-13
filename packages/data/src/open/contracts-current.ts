// Current contracts from the cached basketball-reference /contracts/players.html.
// Source: data/raw/bref/contracts-players.html (fetched 2026-09-10; never refetched).
// Columns y1..y6 = 2026-27 .. 2031-32 on that fetch. Option flags per salary cell.

import { readFileSync } from 'node:fs'
import { cachePath } from '../fetch.ts'
import { type ContractsPage, parseContractsPage } from './contracts.ts'

export const CONTRACTS_CURRENT_PATH = cachePath('bref', 'contracts-players.html')

/** Parse the cached current contracts page. */
export function loadCurrentContracts(): ContractsPage {
  return parseContractsPage(readFileSync(CONTRACTS_CURRENT_PATH, 'utf8'))
}
