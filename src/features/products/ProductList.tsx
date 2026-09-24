import { useDeferredValue, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleOff, FileUp, FolderInput, ListChecks, MoreVertical, Package, PackageSearch, Plus, Printer, Star, StarOff, Trash2, X } from 'lucide-react'
import type { Category, Product } from '@/core/types'
import { formatMoney, formatPercent } from '@/lib/money'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Badge, Button, DataTable, EmptyState, Modal, SearchInput, Select, type Column } from '@/components/ui'
import { ActionMenu, ProductThumb, StockQty, TickBox } from './shared'
import { deleteProducts, patchProducts } from './service'
import { byName, marginPct, matchesTerms, PAGE_SIZE, productColor, searchText, splitTerms, stockStatus } from './util'

export type StatusFilter = 'all' | 'active' | 'inactive' | 'low' | 'out'
export type SortKey = 'name' | 'price_desc' | 'price_asc' | 'stock_asc' | 'updated'

export interface ListFilters {
  query: string
  category: string
  status: StatusFilter
  sort: SortKey
}

export const DEFAULT_FILTERS: ListFilters = { query: '', category: 'all', status: 'all', sort: 'name' }

export function ProductList({ products, categories, filters, onFilters, onEdit, onNew, onImport, onLabels }: {
  products: Product[]
  categories: Map<string, Category>
  filters: ListFilters
  onFilters: (f: ListFilters) => void
  onEdit: (p: Product) => void
  onNew: () => void
  onImport: () => void
  onLabels: (ids: string[]) => void
}) {
  const { t } = useTranslation('products')
  const taxMap = useSettings((s) => s.taxMap)
  const inclusive = useSettings((s) => s.settings.pricesIncludeTax)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkCategory, setBulkCategory] = useState(false)
  const query = useDeferredValue(filters.query)
  const setF = (changes: Partial<ListFilters>) => onFilters({ ...filters, ...changes })

  // Search text is precomputed once per catalogue change, not per keystroke.
  const hay = useMemo(() => new Map(products.map((p) => [p.id, searchText(p)])), [products])

  const rows = useMemo(() => {
    const terms = splitTerms(query)
    const { category, status, sort } = filters
    const list = products.filter((p) => {
      if (category === 'none') {
        if (p.categoryId && categories.has(p.categoryId)) return false
      } else if (category !== 'all' && p.categoryId !== category) return false
      if (status === 'active' && !p.active) return false
      if (status === 'inactive' && p.active) return false
      if ((status === 'low' || status === 'out') && stockStatus(p) !== status) return false
      return !terms.length || matchesTerms(hay.get(p.id) ?? '', terms)
    })
    const cmp: Record<SortKey, (a: Product, b: Product) => number> = {
      name: byName,
      price_desc: (a, b) => b.price - a.price || byName(a, b),
      price_asc: (a, b) => a.price - b.price || byName(a, b),
      // Untracked products sort after every tracked one.
      stock_asc: (a, b) => (a.trackStock ? a.stock : Infinity) - (b.trackStock ? b.stock : Infinity) || byName(a, b),
      updated: (a, b) => b.updatedAt - a.updatedAt,
    }
    return list.sort(cmp[sort])
  }, [products, categories, hay, query, filters])

  useEffect(() => setLimit(PAGE_SIZE), [query, filters.category, filters.status, filters.sort])

  // Drop selections for products that disappeared (deleted here or on another terminal).
  const liveIds = useMemo(() => new Set(products.map((p) => p.id)), [products])
  const selectedIds = useMemo(() => [...selected].filter((id) => liveIds.has(id)), [selected, liveIds])
  const allSelected = rows.length > 0 && rows.every((p) => selected.has(p.id))
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const selectAll = (on: boolean) => setSelected(on ? new Set(rows.map((p) => p.id)) : new Set())
  const clearSelection = () => setSelected(new Set())

  const bulk = async (changes: Partial<Product>, message: string) => {
    await patchProducts(selectedIds, changes)
    toast(message)
  }
  const bulkDelete = async () => {
    const ok = await confirmDialog({ title: t('bulk.deleteTitle', { count: selectedIds.length }), message: t('bulk.deleteMessage'), danger: true, confirmLabel: t('common:delete') })
    if (!ok) return
    await deleteProducts(selectedIds)
    toast(t('bulk.deleted', { count: selectedIds.length }))
    clearSelection()
  }

  const margin = (p: Product) => marginPct(p.price, p.cost, p.taxId ? (taxMap.get(p.taxId)?.rate ?? 0) : 0, inclusive)
  const category = (p: Product) => (p.categoryId ? categories.get(p.categoryId) : undefined)

  const columns: Column<Product>[] = [
    {
      key: 'select',
      header: <TickBox checked={allSelected} indeterminate={selectedIds.length > 0} onChange={selectAll} label={t('bulk.selectAll')} />,
      render: (p) => <TickBox checked={selected.has(p.id)} onChange={(v) => toggle(p.id, v)} label={t('bulk.select', { name: p.name })} />,
      className: 'w-10 pe-0',
    },
    {
      key: 'name',
      header: t('common:product'),
      render: (p) => (
        <div className="flex min-w-48 items-center gap-3">
          <ProductThumb product={p} color={productColor(p, categories)} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('truncate font-medium', !p.active && 'text-muted')}>{p.name}</span>
              {p.favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label={t('editor.favorite')} />}
            </div>
            <div className="flex flex-wrap gap-1">
              {!p.active && <Badge>{t('common:inactive')}</Badge>}
              {p.openPrice && <Badge tone="primary">{t('editor.openPrice')}</Badge>}
              {p.weighed && <Badge tone="primary">{t('weighedBadge')}</Badge>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'code',
      header: `${t('sku')} / ${t('barcode')}`,
      render: (p) => (
        <div className="min-w-0">
          <div className="truncate text-sm">{p.sku || <span className="text-subtle">—</span>}</div>
          {p.barcode && <div className="truncate font-mono text-xs text-muted">{p.barcode}</div>}
        </div>
      ),
    },
    {
      key: 'category',
      header: t('common:category'),
      render: (p) => {
        const c = category(p)
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
    { key: 'price', header: t('common:price'), align: 'end', render: (p) => <span className="tnum font-semibold whitespace-nowrap">{p.openPrice ? t('editor.openPrice') : formatMoney(p.price)}</span> },
    { key: 'cost', header: t('common:cost'), align: 'end', render: (p) => <span className="tnum whitespace-nowrap text-muted">{formatMoney(p.cost)}</span>, className: 'hidden xl:table-cell' },
    {
      key: 'margin',
      header: t('common:margin'),
      align: 'end',
      render: (p) => {
        const m = p.cost ? margin(p) : undefined
        return m === undefined ? <span className="text-subtle">—</span> : <span className={cn('tnum', m < 0 ? 'text-danger' : m < 10 ? 'text-warning' : 'text-muted')}>{formatPercent(Math.round(m))}</span>
      },
      className: 'hidden xl:table-cell',
    },
    { key: 'stock', header: t('stock.label'), align: 'end', render: (p) => <StockQty product={p} /> },
    { key: 'tax', header: t('common:tax'), render: (p) => <span className="text-muted whitespace-nowrap">{(p.taxId && taxMap.get(p.taxId)?.name) || '—'}</span>, className: 'hidden lg:table-cell' },
  ]

  const filtered = filters.query || filters.category !== 'all' || filters.status !== 'all'
  const catOptions = [
    { value: 'all', label: t('filter.allCategories') },
    ...[...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ value: c.id, label: c.name })),
    { value: 'none', label: t('uncategorised') },
  ]

  if (!products.length) {
    return (
      <EmptyState
        icon={<Package />}
        title={t('empty')}
        description={t('emptyHint')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={onNew}>
              {t('new')}
            </Button>
            <Button icon={<FileUp className="size-4" />} onClick={onImport}>
              {t('common:importCsv')}
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-col gap-2 lg:flex-row">
        <SearchInput value={filters.query} onChange={(query) => setF({ query })} placeholder={t('searchPlaceholder')} className="lg:max-w-md lg:flex-1" autoComplete="off" />
        {/* Phones: a swipeable row of compact filters; desktops: fixed-width selects. */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0">
          <Select value={filters.category} onChange={(e) => setF({ category: e.target.value })} options={catOptions} aria-label={t('common:category')} wrapperClassName="shrink-0 lg:w-48" className="max-lg:w-auto" />
          <Select
            value={filters.status}
            onChange={(e) => setF({ status: e.target.value as StatusFilter })}
            aria-label={t('common:status')}
            wrapperClassName="shrink-0 lg:w-40"
            className="max-lg:w-auto"
            options={(['all', 'active', 'inactive', 'low', 'out'] as StatusFilter[]).map((s) => ({ value: s, label: t(`filter.status.${s}`) }))}
          />
          <Select
            value={filters.sort}
            onChange={(e) => setF({ sort: e.target.value as SortKey })}
            aria-label={t('filter.sort')}
            wrapperClassName="shrink-0 lg:w-48"
            className="max-lg:w-auto"
            options={(['name', 'price_desc', 'price_asc', 'stock_asc', 'updated'] as SortKey[]).map((s) => ({ value: s, label: t(`filter.sortBy.${s}`) }))}
          />
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-1.5 rounded-2xl border border-primary/30 bg-primary-soft px-2 py-1.5 shadow-card">
          <Button size="icon-sm" variant="ghost" onClick={clearSelection} aria-label={t('bulk.clear')} title={t('bulk.clear')}>
            <X className="size-4" />
          </Button>
          <span className="text-sm font-semibold whitespace-nowrap text-primary">{t('bulk.selected', { count: selectedIds.length })}</span>
          {!allSelected && rows.length > selectedIds.length && (
            <Button size="sm" variant="ghost" onClick={() => selectAll(true)} className="text-primary max-sm:hidden">
              {t('bulk.selectAllMatching', { count: rows.length })}
            </Button>
          )}
          <div className="ms-auto flex items-center gap-1">
            <BulkButton icon={<FolderInput />} label={t('bulk.setCategory')} onClick={() => setBulkCategory(true)} />
            <BulkButton icon={<Printer />} label={t('bulk.labels')} onClick={() => onLabels(selectedIds)} />
            <BulkButton icon={<Trash2 />} label={t('common:delete')} onClick={bulkDelete} danger />
            <ActionMenu
              label={t('common:more')}
              trigger={
                <Button size="sm" variant="ghost" aria-label={t('common:more')} title={t('common:more')} icon={<MoreVertical className="size-4" />} />
              }
              items={[
                { icon: <ListChecks />, label: t('bulk.selectAllMatching', { count: rows.length }), onClick: () => selectAll(true), hidden: allSelected },
                { icon: <CheckCircle2 />, label: t('bulk.activate'), onClick: () => bulk({ active: true }, t('bulk.activated', { count: selectedIds.length })) },
                { icon: <CircleOff />, label: t('bulk.deactivate'), onClick: () => bulk({ active: false }, t('bulk.deactivated', { count: selectedIds.length })) },
                { icon: <Star />, label: t('bulk.favorite'), onClick: () => bulk({ favorite: true }, t('bulk.updated', { count: selectedIds.length })) },
                { icon: <StarOff />, label: t('bulk.unfavorite'), onClick: () => bulk({ favorite: undefined }, t('bulk.updated', { count: selectedIds.length })) },
              ]}
            />
          </div>
        </div>
      )}

      <DataTable
        rows={rows.slice(0, limit)}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={onEdit}
        empty={
          <EmptyState
            icon={<PackageSearch />}
            title={t('noMatches')}
            description={t('noMatchesHint')}
            action={filtered && <Button onClick={() => onFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>{t('filter.clear')}</Button>}
          />
        }
        mobile={(p) => (
          <div className="flex items-center gap-3">
            <TickBox checked={selected.has(p.id)} onChange={(v) => toggle(p.id, v)} label={t('bulk.select', { name: p.name })} />
            <ProductThumb product={p} color={productColor(p, categories)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn('truncate font-medium', !p.active && 'text-muted')}>{p.name}</span>
                {p.favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" />}
              </div>
              <div className="truncate text-xs text-muted">{[p.sku || p.barcode, category(p)?.name, !p.active && t('common:inactive')].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5">
              <span className="tnum text-sm font-semibold">{p.openPrice ? t('editor.openPrice') : formatMoney(p.price)}</span>
              <StockQty product={p} className="text-xs" />
            </div>
          </div>
        )}
      />

      {rows.length > 0 && (
        <div className="flex flex-col items-center gap-2 pb-2 text-sm text-muted">
          <span>{t('showing', { shown: Math.min(limit, rows.length), total: rows.length })}</span>
          {rows.length > limit && (
            <Button onClick={() => setLimit((l) => l + PAGE_SIZE * 2)}>{t('showMore', { count: Math.min(PAGE_SIZE * 2, rows.length - limit) })}</Button>
          )}
        </div>
      )}

      <BulkCategoryDialog
        open={bulkCategory}
        onClose={() => setBulkCategory(false)}
        categories={[...categories.values()].sort((a, b) => a.sortOrder - b.sortOrder)}
        count={selectedIds.length}
        onApply={async (categoryId) => {
          await bulk({ categoryId: categoryId || undefined }, t('bulk.categorySet', { count: selectedIds.length }))
          setBulkCategory(false)
        }}
      />
    </div>
  )
}

function BulkButton({ icon, label, onClick, danger }: { icon: ReactElement; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} title={label} aria-label={label} className={cn('[&>svg]:size-4', danger && 'text-danger')} icon={icon}>
      <span className="max-xl:hidden">{label}</span>
    </Button>
  )
}

function BulkCategoryDialog({ open, onClose, categories, count, onApply }: { open: boolean; onClose: () => void; categories: Category[]; count: number; onApply: (id: string) => Promise<void> }) {
  const { t } = useTranslation('products')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValue(categories[0]?.id ?? '')
  }, [open, categories])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('bulk.setCategory')}
      subtitle={t('bulk.selected', { count })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={async () => (setBusy(true), await onApply(value).finally(() => setBusy(false)))}>
            {t('common:apply')}
          </Button>
        </>
      }
    >
      <Select label={t('common:category')} value={value} onChange={(e) => setValue(e.target.value)} options={[...categories.map((c) => ({ value: c.id, label: c.name })), { value: '', label: t('uncategorised') }]} autoFocus />
    </Modal>
  )
}
