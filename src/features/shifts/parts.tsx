import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, CircleCheck } from 'lucide-react'
import type { CashMovement } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatMoney, formatPercent } from '@/lib/money'
import { formatTime } from '@/lib/dates'
import { useSettings } from '@/stores/settings'
import { Badge, EmptyState } from '@/components/ui'
import { ShareBar } from '@/features/reports/charts'
import { methodColor, methodOrder } from '@/features/reports/context'
import type { PaymentMethod } from '@/core/types'
import type { ShiftSummary } from './service'

// Building blocks shared by the current-shift view, the close dialog and history.

/** "3 h 20 min" style duration. */
export function duration(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? t('durationHm', { h, m }) : t('durationM', { m })
}

export function Line({ label, value, strong, muted, className, sign }: { label: ReactNode; value: number; strong?: boolean; muted?: boolean; className?: string; sign?: '+' | '−' | '=' }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5 text-sm', strong && 'text-base font-semibold', muted && 'text-muted', className)}>
      <span className="flex min-w-0 items-center gap-2">
        {sign && <span className="tnum w-3 shrink-0 text-center text-subtle">{sign}</span>}
        <span className="min-w-0 break-words">{label}</span>
      </span>
      <span className="tnum shrink-0 text-end">{formatMoney(value)}</span>
    </div>
  )
}

/** Over / short / balanced — always icon + words, never colour alone. */
export function DiffBadge({ diff, size = 'sm' }: { diff: number; size?: 'sm' | 'lg' }) {
  const { t } = useTranslation('shifts')
  const Icon = diff === 0 ? CircleCheck : CircleAlert
  const tone = diff === 0 ? 'success' : diff < 0 ? 'danger' : 'warning'
  const label = diff === 0 ? t('balanced') : diff < 0 ? t('short', { amount: formatMoney(-diff) }) : t('over', { amount: formatMoney(diff) })
  if (size === 'lg')
    return (
      <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', { success: 'bg-success-soft text-success', danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning' }[tone])}>
        <Icon className="size-5 shrink-0" />
        {label}
      </div>
    )
  return (
    <Badge tone={tone}>
      <Icon className="size-3.5" />
      {label}
    </Badge>
  )
}

/** float + cash sales + customer cash payments + cash in − cash out = expected. */
export function Reconciliation({ sum, counted, expected }: { sum: ShiftSummary; counted?: number; expected?: number }) {
  const { t } = useTranslation('shifts')
  const exp = expected ?? sum.expectedCash
  return (
    <div>
      <Line label={t('openingFloat')} value={sum.openingFloat} />
      <Line sign="+" label={t('cashSales')} value={sum.cashSales} />
      <Line sign="+" label={t('customerPayments')} value={sum.customerPaymentsCash} />
      <Line sign="+" label={t('cashIn')} value={sum.cashIn} />
      <Line sign="−" label={t('cashOut')} value={sum.cashOut} />
      <Line sign="=" label={t('expected')} value={exp} strong className="mt-1 border-t border-border pt-2" />
      {counted !== undefined && (
        <>
          <Line label={t('counted')} value={counted} strong />
          <div className="mt-2">
            <DiffBadge diff={counted - exp} size="lg" />
          </div>
        </>
      )}
    </div>
  )
}

export function SalesSummary({ sum }: { sum: ShiftSummary }) {
  const { t } = useTranslation('shifts')
  const gstMode = useSettings((s) => s.settings.gstMode)
  return (
    <div>
      <Line label={t('salesN', { count: sum.salesCount })} value={sum.grossSales} />
      <Line label={t('refundsN', { count: sum.refundsCount })} value={sum.refunds} />
      <Line label={t('netSales')} value={sum.netSales} strong className="border-t border-border pt-2" />
      <Line label={t('discounts')} value={sum.discounts} muted />
      {gstMode && sum.gst?.length
        ? sum.gst.map((g) => <Line key={`${g.label}${g.rate}`} label={`${g.label} ${formatPercent(g.rate)}`} value={g.tax} muted />)
        : null}
      <Line label={t('tax')} value={sum.tax} muted />
      {sum.voids > 0 && (
        <div className="flex items-center justify-between gap-4 py-1.5 text-sm text-muted">
          <span>{t('voidsN', { count: sum.voids })}</span>
          <span className="tnum">{formatMoney(sum.voidsAmount ?? 0)}</span>
        </div>
      )}
    </div>
  )
}

export function PaymentsBreakdown({ sum }: { sum: ShiftSummary }) {
  const { t } = useTranslation('shifts')
  const settings = useSettings((s) => s.settings)
  const order = methodOrder(settings)
  const entries = order.filter((m) => sum.byMethod[m] !== undefined && sum.byMethod[m] !== 0)
  if (!entries.length) return <p className="py-6 text-center text-sm text-subtle">{t('noPayments')}</p>
  return (
    <ShareBar
      ariaLabel={t('payments')}
      items={entries.map((m: PaymentMethod) => ({
        key: m,
        label: t(`common:payment.${m}`),
        value: sum.byMethod[m],
        color: methodColor(m, order),
        display: formatMoney(sum.byMethod[m]),
        sub: sum.countByMethod?.[m] ? t('salesCount', { count: sum.countByMethod[m] }) : undefined,
      }))}
    />
  )
}

export function MovementList({ moves }: { moves: CashMovement[] }) {
  const { t } = useTranslation('shifts')
  if (!moves.length) return <EmptyState title={t('noMovements')} description={t('noMovementsHint')} className="py-8" />
  return (
    <ul className="divide-y divide-border">
      {moves.map((m) => (
        <li key={m.id} className="flex items-center gap-3 py-2.5">
          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', m.type === 'in' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            {m.type === 'in' ? <ArrowDownToLine className="size-4.5" /> : <ArrowUpFromLine className="size-4.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.reason || (m.type === 'in' ? t('cashIn') : t('cashOut'))}</div>
            <div className="text-xs text-muted">
              {formatTime(m.createdAt)} · {m.userName} · {m.type === 'in' ? t('cashIn') : t('cashOut')}
            </div>
          </div>
          <span className={cn('tnum shrink-0 font-semibold', m.type === 'in' ? 'text-success' : 'text-danger')}>{formatMoney(m.type === 'in' ? m.amount : -m.amount, { sign: true })}</span>
        </li>
      ))}
    </ul>
  )
}
