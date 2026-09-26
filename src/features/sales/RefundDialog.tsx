import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ListChecks, Mail, MessageCircle, PackageCheck, PackageX, Printer, Share2, Undo2 } from 'lucide-react'
import type { PaymentMethod, Sale } from '@/core/types'
import { refundLines, refundRounding, summarizeLines } from '@/core/cart'
import { formatMoney, formatQty } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { cn } from '@/lib/cn'
import { session } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Badge, Button, Input, Modal, Toggle } from '@/components/ui'
import { refundContext, refundSale } from '@/features/sell/checkout'
import { ReceiptPreview, emailReceipt, printSale, shareNative, shareWhatsApp } from '@/features/sell/ReceiptDialog'
import { METHOD_ICONS } from '@/features/sell/PaymentDialog'
import { OpenShiftDialog } from '@/features/shifts/OpenShiftDialog'
import { ActionTiles, Stepper } from './shared'

const REASONS = ['damaged', 'wrongItem', 'changedMind', 'notAsDescribed'] as const
/** Units sold in whole pieces: refunds of these can't be fractional. */
const COUNTED = new Set<string>(['pcs', 'box', 'pack', 'dozen'])

/** Methods offered for paying a refund back: cash, the original tenders, and the customer's account. */
export function refundMethods(sale: Sale): PaymentMethod[] {
  const out = new Set<PaymentMethod>(['cash'])
  for (const p of sale.payments) if (p.method !== 'loyalty' && (p.method !== 'credit' || sale.customerId)) out.add(p.method)
  if (sale.customerId) out.add('credit')
  return [...out]
}

export function RefundDialog({ sale, open, onClose, customerEmail }: { sale: Sale; open: boolean; onClose: () => void; customerEmail?: string }) {
  const { t } = useTranslation('sales')
  const settings = useSettings((s) => s.settings)
  const [already, setAlready] = useState<Record<string, number> | null>(null)
  const [roundingDone, setRoundingDone] = useState(0)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [restock, setRestock] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [needShift, setNeedShift] = useState(false)
  const [done, setDone] = useState<Sale | null>(null)
  const busyRef = useRef(false)
  const methods = useMemo(() => refundMethods(sale), [sale])

  useEffect(() => {
    if (!open) return
    setQty({})
    setRestock(true)
    setReason('')
    setDone(null)
    setAlready(null)
    // Default to paying back on account when any of the sale went on account, so a
    // customer who never paid isn't handed cash.
    setMethod(sale.customerId && sale.payments.some((p) => p.method === 'credit') ? 'credit' : 'cash')
    void refundContext(sale.id).then((ctx) => {
      setAlready(ctx.done)
      setRoundingDone(ctx.rounding)
    })
    // Only when (re)opened or a different sale is shown; live updates must not wipe the selection.
  }, [open, sale.id])

  const available = (lineId: string, sold: number) => Math.max(0, Math.round((sold - (already?.[lineId] ?? 0)) * 1000) / 1000)
  const refundable = sale.lines.filter((l) => l.qty > 0)
  const lines = useMemo(() => refundLines(sale.lines, qty, already ?? {}), [sale.lines, qty, already])
  const sum = useMemo(() => {
    const base = summarizeLines(lines)
    // The last refund of a sale also returns the invoice's cash rounding.
    return { ...base, total: base.total + refundRounding(sale, lines, already ?? {}, roundingDone) }
  }, [lines, sale, already, roundingDone])
  const byLine = useMemo(() => new Map(lines.map((l) => [l.refLineId!, l])), [lines])
  const everything = refundable.every((l) => (qty[l.id] ?? 0) >= available(l.id, l.qty))
  const nothingLeft = already !== null && refundable.every((l) => available(l.id, l.qty) <= 0)

  const selectAll = () => {
    if (everything) return setQty({})
    const next: Record<string, number> = {}
    for (const l of refundable) next[l.id] = available(l.id, l.qty)
    setQty(next)
  }

  const submit = async () => {
    if (!lines.length || already === null || busyRef.current) return
    if (settings.requireShift && !session().shift) return setNeedShift(true)
    busyRef.current = true
    setBusy(true)
    try {
      const refund = await refundSale(sale, qty, [{ id: uuid(), method, amount: sum.total }], restock, reason.trim() || undefined)
      toast(t('refund.done', { number: refund.number }))
      setDone(refund)
      if (settings.receipt.autoPrint) void printSale(refund)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Modal open={open} onClose={onClose} size="lg" flush title={t('refund.complete')} subtitle={done.number}>
        <div className="grid lg:grid-cols-[1fr_auto]">
          <div className="flex flex-col items-center justify-center gap-5 p-6 text-center">
            <CheckCircle2 className="size-16 text-success" strokeWidth={1.6} />
            <div>
              <div className="text-sm font-semibold text-muted">{method === 'credit' ? t('refund.toAccount') : t('refund.payBack', { method: t(`common:payment.${method}`) })}</div>
              <div className="tnum text-5xl font-extrabold text-success">{formatMoney(-done.total)}</div>
            </div>
            <ActionTiles
              cols={2}
              className="w-full max-w-xs"
              actions={[
                { label: t('common:print'), icon: <Printer />, onClick: () => void printSale(done) },
                { label: 'WhatsApp', icon: <MessageCircle />, onClick: () => shareWhatsApp(done) },
                { label: t('common:share'), icon: <Share2 />, onClick: () => void shareNative(done) },
                { label: t('common:email'), icon: <Mail />, onClick: () => emailReceipt(done, customerEmail) },
              ]}
            />
            <Button variant="primary" size="xl" block className="max-w-xs" onClick={onClose} autoFocus>
              {t('common:done')}
            </Button>
          </div>
          <div className="hidden border-s border-border bg-surface-3 p-4 lg:block">
            <ReceiptPreview sale={done} />
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => !busy && onClose()}
        dismissible={!busy}
        size="lg"
        flush
        title={t('refund.title', { number: sale.number })}
        subtitle={[sale.customerName, formatMoney(sale.total)].filter(Boolean).join(' · ')}
        footer={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="me-auto min-w-0">
              <div className="text-xs font-medium text-muted">{t('refund.total')}</div>
              <div className={cn('tnum text-2xl font-extrabold', sum.total ? 'text-danger' : 'text-subtle')}>{formatMoney(-sum.total || 0)}</div>
            </div>
            <Button onClick={onClose} disabled={busy}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" size="lg" icon={<Undo2 className="size-5" />} loading={busy} disabled={!lines.length || already === null} onClick={submit}>
              {t('refund.confirm')}
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1 text-sm text-muted">{nothingLeft ? t('refund.nothingLeft') : t('refund.pickItems')}</div>
          <Button size="sm" variant={everything ? 'soft' : 'secondary'} icon={<ListChecks className="size-4" />} onClick={selectAll} disabled={nothingLeft}>
            {everything && lines.length ? t('refund.clearAll') : t('refund.everything')}
          </Button>
        </div>
        <ul className="divide-y divide-border">
          {refundable.map((l) => {
            const max = available(l.id, l.qty)
            const returned = already?.[l.id] ?? 0
            const r = byLine.get(l.id)
            return (
              <li key={l.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3', max <= 0 && 'opacity-60')}>
                <div className="min-w-0 flex-1 basis-40">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="tnum flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>
                      {formatQty(l.qty)} × {formatMoney(Math.round(l.total / l.qty))}
                    </span>
                    {returned > 0 && <Badge tone={max <= 0 ? 'neutral' : 'warning'}>{t('refund.returnedQty', { qty: formatQty(returned) })}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Stepper value={qty[l.id] ?? 0} max={max} disabled={max <= 0} label={l.name} integer={COUNTED.has(l.unit) && Number.isInteger(l.qty)} onChange={(v) => setQty((q) => ({ ...q, [l.id]: v }))} />
                  <div className={cn('tnum w-24 text-end font-semibold', !r && 'text-subtle')}>{formatMoney(r ? -r.total : 0)}</div>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="space-y-5 border-t border-border bg-surface-2 p-5">
          <div>
            <div className="mb-2 text-sm font-medium text-muted">{t('refund.method')}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {methods.map((m) => {
                const Icon = METHOD_ICONS[m]
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    aria-pressed={method === m}
                    className={cn(
                      'flex h-12 items-center gap-2 rounded-xl border px-3 text-start text-sm font-medium transition-colors',
                      method === m ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface hover:bg-surface-3',
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="truncate">{t(`common:payment.${m}`)}</span>
                  </button>
                )
              })}
            </div>
            {method === 'credit' && <p className="mt-2 text-xs text-muted">{t('refund.creditHint', { name: sale.customerName })}</p>}
          </div>
          <Toggle
            checked={restock}
            onChange={setRestock}
            label={
              <span className="flex items-center gap-2">
                {restock ? <PackageCheck className="size-4 text-success" /> : <PackageX className="size-4 text-warning" />}
                {t('refund.restock')}
              </span>
            }
            description={restock ? t('refund.restockHint') : t('refund.noRestockHint')}
          />
          <div>
            <Input label={t('refund.reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('common:optional')} maxLength={200} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setReason(t(`refund.reasons.${r}`))
                    // Damaged goods should not go back on the shelf.
                    if (r === 'damaged') setRestock(false)
                  }} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
                  {t(`refund.reasons.${r}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>
      <OpenShiftDialog open={needShift} onClose={() => setNeedShift(false)} onOpened={() => setTimeout(() => void submit(), 0)} />
    </>
  )
}
