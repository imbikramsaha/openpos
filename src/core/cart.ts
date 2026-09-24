import type { CartLine, DiscountType, Minor, SaleLine, Tax, TaxBreakdown } from './types'

// Pure cart maths. No I/O, no framework — unit tested in tests/cart.test.ts.
//
// Order of operations per line:
//   gross     = unit price × qty
//   − line discount
//   − share of the cart discount (distributed proportionally, exact to the minor unit)
//   → split into net + tax depending on whether prices include tax.
// The invoice total is then rounded to the configured cash rounding step.

export interface CalcOptions {
  pricesIncludeTax: boolean
  /** Rounding step for the grand total in minor units, 0 = none (e.g. 100 = nearest rupee). */
  cashRounding: Minor
  cartDiscountType?: DiscountType
  /** Percent, or minor units for amount discounts. */
  cartDiscountValue?: number
  taxes: Map<string, Tax> | Record<string, Tax>
}

export interface CalcResult {
  lines: SaleLine[]
  subtotal: Minor
  lineDiscountTotal: Minor
  cartDiscount: Minor
  discountTotal: Minor
  netTotal: Minor
  taxTotal: Minor
  totalBeforeRounding: Minor
  rounding: Minor
  total: Minor
  taxBreakdown: TaxBreakdown[]
  itemCount: number
}

/** Round half away from zero, tolerant of float noise like 2.4999999999999996. */
const round = (n: number) => {
  const r = Math.round(Math.abs(n) + 1e-9)
  return n < 0 ? -r : r
}

function getTax(taxes: CalcOptions['taxes'], id?: string): Tax | undefined {
  if (!id) return undefined
  return taxes instanceof Map ? taxes.get(id) : taxes[id]
}

/** Discount amount for a base value; keeps the sign of the base (returns lines are negative). */
export function discountAmount(base: Minor, type?: DiscountType, value?: number): Minor {
  if (!type || !value) return 0
  const sign = base < 0 ? -1 : 1
  const abs = Math.abs(base)
  const d = type === 'percent' ? round((abs * Math.min(Math.max(value, 0), 100)) / 100) : Math.min(Math.max(value, 0), abs)
  return sign * d
}

/** Splits `amount` across `weights` so the parts sum exactly to `amount` (largest remainder). */
export function distribute(amount: Minor, weights: number[]): Minor[] {
  const total = weights.reduce((a, b) => a + b, 0)
  if (!amount || !total) return weights.map(() => 0)
  const raw = weights.map((w) => (amount * w) / total)
  const floored = raw.map((r) => Math.trunc(r))
  let rest = amount - floored.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac)
  const step = Math.sign(rest)
  for (let k = 0; rest !== 0 && k < order.length; k++) {
    floored[order[k].i] += step
    rest -= step
  }
  return floored
}

export function roundTo(amount: Minor, step: Minor): Minor {
  if (!step || step <= 1) return amount
  return Math.round(amount / step) * step
}

export function calculateCart(lines: CartLine[], opts: CalcOptions): CalcResult {
  const prepared = lines.map((l) => {
    const gross = round(l.price * l.qty)
    const lineDisc = discountAmount(gross, l.discountType, l.discountValue)
    return { l, gross, lineDisc, after: gross - lineDisc }
  })

  const subtotal = prepared.reduce((s, p) => s + p.gross, 0)
  const lineDiscountTotal = prepared.reduce((s, p) => s + p.lineDisc, 0)
  const afterLineTotal = subtotal - lineDiscountTotal

  // Cart discounts only make sense on a positive basket; returns-only carts skip them.
  const cartDiscount = afterLineTotal > 0 ? discountAmount(afterLineTotal, opts.cartDiscountType, opts.cartDiscountValue) : 0
  const weights = prepared.map((p) => Math.max(p.after, 0))
  const shares = distribute(cartDiscount, weights)

  const breakdown = new Map<string, TaxBreakdown>()
  const saleLines: SaleLine[] = prepared.map((p, i) => {
    const tax = getTax(opts.taxes, p.l.taxId)
    const rate = tax?.rate ?? 0
    const amount = p.after - shares[i]
    let net: Minor, taxAmt: Minor, total: Minor
    if (opts.pricesIncludeTax) {
      total = amount
      net = round(amount / (1 + rate / 100))
      taxAmt = total - net
    } else {
      net = amount
      taxAmt = round((amount * rate) / 100)
      total = net + taxAmt
    }
    const key = `${tax?.id ?? 'none'}|${rate}`
    const b = breakdown.get(key) ?? { taxId: tax?.id, name: tax?.name ?? '', rate, taxable: 0, tax: 0 }
    b.taxable += net
    b.tax += taxAmt
    breakdown.set(key, b)
    return {
      id: p.l.id,
      productId: p.l.productId,
      name: p.l.name,
      sku: p.l.sku,
      barcode: p.l.barcode,
      hsn: p.l.hsn,
      unit: p.l.unit,
      qty: p.l.qty,
      price: p.l.price,
      cost: p.l.cost,
      discountType: p.l.discountType,
      discountValue: p.l.discountValue,
      discount: p.lineDisc + shares[i],
      taxId: tax?.id,
      taxName: tax?.name,
      taxRate: rate,
      net,
      tax: taxAmt,
      total,
      note: p.l.note,
    }
  })

  const netTotal = saleLines.reduce((s, l) => s + l.net, 0)
  const taxTotal = saleLines.reduce((s, l) => s + l.tax, 0)
  const totalBeforeRounding = netTotal + taxTotal
  const total = roundTo(totalBeforeRounding, opts.cashRounding)
  return {
    lines: saleLines,
    subtotal,
    lineDiscountTotal,
    cartDiscount,
    discountTotal: lineDiscountTotal + cartDiscount,
    netTotal,
    taxTotal,
    totalBeforeRounding,
    rounding: total - totalBeforeRounding,
    total,
    taxBreakdown: [...breakdown.values()].filter((b) => b.rate > 0 || b.taxable !== 0).sort((a, b) => a.rate - b.rate),
    itemCount: lines.reduce((s, l) => s + (l.unit === 'pcs' || l.unit === 'box' || l.unit === 'pack' ? l.qty : 1), 0),
  }
}

export interface GstRow {
  label: 'CGST' | 'SGST' | 'IGST'
  rate: number
  taxable: Minor
  tax: Minor
}

/** India GST: intra-state tax is split equally into CGST + SGST, inter-state is IGST. */
export function gstSplit(breakdown: TaxBreakdown[], interState: boolean): GstRow[] {
  const rows: GstRow[] = []
  for (const b of breakdown) {
    if (!b.rate) continue
    if (interState) {
      rows.push({ label: 'IGST', rate: b.rate, taxable: b.taxable, tax: b.tax })
    } else {
      const half = Math.trunc(b.tax / 2)
      rows.push({ label: 'CGST', rate: b.rate / 2, taxable: b.taxable, tax: half })
      rows.push({ label: 'SGST', rate: b.rate / 2, taxable: b.taxable, tax: b.tax - half })
    }
  }
  return rows
}

/** Change due when paying `paid` against `total`; only cash tender can produce change. */
export function computeChange(total: Minor, payments: Array<{ method: string; amount: Minor }>): { paid: Minor; change: Minor; due: Minor } {
  const paid = payments.reduce((s, p) => s + p.amount, 0)
  const due = total - paid
  if (due >= 0) return { paid, change: 0, due }
  const cash = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  return { paid, change: Math.min(-due, cash), due: 0 }
}

/** Suggested cash notes for quick tender buttons, e.g. total 437 → 440, 450, 500, 1000. */
export function quickCashSuggestions(total: Minor, notes: Minor[]): Minor[] {
  if (total <= 0) return []
  const out = new Set<Minor>([total])
  const sorted = [...notes].sort((a, b) => a - b)
  for (const n of sorted) {
    const v = Math.ceil(total / n) * n
    if (v > total) out.add(v)
    if (out.size >= 5) break
  }
  return [...out].sort((a, b) => a - b).slice(0, 5)
}

/**
 * Build refund lines as the proportional negative of original sale lines.
 * `alreadyRefunded` maps original line id → quantity refunded by earlier credit notes.
 */
export function refundLines(original: SaleLine[], qtyByLine: Record<string, number>, alreadyRefunded: Record<string, number> = {}): SaleLine[] {
  const out: SaleLine[] = []
  for (const l of original) {
    const q = qtyByLine[l.id]
    if (!q || q <= 0 || !l.qty) continue
    const qty = Math.min(q, l.qty - (alreadyRefunded[l.id] ?? 0))
    if (qty <= 0) continue
    const ratio = qty / l.qty
    const total = -round(l.total * ratio)
    const tax = -round(l.tax * ratio)
    out.push({
      ...l,
      id: `${l.id}:r${Math.random().toString(36).slice(2, 8)}`,
      refLineId: l.id,
      qty: -qty,
      discount: -round(l.discount * ratio),
      net: total - tax,
      tax,
      total,
    })
  }
  return out
}

/** Quantity already refunded per original line, from the refund documents of a sale. */
export function refundedQuantities(refunds: Array<{ status: string; lines: SaleLine[] }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of refunds) {
    if (r.status !== 'completed') continue
    for (const l of r.lines) if (l.refLineId) out[l.refLineId] = (out[l.refLineId] ?? 0) - l.qty
  }
  return out
}

export function summarizeLines(lines: SaleLine[]) {
  const breakdown = new Map<string, TaxBreakdown>()
  for (const l of lines) {
    const key = `${l.taxId ?? 'none'}|${l.taxRate}`
    const b = breakdown.get(key) ?? { taxId: l.taxId, name: l.taxName ?? '', rate: l.taxRate, taxable: 0, tax: 0 }
    b.taxable += l.net
    b.tax += l.tax
    breakdown.set(key, b)
  }
  return {
    netTotal: lines.reduce((s, l) => s + l.net, 0),
    taxTotal: lines.reduce((s, l) => s + l.tax, 0),
    total: lines.reduce((s, l) => s + l.total, 0),
    discountTotal: lines.reduce((s, l) => s + l.discount, 0),
    subtotal: lines.reduce((s, l) => s + round(l.price * l.qty), 0),
    taxBreakdown: [...breakdown.values()].filter((b) => b.rate > 0).sort((a, b) => a.rate - b.rate),
  }
}

/** Loyalty points earned for a paid amount (major units × rate), floored. */
export function loyaltyEarned(totalMinor: Minor, decimals: number, rate: number): number {
  if (totalMinor <= 0 || rate <= 0) return 0
  return Math.floor((totalMinor / 10 ** decimals) * rate)
}
