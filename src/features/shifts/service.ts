import type { CashMovement, Shift } from '@/core/types'
import { db } from '@/db/db'
import { audit, nextNumber, tx } from '@/db/repo'
import { uuid } from '@/lib/uuid'
import { device } from '@/stores/device'
import { session } from '@/stores/session'

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
  grossSales: number
  refunds: number
  discounts: number
  tax: number
  netSales: number
  byMethod: Record<string, number>
  cashSales: number
  cashIn: number
  cashOut: number
  customerPaymentsCash: number
  expectedCash: number
  voids: number
}

/** Totals for a shift. Expected cash = float + net cash taken − change + cash in − cash out. */
export async function shiftSummary(shift: Shift): Promise<ShiftSummary> {
  const sales = (await db.sales.where('shiftId').equals(shift.id).toArray()).filter((s) => !s.deleted)
  const moves = (await db.cashMovements.where('shiftId').equals(shift.id).toArray()).filter((m) => !m.deleted)
  const custPays = (await db.customerPayments.where('shiftId').equals(shift.id).toArray()).filter((p) => !p.deleted)
  const done = sales.filter((s) => s.status === 'completed')
  const byMethod: Record<string, number> = {}
  let cashSales = 0
  for (const s of done) {
    for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount
    const cash = s.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
    cashSales += cash - s.change
  }
  if (byMethod.cash !== undefined) byMethod.cash = cashSales
  const cashIn = moves.filter((m) => m.type === 'in').reduce((a, m) => a + m.amount, 0)
  const cashOut = moves.filter((m) => m.type === 'out').reduce((a, m) => a + m.amount, 0)
  const customerPaymentsCash = custPays.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
  const salesOnly = done.filter((s) => s.type === 'sale')
  const refundsOnly = done.filter((s) => s.type === 'refund')
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
    voids: sales.filter((s) => s.status === 'voided').length,
  }
}

export async function closeShift(shift: Shift, countedCash: number, notes?: string): Promise<Shift> {
  const summary = await shiftSummary(shift)
  const now = Date.now()
  const closed: Shift = {
    ...shift,
    status: 'closed',
    closedAt: now,
    updatedAt: now,
    countedCash,
    expectedCash: summary.expectedCash,
    difference: countedCash - summary.expectedCash,
    notes: notes ?? shift.notes,
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
