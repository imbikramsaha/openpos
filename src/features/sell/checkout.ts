import i18n from 'i18next'
import type { CartState, Customer, Payment, Sale } from '@/core/types'
import { calculateCart, loyaltyEarned, refundLines, refundRounding, refundedQuantities, summarizeLines, type CalcResult } from '@/core/cart'
import { db } from '@/db/db'
import { recomputeCustomer } from '@/db/customers'
import { audit, moveStock, nextNumber, tx } from '@/db/repo'
import { currencyDecimals } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { device } from '@/stores/device'
import { session } from '@/stores/session'
import { settings as getSettings, useSettings } from '@/stores/settings'

export function calcCart(cart: CartState): CalcResult {
  const { settings, taxMap } = useSettings.getState()
  return calculateCart(cart.lines, {
    pricesIncludeTax: settings.pricesIncludeTax,
    cashRounding: settings.cashRounding,
    cartDiscountType: cart.discountType,
    cartDiscountValue: cart.discountValue,
    taxes: taxMap,
  })
}

export async function completeSale(cart: CartState, payments: Payment[], customer?: Customer): Promise<Sale> {
  const user = session().user
  if (!user) throw new Error('Not logged in')
  const s = getSettings()
  const calc = calcCart(cart)
  const paid = payments.reduce((a, p) => a + p.amount, 0)
  const cash = payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
  const change = Math.max(0, Math.min(paid - calc.total, cash))
  const pointValue = s.loyaltyPointValue || 1
  const redeemed = Math.round(payments.filter((p) => p.method === 'loyalty').reduce((a, p) => a + p.amount, 0) / pointValue)
  const earnBase = calc.total - payments.filter((p) => p.method === 'loyalty').reduce((a, p) => a + p.amount, 0)
  const earned = s.loyaltyEnabled && customer ? loyaltyEarned(earnBase, currencyDecimals(s.currency), s.loyaltyEarnRate) : 0
  const now = Date.now()

  const sale = await tx(['sales', 'customers'], async () => {
    const doc: Sale = {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      number: await nextNumber('sale', device().terminal),
      type: 'sale',
      status: 'completed',
      userId: user.id,
      userName: user.name,
      customerId: customer?.id,
      customerName: customer?.name,
      customerPhone: customer?.phone,
      customerTaxNumber: customer?.taxNumber,
      shiftId: session().shift?.id,
      deviceId: device().deviceId,
      lines: calc.lines,
      pricesIncludeTax: s.pricesIncludeTax,
      subtotal: calc.subtotal,
      discountTotal: calc.discountTotal,
      cartDiscountType: cart.discountType,
      cartDiscountValue: cart.discountValue,
      netTotal: calc.netTotal,
      taxTotal: calc.taxTotal,
      rounding: calc.rounding,
      total: calc.total,
      payments,
      paid,
      change,
      taxBreakdown: calc.taxBreakdown,
      note: cart.note,
      interState: cart.interState,
      orderType: cart.orderType,
      table: cart.table,
      loyaltyEarned: earned || undefined,
      loyaltyRedeemed: redeemed || undefined,
      currency: s.currency,
    }
    await db.sales.add(doc)
    await db.outbox.add({ table: 'sales', id: doc.id, updatedAt: now })
    for (const l of doc.lines) if (l.productId) await moveStock(l.productId, -l.qty, 'sale', doc.id)
    return doc
  })
  await recomputeCustomer(customer?.id)
  void audit('sale', 'sale', sale.id, `${sale.number} ${sale.total}`)
  return sale
}

/** Creates a refund (credit note) against `original` for the given quantities per line. */
export async function refundSale(original: Sale, qtyByLine: Record<string, number>, payments: Payment[], restock: boolean, reason?: string): Promise<Sale> {
  const user = session().user
  if (!user) throw new Error('Not logged in')
  // Re-read: the sale may have been voided since the caller loaded it.
  const current = await db.sales.get(original.id)
  if (!current || current.deleted || current.type !== 'sale' || current.status !== 'completed') throw new Error(i18n.t('sales:refund.voided'))
  const ctx = await refundContext(original.id)
  const lines = refundLines(original.lines, qtyByLine, ctx.done)
  if (!lines.length) throw new Error('Nothing to refund')
  const sum = summarizeLines(lines)
  const rounding = refundRounding(original, lines, ctx.done, ctx.rounding)
  const total = sum.total + rounding
  // A single tender always pays back exactly the credit-note total.
  if (payments.length === 1) payments = [{ ...payments[0], amount: total }]
  const now = Date.now()
  const s = getSettings()
  // Loyalty earned on the original is reversed in proportion to the refunded value.
  const ratio = original.total ? Math.abs(total / original.total) : 0
  const earnedBack = Math.round((original.loyaltyEarned ?? 0) * ratio)

  const refund = await tx(['sales', 'customers'], async () => {
    const doc: Sale = {
      id: uuid(),
      createdAt: now,
      updatedAt: now,
      number: await nextNumber('refund', device().terminal),
      type: 'refund',
      status: 'completed',
      refundOf: original.id,
      userId: user.id,
      userName: user.name,
      customerId: original.customerId,
      customerName: original.customerName,
      customerPhone: original.customerPhone,
      customerTaxNumber: original.customerTaxNumber,
      shiftId: session().shift?.id,
      deviceId: device().deviceId,
      lines,
      pricesIncludeTax: original.pricesIncludeTax,
      subtotal: sum.subtotal,
      discountTotal: sum.discountTotal,
      netTotal: sum.netTotal,
      taxTotal: sum.taxTotal,
      rounding,
      total,
      payments,
      paid: payments.reduce((a, p) => a + p.amount, 0),
      change: 0,
      taxBreakdown: sum.taxBreakdown,
      note: reason,
      interState: original.interState,
      loyaltyEarned: earnedBack ? -earnedBack : undefined,
      currency: s.currency,
    }
    await db.sales.add(doc)
    await db.outbox.add({ table: 'sales', id: doc.id, updatedAt: now })
    if (restock) for (const l of lines) if (l.productId) await moveStock(l.productId, -l.qty, 'refund', doc.id)
    return doc
  })
  await recomputeCustomer(original.customerId)
  void audit('refund', 'sale', refund.id, `${refund.number} of ${original.number} ${refund.total}`)
  return refund
}

/** Quantity already refunded per line of a sale (derived from its credit notes). */
export async function alreadyRefunded(saleId: string): Promise<Record<string, number>> {
  const refunds = (await db.sales.where('refundOf').equals(saleId).toArray()).filter((r) => !r.deleted)
  return refundedQuantities(refunds)
}

/** Quantities and cash rounding already refunded against a sale. */
export async function refundContext(saleId: string): Promise<{ done: Record<string, number>; rounding: number }> {
  const refunds = (await db.sales.where('refundOf').equals(saleId).toArray()).filter((r) => !r.deleted && r.status === 'completed')
  return { done: refundedQuantities(refunds), rounding: refunds.reduce((a, r) => a + (r.rounding || 0), 0) }
}

/** Voids a sale: marks it voided and returns its stock. Only for same-day corrections. */
export async function voidSale(sale: Sale, reason: string): Promise<void> {
  const now = Date.now()
  await tx(['sales', 'customers'], async () => {
    // Guard against double voids (stock would be returned twice) and voiding refunded sales.
    const current = await db.sales.get(sale.id)
    if (!current || current.type !== 'sale' || current.status !== 'completed') throw new Error(i18n.t('sales:void.notAllowed'))
    if ((await db.sales.where('refundOf').equals(sale.id).toArray()).some((r) => !r.deleted)) throw new Error(i18n.t('sales:void.hasRefunds'))
    await db.sales.update(sale.id, { status: 'voided', voidReason: reason, updatedAt: now })
    await db.outbox.add({ table: 'sales', id: sale.id, updatedAt: now })
    for (const l of sale.lines) if (l.productId) await moveStock(l.productId, l.qty, 'void', sale.id)
  })
  await recomputeCustomer(sale.customerId)
  void audit('void', 'sale', sale.id, `${sale.number}: ${reason}`)
}
