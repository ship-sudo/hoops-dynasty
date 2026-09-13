// The only place in the repo that calls fetch() for data.
// Every response is cached at data/raw/<source>/<key>. A cached key is never fetched twice.
// Per-host rate limits live here so no caller can burst a site. Slow hosts (basketball-reference)
// are throttled across processes through a lock under data/raw/.throttle so parallel lanes cannot double the rate.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { RAW_DIR } from './paths.ts'

/** Suffix-matched. Anything else gets 1000 ms. */
const HOST_MIN_INTERVAL_MS: [suffix: string, ms: number][] = [
  ['basketball-reference.com', 4000], // their rule: ≤20/min. We do ≤15/min.
  ['sports-reference.com', 4000],
  ['archive.org', 4000],
  ['stats.nba.com', 700],
  ['githubusercontent.com', 300],
  ['api.github.com', 1500],
]
const BLOCK_HOURS = 24
const lastHit = new Map<string, number>()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface FetchOpts {
  headers?: Record<string, string>
  /** Minimum ms between requests to this host. The per-host default applies if larger. */
  minIntervalMs?: number
  timeoutMs?: number
  retries?: number
  /** Reject a body before caching it (e.g. HTML where JSON was expected). */
  validate?: (body: string) => boolean
}

class NoRetry extends Error {}

export function cachePath(source: string, key: string): string {
  return path.join(RAW_DIR, source, key)
}

export function isCached(source: string, key: string): boolean {
  return existsSync(cachePath(source, key))
}

function minIntervalFor(host: string): number {
  for (const [suffix, ms] of HOST_MIN_INTERVAL_MS)
    if (host === suffix || host.endsWith(`.${suffix}`)) return ms
  return 1000
}

function throttleDir(): string {
  const d = path.join(RAW_DIR, '.throttle')
  mkdirSync(d, { recursive: true })
  return d
}

/** Cross-process throttle for slow hosts: hold a lock dir while waiting and requesting. */
async function withHostLock<T>(host: string, min: number, fn: () => Promise<T>): Promise<T> {
  if (min < 2000) {
    const wait = (lastHit.get(host) ?? 0) + min - Date.now()
    if (wait > 0) await sleep(wait)
    lastHit.set(host, Date.now())
    return fn()
  }
  const dir = throttleDir()
  const lock = path.join(dir, `${host}.lock`)
  const stamp = path.join(dir, host)
  const blocked = path.join(dir, `${host}.blocked`)
  if (existsSync(blocked)) {
    const at = Number(readFileSync(blocked, 'utf8'))
    if (Date.now() - at < BLOCK_HOURS * 3600_000)
      throw new NoRetry(
        `${host} returned 429 at ${new Date(at).toISOString()}; not retrying for ${BLOCK_HOURS} h`,
      )
    rmSync(blocked)
  }
  for (let i = 0; ; i++) {
    try {
      mkdirSync(lock)
      break
    } catch {
      if (i > 600) throw new Error(`stuck waiting for ${lock}`)
      await sleep(500)
    }
  }
  try {
    const last = existsSync(stamp) ? Number(readFileSync(stamp, 'utf8')) : 0
    const wait = last + min - Date.now()
    if (wait > 0) await sleep(wait)
    writeFileSync(stamp, String(Date.now()))
    try {
      return await fn()
    } catch (e) {
      if (e instanceof Blocked) writeFileSync(blocked, String(Date.now()))
      throw e
    }
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

class Blocked extends NoRetry {}

function writeAtomic(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, body)
  renameSync(tmp, file)
}

export async function cachedFetch(
  source: string,
  key: string,
  url: string,
  opts: FetchOpts = {},
): Promise<string> {
  const file = cachePath(source, key)
  if (existsSync(file)) return readFileSync(file, 'utf8')
  const marker = `${file}.http`
  if (existsSync(marker))
    throw new NoRetry(`cached failure ${readFileSync(marker, 'utf8')} for ${url}`)
  if (process.env.HOOPS_OFFLINE === '1') throw new Error(`offline and not cached: ${source}/${key}`)
  const host = new URL(url).host
  const min = Math.max(opts.minIntervalMs ?? 0, minIntervalFor(host))
  const retries = opts.retries ?? 3
  for (let attempt = 0; ; attempt++) {
    try {
      return await withHostLock(host, min, async () => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
        try {
          const r = await fetch(url, {
            headers: opts.headers ?? {},
            signal: ctrl.signal,
            redirect: 'follow',
          })
          const body = await r.text()
          if (r.status === 429 && min >= 2000) throw new Blocked(`HTTP 429 from ${host}: ${url}`)
          if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status} ${url}`)
          if (!r.ok) {
            writeAtomic(marker, String(r.status))
            throw new NoRetry(`HTTP ${r.status} ${url}`)
          }
          if (opts.validate && !opts.validate(body))
            throw new Error(`invalid body from ${url}: ${body.slice(0, 80)}`)
          writeAtomic(file, body)
          return body
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (e) {
      if (e instanceof NoRetry || attempt >= retries) throw e
      await sleep(min * 2 ** (attempt + 1))
    }
  }
}
