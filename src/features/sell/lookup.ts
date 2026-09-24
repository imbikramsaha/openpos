import type { Product } from '@/core/types'
import { parseScaleBarcode } from '@/core/barcode'
import { db } from '@/db/db'
import { settings } from '@/stores/settings'
import { toMinor } from '@/lib/money'

export interface LookupResult {
  product: Product
  qty?: number
  price?: number
}

/** Resolves a scanned/typed code to a product: barcode, SKU, then weighing-scale label. */
export async function findByCode(raw: string): Promise<LookupResult | null> {
  const code = raw.trim()
  if (!code) return null
  const usable = (p?: Product) => (p && p.active && !p.deleted ? p : undefined)
  const byBarcode = usable((await db.products.where('barcode').equals(code).toArray()).find((p) => usable(p)))
  if (byBarcode) return { product: byBarcode }
  const bySku = usable((await db.products.where('sku').equalsIgnoreCase(code).toArray()).find((p) => usable(p)))
  if (bySku) return { product: bySku }

  const s = settings()
  const scale = parseScaleBarcode(code, s.scale)
  if (scale) {
    const stripped = scale.itemCode.replace(/^0+/, '')
    const all = await db.products.filter((p) => !!usable(p) && [p.sku, p.barcode].some((c) => c && (c === scale.itemCode || c.replace(/^0+/, '') === stripped))).toArray()
    const product = all[0]
    if (product) {
      if (s.scale.valueType === 'weight') return { product, qty: scale.value }
      // Price-embedded labels: value is the line total; derive quantity from unit price.
      const priceMinor = toMinor(scale.value)
      return { product, qty: product.price ? Math.round((priceMinor / product.price) * 1000) / 1000 : 1, price: product.price || priceMinor }
    }
  }
  return null
}
