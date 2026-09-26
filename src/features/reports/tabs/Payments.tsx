import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaymentMethod } from '@/core/types'
import { ChartCard, ColumnChart, ShareBar } from '../charts'
import { money, moneyCompact, share } from '../format'
import { bucketLabel, bucketRangeTitle } from '../range'
import { ReportTable, type RCol } from '../ReportTable'
import { methodColor, methodOrder, useReportMeta, type TabProps } from '../context'
import type { MethodAgg } from '../compute'
import { NoData } from './Overview'

interface DayRow {
  key: string
  ts: number
  title: string
  values: Partial<Record<PaymentMethod, number>>
  total: number
}

export function PaymentsTab({ data }: TabProps) {
  const { t } = useTranslation('reports')
  const { settings } = useReportMeta()
  const { cur } = data
  const order = methodOrder(settings)
  const methods = order.map((m) => cur.methods.get(m)).filter((m): m is MethodAgg => !!m)
  const used = methods.map((m) => m.method)
  const total = methods.reduce((a, m) => a + Math.max(0, m.net), 0)
  const label = (m: PaymentMethod) => t(`common:payment.${m}`)
  const now = Date.now()

  const days: DayRow[] = useMemo(
    () =>
      data.starts
        .map((s, i) => {
          const b = cur.buckets[i]
          return { key: String(s), ts: s, title: bucketRangeTitle(data.starts, i, data.granularity, data.from, data.to), values: b.methods, total: Object.values(b.methods).reduce((a, v) => a + (v ?? 0), 0) }
        })
        .filter((r) => r.ts <= now),
    [data, cur, now],
  )

  const methodCols: RCol<MethodAgg>[] = [
    {
      key: 'method',
      label: t('method'),
      value: (r) => label(r.method),
      render: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <span className="kviz size-2.5 shrink-0 rounded-[3px]" style={{ background: methodColor(r.method, order) }} />
          {label(r.method)}
        </span>
      ),
    },
    { key: 'count', label: t('kpi.transactions'), kind: 'int', value: (r) => r.count },
    { key: 'sales', label: t('payments.received'), kind: 'money', value: (r) => r.sales, hideOnMobile: true },
    { key: 'refunds', label: t('kpi.refunds'), kind: 'money', value: (r) => r.refunds, hideOnMobile: true },
    { key: 'net', label: t('payments.net'), kind: 'money', value: (r) => r.net, primary: true },
    { key: 'share', label: t('share'), kind: 'pct', value: (r) => share(Math.max(0, r.net), total) },
  ]
  const dayCols: RCol<DayRow>[] = [
    { key: 'date', label: t('period'), value: (r) => r.ts, text: (r) => r.title, csv: (r) => r.title, render: (r) => <span className="whitespace-nowrap">{r.title}</span> },
    ...used.map<RCol<DayRow>>((m) => ({ key: m, label: label(m), kind: 'money', value: (r) => r.values[m] ?? 0 })),
    { key: 'total', label: t('common:total'), kind: 'money', value: (r) => r.total, primary: true },
  ]
  const dayTotals: Record<string, number> = { total: days.reduce((a, r) => a + r.total, 0) }
  for (const m of used) dayTotals[m] = days.reduce((a, r) => a + (r.values[m] ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ChartCard title={t('payments.title')} subtitle={t('payments.subtitle')}>
          {methods.length ? (
            <ShareBar
              ariaLabel={t('payments.title')}
              items={methods.map((m) => ({ key: m.method, label: label(m.method), value: m.net, color: methodColor(m.method, order), display: money(m.net), sub: t('salesCount', { count: m.count }) }))}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
        <ChartCard
          title={t('payments.byDay')}
          subtitle={t(`trend.by.${data.granularity}`)}
          table={{ head: [t('period'), ...used.map(label), t('common:total')], numeric: used.map((_, i) => i + 1).concat(used.length + 1), rows: days.map((d) => [d.title, ...used.map((m) => money(d.values[m] ?? 0)), money(d.total)]) }}
        >
          {used.length ? (
            <ColumnChart
              data={days.map((d) => ({ label: bucketLabel(d.ts, data.granularity), title: d.title, values: used.map((m) => d.values[m] ?? 0) }))}
              series={used.map((m) => ({ key: m, label: label(m), color: methodColor(m, order) }))}
              format={money}
              axis={moneyCompact}
              totalLabel={t('common:total')}
              ariaLabel={t('payments.byDay')}
              height={240}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>
      </div>
      <ReportTable
        title={t('payments.byMethod')}
        rows={methods}
        columns={methodCols}
        rowKey={(r) => r.method}
        initialSort={{ key: 'net', dir: 'desc' }}
        totals={{ count: cur.totals.sales, sales: methods.reduce((a, m) => a + m.sales, 0), refunds: methods.reduce((a, m) => a + m.refunds, 0), net: methods.reduce((a, m) => a + m.net, 0) }}
        filename="payments-by-method"
      />
      <ReportTable title={t('payments.byDay')} rows={days} columns={dayCols} rowKey={(r) => r.key} initialSort={{ key: 'date', dir: 'asc' }} totals={dayTotals} filename="payments-by-day" />
    </div>
  )
}
