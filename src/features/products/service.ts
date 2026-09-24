import type { Category, Product } from '@/core/types'
import { generateEan13 } from '@/core/barcode'
import { db } from '@/db/db'
import { audit, moveStock, put, putMany, remove, tx } from '@/db/repo'

// Write operations for products and categories. Everything goes through the repo
// layer (or a repo `tx()` with explicit outbox entries) so changes sync.

export type ProductFields = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'stock' | 'deleted'>

/**
 * Creates or updates a product. The cached `stock` is never taken from the form:
 * existing products keep the value currently in the database, new products start
 * at 0 and receive an `initial` stock movement.
 */
export async function saveProduct(fields: ProductFields, existingId?: string, initialStock?: number): Promise<Product> {
  if (existingId) {
    return tx(['products'], async () => {
      const current = await db.products.get(existingId)
      return put<Product>('products', { ...current, ...fields, id: existingId, createdAt: current?.createdAt, stock: current?.stock ?? 0 })
    })
  }
  return tx(['products', 'stockMovements'], async () => {
    const p = await put<Product>('products', { ...fields, stock: 0 })
    if (p.trackStock && initialStock) await moveStock(p.id, initialStock, 'initial', undefined, undefined, p.cost)
    return p
  })
}

/** Same semantics as repo `patch()` for many products: one transaction, stamped and queued for sync. */
export async function patchProducts(ids: string[], changes: Partial<Omit<Product, 'id' | 'stock'>>): Promise<void> {
  if (!ids.length) return
  const now = Date.now()
  await tx(['products'], async () => {
    await db.products.bulkUpdate(ids.map((key) => ({ key, changes: { ...changes, updatedAt: now } })))
    await db.outbox.bulkAdd(ids.map((id) => ({ table: 'products', id, updatedAt: now })))
  })
}

export async function deleteProducts(ids: string[]): Promise<void> {
  if (ids.length === 1) await remove('products', ids[0])
  else await patchProducts(ids, { deleted: true })
  void audit('product.delete', 'product', ids.length === 1 ? ids[0] : undefined, ids.length === 1 ? undefined : `${ids.length} products`)
}

/** A random in-store EAN-13 that no product uses yet. */
export async function uniqueEan13(taken?: Set<string>): Promise<string> {
  for (;;) {
    const code = generateEan13()
    if (taken?.has(code)) continue
    if (!(await db.products.where('barcode').equals(code).count())) {
      taken?.add(code)
      return code
    }
  }
}

/** Gives every product in `ids` that lacks a barcode a fresh EAN-13. Returns how many were assigned. */
export async function assignMissingBarcodes(ids: string[]): Promise<number> {
  const targets = (await db.products.bulkGet(ids)).filter((p): p is Product => !!p && !p.deleted && !p.barcode)
  if (!targets.length) return 0
  const taken = new Set<string>()
  const now = Date.now()
  await tx(['products'], async () => {
    for (const p of targets) {
      await db.products.update(p.id, { barcode: await uniqueEan13(taken), updatedAt: now })
      await db.outbox.add({ table: 'products', id: p.id, updatedAt: now })
    }
  })
  void audit('product.barcodes', 'product', undefined, `${targets.length} generated`)
  return targets.length
}

// ---- Categories ---------------------------------------------------------------

export async function saveCategory(input: { id?: string; name: string; color: string }): Promise<Category> {
  if (input.id) {
    const current = await db.categories.get(input.id)
    if (current) return put<Category>('categories', { ...current, name: input.name, color: input.color })
  }
  const last = await db.categories.orderBy('sortOrder').last()
  return put<Category>('categories', { name: input.name, color: input.color, sortOrder: (last?.sortOrder ?? -1) + 1 })
}

/** Moves a category one place up or down and renumbers `sortOrder` densely. */
export async function moveCategory(list: Category[], index: number, dir: -1 | 1): Promise<void> {
  const j = index + dir
  if (j < 0 || j >= list.length) return
  const next = list.slice()
  ;[next[index], next[j]] = [next[j], next[index]]
  const changed = next.flatMap((c, i) => (c.sortOrder === i ? [] : [{ ...c, sortOrder: i }]))
  await putMany('categories', changed)
}

/** Soft-deletes a category and unassigns its products. Returns the number of products affected. */
export async function deleteCategory(id: string): Promise<number> {
  const ids = (await db.products.where('categoryId').equals(id).toArray()).filter((p) => !p.deleted).map((p) => p.id)
  await tx(['products', 'categories'], async () => {
    await patchProducts(ids, { categoryId: undefined })
    await remove('categories', id)
  })
  void audit('category.delete', 'category', id, `${ids.length} products unassigned`)
  return ids.length
}
