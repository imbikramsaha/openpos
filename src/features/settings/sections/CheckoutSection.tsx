import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Banknote, BookUser, CreditCard, Gift, Landmark, Plus, Printer, RotateCcw, Smartphone, Ticket, Wallet, X } from 'lucide-react'
import type { PaymentMethod, Settings } from '@/core/types'
import { findPreset } from '@/core/presets'
import { currencyDecimals, formatMoney, fromMinor, formatNumber, parseDecimal, toMinor } from '@/lib/money'
import { escapeHtml, printHtml } from '@/lib/print'
import { cn } from '@/lib/cn'
import { Button, Input, MoneyInput, NumberInput, Select, Toggle } from '@/components/ui'
import { ControlRow, Group, Notice, Row, Stack, ToggleRow } from '../ui'
import { TYPING_DELAY, useSettingsDraft } from '../hooks'

const METHODS: PaymentMethod[] = ['cash', 'card', 'upi', 'credit', 'bank', 'voucher', 'loyalty', 'other']

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  upi: Smartphone,
  credit: BookUser,
  voucher: Ticket,
  loyalty: Gift,
  bank: Landmark,
  other: Wallet,
}

const AUTO_LOCK = [0, 1, 2, 5, 10, 15, 30, 60]

/** Largest banknote accepted for quick-cash buttons (major units). */
const MAX_NOTE = 1e9
/** Sanity limits for loyalty settings: points per major unit, and a point's value in minor units. */
const MAX_EARN_RATE = 1000
const MAX_POINT_VALUE = 1e9

export const UPI_ID = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/

export function CheckoutSection() {
  const { t } = useTranslation('settings')
  const { draft, set, flush } = useSettingsDraft()

  return (
    <Stack>
      <Group title={t('checkout.rules')}>
        <ToggleRow id="checkout.allowNegativeStock" label={t('checkout.allowNegativeStock')} description={t('checkout.allowNegativeStockHint')} checked={draft.allowNegativeStock} onChange={(v) => set({ allowNegativeStock: v })} />
        <ToggleRow id="checkout.requireShift" label={t('checkout.requireShift')} description={t('checkout.requireShiftHint')} checked={draft.requireShift} onChange={(v) => set({ requireShift: v })} />
        <ToggleRow id="checkout.orderTypes" label={t('checkout.orderTypes')} description={t('checkout.orderTypesHint')} checked={draft.orderTypes} onChange={(v) => set({ orderTypes: v })} />
      </Group>

      <Group title={t('checkout.security')}>
        <ToggleRow id="checkout.lockAfterSale" label={t('checkout.lockAfterSale')} description={t('checkout.lockAfterSaleHint')} checked={draft.lockAfterSale} onChange={(v) => set({ lockAfterSale: v })} />
        <ControlRow id="checkout.autoLock" label={t('checkout.autoLock')} description={t('checkout.autoLockHint')}>
          <Select
            aria-label={t('checkout.autoLock')}
            value={String(draft.autoLockMinutes)}
            onChange={(e) => set({ autoLockMinutes: Number(e.target.value) })}
            options={Array.from(new Set([...AUTO_LOCK, draft.autoLockMinutes])).sort((a, b) => a - b).map((m) => ({ value: String(m), label: m ? t('checkout.minutes', { count: m }) : t('checkout.never') }))}
            className="sm:w-48"
          />
        </ControlRow>
      </Group>

      <PaymentMethods value={draft.enabledPayments} onChange={(enabledPayments) => set({ enabledPayments })} />

      <QuickCash draft={draft} onChange={(quickCash) => set({ quickCash })} />

      <Upi draft={draft} set={set} flush={flush} />

      <Group title={t('checkout.loyaltyTitle')} description={t('checkout.loyaltyTitleHint')}>
        <ToggleRow id="checkout.loyalty" label={t('checkout.loyalty')} description={t('checkout.loyaltyHint')} checked={draft.loyaltyEnabled} onChange={(v) => set({ loyaltyEnabled: v })} />
        {draft.loyaltyEnabled && <LoyaltyRates draft={draft} set={set} flush={flush} />}
      </Group>
    </Stack>
  )
}

function PaymentMethods({ value, onChange }: { value: PaymentMethod[]; onChange: (v: PaymentMethod[]) => void }) {
  const { t } = useTranslation('settings')
  const enabled = value.filter((m) => METHODS.includes(m))
  const disabled = METHODS.filter((m) => !enabled.includes(m))
  const move = (i: number, dir: -1 | 1) => {
    const next = [...enabled]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    onChange(next)
  }
  const row = (m: PaymentMethod, i: number, on: boolean) => {
    const Icon = METHOD_ICONS[m]
    return (
      <li key={m} className={cn('flex min-h-16 items-center gap-3 px-4 py-2.5 sm:px-5', !on && 'bg-surface-2')}>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-primary-soft text-primary' : 'bg-surface-3 text-subtle')}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-sm font-medium', !on && 'text-muted')}>{t(`common:payment.${m}`)}</div>
          <div className="truncate text-xs text-subtle">{t(`checkout.method.${m}`)}</div>
        </div>
        {on && (
          <div className="flex shrink-0 items-center">
            <Button size="icon-sm" variant="ghost" aria-label={t('checkout.moveUp')} title={t('checkout.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={t('checkout.moveDown')} title={t('checkout.moveDown')} disabled={i === enabled.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </Button>
          </div>
        )}
        <Toggle
          checked={on}
          aria-label={t(`common:payment.${m}`)}
          disabled={on && enabled.length === 1}
          onChange={(v) => onChange(v ? [...enabled, m] : enabled.filter((x) => x !== m))}
        />
      </li>
    )
  }
  return (
    <Group title={t('checkout.payments')} description={t('checkout.paymentsHint')}>
      <ul data-setting="checkout.payments" className="divide-y divide-border">
        {enabled.map((m, i) => row(m, i, true))}
        {disabled.map((m, i) => row(m, i, false))}
      </ul>
    </Group>
  )
}

function QuickCash({ draft, onChange }: { draft: Settings; onChange: (v: number[]) => void }) {
  const { t } = useTranslation('settings')
  const [text, setText] = useState('')
  const d = currencyDecimals(draft.currency)
  const notes = [...draft.quickCash].sort((a, b) => a - b)
  const parsed = Math.round(parseDecimal(text) * 10 ** d) / 10 ** d
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_NOTE && !notes.includes(parsed) && notes.length < 10
  const add = () => {
    if (!valid) return
    onChange([...notes, parsed].sort((a, b) => a - b))
    setText('')
  }
  const defaults = findPreset(draft.country).notes
  const isDefault = defaults.length === notes.length && defaults.every((n, i) => n === notes[i])
  return (
    <Group
      title={t('checkout.quickCash')}
      description={t('checkout.quickCashHint')}
      actions={
        !isDefault && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => onChange(defaults)}>
            {t('checkout.quickCashReset')}
          </Button>
        )
      }
    >
      <Row id="checkout.quickCash">
        <div className="flex flex-wrap gap-2">
          {notes.map((n) => (
            <span key={n} className="tnum inline-flex h-10 items-center gap-1 rounded-xl border border-border bg-surface-2 ps-3.5 pe-1 text-sm font-semibold">
              {formatMoney(toMinor(n, d))}
              <button
                type="button"
                onClick={() => onChange(notes.filter((x) => x !== n))}
                aria-label={t('checkout.removeNote', { value: formatMoney(toMinor(n, d)) })}
                className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-surface-3 hover:text-danger"
              >
                <X className="size-4" />
              </button>
            </span>
          ))}
          {!notes.length && <span className="text-sm text-subtle">{t('checkout.quickCashEmpty')}</span>}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), add())}>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="decimal"
            placeholder={t('checkout.addNotePlaceholder')}
            aria-label={t('checkout.addNotePlaceholder')}
            wrapperClassName="w-52"
            className="tnum"
          />
          <Button type="submit" icon={<Plus className="size-4" />} disabled={!valid}>
            {t('common:add')}
          </Button>
        </form>
      </Row>
    </Group>
  )
}

type SetFn = (changes: Partial<Settings>, delay?: number) => void

function Upi({ draft, set, flush }: { draft: Settings; set: SetFn; flush: () => Promise<void> }) {
  const { t } = useTranslation('settings')
  const [id, setId] = useState(draft.upiId ?? '')
  const [qr, setQr] = useState('')
  useEffect(() => setId(draft.upiId ?? ''), [draft.upiId])
  const valid = !id || UPI_ID.test(id.trim())
  const payee = draft.upiName || draft.businessName
  const link = draft.upiId ? `upi://pay?pa=${encodeURIComponent(draft.upiId)}&pn=${encodeURIComponent(payee)}&cu=${draft.currency}` : ''

  useEffect(() => {
    let alive = true
    if (!link) return setQr('')
    void import('qrcode').then(({ toDataURL }) => toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: 'M' })).then((url) => alive && setQr(url))
    return () => {
      alive = false
    }
  }, [link])

  const printQr = () => {
    const html = `<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>UPI</title><style>
      body{font:16px/1.4 system-ui,sans-serif;text-align:center;padding:24px;color:#000}
      h1{font-size:24px;margin:0 0 4px} img{width:280px;height:280px;margin:16px auto;display:block} .m{color:#444;font-size:14px}
    </style></head><body><h1>${escapeHtml(draft.businessName)}</h1><div class="m">${escapeHtml(t('checkout.upiScan'))}</div>
    <img src="${qr}" alt=""><div><b>${escapeHtml(payee)}</b></div><div class="m">${escapeHtml(draft.upiId)}</div></body></html>`
    void printHtml(html)
  }

  return (
    <Group title={t('checkout.upiTitle')} description={t('checkout.upiTitleHint')}>
      {!draft.enabledPayments.includes('upi') && (
        <Row>
          <Notice>{t('checkout.upiDisabled')}</Notice>
        </Row>
      )}
      <Row>
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <div data-setting="checkout.upiId">
              <Input
                label={t('checkout.upiId')}
                placeholder="shopname@okbank"
                dir="ltr"
                value={id}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  setId(v)
                  if (!v || UPI_ID.test(v)) set({ upiId: v || undefined }, TYPING_DELAY)
                }}
                onBlur={() => void flush()}
                error={!valid ? t('checkout.upiInvalid') : undefined}
                hint={t('checkout.upiIdHint')}
              />
            </div>
            <div data-setting="checkout.upiName">
              <Input
                label={t('checkout.upiName')}
                placeholder={draft.businessName}
                value={draft.upiName ?? ''}
                onChange={(e) => set({ upiName: e.target.value || undefined }, TYPING_DELAY)}
                onBlur={() => void flush()}
                hint={t('checkout.upiNameHint')}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 sm:w-48">
            <div className="flex size-44 items-center justify-center rounded-2xl border border-border bg-white p-2">
              {qr ? <img src={qr} alt={t('checkout.upiQr')} className="size-full" /> : <span className="px-4 text-center text-xs text-neutral-500">{t('checkout.upiQrEmpty')}</span>}
            </div>
            {qr && (
              <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={printQr}>
                {t('checkout.upiPrint')}
              </Button>
            )}
          </div>
        </div>
      </Row>
    </Group>
  )
}

function LoyaltyRates({ draft, set, flush }: { draft: Settings; set: SetFn; flush: () => Promise<void> }) {
  const { t } = useTranslation('settings')
  const d = currencyDecimals(draft.currency)
  // Invalid entries (blank, negative, absurdly large) are shown as errors and never saved.
  const [earnError, setEarnError] = useState(false)
  const [valueError, setValueError] = useState(false)
  const generous = fromMinor(draft.loyaltyPointValue, d) * draft.loyaltyEarnRate >= 1
  // A round amount that earns at least one point, for the example sentence.
  const spend = useMemo(() => (draft.loyaltyEarnRate > 0 ? 10 ** Math.max(0, Math.ceil(Math.log10(1 / draft.loyaltyEarnRate) - 1e-9)) : 0), [draft.loyaltyEarnRate])
  const points = Math.floor(spend * (draft.loyaltyEarnRate || 0) + 1e-9)
  return (
    <>
      <Row>
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-setting="checkout.loyaltyEarnRate">
            <NumberInput
              label={t('checkout.loyaltyEarnRate')}
              hint={t('checkout.loyaltyEarnRateHint')}
              value={draft.loyaltyEarnRate}
              onChange={(v) => {
                const ok = v !== undefined && v >= 0 && v <= MAX_EARN_RATE
                setEarnError(!ok)
                if (ok) set({ loyaltyEarnRate: v }, TYPING_DELAY)
              }}
              onBlur={() => void flush()}
              error={earnError ? t('checkout.loyaltyEarnRateRange', { max: formatNumber(MAX_EARN_RATE) }) : undefined}
            />
          </div>
          <div data-setting="checkout.loyaltyPointValue">
            <MoneyInput
              label={t('checkout.loyaltyPointValue')}
              hint={t('checkout.loyaltyPointValueHint')}
              value={draft.loyaltyPointValue}
              onChange={(v) => {
                const ok = v !== undefined && v >= 0 && v <= MAX_POINT_VALUE
                setValueError(!ok)
                if (ok) set({ loyaltyPointValue: v }, TYPING_DELAY)
              }}
              onBlur={() => {
                // MoneyInput shows the saved value again on blur, so the error no longer applies.
                setValueError(false)
                void flush()
              }}
              error={valueError ? t('checkout.loyaltyPointValueRange') : undefined}
            />
          </div>
        </div>
      </Row>
      {spend > 0 && (
        <Row>
          <div className="rounded-xl bg-success-soft px-4 py-3 text-sm">
            {t('checkout.loyaltyExample', {
              spend: formatMoney(Math.round(spend * 10 ** d)),
              points: formatNumber(points),
              value: formatMoney(points * draft.loyaltyPointValue),
            })}
            {draft.loyaltyPointValue > 0 && draft.loyaltyEarnRate > 0 && (
              <span className="text-muted"> {t('checkout.loyaltyReturn', { percent: formatNumber(fromMinor(draft.loyaltyPointValue, d) * draft.loyaltyEarnRate * 100, 2) })}</span>
            )}
          </div>
        </Row>
      )}
      {generous && (
        <Row>
          <Notice tone="warning">{t('checkout.loyaltyTooGenerous')}</Notice>
        </Row>
      )}
    </>
  )
}
