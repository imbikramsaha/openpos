import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MessageCircle, Printer, QrCode, Share2 } from 'lucide-react'
import type { Customer, CustomerPayment, PaymentMethod } from '@/core/types'
import { db } from '@/db/db'
import { recomputeCustomer } from '@/db/customers'
import { audit, put } from '@/db/repo'
import { formatMoney, fromMinor, moneyConfig } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { cn } from '@/lib/cn'
import { session } from '@/stores/session'
import { settings as getSettings, useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, Input, Modal, MoneyInput, Segmented } from '@/components/ui'
import { METHOD_ICONS } from '@/features/sell/PaymentDialog'
import { OpenShiftDialog } from '@/features/shifts/OpenShiftDialog'
import { ActionTiles, openWhatsApp } from '@/features/sales/shared'
import { paymentReceiptHtml, paymentReceiptText } from './ledger'

// ---- Payment receipt helpers ----------------------------------------------------

export async function printPaymentReceipt(p: CustomerPayment, c: Customer, balanceAfter: number) {
  const s = getSettings()
  const user = p.userId ? await db.users.get(p.userId) : undefined
  const width = s.receipt.paperWidth === 'a4' ? undefined : s.receipt.paperWidth
  await printHtml(paymentReceiptHtml(p, c, balanceAfter, s, user?.name), width)
}

export async function sharePaymentReceipt(p: CustomerPayment, c: Customer, balanceAfter: number, copiedLabel: string) {
  const text = paymentReceiptText(p, c, balanceAfter, getSettings())
  if (navigator.share) {
    try {
      await navigator.share({ title: getSettings().businessName, text })
    } catch {
      /* cancelled */
    }
  } else {
    await navigator.clipboard?.writeText(text)
    toast(copiedLabel)
  }
}

function PaymentDone({ payment, customer, balanceAfter, onClose }: { payment: CustomerPayment; customer: Customer; balanceAfter: number; onClose: () => void }) {
  const { t } = useTranslation('customers')
  const text = () => paymentReceiptText(payment, customer, balanceAfter, getSettings())
  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center">
      <CheckCircle2 className="size-16 text-success" strokeWidth={1.6} />
      <div>
        <div className="text-sm font-semibold text-muted">{t('pay.received')}</div>
        <div className="tnum text-5xl font-semibold tracking-tight text-success">{formatMoney(payment.amount)}</div>
        <div className="mt-1 text-sm text-muted">{t(`common:payment.${payment.method}`)}</div>
      </div>
      <div className={cn('w-full max-w-xs rounded-2xl px-4 py-3', balanceAfter > 0 ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>
        <div className="text-xs font-semibold">{balanceAfter < 0 ? t('advance') : balanceAfter === 0 ? t('noBalance') : t('balanceDue')}</div>
        <div className="tnum text-2xl font-semibold tracking-tight">{formatMoney(Math.abs(balanceAfter))}</div>
      </div>
      <ActionTiles
        className="w-full max-w-xs"
        actions={[
          { label: t('common:print'), icon: <Printer />, onClick: () => void printPaymentReceipt(payment, customer, balanceAfter) },
          { label: 'WhatsApp', icon: <MessageCircle />, onClick: () => openWhatsApp(customer.phone, text()) },
          { label: t('common:share'), icon: <Share2 />, onClick: () => void sharePaymentReceipt(payment, customer, balanceAfter, t('common:copied')) },
        ]}
      />
      <Button variant="primary" size="xl" block className="max-w-xs" onClick={onClose} autoFocus>
        {t('common:done')}
      </Button>
    </div>
  )
}

// ---- Receive payment (khata settlement) -----------------------------------------

export function ReceivePaymentDialog({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('customers')
  const settings = useSettings((s) => s.settings)
  const methods = useMemo<PaymentMethod[]>(() => {
    const list = settings.enabledPayments.filter((m) => m !== 'credit' && m !== 'loyalty')
    return list.length ? list : ['cash']
  }, [settings.enabledPayments])
  const [amount, setAmount] = useState<number | undefined>()
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [needShift, setNeedShift] = useState(false)
  const [done, setDone] = useState<{ payment: CustomerPayment; balanceAfter: number } | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setAmount(customer.balance > 0 ? customer.balance : undefined)
    setMethod(methods.includes('cash') ? 'cash' : methods[0])
    setNote('')
    setQr(null)
    setDone(null)
  }, [open, customer.id])

  useEffect(() => setQr(null), [amount, method])

  const valid = !!amount && amount > 0 && amount < 1e12
  const after = customer.balance - (amount ?? 0)

  const showQr = async () => {
    if (!valid || !settings.upiId) return
    const { toDataURL } = await import('qrcode')
    const url = `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.upiName || settings.businessName)}&am=${fromMinor(amount!).toFixed(moneyConfig().decimals)}&cu=${settings.currency}&tn=${encodeURIComponent(customer.name)}`
    setQr(await toDataURL(url, { margin: 1, width: 280 }))
  }

  const submit = async () => {
    if (!valid || busyRef.current) return
    if (settings.requireShift && !session().shift) return setNeedShift(true)
    const user = session().user
    if (!user) return
    busyRef.current = true
    setBusy(true)
    try {
      const payment = await put<CustomerPayment>('customerPayments', {
        customerId: customer.id,
        amount: amount!,
        method,
        note: note.trim() || undefined,
        userId: user.id,
        shiftId: session().shift?.id,
      })
      await recomputeCustomer(customer.id)
      const balanceAfter = (await db.customers.get(customer.id))?.balance ?? customer.balance - amount!
      void audit('customer.payment', 'customer', customer.id, `${payment.amount} ${method}`)
      toast(t('pay.done', { amount: formatMoney(payment.amount), name: customer.name }))
      setDone({ payment, balanceAfter })
      if (settings.receipt.autoPrint) void printPaymentReceipt(payment, customer, balanceAfter)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => !busy && onClose()}
        dismissible={!busy}
        title={done ? t('pay.receiptTitle') : t('pay.title')}
        subtitle={customer.name}
        size="md"
        footer={
          done ? undefined : (
            <>
              <Button onClick={onClose} disabled={busy}>
                {t('common:cancel')}
              </Button>
              <Button variant="success" size="lg" loading={busy} disabled={!valid} onClick={submit}>
                {valid ? t('pay.confirm', { amount: formatMoney(amount!) }) : t('pay.title')}
              </Button>
            </>
          )
        }
      >
        {done ? (
          <PaymentDone payment={done.payment} customer={customer} balanceAfter={done.balanceAfter} onClose={onClose} />
        ) : (
          <form className="space-y-5" onSubmit={(e) => (e.preventDefault(), void submit())}>
            <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
              <span className="text-sm font-medium text-muted">{customer.balance < 0 ? t('advance') : t('balanceDue')}</span>
              <span className={cn('tnum text-xl font-semibold tracking-tight', customer.balance > 0 && 'text-danger')}>{formatMoney(Math.abs(customer.balance))}</span>
            </div>
            <div>
              <MoneyInput label={t('common:amount')} value={amount} onChange={setAmount} autoFocus className="h-14 text-2xl font-semibold tracking-tight" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {customer.balance > 0 && amount !== customer.balance && (
                  <button type="button" onClick={() => setAmount(customer.balance)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
                    {t('pay.fullBalance', { amount: formatMoney(customer.balance) })}
                  </button>
                )}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-muted">{t('pay.method')}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {methods.map((m) => {
                  const Icon = METHOD_ICONS[m]
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={method === m}
                      onClick={() => setMethod(m)}
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
            </div>
            {method === 'upi' && settings.upiId && valid && (
              <div className="flex flex-col items-center gap-2">
                {qr ? (
                  <>
                    <img src={qr} alt="UPI QR" className="size-56 rounded-2xl border border-border bg-white p-2" />
                    <span className="text-xs text-muted">{settings.upiId}</span>
                  </>
                ) : (
                  <Button variant="soft" icon={<QrCode className="size-4" />} onClick={showQr}>
                    {t('pay.showQr')}
                  </Button>
                )}
              </div>
            )}
            <Input label={t('common:note')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('pay.notePlaceholder')} maxLength={200} />
            {valid && (
              <p className={cn('text-sm', after < 0 ? 'text-success' : 'text-muted')}>
                {after < 0 ? t('pay.overpaid', { amount: formatMoney(-after) }) : t('pay.after', { amount: formatMoney(after) })}
              </p>
            )}
            <button type="submit" className="hidden" />
          </form>
        )}
      </Modal>
      <OpenShiftDialog open={needShift} onClose={() => setNeedShift(false)} onOpened={() => setTimeout(() => void submit(), 0)} />
    </>
  )
}

// ---- Manual adjustment / charge -------------------------------------------------

export function AdjustBalanceDialog({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('customers')
  const [kind, setKind] = useState<'charge' | 'reduce'>('charge')
  const [amount, setAmount] = useState<number | undefined>()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind('charge')
    setAmount(undefined)
    setNote('')
  }, [open])

  const valid = !!amount && amount > 0 && amount < 1e12 && !!note.trim()
  const after = customer.balance + (kind === 'charge' ? 1 : -1) * (amount ?? 0)

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      // Non-cash ledger entry: negative = charge (customer owes more), positive = reduction.
      await put<CustomerPayment>('customerPayments', {
        customerId: customer.id,
        amount: kind === 'charge' ? -amount! : amount!,
        method: 'credit',
        note: note.trim(),
        userId: session().user?.id ?? '',
        shiftId: session().shift?.id,
      })
      await recomputeCustomer(customer.id)
      void audit('customer.adjust', 'customer', customer.id, `${kind} ${amount}: ${note.trim()}`)
      toast(t('adjust.done'))
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('adjust.title')}
      subtitle={customer.name}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common:cancel')}
          </Button>
          <Button variant={kind === 'charge' ? 'danger' : 'primary'} loading={busy} disabled={!valid} onClick={submit}>
            {kind === 'charge' ? t('adjust.addCharge') : t('adjust.reduce')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Segmented
          value={kind}
          onChange={setKind}
          className="w-full"
          options={[
            { value: 'charge', label: t('adjust.addCharge') },
            { value: 'reduce', label: t('adjust.reduce') },
          ]}
        />
        <p className="text-xs text-muted">{kind === 'charge' ? t('adjust.chargeHint') : t('adjust.reduceHint')}</p>
        <MoneyInput label={t('common:amount')} value={amount} onChange={setAmount} autoFocus />
        <Input label={`${t('common:reason')} *`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'charge' ? t('adjust.chargePlaceholder') : t('adjust.reducePlaceholder')} maxLength={200} />
        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 text-sm">
          <span className="text-muted">{t('adjust.newBalance')}</span>
          <span className={cn('tnum font-semibold', after > 0 && 'text-danger', after < 0 && 'text-success')}>
            {formatMoney(Math.abs(after))} {after < 0 ? `(${t('advance')})` : ''}
          </span>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
