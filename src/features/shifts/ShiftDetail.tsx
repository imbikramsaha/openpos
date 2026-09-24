import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Printer } from 'lucide-react'
import { formatDateTime } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { useSettings } from '@/stores/settings'
import { Badge, Button, KeyValue, Sheet, Spinner } from '@/components/ui'
import { MovementList, PaymentsBreakdown, Reconciliation, SalesSummary, duration } from './parts'
import { shiftMovements, shiftSummary, shiftTerminal, type ShiftRecord } from './service'
import { printShiftReport } from './report'

export function Section({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

export function ShiftDetail({ shift, onClose }: { shift: ShiftRecord | null; onClose: () => void }) {
  const { t } = useTranslation('shifts')
  const settings = useSettings((s) => s.settings)
  const sum = useLiveQuery(async () => (shift ? shiftSummary(shift) : undefined), [shift?.id, shift?.updatedAt])
  const moves = useLiveQuery(async () => (shift ? shiftMovements(shift.id) : []), [shift?.id])
  const closed = shift?.status === 'closed'
  const print = () => shift && sum && moves && printShiftReport(shift, sum, moves, settings)

  return (
    <Sheet
      open={!!shift}
      onClose={onClose}
      title={shift?.number}
      width="sm:w-[520px]"
      footer={
        <Button variant="primary" icon={<Printer className="size-4" />} onClick={print} disabled={!sum}>
          {closed ? t('reprintZ') : t('printX')}
        </Button>
      }
    >
      {shift && (
        <div className="space-y-5">
          <Section title={t('details')} action={closed ? <Badge>{t('statusClosed')}</Badge> : <Badge tone="success">{t('statusOpen')}</Badge>}>
            <KeyValue label={t('terminal')} value={shiftTerminal(shift)} />
            <KeyValue label={t('openedAt')} value={`${formatDateTime(shift.openedAt)} · ${shift.userName}`} />
            {closed && shift.closedAt && <KeyValue label={t('closedAt')} value={`${formatDateTime(shift.closedAt)}${shift.closedByName ? ` · ${shift.closedByName}` : ''}`} />}
            <KeyValue label={t('duration')} value={duration((shift.closedAt ?? Date.now()) - shift.openedAt, t)} />
          </Section>
          {!sum || !moves ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <>
              <Section title={t('cashInDrawer')}>
                <Reconciliation sum={sum} counted={closed ? shift.countedCash : undefined} expected={closed ? shift.expectedCash : undefined} />
                {closed && shift.expectedCash !== undefined && shift.expectedCash !== sum.expectedCash && (
                  <p className="mt-2 text-xs text-warning">{t('changedSinceClose', { amount: formatMoney(sum.expectedCash) })}</p>
                )}
              </Section>
              <Section title={t('sales')}>
                <SalesSummary sum={sum} />
              </Section>
              <Section title={t('payments')}>
                <PaymentsBreakdown sum={sum} />
              </Section>
              <Section title={t('movements')}>
                <MovementList moves={moves} />
              </Section>
              {shift.notes && (
                <Section title={t('common:notes')}>
                  <p className="text-sm whitespace-pre-line text-muted">{shift.notes}</p>
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
