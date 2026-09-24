import type { Category, Product, Purchase, PurchaseLine, StockMovementType, Supplier } from '@/core/types'
import { db } from '@/db/db'
import { audit, moveStock, nextNumber, put, round3, tx } from '@/db/repo'
import { toCsv } from '@/lib/csv'
import { fromMinor } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { device } from '@/stores/device'
import { session } from '@/stores/session'
import { MEASURED_UNITS } from '@/features/products/util'

// Stock ledger operations (adjustments, purchases, stock takes) and inventory exports.
// Every stock change is a movement written by repo.moveStock() inside a tx().

// ---- Adjustments ----------------------------------------------------------------

export type AdjustMode = 'add' | 'remove' | 'set'
export type AdjustReason = 'received' | 'damaged' | 'expired' | 'theft' | 'correction' | 'other'

export const REASONS: Record<AdjustMode, AdjustReason[]> = {
  add: ['received', 'correction', 'other'],
  remove: ['damaged', 'expired', 'theft', 'correction', 'other'],
  set: ['correction', 'other'],
}

/** Damaged/expired stock is recorded as waste so shrinkage reports can separate it. */
export function movementType(mode: AdjustMode, reason: AdjustReason): StockMovementType {
  if (mode === 'set') return 'count'
  if (reason === 'damaged' || reason === 'expired') return 'waste'
  return 'adjustment'
}

/** Applies an adjustment against the stock level at the moment of saving. Returns the movement quantity. */
export async function adjustStock(productId: string, mode: AdjustMode, qty: number, reason: AdjustReason, note: string): Promise<number> {
  const delta = await tx(['products', 'stockMovements'], async () => {
    const p = await db.products.get(productId)
    if (!p) throw new Error('Product not found')
    const d = round3(mode === 'add' ? qty : mode === 'remove' ? -qty : qty - (p.stock ?? 0))
    if (d) await moveStock(productId, d, movementType(mode, reason), undefined, note || undefined, p.cost)
    return d
  })
  if (delta) void audit('stock.adjust', 'product', productId, `${mode} ${reason} ${delta}`)
  return delta
}

// ---- Stock take -------------------------------------------------------------------

/** Writes one `count` movement per counted product so stock equals the counted quantity. */
export async function applyCounts(counts: Array<{ productId: string; counted: number }>, note: string): Promise<number> {
  let changed = 0
  await tx(['products', 'stockMovements'], async () => {
    for (const c of counts) {
      const p = await db.products.get(c.productId)
      if (!p || p.deleted || !p.trackStock) continue
      const delta = round3(c.counted - (p.stock ?? 0))
      if (!delta) continue
      await moveStock(p.id, delta, 'count', undefined, note, p.cost)
      changed++
    }
  })
  void audit('stock.count', 'product', undefined, `${counts.length} counted, ${changed} changed`)
  return changed
}

// ---- Purchases ----------------------------------------------------------------------

export interface PurchaseInput {
  supplierId?: string
  invoiceNo?: string
  note?: string
  lines: PurchaseLine[]
  paid: number
  updateCost: boolean
}

export const lineTotal = (l: Pick<PurchaseLine, 'qty' | 'cost'>) => Math.round(l.qty * l.cost)
export const purchaseTotal = (lines: PurchaseLine[]) => lines.reduce((a, l) => a + lineTotal(l), 0)

/** Records a goods-received purchase: the document, one `purchase` movement per line and (optionally) new cost prices. */
export async function savePurchase(input: PurchaseInput): Promise<Purchase> {
  const user = session().user
  if (!user) throw new Error('Not logged in')
  const lines = input.lines.filter((l) => l.qty > 0)
  if (!lines.length) throw new Error('No lines')
  const supplier = input.supplierId ? await db.suppliers.get(input.supplierId) : undefined
  const total = purchaseTotal(lines)
  const now = Date.now()
  const doc = await tx(['purchases', 'products', 'stockMovements'], async () => {
    const purchase: Purchase = {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      number: await nextNumber('purchase', device().terminal),
      supplierId: supplier?.id,
      supplierName: supplier?.name,
      invoiceNo: input.invoiceNo?.trim() || undefined,
      lines,
      total,
      paid: Math.max(0, Math.min(input.paid, total)),
      note: input.note?.trim() || undefined,
      userId: user.id,
    }
    await db.purchases.add(purchase)
    await db.outbox.add({ table: 'purchases', id: purchase.id, updatedAt: now })
    for (const l of lines) {
      await moveStock(l.productId, l.qty, 'purchase', purchase.id, purchase.note, l.cost)
      if (input.updateCost) {
        const p = await db.products.get(l.productId)
        if (p && p.cost !== l.cost) {
          await db.products.update(l.productId, { cost: l.cost, updatedAt: now })
          await db.outbox.add({ table: 'products', id: l.productId, updatedAt: now })
        }
      }
    }
    return purchase
  })
  void audit('purchase.create', 'purchase', doc.id, `${doc.number} ${doc.total}`)
  return doc
}

export async function saveSupplier(s: Partial<Supplier> & { name: string }): Promise<Supplier> {
  const current = s.id ? await db.suppliers.get(s.id) : undefined
  return put<Supplier>('suppliers', { ...current, ...s })
}

// ---- Reorder suggestions --------------------------------------------------------------

/** Units sold per product over the last `days` days (sales minus returns), from the stock ledger. */
export async function soldSince(days: number): Promise<Map<string, number>> {
  const since = Date.now() - days * 86_400_000
  const out = new Map<string, number>()
  await db.stockMovements
    .where('createdAt')
    .above(since)
    .each((m) => {
      if (m.deleted || (m.type !== 'sale' && m.type !== 'refund' && m.type !== 'void')) return
      out.set(m.productId, (out.get(m.productId) ?? 0) - m.qty)
    })
  return out
}

/**
 * Suggested order quantity: enough to reach twice the reorder level, or 30 days of
 * sales if that is more (at least one unit). Counted items are rounded up to whole units.
 */
export function suggestedQty(p: Product, sold30 = 0): number {
  const target = Math.max((p.reorderLevel ?? 0) * 2, sold30, 1)
  const need = Math.max(0, target - Math.max(p.stock, 0))
  return MEASURED_UNITS.includes(p.unit) ? round3(need) : Math.ceil(need)
}

// ---- Exports ------------------------------------------------------------------------

export function valuationCsv(products: Product[], cats: Map<string, Category>): string {
  const rows = products.map((p) => {
    const qty = Math.max(p.stock, 0)
    return {
      name: p.name,
      sku: p.sku ?? '',
      barcode: p.barcode ?? '',
      category: (p.categoryId && cats.get(p.categoryId)?.name) || '',
      unit: p.unit,
      stock: p.stock,
      cost: fromMinor(p.cost),
      value_at_cost: fromMinor(Math.round(qty * p.cost)),
      price: fromMinor(p.price),
      value_at_retail: fromMinor(Math.round(qty * p.price)),
    }
  })
  return toCsv(rows, ['name', 'sku', 'barcode', 'category', 'unit', 'stock', 'cost', 'value_at_cost', 'price', 'value_at_retail'])
}

export function lowStockCsv(products: Product[], cats: Map<string, Category>, sold: Map<string, number>): string {
  const rows = products.map((p) => ({
    name: p.name,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    category: (p.categoryId && cats.get(p.categoryId)?.name) || '',
    unit: p.unit,
    stock: p.stock,
    reorder_level: p.reorderLevel ?? '',
    sold_30_days: round3(sold.get(p.id) ?? 0),
    suggested_qty: suggestedQty(p, sold.get(p.id)),
    cost: fromMinor(p.cost),
  }))
  return toCsv(rows, ['name', 'sku', 'barcode', 'category', 'unit', 'stock', 'reorder_level', 'sold_30_days', 'suggested_qty', 'cost'])
}
