import i18n from 'i18next'
import type { PaymentMethod, Sale } from '@/core/types'
import { refundedQuantities } from '@/core/cart'
import { db } from '@/db/db'
import { addDays, endOfDay, fromDateInput, startOfDay, startOfMonth } from '@/lib/dates'
import { fromMinor, moneyConfig } from '@/lib/money'
import { toCsv } from '@/lib/csv'

// Sales history queries. Stores can hold 100k+ sales, so every scan walks the
// `createdAt` index for the selected range (newest first), streams records with
// `each()` and keeps only the rows that will actually be rendered.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'sales', ...opts }) as string

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'last30' | 'custom'
export const RANGE_PRESETS: RangePreset[] = ['today', 'yesterday', 'last7', 'thisMonth', 'last30', 'custom']

export function presetRange(preset: RangePreset, custom: { from: string; to: string }, now = Date.now()): { from: number; to: number } {
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'yesterday':
      return { from: startOfDay(addDays(now, -1)), to: endOfDay(addDays(now, -1)) }
    case 'last7':
      return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) }
    case 'thisMonth':
      return { from: startOfMonth(now), to: endOfDay(now) }
    case 'last30':
      return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) }
    case 'custom': {
      const a = custom.from ? fromDateInput(custom.from) : startOfDay(now)
      const b = custom.to ? fromDateInput(custom.to) : now
      return { from: startOfDay(Math.min(a, b)), to: endOfDay(Math.max(a, b)) }
    }
  }
}

export interface SalesFilter {
  from: number
  to: number
  type: 'all' | 'sale' | 'refund'
  status: 'all' | 'completed' | 'voided'
  method: PaymentMethod | ''
  userId: string
  q: string
}

export interface SalesSummary {
  count: number
  salesCount: number
  salesTotal: number
  refundsCount: number
  refundsTotal: number
  net: number
  voided: number
}

export type RefundState = 'none' | 'partial' | 'full'

/** Typing a document-number prefix (INV-…, CRN-…) searches every date via the number index. */
const NUMBER_PREFIX = /^(inv|crn)-/i

export const isNumberSearch = (q: string) => NUMBER_PREFIX.test(q.trim())

const digits = (s: string) => s.replace(/\D/g, '')

function matcher(f: SalesFilter): (s: Sale) => boolean {
  const q = f.q.trim().toLowerCase()
  const qDigits = digits(q)
  return (s) => {
    if (s.deleted) return false
    if (f.type !== 'all' && s.type !== f.type) return false
    if (f.status !== 'all' && s.status !== f.status) return false
    if (f.method && !s.payments.some((p) => p.method === f.method)) return false
    if (f.userId && s.userId !== f.userId) return false
    if (q) {
      const hit =
        s.number.toLowerCase().includes(q) ||
        !!s.customerName?.toLowerCase().includes(q) ||
        (qDigits.length >= 3 && !!s.customerPhone && digits(s.customerPhone).includes(qDigits))
      if (!hit) return false
    }
    return true
  }
}

function source(f: SalesFilter): { coll: ReturnType<typeof db.sales.toCollection>; allDates: boolean } {
  const q = f.q.trim()
  if (isNumberSearch(q)) return { coll: db.sales.where('number').startsWith(q.toUpperCase()).reverse(), allDates: true }
  return { coll: db.sales.where('createdAt').between(f.from, f.to, true, true).reverse(), allDates: false }
}

/** Refund progress of each sale, from its credit notes. */
export function refundState(sale: Sale, refunds: Sale[]): RefundState {
  if (sale.type !== 'sale' || !refunds.length) return 'none'
  const done = refundedQuantities(refunds.filter((r) => !r.deleted))
  let any = false
  let all = true
  for (const l of sale.lines) {
    if (l.qty <= 0) continue
    const r = done[l.id] ?? 0
    if (r > 0) any = true
    if (r < l.qty - 1e-9) all = false
  }
  return !any ? 'none' : all ? 'full' : 'partial'
}

export async function refundStates(sales: Sale[]): Promise<Record<string, RefundState>> {
  const ids = sales.filter((s) => s.type === 'sale').map((s) => s.id)
  if (!ids.length) return {}
  const refunds = await db.sales.where('refundOf').anyOf(ids).toArray()
  const by = new Map<string, Sale[]>()
  for (const r of refunds) if (r.refundOf && !r.deleted) by.set(r.refundOf, [...(by.get(r.refundOf) ?? []), r])
  const out: Record<string, RefundState> = {}
  for (const s of sales) {
    const st = refundState(s, by.get(s.id) ?? [])
    if (st !== 'none') out[s.id] = st
  }
  return out
}

export interface ScanResult {
  rows: Sale[]
  more: boolean
  allDates: boolean
  summary: SalesSummary
  refunds: Record<string, RefundState>
}

/** Inserts `s` into `rows` (newest first), keeping at most `cap` of the newest sales. */
function keepNewest(rows: Sale[], s: Sale, cap: number) {
  if (rows.length >= cap && s.createdAt <= rows[rows.length - 1].createdAt) return
  let i = rows.length
  while (i > 0 && rows[i - 1].createdAt < s.createdAt) i--
  rows.splice(i, 0, s)
  if (rows.length > cap) rows.pop()
}

/** Streams the filtered range once: exact summary for every match, but only `limit` rows are kept. */
export async function scanSales(f: SalesFilter, limit: number): Promise<ScanResult> {
  const match = matcher(f)
  const { coll, allDates } = source(f)
  const rows: Sale[] = []
  const summary: SalesSummary = { count: 0, salesCount: 0, salesTotal: 0, refundsCount: 0, refundsTotal: 0, net: 0, voided: 0 }
  await coll.each((s) => {
    if (!match(s)) return
    summary.count++
    if (s.status === 'voided') summary.voided++
    else if (s.type === 'refund') {
      summary.refundsCount++
      summary.refundsTotal += s.total
    } else {
      summary.salesCount++
      summary.salesTotal += s.total
    }
    // Number searches walk the number index, which isn't chronological across terminals.
    if (allDates) keepNewest(rows, s, limit + 1)
    else if (rows.length <= limit) rows.push(s)
  })
  summary.net = summary.salesTotal + summary.refundsTotal
  const more = rows.length > limit
  const shown = rows.slice(0, limit)
  return { rows: shown, more, allDates, summary, refunds: await refundStates(shown) }
}

// ---- CSV export ---------------------------------------------------------------

const amount = (minor: number) => fromMinor(minor).toFixed(moneyConfig().decimals)

export function csvDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const methodText = (s: Sale) => s.payments.map((p) => `${i18n.t(`common:payment.${p.method}`)} ${amount(p.amount)}`).join(' + ')

async function collect(f: SalesFilter): Promise<Sale[]> {
  const match = matcher(f)
  const { coll } = source(f)
  const out: Sale[] = []
  await coll.each((s) => {
    if (match(s)) out.push(s)
  })
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

export async function salesCsv(f: SalesFilter): Promise<{ csv: string; count: number }> {
  const list = await collect(f)
  const rows = list.map((s) => ({
    number: s.number,
    date: csvDate(s.createdAt),
    type: t(`type.${s.type}`),
    status: t(`status.${s.status}`),
    customer: s.customerName ?? '',
    customer_phone: s.customerPhone ?? '',
    subtotal: amount(s.subtotal),
    discount: amount(s.discountTotal),
    tax: amount(s.taxTotal),
    rounding: amount(s.rounding || 0),
    total: amount(s.total),
    payment_methods: methodText(s),
    cashier: s.userName,
    note: s.note ?? '',
  }))
  const cols = ['number', 'date', 'type', 'status', 'customer', 'customer_phone', 'subtotal', 'discount', 'tax', 'rounding', 'total', 'payment_methods', 'cashier', 'note']
  return { csv: toCsv(rows, cols), count: rows.length }
}

export async function itemsCsv(f: SalesFilter): Promise<{ csv: string; count: number }> {
  const list = await collect(f)
  const rows: Array<Record<string, unknown>> = []
  for (const s of list)
    for (const l of s.lines)
      rows.push({
        number: s.number,
        date: csvDate(s.createdAt),
        type: t(`type.${s.type}`),
        status: t(`status.${s.status}`),
        customer: s.customerName ?? '',
        item: l.name,
        sku: l.sku ?? '',
        barcode: l.barcode ?? '',
        hsn: l.hsn ?? '',
        qty: l.qty,
        unit: l.unit,
        price: amount(l.price),
        discount: amount(l.discount),
        tax_rate: l.taxRate,
        net: amount(l.net),
        tax: amount(l.tax),
        total: amount(l.total),
        cost: amount(Math.round(l.cost * l.qty)),
        cashier: s.userName,
      })
  const cols = ['number', 'date', 'type', 'status', 'customer', 'item', 'sku', 'barcode', 'hsn', 'qty', 'unit', 'price', 'discount', 'tax_rate', 'net', 'tax', 'total', 'cost', 'cashier']
  return { csv: toCsv(rows, cols), count: list.length }
}
