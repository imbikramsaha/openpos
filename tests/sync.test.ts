import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, type KasaServer } from '../server/src/server.js'
import { db as mainDb, PosDB } from '@/db/db'
import { rebuildStock } from '@/db/repo'
import { recomputeCustomer } from '@/db/customers'
import type { Customer, Product, StockMovementType, SyncedTable } from '@/core/types'
import type { Remote, WireChange } from '@/sync/api'
import { CURSOR_KEY, STORE_ID_KEY, getCursor, joinStoreInto, pullChanges, pushOutbox, syncOnce } from '@/sync/replicate'
import { rebuildStockLocal, recomputeCustomerLocal } from '@/sync/derived'

// Two (or more) terminals in one process: separate PosDB instances talking to a real
// in-process sync server.

let srv: KasaServer
let dataDir: string
let base: string

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kasa-sync-test-'))
  srv = createServer({ dataDir, staticDir: null, log: false })
  base = (await srv.listen(0, '127.0.0.1')).url
})

afterAll(async () => {
  await srv?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

let dbCounter = 0
const terminals: PosDB[] = []
function terminal(name: string): PosDB {
  const t = new PosDB(`${name}-${++dbCounter}`)
  terminals.push(t)
  return t
}
afterAll(async () => {
  for (const t of terminals) {
    t.close()
    await t.delete().catch(() => undefined)
  }
})

function newStore(name = 'Shop') {
  const store = srv.createStore(name)
  return {
    store,
    remote: (deviceId: string, extra: Partial<Remote> = {}): Remote => ({ url: base, key: store.key, deviceId, ...extra }),
  }
}

// ---- Local writes that mirror @/db/repo, but against a given database --------

let idCounter = 0
const newId = (p: string) => `${p}-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`

async function write(t: PosDB, table: SyncedTable, record: Record<string, unknown>) {
  const now = Date.now()
  const full: Record<string, unknown> & { id: string; updatedAt: number } = {
    createdAt: now,
    ...record,
    id: record.id as string,
    updatedAt: (record.updatedAt as number) ?? now,
  }
  await t.transaction('rw', [t.table(table), t.outbox], async () => {
    await t.table(table).put(full)
    await t.outbox.add({ table, id: full.id, updatedAt: full.updatedAt })
  })
  return full
}

/** Equivalent of moveStock(); must run inside a transaction with products, stockMovements and outbox. */
async function moveStockIn(t: PosDB, productId: string, qty: number, type: StockMovementType, refId?: string) {
  const product = await t.products.get(productId)
  if (!product || !product.trackStock) return
  const now = Date.now()
  const id = newId('m')
  await t.stockMovements.add({ id, createdAt: now, updatedAt: now, productId, qty, type, refId })
  await t.outbox.add({ table: 'stockMovements', id, updatedAt: now })
  await t.products.update(productId, { stock: Math.round(((product.stock ?? 0) + qty) * 1000) / 1000 })
}

async function createProduct(t: PosDB, name: string, stock: number, price = 1000): Promise<Product> {
  const now = Date.now()
  const p: Product = { id: newId('p'), createdAt: now, updatedAt: now, name, price, cost: 600, unit: 'pcs', trackStock: true, stock: 0, active: true }
  await t.transaction('rw', [t.products, t.stockMovements, t.outbox], async () => {
    await t.products.put(p)
    await t.outbox.add({ table: 'products', id: p.id, updatedAt: now })
    if (stock) await moveStockIn(t, p.id, stock, 'initial')
  })
  return p
}

async function createCustomer(t: PosDB, name: string): Promise<Customer> {
  return (await write(t, 'customers', { id: newId('c'), name, balance: 0, loyaltyPoints: 0 })) as unknown as Customer
}

async function sell(t: PosDB, productId: string, qty: number, opts: { customerId?: string; credit?: boolean; points?: number } = {}) {
  const now = Date.now()
  const total = qty * 1000
  const sale = {
    id: newId('s'),
    createdAt: now,
    updatedAt: now,
    number: `INV-${idCounter}`,
    type: 'sale',
    status: 'completed',
    userId: 'u1',
    userName: 'Admin',
    customerId: opts.customerId,
    deviceId: t.name,
    lines: [{ id: newId('l'), productId, name: 'Item', unit: 'pcs', qty, price: 1000, cost: 600, discount: 0, taxRate: 0, net: total, tax: 0, total }],
    pricesIncludeTax: true,
    subtotal: total,
    discountTotal: 0,
    netTotal: total,
    taxTotal: 0,
    rounding: 0,
    total,
    payments: [{ id: newId('pay'), method: opts.credit ? 'credit' : 'cash', amount: total }],
    paid: total,
    change: 0,
    taxBreakdown: [],
    loyaltyEarned: opts.points ?? 0,
    currency: 'INR',
  }
  await t.transaction('rw', [t.sales, t.products, t.stockMovements, t.outbox], async () => {
    await t.sales.add(sale as never)
    await t.outbox.add({ table: 'sales', id: sale.id, updatedAt: now })
    await moveStockIn(t, productId, -qty, 'sale', sale.id)
  })
  await recomputeCustomerLocal(t, opts.customerId)
  return sale
}

async function receivePayment(t: PosDB, customerId: string, amount: number) {
  await write(t, 'customerPayments', { id: newId('cp'), customerId, amount, method: 'cash', userId: 'u1' })
  await recomputeCustomerLocal(t, customerId)
}

/** Records a fetch wrapper's push bodies. */
function recordingFetch() {
  const pushes: { deviceId?: string; changes: WireChange[] }[] = []
  const f: typeof fetch = async (input, init) => {
    if (String(input).includes('/api/sync/push') && typeof init?.body === 'string') pushes.push(JSON.parse(init.body))
    return fetch(input, init)
  }
  return { fetch: f, pushes }
}

async function serverChanges(key: string): Promise<WireChange[]> {
  const out: WireChange[] = []
  let since = 0
  for (;;) {
    const r = await fetch(`${base}/api/sync/pull?since=${since}&limit=5000`, { headers: { Authorization: `Bearer ${key}` } })
    const body = await r.json()
    out.push(...body.changes)
    since = body.cursor
    if (!body.hasMore) return out
  }
}

// ---- Tests -------------------------------------------------------------------

describe('two-terminal sync', () => {
  it('a product with initial stock and a sale on A reach B with the right stock', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const b = terminal('term-b')
    const p = await createProduct(a, 'Masala Chai', 10)
    await sell(a, p.id, 3)
    expect((await a.products.get(p.id))!.stock).toBe(7)

    const pushed = await syncOnce(a, remote('A'))
    expect(pushed.pushed.sent).toBe(4) // product, 2 movements, sale
    expect(await a.outbox.count()).toBe(0)

    await syncOnce(b, remote('B'))
    const onB = await b.products.get(p.id)
    expect(onB?.name).toBe('Masala Chai')
    expect(onB?.stock).toBe(7)
    expect(await b.sales.count()).toBe(1)
    expect(await b.stockMovements.count()).toBe(2)
    // Pulled rows are never queued for upload.
    expect(await b.outbox.count()).toBe(0)
    expect(await getCursor(b)).toBeGreaterThan(0)
  })

  it('concurrent sales of the same product on A and B are both kept, stock correct everywhere', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const b = terminal('term-b')
    const p = await createProduct(a, 'Biscuits', 20)
    await syncOnce(a, remote('A'))
    await syncOnce(b, remote('B'))
    expect((await b.products.get(p.id))!.stock).toBe(20)

    // Both sell offline at the same time.
    await sell(a, p.id, 2)
    await sell(b, p.id, 5)
    await sell(b, p.id, 1)

    await syncOnce(a, remote('A'))
    await syncOnce(b, remote('B'))
    await syncOnce(a, remote('A'))

    for (const t of [a, b]) {
      expect(await t.sales.count()).toBe(3)
      expect((await t.products.get(p.id))!.stock).toBe(12)
      expect(await t.outbox.count()).toBe(0)
      // The cached value agrees with the ledger.
      await rebuildStockLocal(t)
      expect((await t.products.get(p.id))!.stock).toBe(12)
    }
  })

  it('a credit sale on B updates the customer balance on A, and payments flow back', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const b = terminal('term-b')
    const p = await createProduct(a, 'Rice 5kg', 50)
    const c = await createCustomer(a, 'Asha')
    await syncOnce(a, remote('A'))
    await syncOnce(b, remote('B'))
    expect((await b.customers.get(c.id))!.balance).toBe(0)

    await sell(b, p.id, 2, { customerId: c.id, credit: true, points: 20 })
    expect((await b.customers.get(c.id))!.balance).toBe(2000)
    await syncOnce(b, remote('B'))
    await syncOnce(a, remote('A'))
    expect(await a.customers.get(c.id)).toMatchObject({ balance: 2000, loyaltyPoints: 20 })

    await receivePayment(a, c.id, 1500)
    // An unrelated edit to the customer on A must not clobber B's derived balance.
    await write(a, 'customers', { ...(await a.customers.get(c.id))!, phone: '98765', updatedAt: Date.now() + 5 })
    await syncOnce(a, remote('A'))
    await syncOnce(b, remote('B'))
    expect(await b.customers.get(c.id)).toMatchObject({ balance: 500, loyaltyPoints: 20, phone: '98765' })
    expect(await a.customers.get(c.id)).toMatchObject({ balance: 500, loyaltyPoints: 20 })
  })

  it('never sends derived fields (stock, balance, loyaltyPoints)', async () => {
    const { store, remote } = newStore()
    const a = terminal('term-a')
    const p = await createProduct(a, 'Soap', 9)
    const c = await createCustomer(a, 'Ravi')
    await sell(a, p.id, 1, { customerId: c.id, credit: true, points: 3 })
    const rec = recordingFetch()
    await pushOutbox(a, remote('A', { fetch: rec.fetch }))

    const sent = rec.pushes.flatMap((b) => b.changes)
    expect(rec.pushes.every((b) => b.deviceId === 'A')).toBe(true)
    const product = sent.find((x) => x.table === 'products')!
    const customer = sent.find((x) => x.table === 'customers')!
    expect(product.data.name).toBe('Soap')
    expect(product.data).not.toHaveProperty('stock')
    expect(customer.data).not.toHaveProperty('balance')
    expect(customer.data).not.toHaveProperty('loyaltyPoints')
    // ...and the local copies still have them.
    expect((await a.products.get(p.id))!.stock).toBe(8)
    expect((await a.customers.get(c.id))!.balance).toBe(1000)

    const onServer = await serverChanges(store.key)
    expect(onServer.find((x) => x.table === 'products')!.data).not.toHaveProperty('stock')
  })

  it('de-duplicates the outbox and keeps entries queued while a push is in flight', async () => {
    const { store, remote } = newStore()
    const a = terminal('term-a')
    const p = await createProduct(a, 'Pen', 0)
    for (let i = 0; i < 3; i++) await write(a, 'products', { ...(await a.products.get(p.id))!, name: `Pen v${i}`, updatedAt: Date.now() + i })
    expect(await a.outbox.count()).toBe(4)

    let calls = 0
    const midPush: typeof fetch = async (input, init) => {
      if (String(input).includes('/api/sync/push') && ++calls === 1) {
        // Simulate a cashier editing the product while the request is on the wire.
        await write(a, 'products', { ...(await a.products.get(p.id))!, name: 'Pen (edited during push)', updatedAt: Date.now() + 100 })
        expect(await a.outbox.count()).toBe(5)
      }
      return fetch(input, init)
    }
    const res = await pushOutbox(a, remote('A', { fetch: midPush }))
    expect(calls).toBe(2) // the edit made during the first push went out in a second one
    expect(res.sent).toBe(2)
    expect(await a.outbox.count()).toBe(0)
    const onServer = await serverChanges(store.key)
    expect(onServer).toHaveLength(1)
    expect(onServer[0].data.name).toBe('Pen (edited during push)')
  })

  it('keeps pending entries when a push fails', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    await createProduct(a, 'Cup', 2)
    const failing: typeof fetch = async () => new Response('{"error":"boom"}', { status: 500 })
    await expect(pushOutbox(a, remote('A', { fetch: failing }))).rejects.toThrow(/server error/i)
    expect(await a.outbox.count()).toBe(2)
    await expect(pushOutbox(a, { ...remote('A'), key: 'wrong-key' })).rejects.toThrow(/invalid store key/i)
    expect(await a.outbox.count()).toBe(2)
    await pushOutbox(a, remote('A'))
    expect(await a.outbox.count()).toBe(0)
  })

  it('resolves concurrent edits with last-write-wins on every terminal', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const b = terminal('term-b')
    const p = await createProduct(a, 'Old name', 5)
    await syncOnce(a, remote('A'))
    await syncOnce(b, remote('B'))

    const t = Date.now()
    await write(a, 'products', { ...(await a.products.get(p.id))!, name: 'From A', price: 1100, updatedAt: t + 1000 })
    await write(b, 'products', { ...(await b.products.get(p.id))!, name: 'From B', price: 1200, updatedAt: t + 2000 })
    await syncOnce(b, remote('B')) // newer edit reaches the server first
    await syncOnce(a, remote('A')) // A's older edit is stale; A adopts B's
    await syncOnce(b, remote('B'))

    for (const x of [a, b]) {
      expect(await x.products.get(p.id)).toMatchObject({ name: 'From B', price: 1200, stock: 5 })
    }
  })

  it('handles stock movements that arrive before their product', async () => {
    const { store, remote } = newStore()
    const b = terminal('term-b')
    const t = Date.now()
    const push = (changes: WireChange[]) =>
      fetch(`${base}/api/sync/push`, { method: 'POST', headers: { Authorization: `Bearer ${store.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ changes }) })
    const mv = (id: string, productId: string, qty: number): WireChange => ({
      table: 'stockMovements',
      id,
      updatedAt: t,
      data: { id, productId, qty, type: 'purchase', createdAt: t, updatedAt: t },
    })
    const prod = (id: string): WireChange => ({
      table: 'products',
      id,
      updatedAt: t,
      data: { id, name: id, price: 100, cost: 50, unit: 'pcs', trackStock: true, active: true, createdAt: t, updatedAt: t },
    })
    // Same page: movements first, then the product.
    await push([mv('m1', 'px', 4), mv('m2', 'px', 6), prod('px')])
    await pullChanges(b, remote('B'))
    expect((await b.products.get('px'))!.stock).toBe(10)

    // Separate pulls: movement now, product later.
    await push([mv('m3', 'py', 7)])
    await pullChanges(b, remote('B'))
    expect(await b.products.get('py')).toBeUndefined()
    await push([prod('py'), mv('m4', 'py', -2)])
    await pullChanges(b, remote('B'))
    expect((await b.products.get('py'))!.stock).toBe(5)

    // A movement that is later soft-deleted is taken back out of stock.
    await push([{ ...mv('m4', 'py', -2), updatedAt: t + 10, deleted: true, data: { ...mv('m4', 'py', -2).data, deleted: true, updatedAt: t + 10 } }])
    await pullChanges(b, remote('B'))
    expect((await b.products.get('py'))!.stock).toBe(7)
  })

  it('does not let an older pulled version overwrite a newer local edit', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const b = terminal('term-b')
    const p = await createProduct(a, 'Server copy', 0)
    await syncOnce(a, remote('A'))
    // B already has a newer local version that it hasn't pushed yet.
    await b.products.put({ ...p, name: 'Newer on B', updatedAt: p.updatedAt + 60_000, stock: 0 })
    await pullChanges(b, remote('B'))
    expect((await b.products.get(p.id))!.name).toBe('Newer on B')
  })

  it('re-sends everything when the server lost data or the store changed', async () => {
    const first = newStore('First')
    const a = terminal('term-a')
    await createProduct(a, 'Tea', 3)
    await createCustomer(a, 'Meera')
    await syncOnce(a, first.remote('A'))
    expect(await a.outbox.count()).toBe(0)
    expect((await a.meta.get(STORE_ID_KEY))!.value).toBe(first.store.id)

    // Server restored from an older backup: our cursor is ahead of the server.
    await a.meta.put({ key: CURSOR_KEY, value: 10_000_000 })
    const res = await syncOnce(a, first.remote('A'))
    expect(res.pulled.reset).toBe(true)
    expect(await a.outbox.count()).toBe(3)
    await syncOnce(a, first.remote('A'))
    expect(await a.outbox.count()).toBe(0)

    // Pointed at a different (empty) store: its data is uploaded there.
    const second = newStore('Second')
    const moved = await syncOnce(a, second.remote('A'))
    expect(moved.pulled.reset).toBe(true)
    expect((await a.meta.get(STORE_ID_KEY))!.value).toBe(second.store.id)
    expect(await a.outbox.count()).toBe(3)
    await syncOnce(a, second.remote('A'))
    const onSecond = await serverChanges(second.store.key)
    expect(onSecond.map((x) => x.table).sort()).toEqual(['customers', 'products', 'stockMovements'])
    expect(await a.outbox.count()).toBe(0)
  })

  it('joins an existing store from scratch with correct stock and balances', async () => {
    const { remote } = newStore()
    const a = terminal('term-a')
    const p = await createProduct(a, 'Oil 1L', 30)
    const c = await createCustomer(a, 'Kabir')
    await sell(a, p.id, 4, { customerId: c.id, credit: true, points: 7 })
    await receivePayment(a, c.id, 1000)
    await syncOnce(a, remote('A'))

    const fresh = terminal('term-new')
    const res = await joinStoreInto(fresh, remote('NEW'))
    expect(res.applied).toBeGreaterThan(0)
    expect((await fresh.products.get(p.id))!.stock).toBe(26)
    expect(await fresh.customers.get(c.id)).toMatchObject({ balance: 3000, loyaltyPoints: 7 })
    expect(await fresh.outbox.count()).toBe(0)
    expect(await getCursor(fresh)).toBe(res.cursor)
    expect(res.cursor).toBeGreaterThan(0)

    // Nothing new to pull afterwards.
    const again = await pullChanges(fresh, remote('NEW'))
    expect(again.applied).toBe(0)
  })
})

describe('derived-value helpers', () => {
  it('match the canonical repo/customers implementations', async () => {
    const other = terminal('parity')
    for (const t of [mainDb, other]) {
      await t.transaction('rw', [t.products, t.stockMovements, t.customers, t.sales, t.customerPayments], async () => {
        const now = 1_700_000_000_000
        await t.products.bulkPut([
          { id: 'pp1', createdAt: now, updatedAt: now, name: 'A', price: 1, cost: 1, unit: 'pcs', trackStock: true, stock: 999, active: true },
          { id: 'pp2', createdAt: now, updatedAt: now, name: 'B', price: 1, cost: 1, unit: 'kg', trackStock: true, stock: -1, active: true },
        ])
        await t.stockMovements.bulkPut([
          { id: 'sm1', createdAt: now, updatedAt: now, productId: 'pp1', qty: 10, type: 'initial' },
          { id: 'sm2', createdAt: now, updatedAt: now, productId: 'pp1', qty: -2.5, type: 'sale' },
          { id: 'sm3', createdAt: now, updatedAt: now, productId: 'pp1', qty: -1, type: 'waste', deleted: true },
          { id: 'sm4', createdAt: now, updatedAt: now, productId: 'pp2', qty: 0.333, type: 'purchase' },
        ])
        await t.customers.put({ id: 'cc1', createdAt: now, updatedAt: now, name: 'C', balance: 0, loyaltyPoints: 0 })
        const sale = (id: string, credit: number, earned: number, extra: object = {}) => ({
          id, createdAt: now, updatedAt: now, customerId: 'cc1', status: 'completed', type: 'sale',
          payments: [{ id: `${id}-p`, method: 'credit', amount: credit }, { id: `${id}-q`, method: 'cash', amount: 100 }],
          loyaltyEarned: earned, loyaltyRedeemed: 1, ...extra,
        })
        await t.sales.bulkPut([sale('ss1', 500, 10), sale('ss2', 300, 5, { status: 'voided' }), sale('ss3', 200, 2, { deleted: true }), sale('ss4', -100, 0)] as never)
        await t.customerPayments.bulkPut([
          { id: 'cp1', createdAt: now, updatedAt: now, customerId: 'cc1', amount: 150, method: 'cash', userId: 'u' },
          { id: 'cp2', createdAt: now, updatedAt: now, customerId: 'cc1', amount: 999, method: 'cash', userId: 'u', deleted: true },
        ])
      })
    }
    await rebuildStock()
    await recomputeCustomer('cc1')
    await rebuildStockLocal(other)
    await recomputeCustomerLocal(other, 'cc1')

    const pick = async (t: PosDB) => ({
      products: (await t.products.bulkGet(['pp1', 'pp2'])).map((p) => p?.stock),
      customer: await t.customers.get('cc1').then((c) => ({ balance: c?.balance, loyaltyPoints: c?.loyaltyPoints })),
    })
    expect(await pick(other)).toEqual(await pick(mainDb))
    expect((await pick(other)).products).toEqual([7.5, 0.333])
  })
})
