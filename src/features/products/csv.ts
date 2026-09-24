import type { Category, Product, Tax, Unit } from '@/core/types'
import { db } from '@/db/db'
import { moveStock, round3, tx } from '@/db/repo'
import { parseCsv, toCsv } from '@/lib/csv'
import { fromMinor, parseDecimal, toMinor } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { MEASURED_UNITS, SERVICE_UNITS, SWATCHES, UNITS } from './util'

// Product CSV import/export. Amounts in files are major units ("12.50"); the database
// stores minor units. Import is two-step: planImport() validates every row without
// writing anything (for the preview), applyImport() writes the valid rows in one transaction.

export const CSV_COLUMNS = ['name', 'sku', 'barcode', 'category', 'price', 'cost', 'tax_rate', 'unit', 'stock', 'reorder_level', 'hsn', 'mrp', 'active'] as const
type Col = (typeof CSV_COLUMNS)[number]

// Common header spellings from spreadsheets and other POS exports.
const ALIASES: Record<string, Col> = {
  product: 'name', product_name: 'name', item: 'name', item_name: 'name', title: 'name',
  code: 'sku', item_code: 'sku', product_code: 'sku', article: 'sku',
  ean: 'barcode', ean13: 'barcode', upc: 'barcode', gtin: 'barcode', bar_code: 'barcode',
  category_name: 'category', group: 'category', department: 'category',
  selling_price: 'price', sale_price: 'price', sell_price: 'price', unit_price: 'price', retail_price: 'price',
  cost_price: 'cost', purchase_price: 'cost', buying_price: 'cost',
  tax: 'tax_rate', tax_percent: 'tax_rate', 'tax_%': 'tax_rate', gst: 'tax_rate', gst_rate: 'tax_rate', vat: 'tax_rate', vat_rate: 'tax_rate',
  uom: 'unit', units: 'unit',
  qty: 'stock', quantity: 'stock', stock_qty: 'stock', on_hand: 'stock', in_stock: 'stock',
  reorder: 'reorder_level', reorder_point: 'reorder_level', min_stock: 'reorder_level', minimum_stock: 'reorder_level',
  hsn_code: 'hsn', hsn_sac: 'hsn', 'hsn/sac': 'hsn', sac: 'hsn',
  status: 'active', enabled: 'active',
}

const UNIT_ALIASES: Record<string, Unit> = {
  pc: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', unit: 'pcs', each: 'pcs', ea: 'pcs',
  kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  ltr: 'l', lt: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  mtr: 'm', meter: 'm', metre: 'm', meters: 'm', metres: 'm',
  doz: 'dozen', pkt: 'pack', packet: 'pack', bx: 'box', hr: 'hour', hrs: 'hour', hours: 'hour',
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'active', 'on'])
const FALSE = new Set(['no', 'n', 'false', '0', 'inactive', 'off'])

export const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')

// ---- Export -------------------------------------------------------------------

export function productsToCsv(products: Product[], cats: Map<string, Category>, taxes: Map<string, Tax>): string {
  const rows = products.map((p) => ({
    name: p.name,
    sku: p.sku ?? '',
    barcode: p.barcode ?? '',
    category: (p.categoryId && cats.get(p.categoryId)?.name) || '',
    price: fromMinor(p.price),
    cost: fromMinor(p.cost ?? 0),
    tax_rate: p.taxId ? (taxes.get(p.taxId)?.rate ?? '') : '',
    unit: p.unit,
    stock: p.trackStock ? p.stock : '',
    reorder_level: p.reorderLevel ?? '',
    hsn: p.hsn ?? '',
    mrp: p.mrp !== undefined ? fromMinor(p.mrp) : '',
    active: p.active ? 'yes' : 'no',
  }))
  return toCsv(rows, [...CSV_COLUMNS])
}

export function templateCsv(taxRate = 0): string {
  return toCsv(
    [
      { name: 'Cappuccino', sku: 'BEV-001', barcode: '', category: 'Beverages', price: 3.5, cost: 1.2, tax_rate: taxRate, unit: 'pcs', stock: 50, reorder_level: 10, hsn: '', mrp: '', active: 'yes' },
      { name: 'Basmati Rice', sku: 'GRO-014', barcode: '2912345678906', category: 'Grocery', price: 2.4, cost: 1.75, tax_rate: taxRate, unit: 'kg', stock: 25.5, reorder_level: 5, hsn: '', mrp: '', active: 'yes' },
    ],
    [...CSV_COLUMNS],
  )
}

// ---- Import planning ------------------------------------------------------------

export interface Issue {
  /** Key under `products:import.issue.*`. */
  key: string
  opts?: Record<string, unknown>
}

export type RowStatus = 'new' | 'update' | 'error'

export interface ImportRow {
  /** 1-based line number in the file (the header is line 1). */
  line: number
  status: RowStatus
  errors: Issue[]
  warnings: Issue[]
  match?: Product
  name?: string
  sku?: string
  barcode?: string
  category?: string
  price?: number
  cost?: number
  mrp?: number
  /** null = explicitly no tax; undefined = column empty (keep / default). */
  taxId?: string | null
  unit?: Unit
  stock?: number
  reorderLevel?: number
  hsn?: string
  active?: boolean
}

export interface ImportPlan {
  rows: ImportRow[]
  counts: Record<RowStatus, number>
  /** Category names that will be created. */
  newCategories: string[]
  /** Header names that were not recognised and will be ignored. */
  ignoredColumns: string[]
  fatal?: Issue
}

export interface ImportContext {
  products: Product[]
  categories: Category[]
  taxes: Tax[]
  defaultTaxId?: string
}

function parseAmount(s: string): number {
  // Tolerate currency symbols and spaces: "₹ 1,250.00", "$3.50", "12,5 €".
  return parseDecimal(s.replace(/[^\d.,-]/g, ''))
}

export function planImport(text: string, ctx: ImportContext): ImportPlan {
  const records = parseCsv(text)
  const plan: ImportPlan = { rows: [], counts: { new: 0, update: 0, error: 0 }, newCategories: [], ignoredColumns: [] }
  if (!records.length) return { ...plan, fatal: { key: 'empty' } }

  // Map recognised columns to the file's own header spelling.
  const header = new Map<Col, string>()
  for (const h of Object.keys(records[0])) {
    const n = normaliseHeader(h)
    const col = (CSV_COLUMNS as readonly string[]).includes(n) ? (n as Col) : ALIASES[n]
    if (col && !header.has(col)) header.set(col, h)
    else if (h.trim()) plan.ignoredColumns.push(h)
  }
  if (!header.has('name') && !header.has('barcode') && !header.has('sku')) return { ...plan, fatal: { key: 'noColumns' } }

  const live = ctx.products.filter((p) => !p.deleted)
  const byBarcode = new Map<string, Product>()
  const bySku = new Map<string, Product>()
  for (const p of live) {
    if (p.barcode) byBarcode.set(p.barcode, p)
    if (p.sku) bySku.set(p.sku.toLowerCase(), p)
  }
  const catNames = new Set(ctx.categories.filter((c) => !c.deleted).map((c) => c.name.trim().toLowerCase()))
  const newCats = new Map<string, string>()
  const seenMatch = new Map<string, number>()
  const seenBarcode = new Map<string, number>()
  const seenSku = new Map<string, number>()

  records.forEach((rec, i) => {
    const line = i + 2
    const cell = (c: Col) => {
      const h = header.get(c)
      return h === undefined ? '' : (rec[h] ?? '').trim()
    }
    const row: ImportRow = { line, status: 'new', errors: [], warnings: [] }
    const err = (key: string, opts?: Record<string, unknown>) => row.errors.push({ key, opts })
    const warn = (key: string, opts?: Record<string, unknown>) => row.warnings.push({ key, opts })

    const num = (c: Col, opts: { min?: number } = {}) => {
      const raw = cell(c)
      if (!raw) return undefined
      const n = parseAmount(raw)
      if (!Number.isFinite(n)) return void err('invalidNumber', { column: c, value: raw })
      if (opts.min !== undefined && n < opts.min) return void err('negative', { column: c })
      return n
    }

    row.name = cell('name') || undefined
    row.sku = cell('sku') || undefined
    row.barcode = cell('barcode').replace(/\s/g, '') || undefined
    row.category = cell('category') || undefined
    row.hsn = cell('hsn') || undefined
    const price = num('price', { min: 0 })
    const cost = num('cost', { min: 0 })
    const mrp = num('mrp', { min: 0 })
    if (price !== undefined) row.price = toMinor(price)
    if (cost !== undefined) row.cost = toMinor(cost)
    if (mrp !== undefined) row.mrp = toMinor(mrp)
    const stock = num('stock')
    if (stock !== undefined) row.stock = round3(stock)
    const reorder = num('reorder_level', { min: 0 })
    if (reorder !== undefined) row.reorderLevel = round3(reorder)

    const unitRaw = cell('unit').toLowerCase().replace(/\.$/, '')
    if (unitRaw) {
      const u = (UNITS as string[]).includes(unitRaw) ? (unitRaw as Unit) : UNIT_ALIASES[unitRaw]
      if (u) row.unit = u
      else err('invalidUnit', { value: cell('unit') })
    }

    const activeRaw = cell('active').toLowerCase()
    if (activeRaw) {
      if (TRUE.has(activeRaw)) row.active = true
      else if (FALSE.has(activeRaw)) row.active = false
      else err('invalidActive', { value: cell('active') })
    }

    const taxRaw = cell('tax_rate')
    if (taxRaw) {
      if (/^(none|no|-|exempt)$/i.test(taxRaw)) row.taxId = null
      else {
        const rate = parseDecimal(taxRaw.replace(/[^\d.,]/g, ''))
        const candidates = ctx.taxes.filter((t) => !t.deleted && Math.abs(t.rate - rate) < 0.001)
        const tax = candidates.find((t) => t.id === ctx.defaultTaxId) ?? candidates[0]
        if (!Number.isFinite(rate)) err('invalidNumber', { column: 'tax_rate', value: taxRaw })
        else if (!tax) err('taxNotFound', { rate })
        else row.taxId = tax.id
      }
    }

    // Match existing products by barcode, then SKU.
    row.match = (row.barcode && byBarcode.get(row.barcode)) || (row.sku && bySku.get(row.sku.toLowerCase())) || undefined
    if (row.match) {
      row.status = 'update'
      const prev = seenMatch.get(row.match.id)
      if (prev) err('duplicateRow', { line: prev })
      else seenMatch.set(row.match.id, line)
      const skuOwner = row.sku ? bySku.get(row.sku.toLowerCase()) : undefined
      if (skuOwner && skuOwner.id !== row.match.id) warn('skuTaken', { name: skuOwner.name })
    } else {
      if (!row.name) err('nameRequired')
      if (row.barcode) {
        const prev = seenBarcode.get(row.barcode)
        if (prev) err('duplicateBarcode', { line: prev })
        else seenBarcode.set(row.barcode, line)
      } else if (row.sku) {
        const prev = seenSku.get(row.sku.toLowerCase())
        if (prev) err('duplicateSku', { line: prev })
        else seenSku.set(row.sku.toLowerCase(), line)
      }
    }

    const unit = row.unit ?? row.match?.unit ?? 'pcs'
    const tracks = row.match ? row.match.trackStock : !SERVICE_UNITS.includes(unit)
    if (row.stock !== undefined && !tracks) warn('stockIgnored')
    const effPrice = row.price ?? row.match?.price
    const effMrp = row.mrp ?? row.match?.mrp
    if (effPrice !== undefined && effMrp && effPrice > effMrp) warn('aboveMrp')

    if (row.errors.length) row.status = 'error'
    else if (row.category && !catNames.has(row.category.toLowerCase()) && !newCats.has(row.category.toLowerCase())) {
      newCats.set(row.category.toLowerCase(), row.category)
    }
    plan.counts[row.status]++
    plan.rows.push(row)
  })
  plan.newCategories = [...newCats.values()]
  return plan
}

// ---- Import apply ----------------------------------------------------------------

/** Writes every valid row of `plan` in one transaction. Stock cells become movements that reach the target level. */
export async function applyImport(plan: ImportPlan, ctx: { defaultTaxId?: string; stockNote: string }): Promise<{ created: number; updated: number }> {
  const rows = plan.rows.filter((r) => r.status !== 'error')
  const now = Date.now()
  let created = 0
  let updated = 0
  await tx(['products', 'categories', 'stockMovements'], async () => {
    const categories = (await db.categories.toArray()).filter((c) => !c.deleted)
    const catId = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]))
    let order = categories.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1
    for (const name of plan.newCategories) {
      if (catId.has(name.toLowerCase())) continue
      const c: Category = { id: uuid(), createdAt: now, updatedAt: now, name, color: SWATCHES[order % SWATCHES.length], sortOrder: order++ }
      await db.categories.add(c)
      await db.outbox.add({ table: 'categories', id: c.id, updatedAt: now })
      catId.set(name.toLowerCase(), c.id)
    }

    // Re-read matched products inside the transaction so stock deltas use current levels.
    const matchIds = rows.flatMap((r) => (r.match ? [r.match.id] : []))
    const current = new Map((await db.products.bulkGet(matchIds)).flatMap((p) => (p && !p.deleted ? [[p.id, p] as const] : [])))
    const records: Product[] = []
    const moves: Array<{ id: string; qty: number; type: 'initial' | 'count'; cost: number }> = []

    for (const r of rows) {
      const base = r.match ? current.get(r.match.id) : undefined
      if (r.match && !base) continue
      const unit = r.unit ?? base?.unit ?? 'pcs'
      const p: Product = base
        ? { ...base, updatedAt: now }
        : {
            id: uuid(), createdAt: now, updatedAt: now, name: r.name ?? '', price: 0, cost: 0, unit, stock: 0, active: true,
            trackStock: !SERVICE_UNITS.includes(unit), weighed: MEASURED_UNITS.includes(unit) || undefined, taxId: ctx.defaultTaxId,
          }
      if (r.name) p.name = r.name
      if (r.sku) p.sku = r.sku
      if (r.barcode) p.barcode = r.barcode
      if (r.category) p.categoryId = catId.get(r.category.toLowerCase())
      if (r.price !== undefined) p.price = r.price
      if (r.cost !== undefined) p.cost = r.cost
      if (r.mrp !== undefined) p.mrp = r.mrp
      if (r.taxId !== undefined) p.taxId = r.taxId ?? undefined
      if (r.unit) p.unit = r.unit
      if (r.reorderLevel !== undefined) p.reorderLevel = r.reorderLevel
      if (r.hsn) p.hsn = r.hsn
      if (r.active !== undefined) p.active = r.active
      records.push(p)
      if (base) updated++
      else created++
      if (r.stock !== undefined && p.trackStock) {
        const qty = round3(r.stock - (base?.stock ?? 0))
        if (qty) moves.push({ id: p.id, qty, type: base ? 'count' : 'initial', cost: p.cost })
      }
    }

    await db.products.bulkPut(records)
    await db.outbox.bulkAdd(records.map((p) => ({ table: 'products', id: p.id, updatedAt: now })))
    for (const m of moves) await moveStock(m.id, m.qty, m.type, undefined, ctx.stockNote, m.cost)
  })
  return { created, updated }
}
