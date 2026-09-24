import { useEffect, useState } from 'react'
import type { Category, Product, Unit } from '@/core/types'
import { toDateInput } from '@/lib/dates'

// Shared helpers for the Products and Stock screens (pure functions + tiny hooks).

/** Colour choices for categories and products. These are user data, not theme colours. */
export const SWATCHES = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#64748b',
]

export const UNITS: Unit[] = ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'box', 'pack', 'dozen', 'hour', 'service']

/** Units that are normally sold by weight/volume/length (qty dialog opens at the till). */
export const MEASURED_UNITS: Unit[] = ['kg', 'g', 'l', 'ml', 'm']
/** Units that never hold stock. */
export const SERVICE_UNITS: Unit[] = ['hour', 'service']

/** Rows rendered per "page" in long lists; catalogues can have 20k+ products. */
export const PAGE_SIZE = 100

export type StockStatus = 'untracked' | 'out' | 'low' | 'ok'

export function stockStatus(p: Pick<Product, 'trackStock' | 'stock' | 'reorderLevel'>): StockStatus {
  if (!p.trackStock) return 'untracked'
  if ((p.stock ?? 0) <= 0) return 'out'
  if (p.reorderLevel !== undefined && p.reorderLevel !== null && p.stock <= p.reorderLevel) return 'low'
  return 'ok'
}

/** Selling price excluding tax (minor units, not rounded). */
export function netOfTax(price: number, rate: number, inclusive: boolean): number {
  return inclusive && rate ? price / (1 + rate / 100) : price
}

/** Gross margin on the tax-exclusive selling price, in percent. Undefined when it can't be computed. */
export function marginPct(price: number, cost: number | undefined, rate: number, inclusive: boolean): number | undefined {
  if (cost === undefined || cost === null) return undefined
  const net = netOfTax(price, rate, inclusive)
  if (net <= 0) return undefined
  return ((net - cost) / net) * 100
}

/** Locale-aware, digit-aware name comparison ("Item 2" before "Item 10"). */
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name)

/** Category lookup that ignores soft-deleted rows. */
export function categoryMap(categories: Category[] | undefined): Map<string, Category> {
  return new Map((categories ?? []).filter((c) => !c.deleted).map((c) => [c.id, c]))
}

/** Colour shown for a product: its own, else its category's. */
export function productColor(p: Pick<Product, 'color' | 'categoryId'>, cats: Map<string, Category>): string | undefined {
  return p.color || (p.categoryId ? cats.get(p.categoryId)?.color : undefined)
}

/** Lower-cased "name sku barcode" used for fast multi-term search. */
export const searchText = (p: Pick<Product, 'name' | 'sku' | 'barcode'>) => `${p.name} ${p.sku ?? ''} ${p.barcode ?? ''}`.toLowerCase()

export function matchesTerms(hay: string, terms: string[]): boolean {
  for (const t of terms) if (!hay.includes(t)) return false
  return true
}

export const splitTerms = (q: string) => q.trim().toLowerCase().split(/\s+/).filter(Boolean)

/** Date stamp for exported file names. */
export const fileDate = () => toDateInput(Date.now())

/** Empty strings become undefined so optional fields stay absent in the database. */
export const blank = (s: string | undefined) => {
  const v = s?.trim()
  return v ? v : undefined
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const onChange = () => setMatch(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}

/** Below Tailwind's `md` breakpoint: forms open as full-height modals instead of side sheets. */
export const useIsPhone = () => useMediaQuery('(max-width: 767.98px)')
