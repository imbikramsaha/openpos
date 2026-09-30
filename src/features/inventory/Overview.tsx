import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowRight, CheckCircle2, Coins, FileDown, PackageX, ShoppingCart, Tag, Truck } from 'lucide-react'
import type { Category, Product } from '@/core/types'
import { db } from '@/db/db'
import { relativeTime } from '@/lib/dates'
import { downloadText } from '@/lib/download'
import { formatMoney, formatQty } from '@/lib/money'
import { navigate } from '@/router'
import { Button, Card, CardHeader, EmptyState, Stat } from '@/components/ui'
import { ProductThumb, StockQty } from '@/features/products/shared'
import { byName, fileDate, productColor, stockStatus } from '@/features/products/util'
import { lowStockCsv, suggestedQty } from './service'
import { QtyDelta, TypeBadge, useSold30 } from './shared'

const LOW_LIMIT = 50

export function Overview({ products, categories, onOpen }: { products: Product[]; categories: Map<string, Category>; onOpen: (id: string) => void }) {
  const { t } = useTranslation('inventory')
  const sold = useSold30()

  const stats = useMemo(() => {
    let cost = 0
    let retail = 0
    let tracked = 0
    const low: Product[] = []
    let out = 0
    for (const p of products) {
      if (!p.trackStock) continue
      // Stock on hand is worth the same whether or not the product is on sale, so value
      // every tracked product (as the stock list and valuation export do); reorder only active ones.
      tracked++
      const qty = Math.max(p.stock, 0)
      // Round per product, as the stock list and valuation export do, so the totals agree.
      cost += Math.round(qty * p.cost)
      retail += Math.round(qty * p.price)
      if (!p.active) continue
      const s = stockStatus(p)
      if (s === 'out') out++
      if (s === 'out' || s === 'low') low.push(p)
    }
    // Out-of-stock first, then the lowest relative to the reorder level.
    low.sort((a, b) => a.stock - (a.reorderLevel ?? 0) - (b.stock - (b.reorderLevel ?? 0)) || byName(a, b))
    return { cost: Math.round(cost), retail: Math.round(retail), tracked, low, out }
  }, [products])

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const recent = useLiveQuery(async () => (await db.stockMovements.orderBy('createdAt').reverse().limit(40).toArray()).filter((m) => !m.deleted).slice(0, 12), [])

  const exportLow = () => downloadText(`low-stock-${fileDate()}.csv`, lowStockCsv(stats.low, categories, sold ?? new Map()), 'text/csv')

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat className="max-sm:col-span-2" icon={<Coins />} label={t('overview.valueCost')} value={formatMoney(stats.cost)} hint={t('overview.tracked', { count: stats.tracked })} />
        <Stat className="max-sm:col-span-2" icon={<Tag />} tone="success" label={t('overview.valueRetail')} value={formatMoney(stats.retail)} hint={t('overview.potential', { amount: formatMoney(stats.retail - stats.cost) })} />
        <Stat icon={<AlertTriangle />} tone="warning" label={t('overview.low')} value={stats.low.length - stats.out} hint={t('overview.lowHint')} />
        <Stat icon={<PackageX />} tone="danger" label={t('overview.out')} value={stats.out} hint={t('overview.outHint')} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader
            title={t('overview.reorderTitle')}
            subtitle={t('overview.reorderHint')}
            actions={
              stats.low.length > 0 && (
                <div className="flex gap-2">
                  <Button size="sm" icon={<FileDown className="size-4" />} onClick={exportLow} aria-label={t('common:exportCsv')} title={t('common:exportCsv')}>
                    <span className="max-sm:hidden">{t('common:export')}</span>
                  </Button>
                  <Button size="sm" variant="primary" icon={<Truck className="size-4" />} onClick={() => navigate('inventory/purchases/new?low=1')}>
                    {t('overview.createPurchase')}
                  </Button>
                </div>
              )
            }
          />
          {!stats.low.length ? (
            <EmptyState icon={<CheckCircle2 />} title={t('overview.allGood')} description={t('overview.allGoodHint')} className="py-10" />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_90px_80px_80px_90px] gap-3 border-b border-border bg-surface-2 px-5 py-2 text-xs font-semibold tracking-wide text-muted uppercase sm:grid">
                <span>{t('common:product')}</span>
                <span className="text-end">{t('stock')}</span>
                <span className="text-end">{t('reorder')}</span>
                <span className="text-end">{t('overview.sold30')}</span>
                <span className="text-end">{t('overview.suggested')}</span>
              </div>
              <ul className="divide-y divide-border">
                {stats.low.slice(0, LOW_LIMIT).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => onOpen(p.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_90px_80px_80px_90px] sm:px-5">
                      <span className="flex min-w-0 items-center gap-3">
                        <ProductThumb product={p} color={productColor(p, categories)} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="block truncate text-xs text-muted sm:hidden">
                            {t('overview.mobileLine', { reorder: formatQty(p.reorderLevel ?? 0), suggested: formatQty(suggestedQty(p, sold?.get(p.id))) })}
                          </span>
                        </span>
                      </span>
                      <span className="text-end">
                        <StockQty product={p} />
                      </span>
                      <span className="tnum hidden text-end text-sm text-muted sm:block">{p.reorderLevel !== undefined ? formatQty(p.reorderLevel) : '—'}</span>
                      <span className="tnum hidden text-end text-sm text-muted sm:block">{sold ? formatQty(Math.max(0, sold.get(p.id) ?? 0)) : '…'}</span>
                      <span className="tnum hidden text-end text-sm font-semibold text-primary sm:block">{formatQty(suggestedQty(p, sold?.get(p.id)))}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {stats.low.length > LOW_LIMIT && (
                <button onClick={() => navigate('inventory/stock?status=low')} className="flex w-full items-center justify-center gap-1 border-t border-border py-3 text-sm font-medium text-primary hover:bg-surface-2">
                  {t('overview.viewAll', { count: stats.low.length })} <ArrowRight className="size-4 rtl:rotate-180" />
                </button>
              )}
            </>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={t('overview.recent')} actions={<Button size="sm" variant="ghost" onClick={() => navigate('inventory/stock')}>{t('overview.allStock')}</Button>} />
          {recent && !recent.length ? (
            <EmptyState icon={<ShoppingCart />} title={t('overview.noRecent')} className="py-10" />
          ) : (
            <ul className="divide-y divide-border">
              {(recent ?? []).map((m) => {
                const p = byId.get(m.productId)
                return (
                  <li key={m.id}>
                    <button onClick={() => p && onOpen(p.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-2" disabled={!p}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p?.name ?? t('overview.deletedProduct')}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                          <TypeBadge type={m.type} /> {relativeTime(m.createdAt)}
                        </span>
                      </span>
                      <QtyDelta qty={m.qty} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
