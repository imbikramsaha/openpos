import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, PackageSearch } from 'lucide-react'
import type { Category, Product } from '@/core/types'
import { formatMoney, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button, DataTable, EmptyState, SearchInput, Select, type Column } from '@/components/ui'
import { ProductThumb, StockQty } from '@/features/products/shared'
import { byName, matchesTerms, PAGE_SIZE, productColor, searchText, splitTerms, stockStatus } from '@/features/products/util'

export type StockFilter = 'all' | 'low' | 'out' | 'ok'
type StockSort = 'name' | 'stock_asc' | 'value_desc'

export interface StockListState {
  query: string
  category: string
  status: StockFilter
  sort: StockSort
}

export const DEFAULT_STOCK_STATE: StockListState = { query: '', category: 'all', status: 'all', sort: 'name' }

/** Tracked products with their levels and value. Tapping a row opens the stock card. */
export function StockList({ products, categories, state, onState, onOpen }: {
  products: Product[]
  categories: Map<string, Category>
  state: StockListState
  onState: (s: StockListState) => void
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation('inventory')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const query = useDeferredValue(state.query)
  const set = (changes: Partial<StockListState>) => onState({ ...state, ...changes })

  const tracked = useMemo(() => products.filter((p) => p.trackStock), [products])
  const hay = useMemo(() => new Map(tracked.map((p) => [p.id, searchText(p)])), [tracked])
  const value = (p: Product, of: 'cost' | 'price') => Math.round(Math.max(p.stock, 0) * p[of])

  const rows = useMemo(() => {
    const terms = splitTerms(query)
    const list = tracked.filter((p) => {
      if (state.category === 'none' ? p.categoryId && categories.has(p.categoryId) : state.category !== 'all' && p.categoryId !== state.category) return false
      if (state.status !== 'all') {
        const s = stockStatus(p)
        if (state.status === 'low' ? s !== 'low' && s !== 'out' : s !== state.status) return false
      }
      return !terms.length || matchesTerms(hay.get(p.id) ?? '', terms)
    })
    const cmp: Record<StockSort, (a: Product, b: Product) => number> = {
      name: byName,
      stock_asc: (a, b) => a.stock - b.stock || byName(a, b),
      value_desc: (a, b) => value(b, 'cost') - value(a, 'cost') || byName(a, b),
    }
    return list.sort(cmp[state.sort])
  }, [tracked, categories, hay, query, state])

  useEffect(() => setLimit(PAGE_SIZE), [query, state.category, state.status, state.sort])

  const totals = useMemo(() => rows.reduce((a, p) => ({ cost: a.cost + value(p, 'cost'), retail: a.retail + value(p, 'price') }), { cost: 0, retail: 0 }), [rows])

  const columns: Column<Product>[] = [
    {
      key: 'name',
      header: t('common:product'),
      render: (p) => (
        <div className="flex max-w-[24rem] min-w-48 items-center gap-3">
          <ProductThumb product={p} color={productColor(p, categories)} size="sm" />
          <div className="min-w-0">
            <div className={cn('truncate font-medium', !p.active && 'text-muted')}>{p.name}</div>
            <div className="truncate text-xs text-muted">{p.sku || p.barcode || '—'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: t('common:category'),
      render: (p) => {
        const c = p.categoryId ? categories.get(p.categoryId) : undefined
        return c ? (
          <span className="inline-flex max-w-40 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
          </span>
        ) : (
          <span className="text-subtle">—</span>
        )
      },
      className: 'hidden lg:table-cell',
    },
    { key: 'stock', header: t('stock'), align: 'end', render: (p) => <StockQty product={p} /> },
    { key: 'reorder', header: t('reorder'), align: 'end', render: (p) => <span className="tnum text-muted">{p.reorderLevel !== undefined ? formatQty(p.reorderLevel) : '—'}</span> },
    { key: 'cost', header: t('valueCost'), align: 'end', render: (p) => <span className="tnum">{formatMoney(value(p, 'cost'))}</span> },
    { key: 'retail', header: t('valueRetail'), align: 'end', render: (p) => <span className="tnum text-muted">{formatMoney(value(p, 'price'))}</span>, className: 'hidden xl:table-cell' },
  ]

  if (!tracked.length) return <EmptyState icon={<Boxes />} title={t('list.empty')} description={t('list.emptyHint')} />

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row">
        <SearchInput value={state.query} onChange={(q) => set({ query: q })} placeholder={t('list.search')} className="lg:max-w-md lg:flex-1" autoComplete="off" />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <Select
            value={state.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label={t('common:category')}
            wrapperClassName="shrink-0 lg:w-48"
            className="max-lg:w-auto"
            options={[
              { value: 'all', label: t('products:filter.allCategories') },
              ...[...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ value: c.id, label: c.name })),
              { value: 'none', label: t('products:uncategorised') },
            ]}
          />
          <Select
            value={state.status}
            onChange={(e) => set({ status: e.target.value as StockFilter })}
            aria-label={t('common:status')}
            wrapperClassName="shrink-0 lg:w-44"
            className="max-lg:w-auto"
            options={(['all', 'low', 'out', 'ok'] as StockFilter[]).map((s) => ({ value: s, label: t(`list.status.${s}`) }))}
          />
          <Select
            value={state.sort}
            onChange={(e) => set({ sort: e.target.value as StockSort })}
            aria-label={t('products:filter.sort')}
            wrapperClassName="shrink-0 lg:w-48"
            className="max-lg:w-auto"
            options={(['name', 'stock_asc', 'value_desc'] as StockSort[]).map((s) => ({ value: s, label: t(`list.sort.${s}`) }))}
          />
        </div>
      </div>

      <DataTable
        rows={rows.slice(0, limit)}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) => onOpen(p.id)}
        empty={<EmptyState icon={<PackageSearch />} title={t('products:noMatches')} description={t('products:noMatchesHint')} />}
        mobile={(p) => (
          <div className="flex items-center gap-3">
            <ProductThumb product={p} color={productColor(p, categories)} />
            <div className="min-w-0 flex-1">
              <div className={cn('truncate font-medium', !p.active && 'text-muted')}>{p.name}</div>
              <div className="truncate text-xs text-muted">
                {t('list.mobileLine', { value: formatMoney(value(p, 'cost')), reorder: p.reorderLevel !== undefined ? formatQty(p.reorderLevel) : '—' })}
              </div>
            </div>
            <StockQty product={p} />
          </div>
        )}
        footer={
          rows.length > 0 && (
            <tr>
              <td className="px-4 py-3" colSpan={1}>
                {t('list.totalRows', { count: rows.length })}
              </td>
              <td className="hidden lg:table-cell" />
              <td />
              <td />
              <td className="tnum px-4 py-3 text-end">{formatMoney(totals.cost)}</td>
              <td className="tnum hidden px-4 py-3 text-end xl:table-cell">{formatMoney(totals.retail)}</td>
            </tr>
          )
        }
      />

      {rows.length > 0 && (
        <div className="flex flex-col items-center gap-2 pb-2 text-sm text-muted">
          <span className="md:hidden">{t('list.mobileTotals', { cost: formatMoney(totals.cost), retail: formatMoney(totals.retail) })}</span>
          <span>{t('products:showing', { shown: Math.min(limit, rows.length), total: rows.length })}</span>
          {rows.length > limit && <Button onClick={() => setLimit((l) => l + PAGE_SIZE * 2)}>{t('products:showMore', { count: Math.min(PAGE_SIZE * 2, rows.length - limit) })}</Button>}
        </div>
      )}
    </div>
  )
}
