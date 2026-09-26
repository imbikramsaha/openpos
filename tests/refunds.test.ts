import { beforeEach, describe, expect, it } from 'vitest'
import { calculateCart, refundLines, refundRounding, refundedQuantities, summarizeLines } from '@/core/cart'
import type { CartLine, CartState, Customer, Product, Tax, User } from '@/core/types'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { moveStock, put, tx } from '@/db/repo'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { completeSale, refundSale, voidSale } from '@/features/sell/checkout'
import { buildLedger } from '@/features/customers/ledger'
import { uuid } from '@/lib/uuid'

const gst: Tax = { id: 'gst18', name: 'GST 18%', rate: 18, createdAt: 0, updatedAt: 0 }
const line = (id: string, price: number, qty: number): CartLine => ({ id, name: id, unit: 'pcs', qty, price, cost: 0, taxId: 'gst18' })

describe('refund maths', () => {
  it('adds up to exactly the line total when a line is refunded in parts', () => {
    // 3 × 100.00 with a 1.00 cart discount = 299.00, which doesn't split evenly in three.
    const sale = calculateCart([line('a', 10000, 3)], { pricesIncludeTax: true, cashRounding: 0, cartDiscountType: 'amount', cartDiscountValue: 100, taxes: new Map([[gst.id, gst]]) })
    const refunds: Array<{ status: string; lines: ReturnType<typeof refundLines> }> = []
    for (let i = 0; i < 3; i++) refunds.push({ status: 'completed', lines: refundLines(sale.lines, { a: 1 }, refundedQuantities(refunds)) })
    const sum = (k: 'total' | 'tax' | 'discount') => refunds.reduce((a, r) => a + r.lines[0][k], 0)
    expect(sum('total')).toBe(-sale.lines[0].total)
    expect(sum('tax')).toBe(-sale.lines[0].tax)
    expect(sum('discount')).toBe(-sale.lines[0].discount)
  })

  it('gives the invoice rounding back only with the refund that completes the sale', () => {
    const sale = { ...calculateCart([line('a', 7920, 2)], { pricesIncludeTax: true, cashRounding: 100, taxes: new Map([[gst.id, gst]]) }) }
    expect(sale.rounding).toBe(-40)
    const first = refundLines(sale.lines, { a: 1 })
    expect(refundRounding(sale, first, {})).toBe(0)
    const last = refundLines(sale.lines, { a: 1 }, { a: 1 })
    expect(refundRounding(sale, last, { a: 1 })).toBe(40)
    expect(summarizeLines(first).total + summarizeLines(last).total + refundRounding(sale, last, { a: 1 })).toBe(-sale.total)
  })
})

describe('refunds and voids against the database', () => {
  let product: Product
  let customer: Customer

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    useSettings.getState().setTaxes([gst])
    useSettings.getState().setSettings({ ...defaultSettings(), cashRounding: 100 })
    const user: User = { id: 'u1', name: 'Asha', role: 'admin', pinHash: '', pinSalt: '', active: true, createdAt: 0, updatedAt: 0 }
    useSession.getState().login(user)
    product = await put<Product>('products', { name: 'Bags', price: 8800, cost: 5000, taxId: 'gst18', unit: 'pcs', trackStock: true, stock: 0, active: true })
    await tx(['products', 'stockMovements'], () => moveStock(product.id, 10, 'initial'))
    customer = await put<Customer>('customers', { name: 'Ravi', loyaltyPoints: 0, balance: 0 })
  })

  const cart = (qty: number): CartState => ({ lines: [{ id: uuid(), productId: product.id, name: 'Bags', unit: 'pcs', qty, price: 8800, cost: 5000, taxId: 'gst18' }], discountType: 'percent', discountValue: 10 })

  it('refunding a rounded credit sale in full clears the customer balance exactly', async () => {
    const sale = await completeSale(cart(1), [{ id: 'p', method: 'credit', amount: 7900 }], customer)
    expect(sale.rounding).toBe(-20)
    expect((await db.customers.get(customer.id))!.balance).toBe(7900)
    // A stale or wrong amount from the caller is corrected to the credit-note total.
    const refund = await refundSale(sale, { [sale.lines[0].id]: 1 }, [{ id: 'r', method: 'credit', amount: -1 }], true)
    expect(refund.total).toBe(-7900)
    expect(refund.rounding).toBe(20)
    expect(refund.payments[0].amount).toBe(-7900)
    const c = (await db.customers.get(customer.id))!
    expect(c.balance).toBe(0)
    const ledger = buildLedger(await db.sales.toArray(), [])
    expect(ledger.at(-1)!.balance).toBe(0)
    expect((await db.products.get(product.id))!.stock).toBe(10)
  })

  it('blocks double voids, voiding refunded sales and refunding voided sales', async () => {
    const a = await completeSale(cart(1), [{ id: 'p', method: 'cash', amount: 7900 }])
    await voidSale(a, 'mistake')
    await expect(voidSale(a, 'again')).rejects.toThrow()
    await expect(refundSale(a, { [a.lines[0].id]: 1 }, [], true)).rejects.toThrow()
    // Stock came back exactly once.
    expect((await db.products.get(product.id))!.stock).toBe(10)

    const b = await completeSale(cart(2), [{ id: 'p', method: 'cash', amount: 15800 }])
    await refundSale(b, { [b.lines[0].id]: 1 }, [{ id: 'r', method: 'cash', amount: 0 }], true)
    await expect(voidSale(b, 'x')).rejects.toThrow()
    expect((await db.sales.get(b.id))!.status).toBe('completed')
  })
})
