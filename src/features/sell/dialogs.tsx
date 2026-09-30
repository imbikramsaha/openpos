import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Clock, PauseCircle, Phone, Plus, Trash2, UserPlus, UserX } from 'lucide-react'
import type { CartLine, Customer, DiscountType, HeldOrder } from '@/core/types'
import { db } from '@/db/db'
import { audit, put, remove } from '@/db/repo'
import { formatMoney, fromMinor, parseDecimal, toMinor, moneyConfig } from '@/lib/money'
import { formatTime, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { useCart } from '@/stores/cart'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { device } from '@/stores/device'
import { toast, confirmDialog } from '@/stores/ui'
import { Avatar, Badge, Button, EmailInput, EmptyState, Input, Modal, NumPad, PhoneInput, SearchInput, Segmented, Select, TaxIdInput, applyNumKey } from '@/components/ui'
import { emailError, hasErrors, LIMITS, phoneDigits, phoneError, phoneKey, phoneMatches, sanitizePhone, taxIdError } from '@/lib/validate'
import { calcCart } from './checkout'

// ---- Keyboard entry helpers -------------------------------------------------

/** Largest amount (major units) that can be typed: keeps money maths far from float limits. */
export const MAX_MONEY_DIGITS = 9
/** Largest quantity that can be typed (integer digits). */
export const MAX_QTY_DIGITS = 6

/** Units sold in whole pieces: their quantity can't be fractional. */
export const isCountUnit = (unit?: string) => unit === 'pcs' || unit === 'box' || unit === 'pack'

/** applyNumKey with a cap on the integer digits, so 99999999999999 can't be typed. */
export function numKey(value: string, key: string, decimals: number, maxDigits: number): string {
  // Without decimals a "." is kept but nothing can follow it, so "2.5" reads as 2, not 25.
  const next = applyNumKey(value, key, Math.max(decimals, 0))
  return next.split('.')[0].length > maxDigits ? value : next
}

/**
 * Global keyboard handling for a numeric dialog. Keys are only delivered while this dialog
 * is the top-most one (a manager-PIN prompt or confirmation on top must not type into it),
 * and focus is moved off the field behind the modal (usually the search box) on open so
 * typed digits and Enter reach the dialog instead of the hidden input.
 * Attach the returned ref to any element inside the modal.
 */
export function useDialogKeys(open: boolean, onKey: (e: KeyboardEvent) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onKey)
  cb.current = onKey
  useEffect(() => {
    if (!open) return
    const own = ref.current?.closest('[role="dialog"]')
    const active = document.activeElement
    if (own && active instanceof HTMLElement && !own.contains(active)) active.blur()
    const handler = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      const dialogs = document.querySelectorAll('[role="dialog"]')
      const top = dialogs[dialogs.length - 1]
      if (!ref.current || !top?.contains(ref.current)) return
      cb.current(e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])
  return ref
}

// ---- Numeric entry (quantity / price) ---------------------------------------

export function NumberDialog({ open, onClose, title, subtitle, initial, onSubmit, money, allowNegative, integer, positive }: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  initial: number
  onSubmit: (value: number) => void
  money?: boolean
  allowNegative?: boolean
  /** Whole numbers only (quantities of items sold by the piece). */
  integer?: boolean
  /** Zero is not an answer (weights): the dialog stays open and says so. */
  positive?: boolean
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
  const decimals = money ? moneyConfig().decimals : integer ? 0 : 3
  const maxDigits = money ? MAX_MONEY_DIGITS : MAX_QTY_DIGITS
  const type = (k: string) => {
    if (k === 'clear') return setText('')
    if (k === '.' && decimals <= 0) toast(money ? t('sell:noDecimals', { currency: moneyConfig().currency }) : t('sell:wholeNumbersOnly'), 'warning')
    setText((s) => numKey(s, k, decimals, maxDigits))
  }
  const display = text || String(Math.abs(money ? fromMinor(initial) : initial))
  const submit = () => {
    const n = parseDecimal(display)
    if (!Number.isFinite(n)) return
    if (positive && n <= 0) return toast(t('sell:aboveZero'), 'warning')
    const v = negative ? -n : n
    // Close first: onSubmit may open a follow-up dialog (open price → weight) that must stay open.
    onClose()
    onSubmit(money ? toMinor(v) : integer ? Math.round(v) : Math.round(v * 1000) / 1000)
  }
  const keysRef = useDialogKeys(open, (e) => {
    if (/^[\d.]$/.test(e.key)) type(e.key)
    else if (e.key === ',') type('.')
    else if (e.key === 'Backspace') type('back')
    else if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === '-' && allowNegative) setNegative((v) => !v)
  })
  return (
    <Modal open={open} onClose={onClose} title={title} subtitle={subtitle} size="sm">
      <div ref={keysRef} className={cn('tnum mb-4 rounded-2xl bg-surface-3 px-4 py-4 text-end text-4xl font-semibold tracking-tight', !text && 'text-subtle')} dir="ltr">
        {negative && '−'}
        {display}
      </div>
      <div dir="ltr">
        <NumPad onKey={type} decimal={decimals > 0} />
      </div>
      <div className="mt-4 flex gap-2">
        {allowNegative && (
          <Button size="lg" onClick={() => setNegative((v) => !v)} className={cn(negative && 'border-danger text-danger')}>
            ±
          </Button>
        )}
        <Button size="lg" variant="ghost" onClick={() => type('clear')}>
          {t('clear')}
        </Button>
        <Button size="lg" variant="primary" className="flex-1" onClick={submit}>
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
  const [current, setCurrent] = useState('')
  // Show the discount already set on the chosen scope (item or whole sale).
  const load = (sc: 'line' | 'cart') => {
    setScope(sc)
    const current = sc === 'line' ? line : { discountType: cart.discountType, discountValue: cart.discountValue }
    setType(current?.discountType ?? 'percent')
    // The current discount is shown greyed; typing replaces it (like the quantity dialog).
    setCurrent(current?.discountValue ? String(current.discountType === 'amount' ? fromMinor(current.discountValue) : current.discountValue) : '')
    setText('')
  }
  useEffect(() => {
    if (open) load(line ? 'line' : 'cart')
  }, [open])
  const decimals = type === 'amount' ? moneyConfig().decimals : 2
  const typeKey = (k: string) => {
    if (k === '.' && decimals <= 0) toast(t('noDecimals', { currency: moneyConfig().currency }), 'warning')
    setText((s) => numKey(s, k, decimals, type === 'amount' ? MAX_MONEY_DIGITS : 3))
  }
  const apply = (value?: number) => {
    const n = value ?? parseDecimal(text || current)
    const v = Number.isFinite(n) ? Math.max(n, 0) : 0
    const stored = type === 'amount' ? toMinor(v) : Math.min(v, 100)
    if (scope === 'line' && line) cart.setLineDiscount(line.id, type, stored)
    else cart.setCartDiscount(type, stored)
    void audit('discount', scope, scope === 'line' ? line?.id : undefined, `${type} ${v}`)
    onClose()
  }
  const keysRef = useDialogKeys(open, (e) => {
    if (/^[\d.]$/.test(e.key)) typeKey(e.key)
    else if (e.key === ',') typeKey('.')
    else if (e.key === 'Backspace') setText((s) => s.slice(0, -1))
    else if (e.key === '%') setType('percent')
    else if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    }
  })
  return (
    <Modal open={open} onClose={onClose} title={t('discount')} size="sm">
      <div ref={keysRef} className="mb-3 flex flex-wrap gap-2">
        {line && (
          <Segmented
            value={scope}
            onChange={load}
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
      <div className={cn('tnum mb-3 rounded-2xl bg-surface-3 px-4 py-3 text-end text-3xl font-semibold tracking-tight', !text && 'text-subtle')} dir="ltr">
        {text || current || '0'}
        {type === 'percent' ? '%' : ''}
      </div>
      <div dir="ltr">
        <NumPad onKey={typeKey} size="md" decimal={decimals > 0} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button size="lg" variant="ghost" onClick={() => apply(0)}>
          {t('removeDiscount')}
        </Button>
        <Button size="lg" variant="ghost" onClick={() => setText('')}>
          {t('common:clear')}
        </Button>
        <Button size="lg" variant="primary" className="flex-1" onClick={() => apply()}>
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
        maxLength={LIMITS.notes}
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
  // Custom items can't be negative: a negative price would be an unapproved discount/refund.
  const amount = parseDecimal(price)
  const priceOk = Number.isFinite(amount) && amount >= 0 && amount < 10 ** MAX_MONEY_DIGITS
  const valid = !!name.trim() && priceOk
  const add = () => {
    if (!valid) return
    addCustomLine(name.trim().slice(0, LIMITS.name), toMinor(amount), taxId || undefined)
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
        <Input label={t('itemName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={LIMITS.name} />
        <Input label={t('price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} error={price.trim() && !priceOk ? t('invalidPrice') : undefined} />
        <Select label={t('tax')} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder={t('noTax')} options={taxes.filter((x) => !x.deleted).sort((p, q) => p.rate - q.rate || p.name.localeCompare(q.name)).map((x) => ({ value: x.id, label: x.name }))} />
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
    label: label || cart.table || customer?.name || `${formatMoney(calc.total)} · ${formatTime(Date.now())}`,
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
  const held = useLiveQuery(async () => (await db.heldOrders.orderBy('createdAt').reverse().toArray()).filter((h) => !h.deleted), [])

  const busy = useRef(false)
  const recall = async (h: HeldOrder) => {
    // A double tap (or another terminal recalling it first) must not load the same sale twice.
    if (busy.current) return
    busy.current = true
    try {
      if (useCart.getState().lines.length) {
        const ok = await confirmDialog({ title: t('replaceCart'), message: t('replaceCartHint'), confirmLabel: t('holdAndRecall') })
        if (!ok) return
      }
      const fresh = await db.heldOrders.get(h.id)
      if (!fresh || fresh.deleted) return
      if (useCart.getState().lines.length) await holdCurrentCart()
      await remove('heldOrders', h.id)
      useCart.getState().load(fresh.cart)
      onClose()
    } finally {
      busy.current = false
    }
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
    // Phone numbers match on digits only, so "98765-43210" finds "98765 43210".
    const digits = phoneDigits(s)
    return list
      .filter((c) => c.name.toLowerCase().includes(s) || phoneMatches(c.phone, digits, useSettings.getState().settings.country) || c.email?.toLowerCase().includes(s) || c.taxNumber?.toLowerCase().includes(s))
      .slice(0, 100)
  }, [customers, q])

  const pick = async (c?: Customer) => {
    // Swapping or removing the customer also drops the previous customer's standing discount
    // (unless the cashier changed the discount by hand), so it can't carry over to someone else.
    const { customerId, discountType, discountValue } = useCart.getState()
    const prev = customerId && customerId !== c?.id ? await db.customers.get(customerId) : undefined
    if (prev?.discountPercent && discountType === 'percent' && discountValue === prev.discountPercent) cart.setCartDiscount(undefined, undefined)
    cart.setCustomer(c)
    onClose()
  }

  const settings = useSettings((s) => s.settings)
  const formInvalid = hasErrors({ phone: phoneError(form.phone), email: emailError(form.email), tax: taxIdError(form.taxNumber, settings.country) })
  const saving = useRef(false)
  const create = async () => {
    if (!form.name.trim() || formInvalid || saving.current) return
    saving.current = true
    try {
      // Same duplicate rule as the customer form: the same local number, with or without +91.
      const key = phoneKey(form.phone)
      const dup = key.length >= 6 ? (customers ?? []).find((c) => phoneKey(c.phone) === key) : undefined
      if (dup && !(await confirmDialog({ title: t('customers:form.duplicateTitle'), message: t('customers:form.duplicatePhone', { name: dup.name }), confirmLabel: t('customers:form.saveAnyway') }))) return
      const opt = (v: string) => v.trim() || undefined
      const c = await put<Customer>('customers', {
        name: form.name.trim(),
        phone: opt(form.phone),
        email: opt(form.email.toLowerCase()),
        taxNumber: opt(form.taxNumber.toUpperCase()),
        loyaltyPoints: 0,
        balance: 0,
      })
      toast(t('customerAdded'))
      await pick(c)
    } finally {
      saving.current = false
    }
  }
  const startCreate = () => {
    // A typed phone number pre-fills the phone field, anything else the name.
    const digits = q.replace(/[^\d+]/g, '')
    setForm({ name: digits.length >= 6 ? '' : q.trim().slice(0, LIMITS.name), phone: digits.length >= 6 ? sanitizePhone(q) : '', email: '', taxNumber: '' })
    setCreating(true)
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
              onClick={startCreate}
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
                <Button variant="soft" icon={<Plus className="size-4" />} onClick={startCreate}>
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
