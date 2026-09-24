import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Customer } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney } from '@/lib/money'
import { formatDate } from '@/lib/dates'
import { KpiTile } from '../charts'
import { int, moneyWhole, pct, share } from '../format'
import { ReportTable, type RCol } from '../ReportTable'
import type { TabProps } from '../context'
import type { CustomerAgg } from '../compute'

export function CustomersTab({ data }: TabProps) {
  const { t } = useTranslation('reports')
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deleted).toArray(), [])
  const T = data.cur.totals
  const byId = useMemo(() => new Map((customers ?? []).map((c) => [c.id, c])), [customers])
  const top = useMemo(
    () => [...data.cur.customers.values()].map((c) => ({ ...c, name: byId.get(c.customerId)?.name ?? c.name, phone: byId.get(c.customerId)?.phone ?? c.phone })),
    [data.cur.customers, byId],
  )
  const dues = useMemo(() => (customers ?? []).filter((c) => c.balance > 0), [customers])
  const duesTotal = dues.reduce((a, c) => a + c.balance, 0)
  const repeat = top.filter((c) => c.visits > 1).length

  const topCols: RCol<CustomerAgg>[] = [
    { key: 'name', label: t('common:customer'), value: (r) => r.name, render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.name}</div>{r.phone && <div className="text-xs text-subtle">{r.phone}</div>}</div> },
    { key: 'phone', label: t('common:phone'), value: (r) => r.phone ?? '', exportOnly: true },
    { key: 'visits', label: t('customers.visits'), kind: 'int', value: (r) => r.visits },
    { key: 'total', label: t('customers.spend'), kind: 'money', value: (r) => r.total, primary: true },
    { key: 'net', label: t('kpi.netSales'), kind: 'money', value: (r) => r.net, hideOnMobile: true },
    { key: 'avg', label: t('kpi.avgTicket'), kind: 'money', value: (r) => (r.visits ? (r.total - r.refunds) / r.visits : 0), hideOnMobile: true },
    { key: 'last', label: t('customers.lastVisit'), kind: 'date', value: (r) => r.last, text: (r) => formatDate(r.last), render: (r) => formatDate(r.last) },
  ]
  const dueCols: RCol<Customer>[] = [
    { key: 'name', label: t('common:customer'), value: (r) => r.name, render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.name}</div>{r.phone && <div className="text-xs text-subtle">{r.phone}</div>}</div> },
    { key: 'phone', label: t('common:phone'), value: (r) => r.phone ?? '', exportOnly: true },
    { key: 'limit', label: t('customers.creditLimit'), kind: 'money', value: (r) => r.creditLimit ?? 0, text: (r) => (r.creditLimit ? formatMoney(r.creditLimit) : '—'), render: (r) => (r.creditLimit ? formatMoney(r.creditLimit) : '—'), hideOnMobile: true },
    {
      key: 'used',
      label: t('customers.limitUsed'),
      kind: 'pct',
      value: (r) => (r.creditLimit ? share(r.balance, r.creditLimit) : 0),
      render: (r) => (r.creditLimit ? <span className={r.balance > r.creditLimit ? 'font-semibold text-danger' : ''}>{pct(share(r.balance, r.creditLimit))}</span> : '—'),
      hideOnMobile: true,
    },
    { key: 'balance', label: t('customers.due'), kind: 'money', value: (r) => r.balance, primary: true, render: (r) => <span className="font-semibold text-danger">{formatMoney(r.balance)}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={t('customers.served')} value={int(T.customers)} sub={t('customers.repeat', { count: repeat })} />
        <KpiTile label={t('customers.walkIn')} value={pct(share(T.walkIn, T.sales))} sub={t('salesCount', { count: T.walkIn })} />
        <KpiTile label={t('customers.outstanding')} value={moneyWhole(duesTotal)} title={formatMoney(duesTotal)} sub={t('customers.withDues', { count: dues.length })} />
        <KpiTile label={t('customers.topSpend')} value={top.length ? moneyWhole(Math.max(...top.map((c) => c.total))) : '—'} sub={top.length ? [...top].sort((a, b) => b.total - a.total)[0].name : undefined} />
      </div>
      <ReportTable
        title={t('customers.top')}
        subtitle={t('customers.topHint')}
        rows={top}
        columns={topCols}
        rowKey={(r) => r.customerId}
        search={(r) => `${r.name} ${r.phone ?? ''}`}
        initialSort={{ key: 'total', dir: 'desc' }}
        totals={{ visits: top.reduce((a, c) => a + c.visits, 0), total: top.reduce((a, c) => a + c.total, 0), net: top.reduce((a, c) => a + c.net, 0) }}
        filename="top-customers"
      />
      <ReportTable
        title={t('customers.dues')}
        subtitle={t('customers.duesHint')}
        rows={dues}
        columns={dueCols}
        rowKey={(r) => r.id}
        search={(r) => `${r.name} ${r.phone ?? ''}`}
        initialSort={{ key: 'balance', dir: 'desc' }}
        totals={{ balance: duesTotal }}
        filename="outstanding-dues"
      />
    </div>
  )
}
