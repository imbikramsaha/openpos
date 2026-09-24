import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createServer, type KasaServer } from '../server/src/server.js'
import { SYNCED_TABLES as SERVER_TABLES } from '../server/src/tables.js'
import { SYNCED_TABLES } from '@/core/types'

const ADMIN = 'test-admin-token'

let dataDir: string
let staticDir: string
let srv: KasaServer
let base: string

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-server-test-'))
  staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-static-test-'))
  fs.mkdirSync(path.join(staticDir, 'assets'))
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Kasa</title>')
  fs.writeFileSync(path.join(staticDir, 'sw.js'), 'self.addEventListener("fetch", () => {})')
  fs.writeFileSync(path.join(staticDir, 'manifest.webmanifest'), '{"name":"Kasa POS"}')
  fs.writeFileSync(path.join(staticDir, 'assets', 'index-AbCd1234.js'), 'console.log(1);'.repeat(200))
  fs.writeFileSync(path.join(staticDir, 'assets', 'zxing_reader-Q1w2e3r4.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))
  fs.writeFileSync(path.join(staticDir, '.env'), 'SECRET=1')
  srv = createServer({ dataDir, staticDir, adminToken: ADMIN, log: false })
  base = (await srv.listen(0, '127.0.0.1')).url
})

afterAll(async () => {
  await srv?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.rmSync(staticDir, { recursive: true, force: true })
})

interface CallOptions {
  key?: string
  body?: unknown
  headers?: Record<string, string>
}

async function call(method: string, p: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = { ...opts.headers }
  if (opts.key) headers.Authorization = `Bearer ${opts.key}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + p, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, json, text, headers: res.headers }
}

/** Raw request that keeps the path exactly as written (fetch would normalise "..").*/
function rawGet(p: string): Promise<{ status: number; body: string }> {
  const u = new URL(base)
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: p, method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function newStore(name = 'Test Shop') {
  const r = await call('POST', '/api/admin/stores', { key: ADMIN, body: { name } })
  expect(r.status).toBe(201)
  return r.json as { id: string; name: string; key: string }
}

const change = (table: string, id: string, updatedAt: number, data: Record<string, unknown> = {}) => ({
  table,
  id,
  updatedAt,
  data: { id, createdAt: updatedAt, updatedAt, ...data },
})

describe('sync server', () => {
  it('server table whitelist matches SYNCED_TABLES in src/core/types.ts', () => {
    expect([...SERVER_TABLES]).toEqual([...SYNCED_TABLES])
  })

  it('reports health', async () => {
    const r = await call('GET', '/api/health')
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('protects the admin API and creates stores with one-time keys', async () => {
    expect((await call('GET', '/api/admin/stores')).status).toBe(401)
    expect((await call('GET', '/api/admin/stores', { key: 'wrong' })).status).toBe(401)
    expect((await call('POST', '/api/admin/stores', { key: ADMIN, body: { name: '  ' } })).status).toBe(400)

    const store = await newStore('Corner Shop')
    expect(store.name).toBe('Corner Shop')
    expect(store.key).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const list = await call('GET', '/api/admin/stores', { key: ADMIN })
    expect(list.status).toBe(200)
    const found = list.json.stores.find((s: { id: string }) => s.id === store.id)
    expect(found).toMatchObject({ name: 'Corner Shop', records: 0 })
    expect(JSON.stringify(list.json)).not.toContain(store.key)
  })

  it('disables the admin API when no ADMIN_TOKEN is set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-noadmin-'))
    const other = createServer({ dataDir: dir, staticDir: null, log: false })
    const { url } = await other.listen(0, '127.0.0.1')
    try {
      const r = await fetch(url + '/api/admin/stores', { headers: { Authorization: 'Bearer anything' } })
      expect(r.status).toBe(403)
    } finally {
      await other.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects missing or invalid store keys with 401', async () => {
    const store = await newStore()
    for (const key of [undefined, 'not-a-real-key', ADMIN]) {
      expect((await call('GET', '/api/store', { key })).status).toBe(401)
      expect((await call('GET', '/api/sync/pull?since=0', { key })).status).toBe(401)
      expect((await call('POST', '/api/sync/push', { key, body: { changes: [] } })).status).toBe(401)
    }
    const ok = await call('GET', '/api/store', { key: store.key })
    expect(ok.status).toBe(200)
    expect(ok.json).toEqual({ id: store.id, name: 'Test Shop' })
  })

  it('round-trips pushed changes through pull in seq order', async () => {
    const { key } = await newStore()
    const t = 1_700_000_000_000
    const push = await call('POST', '/api/sync/push', {
      key,
      body: { deviceId: 'dev-a', changes: [change('products', 'p1', t, { name: 'Tea' }), change('sales', 's1', t + 1, { total: 500 })] },
    })
    expect(push.status).toBe(200)
    expect(push.json).toMatchObject({ accepted: 2, stale: 0 })
    expect(typeof push.json.serverTime).toBe('number')

    const pull = await call('GET', '/api/sync/pull?since=0&limit=1000', { key })
    expect(pull.status).toBe(200)
    expect(pull.json.hasMore).toBe(false)
    expect(pull.json.changes.map((c: { id: string }) => c.id)).toEqual(['p1', 's1'])
    const [p1, s1] = pull.json.changes
    expect(p1).toMatchObject({ table: 'products', id: 'p1', updatedAt: t, data: { name: 'Tea', id: 'p1', updatedAt: t } })
    expect(s1.seq).toBeGreaterThan(p1.seq)
    expect(pull.json.cursor).toBe(s1.seq)

    const after = await call('GET', `/api/sync/pull?since=${pull.json.cursor}`, { key })
    expect(after.json.changes).toEqual([])
    expect(after.json.cursor).toBe(pull.json.cursor)
  })

  it('applies last-write-wins: older and equal updates are stale, newer ones win', async () => {
    const { key } = await newStore()
    const t = 1_700_000_000_000
    await call('POST', '/api/sync/push', { key, body: { changes: [change('products', 'p1', t + 100, { name: 'Newer' })] } })

    const older = await call('POST', '/api/sync/push', { key, body: { changes: [change('products', 'p1', t, { name: 'Older' })] } })
    expect(older.json).toMatchObject({ accepted: 0, stale: 1 })
    const equal = await call('POST', '/api/sync/push', { key, body: { changes: [change('products', 'p1', t + 100, { name: 'Same time' })] } })
    expect(equal.json).toMatchObject({ accepted: 0, stale: 1 })

    let pull = await call('GET', '/api/sync/pull?since=0', { key })
    expect(pull.json.changes).toHaveLength(1)
    expect(pull.json.changes[0].data.name).toBe('Newer')
    const firstSeq = pull.json.changes[0].seq

    const newer = await call('POST', '/api/sync/push', { key, body: { changes: [change('products', 'p1', t + 200, { name: 'Newest' })] } })
    expect(newer.json).toMatchObject({ accepted: 1, stale: 0 })
    pull = await call('GET', `/api/sync/pull?since=${firstSeq}`, { key })
    expect(pull.json.changes).toHaveLength(1)
    expect(pull.json.changes[0].data.name).toBe('Newest')
    expect(pull.json.changes[0].seq).toBeGreaterThan(firstSeq)
  })

  it('rejects unknown tables and malformed changes without storing anything', async () => {
    const { key } = await newStore()
    const t = Date.now()
    const bad = await call('POST', '/api/sync/push', { key, body: { changes: [change('products', 'ok', t), change('secrets', 'x', t)] } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/unknown table/i)
    for (const body of [
      { changes: 'nope' },
      { changes: [{ table: 'products', id: '', updatedAt: t }] },
      { changes: [{ table: 'products', id: 'a', updatedAt: 'x' }] },
      // Nanoseconds by mistake: beyond Number.MAX_SAFE_INTEGER, would break later pulls.
      '{"changes":[{"table":"products","id":"a","updatedAt":1790255011528638720,"data":{}}]}',
      '{not json',
    ]) {
      expect((await call('POST', '/api/sync/push', { key, body })).status).toBe(400)
    }
    const pull = await call('GET', '/api/sync/pull?since=0', { key })
    expect(pull.json.changes).toEqual([])
    expect((await call('GET', '/api/sync/pull?since=-1', { key })).status).toBe(400)
  })

  it('pages pulls with limit/hasMore and keeps stores isolated', async () => {
    const a = await newStore('A')
    const b = await newStore('B')
    const t = Date.now()
    const changes = Array.from({ length: 25 }, (_, i) => change('audit', `e${i}`, t + i, { action: 'test' }))
    await call('POST', '/api/sync/push', { key: a.key, body: { changes } })

    const ids: string[] = []
    let since = 0
    let pages = 0
    for (;;) {
      const r = await call('GET', `/api/sync/pull?since=${since}&limit=10`, { key: a.key })
      ids.push(...r.json.changes.map((c: { id: string }) => c.id))
      pages++
      since = r.json.cursor
      if (!r.json.hasMore) break
    }
    expect(pages).toBe(3)
    expect(ids).toEqual(changes.map((c) => c.id))
    expect((await call('GET', '/api/sync/pull?since=0', { key: b.key })).json.changes).toEqual([])
  })

  it('strips derived fields even if a client sends them', async () => {
    const { key } = await newStore()
    const t = Date.now()
    await call('POST', '/api/sync/push', {
      key,
      body: { changes: [change('products', 'p', t, { name: 'X', stock: 42 }), change('customers', 'c', t, { name: 'Y', balance: 5, loyaltyPoints: 9 })] },
    })
    const [p, c] = (await call('GET', '/api/sync/pull?since=0', { key })).json.changes
    expect(p.data).not.toHaveProperty('stock')
    expect(c.data).not.toHaveProperty('balance')
    expect(c.data).not.toHaveProperty('loyaltyPoints')
    expect(c.data.name).toBe('Y')
  })

  it('records soft deletes', async () => {
    const { key } = await newStore()
    const t = Date.now()
    await call('POST', '/api/sync/push', { key, body: { changes: [{ ...change('categories', 'c1', t), deleted: true }] } })
    const [c] = (await call('GET', '/api/sync/pull?since=0', { key })).json.changes
    expect(c.deleted).toBe(true)
    expect(c.data.deleted).toBe(true)
  })

  it('enforces batch and body size limits', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-limits-'))
    const small = createServer({ dataDir: dir, staticDir: null, log: false, maxBatch: 3, maxBodyBytes: 4096 })
    const { url } = await small.listen(0, '127.0.0.1')
    const { key } = small.createStore('Limits')
    try {
      const post = (body: string, headers: Record<string, string> = {}) =>
        fetch(url + '/api/sync/push', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers }, body })
      const t = Date.now()
      const four = JSON.stringify({ changes: [1, 2, 3, 4].map((i) => change('audit', `a${i}`, t)) })
      expect((await post(four)).status).toBe(413)
      const big = JSON.stringify({ changes: [change('audit', 'big', t, { details: 'x'.repeat(10_000) })] })
      expect((await post(big)).status).toBe(413)
      // A gzip body that inflates past the limit is rejected too.
      const bomb = zlib.gzipSync(Buffer.from(JSON.stringify({ changes: [change('audit', 'z', t, { details: '0'.repeat(100_000) })] })))
      expect(bomb.length).toBeLessThan(4096)
      expect((await post(bomb as unknown as string, { 'Content-Encoding': 'gzip' })).status).toBe(413)
      // A small gzip body is accepted.
      const okGz = zlib.gzipSync(Buffer.from(JSON.stringify({ changes: [change('audit', 'gz', t)] })))
      const ok = await post(okGz as unknown as string, { 'Content-Encoding': 'gzip' })
      expect(ok.status).toBe(200)
      expect(await ok.json()).toMatchObject({ accepted: 1 })
    } finally {
      await small.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gzips large responses when the client accepts it', async () => {
    const { key } = await newStore()
    const t = Date.now()
    const changes = Array.from({ length: 50 }, (_, i) => change('audit', `g${i}`, t + i, { details: 'repeated text '.repeat(20) }))
    await call('POST', '/api/sync/push', { key, body: { changes } })
    const r = await call('GET', '/api/sync/pull?since=0', { key, headers: { 'Accept-Encoding': 'gzip' } })
    expect(r.headers.get('content-encoding')).toBe('gzip')
    expect(r.json.changes).toHaveLength(50)
  })

  it('answers CORS preflights for app origins', async () => {
    for (const origin of ['capacitor://localhost', 'https://localhost', 'app://kasa', 'http://192.168.1.20:5173']) {
      const r = await fetch(base + '/api/sync/push', {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true' },
      })
      expect(r.status).toBe(204)
      expect(r.headers.get('access-control-allow-origin')).toBe('*')
      expect(r.headers.get('access-control-allow-headers')).toMatch(/Authorization/)
      expect(r.headers.get('access-control-allow-methods')).toMatch(/POST/)
      expect(r.headers.get('access-control-allow-private-network')).toBe('true')
    }
    const get = await call('GET', '/api/health', { headers: { Origin: 'capacitor://localhost' } })
    expect(get.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns JSON errors for unknown routes and wrong methods', async () => {
    const missing = await call('GET', '/api/nope')
    expect(missing.status).toBe(404)
    expect(missing.json.error).toBeTruthy()
    const wrong = await call('DELETE', '/api/sync/push')
    expect(wrong.status).toBe(405)
    expect(wrong.headers.get('allow')).toMatch(/POST/)
  })

  it('serves the web app with correct types, caching and SPA fallback', async () => {
    const index = await fetch(base + '/')
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toMatch(/text\/html/)
    expect(index.headers.get('cache-control')).toBe('no-cache')

    const js = await fetch(base + '/assets/index-AbCd1234.js', { headers: { 'Accept-Encoding': 'gzip' } })
    expect(js.headers.get('content-type')).toMatch(/text\/javascript/)
    expect(js.headers.get('cache-control')).toMatch(/immutable/)
    expect(js.headers.get('content-encoding')).toBe('gzip')
    expect(await js.text()).toBe('console.log(1);'.repeat(200))

    const wasm = await fetch(base + '/assets/zxing_reader-Q1w2e3r4.wasm')
    expect(wasm.headers.get('content-type')).toBe('application/wasm')
    const manifest = await fetch(base + '/manifest.webmanifest')
    expect(manifest.headers.get('content-type')).toMatch(/application\/manifest\+json/)
    const sw = await fetch(base + '/sw.js')
    expect(sw.headers.get('cache-control')).toBe('no-cache')

    const etag = index.headers.get('etag')
    expect(etag).toBeTruthy()
    expect((await fetch(base + '/', { headers: { 'If-None-Match': etag! } })).status).toBe(304)

    const route = await fetch(base + '/sales/123')
    expect(route.status).toBe(200)
    expect(await route.text()).toContain('<title>Kasa</title>')
    expect((await fetch(base + '/missing.js')).status).toBe(404)
    expect((await fetch(base + '/.env')).status).toBe(404)
    // Files outside the web root are never served, however the path is spelled.
    const secretName = `kasa-secret-${Date.now()}.txt`
    const secret = path.join(path.dirname(staticDir), secretName)
    fs.writeFileSync(secret, 'TOP SECRET')
    try {
      for (const p of [`/../${secretName}`, `/%2e%2e/${secretName}`, `/assets/..%2f..%2f${secretName}`, `/..%5c${secretName}`]) {
        const r = await rawGet(p)
        expect(r.body).not.toContain('TOP SECRET')
        expect(r.status).toBe(404)
      }
      const spa = await rawGet('/%2e%2e/%2e%2e/etc/passwd')
      expect(spa.body).toContain('<title>Kasa</title>')
    } finally {
      fs.rmSync(secret, { force: true })
    }
    expect((await call('POST', '/')).status).toBe(405)
  })

  it('keeps data across restarts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-restart-'))
    try {
      const first = createServer({ dataDir: dir, staticDir: null, log: false })
      const { url } = await first.listen(0, '127.0.0.1')
      const { key } = first.createStore('Persistent')
      await fetch(url + '/api/sync/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: [change('users', 'u1', Date.now(), { name: 'Admin' })] }),
      })
      await first.close()

      const second = createServer({ dataDir: dir, staticDir: null, log: false })
      const again = await second.listen(0, '127.0.0.1')
      try {
        const r = await fetch(again.url + '/api/sync/pull?since=0', { headers: { Authorization: `Bearer ${key}` } })
        expect(r.status).toBe(200)
        const body = await r.json()
        expect(body.changes.map((c: { id: string }) => c.id)).toEqual(['u1'])
      } finally {
        await second.close()
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
