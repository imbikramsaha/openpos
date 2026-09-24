import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { cn } from '@/lib/cn'
import { endOfDay, formatDateTime, fromDateInput } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { useSettings } from '@/stores/settings'
import { Badge, Button, Input, Select } from '@/components/ui'
import { ReportTable, type RCol } from '@/features/reports/ReportTable'
import { ReportMetaContext } from '@/features/reports/context'
import { shiftTerminal, type ShiftRecord } from './service'
import { ShiftDetail } from './ShiftDetail'

export function ShiftHistory() {
  const { t } = useTranslation('shifts')
  const settings = useSettings((s) => s.settings)
  const shifts = useLiveQuery(async () => (await db.shifts.orderBy('openedAt').reverse().toArray()).filter((s) => !s.deleted) as ShiftRecord[], [])
  const [terminal, setTerminal] = useState('')
  const [user, setUser] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const terminals = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of shifts ?? []) if (!m.has(s.deviceId)) m.set(s.deviceId, shiftTerminal(s))
    return [...m].map(([value, label]) => ({ value, label }))
  }, [shifts])
  const users = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of shifts ?? []) m.set(s.userId, s.userName)
    return [...m].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [shifts])
  const rows = useMemo(() => {
    const a = from ? fromDateInput(from) : 0
    const b = to ? endOfDay(fromDateInput(to)) : Infinity
    return (shifts ?? []).filter((s) => (!terminal || s.deviceId === terminal) && (!user || s.userId === user) && s.openedAt >= a && s.openedAt <= b)
  }, [shifts, terminal, user, from, to])
  const detail = (shifts ?? []).find((s) => s.id === openId) ?? null
  const closedRows = rows.filter((r) => r.status === 'closed')
  const diffTotal = closedRows.reduce((a, r) => a + (r.difference ?? 0), 0)

  const diffCell = (r: ShiftRecord) =>
    r.status !== 'closed' ? <Badge tone="success">{t('statusOpen')}</Badge> : <span className={cn('font-semibold', !r.difference ? 'text-success' : r.difference < 0 ? 'text-danger' : 'text-warning')}>{r.difference ? formatMoney(r.difference, { sign: true }) : t('balanced')}</span>
  const columns: RCol<ShiftRecord>[] = [
    { key: 'number', label: t('shift'), value: (r) => r.number, render: (r) => <span className="font-medium whitespace-nowrap">{r.number}</span> },
    { key: 'terminal', label: t('terminal'), value: (r) => shiftTerminal(r), hideOnMobile: true },
    { key: 'opened', label: t('openedAt'), kind: 'date', value: (r) => r.openedAt },
    { key: 'closed', label: t('closedAt'), kind: 'date', value: (r) => r.closedAt ?? 0, hideOnMobile: true },
    { key: 'user', label: t('common:user'), value: (r) => r.userName },
    { key: 'float', label: t('float'), kind: 'money', value: (r) => r.openingFloat, hideOnMobile: true },
    { key: 'expected', label: t('expected'), kind: 'money', value: (r) => r.expectedCash ?? 0, text: (r) => (r.expectedCash === undefined ? '—' : formatMoney(r.expectedCash)), render: (r) => (r.expectedCash === undefined ? '—' : formatMoney(r.expectedCash)) },
    { key: 'counted', label: t('counted'), kind: 'money', value: (r) => r.countedCash ?? 0, text: (r) => (r.countedCash === undefined ? '—' : formatMoney(r.countedCash)), render: (r) => (r.countedCash === undefined ? '—' : formatMoney(r.countedCash)), primary: true },
    { key: 'difference', label: t('difference'), kind: 'money', value: (r) => r.difference ?? 0, render: diffCell },
  ]

  return (
    <ReportMetaContext.Provider value={{ rangeLabel: from || to ? `${from || '…'} – ${to || '…'}` : '', prevLabel: '', fileTag: from || to ? `${from}_${to}` : '', settings }}>
      <ReportTable
        title={t('history')}
        subtitle={closedRows.length ? t('historyHint', { count: closedRows.length, amount: formatMoney(diffTotal, { sign: true }) }) : undefined}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        search={(r) => `${r.number} ${r.userName} ${r.closedByName ?? ''} ${r.notes ?? ''}`}
        initialSort={{ key: 'opened', dir: 'desc' }}
        filename="shifts"
        onRowClick={(r) => setOpenId(r.id)}
        totals={{ difference: diffTotal }}
        toolbar={
          <>
            {terminals.length > 1 && <Select value={terminal} onChange={(e) => setTerminal(e.target.value)} options={terminals} placeholder={t('allTerminals')} wrapperClassName="w-full sm:w-44" aria-label={t('terminal')} />}
            {users.length > 1 && <Select value={user} onChange={(e) => setUser(e.target.value)} options={users} placeholder={t('allUsers')} wrapperClassName="w-full sm:w-40" aria-label={t('common:user')} />}
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={t('common:from')} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-40" />
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label={t('common:to')} wrapperClassName="w-[calc(50%-0.25rem)] sm:w-40" />
            {(terminal || user || from || to) && (
              <Button variant="ghost" onClick={() => (setTerminal(''), setUser(''), setFrom(''), setTo(''))}>
                {t('common:clear')}
              </Button>
            )}
          </>
        }
        mobile={(r) => (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1 truncate font-medium">{r.number}</div>
              <div className="tnum shrink-0">{diffCell(r)}</div>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
              <span>{formatDateTime(r.openedAt)}</span>
              <span>{r.userName}</span>
              <span>{shiftTerminal(r)}</span>
              {r.countedCash !== undefined && <span className="tnum">{t('counted')}: {formatMoney(r.countedCash)}</span>}
            </div>
          </>
        )}
      />
      <ShiftDetail shift={detail} onClose={() => setOpenId(null)} />
    </ReportMetaContext.Provider>
  )
}
