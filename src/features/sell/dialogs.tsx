import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, PauseCircle, Phone, Plus, Trash2, UserPlus, UserX } from 'lucide-react'
import type { CartLine, Customer, DiscountType, HeldOrder } from '@/core/types'
import { db } from '@/db/db'
import { audit, put, remove } from '@/db/repo'
import { formatMoney, fromMinor, parseDecimal, toMinor, moneyConfig } from '@/lib/money'
import { relativeTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { useCart } from '@/stores/cart'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { device } from '@/stores/device'
import { toast, confirmDialog } from '@/stores/ui'
import { Avatar, Badge, Button, EmailInput, EmptyState, Input, Modal, NumPad, PhoneInput, SearchInput, Segmented, Select, TaxIdInput, applyNumKey } from '@/components/ui'
import { emailError, hasErrors, LIMITS, phoneError, sanitizePhone, taxIdError } from '@/lib/validate'
import { calcCart } from './checkout'

// ---- Numeric entry (quantity / price) ---------------------------------------

export function NumberDialog({ open, onClose, title, subtitle, initial, onSubmit, money, allowNegative }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  initial: number
  onSubmit: (value: number) => void
  money?: boolean
  allowNegative?: boolean
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [negative, setNegative] = useState(false)
  useEffect(() => {
    if (open) {
      setText('')
      setNegative(initial < 0)
    }
  }, [open, initial])
  const display = text || String(Math.abs(money ? fromMinor(initial) : initial))
  const submit = () => {
    const n = parseDecimal(display)
    if (Number.isNaN(n)) return
    const v = negative ? -n : n
    onSubmit(money ? toMinor(v) : v)
    onClose()
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (/^[\d.]$/.test(e.key)) setText((s) => applyNumKey(s, e.key, money ? moneyConfig().decimals : 3))
      else if (e.key === ',') setText((s) => applyNumKey(s, '.'))
      else if (e.key === 'Backspace') setText((s) => s.slice(0, -1))
      else if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === '-' && allowNegative) setNegative((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="sm">
      <div className={cn('tnum mb-4 rounded-2xl bg-surface-3 px-4 py-4 text-end text-4xl font-bold', !text && 'text-subtle')}>
        {negative && '−'}
        {display}
      </div>
      <NumPad onKey={(k) => setText((s) => applyNumKey(s, k, money ? moneyConfig().decimals : 3))} />
      <div className="mt-4 flex gap-2">
        {allowNegative && (
          <Button size="lg" onClick={() => setNegative((v) => !v)} className={cn(negative && 'border-danger text-danger')}>
            ±
          </Button>
        )}
        <Button size="lg" variant="ghost" onClick={() => setText('')}>
          {t('clear')}
        </Button>
        <Button size="lg" variant="primary" block onClick={submit}>
          {t('ok')}
        </Button>
      </div>
    </Modal>
  )
}

// ---- Discount ---------------------------------------------------------------

export function DiscountDialog({ open, onClose, line }: { open: boolean; onClose: () => void; line?: CartLine }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const [scope, setScope] = useState<'line' | 'cart'>(line ? 'line' : 'cart')
  const [type, setType] = useState<DiscountType>('percent')
  const [text, setText] = useState('')
  useEffect(() => {
    if (!open) return
    const sc = line ? 'line' : 'cart'
    setScope(sc)
    const current = sc === 'line' ? line : { discountType: cart.discountType, discountValue: cart.discountValue }
    setType(current?.discountType ?? 'percent')
    setText(current?.discountValue ? String(current.discountType === 'amount' ? fromMinor(current.discountValue) : current.discountValue) : '')
  }, [open])
  const apply = (value?: number) => {
    const n = value ?? parseDecimal(text)
    const v = Number.isNaN(n) ? 0 : n
    const stored = type === 'amount' ? toMinor(v) : Math.min(v, 100)
    if (scope === 'line' && line) cart.setLineDiscount(line.id, type, stored)
    else cart.setCartDiscount(type, stored)
    void audit('discount', scope, line?.id, `${type} ${v}`)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={t('discount')} size="sm">
      <div className="mb-3 flex flex-wrap gap-2">
        {line && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'line', label: t('discountItem') },
              { value: 'cart', label: t('discountCart') },
            ]}
            className="w-full"
          />
        )}
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'percent', label: '%' },
            { value: 'amount', label: t('amount') },
          ]}
          className="w-full"
        />
      </div>
      {type === 'percent' && (
        <div className="mb-3 grid grid-cols-6 gap-1.5">
          {[5, 10, 15, 20, 25, 50].map((p) => (
            <Button key={p} size="sm" variant="soft" onClick={() => apply(p)}>
              {p}%
            </Button>
          ))}
        </div>
      )}
      <div className="tnum mb-3 rounded-2xl bg-surface-3 px-4 py-3 text-end text-3xl font-bold">
        {text || '0'}
        {type === 'percent' ? '%' : ''}
      </div>
      <NumPad onKey={(k) => setText((s) => applyNumKey(s, k, 2))} size="md" />
      <div className="mt-4 flex gap-2">
        <Button size="lg" variant="ghost" onClick={() => apply(0)}>
          {t('removeDiscount')}
        </Button>
        <Button size="lg" variant="primary" block onClick={() => apply()}>
          {t('apply')}
        </Button>
      </div>
    </Modal>
  )
}

// ---- Note -------------------------------------------------------------------

export function NoteDialog({ open, onClose, initial, onSave, title }: { open: boolean; onClose: () => void; initial?: string; onSave: (v: string) => void; title: string }) {
  const { t } = useTranslation()
  const [v, setV] = useState('')
  useEffect(() => {
    if (open) setV(initial ?? '')
  }, [open, initial])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <Button
          variant="primary"
          onClick={() => {
            onSave(v.trim())
            onClose()
          }}
        >
          {t('save')}
        </Button>
      }
    >
      <textarea
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={4}
        className="w-full rounded-xl border border-border bg-surface p-3 focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
      />
    </Modal>
  )
}

// ---- Custom (non-catalogue) item --------------------------------------------

export function CustomItemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const taxes = useSettings((s) => s.taxes)
  const defaultTaxId = useSettings((s) => s.settings.defaultTaxId)
  const addCustomLine = useCart((s) => s.addCustomLine)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [taxId, setTaxId] = useState('')
  useEffect(() => {
    if (open) {
      setName('')
      setPrice('')
      setTaxId(defaultTaxId ?? '')
    }
  }, [open, defaultTaxId])
  const valid = name.trim() && !Number.isNaN(parseDecimal(price))
  const add = () => {
    if (!valid) return
    addCustomLine(name.trim(), toMinor(parseDecimal(price)), taxId || undefined)
    onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('customItem')}
      size="sm"
      footer={
        <Button variant="primary" onClick={add} disabled={!valid}>
          {t('addToCart')}
        </Button>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), add())}>
        <Input label={t('itemName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Input label={t('price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Select label={t('tax')} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder={t('noTax')} options={taxes.filter((x) => !x.deleted).map((x) => ({ value: x.id, label: x.name }))} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

// ---- Held (parked) orders ---------------------------------------------------

export async function holdCurrentCart(label?: string): Promise<boolean> {
  const cart = useCart.getState()
  const user = useSession.getState().user
  if (!cart.lines.length || !user) return false
  const calc = calcCart(cart)
  const customer = cart.customerId ? await db.customers.get(cart.customerId) : undefined
  await put<HeldOrder>('heldOrders', {
    label: label || cart.table || customer?.name || `${formatMoney(calc.total)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    cart: cart.snapshot(),
    userId: user.id,
    userName: user.name,
    deviceId: device().deviceId,
  })
  cart.clear()
  return true
}

export function HeldOrdersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const held = useLiveQuery(async () => (await db.heldOrders.orderBy('createdAt').reverse().toArray()).filter((h) => !h.deleted), [])

  const recall = async (h: HeldOrder) => {
    if (cart.lines.length) {
      const ok = await confirmDialog({ title: t('replaceCart'), message: t('replaceCartHint'), confirmLabel: t('holdAndRecall') })
      if (!ok) return
      await holdCurrentCart()
    }
    cart.load(h.cart)
    await remove('heldOrders', h.id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('heldOrders')} size="md" flush>
      {!held?.length ? (
        <EmptyState icon={<PauseCircle />} title={t('noHeldOrders')} description={t('noHeldOrdersHint')} />
      ) : (
        <ul className="divide-y divide-border">
          {held.map((h) => {
            const total = calcCart(h.cart).total
            return (
              <li key={h.id} className="flex items-center gap-3 px-5 py-3">
                <button onClick={() => recall(h)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
                    <Clock className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{h.label}</span>
                    <span className="block truncate text-xs text-muted">
                      {t('itemsCount', { count: h.cart.lines.length })} · {h.userName} · {relativeTime(h.createdAt)}
                    </span>
                  </span>
                  <span className="tnum font-semibold">{formatMoney(total)}</span>
                </button>
                <Button size="icon-sm" variant="ghost" aria-label={t('common:delete')} onClick={async () => (await confirmDialog({ title: t('deleteHeld'), danger: true })) && remove('heldOrders', h.id)}>
                  <Trash2 className="size-4 text-danger" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// ---- Customer picker --------------------------------------------------------

export function CustomerPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', taxNumber: '' })
  useEffect(() => {
    if (open) {
      setQ('')
      setCreating(false)
    }
  }, [open])
  const customers = useLiveQuery(async () => (await db.customers.orderBy('name').toArray()).filter((c) => !c.deleted), [])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = customers ?? []
    if (!s) return list.slice(0, 100)
    return list.filter((c) => c.name.toLowerCase().includes(s) || c.phone?.replace(/\s/g, '').includes(s.replace(/\s/g, '')) || c.email?.toLowerCase().includes(s) || c.taxNumber?.toLowerCase().includes(s)).slice(0, 100)
  }, [customers, q])

  const pick = (c?: Customer) => {
    cart.setCustomer(c)
    onClose()
  }

  const settings = useSettings((s) => s.settings)
  const formInvalid = hasErrors({ phone: phoneError(form.phone), email: emailError(form.email), tax: taxIdError(form.taxNumber, settings.country) })
  const create = async () => {
    if (!form.name.trim() || formInvalid) return
    const c = await put<Customer>('customers', { ...form, name: form.name.trim(), loyaltyPoints: 0, balance: 0 })
    toast(t('customerAdded'))
    pick(c)
  }

  return (
    <Modal open={open} onClose={onClose} title={creating ? t('newCustomer') : t('selectCustomer')} size="md" flush>
      {creating ? (
        <form className="space-y-4 p-5" onSubmit={(e) => (e.preventDefault(), void create())}>
          <Input label={t('customers:name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus maxLength={LIMITS.name} />
          <PhoneInput label={t('customers:phone')} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <EmailInput label={t('customers:email')} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <TaxIdInput label={settings.taxLabel} value={form.taxNumber} country={settings.country} onChange={(v) => setForm({ ...form, taxNumber: v })} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreating(false)}>{t('common:back')}</Button>
            <Button type="submit" variant="primary" disabled={!form.name.trim() || formInvalid}>
              {t('common:save')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex gap-2 border-b border-border p-4">
            <SearchInput value={q} onChange={setQ} placeholder={t('searchCustomer')} autoFocus className="flex-1" />
            <Button
              variant="primary"
              size="icon-lg"
              aria-label={t('newCustomer')}
              onClick={() => {
                const digits = q.replace(/[^\d+]/g, '')
                setForm({ name: digits.length >= 6 ? '' : q.slice(0, LIMITS.name), phone: digits.length >= 6 ? sanitizePhone(q) : '', email: '', taxNumber: '' })
                setCreating(true)
              }}
            >
              <UserPlus className="size-5" />
            </Button>
          </div>
          <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto">
            {cart.customerId && (
              <li>
                <button onClick={() => pick(undefined)} className="flex w-full items-center gap-3 px-5 py-3 text-start text-danger hover:bg-surface-2">
                  <UserX className="size-5" /> {t('removeCustomer')}
                </button>
              </li>
            )}
            {filtered.map((c) => (
              <li key={c.id}>
                <button onClick={() => pick(c)} className={cn('flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-surface-2', c.id === cart.customerId && 'bg-primary-soft')}>
                  <Avatar name={c.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    {c.phone && (
                      <span className="flex items-center gap-1 truncate text-xs text-muted">
                        <Phone className="size-3" /> {c.phone}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    {c.balance > 0 && <Badge tone="danger">{formatMoney(c.balance)}</Badge>}
                    {c.loyaltyPoints > 0 && <Badge tone="primary">{t('points', { count: c.loyaltyPoints })}</Badge>}
                  </span>
                </button>
              </li>
            ))}
            {!filtered.length && (
              <li className="p-6 text-center">
                <Button variant="soft" icon={<Plus className="size-4" />} onClick={() => (setForm({ name: q, phone: '', email: '', taxNumber: '' }), setCreating(true))}>
                  {t('createNamed', { name: q || t('newCustomer') })}
                </Button>
              </li>
            )}
          </ul>
        </>
      )}
    </Modal>
  )
}
