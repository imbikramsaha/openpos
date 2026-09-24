import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { History, Pencil, SlidersHorizontal } from 'lucide-react'
import type { Category, Product, StockMovement } from '@/core/types'
import { db } from '@/db/db'
import { round3 } from '@/db/repo'
import { formatDateTime } from '@/lib/dates'
import { formatMoney, formatQty } from '@/lib/money'
import { navigate } from '@/router'
import { Badge, Button, EmptyState } from '@/components/ui'
import { Metric, ProductThumb, ResponsivePanel } from '@/features/products/shared'
import { productColor, stockStatus } from '@/features/products/util'
import { AdjustDialog } from './AdjustDialog'
import { QtyDelta, TypeBadge } from './shared'

const PAGE = 50
const SALE_TYPES = new Set(['sale', 'refund', 'void'])

/** Stock card: current level, value and the product's movement ledger (newest first). */
export function StockCard({ productId, categories, onClose }: { productId: string | null; categories: Map<string, Category>; onClose: () => void }) {
  const { t } = useTranslation('inventory')
  const [limit, setLimit] = useState(PAGE)
  const [adjusting, setAdjusting] = useState(false)
  const product = useLiveQuery(() => (productId ? db.products.get(productId) : undefined), [productId])
  const movements = useLiveQuery(
    async () => (productId ? (await db.stockMovements.where('productId').equals(productId).toArray()).filter((m) => !m.deleted).sort((a, b) => b.createdAt - a.createdAt) : []),
    [productId],
  )
  const users = useLiveQuery(async () => new Map((await db.users.toArray()).map((u) => [u.id, u.name])), [])

  const shown = useMemo(() => (movements ?? []).slice(0, limit), [movements, limit])
  // Resolve document numbers only for the rows on screen.
  const refs = useLiveQuery(async () => {
    const saleIds = [...new Set(shown.filter((m) => m.refId && SALE_TYPES.has(m.type)).map((m) => m.refId!))]
    const purchaseIds = [...new Set(shown.filter((m) => m.refId && m.type === 'purchase').map((m) => m.refId!))]
    const [sales, purchases] = await Promise.all([db.sales.bulkGet(saleIds), db.purchases.bulkGet(purchaseIds)])
    const out = new Map<string, string>()
    for (const s of sales) if (s) out.set(s.id, s.number)
    for (const p of purchases) if (p) out.set(p.id, p.number)
    return out
  }, [shown])

  // Balance after each movement, walking back from the current level.
  const balances = useMemo(() => {
    const out: number[] = []
    let bal = product?.stock ?? 0
    for (const m of shown) {
      out.push(round3(bal))
      bal -= m.qty
    }
    return out
  }, [shown, product?.stock])

  const openRef = (m: StockMovement) => {
    if (!m.refId) return
    if (m.type === 'purchase') navigate(`inventory/purchases/${m.refId}`)
    else if (SALE_TYPES.has(m.type)) navigate(`sales/${m.refId}`)
  }

  const status = product ? stockStatus(product) : 'ok'
  const qty = Math.max(product?.stock ?? 0, 0)
  const unit = product && product.unit !== 'pcs' ? t(`common:unit.${product.unit}`) : ''

  return (
    <ResponsivePanel
      open={!!productId}
      onClose={onClose}
      title={t('card.title')}
      width="sm:w-[600px]"
      footer={
        product && (
          <>
            <Button icon={<Pencil className="size-4" />} onClick={() => navigate(`products?edit=${product.id}`)} className="me-auto">
              {t('card.editProduct')}
            </Button>
            <Button variant="primary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting(true)} disabled={!product.trackStock}>
              {t('card.adjust')}
            </Button>
          </>
        )
      }
    >
      {product && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <ProductThumb product={product} color={productColor(product, categories)} size="lg" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-lg font-semibold">{product.name}</h3>
              <p className="truncate text-sm text-muted">{[product.sku, product.barcode, product.categoryId && categories.get(product.categoryId)?.name].filter(Boolean).join(' · ') || '—'}</p>
              {!product.trackStock && <Badge className="mt-1">{t('card.untracked')}</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric
              label={t('card.onHand')}
              value={`${formatQty(product.stock)}${unit ? ` ${unit}` : ''}`}
              tone={status === 'out' ? 'danger' : status === 'low' ? 'warning' : undefined}
            />
            <Metric label={t('card.reorderLevel')} value={product.reorderLevel !== undefined ? formatQty(product.reorderLevel) : '—'} />
            <Metric label={t('card.valueCost')} value={formatMoney(Math.round(qty * product.cost))} />
            <Metric label={t('card.valueRetail')} value={formatMoney(Math.round(qty * product.price))} />
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{t('card.history', { count: movements?.length ?? 0 })}</h4>
            {movements && !movements.length ? (
              <EmptyState icon={<History />} title={t('card.noMovements')} description={t('card.noMovementsHint')} className="py-8" />
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {shown.map((m, i) => {
                  const ref = m.refId ? refs?.get(m.refId) : undefined
                  return (
                    <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <TypeBadge type={m.type} />
                          {ref && (
                            <button onClick={() => openRef(m)} className="font-mono text-xs font-medium text-primary hover:underline">
                              {ref}
                            </button>
                          )}
                        </div>
                        {m.note && <div className="text-sm break-words">{m.note}</div>}
                        <div className="text-xs text-muted">
                          {formatDateTime(m.createdAt)}
                          {m.userId && users?.get(m.userId) ? ` · ${users.get(m.userId)}` : ''}
                          {m.cost !== undefined && m.type === 'purchase' ? ` · ${t('card.at', { cost: formatMoney(m.cost) })}` : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-end">
                        <QtyDelta qty={m.qty} className="text-base" />
                        <div className="tnum text-xs text-subtle">{t('card.balance', { qty: formatQty(balances[i]) })}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {movements && movements.length > limit && (
              <div className="mt-3 text-center">
                <Button size="sm" onClick={() => setLimit((l) => l + PAGE * 2)}>
                  {t('card.showOlder', { count: Math.min(PAGE * 2, movements.length - limit) })}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
      <AdjustDialog product={adjusting && product ? (product as Product) : null} onClose={() => setAdjusting(false)} />
    </ResponsivePanel>
  )
}
