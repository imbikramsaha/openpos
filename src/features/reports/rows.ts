import type { Category, Product, Unit } from '@/core/types'
import type { Aggregate } from './compute'
import { margin, share } from './format'

// Joins aggregated sales with the (current) catalogue. Cheap: one row per product.

export interface ProductRow {
  key: string
  productId?: string
  name: string
  sku: string
  categoryId: string
  category: string
  unit: Unit
  qty: number
  net: number
  tax: number
  total: number
  cost: number
  profit: number
  margin: number
  share: number
}

export interface CategoryRow {
  key: string
  name: string
  color?: string
  products: number
  qty: number
  net: number
  cost: number
  profit: number
  margin: number
  share: number
}

export function productRows(agg: Aggregate, products: Map<string, Product>, categories: Map<string, Category>, uncategorised: string): ProductRow[] {
  const totalNet = agg.totals.net
  const out: ProductRow[] = []
  for (const p of agg.products.values()) {
    const prod = p.productId ? products.get(p.productId) : undefined
    const cat = prod?.categoryId ? categories.get(prod.categoryId) : undefined
    out.push({
      key: p.key,
      productId: p.productId,
      name: prod?.name ?? p.name,
      sku: prod?.sku ?? p.sku ?? '',
      categoryId: cat?.id ?? '',
      category: cat?.name ?? uncategorised,
      unit: p.unit,
      qty: p.qty,
      net: p.net,
      tax: p.tax,
      total: p.total,
      cost: p.cost,
      profit: p.profit,
      margin: margin(p.profit, p.net),
      share: share(p.net, totalNet),
    })
  }
  return out
}

export function categoryRows(rows: ProductRow[], categories: Map<string, Category>, totalNet: number, uncategorised: string): CategoryRow[] {
  const map = new Map<string, CategoryRow>()
  for (const p of rows) {
    const key = p.categoryId || 'none'
    let c = map.get(key)
    if (!c) {
      const cat = categories.get(p.categoryId)
      map.set(key, (c = { key, name: cat?.name ?? uncategorised, color: cat?.color, products: 0, qty: 0, net: 0, cost: 0, profit: 0, margin: 0, share: 0 }))
    }
    c.products++
    c.qty += p.qty
    c.net += p.net
    c.cost += p.cost
    c.profit += p.profit
  }
  const out = [...map.values()]
  for (const c of out) {
    c.margin = margin(c.profit, c.net)
    c.share = share(c.net, totalNet)
  }
  return out.sort((a, b) => b.net - a.net)
}
