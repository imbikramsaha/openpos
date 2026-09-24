import { useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Category, Product } from '@/core/types'
import { db } from '@/db/db'
import { loadAggregate, type Aggregate } from './compute'
import { bucketStarts, granularityFor, previousPeriod, type Granularity, type Period, type Range } from './range'

export interface ReportData {
  cur: Aggregate
  prev: Aggregate
  /** Numbers of the original invoices that credit notes in the range refer to. */
  originals: Map<string, string>
  granularity: Granularity
  starts: number[]
  prevStarts: number[]
  period: Period
}

export interface ReportState {
  data?: ReportData
  /** True while a new range is being computed (the previous result stays on screen). */
  loading: boolean
  prev: Period
  products: Product[]
  categories: Category[]
  productMap: Map<string, Product>
  categoryMap: Map<string, Category>
}

export function useReport(range: Range, deviceId: string): ReportState {
  const prev = useMemo(() => previousPeriod(range), [range])
  const key = `${range.from}|${range.to}|${deviceId}`

  // Sales only: the heavy query does not read the product table, so stock changes
  // (every sale updates product stock) do not recompute a year of sales.
  const cur = useLiveQuery(async () => {
    const granularity = granularityFor(range.from, range.to)
    const starts = bucketStarts(range.from, range.to, granularity)
    const agg = await loadAggregate(range.from, range.to, { starts, deviceId: deviceId || undefined })
    const ids = [...new Set(agg.creditNotes.map((c) => c.refundOf).filter((id): id is string => !!id))]
    const originals = new Map<string, string>()
    if (ids.length) for (const d of await db.sales.bulkGet(ids)) if (d) originals.set(d.id, d.number)
    return { key, agg, originals, granularity, starts }
  }, [key])

  const before = useLiveQuery(async () => {
    const starts = bucketStarts(prev.from, prev.to, granularityFor(range.from, range.to))
    const agg = await loadAggregate(prev.from, prev.to, { starts, deviceId: deviceId || undefined, cutoff: prev.cutoff, light: true })
    return { key, agg, starts, period: prev }
  }, [key])

  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deleted).toArray(), [])
  const productMap = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products])
  const categoryMap = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories])

  const data = useMemo<ReportData | undefined>(
    () =>
      cur && before && cur.key === before.key
        ? { cur: cur.agg, prev: before.agg, originals: cur.originals, granularity: cur.granularity, starts: cur.starts, prevStarts: before.starts, period: before.period }
        : undefined,
    [cur, before],
  )
  // Keep showing the last consistent result while a new range loads.
  const last = useRef<ReportData | undefined>(undefined)
  if (data) last.current = data

  return {
    data: data ?? last.current,
    loading: !cur || !before || cur.key !== key || before.key !== key,
    prev,
    products: products ?? [],
    categories: categories ?? [],
    productMap,
    categoryMap,
  }
}
