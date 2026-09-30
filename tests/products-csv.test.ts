import { describe, expect, it } from 'vitest'
import type { Product, Tax } from '@/core/types'
import { planImport, productsToCsv } from '@/features/products/csv'

const tax = (id: string, rate: number): Tax => ({ id, name: `T${rate}`, rate, createdAt: 0, updatedAt: 0 }) as Tax
const product = (p: Partial<Product>): Product =>
  ({ id: 'p1', name: 'Tea', price: 1000, cost: 500, unit: 'pcs', stock: 0, trackStock: true, active: true, createdAt: 0, updatedAt: 0, ...p }) as Product

const ctx = (extra: Partial<Parameters<typeof planImport>[1]> = {}) => ({ products: [], categories: [], taxes: [tax('gst18', 18), tax('igst18', 18)], defaultTaxId: 'gst18', ...extra })
const issues = (text: string, c = ctx()) => planImport(text, c).rows.map((r) => [...r.errors, ...r.warnings].map((i) => i.key))

describe('product CSV import', () => {
  it('keeps the sign of typographic and accounting negatives', () => {
    expect(issues('name,price\nA,−5\nB,(2.50)\n')).toEqual([['negative'], ['negative']])
  })

  it('rejects barcodes mangled into scientific notation by spreadsheets', () => {
    expect(issues('name,barcode,price\nA,8.90123E+12,1\n')[0]).toContain('barcodeScientific')
  })

  it('rejects absurdly large amounts', () => {
    expect(issues('name,price\nA,1e20\n')[0]).toContain('tooLarge')
  })

  it('reads currency-decorated amounts but not garbage', () => {
    const plan = planImport('name,price,cost,mrp\nA,"₹ 1,250.00",Rs. 40,12abc34\n', ctx())
    expect(plan.rows[0].price).toBe(125000)
    expect(plan.rows[0].cost).toBe(4000)
    expect(plan.rows[0].errors.map((e) => e.key)).toEqual(['invalidNumber'])
  })

  it('flags duplicate SKUs among new rows even when barcodes differ', () => {
    expect(issues('name,sku,barcode,price\nA,S1,111,1\nB,S1,222,1\n')[1]).toContain('duplicateSku')
  })

  it('warns when a new product has no price', () => {
    expect(issues('name\nA\n')[0]).toEqual(['noPrice'])
  })

  it("keeps a product's own tax when several taxes share the exported rate", () => {
    const plan = planImport('barcode,tax_rate\n123,18\n', ctx({ products: [product({ barcode: '123', taxId: 'igst18' })] }))
    expect(plan.rows[0].taxId).toBe('igst18')
  })

  it('matches rows without a SKU or barcode by name instead of adding copies', () => {
    const c = ctx({ products: [product({ id: 'p1', name: 'Crème Brûlée', sku: 'D-1' })] })
    const plan = planImport('name,price\ncrème  brûlée,150\nNew thing,5\n', c)
    expect(plan.rows.map((r) => [r.status, r.match?.id])).toEqual([['update', 'p1'], ['new', undefined]])
    // Two products with that name: the row can't say which one.
    const two = ctx({ products: [product({ id: 'a', name: 'Tea' }), product({ id: 'b', name: 'Tea' })] })
    expect(issues('name,price\nTea,1\n', two)[0]).toContain('ambiguousName')
    // A new code with an existing name is a new product, with a warning.
    expect(issues('name,sku,price\nTea,NEW-1,1\n', ctx({ products: [product({ name: 'Tea' })] }))[0]).toContain('sameName')
  })

  it('applies the editor length limits and refuses a file with an unclosed quote', () => {
    expect(issues(`name,price\n${'x'.repeat(121)},1\n`)[0]).toContain('tooLong')
    const plan = planImport('name,price\n"unterminated,5\nB,6\n', ctx())
    expect(plan.fatal).toEqual({ key: 'unclosedQuote', opts: { line: 2 } })
  })

  it('reads a decimal comma after 0 and rejects units written into amounts', () => {
    const plan = planImport('name,price,stock\nMango,"0,500","0,500"\n', ctx())
    expect([plan.rows[0].price, plan.rows[0].stock]).toEqual([50, 0.5])
    expect(issues('name,price\nA,12kg\nB,12abc\nC,INR 40\nD,Rs. 40\n').map((x) => x.includes('invalidNumber'))).toEqual([true, true, false, false])
  })

  it('round-trips no tax, favourite, open price, colour and description through export', () => {
    const p = product({ id: 'x', name: 'Gift wrap', taxId: undefined, favorite: true, openPrice: true, color: '#aabbcc', description: 'Any size' })
    const csv = productsToCsv([p], new Map(), new Map())
    const row = planImport(csv, ctx()).rows[0]
    expect([row.taxId, row.favorite, row.openPrice, row.color, row.description]).toEqual([null, true, true, '#aabbcc', 'Any size'])
  })

  it('rejects negative stock when negative stock is off, except an unchanged level', () => {
    const c = ctx({ allowNegativeStock: false, products: [product({ barcode: '123', stock: -2 })] })
    expect(issues('name,barcode,price,stock\nNew,999,1,-1\nTea,123,,-2\n', c)).toEqual([['negative'], []])
    expect(issues('name,barcode,price,stock\nNew,999,1,-1\n', ctx({ allowNegativeStock: true }))).toEqual([[]])
  })
})
