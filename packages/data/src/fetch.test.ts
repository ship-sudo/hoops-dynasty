import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// Point the cache at a temp dir before importing the module under test.
process.env.HOOPS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'hoops-fetch-'))
const { cachedFetch, cachePath } = await import('./fetch.ts')

test('cached key is returned without a network call', async () => {
  const file = cachePath('t', 'a.json')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{"cached":true}')
  const body = await cachedFetch('t', 'a.json', 'http://127.0.0.1:1/never')
  assert.equal(body, '{"cached":true}')
})

test('offline mode throws for uncached keys', async () => {
  process.env.HOOPS_OFFLINE = '1'
  await assert.rejects(cachedFetch('t', 'missing.json', 'http://127.0.0.1:1/never'), /offline/)
  delete process.env.HOOPS_OFFLINE
})

test('4xx is cached as a failure marker and not refetched', async () => {
  const { createServer } = await import('node:http')
  let hits = 0
  const srv = createServer((_req, res) => {
    hits++
    res.statusCode = 404
    res.end('nope')
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  const url = `http://127.0.0.1:${port}/x`
  await assert.rejects(cachedFetch('t', 'four.json', url, { retries: 0 }), /HTTP 404/)
  await assert.rejects(cachedFetch('t', 'four.json', url, { retries: 0 }), /cached failure 404/)
  assert.equal(hits, 1)
  assert.ok(existsSync(`${cachePath('t', 'four.json')}.http`))
  assert.equal(readFileSync(`${cachePath('t', 'four.json')}.http`, 'utf8'), '404')
  srv.close()
})
