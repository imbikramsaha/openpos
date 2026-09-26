import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { moveStock, put, rebuildStock, tx } from '@/db/repo'
import { recomputeCustomer } from '@/db/customers'
import type { CartState, Customer, CustomerPayment, Product, Tax, User } from '@/core/types'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { alreadyRefunded, completeSale, refundSale, voidSale } from '@/features/sell/checkout'
import { uuid } from '@/lib/uuid'

let product: Product
let customer: Customer

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  const gst: Tax = { id: 'gst18', name: 'GST 18%', rate: 18, createdAt: 0, updatedAt: 0 }
  useSettings.getState().setTaxes([gst])
  useSettings.getState().setSettings({ ...defaultSettings(), loyaltyEnabled: true, loyaltyEarnRate: 0.1, loyaltyPointValue: 100 })
  const user: User = { id: 'u1', name: 'Asha', role: 'admin', pinHash: '', pinSalt: '', active: true, createdAt: 0, updatedAt: 0 }
  useSession.getState().login(user)
  product = await put<Product>('products', { name: 'Chai', price: 2000, cost: 800, taxId: 'gst18', unit: 'pcs', trackStock: true, stock: 0, active: true })
  await tx(['products', 'stockMovements'], () => moveStock(product.id, 10, 'initial'))
  customer = await put<Customer>('customers', { name: 'Ravi', phone: '98765', loyaltyPoints: 0, balance: 0 })
})

const cartOf = (qty: number, extra: Partial<CartState> = {}): CartState => ({
  lines: [{ id: uuid(), productId: product.id, name: 'Chai', unit: 'pcs', qty, price: 2000, cost: 800, taxId: 'gst18' }],
  ...extra,
})

describe('checkout', () => {
  it('records a sale, deducts stock and numbers per terminal', async () => {
    const sale = await completeSale(cartOf(3), [{ id: 'p1', method: 'cash', amount: 10000 }])
    expect(sale.total).toBe(6000)
    expect(sale.change).toBe(4000)
    expect(sale.taxTotal).toBe(915)
    expect(sale.number).toMatch(/^INV-[A-Z0-9]+-000001$/)
    expect((await db.products.get(product.id))!.stock).toBe(7)
    const second = await completeSale(cartOf(1), [{ id: 'p2', method: 'card', amount: 2000 }])
    expect(second.number.endsWith('000002')).toBe(true)
    // Every write is queued for sync.
    const queued = await db.outbox.toArray()
    expect(queued.some((o) => o.table === 'sales' && o.id === sale.id)).toBe(true)
    expect(queued.filter((o) => o.table === 'stockMovements')).toHaveLength(3)
  })

  it('tracks credit (khata) balances and loyalty points from the ledgers', async () => {
    await completeSale(cartOf(5), [{ id: 'p1', method: 'credit', amount: 10000 }], customer)
    let c = (await db.customers.get(customer.id))!
    expect(c.balance).toBe(10000)
    expect(c.loyaltyPoints).toBe(10)
    await put<CustomerPayment>('customerPayments', { customerId: customer.id, amount: 4000, method: 'cash', userId: 'u1' })
    await recomputeCustomer(customer.id)
    c = (await db.customers.get(customer.id))!
    expect(c.balance).toBe(6000)
  })

  it('refunds partially, restocks, and blocks refunding more than sold', async () => {
    const sale = await completeSale(cartOf(4), [{ id: 'p1', method: 'cash', amount: 8000 }], customer)
    const lineId = sale.lines[0].id
    const refund = await refundSale(sale, { [lineId]: 1 }, [{ id: 'r1', method: 'cash', amount: -2000 }], true, 'damaged box')
    expect(refund.type).toBe('refund')
    expect(refund.number).toMatch(/^CRN-/)
    expect(refund.total).toBe(-2000)
    expect(refund.lines[0].refLineId).toBe(lineId)
    expect((await db.products.get(product.id))!.stock).toBe(7)
    expect(await alreadyRefunded(sale.id)).toEqual({ [lineId]: 1 })
    await refundSale(sale, { [lineId]: 10 }, [{ id: 'r2', method: 'cash', amount: -6000 }], false)
    expect(await alreadyRefunded(sale.id)).toEqual({ [lineId]: 4 })
    await expect(refundSale(sale, { [lineId]: 1 }, [], false)).rejects.toThrow()
    // Loyalty earned on the sale is reversed with the refunds.
    expect((await db.customers.get(customer.id))!.loyaltyPoints).toBe(0)
  })

  it('voids a sale and returns its stock', async () => {
    const sale = await completeSale(cartOf(2), [{ id: 'p1', method: 'credit', amount: 4000 }], customer)
    expect((await db.customers.get(customer.id))!.balance).toBe(4000)
    await voidSale(sale, 'wrong item')
    expect((await db.sales.get(sale.id))!.status).toBe('voided')
    expect((await db.products.get(product.id))!.stock).toBe(10)
    expect((await db.customers.get(customer.id))!.balance).toBe(0)
  })

  it('rebuildStock recomputes cached stock from the ledger', async () => {
    await completeSale(cartOf(3), [{ id: 'p1', method: 'cash', amount: 6000 }])
    await db.products.update(product.id, { stock: 999 })
    await rebuildStock()
    expect((await db.products.get(product.id))!.stock).toBe(7)
  })
})

describe('refunds of sales paid with loyalty points', () => {
  it('returns spent points as points and only the rest as money', async () => {
    // Customer earns 10 points on a first sale (loyaltyEarnRate 0.1 per rupee).
    await completeSale(cartOf(5), [{ id: 'p0', method: 'cash', amount: 10000 }], customer)
    expect((await db.customers.get(customer.id))!.loyaltyPoints).toBe(10)
    // Second sale: ₹20 paid with 5 points (₹1 each = 100 minor) → ₹5 in points + ₹15 cash.
    const c = (await db.customers.get(customer.id))!
    const sale = await completeSale(cartOf(1), [{ id: 'l', method: 'loyalty', amount: 500 }, { id: 'c', method: 'cash', amount: 1500 }], c)
    expect(sale.loyaltyRedeemed).toBe(5)
    const refund = await refundSale(sale, { [sale.lines[0].id]: 1 }, [{ id: 'r', method: 'cash', amount: -2000 }], true)
    expect(refund.loyaltyRedeemed).toBe(-5)
    expect(refund.payments.find((p) => p.method === 'cash')!.amount).toBe(-1500)
    expect(refund.payments.find((p) => p.method === 'loyalty')!.amount).toBe(-500)
    // Points spent come back; points earned on the refunded sale are reversed.
    const after = (await db.customers.get(customer.id))!
    expect(after.loyaltyPoints).toBe(10 - 5 + 5 + (sale.loyaltyEarned ?? 0) - (sale.loyaltyEarned ?? 0))
  })

  it('refuses to void a sale from a different (closed) shift', async () => {
    const sale = await completeSale(cartOf(1), [{ id: 'p', method: 'cash', amount: 2000 }])
    await db.sales.update(sale.id, { shiftId: 'old-shift' })
    await expect(voidSale({ ...sale, shiftId: 'old-shift' }, 'oops')).rejects.toThrow()
    expect((await db.sales.get(sale.id))!.status).toBe('completed')
  })
})
