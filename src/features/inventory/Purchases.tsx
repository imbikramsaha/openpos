import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, FileSearch, Plus, Printer, Truck } from 'lucide-react'
import type { Purchase } from '@/core/types'
import { db } from '@/db/db'
import { formatDate, formatDateTime } from '@/lib/dates'
import { formatMoney, formatQty } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { navigate } from '@/router'
import { useSettings } from '@/stores/settings'
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, FullScreenLoader, KeyValue, Page, PageBody, PageHeader, SearchInput, type Column } from '@/components/ui'
import { PAGE_SIZE } from '@/features/products/util'
import { purchaseHtml } from './purchasePrint'
import { lineTotal } from './service'

export function PaidBadge({ p }: { p: Pick<Purchase, 'paid' | 'total'> }) {
  const { t } = useTranslation('inventory')
  if (p.paid >= p.total) return <Badge tone="success">{t('purchases.paid')}</Badge>
  if (p.paid > 0) return <Badge tone="warning">{t('purchases.partial')}</Badge>
  return <Badge tone="danger">{t('purchases.unpaid')}</Badge>
}

export function PurchaseList() {
  const { t } = useTranslation('inventory')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const query = useDeferredValue(q)
  const purchases = useLiveQuery(async () => (await db.purchases.orderBy('createdAt').reverse().toArray()).filter((p) => !p.deleted), [])

  const rows = useMemo(() => {
    const s = query.trim().toLowerCase()
    const list = purchases ?? []
    if (!s) return list
    return list.filter((p) => p.number.toLowerCase().includes(s) || p.supplierName?.toLowerCase().includes(s) || p.invoiceNo?.toLowerCase().includes(s) || p.lines.some((l) => l.name.toLowerCase().includes(s)))
  }, [purchases, query])

  const columns: Column<Purchase>[] = [
    { key: 'number', header: t('purchases.number'), render: (p) => <span className="font-mono text-sm font-medium">{p.number}</span> },
    { key: 'date', header: t('common:date'), render: (p) => <span className="whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</span> },
    { key: 'supplier', header: t('common:supplier'), render: (p) => p.supplierName ?? <span className="text-subtle">—</span> },
    { key: 'invoice', header: t('purchases.invoiceNo'), render: (p) => p.invoiceNo ?? <span className="text-subtle">—</span>, className: 'hidden lg:table-cell' },
    { key: 'items', header: t('common:items'), align: 'end', render: (p) => <span className="tnum text-muted">{p.lines.length}</span>, className: 'hidden lg:table-cell' },
    { key: 'total', header: t('common:total'), align: 'end', render: (p) => <span className="tnum font-semibold">{formatMoney(p.total)}</span> },
    { key: 'status', header: t('common:status'), align: 'end', render: (p) => <PaidBadge p={p} /> },
  ]

  if (!purchases) return <FullScreenLoader />
  if (!purchases.length) {
    return (
      <EmptyState
        icon={<Truck />}
        title={t('purchases.empty')}
        description={t('purchases.emptyHint')}
        action={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('inventory/purchases/new')}>
            {t('purchases.new')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder={t('purchases.search')} className="lg:max-w-md" />
      <DataTable
        rows={rows.slice(0, limit)}
        columns={columns}
        rowKey={(p) => p.id}
        onRowClick={(p) => navigate(`inventory/purchases/${p.id}`)}
        empty={<EmptyState icon={<FileSearch />} title={t('common:noResults')} />}
        mobile={(p) => (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.supplierName ?? t('purchases.noSupplier')}</div>
              <div className="truncate text-xs text-muted">
                <span className="font-mono">{p.number}</span> · {formatDate(p.createdAt)} · {t('purchases.lines', { count: p.lines.length })}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="tnum font-semibold">{formatMoney(p.total)}</span>
              <PaidBadge p={p} />
            </div>
          </div>
        )}
      />
      {rows.length > limit && (
        <div className="text-center">
          <Button onClick={() => setLimit((l) => l + PAGE_SIZE * 2)}>{t('products:showMore', { count: Math.min(PAGE_SIZE * 2, rows.length - limit) })}</Button>
        </div>
      )}
    </div>
  )
}

export function PurchaseDetail({ id }: { id: string }) {
  const { t } = useTranslation('inventory')
  const settings = useSettings((s) => s.settings)
  const purchase = useLiveQuery(async () => (await db.purchases.get(id)) ?? null, [id])
  const supplier = useLiveQuery(async () => (purchase?.supplierId ? await db.suppliers.get(purchase.supplierId) : undefined), [purchase?.supplierId])
  const user = useLiveQuery(async () => (purchase ? await db.users.get(purchase.userId) : undefined), [purchase?.userId])

  const back = () => navigate('inventory/purchases')
  if (purchase === undefined) return <FullScreenLoader />
  if (!purchase || purchase.deleted) {
    return (
      <Page>
        <PageHeader title={t('purchases.title')} onBack={back} />
        <EmptyState icon={<FileSearch />} title={t('purchases.notFoundDoc')} />
      </Page>
    )
  }
  const due = purchase.total - purchase.paid
  const print = () => printHtml(purchaseHtml(purchase, settings, supplier, user?.name))

  return (
    <Page>
      <PageHeader
        title={purchase.number}
        subtitle={[purchase.supplierName, formatDateTime(purchase.createdAt)].filter(Boolean).join(' · ')}
        onBack={back}
        actions={
          <>
            <Button icon={<Copy className="size-4" />} onClick={() => navigate(`inventory/purchases/new?from=${purchase.id}`)}>
              {t('purchases.repeat')}
            </Button>
            <Button variant="primary" icon={<Printer className="size-4" />} onClick={print}>
              {t('common:print')}
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <CardHeader title={t('purchases.lines', { count: purchase.lines.length })} />
            <ul className="divide-y divide-border">
              {purchase.lines.map((l, i) => (
                <li key={`${l.productId}-${i}`} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <button onClick={() => navigate(`inventory/stock?product=${l.productId}`)} className="block max-w-full truncate text-start font-medium hover:text-primary">
                      {l.name}
                    </button>
                    <div className="tnum text-xs text-muted">
                      {formatQty(l.qty)} × {formatMoney(l.cost)}
                    </div>
                  </div>
                  <span className="tnum font-semibold">{formatMoney(lineTotal(l))}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-border bg-surface-2 px-5 py-3">
              <KeyValue label={t('common:total')} value={formatMoney(purchase.total)} strong />
              <KeyValue label={t('purchases.paidAmount')} value={formatMoney(purchase.paid)} />
              {due > 0 && <KeyValue label={t('purchases.due')} value={<span className="font-semibold text-danger">{formatMoney(due)}</span>} />}
            </div>
          </Card>
          <Card className="h-fit p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">{t('common:details')}</h3>
              <PaidBadge p={purchase} />
            </div>
            <KeyValue label={t('common:supplier')} value={purchase.supplierName ?? '—'} />
            {supplier?.phone && <KeyValue label={t('common:phone')} value={supplier.phone} />}
            <KeyValue label={t('purchases.invoiceNo')} value={purchase.invoiceNo ?? '—'} />
            <KeyValue label={t('common:date')} value={formatDateTime(purchase.createdAt)} />
            <KeyValue label={t('purchases.receivedBy')} value={user?.name ?? '—'} />
            {purchase.note && (
              <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
                <div className="mb-1 text-xs font-medium text-muted">{t('common:note')}</div>
                {purchase.note}
              </div>
            )}
          </Card>
        </div>
      </PageBody>
    </Page>
  )
}
