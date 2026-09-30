import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
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
  const chipsRef = useRef<HTMLDivElement>(null)
  const [chipFade, setChipFade] = useState({ start: false, end: false })
  const updateChipFade = () => {
    const el = chipsRef.current
    if (!el) return
    // scrollLeft is negative in right-to-left layouts, so compare magnitudes.
    const left = Math.abs(el.scrollLeft)
    const next = { start: left > 2, end: left + el.clientWidth < el.scrollWidth - 2 }
    setChipFade((f) => (f.start === next.start && f.end === next.end ? f : next))
  }
  useEffect(() => {
    updateChipFade()
    const el = chipsRef.current
    if (!el) return
    const ro = new ResizeObserver(updateChipFade)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const deferred = useDeferredValue(query)

  const products = useLiveQuery(async () => (await db.products.orderBy('name').toArray()).filter((p) => p.active && !p.deleted), [])
  const categories = useLiveQuery(async () => (await db.categories.orderBy('sortOrder').toArray()).filter((c) => !c.deleted), [])
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
        <div
          ref={chipsRef}
          role="tablist"
          onWheel={(e) => {
            // Mouse wheels scroll vertically; turn that into sideways scrolling for the chip row.
            const el = e.currentTarget
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY
          }}
          onScroll={updateChipFade}
          className={cn(
            'flex gap-2 overflow-x-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            // Fade the edge that has more chips beyond it, instead of cutting a chip mid-word.
            chipFade.end && chipFade.start && '[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-3rem),transparent)]',
            chipFade.end && !chipFade.start && '[mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)]',
            !chipFade.end && chipFade.start && '[mask-image:linear-gradient(to_right,transparent,black_2rem)]',
          )}
        >
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

      {/* Below lg the floating cart bar sits over the grid, so leave room to reach the last row. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-24 lg:pb-3">
        {products && !filtered.length ? (
          <EmptyState icon={<PackageSearch />} title={query ? t('noMatches', { query }) : t('noProducts')} description={query ? t('noMatchesHint') : t('noProductsHint')} />
        ) : (
          <div className={cn('grid gap-2', GRID[gridSize])}>
            {filtered.slice(0, MAX_TILES).map((p) => (
              <ProductTile key={p.id} p={p} color={p.color} showImage={showImages} onClick={() => onProduct(p)} />
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
        'flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors [&>svg]:size-3.5',
        active ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {icon ?? (color && <span className="size-2 rounded-full" style={{ background: color }} />)}
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
      className="group relative flex min-h-[104px] flex-col overflow-hidden rounded-xl border border-border bg-surface text-start transition-[transform,border-color,background-color] duration-100 hover:border-border-strong hover:bg-surface-2 active:scale-[0.98]"
    >
      {showImage && p.image && <img src={p.image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" draggable={false} />}
      <span className="flex flex-1 flex-col gap-1.5 p-3">
        <span className={cn('flex items-start gap-2', p.favorite && 'pe-4')}>
          {color && <span className="mt-[0.4rem] size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
          <span className="line-clamp-2 min-w-0 text-sm leading-snug font-medium">{p.name}</span>
        </span>
        <span className="mt-auto flex items-end justify-between gap-1">
          <span className="tnum text-[15px] font-semibold tracking-tight">{p.openPrice ? t('openPrice') : formatMoney(p.price)}</span>
          {p.trackStock && (
            <span className={cn('tnum rounded-md px-1.5 py-px text-[11px] font-medium', out ? 'bg-danger-soft text-danger' : low ? 'bg-warning-soft text-warning' : 'text-subtle')}>
              {formatQty(p.stock)}
              {p.unit !== 'pcs' && ` ${t(`common:unit.${p.unit}`)}`}
            </span>
          )}
        </span>
      </span>
      {p.favorite && <Star className="absolute end-2.5 top-3 size-3.5 fill-warning text-warning" aria-hidden />}
    </button>
  )
}
