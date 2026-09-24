import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Inbox } from 'lucide-react'
import { navigate } from '@/router'
import { Button, EmptyState, Segmented } from '@/components/ui'
import { formatMoney } from '@/lib/money'
import { BarList, ChartCard, ColumnChart, Heatmap, KpiTile, LineChart, ShareBar, Sparkline, ACCENT, type LinePoint } from '../charts'
import { int, intCompact, money, moneyCompact, moneyWhole, pct, qty, share } from '../format'
import { bucketLabel, bucketTitle, hourLabel, hourRangeLabel, weekdays } from '../range'
import { methodColor, methodOrder, terminalLabel, useReportMeta, type TabProps } from '../context'
import { categoryRows, productRows } from '../rows'

type Metric = 'net' | 'count' | 'profit'

export function OverviewTab({ data, report }: TabProps) {
  const { t } = useTranslation('reports')
  const { settings } = useReportMeta()
  const { cur, prev } = data
  const T = cur.totals
  const P = prev.totals
  const [metric, setMetric] = useState<Metric>('net')
  const [hourView, setHourView] = useState<'hours' | 'heat'>('hours')
  const [topBy, setTopBy] = useState<'net' | 'qty'>('net')
  const empty = !T.sales && !T.refundsCount && !T.voids
  const avg = T.sales ? T.salesTotal / T.sales : 0
  const prevAvg = P.sales ? P.salesTotal / P.sales : 0
  const marginPct = T.net ? (T.profit / T.net) * 100 : 0
  const now = Date.now()

  const metricFmt = metric === 'count' ? int : money
  const metricAxis = metric === 'count' ? intCompact : moneyCompact
  const points: LinePoint[] = useMemo(
    () =>
      data.starts.map((s, i) => {
        const b = cur.buckets[i]
        const pb = prev.buckets[i]
        const v = (x: typeof b) => (metric === 'net' ? x.net : metric === 'count' ? x.count : x.profit)
        return {
          label: bucketLabel(s, data.granularity),
          title: bucketTitle(s, data.granularity),
          cur: s > now ? null : v(b),
          prev: pb ? v(pb) : null,
          prevTitle: data.prevStarts[i] !== undefined ? bucketTitle(data.prevStarts[i], data.granularity) : undefined,
        }
      }),
    [data, cur, prev, metric, now],
  )

  const products = useMemo(() => productRows(cur, report.productMap, report.categoryMap, t('uncategorised')), [cur, report.productMap, report.categoryMap, t])
  const top = useMemo(() => [...products].sort((a, b) => (topBy === 'net' ? b.net - a.net : b.qty - a.qty)).slice(0, 10), [products, topBy])
  const cats = useMemo(() => categoryRows(products, report.categoryMap, T.net, t('uncategorised')), [products, report.categoryMap, T.net, t])
  const order = methodOrder(settings)
  const methods = order.map((m) => cur.methods.get(m)).filter((m): m is NonNullable<typeof m> => !!m && (m.net !== 0 || m.count > 0))
  const staff = [...cur.staff.values()].filter((s) => s.count || s.refundsCount).sort((a, b) => b.net - a.net)
  const terminals = [...cur.terminals.values()].sort((a, b) => b.net - a.net)

  // Hours with activity (at least 8 columns), so a 9-to-9 shop does not show empty nights.
  const hourSpan = useMemo(() => {
    let first = 24
    let last = -1
    cur.hours.forEach((h, i) => {
      if (h.count || h.net) {
        first = Math.min(first, i)
        last = Math.max(last, i)
      }
    })
    if (last < 0) return [9, 21]
    while (last - first < 7) {
      if (first > 0) first--
      if (last - first < 7 && last < 23) last++
    }
    return [first, last]
  }, [cur.hours])
  const hours = Array.from({ length: hourSpan[1] - hourSpan[0] + 1 }, (_, i) => hourSpan[0] + i)
  const busiest = cur.hours.reduce((best, h, i) => (h.net > cur.hours[best].net ? i : best), 0)
  const days = weekdays(settings.numberLocale || 'en')

  const kpiSpark = <Sparkline values={data.starts.map((s, i) => (s > now ? null : cur.buckets[i].net))} />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          hero
          className="col-span-2"
          label={t('kpi.netSales')}
          value={moneyWhole(T.net)}
          title={formatMoney(T.net)}
          cur={T.net}
          prev={P.net}
          prevDisplay={moneyWhole(P.net)}
          sub={t('kpi.collected', { value: moneyWhole(T.total) })}
          spark={kpiSpark}
        />
        <KpiTile label={t('kpi.transactions')} value={int(T.sales)} cur={T.sales} prev={P.sales} prevDisplay={int(P.sales)} spark={<Sparkline values={data.starts.map((s, i) => (s > now ? null : cur.buckets[i].count))} />} />
        <KpiTile
          label={t('kpi.avgTicket')}
          value={moneyWhole(avg)}
          title={formatMoney(Math.round(avg))}
          cur={avg}
          prev={prevAvg}
          prevDisplay={moneyWhole(prevAvg)}
          spark={<Sparkline values={data.starts.map((s, i) => (s > now || !cur.buckets[i].count ? null : cur.buckets[i].total / cur.buckets[i].count))} />}
        />
        <KpiTile label={t('kpi.grossProfit')} value={moneyWhole(T.profit)} title={formatMoney(T.profit)} cur={T.profit} prev={P.profit} sub={t('kpi.margin', { value: pct(marginPct) })} />
        <KpiTile label={t('kpi.tax')} value={moneyWhole(T.tax)} title={formatMoney(T.tax)} cur={T.tax} prev={P.tax} good="none" prevDisplay={moneyWhole(P.tax)} />
        <KpiTile label={t('kpi.discounts')} value={moneyWhole(T.discounts)} title={formatMoney(T.discounts)} cur={T.discounts} prev={P.discounts} good="down" sub={T.salesTotal ? t('kpi.ofSales', { value: pct(share(T.discounts, T.salesTotal + T.discounts)) }) : undefined} />
        <KpiTile
          label={t('kpi.refunds')}
          value={moneyWhole(Math.abs(T.refunds))}
          title={formatMoney(Math.abs(T.refunds))}
          cur={Math.abs(T.refunds)}
          prev={Math.abs(P.refunds)}
          good="down"
          sub={[t('refundsCount', { count: T.refundsCount }), T.voids ? t('voidsCount', { count: T.voids }) : ''].filter(Boolean).join(' · ')}
        />
      </div>

      {empty && (
        <EmptyState icon={<Inbox />} title={t('noSales')} description={t('noSalesHint')} className="rounded-2xl border border-dashed border-border py-10" />
      )}

      <ChartCard
        title={t('trend.title')}
        subtitle={t(`trend.by.${data.granularity}`)}
        actions={
          <Segmented
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'net', label: t('kpi.netSales') },
              { value: 'count', label: t('kpi.transactions') },
              { value: 'profit', label: t('kpi.grossProfit') },
            ]}
          />
        }
        table={{
          head: [t('period'), t('thisPeriod'), t('previousPeriod'), t('change')],
          numeric: [1, 2, 3],
          rows: points.map((p) => [p.title, p.cur === null ? '—' : metricFmt(p.cur), p.prev === null || p.prev === undefined ? '—' : metricFmt(p.prev), p.cur !== null && p.prev ? `${pct(((p.cur - p.prev) / Math.abs(p.prev)) * 100)}` : '—']),
        }}
      >
        <LineChart points={points} format={metricFmt} axis={metricAxis} curLabel={t('thisPeriod')} prevLabel={t('previousPeriod')} ariaLabel={t('trend.aria')} height={260} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.granularity !== 'hour' && (
          <ChartCard
            title={t('hours.title')}
            subtitle={cur.hours[busiest].net > 0 ? t('hours.busiest', { hour: hourRangeLabel(busiest) }) : t('hours.subtitle')}
            actions={
              <Segmented
                size="sm"
                value={hourView}
                onChange={setHourView}
                options={[
                  { value: 'hours', label: t('hours.byHour') },
                  { value: 'heat', label: t('hours.byWeekday') },
                ]}
              />
            }
            table={{
              head: [t('hour'), t('kpi.netSales'), t('kpi.transactions')],
              numeric: [1, 2],
              rows: hours.map((h) => [hourRangeLabel(h), money(cur.hours[h].net), int(cur.hours[h].count)]),
            }}
          >
            {hourView === 'hours' ? (
              <ColumnChart
                data={hours.map((h) => ({ label: hourLabel(h), title: hourRangeLabel(h), values: [cur.hours[h].net], note: t('salesCount', { count: cur.hours[h].count }) }))}
                series={[{ key: 'net', label: t('kpi.netSales'), color: ACCENT }]}
                format={money}
                axis={moneyCompact}
                ariaLabel={t('hours.title')}
              />
            ) : (
              <Heatmap
                rows={days.map(([d, label]) => ({ label, title: weekdays(settings.numberLocale || 'en', 'long').find(([x]) => x === d)?.[1] ?? label, values: hours.map((h) => cur.heat[d][h]), counts: hours.map((h) => cur.heatCount[d][h]) }))}
                cols={hours.map(hourLabel)}
                colTitles={hours.map(hourRangeLabel)}
                format={money}
                countLabel={(n) => t('salesCount', { count: n })}
                lessLabel={t('less')}
                moreLabel={t('more')}
                ariaLabel={t('hours.heatAria')}
              />
            )}
          </ChartCard>
        )}

        <ChartCard title={t('payments.title')} subtitle={t('payments.subtitle')} actions={<ViewAll to="payments" />}>
          {methods.length ? (
            <ShareBar
              ariaLabel={t('payments.title')}
              items={methods.map((m) => ({
                key: m.method,
                label: t(`common:payment.${m.method}`),
                value: m.net,
                color: methodColor(m.method, order),
                display: money(m.net),
                sub: t('salesCount', { count: m.count }),
              }))}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard
          title={t('topProducts')}
          actions={
            <>
              <Segmented
                size="sm"
                value={topBy}
                onChange={setTopBy}
                options={[
                  { value: 'net', label: t('revenue') },
                  { value: 'qty', label: t('common:quantity') },
                ]}
              />
              <ViewAll to="products" />
            </>
          }
        >
          {top.length ? (
            <BarList
              rows={top.map((p) => ({
                key: p.key,
                label: p.name,
                title: p.name,
                value: topBy === 'net' ? p.net : p.qty,
                display: topBy === 'net' ? money(p.net) : `${qty(p.qty)} ${t(`common:unit.${p.unit}`)}`,
                sub: topBy === 'net' ? `${qty(p.qty)} ${t(`common:unit.${p.unit}`)}` : money(p.net),
              }))}
            />
          ) : (
            <NoData />
          )}
        </ChartCard>

        <ChartCard title={t('byCategory')} actions={<ViewAll to="categories" />}>
          {cats.length ? (
            <BarList rows={cats.slice(0, 10).map((c) => ({ key: c.key, label: c.name, title: c.name, value: c.net, display: money(c.net), sub: pct(c.share) }))} />
          ) : (
            <NoData />
          )}
        </ChartCard>

        {/* A single cashier or till would be a one-bar chart; the KPIs already say it. */}
        {staff.length > 1 && (
          <ChartCard title={t('byCashier')} actions={<ViewAll to="staff" />}>
            <BarList rows={staff.slice(0, 10).map((s) => ({ key: s.userId, label: s.name, title: s.name, value: s.net, display: money(s.net), sub: t('salesCount', { count: s.count }) }))} />
          </ChartCard>
        )}

        {terminals.length > 1 && (
          <ChartCard title={t('byTerminal')}>
            <BarList rows={terminals.map((x) => ({ key: x.deviceId, label: terminalLabel(x.deviceId, x.code), value: x.net, display: money(x.net), sub: t('salesCount', { count: x.count }) }))} />
          </ChartCard>
        )}
      </div>
    </div>
  )
}

function ViewAll({ to }: { to: string }) {
  const { t } = useTranslation('reports')
  return (
    <Button size="icon-sm" variant="ghost" onClick={() => navigate(`reports/${to}`)} aria-label={t('viewAll')} title={t('viewAll')}>
      <ChevronRight className="size-4 rtl:rotate-180" />
    </Button>
  )
}

export function NoData() {
  const { t } = useTranslation('reports')
  return <p className="py-8 text-center text-sm text-subtle">{t('noData')}</p>
}
