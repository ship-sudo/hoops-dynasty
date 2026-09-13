// Current contracts from basketball-reference /contracts/players.html.
// Cached at data/raw/bref/contracts-players.html. A cached key is never fetched twice.
// Columns y1..y6 = 2026-27 .. 2031-32 on a September 2026 fetch. Option flags per salary cell.

import { existsSync, readFileSync } from 'node:fs'
import { cachedFetch, cachePath, isCached } from '../fetch.ts'
import { type ContractsPage, parseContractsPage } from './contracts.ts'

export const CONTRACTS_CURRENT_PATH = cachePath('bref', 'contracts-players.html')
export const CONTRACTS_CURRENT_URL = 'https://www.basketball-reference.com/contracts/players.html'

const BREF_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

const hasTable = (b: string) =>
  b.includes('id="player-contracts"') || b.includes('player-contracts')

/** Parse the cached current contracts page. */
export function loadCurrentContracts(): ContractsPage {
  return parseContractsPage(readFileSync(CONTRACTS_CURRENT_PATH, 'utf8'))
}

/** Fetch the live page once if it is not already cached, then parse it. */
export async function ensureCurrentContracts(): Promise<ContractsPage> {
  if (!existsSync(CONTRACTS_CURRENT_PATH)) {
    await cachedFetch('bref', 'contracts-players.html', CONTRACTS_CURRENT_URL, {
      headers: BREF_HEADERS,
      timeoutMs: 60_000,
      validate: hasTable,
    })
  }
  return loadCurrentContracts()
}

export function currentContractsCached(): boolean {
  return isCached('bref', 'contracts-players.html')
}
