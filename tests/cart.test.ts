import { describe, expect, it } from 'vitest'
import {
  calculateCart, computeChange, discountAmount, distribute, gstSplit, loyaltyEarned, quickCashSuggestions,
  refundLines, refundedQuantities, roundTo, summarizeLines,
} from '@/core/cart'
import type { CartLine, Tax } from '@/core/types'

const tax = (id: string, rate: number): Tax => ({ id, name: `GST ${rate}%`, rate, createdAt: 0, updatedAt: 0 })
const taxes = new Map([['t0', tax('t0', 0)], ['t5', tax('t5', 5)], ['t18', tax('t18', 18)]])
const line = (id: string, price: number, qty: number, taxId = 't18', extra: Partial<CartLine> = {}): CartLine => ({ id, name: id, unit: 'pcs', qty, price, cost: 0, taxId, ...extra })

describe('distribute', () => {
  it('splits exactly with largest remainder', () => {
    expect(distribute(100, [1, 1, 1])).toEqual([34, 33, 33])
    expect(distribute(100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(100)
    expect(distribute(-10, [1, 2])).toEqual([-3, -7])
    expect(distribute(0, [1, 2])).toEqual([0, 0])
    expect(distribute(5, [0, 0])).toEqual([0, 0])
  })
})

describe('discountAmount', () => {
  it('handles percent and amount, clamped and sign-preserving', () => {
    expect(discountAmount(1000, 'percent', 10)).toBe(100)
    expect(discountAmount(1000, 'percent', 150)).toBe(1000)
    expect(discountAmount(1000, 'amount', 250)).toBe(250)
    expect(discountAmount(1000, 'amount', 5000)).toBe(1000)
    expect(discountAmount(-1000, 'percent', 10)).toBe(-100)
    expect(discountAmount(1000)).toBe(0)
  })
})

describe('calculateCart — tax inclusive (India retail)', () => {
  it('extracts tax from inclusive prices', () => {
    const r = calculateCart([line('a', 11800, 1)], { pricesIncludeTax: true, cashRounding: 0, taxes })
    expect(r.total).toBe(11800)
    expect(r.netTotal).toBe(10000)
    expect(r.taxTotal).toBe(1800)
    expect(r.taxBreakdown).toEqual([{ taxId: 't18', name: 'GST 18%', rate: 18, taxable: 10000, tax: 1800 }])
  })

  it('matches the sell-screen smoke scenario (₹260 + ₹100 at 18%)', () => {
    const r = calculateCart([line('cap', 13000, 2), line('cro', 10000, 1)], { pricesIncludeTax: true, cashRounding: 100, taxes })
    expect(r.total).toBe(36000)
    expect(r.taxTotal).toBe(5491)
    const gst = gstSplit(r.taxBreakdown, false)
    expect(gst.map((g) => [g.label, g.rate, g.tax])).toEqual([['CGST', 9, 2745], ['SGST', 9, 2746]])
  })

  it('rounds the grand total to the cash step and reports the difference', () => {
    const r = calculateCart([line('a', 9950, 1)], { pricesIncludeTax: true, cashRounding: 100, taxes })
    expect(r.totalBeforeRounding).toBe(9950)
    expect(r.total).toBe(10000)
    expect(r.rounding).toBe(50)
  })

  it('distributes a cart discount across lines and keeps totals exact', () => {
    const r = calculateCart([line('a', 1000, 1), line('b', 2000, 1), line('c', 3000, 1, 't5')], {
      pricesIncludeTax: true, cashRounding: 0, taxes, cartDiscountType: 'percent', cartDiscountValue: 10,
    })
    expect(r.cartDiscount).toBe(600)
    expect(r.lines.map((l) => l.discount)).toEqual([100, 200, 300])
    expect(r.total).toBe(5400)
    expect(r.lines.reduce((a, l) => a + l.net + l.tax, 0)).toBe(r.total)
  })

  it('applies line discounts before the cart discount', () => {
    const r = calculateCart([line('a', 1000, 2, 't0', { discountType: 'amount', discountValue: 200 })], {
      pricesIncludeTax: true, cashRounding: 0, taxes, cartDiscountType: 'amount', cartDiscountValue: 300,
    })
    expect(r.subtotal).toBe(2000)
    expect(r.lineDiscountTotal).toBe(200)
    expect(r.cartDiscount).toBe(300)
    expect(r.total).toBe(1500)
  })
})

describe('calculateCart — tax exclusive (US sales tax)', () => {
  it('adds tax on top of prices', () => {
    const r = calculateCart([line('a', 1999, 3, 't5')], { pricesIncludeTax: false, cashRounding: 0, taxes })
    expect(r.netTotal).toBe(5997)
    expect(r.taxTotal).toBe(300)
    expect(r.total).toBe(6297)
  })
})

describe('calculateCart — weighed items and returns', () => {
  it('multiplies fractional quantities', () => {
    const r = calculateCart([line('banana', 4800, 1.235, 't0', { unit: 'kg' })], { pricesIncludeTax: true, cashRounding: 0, taxes })
    expect(r.total).toBe(5928)
  })

  it('handles negative (return) lines and skips cart discounts on refund-only carts', () => {
    const r = calculateCart([line('a', 11800, -1)], { pricesIncludeTax: true, cashRounding: 0, taxes, cartDiscountType: 'percent', cartDiscountValue: 10 })
    expect(r.cartDiscount).toBe(0)
    expect(r.total).toBe(-11800)
    expect(r.taxTotal).toBe(-1800)
  })

  it('an empty cart is all zeros', () => {
    const r = calculateCart([], { pricesIncludeTax: true, cashRounding: 100, taxes })
    expect(r.total).toBe(0)
    expect(r.taxBreakdown).toEqual([])
  })
})

describe('gstSplit', () => {
  it('uses IGST for inter-state supplies', () => {
    expect(gstSplit([{ name: 'GST 18%', rate: 18, taxable: 10000, tax: 1800 }], true)).toEqual([{ label: 'IGST', rate: 18, taxable: 10000, tax: 1800 }])
  })
  it('puts the odd paisa on SGST so halves always sum to the tax', () => {
    const rows = gstSplit([{ name: 'GST 5%', rate: 5, taxable: 1001, tax: 51 }], false)
    expect(rows[0].tax + rows[1].tax).toBe(51)
  })
})

describe('payments', () => {
  it('computes change from cash only', () => {
    expect(computeChange(36000, [{ method: 'cash', amount: 50000 }])).toEqual({ paid: 50000, change: 14000, due: 0 })
    expect(computeChange(36000, [{ method: 'card', amount: 20000 }, { method: 'cash', amount: 20000 }])).toEqual({ paid: 40000, change: 4000, due: 0 })
    expect(computeChange(36000, [{ method: 'card', amount: 10000 }])).toEqual({ paid: 10000, change: 0, due: 26000 })
  })

  it('suggests sensible quick-cash notes', () => {
    expect(quickCashSuggestions(43700, [1000, 2000, 5000, 10000, 20000, 50000])).toEqual([43700, 44000, 45000, 50000, 60000])
    expect(quickCashSuggestions(0, [100])).toEqual([])
  })

  it('rounds to arbitrary steps', () => {
    expect(roundTo(1234, 5)).toBe(1235)
    expect(roundTo(1232, 5)).toBe(1230)
    expect(roundTo(1234, 0)).toBe(1234)
  })

  it('earns loyalty points on major units', () => {
    expect(loyaltyEarned(123456, 2, 0.01)).toBe(12)
    expect(loyaltyEarned(-500, 2, 1)).toBe(0)
  })
})

describe('refunds', () => {
  const sale = calculateCart([line('a', 11800, 3), line('b', 5000, 1, 't0')], { pricesIncludeTax: true, cashRounding: 0, taxes })

  it('reverses lines proportionally with negative amounts', () => {
    const r = refundLines(sale.lines, { a: 1 })
    expect(r).toHaveLength(1)
    expect(r[0].qty).toBe(-1)
    expect(r[0].total).toBe(-11800)
    expect(r[0].tax).toBe(-1800)
    expect(r[0].refLineId).toBe('a')
    const s = summarizeLines(r)
    expect(s.total).toBe(-11800)
  })

  it('never refunds more than was sold, counting earlier credit notes', () => {
    const first = refundLines(sale.lines, { a: 2 })
    const done = refundedQuantities([{ status: 'completed', lines: first }])
    expect(done).toEqual({ a: 2 })
    const second = refundLines(sale.lines, { a: 5, b: 1 }, done)
    expect(second.find((l) => l.refLineId === 'a')?.qty).toBe(-1)
    expect(second.find((l) => l.refLineId === 'b')?.qty).toBe(-1)
    expect(refundLines(sale.lines, { a: 1 }, { a: 3 })).toEqual([])
  })
})
