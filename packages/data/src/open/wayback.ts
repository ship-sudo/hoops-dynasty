// Wayback Machine snapshots of basketball-reference /contracts/players.html.
// One snapshot per season, the one nearest opening night.
// Gives salaries for 2021..2026 (2020-21 .. 2025-26) plus the forward view with option flags.
// The CDX index lists every snapshot in one request; the availability API 429s, so it is not used.
// archive.org is rate-limited to one request per 4 s. Everything is cached under data/raw/wayback/.
// Run: npx tsx packages/data/src/open/wayback.ts

import { cachedFetch, isCached } from '../fetch.ts'
import { type ContractsPage, parseContractsPage } from './contracts.ts'

export const WAYBACK_SOURCE = 'wayback'
const CONTRACTS_URL = 'basketball-reference.com/contracts/players.html'
const MIN_INTERVAL = { minIntervalMs: 4000 }

/** Opening-night date per season_end. We take the archive's nearest snapshot. */
export const OPENING_NIGHT: Record<number, string> = {
  2021: '20201222',
  2022: '20211019',
  2023: '20221018',
  2024: '20231024',
  2025: '20241022',
  2026: '20251021',
}

export interface Snapshot {
  season_end: number
  /** Archive timestamp, YYYYMMDDhhmmss. */
  timestamp: string
}

/** All 200-status snapshot timestamps for the contracts page, 2020..2025. Cached. */
export async function listSnapshots(): Promise<string[]> {
  const url =
    `https://web.archive.org/cdx/search/cdx?url=${CONTRACTS_URL}` +
    '&from=2020&to=2025&output=json&filter=statuscode:200&fl=timestamp,statuscode,length'
  const body = await cachedFetch(WAYBACK_SOURCE, 'cdx-contracts-players-2020-2025.json', url, {
    ...MIN_INTERVAL,
    timeoutMs: 90_000,
    validate: (b) => b.trimStart().startsWith('['),
  })
  const rows = JSON.parse(body) as string[][]
  return rows.slice(1).map((r) => r[0] as string)
}

function dayNumber(ts: string): number {
  return (
    Date.UTC(Number(ts.slice(0, 4)), Number(ts.slice(4, 6)) - 1, Number(ts.slice(6, 8))) /
    86_400_000
  )
}

/** Snapshot nearest to `target` (YYYYMMDD) by days; ties go to the later one. */
export function nearestSnapshot(timestamps: string[], target: string): string | null {
  const t = dayNumber(target)
  let best: string | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const ts of timestamps) {
    const d = Math.abs(dayNumber(ts) - t)
    if (d < bestDist || (d === bestDist && best !== null && ts > best)) {
      best = ts
      bestDist = d
    }
  }
  return best
}

export async function findSnapshot(season_end: number): Promise<Snapshot | null> {
  const target = OPENING_NIGHT[season_end]
  if (!target) throw new Error(`no opening-night target for ${season_end}`)
  const ts = nearestSnapshot(await listSnapshots(), target)
  return ts ? { season_end, timestamp: ts } : null
}

/** Raw-content URL (`id_` flag) so links and markup are the original page, not the archive's rewrite. */
export function rawSnapshotUrl(s: Snapshot): string {
  return `https://web.archive.org/web/${s.timestamp}id_/https://www.${CONTRACTS_URL}`
}

export function snapshotKey(s: Snapshot): string {
  return `contracts-players/${s.season_end}-${s.timestamp}.html`
}

/** Fetch one snapshot's HTML. Cached; validated to contain the contracts table. */
export async function fetchSnapshot(s: Snapshot): Promise<string> {
  return cachedFetch(WAYBACK_SOURCE, snapshotKey(s), rawSnapshotUrl(s), {
    ...MIN_INTERVAL,
    timeoutMs: 90_000,
    validate: (b) => b.includes('id="player-contracts"'),
  })
}

export interface WaybackContracts extends ContractsPage {
  snapshot: Snapshot
}

/** Find, fetch and parse the opening-night contracts snapshot for one season. */
export async function loadWaybackContracts(season_end: number): Promise<WaybackContracts | null> {
  const snap = await findSnapshot(season_end)
  if (!snap) return null
  const page = parseContractsPage(await fetchSnapshot(snap))
  return { ...page, snapshot: snap }
}

export async function probeAll(): Promise<void> {
  for (const season of Object.keys(OPENING_NIGHT).map(Number)) {
    const snap = await findSnapshot(season)
    if (!snap) {
      console.log(`${season}: no snapshot near ${OPENING_NIGHT[season]}`)
      continue
    }
    const cached = isCached(WAYBACK_SOURCE, snapshotKey(snap))
    const page = parseContractsPage(await fetchSnapshot(snap))
    const y1 = page.rows.filter((r) =>
      r.seasons.some((s) => s.season_end === page.first_season_end),
    )
    const withId = page.rows.filter((r) => r.player_id).length
    const opts = page.rows.flatMap((r) => r.seasons).filter((s) => s.option).length
    console.log(
      `${season}: snapshot ${snap.timestamp} ${cached ? '(cached)' : '(fetched)'} y1=${page.columns.y1} ` +
        `rows=${page.rows.length} with_y1_salary=${y1.length} with_id=${withId} option_cells=${opts}`,
    )
  }
}

if (process.argv[1]?.endsWith('wayback.ts')) {
  probeAll().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
