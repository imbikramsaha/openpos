import type { CashMovement, Shift, TaxBreakdown } from '@/core/types'
import { gstSplit, type GstRow } from '@/core/cart'
import { db } from '@/db/db'
import { audit, nextNumber, tx } from '@/db/repo'
import { uuid } from '@/lib/uuid'
import { device } from '@/stores/device'
import { session } from '@/stores/session'

/**
 * A shift as stored. `closedById/closedByName` record who closed it; they are extra
 * fields on the synced document (see the shared-type note in the feature report).
 */
export type ShiftRecord = Shift & { closedById?: string; closedByName?: string }

export async function loadCurrentShift(): Promise<Shift | null> {
  const open = await db.shifts.where('status').equals('open').toArray()
  const mine = open.filter((s) => s.deviceId === device().deviceId && !s.deleted).sort((a, b) => b.openedAt - a.openedAt)
  const shift = mine[0] ?? null
  session().setShift(shift)
  return shift
}

export async function openShift(openingFloat: number, notes?: string): Promise<Shift> {
  const user = session().user
  if (!user) throw new Error('Not logged in')
  const existing = await loadCurrentShift()
  if (existing) return existing
  const now = Date.now()
  const shift = await tx(['shifts'], async () => {
    const s: Shift = {
      id: uuid(), createdAt: now, updatedAt: now,
      number: await nextNumber('shift', device().terminal),
      deviceId: device().deviceId, userId: user.id, userName: user.name,
      openedAt: now, openingFloat, status: 'open', notes,
    }
    await db.shifts.add(s)
    await db.outbox.add({ table: 'shifts', id: s.id, updatedAt: now })
    return s
  })
  session().setShift(shift)
  void audit('shift.open', 'shift', shift.id, shift.number)
  return shift
}

export interface ShiftSummary {
  openingFloat: number
  salesCount: number
  refundsCount: number
  /** Sale document totals (incl. tax). */
  grossSales: number
  /** Refund document totals (negative). */
  refunds: number
  discounts: number
  tax: number
  /** Sales + refunds, incl. tax. */
  netSales: number
  byMethod: Record<string, number>
  cashSales: number
  cashIn: number
  cashOut: number
  customerPaymentsCash: number
  expectedCash: number
  voids: number
  // Added for X/Z reports (optional so older callers keep compiling).
  /** Net sales excluding tax. */
  netExTax?: number
  voidsAmount?: number
  rounding?: number
  /** Tax per rate, net of refunds. */
  taxBreakdown?: TaxBreakdown[]
  /** CGST/SGST/IGST rows per rate (India GST), split per invoice like the receipts. */
  gst?: GstRow[]
  /** Transactions per payment method (sale documents). */
  countByMethod?: Record<string, number>
  firstSaleAt?: number
  lastSaleAt?: number
}

/** Totals for a shift. Expected cash = float + net cash taken − change + cash in − cash out. */
export async function shiftSummary(shift: Shift): Promise<ShiftSummary> {
  const sales = (await db.sales.where('shiftId').equals(shift.id).toArray()).filter((s) => !s.deleted)
  const moves = (await db.cashMovements.where('shiftId').equals(shift.id).toArray()).filter((m) => !m.deleted)
  const custPays = (await db.customerPayments.where('shiftId').equals(shift.id).toArray()).filter((p) => !p.deleted)
  const done = sales.filter((s) => s.status === 'completed')
  const byMethod: Record<string, number> = {}
  const countByMethod: Record<string, number> = {}
  const rates = new Map<string, TaxBreakdown>()
  const gst = new Map<string, GstRow>()
  let cashSales = 0
  let firstSaleAt: number | undefined
  let lastSaleAt: number | undefined
  for (const s of done) {
    for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount
    if (s.type === 'sale') for (const m of new Set(s.payments.map((p) => p.method))) countByMethod[m] = (countByMethod[m] ?? 0) + 1
    const cash = s.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
    cashSales += cash - s.change
    firstSaleAt = Math.min(firstSaleAt ?? s.createdAt, s.createdAt)
    lastSaleAt = Math.max(lastSaleAt ?? s.createdAt, s.createdAt)
    // Rate table from the lines (refund breakdowns omit 0% rows).
    const perRate = new Map<number, TaxBreakdown>()
    for (const l of s.lines) {
      const b = perRate.get(l.taxRate) ?? { name: l.taxName ?? '', rate: l.taxRate, taxable: 0, tax: 0 }
      b.taxable += l.net
      b.tax += l.tax
      perRate.set(l.taxRate, b)
    }
    for (const b of perRate.values()) {
      const key = String(b.rate)
      const r = rates.get(key) ?? { name: b.name, rate: b.rate, taxable: 0, tax: 0 }
      r.taxable += b.taxable
      r.tax += b.tax
      rates.set(key, r)
    }
    for (const row of gstSplit([...perRate.values()], !!s.interState)) {
      const key = `${row.label}|${row.rate}`
      const g = gst.get(key) ?? { ...row, taxable: 0, tax: 0 }
      g.taxable += row.taxable
      g.tax += row.tax
      gst.set(key, g)
    }
  }
  if (byMethod.cash !== undefined) byMethod.cash = cashSales
  const cashIn = moves.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
  const cashOut = moves.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
  const customerPaymentsCash = custPays.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
  const salesOnly = done.filter((s) => s.type === 'sale')
  const refundsOnly = done.filter((s) => s.type === 'refund')
  const voided = sales.filter((s) => s.status === 'voided')
  const order = { CGST: 0, SGST: 1, IGST: 2 }
  return {
    openingFloat: shift.openingFloat,
    salesCount: salesOnly.length,
    refundsCount: refundsOnly.length,
    grossSales: salesOnly.reduce((a, s) => a + s.total, 0),
    refunds: refundsOnly.reduce((a, s) => a + s.total, 0),
    discounts: done.reduce((a, s) => a + s.discountTotal, 0),
    tax: done.reduce((a, s) => a + s.taxTotal, 0),
    netSales: done.reduce((a, s) => a + s.total, 0),
    byMethod,
    cashSales,
    cashIn,
    cashOut,
    customerPaymentsCash,
    expectedCash: shift.openingFloat + cashSales + cashIn - cashOut + customerPaymentsCash,
    voids: voided.length,
    netExTax: done.reduce((a, s) => a + s.netTotal, 0),
    voidsAmount: voided.reduce((a, s) => a + s.total, 0),
    rounding: done.reduce((a, s) => a + s.rounding, 0),
    taxBreakdown: [...rates.values()].sort((a, b) => a.rate - b.rate),
    gst: [...gst.values()].filter((g) => g.tax || g.taxable).sort((a, b) => a.rate - b.rate || order[a.label] - order[b.label]),
    countByMethod,
    firstSaleAt,
    lastSaleAt,
  }
}

export async function closeShift(shift: Shift, countedCash: number, notes?: string): Promise<Shift> {
  const summary = await shiftSummary(shift)
  const now = Date.now()
  const user = session().user
  const closed: ShiftRecord = {
    ...shift,
    status: 'closed',
    closedAt: now,
    updatedAt: now,
    countedCash,
    expectedCash: summary.expectedCash,
    difference: countedCash - summary.expectedCash,
    notes: notes ?? shift.notes,
    closedById: user?.id,
    closedByName: user?.name,
  }
  await tx(['shifts'], async () => {
    await db.shifts.put(closed)
    await db.outbox.add({ table: 'shifts', id: closed.id, updatedAt: now })
  })
  session().setShift(null)
  void audit('shift.close', 'shift', shift.id, `${shift.number} diff ${closed.difference}`)
  return closed
}

export async function addCashMovement(type: 'in' | 'out', amount: number, reason: string): Promise<CashMovement> {
  const user = session().user
  if (!user) throw new Error('Not logged in')
  const now = Date.now()
  const m: CashMovement = { id: uuid(), createdAt: now, updatedAt: now, shiftId: session().shift?.id, type, amount, reason, userId: user.id, userName: user.name }
  await tx(['cashMovements'], async () => {
    await db.cashMovements.add(m)
    await db.outbox.add({ table: 'cashMovements', id: m.id, updatedAt: now })
  })
  void audit(`cash.${type}`, 'cashMovement', m.id, `${amount} ${reason}`)
  return m
}

/** Cash movements of a shift, oldest first. */
export async function shiftMovements(shiftId: string): Promise<CashMovement[]> {
  const list = await db.cashMovements.where('shiftId').equals(shiftId).toArray()
  return list.filter((m) => !m.deleted).sort((a, b) => a.createdAt - b.createdAt)
}

/** The last closed shift of this terminal (for "same float as last time" suggestions). */
export async function lastClosedShift(deviceId = device().deviceId): Promise<ShiftRecord | undefined> {
  const list = await db.shifts.where('deviceId').equals(deviceId).toArray()
  return list.filter((s) => s.status === 'closed' && !s.deleted).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))[0]
}

/** Terminal code embedded in the shift number, e.g. SH-T1-000003 → T1. */
export function shiftTerminal(shift: Pick<Shift, 'number' | 'deviceId'>): string {
  const parts = shift.number.split('-')
  const code = parts.length >= 3 ? parts.slice(1, -1).join('-') : ''
  const d = device()
  if (shift.deviceId === d.deviceId) return code && code !== d.terminalName ? `${d.terminalName} (${code})` : d.terminalName
  return code || shift.deviceId.slice(0, 6).toUpperCase()
}
