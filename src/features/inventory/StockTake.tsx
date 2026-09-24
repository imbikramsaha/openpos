import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCheck, PackageSearch } from 'lucide-react'
import type { Category, Product } from '@/core/types'
import { round3 } from '@/db/repo'
import { formatMoney, formatQty, parseDecimal } from '@/lib/money'
import { cn } from '@/lib/cn'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Card, EmptyState, SearchInput, Select } from '@/components/ui'
import { byName, matchesTerms, PAGE_SIZE, searchText, splitTerms } from '@/features/products/util'
import { applyCounts } from './service'
import { QtyDelta } from './shared'

// Stock take: type counted quantities (Enter jumps to the next row), review the
// differences, then apply everything as `count` movements in one transaction.
// Counts are kept in localStorage until applied, so a count can span several sessions.

const DRAFT_KEY = 'kasa.stockTake'
type Show = 'all' | 'uncounted' | 'counted' | 'diff'

function loadCounts(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

const parse = (s: string | undefined) => {
  if (s === undefined || !s.trim()) return undefined
  const n = parseDecimal(s)
  return Number.isFinite(n) && n >= 0 ? round3(n) : NaN
}

export function StockTake({ products, categories }: { products: Product[]; categories: Map<string, Category> }) {
  const { t } = useTranslation('inventory')
  const [category, setCategory] = useState('all')
  const [show, setShow] = useState<Show>('all')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>(loadCounts)
  const [limit, setLimit] = useState(PAGE_SIZE * 2)
  const [busy, setBusy] = useState(false)
  const query = useDeferredValue(q)
  const listRef = useRef<HTMLUListElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (Object.keys(counts).length) localStorage.setItem(DRAFT_KEY, JSON.stringify(counts))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* storage unavailable */
    }
  }, [counts])

  const tracked = useMemo(() => products.filter((p) => p.trackStock && p.active).sort(byName), [products])
  const byId = useMemo(() => new Map(tracked.map((p) => [p.id, p])), [tracked])
  const hay = useMemo(() => new Map(tracked.map((p) => [p.id, searchText(p)])), [tracked])

  const rows = useMemo(() => {
    const terms = splitTerms(query)
    return tracked.filter((p) => {
      if (category === 'none' ? p.categoryId && categories.has(p.categoryId) : category !== 'all' && p.categoryId !== category) return false
      const c = parse(counts[p.id])
      if (show === 'uncounted' && c !== undefined) return false
      if (show === 'counted' && c === undefined) return false
      if (show === 'diff' && (c === undefined || Number.isNaN(c) || c === p.stock)) return false
      return !terms.length || matchesTerms(hay.get(p.id) ?? '', terms)
    })
  }, [tracked, categories, category, show, query, counts, hay])
  useEffect(() => setLimit(PAGE_SIZE * 2), [category, show, query])

  const summary = useMemo(() => {
    let counted = 0
    let changes = 0
    let value = 0
    let invalid = 0
    for (const [id, raw] of Object.entries(counts)) {
      const p = byId.get(id)
      const c = parse(raw)
      if (!p || c === undefined) continue
      if (Number.isNaN(c)) {
        invalid++
        continue
      }
      counted++
      const d = round3(c - p.stock)
      if (d) {
        changes++
        value += d * p.cost
      }
    }
    return { counted, changes, value: Math.round(value), invalid }
  }, [counts, byId])

  const focusRow = (i: number) => {
    const el = listRef.current?.querySelector<HTMLInputElement>(`input[data-row="${i}"]`)
    if (el) {
      el.focus()
      el.select()
    } else {
      // Past the last row: back to the search box, ready for the next scan.
      searchRef.current?.focus()
      searchRef.current?.select()
    }
  }

  const onSearchEnter = () => {
    const code = q.trim()
    if (!code) return focusRow(0)
    const lc = code.toLowerCase()
    const hit = tracked.find((p) => p.barcode === code) ?? tracked.find((p) => p.sku?.toLowerCase() === lc)
    if (hit && rows[0]?.id !== hit.id) setQ(hit.barcode ?? hit.sku ?? code)
    setTimeout(() => focusRow(0), 0)
  }

  const apply = async () => {
    if (!summary.counted || busy) return
    const ok = await confirmDialog({
      title: t('count.applyTitle', { count: summary.counted }),
      message: t('count.applyMessage', { changes: summary.changes, value: formatMoney(summary.value, { sign: true }) }),
      confirmLabel: t('count.apply'),
    })
    if (!ok) return
    setBusy(true)
    try {
      const list = Object.entries(counts).flatMap(([productId, raw]) => {
        const c = parse(raw)
        return c === undefined || Number.isNaN(c) || !byId.has(productId) ? [] : [{ productId, counted: c }]
      })
      const changed = await applyCounts(list, t('count.movementNote'))
      setCounts({})
      toast(t('count.applied', { count: list.length, changed }))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (await confirmDialog({ title: t('count.clearTitle'), message: t('count.clearMessage', { count: summary.counted }), danger: true, confirmLabel: t('common:clear') })) setCounts({})
  }

  if (!tracked.length) return <EmptyState icon={<ClipboardCheck />} title={t('list.empty')} description={t('list.emptyHint')} />

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted max-sm:hidden">{t('count.hint')}</p>
      <div className="flex flex-col gap-2 lg:flex-row">
        <SearchInput
          ref={searchRef}
          value={q}
          onChange={setQ}
          placeholder={t('count.search')}
          className="lg:max-w-md lg:flex-1"
          autoComplete="off"
          enterKeyHint="next"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSearchEnter()
            }
          }}
        />
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
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
            value={show}
            onChange={(e) => setShow(e.target.value as Show)}
            aria-label={t('count.show')}
            wrapperClassName="shrink-0 lg:w-48"
            className="max-lg:w-auto"
            options={(['all', 'uncounted', 'counted', 'diff'] as Show[]).map((s) => ({ value: s, label: t(`count.filter.${s}`) }))}
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[minmax(0,1fr)_76px_104px] gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid-cols-[minmax(0,1fr)_100px_130px_100px]">
          <span>{t('common:product')}</span>
          <span className="text-end">{t('count.expected')}</span>
          <span className="text-end">{t('count.counted')}</span>
          <span className="hidden text-end sm:block">{t('count.difference')}</span>
        </div>
        {!rows.length ? (
          <EmptyState icon={<PackageSearch />} title={t('common:noResults')} className="py-10" />
        ) : (
          <ul ref={listRef} className="divide-y divide-border">
            {rows.slice(0, limit).map((p, i) => {
              const raw = counts[p.id] ?? ''
              const c = parse(raw)
              const bad = c !== undefined && Number.isNaN(c)
              const diff = c !== undefined && !bad ? round3(c - p.stock) : undefined
              return (
                <li key={p.id} className={cn('grid grid-cols-[minmax(0,1fr)_76px_104px] items-center gap-3 px-4 py-2 sm:grid-cols-[minmax(0,1fr)_100px_130px_100px]', diff !== undefined && diff !== 0 && 'bg-warning-soft/40')}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted">
                      {[p.sku || p.barcode, p.categoryId && categories.get(p.categoryId)?.name].filter(Boolean).join(' · ')}
                      {diff !== undefined && (
                        <span className="sm:hidden">
                          {' · '}
                          <QtyDelta qty={diff} className="text-xs" />
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="tnum text-end text-sm text-muted">
                    {formatQty(p.stock)}
                    {p.unit !== 'pcs' && <span className="ms-1 text-xs">{t(`common:unit.${p.unit}`)}</span>}
                  </span>
                  <input
                    data-row={i}
                    value={raw}
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    placeholder="—"
                    aria-label={t('count.countedFor', { name: p.name })}
                    onChange={(e) => {
                      const v = e.target.value
                      setCounts((s) => {
                        const n = { ...s }
                        if (v.trim()) n[p.id] = v
                        else delete n[p.id]
                        return n
                      })
                    }}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) {
                        e.preventDefault()
                        focusRow(i + 1)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        if (i > 0) focusRow(i - 1)
                      }
                    }}
                    className={cn(
                      'tnum h-10 w-full rounded-xl border bg-surface px-3 text-end font-semibold focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none',
                      bad ? 'border-danger' : c !== undefined ? 'border-primary/50' : 'border-border',
                    )}
                  />
                  <span className="hidden text-end sm:block">{diff !== undefined ? <QtyDelta qty={diff} /> : <span className="text-subtle">—</span>}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      {rows.length > limit && (
        <div className="text-center">
          <Button onClick={() => setLimit((l) => l + PAGE_SIZE * 2)}>{t('products:showMore', { count: Math.min(PAGE_SIZE * 2, rows.length - limit) })}</Button>
        </div>
      )}

      {/* Sticky summary */}
      <div className="pointer-events-none sticky bottom-0 z-10 -mx-1 pt-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-pop">
          <div className="min-w-0 text-sm max-sm:w-full sm:flex-1">
            <div className="font-semibold">{t('count.summary', { counted: summary.counted, total: tracked.length })}</div>
            <div className="text-xs text-muted">
              {t('count.changes', { count: summary.changes })}
              {summary.changes > 0 && (
                <>
                  {' · '}
                  <span className={cn('tnum font-medium', summary.value < 0 ? 'text-danger' : 'text-success')}>{formatMoney(summary.value, { sign: true })}</span> {t('count.atCost')}
                </>
              )}
              {summary.invalid > 0 && <span className="text-danger"> · {t('count.invalid', { count: summary.invalid })}</span>}
            </div>
          </div>
          <Button variant="ghost" onClick={clear} disabled={!summary.counted} className="max-sm:flex-1">
            {t('common:clear')}
          </Button>
          <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={apply} disabled={!summary.counted} loading={busy} className="max-sm:flex-[2]">
            {t('count.apply')}
          </Button>
        </div>
      </div>
    </div>
  )
}
