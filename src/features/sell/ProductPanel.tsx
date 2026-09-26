import { useDeferredValue, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { LayoutGrid, PackageSearch, Plus, ScanLine, Star } from 'lucide-react'
import type { Product } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { useDevice } from '@/stores/device'
import { Button, EmptyState, Kbd, SearchInput } from '@/components/ui'

const GRID = {
  sm: 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]',
  md: 'grid-cols-[repeat(auto-fill,minmax(138px,1fr))]',
  lg: 'grid-cols-[repeat(auto-fill,minmax(172px,1fr))]',
}

const MAX_TILES = 240

export function ProductPanel({ onProduct, onEnter, searchRef, onCamera, onCustomItem }: {
  onProduct: (p: Product) => void
  /** Enter in the search box: resolve barcode/SKU or add the single match. Returns true if handled. */
  onEnter: (query: string, matches: Product[]) => Promise<boolean>
  searchRef: RefObject<HTMLInputElement | null>
  onCamera: () => void
  onCustomItem: () => void
}) {
  const { t } = useTranslation('sell')
  const gridSize = useDevice((s) => s.gridSize)
  const showImages = useDevice((s) => s.showImages)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const deferred = useDeferredValue(query)

  const products = useLiveQuery(async () => (await db.products.orderBy('name').toArray()).filter((p) => p.active && !p.deleted), [])
  const categories = useLiveQuery(async () => (await db.categories.orderBy('sortOrder').toArray()).filter((c) => !c.deleted), [])
  const catColor = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.color])), [categories])
  const hasFavorites = useMemo(() => products?.some((p) => p.favorite), [products])

  const filtered = useMemo(() => filterProducts(products ?? [], deferred, category), [products, deferred, category])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-2 p-3 pb-2">
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder={t('searchOrScan')}
          className="flex-1"
          autoComplete="off"
          enterKeyHint="search"
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault()
              // Filter with the live query: the deferred list may still be stale right after typing.
              if (await onEnter(query.trim(), filterProducts(products ?? [], query, category))) setQuery('')
            } else if (e.key === 'Escape' && query) {
              e.stopPropagation()
              setQuery('')
            }
          }}
          right={<Kbd>F2</Kbd>}
        />
        <Button size="icon-lg" onClick={onCamera} aria-label={t('scanWithCamera')} title={t('scanWithCamera')}>
          <ScanLine className="size-5" />
        </Button>
        <Button size="icon-lg" onClick={onCustomItem} aria-label={t('customItem')} title={`${t('customItem')} (F9)`}>
          <Plus className="size-5" />
        </Button>
      </div>

      {!query && (
        <div className="flex gap-2 overflow-x-auto px-3 pb-2" role="tablist">
          <CategoryChip active={category === 'all'} onClick={() => setCategory('all')} icon={<LayoutGrid className="size-4" />}>
            {t('all')}
          </CategoryChip>
          {hasFavorites && (
            <CategoryChip active={category === 'fav'} onClick={() => setCategory('fav')} icon={<Star className="size-4" />}>
              {t('favorites')}
            </CategoryChip>
          )}
          {categories?.map((c) => (
            <CategoryChip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)} color={c.color}>
              {c.name}
            </CategoryChip>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {products && !filtered.length ? (
          <EmptyState icon={<PackageSearch />} title={query ? t('noMatches', { query }) : t('noProducts')} description={query ? t('noMatchesHint') : t('noProductsHint')} />
        ) : (
          <div className={cn('grid gap-2', GRID[gridSize])}>
            {filtered.slice(0, MAX_TILES).map((p) => (
              <ProductTile key={p.id} p={p} color={p.color || (p.categoryId ? catColor.get(p.categoryId) : undefined)} showImage={showImages} onClick={() => onProduct(p)} />
            ))}
          </div>
        )}
        {filtered.length > MAX_TILES && <p className="py-4 text-center text-sm text-muted">{t('refineSearch', { count: filtered.length - MAX_TILES })}</p>}
      </div>
    </div>
  )
}

function filterProducts(list: Product[], query: string, category: string): Product[] {
  const q = query.trim().toLowerCase()
  if (q) {
    const terms = q.split(/\s+/)
    return list.filter((p) => {
      const hay = `${p.name} ${p.sku ?? ''} ${p.barcode ?? ''}`.toLowerCase()
      return terms.every((term) => hay.includes(term))
    })
  }
  if (category === 'fav') return list.filter((p) => p.favorite)
  if (category !== 'all') return list.filter((p) => p.categoryId === category)
  return list
}

function CategoryChip({ active, onClick, children, color, icon }: { active: boolean; onClick: () => void; children: ReactNode; color?: string; icon?: ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
        active ? 'border-primary bg-primary text-primary-fg shadow-card' : 'border-border bg-surface text-fg hover:bg-surface-3',
      )}
    >
      {icon ?? (color && <span className="size-2.5 rounded-full" style={{ background: color }} />)}
      {children}
    </button>
  )
}

function ProductTile({ p, color, showImage, onClick }: { p: Product; color?: string; showImage: boolean; onClick: () => void }) {
  const { t } = useTranslation('sell')
  const low = p.trackStock && p.stock <= (p.reorderLevel ?? 0)
  const out = p.trackStock && p.stock <= 0
  return (
    <button
      onClick={onClick}
      className="group relative flex min-h-[104px] flex-col overflow-hidden rounded-2xl border border-border bg-surface text-start shadow-card transition-[transform,border-color] duration-75 hover:border-border-strong active:scale-[0.97]"
    >
      {showImage && p.image ? (
        <img src={p.image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" draggable={false} />
      ) : (
        <span className="h-1.5 w-full shrink-0" style={{ background: color || 'var(--border-strong)' }} />
      )}
      <span className="flex flex-1 flex-col gap-1 p-2.5">
        <span className="line-clamp-2 text-sm leading-snug font-semibold">{p.name}</span>
        <span className="mt-auto flex items-end justify-between gap-1">
          <span className="tnum text-[15px] font-bold text-primary">{p.openPrice ? t('openPrice') : formatMoney(p.price)}</span>
          {p.trackStock && (
            <span className={cn('tnum rounded-md px-1.5 text-[11px] font-semibold', out ? 'bg-danger-soft text-danger' : low ? 'bg-warning-soft text-warning' : 'text-subtle')}>
              {formatQty(p.stock)}
              {p.unit !== 'pcs' && ` ${t(`common:unit.${p.unit}`)}`}
            </span>
          )}
        </span>
      </span>
      {p.favorite && <Star className="absolute end-2 top-3 size-3.5 fill-warning text-warning" />}
    </button>
  )
}
