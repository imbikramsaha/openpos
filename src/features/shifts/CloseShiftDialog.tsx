import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Minus, Plus, Printer, RotateCcw } from 'lucide-react'
import type { Shift } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatMoney, formatNumber, moneyConfig, toMinor } from '@/lib/money'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Modal, MoneyInput, Segmented, Textarea } from '@/components/ui'
import { denominations } from './denominations'
import { DiffBadge, Reconciliation } from './parts'
import { amountError, closeShift, shiftMovements, shiftSummary, type ShiftRecord } from './service'
import { printShiftReport } from './report'

type Mode = 'count' | 'total'

export function CloseShiftDialog({ open, shift, onClose }: { open: boolean; shift: Shift | null; onClose: () => void }) {
  const { t } = useTranslation('shifts')
  const settings = useSettings((s) => s.settings)
  const [target, setTarget] = useState<Shift | null>(shift)
  const [closed, setClosed] = useState<ShiftRecord | null>(null)
  const [mode, setMode] = useState<Mode>('count')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [extra, setExtra] = useState<number | undefined>(undefined)
  const [typed, setTyped] = useState<number | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTarget(shift)
    setClosed(null)
    setCounts({})
    setExtra(undefined)
    setTyped(undefined)
    setNotes(shift?.notes ?? '')
    setMode('count')
    // Reset only when the dialog opens.
  }, [open])

  const sum = useLiveQuery(async () => (target && !closed ? shiftSummary(target) : undefined), [target?.id, closed])
  const denoms = useMemo(() => denominations(settings.currency, settings.quickCash, settings.cashRounding), [settings.currency, settings.quickCash, settings.cashRounding])
  const decimals = moneyConfig().decimals
  const counted =
    mode === 'total'
      ? typed ?? 0
      : denoms.reduce((a, d) => a + toMinor(d, decimals) * (counts[String(d)] ?? 0), 0) + (extra ?? 0)
  const hasCount = mode === 'total' ? typed !== undefined : Object.values(counts).some(Boolean) || !!extra
  const expected = sum?.expectedCash ?? 0
  const diff = counted - expected
  const extraError = amountError(extra)
  const typedError = amountError(typed)
  const invalid = !!(mode === 'total' ? typedError : extraError || amountError(counted))

  const setCount = (d: number, n: number) => setCounts((c) => ({ ...c, [String(d)]: Math.max(0, Math.min(99999, Math.round(n) || 0)) }))
  const label = (d: number) => {
    const { currency, locale } = moneyConfig()
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: d % 1 ? decimals : 0, maximumFractionDigits: decimals }).format(d)
    } catch {
      return formatNumber(d, d % 1 ? decimals : 0)
    }
  }

  const submit = async () => {
    if (!target || !sum || invalid || busy) return
    if (diff !== 0) {
      const ok = await confirmDialog({
        title: diff < 0 ? t('confirmShort', { amount: formatMoney(-diff) }) : t('confirmOver', { amount: formatMoney(diff) }),
        message: t('confirmDiffHint'),
        confirmLabel: t('closeAnyway'),
        danger: diff < 0,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const done = await closeShift(target, counted, notes.trim() || undefined)
      setClosed(done)
      toast(t('closed'))
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const printZ = async () => {
    if (!closed) return
    const [s, moves] = await Promise.all([shiftSummary(closed), shiftMovements(closed.id)])
    await printShiftReport(closed, s, moves, settings)
  }

  if (closed) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t('shiftClosed')}
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>{t('common:done')}</Button>
            <Button variant="primary" icon={<Printer className="size-4" />} onClick={printZ}>
              {t('printZ')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="size-14 text-success" />
          <div className="mt-3 text-lg font-semibold">{closed.number}</div>
          <p className="mt-1 text-sm text-muted">{t('closedHint')}</p>
          <div className="mt-5 w-full rounded-2xl border border-border p-4 text-start">
            <div className="flex justify-between py-1 text-sm"><span className="text-muted">{t('expected')}</span><span className="tnum">{formatMoney(closed.expectedCash ?? 0)}</span></div>
            <div className="flex justify-between py-1 text-sm font-semibold"><span>{t('counted')}</span><span className="tnum">{formatMoney(closed.countedCash ?? 0)}</span></div>
            <div className="mt-2"><DiffBadge diff={closed.difference ?? 0} size="lg" /></div>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('closeShift')}
      subtitle={target?.number}
      size="lg"
      flush
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!sum || invalid} onClick={submit}>
            {t('closeShift')}
          </Button>
        </>
      }
    >
      <div className="sticky top-0 z-10 grid grid-cols-3 gap-2 border-b border-border bg-surface px-5 py-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted">{t('expected')}</div>
          <div className="tnum truncate text-lg font-semibold">{sum ? formatMoney(expected) : '…'}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted">{t('counted')}</div>
          <div className="tnum truncate text-lg font-semibold">{formatMoney(counted)}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-muted">{t('difference')}</div>
          <div className={cn('tnum truncate text-lg font-semibold', !hasCount ? 'text-subtle' : diff === 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-warning')}>
            {hasCount ? <bdi>{formatMoney(diff, { sign: true })}</bdi> : '—'}
          </div>
        </div>
        {hasCount && (
          <div className="col-span-3">
            <DiffBadge diff={diff} />
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'count', label: t('countByDenomination') },
                { value: 'total', label: t('enterTotal') },
              ]}
            />
            {mode === 'count' && hasCount && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => (setCounts({}), setExtra(undefined))}>
                {t('common:reset')}
              </Button>
            )}
          </div>
          {mode === 'count' ? (
            <div>
              <ul className="divide-y divide-border rounded-2xl border border-border">
                {denoms.map((d) => {
                  const n = counts[String(d)] ?? 0
                  return (
                    <li key={d} className="flex items-center gap-2 px-3 py-1.5">
                      <span className="tnum w-16 shrink-0 font-semibold">{label(d)}</span>
                      <span className="text-subtle">×</span>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" className="size-11" onClick={() => setCount(d, n - 1)} disabled={!n} aria-label={t('less', { value: label(d) })}>
                          <Minus className="size-4" />
                        </Button>
                        <input
                          inputMode="numeric"
                          value={n || ''}
                          placeholder="0"
                          onChange={(e) => setCount(d, Number(e.target.value.replace(/\D/g, '')))}
                          onFocus={(e) => e.currentTarget.select()}
                          aria-label={t('countOf', { value: label(d) })}
                          className="tnum h-11 w-14 rounded-xl border border-border bg-surface text-center font-semibold text-fg placeholder:text-subtle focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
                        />
                        <Button size="icon" variant="soft" className="size-11" onClick={() => setCount(d, n + 1)} aria-label={t('more', { value: label(d) })}>
                          <Plus className="size-4" />
                        </Button>
                      </div>
                      <span className={cn('tnum min-w-0 flex-1 truncate text-end text-sm', n ? 'font-semibold' : 'text-subtle')}>{formatMoney(toMinor(d, decimals) * n)}</span>
                    </li>
                  )
                })}
              </ul>
              <MoneyInput label={t('otherAmount')} hint={t('otherAmountHint')} value={extra} onChange={setExtra} error={extraError ? t(extraError) : undefined} wrapperClassName="mt-3" />
            </div>
          ) : (
            <MoneyInput label={t('countedCash')} hint={t('countedCashHint')} value={typed} onChange={setTyped} error={typedError ? t(typedError) : undefined} autoFocus className="h-14 text-2xl font-semibold" />
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <div className="rounded-2xl border border-border p-4">
            <h3 className="mb-1 text-sm font-semibold">{t('cashInDrawer')}</h3>
            {sum ? <Reconciliation sum={sum} /> : <div className="h-40" />}
          </div>
          <Textarea label={t('common:notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} maxLength={500} />
        </div>
      </div>
    </Modal>
  )
}
