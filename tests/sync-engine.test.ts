import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createServer, type KasaServer } from '../server/src/server.js'
import { db, PosDB } from '@/db/db'
import { put } from '@/db/repo'
import { useDevice } from '@/stores/device'
import { useSyncStatus } from '@/sync/status'
import { joinStore, startSync, stopSync, syncNow, testConnection } from '@/sync/engine'
import { normalizeUrl } from '@/sync/api'
import { syncOnce } from '@/sync/replicate'
import type { Category, Product } from '@/core/types'

// The public engine API, bound to the app's singleton database and device settings.

let srv: KasaServer
let dataDir: string
let base: string
let store: { id: string; name: string; key: string }

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-engine-test-'))
  srv = createServer({ dataDir, staticDir: null, log: false })
  base = (await srv.listen(0, '127.0.0.1')).url
  store = srv.createStore('Engine Shop')
})

afterEach(() => {
  stopSync()
  useDevice.getState().update({ syncEnabled: false, serverUrl: '', storeKey: '' })
})

afterAll(async () => {
  stopSync()
  await srv?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 6000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function onServer(key: string, table: string, id: string) {
  const r = await fetch(`${base}/api/sync/pull?since=0&limit=5000`, { headers: { Authorization: `Bearer ${key}` } })
  const body = await r.json()
  return body.changes.find((c: { table: string; id: string }) => c.table === table && c.id === id)
}

describe('normalizeUrl', () => {
  it('cleans up typed addresses', () => {
    expect(normalizeUrl('192.168.1.10:8787')).toBe('http://192.168.1.10:8787')
    expect(normalizeUrl(' http://pos.local:8787/ ')).toBe('http://pos.local:8787')
    expect(normalizeUrl('https://pos.example.com///')).toBe('https://pos.example.com')
    expect(normalizeUrl('https://pos.example.com/api/')).toBe('https://pos.example.com')
    expect(normalizeUrl('https://example.com/kasa/')).toBe('https://example.com/kasa')
    expect(normalizeUrl('localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeUrl('')).toBe('')
  })
})

describe('testConnection', () => {
  it('returns the store name for a valid key', async () => {
    expect(await testConnection(base + '/', store.key)).toEqual({ ok: true, storeName: 'Engine Shop' })
    expect(await testConnection(base.replace('http://', ''), ` ${store.key} `)).toEqual({ ok: true, storeName: 'Engine Shop' })
  })

  it('gives friendly errors', async () => {
    const badKey = await testConnection(base, 'nope')
    expect(badKey.ok).toBe(false)
    expect(badKey.error).toMatch(/invalid store key/i)

    expect((await testConnection('', store.key)).error).toMatch(/server address/i)
    expect((await testConnection(base, '')).error).toMatch(/store key/i)

    // Nothing listening on this port.
    const closed = http.createServer()
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()))
    const port = (closed.address() as { port: number }).port
    await new Promise<void>((r) => closed.close(() => r()))
    const unreachable = await testConnection(`127.0.0.1:${port}`, store.key)
    expect(unreachable.ok).toBe(false)
    expect(unreachable.error).toMatch(/can't reach/i)

    // Some other web server.
    const other = http.createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html')
      res.end('<html>router admin</html>')
    })
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()))
    try {
      const notKasa = await testConnection(`http://127.0.0.1:${(other.address() as { port: number }).port}`, store.key)
      expect(notKasa.ok).toBe(false)
      expect(notKasa.error).toMatch(/not a Kasa sync server/i)
    } finally {
      await new Promise<void>((r) => other.close(() => r()))
    }
  })
})

describe('engine', () => {
  it('joinStore downloads an existing store into the app database', async () => {
    // Another till has already been selling.
    const a = new PosDB('engine-term-a')
    const now = Date.now()
    await a.transaction('rw', [a.products, a.stockMovements, a.outbox, a.users], async () => {
      await a.users.put({ id: 'u-admin', createdAt: now, updatedAt: now, name: 'Admin', role: 'admin', pinHash: 'x', pinSalt: 'y', active: true })
      await a.products.put({ id: 'jp1', createdAt: now, updatedAt: now, name: 'Joined product', price: 500, cost: 300, unit: 'pcs', trackStock: true, stock: 12, active: true })
      await a.stockMovements.bulkPut([
        { id: 'jm1', createdAt: now, updatedAt: now, productId: 'jp1', qty: 15, type: 'initial' },
        { id: 'jm2', createdAt: now, updatedAt: now, productId: 'jp1', qty: -3, type: 'sale' },
      ])
      await a.outbox.bulkAdd([
        { table: 'users', id: 'u-admin', updatedAt: now },
        { table: 'products', id: 'jp1', updatedAt: now },
        { table: 'stockMovements', id: 'jm1', updatedAt: now },
        { table: 'stockMovements', id: 'jm2', updatedAt: now },
      ])
    })
    await syncOnce(a, { url: base, key: store.key, deviceId: 'A' })

    await joinStore(base + '/', store.key)
    expect(await db.users.count()).toBe(1)
    expect((await db.products.get('jp1'))!.stock).toBe(12)
    expect(await db.outbox.count()).toBe(0)
    // Sync isn't enabled on this device, so no background loop was started.
    expect(useSyncStatus.getState().state).toBe('disabled')

    await expect(joinStore(base, 'bad-key')).rejects.toThrow(/invalid store key/i)
    a.close()
  })

  it('runs in the background: first cycle on start, debounced push after local writes, stop/restart', async () => {
    useDevice.getState().update({ serverUrl: base, storeKey: store.key, syncEnabled: true })
    await startSync()
    expect(useSyncStatus.getState().state).toBe('idle')
    expect(useSyncStatus.getState().lastSync).toBeGreaterThan(0)

    const cat = await put<Category>('categories', { name: 'Snacks', color: '#f00', sortOrder: 1 })
    // Well before the 20 s interval: the debounced write trigger pushed it.
    await waitFor(async () => (await db.outbox.count()) === 0 && !!(await onServer(store.key, 'categories', cat.id)))
    expect(useSyncStatus.getState().pending).toBe(0)

    // Changes from another till arrive on syncNow().
    const b = new PosDB('engine-term-b')
    const now = Date.now()
    await b.products.put({ id: 'bp1', createdAt: now, updatedAt: now, name: 'From B', price: 1, cost: 1, unit: 'pcs', trackStock: false, stock: 0, active: true } as Product)
    await b.outbox.add({ table: 'products', id: 'bp1', updatedAt: now })
    await syncOnce(b, { url: base, key: store.key, deviceId: 'B' })
    await syncNow()
    expect((await db.products.get('bp1'))?.name).toBe('From B')

    // Restarting is clean and keeps working.
    await startSync()
    await startSync()
    expect(useSyncStatus.getState().state).toBe('idle')

    stopSync()
    expect(useSyncStatus.getState().state).toBe('disabled')
    const after = await put<Category>('categories', { name: 'Offline only', color: '#0f0', sortOrder: 2 })
    await new Promise((r) => setTimeout(r, 2000))
    expect(await onServer(store.key, 'categories', after.id)).toBeUndefined()
    expect(await db.outbox.count()).toBe(1)

    // syncNow() with sync disabled does nothing; enabling it again uploads the backlog.
    useDevice.getState().update({ syncEnabled: false })
    await syncNow()
    expect(await db.outbox.count()).toBe(1)
    useDevice.getState().update({ syncEnabled: true })
    await syncNow()
    expect(await db.outbox.count()).toBe(0)
    expect(await onServer(store.key, 'categories', after.id)).toBeTruthy()
    b.close()
  }, 20_000)

  it('reports errors (e.g. a wrong key) without throwing', async () => {
    useDevice.getState().update({ serverUrl: base, storeKey: 'wrong-key', syncEnabled: true })
    await startSync()
    const s = useSyncStatus.getState()
    expect(s.state).toBe('error')
    expect(s.error).toMatch(/invalid store key/i)

    useDevice.getState().update({ syncEnabled: false })
    await startSync()
    expect(useSyncStatus.getState().state).toBe('disabled')
  })
})

describe('outbox while sync is off', () => {
  it('drops the queue while disabled and re-sends everything when enabled', async () => {
    const fresh = srv.createStore('Offline-first Shop')
    useDevice.getState().update({ syncEnabled: false, serverUrl: '', storeKey: '' })
    const cat = await put<Category>('categories', { name: 'Queued while offline', color: '#123456', sortOrder: 9 })
    expect(await db.outbox.count()).toBeGreaterThan(0)

    await startSync()
    await waitFor(async () => (await db.outbox.count()) === 0)
    expect(await db.meta.get('sync:fullPush')).toBeTruthy()

    useDevice.getState().update({ syncEnabled: true, serverUrl: base, storeKey: fresh.key })
    await startSync()
    await waitFor(async () => !!(await onServer(fresh.key, 'categories', cat.id)), 10000)
    expect(await db.meta.get('sync:fullPush')).toBeFalsy()
  })
})
