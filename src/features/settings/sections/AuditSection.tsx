import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Download, ScrollText } from 'lucide-react'
import type { AuditEntry } from '@/core/types'
import { db } from '@/db/db'
import { endOfDay, formatDateTime, fromDateInput, startOfDay, toDateInput } from '@/lib/dates'
import { formatNumber } from '@/lib/money'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'
import { Badge, Button, DataTable, EmptyState, Input, Select, type Tone } from '@/components/ui'
import { Stack } from '../ui'

const PAGE = 50

/** Translated label for an audit action, falling back to the raw code for unknown actions. */
export function useActionLabel() {
  const { t } = useTranslation('settings')
  return (action: string) => t(`auditActions.${action.replace(/\./g, '_')}`, { defaultValue: action })
}

function tone(action: string): Tone {
  if (/delete|void|erase|restore|clear/.test(action)) return 'danger'
  if (/refund|override|discount|drawer/.test(action)) return 'warning'
  if (/login|sale|create|open/.test(action)) return 'success'
  return 'neutral'
}

export function AuditSection() {
  const { t } = useTranslation('settings')
  const label = useActionLabel()
  const [action, setAction] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [action, user, from, to])

  const actions = useLiveQuery(async () => (await db.audit.orderBy('action').uniqueKeys()) as string[], [])
  const users = useLiveQuery(async () => (await db.users.toArray()).sort((a, b) => a.name.localeCompare(b.name)), [])

  const range = useMemo(() => {
    const lo = from ? startOfDay(fromDateInput(from)) : 0
    const hi = to ? endOfDay(fromDateInput(to)) : Number.MAX_SAFE_INTEGER
    return [lo, hi] as const
  }, [from, to])

  const collection = () => {
    const c = db.audit.where('createdAt').between(range[0], range[1], true, true).reverse()
    return action || user ? c.filter((e) => (!action || e.action === action) && (!user || (user === '-' ? !e.userId : e.userId === user))) : c
  }

  const data = useLiveQuery(async () => {
    const total = await collection().count()
    const rows = await collection().offset(page * PAGE).limit(PAGE).toArray()
    return { total, rows }
  }, [range, action, user, page])

  const exportCsv = async () => {
    const rows = await collection().toArray()
    const csv = toCsv(
      rows.map((e) => ({ time: new Date(e.createdAt).toISOString(), user: e.userName ?? '', action: e.action, entity: e.entity ?? '', entityId: e.entityId ?? '', details: e.details ?? '' })),
      ['time', 'user', 'action', 'entity', 'entityId', 'details'],
    )
    downloadText(`kasa-audit-${toDateInput(Date.now())}.csv`, csv, 'text/csv')
  }

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const filtered = !!(action || user || from || to)

  return (
    <Stack>
      <div data-setting="audit.log" className="grid gap-3 rounded-2xl transition-[background-color,box-shadow] duration-500 sm:grid-cols-2 lg:grid-cols-4">
        <Select label={t('audit.action')} value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('audit.allActions')} options={(actions ?? []).map((a) => ({ value: a, label: label(a) }))} />
        <Select
          label={t('audit.user')}
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder={t('audit.allUsers')}
          options={[...(users ?? []).map((u) => ({ value: u.id, label: u.deleted ? `${u.name} (${t('common:deleted')})` : u.name })), { value: '-', label: t('audit.system') }]}
        />
        <Input label={t('common:from')} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        <Input label={t('common:to')} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{t('audit.count', { count: total, formatted: formatNumber(total) })}</span>
        <div className="flex-1" />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => (setAction(''), setUser(''), setFrom(''), setTo(''))}>
            {t('audit.clearFilters')}
          </Button>
        )}
        <Button size="sm" icon={<Download className="size-4" />} disabled={!total} onClick={() => void exportCsv()}>
          {t('common:exportCsv')}
        </Button>
      </div>

      <DataTable<AuditEntry>
        rows={data?.rows ?? []}
        rowKey={(e) => e.id}
        empty={data ? <EmptyState icon={<ScrollText />} title={t('audit.empty')} description={filtered ? t('audit.emptyFiltered') : undefined} className="rounded-2xl border border-border bg-surface" /> : undefined}
        columns={[
          { key: 'time', header: t('audit.time'), render: (e) => <span className="tnum whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</span> },
          { key: 'user', header: t('audit.user'), render: (e) => e.userName ?? <span className="text-subtle">{t('audit.system')}</span> },
          { key: 'action', header: t('audit.action'), render: (e) => <Badge tone={tone(e.action)}>{label(e.action)}</Badge> },
          {
            key: 'details',
            header: t('audit.details'),
            className: 'max-w-[320px]',
            render: (e) => <span className="line-clamp-2 break-words text-muted">{[e.entity, e.details].filter(Boolean).join(' · ') || '—'}</span>,
          },
        ]}
        mobile={(e) => (
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <Badge tone={tone(e.action)}>{label(e.action)}</Badge>
              <span className="tnum text-xs text-subtle">{formatDateTime(e.createdAt)}</span>
            </div>
            <div className="mt-1 text-sm font-medium">{e.userName ?? t('audit.system')}</div>
            {(e.entity || e.details) && <div className="line-clamp-2 text-xs break-words text-muted">{[e.entity, e.details].filter(Boolean).join(' · ')}</div>}
          </div>
        )}
      />

      {pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="icon" aria-label={t('audit.prev')} disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <span className="tnum text-sm text-muted">{t('audit.page', { page: formatNumber(page + 1), pages: formatNumber(pages) })}</span>
          <Button size="icon" aria-label={t('audit.next')} disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      )}
    </Stack>
  )
}
