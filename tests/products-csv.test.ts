import { describe, expect, it } from 'vitest'
import type { Product, Tax } from '@/core/types'
import { planImport } from '@/features/products/csv'

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

  it('rejects negative stock when negative stock is off, except an unchanged level', () => {
    const c = ctx({ allowNegativeStock: false, products: [product({ barcode: '123', stock: -2 })] })
    expect(issues('name,barcode,price,stock\nNew,999,1,-1\nTea,123,,-2\n', c)).toEqual([['negative'], []])
    expect(issues('name,barcode,price,stock\nNew,999,1,-1\n', ctx({ allowNegativeStock: true }))).toEqual([[]])
  })
})
