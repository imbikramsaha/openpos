import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { BarList, ChartCard } from '../charts'
import { margin, money, pct, qty } from '../format'
import { ReportTable, type RCol } from '../ReportTable'
import { categoryRows, productRows, type CategoryRow, type ProductRow } from '../rows'
import type { TabProps } from '../context'
import { NoData } from './Overview'

function marginTone(m: number, net: number) {
  if (!net) return ''
  return m < 0 ? 'text-danger' : m < 10 ? 'text-warning' : ''
}

export function ProductsTab({ data, report }: TabProps) {
  const { t } = useTranslation('reports')
  const [cat, setCat] = useState('')
  const rows = useMemo(() => productRows(data.cur, report.productMap, report.categoryMap, t('uncategorised')), [data.cur, report.productMap, report.categoryMap, t])
  const filtered = useMemo(() => (cat ? rows.filter((r) => (r.categoryId || 'none') === cat) : rows), [rows, cat])
  const totals = useMemo(() => {
    const s = { qty: 0, net: 0, cost: 0, profit: 0, tax: 0, total: 0 }
    for (const r of filtered) {
      s.qty += r.qty
      s.net += r.net
      s.cost += r.cost
      s.profit += r.profit
      s.tax += r.tax
      s.total += r.total
    }
    return { ...s, margin: margin(s.profit, s.net), share: data.cur.totals.net ? (s.net / data.cur.totals.net) * 100 : 0 }
  }, [filtered, data.cur.totals.net])
  const catOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of rows) seen.set(r.categoryId || 'none', r.category)
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const columns: RCol<ProductRow>[] = [
    { key: 'name', label: t('common:product'), value: (r) => r.name, render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.name}</div>{r.sku && <div className="text-xs text-subtle">{r.sku}</div>}</div> },
    { key: 'sku', label: 'SKU', value: (r) => r.sku, exportOnly: true },
    { key: 'category', label: t('common:category'), value: (r) => r.category, hideOnMobile: true },
    { key: 'qty', label: t('qtySold'), kind: 'qty', value: (r) => r.qty, text: (r) => `${qty(r.qty)} ${t(`common:unit.${r.unit}`)}`, render: (r) => `${qty(r.qty)} ${t(`common:unit.${r.unit}`)}` },
    { key: 'net', label: t('revenue'), kind: 'money', value: (r) => r.net, primary: true },
    { key: 'tax', label: t('common:tax'), kind: 'money', value: (r) => r.tax, exportOnly: true },
    { key: 'cost', label: t('common:cost'), kind: 'money', value: (r) => r.cost, hideOnMobile: true },
    { key: 'profit', label: t('common:profit'), kind: 'money', value: (r) => r.profit, render: (r) => <span className={cn(r.profit < 0 && 'text-danger')}>{money(r.profit)}</span> },
    { key: 'margin', label: t('common:margin'), kind: 'pct', value: (r) => r.margin, render: (r) => <span className={marginTone(r.margin, r.net)}>{pct(r.margin)}</span> },
    { key: 'share', label: t('share'), kind: 'pct', value: (r) => r.share, hideOnMobile: true },
  ]

  return (
    <ReportTable
      title={t('tabs.products')}
      subtitle={t('productsCount', { count: filtered.length })}
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.key}
      search={(r) => `${r.name} ${r.sku} ${r.category}`}
      initialSort={{ key: 'net', dir: 'desc' }}
      totals={{ qty: totals.qty, net: totals.net, tax: totals.tax, cost: totals.cost, profit: totals.profit, margin: totals.margin, share: totals.share }}
      filename="products"
      toolbar={catOptions.length > 1 && <Select value={cat} onChange={(e) => setCat(e.target.value)} options={catOptions} placeholder={t('allCategories')} wrapperClassName="w-full sm:w-56" aria-label={t('common:category')} />}
      mobile={(r) => (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1 truncate font-medium">{r.name}</div>
            <div className="tnum shrink-0 font-semibold">{money(r.net)}</div>
          </div>
          <div className="tnum mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{`${qty(r.qty)} ${t(`common:unit.${r.unit}`)}`}</span>
            <span>{t('common:profit')}: {money(r.profit)}</span>
            <span className={marginTone(r.margin, r.net)}>{pct(r.margin)}</span>
          </div>
        </>
      )}
    />
  )
}

export function CategoriesTab({ data, report }: TabProps) {
  const { t } = useTranslation('reports')
  const rows = useMemo(() => {
    const products = productRows(data.cur, report.productMap, report.categoryMap, t('uncategorised'))
    return categoryRows(products, report.categoryMap, data.cur.totals.net, t('uncategorised'))
  }, [data.cur, report.productMap, report.categoryMap, t])
  const tot = rows.reduce((s, r) => ({ qty: s.qty + r.qty, net: s.net + r.net, cost: s.cost + r.cost, profit: s.profit + r.profit, products: s.products + r.products }), { qty: 0, net: 0, cost: 0, profit: 0, products: 0 })

  const columns: RCol<CategoryRow>[] = [
    {
      key: 'name',
      label: t('common:category'),
      value: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="size-2.5 shrink-0 rounded-full border border-border" style={{ background: r.color ?? 'var(--surface-3)' }} />
          {r.name}
        </span>
      ),
    },
    { key: 'products', label: t('tabs.products'), kind: 'int', value: (r) => r.products, hideOnMobile: true },
    { key: 'qty', label: t('qtySold'), kind: 'qty', value: (r) => r.qty },
    { key: 'net', label: t('revenue'), kind: 'money', value: (r) => r.net, primary: true },
    { key: 'cost', label: t('common:cost'), kind: 'money', value: (r) => r.cost, hideOnMobile: true },
    { key: 'profit', label: t('common:profit'), kind: 'money', value: (r) => r.profit },
    { key: 'margin', label: t('common:margin'), kind: 'pct', value: (r) => r.margin, render: (r) => <span className={marginTone(r.margin, r.net)}>{pct(r.margin)}</span> },
    { key: 'share', label: t('share'), kind: 'pct', value: (r) => r.share },
  ]

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ChartCard title={t('byCategory')} subtitle={t('kpi.netSales')} className="xl:self-start">
        {rows.length ? <BarList rows={rows.slice(0, 12).map((c) => ({ key: c.key, label: c.name, title: c.name, value: c.net, display: money(c.net), sub: pct(c.share) }))} /> : <NoData />}
      </ChartCard>
      <ReportTable
        title={t('tabs.categories')}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        initialSort={{ key: 'net', dir: 'desc' }}
        totals={{ products: tot.products, qty: tot.qty, net: tot.net, cost: tot.cost, profit: tot.profit, margin: margin(tot.profit, tot.net), share: data.cur.totals.net ? (tot.net / data.cur.totals.net) * 100 : 0 }}
        filename="categories"
      />
    </div>
  )
}
