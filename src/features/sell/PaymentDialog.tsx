import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, BookUser, CreditCard, Gift, Landmark, QrCode, Smartphone, Ticket, Wallet, X } from 'lucide-react'
import type { Payment, PaymentMethod, Sale } from '@/core/types'
import { computeChange, quickCashSuggestions } from '@/core/cart'
import { db } from '@/db/db'
import { formatMoney, fromMinor, moneyConfig, parseDecimal, toMinor } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { useCart } from '@/stores/cart'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Modal, NumPad } from '@/components/ui'
import { requirePermission } from '@/features/auth/permission'
import { calcCart, completeSale } from './checkout'
import { MAX_MONEY_DIGITS, numKey, useDialogKeys } from './dialogs'
import { sendToDisplay } from '@/features/display/channel'

export const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  upi: Smartphone,
  credit: BookUser,
  voucher: Ticket,
  loyalty: Gift,
  bank: Landmark,
  other: Wallet,
}

export function PaymentDialog({ open, onClose, onComplete, onNeedCustomer }: { open: boolean; onClose: () => void; onComplete: (sale: Sale) => void; onNeedCustomer: () => void }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const settings = useSettings((s) => s.settings)
  const calc = useMemo(() => calcCart(cart), [cart])
  const customer = useLiveQuery(() => (cart.customerId ? db.customers.get(cart.customerId).then((c) => (c && !c.deleted ? c : undefined)) : undefined), [cart.customerId])
  const [payments, setPayments] = useState<Payment[]>([])
  const [text, setText] = useState('')
  const [upi, setUpi] = useState<{ amount: number; qr: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const adding = useRef(false)

  useEffect(() => {
    if (open) {
      setPayments([])
      setText('')
      setUpi(null)
    }
  }, [open])

  const total = calc.total
  const { paid, change, due } = computeChange(total, payments)

  // Mirror the amount due on the customer display (with a UPI QR when enabled).
  useEffect(() => {
    if (open) sendToDisplay({ type: 'pay', amount: due })
  }, [open, due])
  useEffect(() => {
    if (!open) return
    return () => {
      if (!busyRef.current) sendToDisplay({ type: 'idle' })
    }
  }, [open])
  const typed = text ? toMinor(parseDecimal(text)) : 0
  const pointValue = settings.loyaltyPointValue || 0
  const pointsValue = customer ? customer.loyaltyPoints * pointValue : 0
  const typeKey = (k: string) => setText((s) => numKey(s, k, moneyConfig().decimals, MAX_MONEY_DIGITS))

  const methods = useMemo(() => {
    const list = [...settings.enabledPayments]
    if (settings.loyaltyEnabled && pointsValue > 0 && !list.includes('loyalty')) list.push('loyalty')
    return list
  }, [settings.enabledPayments, settings.loyaltyEnabled, pointsValue])

  const finalize = async (all: Payment[]) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const sale = await completeSale(cart.snapshot(), all, customer ?? undefined)
      cart.clear()
      sendToDisplay({ type: 'paid', total: sale.total, change: sale.change })
      onComplete(sale)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const add = async (method: PaymentMethod, amount?: number, reference?: string) => {
    // Ignore taps while a previous tender is still awaiting approval or completing the sale.
    if (adding.current || busyRef.current) return
    adding.current = true
    try {
      await addTender(method, amount, reference)
    } finally {
      adding.current = false
    }
  }

  const addTender = async (method: PaymentMethod, amount?: number, reference?: string) => {
    let amt = amount ?? (typed > 0 ? typed : due)
    if (amt <= 0 && due > 0) return
    if (method !== 'cash') amt = Math.min(amt, due)
    if (amt <= 0 && total > 0) return

    if (method === 'credit') {
      if (!customer) {
        toast(t('creditNeedsCustomer'), 'warning')
        onNeedCustomer()
        return
      }
      if (!(await requirePermission('customers_credit'))) return
      if (customer.creditLimit && customer.balance + amt > customer.creditLimit) {
        const ok = await confirmDialog({ title: t('creditLimitExceeded'), message: t('creditLimitHint', { limit: formatMoney(customer.creditLimit), balance: formatMoney(customer.balance) }), danger: true })
        if (!ok) return
      }
    }
    if (method === 'loyalty') {
      // Redeem whole points only, so the value credited always matches the points deducted.
      amt = pointValue > 0 ? Math.floor(Math.min(amt, pointsValue) / pointValue) * pointValue : 0
      if (amt <= 0) return
    }
    if (method === 'upi' && !reference && settings.upiId) {
      const { toDataURL } = await import('qrcode')
      const url = `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.upiName || settings.businessName)}&am=${fromMinor(amt).toFixed(moneyConfig().decimals)}&cu=${settings.currency}&tn=${encodeURIComponent(settings.businessName)}`
      setUpi({ amount: amt, qr: await toDataURL(url, { margin: 1, width: 320 }) })
      return
    }

    const next = [...payments, { id: uuid(), method, amount: amt, reference }]
    setPayments(next)
    setText('')
    if (computeChange(total, next).due <= 0) await finalize(next)
  }

  const keysRef = useDialogKeys(open, (e) => {
    if (/^F([1-8])$/.test(e.key)) {
      // Always swallow F1–F8 here: unused ones would otherwise reload the page (F5) or open help.
      e.preventDefault()
      const m = methods[Number(e.key.slice(1)) - 1]
      if (m && !upi && (due > 0 || m === 'cash')) void add(m)
      return
    }
    if (upi) return
    if (/^[\d.]$/.test(e.key)) typeKey(e.key)
    else if (e.key === ',') typeKey('.')
    else if (e.key === 'Backspace') setText((s) => s.slice(0, -1))
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (due <= 0) void finalize(payments)
      else void add('cash')
    }
  })

  const notes = settings.quickCash.map((n) => toMinor(n))
  const quick = quickCashSuggestions(due, notes)

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={t('payment')} size="xl" flush dismissible={!busy}>
      <div className="grid min-h-0 lg:grid-cols-[1fr_1.15fr]">
        {/* Summary */}
        <div ref={keysRef} className="flex flex-col gap-4 border-b border-border bg-surface-2 p-5 lg:border-e lg:border-b-0">
          <div>
            <div className="text-sm font-medium text-muted">{t('totalToPay')}</div>
            <div className="tnum text-4xl font-extrabold tracking-tight sm:text-5xl">{formatMoney(total)}</div>
            <div className="mt-1 text-sm text-muted">
              {t('itemsCount', { count: cart.lines.length })}
              {customer && ` · ${customer.name}`}
            </div>
          </div>
          <ul className="space-y-2">
            {payments.map((p) => {
              const Icon = METHOD_ICONS[p.method]
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
                  <Icon className="size-5 text-muted" />
                  <span className="flex-1 font-medium">{t(`common:payment.${p.method}`)}</span>
                  <span className="tnum font-semibold">{formatMoney(p.amount)}</span>
                  <button onClick={() => setPayments(payments.filter((x) => x.id !== p.id))} className="flex size-7 items-center justify-center rounded-lg text-subtle hover:bg-surface-3" aria-label={t('common:remove')}>
                    <X className="size-4" />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-auto space-y-2">
            <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3">
              <span className="font-medium text-muted">{t('paid')}</span>
              <span className="tnum text-xl font-bold">{formatMoney(paid)}</span>
            </div>
            {change > 0 ? (
              <div className="flex items-center justify-between rounded-2xl bg-success-soft px-4 py-3 text-success">
                <span className="font-semibold">{t('change')}</span>
                <span className="tnum text-2xl font-extrabold">{formatMoney(change)}</span>
              </div>
            ) : (
              <div className={cn('flex items-center justify-between rounded-2xl px-4 py-3', due > 0 ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success')}>
                <span className="font-semibold">{t('remaining')}</span>
                <span className="tnum text-2xl font-extrabold">{formatMoney(due)}</span>
              </div>
            )}
            {customer && pointsValue > 0 && settings.loyaltyEnabled && (
              <p className="text-xs text-muted">{t('pointsAvailable', { count: customer.loyaltyPoints, value: formatMoney(pointsValue) })}</p>
            )}
          </div>
        </div>

        {/* Entry */}
        <div className="flex flex-col gap-4 p-5">
          {upi ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex items-center gap-2 text-sm font-semibold text-muted">
                <QrCode className="size-4" /> {t('scanToPay')}
              </div>
              <img src={upi.qr} alt="UPI QR" className="size-64 rounded-2xl border border-border bg-white p-2" />
              <div className="tnum text-3xl font-extrabold">{formatMoney(upi.amount)}</div>
              <div className="text-xs text-muted">{settings.upiId}</div>
              <div className="flex w-full gap-2">
                <Button size="lg" onClick={() => setUpi(null)}>
                  {t('common:back')}
                </Button>
                <Button
                  size="lg"
                  variant="success"
                  block
                  loading={busy}
                  onClick={() => {
                    const amount = upi.amount
                    setUpi(null)
                    void add('upi', amount, 'QR')
                  }}
                >
                  {t('paymentReceived')}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl border-2 border-primary bg-surface px-4 py-3">
                <span className="text-sm font-medium text-muted">{t('amount')}</span>
                <span className={cn('tnum flex-1 text-end text-3xl font-bold', !text && 'text-subtle')}>{text ? formatMoney(typed) : formatMoney(Math.max(due, 0))}</span>
              </div>
              {quick.length > 0 && settings.enabledPayments.includes('cash') && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {quick.map((v, i) => (
                    <Button key={v} variant={i === 0 ? 'soft' : 'secondary'} onClick={() => add('cash', v)} disabled={busy} className="tnum h-auto min-h-11 px-2 leading-tight whitespace-normal">
                      {i === 0 ? t('exact') : formatMoney(v)}
                    </Button>
                  ))}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                {/* Keypads keep the 7-8-9 layout in right-to-left languages too. */}
                <div dir="ltr">
                  <NumPad onKey={typeKey} size="md" decimal={moneyConfig().decimals > 0} />
                </div>
                <div className="order-first grid grid-cols-2 content-start gap-2 sm:order-none sm:w-52 sm:grid-cols-1">
                  {methods.map((m, i) => {
                    const Icon = METHOD_ICONS[m]
                    return (
                      <Button key={m} variant={m === 'cash' ? 'primary' : 'secondary'} className="h-auto min-h-12 justify-start py-2 whitespace-normal" icon={<Icon className="size-5" />} onClick={() => add(m)} disabled={busy || (due <= 0 && m !== 'cash')}>
                        <span className="flex-1 text-start leading-tight">{t(`common:payment.${m}`)}</span>
                        <span className="hidden text-[10px] opacity-60 lg:inline">F{i + 1}</span>
                      </Button>
                    )
                  })}
                </div>
              </div>
              {due <= 0 && (
                <Button variant="success" size="xl" block loading={busy} onClick={() => finalize(payments)}>
                  {t('completeSale')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
