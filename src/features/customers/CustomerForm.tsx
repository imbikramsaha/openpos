import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Customer, CustomerPayment } from '@/core/types'
import { INDIAN_STATES } from '@/core/presets'
import { db } from '@/db/db'
import { recomputeCustomer } from '@/db/customers'
import { audit, put } from '@/db/repo'
import { formatMoney } from '@/lib/money'
import { session } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, EmailInput, Input, Modal, MoneyInput, NumberInput, PhoneInput, Select, TaxIdInput, Textarea } from '@/components/ui'
import { emailError, LIMITS, phoneError, taxIdError } from '@/lib/validate'
import { requirePermission } from '@/features/auth/permission'
import { phoneKey } from './ledger'

interface FormState {
  name: string
  phone: string
  email: string
  taxNumber: string
  address: string
  city: string
  state: string
  notes: string
  discountPercent?: number
  creditLimit?: number
}

const fromCustomer = (c?: Customer | null): FormState => ({
  name: c?.name ?? '',
  phone: c?.phone ?? '',
  email: c?.email ?? '',
  taxNumber: c?.taxNumber ?? '',
  address: c?.address ?? '',
  city: c?.city ?? '',
  state: c?.state ?? '',
  notes: c?.notes ?? '',
  discountPercent: c?.discountPercent || undefined,
  creditLimit: c?.creditLimit || undefined,
})

const opt = (v: string) => v.trim() || undefined
/** Upper bound for typed amounts (minor units) so absurd inputs can't overflow the ledger maths. */
const MAX_AMOUNT = 1e12

export function CustomerForm({ open, customer, initialName, onClose, onSaved }: { open: boolean; customer?: Customer | null; initialName?: string; onClose: () => void; onSaved?: (c: Customer, created: boolean) => void }) {
  const { t } = useTranslation('customers')
  const settings = useSettings((s) => s.settings)
  const [form, setForm] = useState<FormState>(fromCustomer())
  const [opening, setOpening] = useState<number | undefined>()
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const isNew = !customer

  useEffect(() => {
    if (!open) return
    setForm({ ...fromCustomer(customer), name: customer?.name ?? initialName ?? '' })
    setOpening(undefined)
    setSubmitted(false)
    // Reset only when a different record opens, not on every live update.
  }, [open, customer?.id])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const errors = {
    name: !form.name.trim() ? t('form.nameRequired') : '',
    phone: phoneError(form.phone) ? t(`common:${phoneError(form.phone)}`) : '',
    email: emailError(form.email) ? t(`common:${emailError(form.email)}`) : '',
    taxNumber: taxIdError(form.taxNumber, settings.country) ? t(`common:${taxIdError(form.taxNumber, settings.country)}`) : '',
    discountPercent: form.discountPercent !== undefined && (form.discountPercent < 0 || form.discountPercent > 100) ? t('form.discountRange') : '',
    creditLimit: form.creditLimit !== undefined && form.creditLimit < 0 ? t('form.limitNegative') : form.creditLimit !== undefined && form.creditLimit > MAX_AMOUNT ? t('form.amountTooLarge') : '',
    opening: isNew && opening !== undefined && Math.abs(opening) > MAX_AMOUNT ? t('form.amountTooLarge') : '',
  }
  const invalid = Object.values(errors).some(Boolean)

  const save = async () => {
    setSubmitted(true)
    if (invalid || busy) return
    const key = phoneKey(form.phone)
    if (key.length >= 6) {
      const dup = await db.customers.filter((c) => !c.deleted && c.id !== customer?.id && phoneKey(c.phone) === key).first()
      if (dup && !(await confirmDialog({ title: t('form.duplicateTitle'), message: t('form.duplicatePhone', { name: dup.name }), confirmLabel: t('form.saveAnyway') }))) return
    }
    // Credit terms and standing discounts need the same rights as granting them at the till.
    const limitChanged = (form.creditLimit || undefined) !== (customer?.creditLimit || undefined)
    const discountChanged = (form.discountPercent || undefined) !== (customer?.discountPercent || undefined)
    if (((isNew && opening) || limitChanged) && !(await requirePermission('customers_credit'))) return
    if (discountChanged && form.discountPercent && !(await requirePermission('discount'))) return
    setBusy(true)
    try {
      // Balance and points are derived from the ledgers; always keep the stored values.
      const latest = customer ? await db.customers.get(customer.id) : undefined
      const saved = await put<Customer>('customers', {
        ...(latest ?? {}),
        id: customer?.id,
        createdAt: latest?.createdAt,
        name: form.name.trim(),
        phone: opt(form.phone),
        email: opt(form.email.toLowerCase()),
        taxNumber: opt(form.taxNumber.toUpperCase()),
        address: opt(form.address),
        city: opt(form.city),
        state: opt(form.state),
        notes: opt(form.notes),
        discountPercent: form.discountPercent || undefined,
        creditLimit: form.creditLimit || undefined,
        balance: latest?.balance ?? 0,
        loyaltyPoints: latest?.loyaltyPoints ?? 0,
      })
      if (isNew && opening) {
        await put<CustomerPayment>('customerPayments', {
          customerId: saved.id,
          amount: -opening,
          method: 'credit',
          note: t('openingBalance'),
          userId: session().user?.id ?? '',
          shiftId: session().shift?.id,
        })
        await recomputeCustomer(saved.id)
      }
      void audit(isNew ? 'customer.create' : 'customer.update', 'customer', saved.id, saved.name)
      toast(isNew ? t('form.created', { name: saved.name }) : t('form.saved'))
      onSaved?.(saved, isNew)
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const err = (k: keyof typeof errors) => (submitted ? errors[k] || undefined : undefined)

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={isNew ? t('form.newTitle') : t('form.editTitle')}
      subtitle={customer?.name}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common:cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t('common:save')}
          </Button>
        </>
      }
    >
      <form className="space-y-6" onSubmit={(e) => (e.preventDefault(), void save())}>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('form.contact')}</legend>
          <Input label={`${t('name')} *`} value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} autoFocus={isNew} autoComplete="off" maxLength={LIMITS.name} wrapperClassName="sm:col-span-2" />
          <PhoneInput label={t('phone')} value={form.phone} onChange={(v) => set('phone', v)} showErrors={submitted} />
          <EmailInput label={t('email')} value={form.email} onChange={(v) => set('email', v)} showErrors={submitted} />
          <TaxIdInput label={settings.taxLabel || t('taxNumber')} value={form.taxNumber} onChange={(v) => set('taxNumber', v)} country={settings.country} showErrors={submitted} />
          <NumberInput label={t('discountPercent')} hint={t('form.discountHint')} value={form.discountPercent} onChange={(v) => set('discountPercent', v)} error={err('discountPercent')} right={<span className="pe-2 text-sm text-subtle">%</span>} />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('form.addressSection')}</legend>
          <Input label={t('address')} value={form.address} onChange={(e) => set('address', e.target.value)} autoComplete="off" wrapperClassName="sm:col-span-2" maxLength={200} />
          <Input label={t('city')} value={form.city} onChange={(e) => set('city', e.target.value)} autoComplete="off" maxLength={60} />
          {settings.country === 'IN' ? (
            <Select label={t('state')} value={form.state} onChange={(e) => set('state', e.target.value)} placeholder={t('form.selectState')} options={INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))} />
          ) : (
            <Input label={t('state')} value={form.state} onChange={(e) => set('state', e.target.value)} autoComplete="off" maxLength={60} />
          )}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('form.account')}</legend>
          <MoneyInput label={t('creditLimit')} hint={t('form.creditLimitHint')} value={form.creditLimit} onChange={(v) => set('creditLimit', v)} error={err('creditLimit')} placeholder={t('form.noLimit')} />
          {isNew ? (
            <MoneyInput label={t('openingBalance')} hint={opening && opening < 0 ? t('form.openingAdvance', { amount: formatMoney(-opening) }) : t('form.openingHint')} value={opening} onChange={setOpening} error={err('opening')} placeholder="0" />
          ) : (
            <div className="text-sm text-muted sm:pt-7">{t('form.balanceReadonly')}</div>
          )}
          <Textarea label={t('notes')} value={form.notes} onChange={(e) => set('notes', e.target.value)} wrapperClassName="sm:col-span-2" rows={2} maxLength={500} />
        </fieldset>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
