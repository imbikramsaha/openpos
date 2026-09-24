import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { Avatar } from '@/components/ui'
import { BarList, ChartCard } from '../charts'
import { int, money } from '../format'
import { ReportTable, type RCol } from '../ReportTable'
import type { TabProps } from '../context'
import type { StaffAgg } from '../compute'
import { NoData } from './Overview'

interface StaffRow extends StaffAgg {
  avg: number
  color?: string
}

export function StaffTab({ data }: TabProps) {
  const { t } = useTranslation('reports')
  const users = useLiveQuery(() => db.users.toArray(), [])
  const rows: StaffRow[] = useMemo(() => {
    const byId = new Map((users ?? []).map((u) => [u.id, u]))
    return [...data.cur.staff.values()].map((s) => ({ ...s, name: byId.get(s.userId)?.name ?? s.name, color: byId.get(s.userId)?.color, avg: s.count ? (s.total - s.refunds) / s.count : 0 }))
  }, [data.cur.staff, users])
  const sum = (f: (r: StaffRow) => number) => rows.reduce((a, r) => a + f(r), 0)
  const totalSales = sum((r) => r.count)

  const columns: RCol<StaffRow>[] = [
    {
      key: 'name',
      label: t('common:user'),
      value: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-2 font-medium">
          <Avatar name={r.name} color={r.color} size="sm" />
          {r.name}
        </span>
      ),
    },
    { key: 'count', label: t('kpi.transactions'), kind: 'int', value: (r) => r.count },
    { key: 'net', label: t('kpi.netSales'), kind: 'money', value: (r) => r.net, primary: true },
    { key: 'total', label: t('inclTax'), kind: 'money', value: (r) => r.total, hideOnMobile: true },
    { key: 'avg', label: t('kpi.avgTicket'), kind: 'money', value: (r) => r.avg },
    { key: 'refundsCount', label: t('staff.refunds'), kind: 'int', value: (r) => r.refundsCount, hideOnMobile: true },
    { key: 'refunds', label: t('staff.refundValue'), kind: 'money', value: (r) => r.refunds },
    { key: 'discounts', label: t('staff.discounts'), kind: 'money', value: (r) => r.discounts },
    { key: 'voids', label: t('staff.voids'), kind: 'int', value: (r) => r.voids, render: (r) => <span className={r.voids ? 'font-semibold text-warning' : ''}>{int(r.voids)}</span> },
    { key: 'voidsAmount', label: t('staff.voidValue'), kind: 'money', value: (r) => r.voidsAmount, exportOnly: true },
  ]

  return (
    <div className="space-y-4">
      {rows.length > 1 && (
        <ChartCard title={t('byCashier')} subtitle={t('kpi.netSales')}>
          <BarList rows={[...rows].sort((a, b) => b.net - a.net).map((r) => ({ key: r.userId, label: r.name, value: r.net, display: money(r.net), sub: t('salesCount', { count: r.count }) }))} />
        </ChartCard>
      )}
      <ReportTable
        title={t('tabs.staff')}
        subtitle={t('staff.hint')}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.userId}
        search={(r) => r.name}
        initialSort={{ key: 'net', dir: 'desc' }}
        totals={{ count: totalSales, net: sum((r) => r.net), total: sum((r) => r.total), avg: totalSales ? (sum((r) => r.total) - sum((r) => r.refunds)) / totalSales : 0, refundsCount: sum((r) => r.refundsCount), refunds: sum((r) => r.refunds), discounts: sum((r) => r.discounts), voids: sum((r) => r.voids), voidsAmount: sum((r) => r.voidsAmount) }}
        filename="staff"
        empty={<NoData />}
      />
    </div>
  )
}
