import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Download, FileDown, FileUp, MoreHorizontal, Phone, UserPlus, Users } from 'lucide-react'
import type { Customer } from '@/core/types'
import { db } from '@/db/db'
import { audit } from '@/db/repo'
import { formatDate, relativeTime, toDateInput } from '@/lib/dates'
import { downloadText, pickFile, readFileText } from '@/lib/download'
import { formatMoney, formatNumber } from '@/lib/money'
import { toCsv } from '@/lib/csv'
import { cn } from '@/lib/cn'
import { navigate, useRoute } from '@/router'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Avatar, Badge, Button, DataTable, EmptyState, Page, PageBody, PageHeader, SearchInput, Select, Spinner, type Column } from '@/components/ui'
import { MenuButton, useDebounced } from '@/features/sales/shared'
import { CustomerDetail } from './CustomerDetail'
import { CustomerForm } from './CustomerForm'
import { CSV_COLUMNS, applyImport, customerStatsMap, customersCsv, planImport, type CustomerStats } from './ledger'
import { phoneMatches } from '@/lib/validate'

type Filter = 'all' | 'due' | 'points'
type Sort = 'name' | 'balance' | 'recent'

const PAGE = 100
const SORT_KEY = 'kasa.customers.sort'

function loadSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    if (v === 'name' || v === 'balance' || v === 'recent') return v
  } catch {
    /* storage unavailable */
  }
  return 'name'
}

export default function CustomersScreen() {
  const { t } = useTranslation('customers')
  const route = useRoute()
  const settings = useSettings((s) => s.settings)
  const customers = useLiveQuery(async () => (await db.customers.toArray()).filter((c) => !c.deleted), [])
  const stats = useLiveQuery(() => customerStatsMap(), [])
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 150)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSortState] = useState<Sort>(loadSort)
  const [limit, setLimit] = useState(PAGE)
  const [form, setForm] = useState<{ open: boolean; customer?: Customer; name?: string }>({ open: false })
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedId = route.name === 'customers' && route.sub ? route.sub : undefined

  const setSort = (s: Sort) => {
    setSortState(s)
    try {
      localStorage.setItem(SORT_KEY, s)
    } catch {
      /* ignore */
    }
  }

  const counts = useMemo(() => {
    const list = customers ?? []
    const due = list.filter((c) => c.balance > 0)
    return { all: list.length, due: due.length, points: list.filter((c) => c.loyaltyPoints > 0).length, dueTotal: due.reduce((a, c) => a + c.balance, 0) }
  }, [customers])

  const list = useMemo(() => {
    const s = dq.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    let out = (customers ?? []).filter((c) => (filter === 'due' ? c.balance > 0 : filter === 'points' ? c.loyaltyPoints > 0 : true))
    if (s)
      out = out.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          phoneMatches(c.phone, digits, settings.country) ||
          !!c.email?.toLowerCase().includes(s) ||
          !!c.taxNumber?.toLowerCase().includes(s),
      )
    const byName = (a: Customer, b: Customer) => a.name.localeCompare(b.name)
    if (sort === 'name') out.sort(byName)
    else if (sort === 'balance') out.sort((a, b) => b.balance - a.balance || byName(a, b))
    else out.sort((a, b) => (stats?.get(b.id)?.last ?? 0) - (stats?.get(a.id)?.last ?? 0) || b.createdAt - a.createdAt)
    return out
  }, [customers, stats, dq, filter, sort])

  useEffect(() => setLimit(PAGE), [dq, filter, sort])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
      if (e.key === 'F2' || (e.key === '/' && !inField)) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === 'Insert' || (e.key.toLowerCase() === 'n' && e.altKey)) {
        e.preventDefault()
        setForm({ open: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const exportCsv = () => {
    const rows = filter === 'all' && !dq ? [...(customers ?? [])].sort((a, b) => a.name.localeCompare(b.name)) : list
    if (!rows.length) return toast(t('csv.nothing'), 'warning')
    if (downloadText(`customers-${toDateInput(Date.now())}.csv`, customersCsv(rows, settings), 'text/csv')) toast(t('csv.exported', { count: rows.length }))
  }

  const template = () => downloadText('customers-template.csv', toCsv([], [...CSV_COLUMNS]), 'text/csv')

  const importCsv = async () => {
    const file = await pickFile('.csv,text/csv')
    if (!file) return
    try {
      const plan = await planImport(await readFileText(file), settings)
      if (!plan.creates.length && !plan.updates.length) return toast(t('csv.noRows'), 'warning')
      const ok = await confirmDialog({
        title: t('csv.confirmTitle', { count: plan.creates.length + plan.updates.length }),
        message: [t('csv.confirmMessage', { creates: plan.creates.length, updates: plan.updates.length, skipped: plan.skipped }), plan.invalid ? t('csv.invalidValues', { count: plan.invalid }) : ''].filter(Boolean).join(' '),
        confirmLabel: t('common:import'),
      })
      if (!ok) return
      await applyImport(plan)
      void audit('customer.import', 'customer', undefined, `${plan.creates.length} new, ${plan.updates.length} updated`)
      toast(t('csv.imported', { creates: plan.creates.length, updates: plan.updates.length }))
    } catch (e) {
      toast(t('csv.failed', { error: e instanceof Error ? e.message : String(e) }), 'error')
    }
  }

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: t('col.customer'),
      render: (c) => (
        <button
          onClick={(e) => {
            e.stopPropagation()
            navigate(`customers/${c.id}`)
          }}
          className="flex min-w-0 items-center gap-3 text-start"
        >
          <Avatar name={c.name} size="sm" />
          <span className="min-w-0">
            <span className="block max-w-64 truncate font-semibold hover:text-primary">{c.name}</span>
            <span dir="ltr" className="block max-w-64 truncate text-start text-xs text-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
          </span>
        </button>
      ),
    },
    { key: 'balance', header: t('col.balance'), align: 'end', render: (c) => <BalanceBadge customer={c} /> },
    { key: 'points', header: t('col.points'), align: 'end', render: (c) => (c.loyaltyPoints ? <span className="tnum font-medium text-primary">{formatNumber(c.loyaltyPoints)}</span> : <span className="text-subtle">—</span>) },
    { key: 'spent', header: t('col.spent'), align: 'end', render: (c) => <Spent stats={stats} id={c.id} /> },
    { key: 'visits', header: t('col.visits'), align: 'end', hideOnMobile: true, render: (c) => <span className="tnum text-muted">{stats ? formatNumber(stats.get(c.id)?.visits ?? 0) : '…'}</span> },
    { key: 'last', header: t('col.lastVisit'), render: (c) => <LastVisit ts={stats?.get(c.id)?.last} loading={!stats} /> },
  ]

  const loyalty = settings.loyaltyEnabled || counts.points > 0
  const filters: Array<{ id: Filter; label: string; count: number }> = [
    { id: 'all', label: t('filter.all'), count: counts.all },
    { id: 'due', label: t('filter.due'), count: counts.due },
    ...(loyalty || filter === 'points' ? [{ id: 'points' as const, label: t('filter.points'), count: counts.points }] : []),
  ]
  const cols = loyalty ? columns : columns.filter((c) => c.key !== 'points')
  const shown = list.slice(0, limit)

  return (
    <Page>
      <PageHeader
        title={t('title')}
        subtitle={customers ? t('subtitle', { count: counts.all }) : undefined}
        actions={
          <>
            <MenuButton
              label={<span className="hidden sm:inline">{t('common:more')}</span>}
              icon={<MoreHorizontal className="size-4" />}
              items={[
                { label: t('common:importCsv'), icon: <FileUp />, onClick: () => void importCsv() },
                { label: t('common:exportCsv'), icon: <FileDown />, onClick: exportCsv },
                { label: t('csv.template'), icon: <Download />, onClick: template },
              ]}
            />
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setForm({ open: true, name: q && !/\d{4,}/.test(q) ? q : undefined })} aria-label={t('newCustomer')} title={t('newCustomer')}>
              {/* Icon-only on small phones so the page title isn't squeezed. */}
              <span className="max-[399px]:hidden">{t('newCustomer')}</span>
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput ref={searchRef} value={q} onChange={setQ} placeholder={t('searchPlaceholder')} className="min-w-0 flex-1" />
            <Select
              aria-label={t('sort.label')}
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              wrapperClassName="sm:w-52"
              options={[
                { value: 'name', label: t('sort.name') },
                { value: 'balance', label: t('sort.balance') },
                { value: 'recent', label: t('sort.recent') },
              ]}
            />
          </div>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist">
            {filters.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  filter === f.id ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-muted hover:bg-surface-3 hover:text-fg',
                )}
              >
                {f.label}
                <span className={cn('tnum rounded-full px-1.5 text-xs', filter === f.id ? 'bg-white/20' : 'bg-surface-3')}>{formatNumber(f.count)}</span>
              </button>
            ))}
            {counts.dueTotal > 0 && (
              <span className="ms-auto hidden shrink-0 items-center gap-2 text-sm text-muted sm:flex">
                {t('totalDue')} <b className="tnum text-danger">{formatMoney(counts.dueTotal)}</b>
              </span>
            )}
          </div>
        </div>
      </PageHeader>

      <PageBody className="space-y-4">
        {counts.dueTotal > 0 && (
          <div className="flex items-center justify-between rounded-2xl bg-danger-soft px-4 py-3 text-sm sm:hidden">
            <span className="font-medium text-danger">{t('totalDue')}</span>
            <b className="tnum text-danger">{formatMoney(counts.dueTotal)}</b>
          </div>
        )}
        {!customers ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <DataTable
            rows={shown}
            columns={cols}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`customers/${c.id}`)}
            mobile={(c) => <MobileRow customer={c} stats={stats?.get(c.id)} />}
            empty={
              counts.all === 0 ? (
                <EmptyState
                  icon={<Users />}
                  title={t('empty.title')}
                  description={t('empty.hint')}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button icon={<FileUp className="size-4" />} onClick={importCsv}>
                        {t('common:importCsv')}
                      </Button>
                      <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setForm({ open: true })}>
                        {t('newCustomer')}
                      </Button>
                    </div>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Users />}
                  title={t('empty.filtered')}
                  description={t('empty.filteredHint')}
                  action={
                    <Button variant="soft" icon={<UserPlus className="size-4" />} onClick={() => setForm({ open: true, name: q && !/\d{4,}/.test(q) ? q : undefined })}>
                      {q ? t('createNamed', { name: q }) : t('newCustomer')}
                    </Button>
                  }
                />
              )
            }
          />
        )}
        {list.length > limit && (
          <div className="flex flex-col items-center gap-2 pb-2">
            <p className="text-xs text-subtle">{t('showing', { shown: formatNumber(shown.length), total: formatNumber(list.length) })}</p>
            <Button onClick={() => setLimit((l) => l + PAGE)}>{t('loadMore')}</Button>
          </div>
        )}
      </PageBody>

      <CustomerDetail id={selectedId} onClose={() => navigate('customers')} onEdit={(c) => setForm({ open: true, customer: c })} />
      <CustomerForm
        open={form.open}
        customer={form.customer}
        initialName={form.name}
        onClose={() => setForm({ open: false })}
        onSaved={(c, created) => created && navigate(`customers/${c.id}`)}
      />
    </Page>
  )
}

function BalanceBadge({ customer: c }: { customer: Customer }) {
  const { t } = useTranslation('customers')
  if (c.balance > 0) return <Badge tone="danger" className="tnum">{t('dueBadge', { amount: formatMoney(c.balance) })}</Badge>
  if (c.balance < 0) return <Badge tone="success" className="tnum">{t('advanceBadge', { amount: formatMoney(-c.balance) })}</Badge>
  return <span className="text-subtle">—</span>
}

function Spent({ stats, id }: { stats?: Map<string, CustomerStats>; id: string }) {
  if (!stats) return <span className="text-subtle">…</span>
  const s = stats.get(id)
  return s?.spent ? <span className="tnum font-medium">{formatMoney(s.spent)}</span> : <span className="text-subtle">—</span>
}

function LastVisit({ ts, loading }: { ts?: number; loading: boolean }) {
  if (loading) return <span className="text-subtle">…</span>
  if (!ts) return <span className="text-subtle">—</span>
  return (
    <span className="whitespace-nowrap" title={formatDate(ts)}>
      {relativeTime(ts)}
    </span>
  )
}

function MobileRow({ customer: c, stats }: { customer: Customer; stats?: CustomerStats }) {
  const { t } = useTranslation('customers')
  return (
    <div className="flex items-center gap-3">
      <Avatar name={c.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{c.name}</div>
        <div className="flex items-center gap-1 truncate text-xs text-muted">
          {c.phone && (
            <>
              <Phone className="size-3 shrink-0" /> <bdi dir="ltr" className="truncate">{c.phone}</bdi>
            </>
          )}
          {stats?.last && <span className="truncate">{`${c.phone ? ' · ' : ''}${relativeTime(stats.last)}`}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <BalanceBadge customer={c} />
        {c.loyaltyPoints > 0 && <Badge tone="primary">{t('pointsBadge', { count: c.loyaltyPoints })}</Badge>}
      </div>
    </div>
  )
}
