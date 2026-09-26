import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ban, ChevronRight, FileText, Mail, MessageCircle, Printer, ReceiptText, Share2, Undo2, User } from 'lucide-react'
import type { Sale } from '@/core/types'
import { gstSplit, refundedQuantities } from '@/core/cart'
import { db } from '@/db/db'
import { formatDateTime, formatDate } from '@/lib/dates'
import { formatMoney, formatPercent, formatQty } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { cn } from '@/lib/cn'
import { navigate } from '@/router'
import { device } from '@/stores/device'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Badge, Button, EmptyState, KeyValue, Sheet, Spinner, Tabs } from '@/components/ui'
import { requirePermission } from '@/features/auth/permission'
import { ReceiptPreview, emailReceipt, printSale, shareNative, shareWhatsApp } from '@/features/sell/ReceiptDialog'
import { receiptHtml } from '@/features/sell/receipt'
import { refundState } from './query'
import { RefundDialog } from './RefundDialog'
import { VoidDialog } from './VoidDialog'
import { ActionTiles, MethodLabel, SaleBadges, SectionTitle } from './shared'

/** Rewrites the current hash without adding a history entry (drops `?refund=1` once handled). */
function replaceRoute(path: string) {
  history.replaceState(history.state, '', `#/${path}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function printA4(sale: Sale) {
  const s = useSettings.getState().settings
  return printHtml(receiptHtml(sale, { ...s, receipt: { ...s.receipt, paperWidth: 'a4' } }))
}

export function SaleDetail({ id, autoRefund, onClose }: { id?: string; autoRefund: boolean; onClose: () => void }) {
  const { t } = useTranslation('sales')
  const currentShift = useSession((st) => st.shift)
  const sale = useLiveQuery(async () => (id ? ((await db.sales.get(id)) ?? null) : null), [id])
  const refunds = useLiveQuery(
    async () => (id ? (await db.sales.where('refundOf').equals(id).toArray()).filter((r) => !r.deleted).sort((a, b) => a.createdAt - b.createdAt) : []),
    [id],
  )
  const [tab, setTab] = useState<'details' | 'receipt'>('details')
  const [dialog, setDialog] = useState<'refund' | 'void' | null>(null)
  const customerEmail = useLiveQuery(async () => (sale?.customerId ? (await db.customers.get(sale.customerId))?.email : undefined), [sale?.customerId])

  useEffect(() => {
    setTab('details')
    setDialog(null)
  }, [id])

  const state = sale && refunds ? refundState(sale, refunds) : 'none'
  const canRefund = !!sale && sale.type === 'sale' && sale.status === 'completed' && state !== 'full' && sale.lines.some((l) => l.qty > 0)
  // Only sales from the current (or no) shift can be voided; older ones are refunded.
  const canVoid = !!sale && sale.type === 'sale' && sale.status === 'completed' && refunds?.length === 0 && (!sale.shiftId || sale.shiftId === currentShift?.id)

  const startRefund = async () => {
    if (!sale || !canRefund) return
    if (await requirePermission('refund')) setDialog('refund')
  }
  const startVoid = async () => {
    if (!sale || !canVoid) return
    if (await requirePermission('void')) setDialog('void')
  }

  // Deep link from the Sell screen's refund lookup: #/sales/<id>?refund=1
  const handled = useRef('')
  useEffect(() => {
    if (!autoRefund || !sale || !refunds || handled.current === sale.id) return
    handled.current = sale.id
    replaceRoute(`sales/${sale.id}`)
    // A credit note can't itself be refunded; just show it.
    if (sale.type !== 'sale') return
    if (!canRefund) toast(sale.status === 'voided' ? t('refund.voided') : t('refund.nothingLeft'), 'warning')
    else void startRefund()
  }, [autoRefund, sale, refunds])

  return (
    <Sheet
      open={!!id}
      onClose={onClose}
      width="sm:w-[560px]"
      title={
        sale ? (
          <span className="flex items-center gap-2">
            {sale.type === 'refund' ? <Undo2 className="size-5 text-warning" /> : <ReceiptText className="size-5 text-muted" />}
            {sale.number}
          </span>
        ) : (
          t('detail.title')
        )
      }
      footer={
        sale && (
          <>
            {canVoid && (
              <Button variant="ghost" className="me-auto" icon={<Ban className="size-4 text-danger" />} onClick={startVoid}>
                <span className="text-danger">{t('void.action')}</span>
              </Button>
            )}
            {canRefund && (
              <Button icon={<Undo2 className="size-4" />} onClick={startRefund}>
                {t('refund.action')}
              </Button>
            )}
            <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => printSale(sale)}>
              {t('common:print')}
            </Button>
          </>
        )
      }
    >
      {sale === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : sale === null ? (
        <EmptyState icon={<ReceiptText />} title={t('detail.notFound')} description={t('detail.notFoundHint')} />
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <SaleBadges sale={sale} refund={state} />
                {sale.type === 'sale' && sale.status === 'completed' && state === 'none' && <Badge tone="success">{t('status.completed')}</Badge>}
              </div>
              <div className="mt-1 text-sm text-muted">{formatDateTime(sale.createdAt)}</div>
            </div>
            <div className="text-end">
              <div className={cn('tnum text-3xl font-extrabold tracking-tight', sale.type === 'refund' && 'text-danger', sale.status === 'voided' && 'text-subtle line-through')}>{formatMoney(sale.total)}</div>
              <div className="text-xs text-muted">{t('itemsCount', { count: sale.lines.length })}</div>
            </div>
          </div>

          {sale.status === 'voided' && (
            <div className="flex items-start gap-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">
              <Ban className="mt-0.5 size-4 shrink-0" />
              <span>
                <b>{t('void.voided')}</b>
                {sale.voidReason ? ` — ${sale.voidReason}` : ''}
              </span>
            </div>
          )}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'details', label: t('detail.details') },
              { id: 'receipt', label: t('detail.receipt') },
            ]}
          />

          {tab === 'receipt' ? (
            <div className="rounded-2xl bg-surface-3 p-3">
              <ReceiptPreview sale={sale} />
            </div>
          ) : (
            <SaleBody sale={sale} refunds={refunds ?? []} customerEmail={customerEmail} />
          )}
        </div>
      )}
      {sale && dialog === 'refund' && <RefundDialog sale={sale} open onClose={() => setDialog(null)} customerEmail={customerEmail} />}
      {sale && <VoidDialog sale={sale} open={dialog === 'void'} onClose={() => setDialog(null)} />}
    </Sheet>
  )
}

function SaleBody({ sale, refunds, customerEmail }: { sale: Sale; refunds: Sale[]; customerEmail?: string }) {
  const { t } = useTranslation('sales')
  const settings = useSettings((s) => s.settings)
  const can = useSession((s) => s.can)
  const original = useLiveQuery(async () => (sale.refundOf ? ((await db.sales.get(sale.refundOf)) ?? null) : null), [sale.refundOf])
  const returned = useMemo(() => refundedQuantities(refunds), [refunds])
  const terminal = sale.number.split('-')[1] ?? ''
  const here = sale.deviceId === device().deviceId
  const taxRows = settings.gstMode
    ? gstSplit(sale.taxBreakdown, !!sale.interState).map((r) => ({ key: `${r.label}${r.rate}`, label: `${r.label} ${formatPercent(r.rate)}`, taxable: r.taxable, tax: r.tax }))
    : sale.taxBreakdown.filter((b) => b.rate).map((b) => ({ key: `${b.taxId}${b.rate}`, label: b.name || `${t('common:tax')} ${formatPercent(b.rate)}`, taxable: b.taxable, tax: b.tax }))
  const paid = sale.payments.reduce((a, p) => a + p.amount, 0)

  const quick = [
    { label: t('detail.a4'), icon: <FileText />, onClick: () => void printA4(sale) },
    { label: 'WhatsApp', icon: <MessageCircle />, onClick: () => shareWhatsApp(sale) },
    { label: t('common:share'), icon: <Share2 />, onClick: () => void shareNative(sale) },
    { label: t('common:email'), icon: <Mail />, onClick: () => emailReceipt(sale, customerEmail) },
  ]

  return (
    <div className="space-y-6">
      <ActionTiles actions={quick} />

      {sale.type === 'refund' && original && (
        <button onClick={() => navigate(`sales/${original.id}`)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-warning-soft px-4 py-3 text-start hover:brightness-95 dark:hover:brightness-125">
          <Undo2 className="size-5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">{t('detail.refundOf')}</span>
            <span className="block truncate font-semibold">
              {original.number} · {formatDate(original.createdAt)}
            </span>
          </span>
          <span className="tnum font-semibold">{formatMoney(original.total)}</span>
          <ChevronRight className="size-4 text-subtle rtl:rotate-180" />
        </button>
      )}

      <section>
        <div className="divide-y divide-border rounded-2xl border border-border px-4 py-1">
          <KeyValue label={t('detail.cashier')} value={sale.userName} />
          <KeyValue label={t('detail.terminal')} value={here ? `${device().terminalName} (${terminal})` : terminal} />
          {sale.orderType && sale.orderType !== 'walkin' && <KeyValue label={t('detail.orderType')} value={t(`sell:orderType.${sale.orderType}`)} />}
          {sale.table && <KeyValue label={t('sell:table')} value={sale.table} />}
          <KeyValue
            label={t('common:customer')}
            value={
              sale.customerId && can('customers_manage') ? (
                <button onClick={() => navigate(`customers/${sale.customerId}`)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <User className="size-3.5" />
                  {sale.customerName}
                </button>
              ) : (
                sale.customerName || <span className="text-subtle">{t('walkIn')}</span>
              )
            }
          />
          {sale.customerPhone && <KeyValue label={t('common:phone')} value={<bdi dir="ltr">{sale.customerPhone}</bdi>} />}
          {sale.customerTaxNumber && <KeyValue label={settings.taxLabel} value={sale.customerTaxNumber} />}
          {settings.gstMode && <KeyValue label={t('detail.supply')} value={sale.interState ? t('detail.interState') : t('detail.intraState')} />}
        </div>
      </section>

      <section>
        <SectionTitle>{t('detail.items')}</SectionTitle>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {sale.lines.map((l) => {
            const back = returned[l.id] ?? 0
            const meta = [l.sku, settings.gstMode && l.hsn ? `HSN ${l.hsn}` : '', l.taxRate ? `${t('common:tax')} ${formatPercent(l.taxRate)}` : ''].filter(Boolean).join(' · ')
            return (
              <li key={l.id} className="flex gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.name}</div>
                  <div className="tnum text-xs text-muted">
                    {formatQty(l.qty)}
                    {l.unit !== 'pcs' ? ` ${t(`common:unit.${l.unit}`)}` : ''} × {formatMoney(l.price)}
                    {l.discount ? <span className="text-success"> · −{formatMoney(Math.abs(l.discount))}</span> : null}
                  </div>
                  {meta && <div className="text-xs text-subtle">{meta}</div>}
                  {l.note && <div className="text-xs text-muted italic">{l.note}</div>}
                  {back > 0 && (
                    <Badge tone="warning" className="mt-1">
                      {t('refund.returnedQty', { qty: formatQty(back) })}
                    </Badge>
                  )}
                </div>
                <div className="tnum text-end font-semibold">{formatMoney(l.total)}</div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface-2 px-4 py-3">
        <KeyValue label={t('common:subtotal')} value={formatMoney(sale.subtotal)} />
        {!!sale.discountTotal && <KeyValue label={t('common:discount')} value={<span className="text-success">−{formatMoney(Math.abs(sale.discountTotal))}</span>} />}
        {!sale.pricesIncludeTax && <KeyValue label={t('sell:receipt.taxable')} value={formatMoney(sale.netTotal)} />}
        {taxRows.map((r) => (
          <KeyValue key={r.key} label={r.label} value={formatMoney(r.tax)} className="text-xs" />
        ))}
        {!taxRows.length && !!sale.taxTotal && <KeyValue label={t('common:tax')} value={formatMoney(sale.taxTotal)} />}
        {sale.pricesIncludeTax && !!sale.taxTotal && <p className="text-xs text-subtle">{t('detail.taxIncluded', { amount: formatMoney(sale.taxTotal) })}</p>}
        {!!sale.rounding && <KeyValue label={t('sell:rounding')} value={formatMoney(sale.rounding)} />}
        <div className="my-2 h-px bg-border" />
        <KeyValue label={t('common:total')} value={formatMoney(sale.total)} strong />
      </section>

      {taxRows.length > 0 && (
        <section>
          <SectionTitle>{t('detail.taxBreakdown')}</SectionTitle>
          <div className="overflow-hidden rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 text-start font-semibold">{t('common:tax')}</th>
                  <th className="px-4 py-2 text-end font-semibold">{t('sell:receipt.taxable')}</th>
                  <th className="px-4 py-2 text-end font-semibold">{t('common:amount')}</th>
                </tr>
              </thead>
              <tbody className="tnum divide-y divide-border">
                {taxRows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-2">{r.label}</td>
                    <td className="px-4 py-2 text-end">{formatMoney(r.taxable)}</td>
                    <td className="px-4 py-2 text-end">{formatMoney(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>{sale.type === 'refund' ? t('detail.refundedVia') : t('detail.payments')}</SectionTitle>
        <div className="rounded-2xl border border-border px-4 py-1">
          {sale.payments.map((p) => (
            <KeyValue
              key={p.id}
              label={
                <span className="flex items-center gap-2 text-fg">
                  <MethodLabel method={p.method} />
                  {p.reference && <span className="text-xs text-subtle">{p.reference}</span>}
                </span>
              }
              value={formatMoney(p.amount)}
            />
          ))}
          {!sale.payments.length && <p className="py-2 text-sm text-subtle">{t('detail.noPayments')}</p>}
          {sale.payments.length > 1 && <KeyValue label={t('sell:paid')} value={formatMoney(paid)} strong />}
          {sale.change > 0 && <KeyValue label={t('sell:change')} value={formatMoney(sale.change)} strong />}
        </div>
        {(!!sale.loyaltyEarned || !!sale.loyaltyRedeemed) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(sale.loyaltyEarned ?? 0) > 0 && <Badge tone="primary">{t('detail.pointsEarned', { count: sale.loyaltyEarned })}</Badge>}
            {(sale.loyaltyEarned ?? 0) < 0 && <Badge>{t('detail.pointsReversed', { count: -(sale.loyaltyEarned ?? 0) })}</Badge>}
            {!!sale.loyaltyRedeemed && <Badge>{t('detail.pointsRedeemed', { count: sale.loyaltyRedeemed })}</Badge>}
          </div>
        )}
      </section>

      {sale.note && (
        <section>
          <SectionTitle>{sale.type === 'refund' ? t('common:reason') : t('common:note')}</SectionTitle>
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm whitespace-pre-line">{sale.note}</p>
        </section>
      )}

      {refunds.length > 0 && (
        <section>
          <SectionTitle>{t('detail.linked')}</SectionTitle>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {refunds.map((r) => (
              <li key={r.id}>
                <button onClick={() => navigate(`sales/${r.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-surface-2">
                  <Undo2 className="size-4 shrink-0 text-warning" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.number}</span>
                    <span className="block truncate text-xs text-muted">
                      {formatDateTime(r.createdAt)} · {r.userName}
                    </span>
                  </span>
                  {r.status === 'voided' && <Badge tone="danger">{t('badge.voided')}</Badge>}
                  <span className="tnum font-semibold text-danger">{formatMoney(r.total)}</span>
                  <ChevronRight className="size-4 text-subtle rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
