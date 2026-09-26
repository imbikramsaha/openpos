// Report aggregation and cash-register maths on a known dataset (mirrors the manual QA dataset):
// discounts, mixed 0/5/18% GST with cash rounding, split payment, inter-state B2B credit sale,
// a partial refund, a void, a customer cash payment and cash in/out.
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { moveStock, put, tx } from '@/db/repo'
import { recomputeCustomer } from '@/db/customers'
import type { CartLine, CartState, Customer, CustomerPayment, Product, Tax, User } from '@/core/types'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { completeSale, refundSale, voidSale } from '@/features/sell/checkout'
import { loadAggregate } from '@/features/reports/compute'
import { bucketRangeTitle, bucketStarts, customRange, dayCount, granularityFor, presetRange, previousPeriod } from '@/features/reports/range'
import { margin, signedPct } from '@/features/reports/format'
import { addCashMovement, amountError, closeShift, openShift, shiftSummary } from '@/features/shifts/service'
import { uuid } from '@/lib/uuid'

const taxes: Tax[] = [
  { id: 'g0', name: 'GST 0%', rate: 0, createdAt: 0, updatedAt: 0 },
  { id: 'g5', name: 'GST 5%', rate: 5, createdAt: 0, updatedAt: 0 },
  { id: 'g18', name: 'GST 18%', rate: 18, createdAt: 0, updatedAt: 0 },
]
let capp: Product, croissant: Product, samosa: Product, milk: Product, cheese: Product
let ravi: Customer

const line = (p: Product, qty: number, extra: Partial<CartLine> = {}): CartLine => ({ id: uuid(), productId: p.id, name: p.name, unit: 'pcs', qty, price: p.price, cost: p.cost, taxId: p.taxId, ...extra })
const custom = (name: string, price: number, taxId: string): CartLine => ({ id: uuid(), name, unit: 'pcs', qty: 1, price, cost: 0, taxId })
const pay = (method: 'cash' | 'upi' | 'card' | 'credit', amount: number) => ({ id: uuid(), method, amount })

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  useSettings.getState().setTaxes(taxes)
  useSettings.getState().setSettings({ ...defaultSettings(), gstMode: true, pricesIncludeTax: true, cashRounding: 100 })
  const user: User = { id: 'u1', name: 'Owner', role: 'admin', pinHash: '', pinSalt: '', active: true, createdAt: 0, updatedAt: 0 }
  useSession.getState().login(user)
  useSession.getState().setShift(null)
  const mk = (name: string, price: number, cost: number) => put<Product>('products', { name, price, cost, taxId: 'g18', unit: 'pcs', trackStock: true, stock: 0, active: true })
  capp = await mk('Cappuccino', 13000, 8060)
  croissant = await mk('Croissant', 10000, 6200)
  samosa = await mk('Samosa', 2400, 1488)
  milk = await mk('Milk 1L', 5600, 3472)
  cheese = await mk('Cheese Slices', 10500, 6510)
  await tx(['products', 'stockMovements'], async () => {
    for (const p of [capp, croissant, samosa, milk, cheese]) await moveStock(p.id, 50, 'initial')
  })
  ravi = await put<Customer>('customers', { name: 'Ravi Traders', taxNumber: '27AAPFU0939F1ZV', loyaltyPoints: 0, balance: 0 })
})

async function dataset() {
  await openShift(50000)
  const s1 = await completeSale({ lines: [line(capp, 2)] }, [pay('cash', 26000)])
  const s2cart: CartState = { lines: [line(croissant, 3, { discountType: 'percent', discountValue: 10 })], discountType: 'amount', discountValue: 10500 }
  const s2 = await completeSale(s2cart, [pay('cash', 50000)])
  const s3 = await completeSale({ lines: [custom('Veg Box', 9999, 'g0'), custom('Spice Mix', 4550, 'g5'), line(samosa, 1)] }, [pay('upi', 10000), pay('card', 6900)])
  const s4 = await completeSale({ lines: [line(milk, 2)], interState: true }, [pay('credit', 11200)], ravi)
  const s5 = await completeSale({ lines: [line(cheese, 1)] }, [pay('cash', 10500)])
  await voidSale(s5, 'Wrong items')
  const r1 = await refundSale(s1, { [s1.lines[0].id]: 1 }, [pay('cash', -13000)], true)
  await put<CustomerPayment>('customerPayments', { customerId: ravi.id, amount: 5000, method: 'cash', userId: 'u1', shiftId: useSession.getState().shift!.id })
  await recomputeCustomer(ravi.id)
  await addCashMovement('in', 10000, '')
  await addCashMovement('out', 3050, 'Milk supplier')
  return { s1, s2, s3, s4, s5, r1 }
}

describe('report aggregation', () => {
  it('matches the hand-computed totals', async () => {
    const { s2, s3 } = await dataset()
    expect(s2.total).toBe(16500)
    expect(s2.change).toBe(33500)
    expect(s3.rounding).toBe(-49)
    const r = presetRange('today', 'en-IN')
    const agg = await loadAggregate(r.from, r.to, { starts: bucketStarts(r.from, r.to, 'hour') })
    const T = agg.totals
    expect(T).toMatchObject({ sales: 4, refundsCount: 1, voids: 1, voidsAmount: 10500, salesTotal: 70600, refunds: -13000, discounts: 13500, net: 50858, tax: 6791, total: 57600, rounding: -49, cost: 35092, profit: 15766, customers: 1, walkIn: 3 })
    expect(agg.buckets.reduce((a, b) => a + b.salesTotal, 0)).toBe(70600)

    const m = Object.fromEntries([...agg.methods.values()].map((x) => [x.method, x]))
    expect(m.cash).toMatchObject({ count: 2, sales: 42500, refunds: -13000, net: 29500 })
    expect(m.upi.net).toBe(10000)
    expect(m.card.net).toBe(6900)
    expect(m.credit.net).toBe(11200)

    const rates = Object.fromEntries([...agg.rates.values()].map((x) => [x.rate, x]))
    expect(rates[0]).toMatchObject({ taxable: 9999, tax: 0 })
    expect(rates[5]).toMatchObject({ taxable: 4333, tax: 217, cgst: 108, sgst: 109, igst: 0 })
    expect(rates[18]).toMatchObject({ taxable: 36526, tax: 6574, cgst: 2433, sgst: 2433, igst: 1708 })
    const all = [...agg.rates.values()]
    expect(all.reduce((a, x) => a + x.cgst + x.sgst + x.igst, 0)).toBe(T.tax)

    expect(agg.b2b).toEqual({ count: 1, taxable: 9492, tax: 1708, total: 11200 })
    expect(agg.b2c).toEqual({ count: 3, taxable: 41366, tax: 5083, total: 46400 })
    expect(agg.creditNotes).toHaveLength(1)

    // Rows without an HSN code are grouped per rate; the description says how many products are in it.
    const hsn18 = [...agg.hsn.values()].find((h) => h.rate === 18)!
    expect(hsn18.qty).toBe(7)
    expect(hsn18.others).toBe(3)

    const staff = [...agg.staff.values()][0]
    expect(staff).toMatchObject({ count: 4, net: 50858, total: 57600, refundsCount: 1, refunds: -13000, discounts: 13500, voids: 1, voidsAmount: 10500 })
    expect(agg.products.get(capp.id)).toMatchObject({ qty: 1, net: 11017, cost: 8060, profit: 2957 })
  })

  it('ignores deleted documents and filters by terminal', async () => {
    const { s1 } = await dataset()
    await db.sales.update(s1.id, { deleted: true })
    const r = presetRange('today', 'en-IN')
    const agg = await loadAggregate(r.from, r.to, { starts: [] })
    expect(agg.totals.sales).toBe(3)
    const other = await loadAggregate(r.from, r.to, { starts: [], deviceId: 'another-till' })
    expect(other.totals.sales).toBe(0)
    expect(other.allTerminals.size).toBe(1)
  })
})

describe('cash register', () => {
  it('expected cash = float + cash sales − change − cash refunds + customer cash + cash in − cash out', async () => {
    await dataset()
    const shift = useSession.getState().shift!
    const sum = await shiftSummary(shift)
    expect(sum).toMatchObject({ openingFloat: 50000, salesCount: 4, refundsCount: 1, grossSales: 70600, refunds: -13000, netSales: 57600, discounts: 13500, tax: 6791, cashSales: 29500, cashIn: 10000, cashOut: 3050, customerPaymentsCash: 5000, expectedCash: 91450, voids: 1, voidsAmount: 10500, rounding: -49 })
    expect(sum.byMethod).toEqual({ cash: 29500, upi: 10000, card: 6900, credit: 11200 })
    expect(sum.countByMethod).toEqual({ cash: 2, upi: 1, card: 1, credit: 1 })

    const closed = await closeShift(shift, 90000)
    expect(closed).toMatchObject({ status: 'closed', expectedCash: 91450, countedCash: 90000, difference: -1450 })
    expect(useSession.getState().shift).toBeNull()
    // A stale copy can't close the shift a second time.
    await expect(closeShift(shift, 91450)).rejects.toThrow()
    expect((await db.shifts.get(shift.id))!.countedCash).toBe(90000)
  })

  it('rejects impossible amounts', async () => {
    expect(amountError(-1)).toBe('amountNegative')
    expect(amountError(1e22)).toBe('amountTooLarge')
    expect(amountError(0)).toBeUndefined()
    await expect(openShift(-50000)).rejects.toThrow()
    await expect(addCashMovement('in', 1000, 'no shift')).rejects.toThrow()
    const shift = await openShift(0)
    await expect(addCashMovement('out', -500, '')).rejects.toThrow()
    await expect(closeShift(shift, -1)).rejects.toThrow()
    expect(await db.cashMovements.count()).toBe(0)
  })
})

describe('date ranges', () => {
  // Wednesday 2026-09-16 14:30 local time.
  const now = new Date(2026, 8, 16, 14, 30).getTime()
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime()

  it('builds presets and their comparison periods', () => {
    expect(presetRange('yesterday', 'en', now)).toMatchObject({ from: d(2026, 9, 15), to: d(2026, 9, 16) - 1 })
    expect(presetRange('thisWeek', 'en-IN', now).from).toBe(d(2026, 9, 13)) // Sunday-first locale
    expect(presetRange('thisWeek', 'de-DE', now).from).toBe(d(2026, 9, 14)) // Monday-first locale
    expect(presetRange('last7Days', 'en', now).from).toBe(d(2026, 9, 10))
    const lm = presetRange('lastMonth', 'en', now)
    expect(lm).toMatchObject({ from: d(2026, 8, 1), to: d(2026, 9, 1) - 1 })
    expect(previousPeriod(lm, now)).toMatchObject({ from: d(2026, 7, 1), to: d(2026, 8, 1) - 1 })
    const tm = presetRange('thisMonth', 'en', now)
    const pp = previousPeriod(tm, now)
    expect(pp.from).toBe(d(2026, 8, 1))
    expect(pp.cutoff).toBe(d(2026, 8, 16) + 14.5 * 3_600_000)
    // March 31 compares with the whole of February, not with March 3.
    const mar = presetRange('thisMonth', 'en', new Date(2026, 2, 31, 12).getTime())
    expect(previousPeriod(mar, new Date(2026, 2, 31, 12).getTime()).to).toBe(d(2026, 3, 1) - 1)
  })

  it('handles swapped custom ranges and picks buckets', () => {
    const r = customRange(d(2026, 3, 10), d(2026, 3, 1))
    expect(r.from).toBe(d(2026, 3, 1))
    expect(dayCount(r.from, r.to)).toBe(10)
    expect(granularityFor(d(2026, 1, 1), d(2026, 1, 1) + 1000)).toBe('hour')
    expect(granularityFor(d(2025, 9, 28), d(2026, 9, 27))).toBe('month')
    const from = d(2025, 9, 28)
    const to = d(2026, 9, 28) - 1
    const starts = bucketStarts(from, to, 'month')
    expect(starts).toHaveLength(13)
    // The first month is only partly in range: its title must not claim the whole month.
    expect(bucketRangeTitle(starts, 0, 'month', from, to)).not.toBe(bucketRangeTitle(starts, 1, 'month', from, to).replace('October', 'September'))
    expect(bucketRangeTitle(starts, 0, 'month', from, to)).toContain('28')
  })

  it('formats margins and changes', () => {
    expect(margin(40, 100)).toBe(40)
    expect(margin(-40, -100)).toBe(-40)
    expect(margin(5, 0)).toBe(0)
    expect(signedPct(12.34)).toBe('+12.3%')
    expect(signedPct(-3)).toBe('−3%')
  })
})
