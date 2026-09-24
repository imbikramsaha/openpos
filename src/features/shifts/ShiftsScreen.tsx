import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownToLine, ArrowUpFromLine, FileText, History, LockOpen, Lock, Vault } from 'lucide-react'
import { navigate, useRoute } from '@/router'
import { formatDateTime, formatTime } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { useDevice } from '@/stores/device'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { Badge, Button, Card, CardHeader, EmptyState, Page, PageBody, PageHeader, Spinner, Tabs } from '@/components/ui'
import { requirePermission } from '@/features/auth/permission'
import { OpenShiftDialog } from './OpenShiftDialog'
import { CashMoveDialog } from './CashMoveDialog'
import { CloseShiftDialog } from './CloseShiftDialog'
import { ShiftHistory } from './ShiftHistory'
import { ShiftDetail } from './ShiftDetail'
import { DiffBadge, MovementList, PaymentsBreakdown, Reconciliation, SalesSummary, duration } from './parts'
import { lastClosedShift, loadCurrentShift, shiftMovements, shiftSummary, shiftTerminal, type ShiftRecord } from './service'
import { printShiftReport } from './report'

type TabId = 'current' | 'history'

export default function ShiftsScreen() {
  const { t } = useTranslation('shifts')
  const route = useRoute()
  const terminalName = useDevice((s) => s.terminalName)
  const tab: TabId = route.sub === 'history' ? 'history' : 'current'
  useEffect(() => {
    void loadCurrentShift()
  }, [])
  return (
    <Page>
      <PageHeader title={t('title')} subtitle={terminalName}>
        <Tabs
          tabs={[
            { id: 'current', label: t('currentShift'), icon: <Vault /> },
            { id: 'history', label: t('history'), icon: <History /> },
          ]}
          value={tab}
          onChange={(id) => navigate(id === 'history' ? 'shifts/history' : 'shifts')}
          className="-mx-4 -mb-3 border-b-0 px-2 sm:-mx-6 sm:px-4"
        />
      </PageHeader>
      <PageBody className="bg-bg">
        <div className="mx-auto max-w-[1400px]">{tab === 'history' ? <ShiftHistory /> : <CurrentShift />}</div>
      </PageBody>
    </Page>
  )
}

type Dialog = 'open' | 'in' | 'out' | 'close' | null

function CurrentShift() {
  const { t } = useTranslation('shifts')
  const shift = useSession((s) => s.shift)
  const settings = useSettings((s) => s.settings)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [cashType, setCashType] = useState<'in' | 'out'>('in')
  const [lastOpen, setLastOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const sum = useLiveQuery(async () => (shift ? shiftSummary(shift) : undefined), [shift?.id])
  const moves = useLiveQuery(async () => (shift ? shiftMovements(shift.id) : []), [shift?.id])
  const last = useLiveQuery(() => lastClosedShift(), [shift?.id])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const cash = async (type: 'in' | 'out') => {
    if (!(await requirePermission('cash_drawer'))) return
    setCashType(type)
    setDialog(type)
  }
  const printX = () => shift && sum && moves && printShiftReport(shift, sum, moves, settings)
  const dialogs = (
    <>
      <OpenShiftDialog open={dialog === 'open'} onClose={() => setDialog(null)} />
      <CashMoveDialog open={dialog === 'in' || dialog === 'out'} type={cashType} onClose={() => setDialog(null)} expected={sum?.expectedCash} />
      <CloseShiftDialog open={dialog === 'close'} shift={shift} onClose={() => setDialog(null)} />
      <ShiftDetail shift={lastOpen ? (last ?? null) : null} onClose={() => setLastOpen(false)} />
    </>
  )

  if (!shift) {
    return (
      <div className="space-y-4">
        <Card>
          <EmptyState
            icon={<Lock />}
            title={t('noShift')}
            description={t('noShiftHint')}
            action={
              <Button variant="primary" size="lg" icon={<LockOpen className="size-5" />} onClick={() => setDialog('open')}>
                {t('openShift')}
              </Button>
            }
          />
        </Card>
        {last && <LastShiftCard shift={last} onView={() => setLastOpen(true)} />}
        {dialogs}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="kviz p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">
                <span className="size-1.5 rounded-full bg-success" />
                {t('statusOpen')}
              </Badge>
              <span className="font-semibold">{shift.number}</span>
              <span className="text-sm text-muted">· {shiftTerminal(shift)}</span>
            </div>
            <p className="mt-1 text-sm text-muted">{t('openedBy', { time: formatTime(shift.openedAt), user: shift.userName, duration: duration(now - shift.openedAt, t) })}</p>
            <div className="mt-4 text-sm font-medium text-muted">{t('expectedInDrawer')}</div>
            <div className="text-[2.5rem] leading-tight font-semibold tracking-tight sm:text-5xl">{sum ? formatMoney(sum.expectedCash) : '…'}</div>
            {sum && (
              <p className="mt-1 text-sm text-muted">
                {t('salesN', { count: sum.salesCount })} · {t('netSales')} {formatMoney(sum.netSales)}
              </p>
            )}
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:grid-cols-4 lg:grid-cols-2">
            <Button size="lg" variant="soft" icon={<ArrowDownToLine className="size-4" />} onClick={() => void cash('in')}>
              {t('cashIn')}
            </Button>
            <Button size="lg" variant="soft" icon={<ArrowUpFromLine className="size-4" />} onClick={() => void cash('out')}>
              {t('cashOut')}
            </Button>
            <Button size="lg" icon={<FileText className="size-4" />} onClick={printX} disabled={!sum}>
              {t('printX')}
            </Button>
            <Button size="lg" variant="primary" icon={<Lock className="size-4" />} onClick={() => setDialog('close')}>
              {t('closeShift')}
            </Button>
          </div>
        </div>
      </Card>

      {!sum || !moves ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title={t('cashInDrawer')} />
              <div className="p-4 sm:p-5">
                <Reconciliation sum={sum} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('sales')} />
              <div className="p-4 sm:p-5">
                <SalesSummary sum={sum} />
              </div>
            </Card>
            <Card>
              <CardHeader title={t('payments')} subtitle={t('paymentsHint')} />
              <div className="p-4 sm:p-5">
                <PaymentsBreakdown sum={sum} />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title={t('movements')} subtitle={moves.length ? t('movementsCount', { count: moves.length }) : undefined} />
            <div className="px-4 py-2 sm:px-5">
              <MovementList moves={[...moves].reverse()} />
            </div>
          </Card>
        </>
      )}
      {dialogs}
    </div>
  )
}

function LastShiftCard({ shift, onView }: { shift: ShiftRecord; onView: () => void }) {
  const { t } = useTranslation('shifts')
  return (
    <Card>
      <CardHeader
        title={t('lastShift')}
        subtitle={`${shift.number} · ${shift.closedAt ? formatDateTime(shift.closedAt) : ''}${shift.closedByName ? ` · ${shift.closedByName}` : ''}`}
        actions={
          <Button size="sm" onClick={onView}>
            {t('common:details')}
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 sm:p-5">
        <div>
          <div className="text-xs text-muted">{t('float')}</div>
          <div className="tnum font-semibold">{formatMoney(shift.openingFloat)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{t('expected')}</div>
          <div className="tnum font-semibold">{formatMoney(shift.expectedCash ?? 0)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">{t('counted')}</div>
          <div className="tnum font-semibold">{formatMoney(shift.countedCash ?? 0)}</div>
        </div>
        <div className="flex items-end">
          <DiffBadge diff={shift.difference ?? 0} />
        </div>
      </div>
    </Card>
  )
}
