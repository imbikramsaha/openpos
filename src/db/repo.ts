import Dexie, { type Table } from 'dexie'
import { db, type PosDB } from './db'
import { uuid } from '@/lib/uuid'
import type { AuditEntry, Base, Product, StockMovement, StockMovementType, SyncedTable } from '@/core/types'

// Single write path for synced data. Every put/remove stamps `updatedAt` (used for
// last-write-wins conflict resolution) and records the change in the outbox so the
// sync engine can push it when the terminal is online.

type AnyTable = Table<any, string>

const table = (name: SyncedTable) => (db as unknown as Record<string, AnyTable>)[name]

let actor: { id: string; name: string } | null = null
export const setActor = (u: { id: string; name: string } | null) => {
  actor = u
}
export const currentActor = () => actor

/** Runs `fn` in a read-write transaction that always includes the outbox and audit tables. */
export function tx<T>(tables: SyncedTable[], fn: () => Promise<T>): Promise<T> {
  const names = Array.from(new Set([...tables, 'audit', 'outbox', 'meta', 'products', 'stockMovements']))
  return db.transaction('rw', names.map((n) => (db as unknown as Record<string, AnyTable>)[n]), fn)
}

export async function put<T extends Base>(name: SyncedTable, record: Omit<T, 'createdAt' | 'updatedAt' | 'id'> & Partial<Base>): Promise<T> {
  const now = Date.now()
  const full = { ...record, id: record.id ?? uuid(), createdAt: record.createdAt ?? now, updatedAt: now } as T
  await tx([name], async () => {
    await table(name).put(full)
    await db.outbox.add({ table: name, id: full.id, updatedAt: now })
  })
  return full
}

export async function putMany<T extends Base>(name: SyncedTable, records: T[]): Promise<void> {
  const now = Date.now()
  await tx([name], async () => {
    for (const r of records) {
      const full = { ...r, createdAt: r.createdAt ?? now, updatedAt: now }
      await table(name).put(full)
      await db.outbox.add({ table: name, id: full.id, updatedAt: now })
    }
  })
}

export async function patch<T extends Base>(name: SyncedTable, id: string, changes: Partial<T>): Promise<void> {
  const now = Date.now()
  await tx([name], async () => {
    await table(name).update(id, { ...changes, updatedAt: now })
    await db.outbox.add({ table: name, id, updatedAt: now })
  })
}

/** Soft delete so the deletion replicates. */
export async function remove(name: SyncedTable, id: string): Promise<void> {
  await patch(name, id, { deleted: true } as Partial<Base>)
}

export async function audit(action: string, entity?: string, entityId?: string, details?: string): Promise<void> {
  const now = Date.now()
  const entry: AuditEntry = {
    id: uuid(),
    createdAt: now,
    updatedAt: now,
    userId: actor?.id,
    userName: actor?.name,
    action,
    entity,
    entityId,
    details,
  }
  await db.transaction('rw', db.audit, db.outbox, async () => {
    await db.audit.add(entry)
    await db.outbox.add({ table: 'audit', id: entry.id, updatedAt: now })
  })
}

/**
 * Appends a stock movement and updates the product's cached stock level.
 * Must run inside a transaction that includes products + stockMovements (tx() does).
 */
export async function moveStock(productId: string, qty: number, type: StockMovementType, refId?: string, note?: string, cost?: number): Promise<void> {
  if (!qty) return
  const product = await db.products.get(productId)
  if (!product || !product.trackStock) return
  const now = Date.now()
  const m: StockMovement = { id: uuid(), createdAt: now, updatedAt: now, productId, qty, type, refId, note, userId: actor?.id, cost }
  await db.stockMovements.add(m)
  await db.outbox.add({ table: 'stockMovements', id: m.id, updatedAt: now })
  // Stock is a derived, local-only value, so this update does not go to the outbox.
  await db.products.update(productId, { stock: round3((product.stock ?? 0) + qty) })
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Recomputes cached stock for every product from the movement ledger. */
export async function rebuildStock(database: PosDB = db): Promise<void> {
  const totals = new Map<string, number>()
  await database.stockMovements.each((m) => {
    if (!m.deleted) totals.set(m.productId, (totals.get(m.productId) ?? 0) + m.qty)
  })
  await database.transaction('rw', database.products, async () => {
    await database.products.toCollection().modify((p: Product) => {
      p.stock = round3(totals.get(p.id) ?? 0)
    })
  })
}

// ---- Device-local metadata -------------------------------------------------

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key)
  return row ? (row.value as T) : fallback
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

export type NumberKind = 'sale' | 'refund' | 'purchase' | 'shift'

const PREFIX: Record<NumberKind, string> = { sale: 'INV', refund: 'CRN', purchase: 'PUR', shift: 'SH' }

/**
 * Document numbers are unique per terminal so terminals can number offline without
 * clashing, e.g. INV-T1-000042. Must run inside a transaction that includes `meta`.
 */
export async function nextNumber(kind: NumberKind, terminal: string): Promise<string> {
  const key = `seq:${kind}`
  const prefix = `${PREFIX[kind]}-${terminal}-`
  // Never go below the highest number already used by this terminal: after a backup
  // restore (older counter) followed by a sync pull, the counter alone could repeat one.
  const highest = await highestNumber(kind, prefix)
  const n = Math.max(await getMeta<number>(key, 0), highest) + 1
  await setMeta(key, n)
  return `${prefix}${String(n).padStart(6, '0')}`
}

async function highestNumber(kind: NumberKind, prefix: string): Promise<number> {
  const table = kind === 'sale' || kind === 'refund' ? db.sales : kind === 'purchase' ? db.purchases : null
  if (!table || !Dexie.currentTransaction?.storeNames.includes(table.name)) return 0
  // Numbers are zero-padded, so the last one in index order is the highest.
  const last = await table.where('number').startsWith(prefix).last()
  const n = last ? Number(last.number.slice(prefix.length)) : 0
  return Number.isFinite(n) ? n : 0
}
