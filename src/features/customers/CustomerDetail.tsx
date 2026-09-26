import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, HandCoins, Mail, MessageCircle, Pencil, Phone, Plus, Printer, ReceiptText, ShoppingBag, ShoppingCart, SlidersHorizontal, Trash2, Undo2, UserX } from 'lucide-react'
import type { Customer, Sale } from '@/core/types'
import { db } from '@/db/db'
import { recomputeCustomer } from '@/db/customers'
import { audit, remove } from '@/db/repo'
import { formatDate, formatDateTime, relativeTime } from '@/lib/dates'
import { formatMoney, formatNumber, formatPercent } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { cn } from '@/lib/cn'
import { navigate } from '@/router'
import { useCart } from '@/stores/cart'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Avatar, Badge, Button, EmptyState, KeyValue, Sheet, Spinner, Tabs } from '@/components/ui'
import { requirePermission } from '@/features/auth/permission'
import { refundStates } from '@/features/sales/query'
import { PaymentIcons, SaleBadges, openWhatsApp } from '@/features/sales/shared'
import { AdjustBalanceDialog, ReceivePaymentDialog, printPaymentReceipt } from './AccountDialogs'
import { buildLedger, entryTitle, reminderText, stateLabel, statementHtml, statsOf, type LedgerEntry } from './ledger'

const PAGE = 30

export function CustomerDetail({ id, onClose, onEdit }: { id?: string; onClose: () => void; onEdit: (c: Customer) => void }) {
  const { t } = useTranslation('customers')
  const settings = useSettings((s) => s.settings)
  const customer = useLiveQuery(async () => (id ? ((await db.customers.get(id)) ?? null) : null), [id])
  const sales = useLiveQuery(async () => (id ? (await db.sales.where('customerId').equals(id).toArray()).filter((s) => !s.deleted).sort((a, b) => b.createdAt - a.createdAt) : []), [id])
  const payments = useLiveQuery(async () => (id ? db.customerPayments.where('customerId').equals(id).toArray() : []), [id])
  const ledger = useMemo(() => (sales && payments ? buildLedger(sales, payments) : []), [sales, payments])
  const stats = useMemo(() => statsOf(sales ?? []), [sales])
  const [tab, setTab] = useState<'purchases' | 'statement' | 'info'>('purchases')
  const [dialog, setDialog] = useState<'pay' | 'adjust' | null>(null)

  useEffect(() => {
    setTab('purchases')
    setDialog(null)
  }, [id])

  const c = customer && !customer.deleted ? customer : null

  const adjust = async () => {
    if (await requirePermission('customers_credit')) setDialog('adjust')
  }
  const remind = () => {
    if (!c) return
    openWhatsApp(c.phone, reminderText(c, settings))
    void audit('customer.reminder', 'customer', c.id, formatMoney(c.balance))
  }
  const printStatement = async () => {
    if (c) await printHtml(await statementHtml(c, ledger, settings))
  }
  const startSale = () => {
    if (!c) return
    useCart.getState().setCustomer(c)
    navigate('sell')
  }
  const del = async () => {
    if (!c) return
    const ok = await confirmDialog({
      title: t('delete.title', { name: c.name }),
      message: c.balance ? t('delete.balanceWarning', { amount: formatMoney(Math.abs(c.balance)) }) : t('delete.message'),
      confirmLabel: t('common:delete'),
      danger: true,
    })
    if (!ok) return
    // Hiding an open balance is a credit decision.
    if (c.balance && !(await requirePermission('customers_credit'))) return
    await remove('customers', c.id)
    // Don't leave the deleted customer on the sale in progress.
    if (useCart.getState().customerId === c.id) useCart.getState().setCustomer(undefined)
    void audit('customer.delete', 'customer', c.id, `${c.name} ${c.balance}`)
    toast(t('delete.done', { name: c.name }))
    onClose()
  }

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      width="sm:w-[600px]"
      title={t('detail.title')}
      footer={
        c && (
          <>
            <Button variant="ghost" size="icon" className="me-auto" onClick={del} aria-label={t('common:delete')} title={t('common:delete')}>
              <Trash2 className="size-5 text-danger" />
            </Button>
            <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(c)}>
              {t('common:edit')}
            </Button>
            <Button variant="primary" icon={<ShoppingCart className="size-4" />} onClick={startSale}>
              {t('detail.newSale')}
            </Button>
          </>
        )
      }
    >
      {customer === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !c ? (
        <EmptyState icon={<UserX />} title={t('detail.notFound')} description={t('detail.notFoundHint')} />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={c.name} size="lg" />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-xl font-bold">{c.name}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg">
                    <Phone className="size-3.5" /> <bdi dir="ltr">{c.phone}</bdi>
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-fg">
                    <Mail className="size-3.5 shrink-0" /> <span className="truncate">{c.email}</span>
                  </a>
                )}
              </div>
              {(!!c.discountPercent || c.taxNumber) && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {!!c.discountPercent && <Badge tone="success">{t('discountBadge', { value: formatPercent(c.discountPercent) })}</Badge>}
                  {c.taxNumber && (
                    <Badge>
                      {settings.taxLabel}: {c.taxNumber}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          <BalanceCard customer={c} onPay={() => setDialog('pay')} onAdjust={adjust} onRemind={remind} onStatement={printStatement} />

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
            <StatCell label={t('stats.spent')} value={formatMoney(stats.spent)} />
            <StatCell label={t('stats.visits')} value={formatNumber(stats.visits)} />
            <StatCell label={t('stats.average')} value={formatMoney(stats.average)} />
            <StatCell label={t('stats.lastVisit')} value={stats.last ? relativeTime(stats.last) : '—'} hint={stats.last ? formatDate(stats.last) : undefined} />
            {settings.loyaltyEnabled || c.loyaltyPoints ? (
              <StatCell label={t('stats.points')} value={formatNumber(c.loyaltyPoints)} hint={c.loyaltyPoints && settings.loyaltyPointValue ? t('stats.pointsWorth', { value: formatMoney(c.loyaltyPoints * settings.loyaltyPointValue) }) : undefined} />
            ) : (
              <StatCell label={t('stats.visitsLast')} value={formatNumber(sales?.filter((s) => s.type === 'sale' && s.status === 'completed' && s.createdAt > Date.now() - 90 * 86_400_000).length ?? 0)} />
            )}
            <StatCell label={t('stats.since')} value={formatDate(c.createdAt)} />
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'purchases', label: t('tabs.purchases'), count: sales?.length },
              { id: 'statement', label: t('tabs.statement'), count: ledger.length },
              { id: 'info', label: t('tabs.info') },
            ]}
          />

          {tab === 'purchases' && <Purchases sales={sales} />}
          {tab === 'statement' && <Statement customer={c} entries={ledger} />}
          {tab === 'info' && <Info customer={c} />}
        </div>
      )}
      {c && <ReceivePaymentDialog customer={c} open={dialog === 'pay'} onClose={() => setDialog(null)} />}
      {c && <AdjustBalanceDialog customer={c} open={dialog === 'adjust'} onClose={() => setDialog(null)} />}
    </Sheet>
  )
}

function BalanceCard({ customer: c, onPay, onAdjust, onRemind, onStatement }: { customer: Customer; onPay: () => void; onAdjust: () => void; onRemind: () => void; onStatement: () => void }) {
  const { t } = useTranslation('customers')
  const over = !!c.creditLimit && c.balance > c.creditLimit
  return (
    <div className={cn('rounded-2xl border p-4', c.balance > 0 ? 'border-transparent bg-danger-soft' : c.balance < 0 ? 'border-transparent bg-success-soft' : 'border-border bg-surface-2')}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-semibold', c.balance > 0 ? 'text-danger' : c.balance < 0 ? 'text-success' : 'text-muted')}>
            {c.balance > 0 ? t('balanceDue') : c.balance < 0 ? t('advance') : t('noBalance')}
          </div>
          <div className={cn('tnum text-3xl font-extrabold tracking-tight', c.balance > 0 && 'text-danger', c.balance < 0 && 'text-success')}>{formatMoney(Math.abs(c.balance))}</div>
          {!!c.creditLimit && (
            <div className={cn('text-xs', over ? 'font-semibold text-danger' : 'text-muted')}>
              {over ? t('overLimit', { limit: formatMoney(c.creditLimit) }) : t('limitInfo', { limit: formatMoney(c.creditLimit), available: formatMoney(Math.max(c.creditLimit - c.balance, 0)) })}
            </div>
          )}
        </div>
        <Button variant={c.balance > 0 ? 'success' : 'secondary'} size="lg" icon={<HandCoins className="size-5" />} onClick={onPay} className="max-sm:w-full">
          {t('receivePayment')}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.balance > 0 && c.phone && (
          <Button size="sm" icon={<MessageCircle className="size-4" />} onClick={onRemind}>
            {t('sendReminder')}
          </Button>
        )}
        <Button size="sm" icon={<SlidersHorizontal className="size-4" />} onClick={onAdjust}>
          {t('adjustBalance')}
        </Button>
        <Button size="sm" icon={<Printer className="size-4" />} onClick={onStatement}>
          {t('printStatement')}
        </Button>
      </div>
    </div>
  )
}

function StatCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-2.5 sm:px-4 sm:py-3">
      <div className="truncate text-xs font-medium text-muted">{label}</div>
      <div className="tnum truncate text-base font-bold sm:text-lg">{value}</div>
      {hint && <div className="truncate text-xs text-subtle">{hint}</div>}
    </div>
  )
}

function Purchases({ sales }: { sales?: Sale[] }) {
  const { t } = useTranslation('customers')
  const [limit, setLimit] = useState(PAGE)
  const shown = useMemo(() => (sales ?? []).slice(0, limit), [sales, limit])
  const refunds = useLiveQuery(() => refundStates(shown), [shown])
  if (!sales) return <Spinner className="mx-auto block" />
  if (!sales.length) return <EmptyState icon={<ShoppingBag />} title={t('purchases.empty')} description={t('purchases.emptyHint')} className="py-8" />
  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {shown.map((s) => (
          <li key={s.id}>
            <button onClick={() => navigate(`sales/${s.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2">
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', s.type === 'refund' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-muted')}>
                {s.type === 'refund' ? <Undo2 className="size-4" /> : <ReceiptText className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className={cn('min-w-0 truncate font-medium', s.status === 'voided' && 'text-subtle line-through')}>{s.number}</span>
                  <SaleBadges sale={s} refund={refunds?.[s.id]} />
                </span>
                <span className="block truncate text-xs text-muted">
                  {formatDateTime(s.createdAt)} · {t('purchases.lines', { count: s.lines.length })}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className={cn('tnum font-semibold', s.type === 'refund' && 'text-danger', s.status === 'voided' && 'text-subtle line-through')}>{formatMoney(s.total)}</span>
                <PaymentIcons payments={s.payments} />
              </span>
              <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" />
            </button>
          </li>
        ))}
      </ul>
      {sales.length > limit && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>{t('common:more')}</Button>
        </div>
      )}
    </div>
  )
}

const KIND_STYLE: Record<LedgerEntry['kind'], { icon: typeof Plus; cls: string }> = {
  sale: { icon: ShoppingBag, cls: 'bg-danger-soft text-danger' },
  refund: { icon: Undo2, cls: 'bg-success-soft text-success' },
  payment: { icon: HandCoins, cls: 'bg-success-soft text-success' },
  adjust: { icon: SlidersHorizontal, cls: 'bg-success-soft text-success' },
  charge: { icon: Plus, cls: 'bg-warning-soft text-warning' },
}

function Statement({ customer, entries }: { customer: Customer; entries: LedgerEntry[] }) {
  const { t } = useTranslation('customers')
  const can = useSession((s) => s.can)
  const [limit, setLimit] = useState(PAGE)
  const newest = useMemo(() => [...entries].reverse(), [entries])
  const shown = newest.slice(0, limit)

  const removeEntry = async (x: LedgerEntry) => {
    if (!x.payment || !(await requirePermission('customers_credit'))) return
    const ok = await confirmDialog({ title: t('statement.deleteTitle'), message: t('statement.deleteMessage', { amount: formatMoney(Math.abs(x.payment.amount)) }), confirmLabel: t('common:delete'), danger: true })
    if (!ok) return
    await remove('customerPayments', x.payment.id)
    await recomputeCustomer(customer.id)
    void audit('customer.payment.delete', 'customer', customer.id, `${x.payment.amount} ${x.payment.method}`)
    toast(t('statement.deleted'))
  }

  if (!entries.length) return <EmptyState icon={<ReceiptText />} title={t('statement.empty')} description={t('statement.emptyHint')} className="py-8" />
  return (
    <div>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {shown.map((x) => {
          const { icon: Icon, cls } = KIND_STYLE[x.kind]
          const body = (
            <>
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', cls)}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{entryTitle(x)}</span>
                <span className="block truncate text-xs text-muted">
                  {formatDateTime(x.at)}
                  {x.note ? ` · ${x.note}` : ''}
                </span>
              </span>
              <span className="text-end">
                <span className={cn('tnum block font-semibold', x.debit ? 'text-danger' : 'text-success')}>{x.debit ? `+${formatMoney(x.debit)}` : `−${formatMoney(x.credit)}`}</span>
                <span className="tnum block text-xs text-subtle">{t('statement.balanceAfter', { amount: formatMoney(x.balance) })}</span>
              </span>
            </>
          )
          return (
            <li key={x.id} className="flex items-center">
              {x.saleId ? (
                <button onClick={() => navigate(`sales/${x.saleId}`)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-start hover:bg-surface-2">
                  {body}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 py-3 ps-4 pe-2">{body}</div>
              )}
              {x.payment && (
                <div className="flex shrink-0 pe-2">
                  {x.kind === 'payment' && (
                    <Button variant="ghost" size="icon-sm" aria-label={t('statement.printReceipt')} title={t('statement.printReceipt')} onClick={() => printPaymentReceipt(x.payment!, customer, x.balance)}>
                      <Printer className="size-4 text-muted" />
                    </Button>
                  )}
                  {can('customers_credit') && (
                    <Button variant="ghost" size="icon-sm" aria-label={t('common:delete')} title={t('common:delete')} onClick={() => removeEntry(x)}>
                      <Trash2 className="size-4 text-danger" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {newest.length > limit && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => setLimit((l) => l + PAGE)}>{t('common:more')}</Button>
        </div>
      )}
    </div>
  )
}

function Info({ customer: c }: { customer: Customer }) {
  const { t } = useTranslation('customers')
  const settings = useSettings((s) => s.settings)
  const dash = <span className="text-subtle">—</span>
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-2xl border border-border px-4 py-1">
        <KeyValue label={t('phone')} value={c.phone ? <bdi dir="ltr">{c.phone}</bdi> : dash} />
        <KeyValue label={t('email')} value={c.email || dash} />
        <KeyValue label={settings.taxLabel || t('taxNumber')} value={c.taxNumber || dash} />
        <KeyValue label={t('address')} value={c.address || dash} />
        <KeyValue label={t('city')} value={c.city || dash} />
        <KeyValue label={t('state')} value={stateLabel(c.state, settings) || dash} />
        <KeyValue label={t('discountPercent')} value={c.discountPercent ? formatPercent(c.discountPercent) : dash} />
        <KeyValue label={t('creditLimit')} value={c.creditLimit ? formatMoney(c.creditLimit) : t('form.noLimit')} />
        <KeyValue label={t('stats.since')} value={formatDateTime(c.createdAt)} />
      </div>
      {c.notes && (
        <div>
          <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{t('notes')}</div>
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm whitespace-pre-line">{c.notes}</p>
        </div>
      )}
    </div>
  )
}
