import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { confirmDialog } from '@/stores/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowRight } from 'lucide-react'
import { CURRENCIES, COUNTRY_PRESETS } from '@/core/presets'
import { roundTo } from '@/core/cart'
import { db } from '@/db/db'
import { currencyDecimals } from '@/lib/money'
import { Select } from '@/components/ui'
import { ChoiceChips, Group, Notice, Row, Stack } from '../ui'
import { useSettingsDraft } from '../hooks'

const LOCALES = [
  'en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN',
  'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en-SG', 'en-ZA', 'en-NG', 'en-KE', 'en-PK', 'en-LK', 'en-PH', 'en-AE',
  'ar-AE', 'ar-SA', 'ar-EG', 'ur-PK', 'fa-IR', 'bn-BD', 'ne-NP',
  'de-DE', 'de-CH', 'fr-FR', 'fr-CA', 'es-ES', 'es-MX', 'it-IT', 'nl-NL', 'pl-PL', 'pt-PT', 'pt-BR', 'ru-RU', 'tr-TR', 'sv-SE',
  'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'id-ID', 'ms-MY', 'th-TH', 'vi-VN', 'sw-KE',
]

/** Explains, with a real example, how existing amounts will look after switching between currencies with different decimals. */
export function decimalsChangeMessage(t: TFunction, from: string, to: string, locale: string): string {
  const sample = 12345
  const show = (currency: string) => {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(sample / 10 ** currencyDecimals(currency))
    } catch {
      return `${sample / 10 ** currencyDecimals(currency)} ${currency}`
    }
  }
  return t('settings:formats.decimalsChange', { from, to, before: show(from), after: show(to) })
}

/** Rounding steps in major units; unusable steps for the currency (e.g. 0.05 JPY) are hidden. */
const ROUNDING_STEPS = [0, 0.05, 0.1, 0.5, 1, 5, 10]

const SAMPLE = 1234567.89

export function FormatsSection() {
  const { t, i18n } = useTranslation('settings')
  const { draft, set } = useSettingsDraft()
  const d = currencyDecimals(draft.currency)
  const hasData = useLiveQuery(async () => (await db.products.count()) + (await db.sales.count()) > 0, [])

  const fmt = useMemo(() => {
    try {
      return new Intl.NumberFormat(draft.numberLocale, { style: 'currency', currency: draft.currency })
    } catch {
      return new Intl.NumberFormat('en', { style: 'currency', currency: draft.currency })
    }
  }, [draft.numberLocale, draft.currency])

  const currencyNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language, 'en'], { type: 'currency' })
    } catch {
      return null
    }
  }, [i18n.language])
  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([i18n.language, 'en'], { type: 'language' })
    } catch {
      return null
    }
  }, [i18n.language])

  const currencyOptions = useMemo(() => {
    const list = Array.from(new Set([...CURRENCIES, draft.currency]))
    return list
      .map((c) => {
        let symbol = c
        try {
          symbol = new Intl.NumberFormat(draft.numberLocale, { style: 'currency', currency: c }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? c
        } catch {
          /* unknown code */
        }
        const name = currencyNames?.of(c) ?? c
        return { value: c, label: `${c} — ${name}${symbol !== c ? ` (${symbol})` : ''}` }
      })
      .sort((a, b) => a.value.localeCompare(b.value))
  }, [currencyNames, draft.currency, draft.numberLocale])

  const localeOptions = useMemo(() => {
    const list = Array.from(new Set([...LOCALES, ...COUNTRY_PRESETS.map((p) => p.locale), draft.numberLocale]))
    return list
      .map((l) => {
        let sample = ''
        try {
          sample = new Intl.NumberFormat(l, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(SAMPLE)
        } catch {
          /* unsupported */
        }
        return { value: l, label: `${languageNames?.of(l) ?? l} — ${sample}`, name: languageNames?.of(l) ?? l }
      })
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
  }, [languageNames, draft.numberLocale, i18n.language])

  const roundingOptions = useMemo(() => {
    const seen = new Set<number>()
    return ROUNDING_STEPS.flatMap((major) => {
      const minor = Math.round(major * 10 ** d)
      if ((major && minor < 1) || Math.abs(minor - major * 10 ** d) > 1e-9 || seen.has(minor)) return []
      seen.add(minor)
      return [{ value: minor, label: minor === 0 ? t('formats.roundingNone') : fmt.format(major) }]
    })
  }, [d, fmt, t])

  const changeCurrency = async (currency: string) => {
    const oldD = currencyDecimals(draft.currency)
    const newD = currencyDecimals(currency)
    // Amounts are stored in minor units, so a different number of decimals changes how big
    // every existing price and sale looks (₹130.00 → ¥13,000). Make that explicit first.
    if (hasData && oldD !== newD) {
      const ok = await confirmDialog({
        title: t('formats.decimalsChangeTitle', { currency }),
        message: decimalsChangeMessage(t, draft.currency, currency, draft.numberLocale),
        confirmLabel: t('formats.decimalsChangeConfirm'),
        danger: true,
      })
      if (!ok) return
    }
    const convert = (minor: number) => Math.round((minor / 10 ** oldD) * 10 ** newD)
    set({ currency, cashRounding: convert(draft.cashRounding), loyaltyPointValue: convert(draft.loyaltyPointValue) })
  }

  const exampleTotal = Math.round(1234.57 * 10 ** d) + (d ? 0 : 3)
  const rounded = roundTo(exampleTotal, draft.cashRounding)

  return (
    <Stack>
      <div className="rounded-2xl border border-border bg-surface-2 p-5 text-center shadow-card">
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{t('formats.preview')}</div>
        <div className="tnum mt-1 text-3xl font-bold tracking-tight break-all sm:text-4xl" dir="auto">{fmt.format(SAMPLE)}</div>
        <div className="tnum mt-1 text-sm text-muted" dir="auto">
          {fmt.format(49.5)} · {fmt.format(-250)} · {fmt.format(0.99)}
        </div>
      </div>

      <Group title={t('formats.money')}>
        <Row id="formats.currency">
          <Select label={t('formats.currency')} value={draft.currency} onChange={(e) => void changeCurrency(e.target.value)} options={currencyOptions} hint={t('formats.currencyHint')} />
        </Row>
        {hasData && (
          <Row>
            <Notice tone="warning">{t('formats.currencyWarning')}</Notice>
          </Row>
        )}
        <Row id="formats.numberLocale">
          <Select label={t('formats.numberLocale')} value={draft.numberLocale} onChange={(e) => set({ numberLocale: e.target.value })} options={localeOptions} hint={t('formats.numberLocaleHint')} />
        </Row>
      </Group>

      <Group title={t('formats.cashRounding')} description={t('formats.cashRoundingHint')}>
        <Row id="formats.cashRounding">
          <ChoiceChips label={t('formats.cashRounding')} value={draft.cashRounding} onChange={(v) => set({ cashRounding: v })} options={roundingOptions} />
          {!roundingOptions.some((o) => o.value === draft.cashRounding) && (
            <p className="mt-2 text-xs text-subtle">{t('formats.roundingCustom', { value: fmt.format(draft.cashRounding / 10 ** d) })}</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <span className="text-muted">{t('formats.roundingExample')}</span>
            <span className="tnum font-medium" dir="auto">{fmt.format(exampleTotal / 10 ** d)}</span>
            <ArrowRight className="size-4 text-subtle rtl:rotate-180" />
            <span className="tnum font-bold text-primary" dir="auto">{fmt.format(rounded / 10 ** d)}</span>
          </div>
        </Row>
      </Group>
    </Stack>
  )
}
