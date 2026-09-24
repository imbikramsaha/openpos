import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMoney } from '@/lib/money'
import { Badge, Segmented } from '@/components/ui'
import { KpiTile } from '../charts'
import { int, moneyWhole, qty } from '../format'
import { ReportTable, type RCol } from '../ReportTable'
import type { TabProps } from '../context'
import type { Unit } from '@/core/types'

// Stock valuation and low-stock list. Independent of the date range (it is "now").

interface StockRow {
  id: string
  name: string
  sku: string
  category: string
  unit: Unit
  stock: number
  reorder: number
  cost: number
  price: number
  costValue: number
  retailValue: number
  status: 'ok' | 'low' | 'out'
}

type Filter = 'all' | 'low' | 'out'

export function InventoryTab({ report }: TabProps) {
  const { t } = useTranslation('reports')
  const [filter, setFilter] = useState<Filter>('all')
  const rows: StockRow[] = useMemo(
    () =>
      report.products
        .filter((p) => p.trackStock)
        .map((p) => {
          const stock = p.stock ?? 0
          const reorder = p.reorderLevel ?? 0
          const on = Math.max(0, stock)
          return {
            id: p.id,
            name: p.name,
            sku: p.sku ?? '',
            category: (p.categoryId && report.categoryMap.get(p.categoryId)?.name) || t('uncategorised'),
            unit: p.unit,
            stock,
            reorder,
            cost: p.cost,
            price: p.price,
            costValue: Math.round(on * p.cost),
            retailValue: Math.round(on * p.price),
            status: stock <= 0 ? 'out' : stock <= reorder ? 'low' : 'ok',
          }
        }),
    [report.products, report.categoryMap, t],
  )
  const low = rows.filter((r) => r.status === 'low').length
  const out = rows.filter((r) => r.status === 'out').length
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter)
  const costTotal = rows.reduce((a, r) => a + r.costValue, 0)
  const retailTotal = rows.reduce((a, r) => a + r.retailValue, 0)
  const unit = (u: Unit) => t(`common:unit.${u}`)
  const statusBadge = (r: StockRow) =>
    r.status === 'out' ? <Badge tone="danger">{t('inventory.out')}</Badge> : r.status === 'low' ? <Badge tone="warning">{t('inventory.low')}</Badge> : <Badge tone="success">{t('inventory.ok')}</Badge>

  const columns: RCol<StockRow>[] = [
    { key: 'name', label: t('common:product'), value: (r) => r.name, render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.name}</div>{r.sku && <div className="text-xs text-subtle">{r.sku}</div>}</div> },
    { key: 'sku', label: 'SKU', value: (r) => r.sku, exportOnly: true },
    { key: 'category', label: t('common:category'), value: (r) => r.category, hideOnMobile: true },
    { key: 'status', label: t('common:status'), value: (r) => (r.status === 'out' ? 0 : r.status === 'low' ? 1 : 2), text: (r) => t(`inventory.${r.status}`), csv: (r) => t(`inventory.${r.status}`), render: statusBadge },
    { key: 'stock', label: t('inventory.inStock'), kind: 'qty', value: (r) => r.stock, render: (r) => <span className={r.stock <= 0 ? 'font-semibold text-danger' : ''}>{`${qty(r.stock)} ${unit(r.unit)}`}</span>, text: (r) => `${qty(r.stock)} ${unit(r.unit)}` },
    { key: 'reorder', label: t('inventory.reorderAt'), kind: 'qty', value: (r) => r.reorder, hideOnMobile: true },
    { key: 'cost', label: t('inventory.unitCost'), kind: 'money', value: (r) => r.cost, hideOnMobile: true },
    { key: 'costValue', label: t('inventory.costValue'), kind: 'money', value: (r) => r.costValue, primary: true },
    { key: 'retailValue', label: t('inventory.retailValue'), kind: 'money', value: (r) => r.retailValue },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={t('inventory.costValue')} value={moneyWhole(costTotal)} title={formatMoney(costTotal)} sub={t('inventory.products', { count: rows.length })} />
        <KpiTile label={t('inventory.retailValue')} value={moneyWhole(retailTotal)} title={formatMoney(retailTotal)} />
        <KpiTile label={t('inventory.potentialProfit')} value={moneyWhole(retailTotal - costTotal)} title={formatMoney(retailTotal - costTotal)} sub={retailTotal ? t('kpi.margin', { value: `${Math.round(((retailTotal - costTotal) / retailTotal) * 1000) / 10}%` }) : undefined} />
        <KpiTile label={t('inventory.needsAttention')} value={int(low + out)} sub={`${t('inventory.lowCount', { count: low })} · ${t('inventory.outCount', { count: out })}`} />
      </div>
      <ReportTable
        title={t('inventory.title')}
        subtitle={t('inventory.hint')}
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        search={(r) => `${r.name} ${r.sku} ${r.category}`}
        initialSort={{ key: filter === 'all' ? 'costValue' : 'stock', dir: filter === 'all' ? 'desc' : 'asc' }}
        totals={filter === 'all' ? { costValue: costTotal, retailValue: retailTotal } : undefined}
        filename={filter === 'all' ? 'stock-valuation' : filter === 'low' ? 'low-stock' : 'out-of-stock'}
        key={filter}
        toolbar={
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('common:all') },
              { value: 'low', label: `${t('inventory.low')} (${low})` },
              { value: 'out', label: `${t('inventory.out')} (${out})` },
            ]}
          />
        }
      />
    </div>
  )
}
