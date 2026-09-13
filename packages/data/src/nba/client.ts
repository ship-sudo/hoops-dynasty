// stats.nba.com client. Endpoint catalogue and parameter shapes follow swar/nba_api.
// Works from Node's fetch (undici). curl gets fingerprinted and hangs — don't test with curl.

import { cachedFetch } from '../fetch.ts'

export const NBA_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
}

export type Cell = string | number | null
export type Row = Record<string, Cell>
export type Params = Record<string, string | number>

/** The empty-string parameter soup that every leaguedash* endpoint wants. */
export const DASH_DEFAULTS: Params = {
  College: '',
  Conference: '',
  Country: '',
  DateFrom: '',
  DateTo: '',
  Division: '',
  DraftPick: '',
  DraftYear: '',
  GameScope: '',
  GameSegment: '',
  Height: '',
  LastNGames: 0,
  LeagueID: '00',
  Location: '',
  Month: 0,
  OpponentTeamID: 0,
  Outcome: '',
  PORound: 0,
  PaceAdjust: 'N',
  Period: 0,
  PlayerExperience: '',
  PlayerPosition: '',
  PlusMinus: 'N',
  Rank: 'N',
  SeasonSegment: '',
  ShotClockRange: '',
  StarterBench: '',
  TeamID: 0,
  TwoWay: 0,
  VsConference: '',
  VsDivision: '',
  Weight: '',
}

/** '1997-98' for yearEnd 1998. */
export function seasonId(yearEnd: number): string {
  return `${yearEnd - 1}-${String(yearEnd % 100).padStart(2, '0')}`
}

export function cacheKey(endpoint: string, params: Params): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== 0 && v !== '0')
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${String(v).replace(/[^A-Za-z0-9.-]+/g, '_')}`)
  return `${endpoint}/${parts.join('&') || 'default'}.json`
}

export interface NbaResponse {
  [resultSetName: string]: Row[]
}

export async function nbaGet(endpoint: string, params: Params): Promise<NbaResponse> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  const url = `https://stats.nba.com/stats/${endpoint}?${qs}`
  const body = await cachedFetch('nba', cacheKey(endpoint, params), url, {
    headers: NBA_HEADERS,
    validate: (t) => t.startsWith('{') && (t.includes('"resultSets"') || t.includes('"resultSet"')),
  })
  return parseNba(body)
}

export function parseNba(body: string): NbaResponse {
  const j = JSON.parse(body) as {
    resultSets?: { name: string; headers: string[]; rowSet: Cell[][] }[]
    resultSet?: { name: string; headers: string[]; rowSet: Cell[][] }
  }
  const sets = j.resultSets ?? (j.resultSet ? [j.resultSet] : [])
  const out: NbaResponse = {}
  for (const s of sets) {
    out[s.name] = s.rowSet.map((r) =>
      Object.fromEntries(s.headers.map((h, i) => [h, r[i] ?? null])),
    )
  }
  return out
}
