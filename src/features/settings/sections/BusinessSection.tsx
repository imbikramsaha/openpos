import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ImagePlus, Trash2 } from 'lucide-react'
import type { Settings, Tax } from '@/core/types'
import { COUNTRY_PRESETS, INDIAN_STATES, findPreset, type CountryPreset } from '@/core/presets'
import { db } from '@/db/db'
import { SETTINGS_ID } from '@/db/defaults'
import { audit, patch, put, putMany, tx } from '@/db/repo'
import { currencyDecimals } from '@/lib/money'
import { pickFile, readFileDataUrl } from '@/lib/download'
import { uuid } from '@/lib/uuid'
import { toast } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { Button, EmailInput, Input, Modal, PhoneInput, Select, TaxIdInput, Textarea } from '@/components/ui'
import { LIMITS } from '@/lib/validate'
import { Group, Row, Stack } from '../ui'
import { TYPING_DELAY, notifySaved, useSettingsDraft } from '../hooks'
import { decimalsChangeMessage } from './FormatsSection'


function displayName(type: 'currency' | 'language', code: string, lng: string): string {
  try {
    return new Intl.DisplayNames([lng, 'en'], { type }).of(code) ?? code
  } catch {
    return code
  }
}

/** Country name in the UI language (falls back to the preset's English name). */
function countryName(p: CountryPreset, lng: string): string {
  try {
    return new Intl.DisplayNames([lng, 'en'], { type: 'region' }).of(p.code) ?? p.name
  } catch {
    return p.name
  }
}

export function BusinessSection() {
  const { t, i18n } = useTranslation('settings')
  const { draft, set, setReceipt, flush } = useSettingsDraft()
  const [country, setCountry] = useState<CountryPreset | null>(null)
  const text = (key: keyof Settings) => ({
    value: (draft[key] as string | undefined) ?? '',
    onChange: (e: { target: { value: string } }) => set({ [key]: e.target.value } as Partial<Settings>, TYPING_DELAY),
    onBlur: () => void flush(),
  })

  const uploadLogo = async () => {
    const file = await pickFile('image/*')
    if (!file) return
    try {
      setReceipt({ logo: await readFileDataUrl(file, 320) })
    } catch {
      toast(t('business.logoError'), 'error')
    }
  }

  return (
    <Stack>
      <Group title={t('business.identity')} description={t('business.identityHint')}>
        <Row id="business.name">
          <BusinessName value={draft.businessName} onChange={(v) => set({ businessName: v }, TYPING_DELAY)} onBlur={() => void flush()} />
        </Row>
        <Row id="business.legalName">
          <Input label={t('business.legalName')} hint={t('business.legalNameHint')} {...text('legalName')} maxLength={120} />
        </Row>
        <Row id="business.logo">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border-strong bg-white">
              {draft.receipt.logo ? <img src={draft.receipt.logo} alt={t('business.logo')} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-7 text-subtle" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{t('business.logo')}</div>
              <div className="mb-2 text-xs text-subtle">{t('business.logoHint')}</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<ImagePlus className="size-4" />} onClick={() => void uploadLogo()}>
                  {draft.receipt.logo ? t('business.logoChange') : t('business.logoUpload')}
                </Button>
                {draft.receipt.logo && (
                  <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={() => setReceipt({ logo: undefined })}>
                    {t('common:remove')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Row>
      </Group>

      <Group title={t('business.contact')}>
        <Row id="business.address">
          <Textarea label={t('business.address')} rows={2} {...text('address')} maxLength={LIMITS.address} />
        </Row>
        <Row>
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-setting="business.phone">
              <PhoneInput label={t('business.phone')} value={draft.phone} onChange={(v) => set({ phone: v }, TYPING_DELAY)} onBlur={() => void flush()} />
            </div>
            <div data-setting="business.email">
              <EmailInput label={t('business.email')} value={draft.email} onChange={(v) => set({ email: v }, TYPING_DELAY)} onBlur={() => void flush()} />
            </div>
          </div>
        </Row>
        <Row id="business.website">
          <Input label={t('business.website')} type="url" dir="ltr" placeholder="https://" {...text('website')} />
        </Row>
      </Group>

      <Group title={t('business.region')} description={t('business.regionHint')}>
        <Row id="business.country">
          <Select
            label={t('business.country')}
            value={draft.country}
            onChange={(e) => {
              const p = findPreset(e.target.value)
              if (p.code !== draft.country) setCountry(p)
            }}
            options={COUNTRY_PRESETS.map((p) => ({ value: p.code, label: p.code === 'OTHER' ? t('business.otherCountry') : `${countryName(p, i18n.language)} · ${p.currency}` }))
              .sort((a, b) => (a.value === 'OTHER' ? 1 : b.value === 'OTHER' ? -1 : a.label.localeCompare(b.label, i18n.language)))}
            hint={t('business.countryHint')}
          />
        </Row>
        {draft.country === 'IN' && (
          <Row id="business.state">
            <Select
              label={t('business.state')}
              hint={t('business.stateHint')}
              value={draft.state ?? ''}
              onChange={(e) => set({ state: e.target.value || undefined })}
              placeholder={t('business.selectState')}
              options={INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))}
            />
          </Row>
        )}
        <Row>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div data-setting="business.taxLabel">
              <Input label={t('business.taxLabel')} hint={t('business.taxLabelHint')} {...text('taxLabel')} maxLength={30} />
            </div>
            <div data-setting="business.taxNumber">
              <TaxIdInput
                label={t('business.taxNumber', { label: draft.taxLabel || t('business.taxLabel') })}
                value={draft.taxNumber}
                country={draft.country}
                onChange={(v) => set({ taxNumber: v }, TYPING_DELAY)}
                onBlur={() => void flush()}
              />
            </div>
          </div>
        </Row>
      </Group>

      <CountryDialog
        preset={country}
        onClose={() => setCountry(null)}
        onOnlyCountry={async (p) => {
          set({ country: p.code, state: p.code === 'IN' ? draft.state : undefined })
          setCountry(null)
        }}
        onApply={async (p) => {
          await flush()
          await applyCountryPreset(p)
          setCountry(null)
          notifySaved()
        }}
      />
    </Stack>
  )
}

/** The business name is required: an empty field shows an error and is never saved. */
function BusinessName({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const { t } = useTranslation('settings')
  const [text, setText] = useState(value)
  useEffect(() => setText((cur) => (cur.trim() ? value : cur)), [value])
  return (
    <Input
      label={t('business.name')}
      value={text}
      maxLength={LIMITS.businessName}
      error={!text.trim() ? t('business.nameRequired') : undefined}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value.trim()) onChange(e.target.value)
      }}
      onBlur={onBlur}
    />
  )
}

function CountryDialog({ preset, onClose, onApply, onOnlyCountry }: {
  preset: CountryPreset | null
  onClose: () => void
  onApply: (p: CountryPreset) => Promise<void>
  onOnlyCountry: (p: CountryPreset) => Promise<void>
}) {
  const { t, i18n } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const current = useSettings((s) => s.settings)
  if (!preset) return null
  const d = currencyDecimals(preset.currency)
  const rounding = preset.cashRounding ? new Intl.NumberFormat(preset.locale, { style: 'currency', currency: preset.currency }).format(preset.cashRounding / 10 ** d) : t('formats.roundingNone')
  const rows: Array<[string, string]> = [
    [t('business.presetCurrency'), `${displayName('currency', preset.currency, i18n.language)} (${preset.currency}) · ${displayName('language', preset.locale, i18n.language)}`],
    [t('business.presetTaxes'), preset.taxes.map((x) => x.name).join(', ')],
    [t('business.presetPrices'), preset.pricesIncludeTax ? t('taxes.inclusive') : t('taxes.exclusive')],
    [t('business.presetRounding'), rounding],
    [t('business.presetPayments'), preset.payments.map((m) => t(`common:payment.${m}`)).join(', ')],
  ]
  const currencyChanges = preset.currency !== current.currency
  return (
    <Modal
      open
      onClose={onClose}
      title={t('business.presetTitle', { country: preset.code === 'OTHER' ? t('business.otherCountry') : countryName(preset, i18n.language) })}
      subtitle={t('business.presetSubtitle')}
      footer={
        <>
          <Button onClick={() => void onOnlyCountry(preset)} disabled={busy}>
            {t('business.presetKeep')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            icon={<Check className="size-4" />}
            onClick={async () => {
              setBusy(true)
              try {
                await onApply(preset)
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('business.presetApply')}
          </Button>
        </>
      }
    >
      <dl className="divide-y divide-border rounded-xl border border-border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-sm text-muted sm:w-36">{k}</dt>
            <dd className="min-w-0 text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-subtle">{t('business.presetNote')}</p>
      {currencyChanges && (
        <p className="mt-2 text-xs font-medium text-warning">
          {currencyDecimals(current.currency) !== d ? decimalsChangeMessage(t, current.currency, preset.currency, preset.locale) : t('formats.currencyWarning')}
        </p>
      )}
    </Modal>
  )
}

/** Applies a country's currency, formats, tax rates, rounding and payment methods. Existing tax rates are kept. */
export async function applyCountryPreset(p: CountryPreset): Promise<void> {
  const now = Date.now()
  const current = await db.settings.get(SETTINGS_ID)
  if (!current) return
  const existing = (await db.taxes.toArray()).filter((x) => !x.deleted)
  const created: Tax[] = []
  let defaultTaxId = current.defaultTaxId
  for (const pt of p.taxes) {
    let match = existing.find((x) => x.rate === pt.rate && x.name.trim().toLowerCase() === pt.name.toLowerCase())
    if (!match) {
      match = { id: uuid(), createdAt: now, updatedAt: now, name: pt.name, rate: pt.rate }
      created.push(match)
    }
    if (pt.isDefault) defaultTaxId = match.id
  }
  const oldD = currencyDecimals(current.currency)
  const newD = currencyDecimals(p.currency)
  const convert = (minor: number) => Math.round((minor / 10 ** oldD) * 10 ** newD)
  await tx(['taxes', 'settings'], async () => {
    if (created.length) await putMany('taxes', created)
    for (const x of [...existing, ...created]) {
      const shouldDefault = x.id === defaultTaxId
      if (!!x.isDefault !== shouldDefault) await patch<Tax>('taxes', x.id, { isDefault: shouldDefault })
    }
    await put<Settings>('settings', {
      ...current,
      id: SETTINGS_ID,
      country: p.code,
      state: p.code === 'IN' ? current.state : undefined,
      currency: p.currency,
      numberLocale: p.locale,
      taxLabel: p.taxLabel,
      pricesIncludeTax: p.pricesIncludeTax,
      gstMode: !!p.gstMode,
      cashRounding: p.cashRounding,
      // Loyalty redemption is a store choice, not a country default: keep it if it was on.
      enabledPayments: current.enabledPayments.includes('loyalty') && !p.payments.includes('loyalty') ? [...p.payments, 'loyalty'] : p.payments,
      quickCash: p.notes,
      defaultTaxId,
      loyaltyPointValue: current.currency === p.currency ? current.loyaltyPointValue : convert(current.loyaltyPointValue),
    })
  })
  void audit('settings.country', 'settings', SETTINGS_ID, `${current.country} → ${p.code}`)
}
