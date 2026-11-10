import type { CustomerPayment, PaymentMethod, Sale, Unit } from '@/core/types'
import { db } from '@/db/db'
import { bucketIndex } from './range'
import { terminalCode } from './format'

// One-pass aggregation of sales documents for every report tab. Pure apart from
// `loadAggregate`, which streams the date range from IndexedDB in chunks so 100k+
// documents never sit in memory at once.
//
// Rules: deleted documents are ignored; voided documents are only counted as voids;
// refunds (type 'refund') carry negative amounts, so net figures are plain sums of
// every completed document.

export interface Totals {
  /** Completed sale documents (transactions). */
  sales: number
  refundsCount: number
  voids: number
  voidsAmount: number
  /** Sum of sale document totals (incl. tax), before refunds. */
  salesTotal: number
  /** Sum of refund document totals (negative). */
  refunds: number
  discounts: number
  /** Net sales excluding tax, after discounts and refunds. */
  net: number
  tax: number
  /** Everything collected, incl. tax and rounding. */
  total: number
  rounding: number
  cost: number
  profit: number
  qty: number
  customers: number
  walkIn: number
}

export interface Bucket {
  net: number
  total: number
  /** Sale document totals only (no refunds), for the average ticket. */
  salesTotal: number
  count: number
  profit: number
  methods: Partial<Record<PaymentMethod, number>>
}

export interface ProductAgg {
  key: string
  productId?: string
  name: string
  sku?: string
  unit: Unit
  qty: number
  net: number
  tax: number
  total: number
  cost: number
  profit: number
  count: number
}

export interface MethodAgg {
  method: PaymentMethod
  count: number
  sales: number
  refunds: number
  net: number
}

export interface StaffAgg {
  userId: string
  name: string
  count: number
  net: number
  total: number
  refundsCount: number
  refunds: number
  discounts: number
  voids: number
  voidsAmount: number
}

export interface TerminalAgg {
  deviceId: string
  code: string
  count: number
  net: number
  total: number
}

export interface CustomerAgg {
  customerId: string
  name: string
  phone?: string
  visits: number
  net: number
  total: number
  refunds: number
  last: number
}

export interface RateAgg {
  rate: number
  name: string
  taxable: number
  tax: number
  cgst: number
  sgst: number
  igst: number
  total: number
}

export interface HsnAgg {
  key: string
  hsn: string
  description: string
  /** Other product names grouped into this row (the description shows the first). */
  others: number
  unit: Unit
  rate: number
  qty: number
  value: number
  taxable: number
  tax: number
  cgst: number
  sgst: number
  igst: number
}

export interface DocSplit {
  count: number
  taxable: number
  tax: number
  total: number
}

/** Money customers paid towards their account balance (khata). It isn't sales, so no sales total includes it. */
export interface AccountPayments {
  total: number
  count: number
  methods: Map<PaymentMethod, { count: number; amount: number }>
  /** Each payment, oldest first (empty for comparison periods). */
  list: CustomerPayment[]
}

export interface Aggregate {
  totals: Totals
  buckets: Bucket[]
  hours: Array<{ net: number; count: number }>
  /** Net sales by [weekday 0=Sunday][hour]. */
  heat: number[][]
  heatCount: number[][]
  products: Map<string, ProductAgg>
  methods: Map<PaymentMethod, MethodAgg>
  staff: Map<string, StaffAgg>
  terminals: Map<string, TerminalAgg>
  /** Every terminal seen in the range, before the terminal filter. */
  allTerminals: Map<string, string>
  customers: Map<string, CustomerAgg>
  rates: Map<number, RateAgg>
  hsn: Map<string, HsnAgg>
  b2b: DocSplit
  b2c: DocSplit
  b2bInvoices: Sale[]
  creditNotes: Sale[]
  accounts: AccountPayments
}

export interface AggregateOptions {
  starts: number[]
  deviceId?: string
  /** Totals only include documents created at or before this time (comparison periods). */
  cutoff?: number
  /** Skip the per-product/tax/staff breakdowns (comparison periods need totals and the trend only). */
  light?: boolean
}

export function emptyTotals(): Totals {
  return {
    sales: 0, refundsCount: 0, voids: 0, voidsAmount: 0, salesTotal: 0, refunds: 0, discounts: 0, net: 0, tax: 0,
    total: 0, rounding: 0, cost: 0, profit: 0, qty: 0, customers: 0, walkIn: 0,
  }
}

const split = () => ({ count: 0, taxable: 0, tax: 0, total: 0 })

export class Aggregator {
  readonly agg: Aggregate
  private readonly seenCustomers = new Set<string>()
  private readonly hsnNames = new Map<string, Set<string>>()

  constructor(private readonly opts: AggregateOptions) {
    this.agg = {
      totals: emptyTotals(),
      buckets: opts.starts.map(() => ({ net: 0, total: 0, salesTotal: 0, count: 0, profit: 0, methods: {} })),
      hours: Array.from({ length: 24 }, () => ({ net: 0, count: 0 })),
      heat: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
      heatCount: Array.from({ length: 7 }, () => new Array<number>(24).fill(0)),
      products: new Map(),
      methods: new Map(),
      staff: new Map(),
      terminals: new Map(),
      allTerminals: new Map(),
      customers: new Map(),
      rates: new Map(),
      hsn: new Map(),
      b2b: split(),
      b2c: split(),
      b2bInvoices: [],
      creditNotes: [],
      accounts: { total: 0, count: 0, methods: new Map(), list: [] },
    }
  }

  add(s: Sale): void {
    if (s.deleted) return
    const a = this.agg
    const o = this.opts
    if (!a.allTerminals.has(s.deviceId)) a.allTerminals.set(s.deviceId, terminalCode(s.number))
    if (o.deviceId && s.deviceId !== o.deviceId) return
    const isSale = s.type === 'sale'
    const inTotals = o.cutoff === undefined || s.createdAt <= o.cutoff

    if (s.status !== 'completed') {
      if (s.status === 'voided' && inTotals) {
        a.totals.voids++
        a.totals.voidsAmount += s.total
        if (!o.light) {
          const st = this.staffRow(s)
          st.voids++
          st.voidsAmount += s.total
        }
      }
      return
    }

    // Per-line profit (net − cost × qty); refund lines are negative so they subtract.
    let cost = 0
    let qty = 0
    for (const l of s.lines) {
      cost += Math.round(l.cost * l.qty)
      qty += l.qty
    }
    const profit = s.netTotal - cost

    // Cash tendered minus change given is what stays in the drawer.
    const methodAmounts: Partial<Record<PaymentMethod, number>> = {}
    for (const p of s.payments) methodAmounts[p.method] = (methodAmounts[p.method] ?? 0) + p.amount
    if (s.change) methodAmounts.cash = (methodAmounts.cash ?? 0) - s.change

    const bi = bucketIndex(o.starts, s.createdAt)
    if (bi >= 0) {
      const b = a.buckets[bi]
      b.net += s.netTotal
      b.total += s.total
      b.profit += profit
      if (isSale) {
        b.count++
        b.salesTotal += s.total
      }
      for (const m in methodAmounts) {
        const k = m as PaymentMethod
        b.methods[k] = (b.methods[k] ?? 0) + (methodAmounts[k] ?? 0)
      }
    }
    if (!inTotals) return

    const t = a.totals
    t.net += s.netTotal
    t.tax += s.taxTotal
    t.total += s.total
    t.rounding += s.rounding
    t.discounts += s.discountTotal
    t.cost += cost
    t.profit += profit
    t.qty += qty
    if (isSale) {
      t.sales++
      t.salesTotal += s.total
      if (s.customerId) {
        if (!this.seenCustomers.has(s.customerId)) {
          this.seenCustomers.add(s.customerId)
          t.customers++
        }
      } else t.walkIn++
    } else {
      t.refundsCount++
      t.refunds += s.total
    }

    if (o.light) return

    const d = new Date(s.createdAt)
    const hour = d.getHours()
    const day = d.getDay()
    a.hours[hour].net += s.netTotal
    a.heat[day][hour] += s.netTotal
    if (isSale) {
      a.hours[hour].count++
      a.heatCount[day][hour]++
    }

    for (const m in methodAmounts) {
      const k = m as PaymentMethod
      const amount = methodAmounts[k] ?? 0
      let row = a.methods.get(k)
      if (!row) a.methods.set(k, (row = { method: k, count: 0, sales: 0, refunds: 0, net: 0 }))
      row.net += amount
      if (isSale) {
        row.count++
        row.sales += amount
      } else row.refunds += amount
    }

    const st = this.staffRow(s)
    st.net += s.netTotal
    st.total += s.total
    // Discounts net of refunded discounts, like the totals and the shift report.
    st.discounts += s.discountTotal
    if (isSale) {
      st.count++
    } else {
      st.refundsCount++
      st.refunds += s.total
    }

    let term = a.terminals.get(s.deviceId)
    if (!term) a.terminals.set(s.deviceId, (term = { deviceId: s.deviceId, code: terminalCode(s.number), count: 0, net: 0, total: 0 }))
    term.net += s.netTotal
    term.total += s.total
    if (isSale) term.count++

    if (s.customerId) {
      let c = a.customers.get(s.customerId)
      if (!c) a.customers.set(s.customerId, (c = { customerId: s.customerId, name: s.customerName ?? '', phone: s.customerPhone, visits: 0, net: 0, total: 0, refunds: 0, last: 0 }))
      if (s.customerName) c.name = s.customerName
      if (s.customerPhone) c.phone = s.customerPhone
      c.net += s.netTotal
      c.total += s.total
      if (isSale) c.visits++
      else c.refunds += s.total
      c.last = Math.max(c.last, s.createdAt)
    }

    const docSplit = s.customerTaxNumber ? a.b2b : a.b2c
    if (isSale) docSplit.count++
    docSplit.taxable += s.netTotal
    docSplit.tax += s.taxTotal
    docSplit.total += s.total
    if (!isSale) a.creditNotes.push(s)
    else if (s.customerTaxNumber) a.b2bInvoices.push(s)

    // Products, tax rates and HSN rows. GST is split per invoice and rate the same
    // way invoices print it (CGST = half truncated, SGST = the rest).
    const perRate = new Map<number, { taxable: number; tax: number; total: number; name: string }>()
    const perHsn = new Map<string, { tax: number }>()
    for (const l of s.lines) {
      const key = l.productId ?? `custom:${l.name.trim().toLowerCase()}`
      let p = a.products.get(key)
      if (!p) a.products.set(key, (p = { key, productId: l.productId, name: l.name, sku: l.sku, unit: l.unit, qty: 0, net: 0, tax: 0, total: 0, cost: 0, profit: 0, count: 0 }))
      const lineCost = Math.round(l.cost * l.qty)
      p.name = l.name
      if (l.sku) p.sku = l.sku
      p.qty += l.qty
      p.net += l.net
      p.tax += l.tax
      p.total += l.total
      p.cost += lineCost
      p.profit += l.net - lineCost
      if (isSale) p.count++

      const r = perRate.get(l.taxRate) ?? { taxable: 0, tax: 0, total: 0, name: l.taxName ?? '' }
      r.taxable += l.net
      r.tax += l.tax
      r.total += l.total
      perRate.set(l.taxRate, r)

      const hsn = (l.hsn ?? '').trim()
      const hk = `${hsn}|${l.taxRate}|${l.unit}`
      let h = a.hsn.get(hk)
      if (!h) a.hsn.set(hk, (h = { key: hk, hsn, description: l.name, others: 0, unit: l.unit, rate: l.taxRate, qty: 0, value: 0, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0 }))
      let names = this.hsnNames.get(hk)
      if (!names) this.hsnNames.set(hk, (names = new Set([l.name.trim().toLowerCase()])))
      else if (!names.has(l.name.trim().toLowerCase())) {
        names.add(l.name.trim().toLowerCase())
        h.others = names.size - 1
      }
      h.qty += l.qty
      h.value += l.total
      h.taxable += l.net
      h.tax += l.tax
      const ph = perHsn.get(hk) ?? { tax: 0 }
      ph.tax += l.tax
      perHsn.set(hk, ph)
    }
    for (const [rate, r] of perRate) {
      let row = a.rates.get(rate)
      if (!row) a.rates.set(rate, (row = { rate, name: r.name, taxable: 0, tax: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }))
      row.taxable += r.taxable
      row.tax += r.tax
      row.total += r.total
      if (s.interState) row.igst += r.tax
      else {
        const half = Math.trunc(r.tax / 2)
        row.cgst += half
        row.sgst += r.tax - half
      }
    }
    for (const [hk, ph] of perHsn) {
      const h = a.hsn.get(hk)!
      if (s.interState) h.igst += ph.tax
      else {
        const half = Math.trunc(ph.tax / 2)
        h.cgst += half
        h.sgst += ph.tax - half
      }
    }
  }

  /**
   * A payment against a customer's account, taken on the till `deviceId`. Entries with the `credit`
   * method are balance adjustments (opening balance, manual charge or reduction), not money received.
   */
  addAccountPayment(p: CustomerPayment, deviceId?: string): void {
    const o = this.opts
    if (p.deleted || p.method === 'credit') return
    if (o.deviceId && deviceId !== o.deviceId) return
    if (o.cutoff !== undefined && p.createdAt > o.cutoff) return
    const a = this.agg.accounts
    a.total += p.amount
    a.count++
    let m = a.methods.get(p.method)
    if (!m) a.methods.set(p.method, (m = { count: 0, amount: 0 }))
    m.count++
    m.amount += p.amount
    if (!o.light) a.list.push(p)
  }

  private staffRow(s: Sale): StaffAgg {
    let st = this.agg.staff.get(s.userId)
    if (!st) this.agg.staff.set(s.userId, (st = { userId: s.userId, name: s.userName, count: 0, net: 0, total: 0, refundsCount: 0, refunds: 0, discounts: 0, voids: 0, voidsAmount: 0 }))
    if (s.userName) st.name = s.userName
    return st
  }
}

/** Aggregates a list of sales in one pass. */
export function aggregate(sales: Iterable<Sale>, opts: AggregateOptions): Aggregate {
  const g = new Aggregator(opts)
  for (const s of sales) g.add(s)
  return g.agg
}

const CHUNK = 7 * 86_400_000

/** Streams sales created in [from, to] from IndexedDB, a week at a time, into an aggregate, then adds the account payments. */
export async function loadAggregate(from: number, to: number, opts: AggregateOptions): Promise<Aggregate> {
  const g = new Aggregator(opts)
  for (let a = from; a <= to; a += CHUNK) {
    const b = Math.min(a + CHUNK - 1, to)
    const chunk = await db.sales.where('createdAt').between(a, b, true, true).toArray()
    for (const s of chunk) g.add(s)
  }
  const payments = await db.customerPayments.where('createdAt').between(from, to, true, true).toArray()
  // Payments saved before they recorded their till are placed through their shift.
  const shiftIds = opts.deviceId ? [...new Set(payments.filter((p) => !p.deviceId && p.shiftId).map((p) => p.shiftId!))] : []
  const shiftTill = new Map<string, string>()
  for (const sh of shiftIds.length ? await db.shifts.bulkGet(shiftIds) : []) if (sh) shiftTill.set(sh.id, sh.deviceId)
  for (const p of payments.sort((x, y) => x.createdAt - y.createdAt)) g.addAccountPayment(p, p.deviceId ?? (p.shiftId ? shiftTill.get(p.shiftId) : undefined))
  return g.agg
}
