import { SYNCED_TABLES, type SyncedTable } from '@/core/types'
import type { OutboxEntry, PosDB } from '@/db/db'
import { round3 } from '@/db/repo'
import { pullPage, pushChanges, SyncError, type Remote, type WireChange } from './api'
import { rebuildStockIn, recomputeAllCustomersIn, recomputeCustomerIn, sumMovements } from './derived'

// Push/pull replication against one PosDB. Everything here takes the database and the
// remote explicitly so two terminals can be simulated in one process (see tests/sync.test.ts);
// the scheduler in ./engine.ts binds them to the app's database and device settings.

/** Meta key holding the last applied server seq. */
export const CURSOR_KEY = 'sync:cursor'
/** Meta key holding the id of the store this database replicates with. */
export const STORE_ID_KEY = 'sync:store'

export const PUSH_BATCH = 500
export const PULL_LIMIT = 1000
/** Keep each push request well under the server's 8 MB body limit (product images are data URLs). */
const MAX_PUSH_CHARS = 3_000_000
/** Safety valve against a runaway loop if the outbox refills as fast as it drains. */
const MAX_PUSH_ROUNDS = 400
const MAX_PULL_PAGES = 100_000

const SYNCED = new Set<string>(SYNCED_TABLES)

/** Per-terminal values derived from ledgers; never sent to the server. */
export const DERIVED_FIELDS: Partial<Record<SyncedTable, readonly string[]>> = {
  products: ['stock'],
  customers: ['balance', 'loyaltyPoints'],
}

type Row = Record<string, unknown> & { id: string; updatedAt?: number; deleted?: boolean }

const tableOf = (database: PosDB, name: string) => database.table<Row, string>(name)
const keyOf = (table: string, id: string) => `${table}\u0000${id}`

export function stripDerived(table: string, record: Row): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...record }
  for (const f of DERIVED_FIELDS[table as SyncedTable] ?? []) delete copy[f]
  return copy
}

async function getMetaValue<T>(database: PosDB, key: string, fallback: T): Promise<T> {
  const row = await database.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function getCursor(database: PosDB): Promise<number> {
  const v = await getMetaValue<unknown>(database, CURSOR_KEY, 0)
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

// ---- Push --------------------------------------------------------------------

export interface PushResult {
  /** Records sent (after de-duplicating outbox entries). */
  sent: number
  accepted: number
  stale: number
}

/**
 * Drains the outbox: sends the current version of every queued record in seq order,
 * then deletes exactly the outbox entries that were sent. Entries queued while a
 * request is in flight have higher seqs and stay for the next round.
 */
export async function pushOutbox(database: PosDB, remote: Remote): Promise<PushResult> {
  const result: PushResult = { sent: 0, accepted: 0, stale: 0 }

  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const entries = await database.outbox.orderBy('seq').limit(PUSH_BATCH).toArray()
    if (!entries.length) break

    // One change per record (the latest state is read from its table), in first-queued order.
    const groups = new Map<string, { table: string; id: string; seqs: number[]; updatedAt: number }>()
    const dropped: number[] = []
    for (const e of entries) {
      const seq = e.seq as number
      if (!SYNCED.has(e.table) || typeof e.id !== 'string' || !e.id) {
        dropped.push(seq)
        continue
      }
      const k = keyOf(e.table, e.id)
      const g = groups.get(k)
      if (g) {
        g.seqs.push(seq)
        g.updatedAt = Math.max(g.updatedAt, e.updatedAt ?? 0)
      } else {
        groups.set(k, { table: e.table, id: e.id, seqs: [seq], updatedAt: e.updatedAt ?? 0 })
      }
    }

    const idsByTable = new Map<string, string[]>()
    for (const g of groups.values()) {
      const ids = idsByTable.get(g.table)
      if (ids) ids.push(g.id)
      else idsByTable.set(g.table, [g.id])
    }
    const current = new Map<string, Row>()
    for (const [table, ids] of idsByTable) {
      const rows = await tableOf(database, table).bulkGet(ids)
      rows.forEach((r, i) => {
        if (r) current.set(keyOf(table, ids[i]), r)
      })
    }

    interface Chunk {
      changes: WireChange[]
      seqs: number[]
      chars: number
    }
    const chunks: Chunk[] = []
    let chunk: Chunk = { changes: [], seqs: [], chars: 0 }
    for (const [k, g] of groups) {
      const row = current.get(k)
      if (!row) {
        // Nothing to send (record no longer exists locally).
        dropped.push(...g.seqs)
        continue
      }
      const change: WireChange = {
        table: g.table,
        id: g.id,
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : g.updatedAt,
        data: stripDerived(g.table, row),
      }
      if (row.deleted) change.deleted = true
      const size = JSON.stringify(change).length
      if (chunk.changes.length && chunk.chars + size > MAX_PUSH_CHARS) {
        chunks.push(chunk)
        chunk = { changes: [], seqs: [], chars: 0 }
      }
      chunk.changes.push(change)
      chunk.seqs.push(...g.seqs)
      chunk.chars += size
    }
    if (chunk.changes.length) chunks.push(chunk)
    if (dropped.length) await database.outbox.bulkDelete(dropped)

    for (const c of chunks) {
      const res = await pushChanges(remote, c.changes)
      result.sent += c.changes.length
      result.accepted += Number(res.accepted) || 0
      result.stale += Number(res.stale) || 0
      await database.outbox.bulkDelete(c.seqs)
    }
  }
  return result
}

// ---- Pull --------------------------------------------------------------------

export interface PullResult {
  /** Records written locally. */
  applied: number
  pages: number
  cursor: number
  /** True when the server looked reset or different and everything was re-queued. */
  reset: boolean
}

export interface PullOptions {
  /** Start from this seq instead of the stored cursor. */
  since?: number
  /** Adopt the server's store id without treating a change as a reset (used when joining). */
  adopt?: boolean
  /** Recompute affected customers after each page (default true). */
  recompute?: boolean
}

/**
 * Re-queues every local record for upload. Used when the server no longer has what this
 * terminal already sent (restored from an older backup, or a different store/server), so
 * the server ends up with everything this terminal has.
 */
export async function requeueAll(database: PosDB): Promise<number> {
  let total = 0
  for (const table of SYNCED_TABLES) {
    const entries: OutboxEntry[] = []
    await tableOf(database, table).each((r) => {
      entries.push({ table, id: r.id, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 })
    })
    for (let i = 0; i < entries.length; i += 2000) await database.outbox.bulkAdd(entries.slice(i, i + 2000))
    total += entries.length
  }
  return total
}

async function resetReplication(database: PosDB, storeId: string | undefined): Promise<void> {
  await requeueAll(database)
  await database.transaction('rw', database.meta, async () => {
    await database.meta.put({ key: CURSOR_KEY, value: 0 })
    if (storeId) await database.meta.put({ key: STORE_ID_KEY, value: storeId })
  })
}

function materialize(c: WireChange): Row {
  const row: Row = { ...(c.data ?? {}), id: c.id, updatedAt: c.updatedAt }
  if (c.deleted) row.deleted = true
  return row
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/**
 * Applies one page of pulled changes and advances the cursor, atomically.
 * Last-write-wins: a record is replaced when it is new here or the incoming updatedAt is
 * the same or newer. Derived fields are kept local: product stock follows the movement
 * ledger and customer balances are recomputed afterwards. Nothing is added to the outbox.
 * Returns the customers whose balance/points need recomputing.
 */
export async function applyPage(
  database: PosDB,
  changes: WireChange[],
  cursor: number,
  storeId?: string,
): Promise<{ applied: number; customers: Set<string> }> {
  const tables = [...SYNCED_TABLES, 'meta']
  return database.transaction('rw', tables, async () => {
    const byTable = new Map<string, WireChange[]>()
    for (const c of changes) {
      if (!c || !SYNCED.has(c.table) || typeof c.id !== 'string' || !c.id || typeof c.updatedAt !== 'number') continue
      const list = byTable.get(c.table)
      if (list) list.push(c)
      else byTable.set(c.table, [c])
    }

    const customers = new Set<string>()
    const stockDelta = new Map<string, number>()
    const addDelta = (productId: unknown, qty: unknown) => {
      const pid = str(productId)
      const q = num(qty)
      if (pid && q) stockDelta.set(pid, (stockDelta.get(pid) ?? 0) + q)
    }
    let applied = 0

    // Products go last so their stock can account for movements in the same page.
    for (const [table, list] of byTable) {
      if (table === 'products') continue
      const t = tableOf(database, table)
      const locals = await t.bulkGet(list.map((c) => c.id))
      const puts: Row[] = []
      list.forEach((c, i) => {
        const local = locals[i]
        if (local && c.updatedAt < num(local.updatedAt)) return
        const incoming = materialize(c)
        switch (table) {
          case 'customers':
            incoming.balance = local ? num(local.balance) : 0
            incoming.loyaltyPoints = local ? num(local.loyaltyPoints) : 0
            if (!local) customers.add(c.id)
            break
          case 'stockMovements':
            // New movement: +qty. Changed movement (e.g. soft-deleted): swap old for new contribution.
            if (local && !local.deleted) addDelta(local.productId, -num(local.qty))
            if (!incoming.deleted) addDelta(incoming.productId, incoming.qty)
            break
          case 'sales':
          case 'customerPayments': {
            const now = str(incoming.customerId)
            const before = str(local?.customerId)
            if (now) customers.add(now)
            if (before && before !== now) customers.add(before)
            break
          }
        }
        puts.push(incoming)
      })
      if (puts.length) {
        await t.bulkPut(puts)
        applied += puts.length
      }
    }

    const productChanges = byTable.get('products')
    if (productChanges) {
      const products = tableOf(database, 'products')
      const locals = await products.bulkGet(productChanges.map((c) => c.id))
      const puts: Row[] = []
      for (let i = 0; i < productChanges.length; i++) {
        const c = productChanges[i]
        const local = locals[i]
        if (local && c.updatedAt < num(local.updatedAt)) continue // stock delta still applied below
        const incoming = materialize(c)
        // Existing product: keep its cached stock (+ this page's movements).
        // New product: its movements may have arrived earlier, so sum the ledger (already includes this page).
        incoming.stock = local ? round3(num(local.stock) + (stockDelta.get(c.id) ?? 0)) : await sumMovements(database, c.id)
        stockDelta.delete(c.id)
        puts.push(incoming)
      }
      if (puts.length) {
        await products.bulkPut(puts)
        applied += puts.length
      }
    }

    for (const [productId, delta] of stockDelta) {
      if (!delta) continue
      const p = await database.products.get(productId)
      if (p) await database.products.update(productId, { stock: round3(num(p.stock) + delta) })
    }

    await database.meta.put({ key: CURSOR_KEY, value: cursor })
    if (storeId) await database.meta.put({ key: STORE_ID_KEY, value: storeId })
    return { applied, customers }
  })
}

/** Pulls and applies pages until the server has nothing newer. */
export async function pullChanges(database: PosDB, remote: Remote, options: PullOptions = {}): Promise<PullResult> {
  let cursor = options.since ?? (await getCursor(database))
  let knownStore = options.adopt ? undefined : await getMetaValue<string | undefined>(database, STORE_ID_KEY, undefined)
  const result: PullResult = { applied: 0, pages: 0, cursor, reset: false }

  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const res = await pullPage(remote, cursor, PULL_LIMIT)
    const storeId = typeof res.storeId === 'string' ? res.storeId : undefined

    if (!options.adopt && !result.reset) {
      const otherStore = !!(knownStore && storeId && storeId !== knownStore)
      const serverBehind = typeof res.latestSeq === 'number' && cursor > res.latestSeq
      if (otherStore || serverBehind) {
        // The server doesn't have what we already synced: start over and re-send everything.
        await resetReplication(database, storeId)
        result.reset = true
        knownStore = storeId
        cursor = 0
        continue
      }
    }

    const { applied, customers } = await applyPage(database, res.changes, res.cursor, storeId)
    knownStore = storeId ?? knownStore
    result.applied += applied
    result.pages++
    if (options.recompute !== false) for (const id of customers) await recomputeCustomerIn(database, id)

    if (!res.hasMore) {
      cursor = res.cursor
      break
    }
    if (res.cursor <= cursor) throw new SyncError('protocol', 'The sync server returned an invalid cursor.')
    cursor = res.cursor
  }
  result.cursor = cursor
  return result
}

// ---- Cycles ------------------------------------------------------------------

/** One sync cycle: push local changes, then pull everything newer. */
export async function syncOnce(database: PosDB, remote: Remote): Promise<{ pushed: PushResult; pulled: PullResult }> {
  const pushed = await pushOutbox(database, remote)
  const pulled = await pullChanges(database, remote)
  return { pushed, pulled }
}

/**
 * Downloads a store into this database (a new till joining an existing store):
 * full pull from seq 0, then rebuild stock and customer balances from the ledgers.
 */
export async function joinStoreInto(database: PosDB, remote: Remote): Promise<PullResult> {
  const pulled = await pullChanges(database, remote, { since: 0, adopt: true, recompute: false })
  await rebuildStockIn(database)
  await recomputeAllCustomersIn(database)
  await database.meta.put({ key: CURSOR_KEY, value: pulled.cursor })
  return pulled
}
