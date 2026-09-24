import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileSpreadsheet, Globe, ListFilter, Receipt, Undo2 } from 'lucide-react'
import type { PaymentMethod, Sale } from '@/core/types'
import { db } from '@/db/db'
import { addDays, formatDate, formatTime, startOfDay, toDateInput } from '@/lib/dates'
import { downloadText } from '@/lib/download'
import { formatMoney, formatNumber, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { navigate, useRoute } from '@/router'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, DataTable, EmptyState, Input, Page, PageBody, PageHeader, SearchInput, Select, Spinner, type Column } from '@/components/ui'
import { RANGE_PRESETS, itemsCsv, presetRange, salesCsv, scanSales, type RangePreset, type SalesFilter } from './query'
import { SaleDetail } from './SaleDetail'
import { MenuButton, PaymentIcons, SaleBadges, useDebounced } from './shared'

const PAGE = 100
const ALL_METHODS: PaymentMethod[] = ['cash', 'card', 'upi', 'credit', 'voucher', 'loyalty', 'bank', 'other']

export default function SalesScreen() {
  const { t } = useTranslation('sales')
  const route = useRoute()
  const enabledPayments = useSettings((s) => s.settings.enabledPayments)
  const [preset, setPreset] = useState<RangePreset>('today')
  const [custom, setCustom] = useState(() => ({ from: toDateInput(addDays(Date.now(), -6)), to: toDateInput(Date.now()) }))
  const [type, setType] = useState<SalesFilter['type']>('all')
  const [status, setStatus] = useState<SalesFilter['status']>('all')
  const [method, setMethod] = useState<PaymentMethod | ''>('')
  const [userId, setUserId] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [showFilters, setShowFilters] = useState(false)
  const [exporting, setExporting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dq = useDebounced(q, 200)
  // Recompute preset ranges when the day rolls over while the screen stays open.
  const day = startOfDay()
  const range = useMemo(() => presetRange(preset, custom), [preset, custom, day])

  const filter: SalesFilter = useMemo(() => ({ ...range, type, status, method, userId, q: dq }), [range, type, status, method, userId, dq])
  const key = JSON.stringify(filter)
  useEffect(() => setLimit(PAGE), [key])
  const data = useLiveQuery(() => scanSales(filter, limit), [key, limit])
  const users = useLiveQuery(async () => (await db.users.orderBy('name').toArray()).filter((u) => !u.deleted), [])
  const methods = useMemo(() => ALL_METHODS.filter((m) => enabledPayments.includes(m) || m === 'loyalty' || m === method), [enabledPayments, method])
  const activeFilters = [type !== 'all', status !== 'all', !!method, !!userId].filter(Boolean).length
  const selectedId = route.name === 'sales' && route.sub ? route.sub : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (e.key === 'F2' || (e.key === '/' && !inField)) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clearFilters = () => {
    setType('all')
    setStatus('all')
    setMethod('')
    setUserId('')
    setQ('')
  }

  const doExport = async (kind: 'sales' | 'items') => {
    setExporting(true)
    try {
      const { csv, count } = kind === 'sales' ? await salesCsv(filter) : await itemsCsv(filter)
      if (!count) return toast(t('export.empty'), 'warning')
      downloadText(`${kind}-${toDateInput(range.from)}_${toDateInput(range.to)}.csv`, csv, 'text/csv')
      toast(t('export.done', { count }))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setExporting(false)
    }
  }

  const rangeLabel = preset === 'today' || preset === 'yesterday' ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`
  const summary = data?.summary
  const multiDay = range.to - range.from > 86_400_000 || data?.allDates

  const filters = (
    <>
      <Select
        aria-label={t('filter.type')}
        value={type}
        onChange={(e) => setType(e.target.value as SalesFilter['type'])}
        options={[
          { value: 'all', label: t('filter.allTypes') },
          { value: 'sale', label: t('filter.sales') },
          { value: 'refund', label: t('filter.refunds') },
        ]}
      />
      <Select
        aria-label={t('filter.status')}
        value={status}
        onChange={(e) => setStatus(e.target.value as SalesFilter['status'])}
        options={[
          { value: 'all', label: t('filter.allStatuses') },
          { value: 'completed', label: t('status.completed') },
          { value: 'voided', label: t('status.voided') },
        ]}
      />
      <Select aria-label={t('filter.method')} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod | '')} placeholder={t('filter.allMethods')} options={methods.map((m) => ({ value: m, label: t(`common:payment.${m}`) }))} />
      <Select aria-label={t('filter.cashier')} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t('filter.allCashiers')} options={(users ?? []).map((u) => ({ value: u.id, label: u.name }))} />
    </>
  )

  const columns: Column<Sale>[] = [
    {
      key: 'number',
      header: t('col.number'),
      render: (s) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`sales/${s.id}`)
          }}
          className="flex items-center gap-2 text-start font-semibold hover:text-primary"
        >
          {s.type === 'refund' ? <Undo2 className="size-4 shrink-0 text-warning" /> : <Receipt className="size-4 shrink-0 text-subtle" />}
          <span className={cn('whitespace-nowrap', s.status === 'voided' && 'text-subtle line-through')}>{s.number}</span>
        </button>
      ),
    },
    {
      key: 'time',
      header: t('col.time'),
      render: (s) => (
        <span className="tnum whitespace-nowrap">
          {formatTime(s.createdAt)}
          {multiDay && <span className="block text-xs text-muted">{formatDate(s.createdAt)}</span>}
        </span>
      ),
    },
    {
      key: 'customer',
      header: t('common:customer'),
      render: (s) =>
        s.customerName ? (
          <span className="block max-w-56 truncate">
            {s.customerName}
            {s.customerPhone && <span dir="ltr" className="block truncate text-start text-xs text-muted">{s.customerPhone}</span>}
          </span>
        ) : (
          <span className="text-subtle">{t('walkIn')}</span>
        ),
    },
    { key: 'items', header: t('common:items'), align: 'end', hideOnMobile: true, render: (s) => <span className="tnum text-muted">{formatQty(itemCount(s))}</span> },
    { key: 'pay', header: t('col.payment'), render: (s) => <PaymentIcons payments={s.payments} /> },
    {
      key: 'status',
      header: t('common:status'),
      render: (s) => (
        <span className="flex flex-wrap gap-1">
          <SaleBadges sale={s} refund={data?.refunds[s.id]} />
        </span>
      ),
    },
    { key: 'total', header: t('common:total'), align: 'end', render: (s) => <Total sale={s} /> },
  ]

  return (
    <Page>
      <PageHeader
        title={t('title')}
        subtitle={rangeLabel}
        actions={
          <MenuButton
            label={t('common:export')}
            icon={exporting ? <Spinner className="size-4" /> : <Download className="size-4" />}
            items={[
              { label: t('export.sales'), icon: <FileSpreadsheet />, onClick: () => void doExport('sales'), disabled: exporting },
              { label: t('export.items'), icon: <FileSpreadsheet />, onClick: () => void doExport('items'), disabled: exporting },
            ]}
          />
        }
      >
        <div className="space-y-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0" role="tablist" aria-label={t('filter.period')}>
            {RANGE_PRESETS.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={preset === p}
                onClick={() => setPreset(p)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  preset === p ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-muted hover:bg-surface-3 hover:text-fg',
                )}
              >
                {t(`range.${p}`)}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
              <Input type="date" label={t('common:from')} value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} wrapperClassName="sm:w-44" />
              <Input type="date" label={t('common:to')} value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} wrapperClassName="sm:w-44" />
            </div>
          )}
          <div className="flex gap-2">
            <SearchInput ref={searchRef} value={q} onChange={setQ} placeholder={t('searchPlaceholder')} className="min-w-0 flex-1" />
            <div className="hidden gap-2 lg:grid lg:w-[640px] lg:grid-cols-4">{filters}</div>
            <Button className="relative h-11 lg:hidden" icon={<ListFilter className="size-4" />} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} aria-label={t('common:filter')}>
              <span className="hidden sm:inline">{t('common:filter')}</span>
              {activeFilters > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-fg">{activeFilters}</span>}
            </Button>
          </div>
          {showFilters && <div className="grid grid-cols-2 gap-2 lg:hidden">{filters}</div>}
        </div>
      </PageHeader>

      <PageBody className="space-y-4">
        {summary && (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border shadow-card sm:grid-cols-4">
            <SummaryCell label={t('summary.count')} value={formatNumber(summary.count)} hint={summary.voided ? t('summary.voided', { count: summary.voided }) : undefined} />
            <SummaryCell label={t('summary.net')} value={formatMoney(summary.net)} strong />
            <SummaryCell label={t('summary.sales', { count: summary.salesCount })} value={formatMoney(summary.salesTotal)} />
            <SummaryCell label={t('summary.refunds', { count: summary.refundsCount })} value={formatMoney(summary.refundsTotal)} tone={summary.refundsTotal ? 'danger' : undefined} />
          </div>
        )}

        {data?.allDates && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Globe className="size-4" /> {t('allDatesHint')}
          </p>
        )}

        {!data ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <DataTable
            rows={data.rows}
            columns={columns}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`sales/${s.id}`)}
            mobile={(s) => <MobileRow sale={s} refund={data.refunds[s.id]} multiDay={!!multiDay} />}
            empty={
              <EmptyState
                icon={<Receipt />}
                title={q || activeFilters ? t('empty.filtered') : t('empty.title')}
                description={q || activeFilters ? t('empty.filteredHint') : t('empty.hint')}
                action={
                  q || activeFilters ? (
                    <Button onClick={clearFilters}>{t('clearFilters')}</Button>
                  ) : (
                    <Button variant="primary" onClick={() => navigate('sell')}>
                      {t('common:nav.sell')}
                    </Button>
                  )
                }
              />
            }
          />
        )}

        {data?.more && (
          <div className="flex flex-col items-center gap-2 pb-2">
            <p className="text-xs text-subtle">{t('showing', { shown: formatNumber(data.rows.length), total: formatNumber(data.summary.count) })}</p>
            <Button onClick={() => setLimit((l) => l + PAGE)}>{t('loadMore')}</Button>
          </div>
        )}
      </PageBody>

      <SaleDetail id={selectedId} autoRefund={route.params.get('refund') === '1'} onClose={() => navigate('sales')} />
    </Page>
  )
}

const itemCount = (s: Sale) => s.lines.reduce((a, l) => a + (l.unit === 'pcs' || l.unit === 'box' || l.unit === 'pack' ? Math.abs(l.qty) : 1), 0)

function Total({ sale }: { sale: Sale }) {
  return (
    <span
      className={cn(
        'tnum font-semibold whitespace-nowrap',
        sale.status === 'voided' ? 'text-subtle line-through' : sale.type === 'refund' ? 'text-danger' : '',
      )}
    >
      {formatMoney(sale.total)}
    </span>
  )
}

function SummaryCell({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: 'danger' }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <div className="truncate text-xs font-medium text-muted">{label}</div>
      <div className={cn('tnum truncate text-lg font-bold', strong && 'text-primary', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint && <div className="truncate text-xs text-subtle">{hint}</div>}
    </div>
  )
}

function MobileRow({ sale, refund, multiDay }: { sale: Sale; refund?: 'none' | 'partial' | 'full'; multiDay: boolean }) {
  const { t } = useTranslation('sales')
  return (
    <div className="flex items-center gap-3">
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', sale.type === 'refund' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-muted')}>
        {sale.type === 'refund' ? <Undo2 className="size-5" /> : <Receipt className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('truncate font-semibold', sale.status === 'voided' && 'text-subtle line-through')}>{sale.number}</span>
          <SaleBadges sale={sale} refund={refund} />
        </div>
        <div className="truncate text-xs text-muted">
          {multiDay ? `${formatDate(sale.createdAt)} ` : ''}
          {formatTime(sale.createdAt)} · {sale.customerName || t('walkIn')}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Total sale={sale} />
        <PaymentIcons payments={sale.payments} />
      </div>
    </div>
  )
}
