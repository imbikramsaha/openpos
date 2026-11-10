import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Boxes, Building2, ClipboardCheck, FileDown, LayoutDashboard, Plus, Truck } from 'lucide-react'
import { db } from '@/db/db'
import { downloadText } from '@/lib/download'
import { navigate, useRoute } from '@/router'
import { toast } from '@/stores/ui'
import { Button, FullScreenLoader, Page, PageBody, PageHeader, Tabs } from '@/components/ui'
import { ActionMenu } from '@/features/products/shared'
import { byName, categoryMap, fileDate, stockStatus } from '@/features/products/util'
import { Overview } from './Overview'
import { StockList, DEFAULT_STOCK_STATE, type StockListState } from './StockList'
import { StockCard } from './StockCard'
import { PurchaseDetail, PurchaseList } from './Purchases'
import { PurchaseForm } from './PurchaseForm'
import { SupplierList } from './Suppliers'
import { StockTake } from './StockTake'
import { lowStockCsv, soldSince, valuationCsv } from './service'

// Stock screen. Routes: #/inventory (overview), /stock, /purchases, /purchases/new,
// /purchases/<id>, /suppliers, /count. Any of them accepts ?product=<id> to open a stock card.

type Tab = 'overview' | 'stock' | 'purchases' | 'suppliers' | 'count'
const TABS: Tab[] = ['overview', 'stock', 'purchases', 'suppliers', 'count']

export default function InventoryScreen() {
  const { t } = useTranslation('inventory')
  const route = useRoute()
  const [first, second] = route.sub.split('/')
  const tab: Tab = TABS.includes(first as Tab) ? (first as Tab) : 'overview'
  const base = route.sub ? `inventory/${route.sub}` : 'inventory'

  const products = useLiveQuery(async () => (await db.products.toArray()).filter((p) => !p.deleted), [])
  const categories = useLiveQuery(async () => (await db.categories.orderBy('sortOrder').toArray()).filter((c) => !c.deleted), [])
  const catMap = useMemo(() => categoryMap(categories), [categories])
  const [stockState, setStockState] = useState<StockListState>(DEFAULT_STOCK_STATE)
  const [creatingSupplier, setCreatingSupplier] = useState(false)

  const statusParam = route.params.get('status')
  useEffect(() => {
    if (statusParam === 'low' || statusParam === 'out') setStockState((s) => ({ ...s, status: statusParam }))
  }, [statusParam])

  const productId = route.params.get('product')
  const openCard = (id: string) => navigate(`${base}?product=${id}`)
  const closeCard = () => navigate(base)

  const tracked = useMemo(() => (products ?? []).filter((p) => p.trackStock).sort(byName), [products])
  const exportValuation = () => {
    if (downloadText(`stock-valuation-${fileDate()}.csv`, valuationCsv(tracked, catMap), 'text/csv')) toast(t('exported'))
  }
  const exportLow = async () => {
    const low = tracked.filter((p) => p.active && ['low', 'out'].includes(stockStatus(p)))
    if (downloadText(`low-stock-${fileDate()}.csv`, lowStockCsv(low, catMap, await soldSince(30)), 'text/csv')) toast(t('exported'))
  }

  if (!products || !categories) return <FullScreenLoader />
  if (tab === 'purchases' && second === 'new') return <PurchaseForm products={products} params={route.params} />
  if (tab === 'purchases' && second) return <PurchaseDetail id={second} />

  const exportMenu = [
    { icon: <FileDown />, label: t('exportValuation'), onClick: exportValuation },
    { icon: <FileDown />, label: t('exportLowStock'), onClick: exportLow },
  ]

  const actions: Record<Tab, ReactNode> = {
    overview: (
      <>
        <Button icon={<ClipboardCheck className="size-4" />} onClick={() => navigate('inventory/count')} className="max-sm:hidden">
          {t('tabs.count')}
        </Button>
        <ActionMenu label={t('common:export')} items={exportMenu} />
        <Button variant="primary" icon={<Truck className="size-4" />} onClick={() => navigate('inventory/purchases/new')}>
          {t('purchases.new')}
        </Button>
      </>
    ),
    stock: (
      <>
        <ActionMenu label={t('common:export')} items={exportMenu} />
        <Button variant="primary" icon={<ClipboardCheck className="size-4" />} onClick={() => navigate('inventory/count')}>
          {t('tabs.count')}
        </Button>
      </>
    ),
    purchases: (
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('inventory/purchases/new')}>
        {t('purchases.new')}
      </Button>
    ),
    suppliers: (
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreatingSupplier(true)}>
        {t('suppliers.new')}
      </Button>
    ),
    count: null,
  }

  return (
    <Page>
      <PageHeader title={t('title')} subtitle={t(`subtitle.${tab}`)} actions={actions[tab]}>
        <Tabs
          value={tab}
          onChange={(v) => navigate(v === 'overview' ? 'inventory' : `inventory/${v}`)}
          className="-mb-3"
          tabs={[
            { id: 'overview', label: t('tabs.overview'), icon: <LayoutDashboard /> },
            { id: 'stock', label: t('tabs.stock'), icon: <Boxes /> },
            { id: 'purchases', label: t('tabs.purchases'), icon: <Truck /> },
            { id: 'suppliers', label: t('tabs.suppliers'), icon: <Building2 /> },
            { id: 'count', label: t('tabs.count'), icon: <ClipboardCheck /> },
          ]}
        />
      </PageHeader>
      <PageBody>
        {tab === 'overview' && <Overview products={products} categories={catMap} onOpen={openCard} />}
        {tab === 'stock' && <StockList products={products} categories={catMap} state={stockState} onState={setStockState} onOpen={openCard} />}
        {tab === 'purchases' && <PurchaseList />}
        {tab === 'suppliers' && <SupplierList creating={creatingSupplier} onCreatingChange={setCreatingSupplier} />}
        {tab === 'count' && <StockTake products={products} categories={catMap} />}
      </PageBody>
      <StockCard productId={productId} categories={catMap} onClose={closeCard} />
    </Page>
  )
}
