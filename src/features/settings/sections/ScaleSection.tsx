import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, ScanBarcode, XCircle } from 'lucide-react'
import type { ScaleBarcodeSettings } from '@/core/types'
import { ean13CheckDigit, parseScaleBarcode } from '@/core/barcode'
import { db } from '@/db/db'
import { formatMoney, formatQty, toMinor } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button, Input, Segmented, Select } from '@/components/ui'
import { ControlRow, Group, Notice, Row, Stack, ToggleRow } from '../ui'
import { TYPING_DELAY, useSettingsDraft } from '../hooks'

/** Digits used before the item code: the prefix, padded to two by convention. */
const lead = (s: ScaleBarcodeSettings) => Math.max((s.prefixes.split(/[\s,]+/).find(Boolean) ?? '').length, 2)

function exampleCode(s: ScaleBarcodeSettings): string {
  const prefix = (s.prefixes.split(/[\s,]+/).find(Boolean) ?? '2').padEnd(2, '0')
  const item = '123456789'.slice(0, s.itemDigits).padStart(s.itemDigits, '0')
  const value = (s.valueType === 'weight' ? '01250' : '04500').padStart(s.valueDigits, '0').slice(-s.valueDigits)
  const body = (prefix + item + value).padEnd(12, '0').slice(0, 12)
  return body + ean13CheckDigit(body)
}

export function ScaleSection() {
  const { t } = useTranslation('settings')
  const { draft, setScale, flush } = useSettingsDraft()
  const s = draft.scale
  const [code, setCode] = useState('')
  const start = lead(s)
  const overflow = start + s.itemDigits + s.valueDigits + 1 > 13
  const example = useMemo(() => exampleCode(s), [s])

  const digits = useMemo(() => {
    const out: Array<'prefix' | 'item' | 'value' | 'unused' | 'check'> = []
    for (let i = 0; i < 13; i++) {
      if (i === 12) out.push('check')
      else if (i < start) out.push('prefix')
      else if (i < start + s.itemDigits) out.push('item')
      else if (i < start + s.itemDigits + s.valueDigits) out.push('value')
      else out.push('unused')
    }
    return out
  }, [start, s.itemDigits, s.valueDigits])

  return (
    <Stack>
      <Notice>{t('scale.intro')}</Notice>

      <Group>
        <ToggleRow id="scale.enabled" label={t('scale.enabled')} description={t('scale.enabledHint')} checked={s.enabled} onChange={(v) => setScale({ enabled: v })} />
      </Group>

      <Group title={t('scale.layout')} description={t('scale.layoutHint')}>
        <Row>
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max gap-1" dir="ltr" aria-hidden>
              {digits.map((kind, i) => (
                <span
                  key={i}
                  className={cn(
                    'tnum flex h-11 w-8 items-center justify-center rounded-lg font-mono text-sm font-bold',
                    kind === 'prefix' && 'bg-surface-3 text-fg',
                    kind === 'item' && 'bg-primary-soft text-primary',
                    kind === 'value' && 'bg-success-soft text-success',
                    kind === 'unused' && 'border border-dashed border-border-strong text-subtle',
                    kind === 'check' && 'bg-warning-soft text-warning',
                    overflow && i >= 12 && 'ring-2 ring-danger',
                  )}
                >
                  {example[i]}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <Legend cls="bg-surface-3" label={t('scale.legendPrefix')} />
            <Legend cls="bg-primary-soft" label={t('scale.legendItem')} />
            <Legend cls="bg-success-soft" label={s.valueType === 'weight' ? t('scale.legendWeight') : t('scale.legendPrice')} />
            <Legend cls="bg-warning-soft" label={t('scale.legendCheck')} />
          </div>
          {overflow && <p className="mt-2 text-xs font-medium text-danger">{t('scale.tooLong')}</p>}
        </Row>
        <Row id="scale.prefixes">
          <Input
            label={t('scale.prefixes')}
            hint={t('scale.prefixesHint')}
            value={s.prefixes}
            inputMode="numeric"
            onChange={(e) => setScale({ prefixes: e.target.value.replace(/[^\d,\s]/g, '') }, TYPING_DELAY)}
            onBlur={() => void flush()}
            error={!s.prefixes.split(/[\s,]+/).some(Boolean) ? t('scale.prefixesRequired') : undefined}
          />
        </Row>
        <Row>
          <div className="grid gap-4 sm:grid-cols-2">
            <div data-setting="scale.itemDigits">
              <Select
                label={t('scale.itemDigits')}
                value={String(s.itemDigits)}
                onChange={(e) => setScale({ itemDigits: Number(e.target.value) })}
                options={[3, 4, 5, 6].map((n) => ({ value: String(n), label: t('scale.digits', { count: n }) }))}
              />
            </div>
            <div data-setting="scale.valueDigits">
              <Select
                label={t('scale.valueDigits')}
                value={String(s.valueDigits)}
                onChange={(e) => setScale({ valueDigits: Number(e.target.value) })}
                options={[4, 5, 6].map((n) => ({ value: String(n), label: t('scale.digits', { count: n }) }))}
              />
            </div>
          </div>
        </Row>
        <ControlRow id="scale.valueType" label={t('scale.valueType')} description={s.valueType === 'weight' ? t('scale.weightHint') : t('scale.priceHint')}>
          <Segmented
            value={s.valueType}
            onChange={(valueType) => setScale({ valueType, valueDivisor: valueType === 'weight' ? 1000 : 100 })}
            options={[
              { value: 'weight', label: t('scale.weight') },
              { value: 'price', label: t('scale.price') },
            ]}
          />
        </ControlRow>
        <ControlRow id="scale.divisor" label={t('scale.divisor')} description={t('scale.divisorHint', { raw: '01250', value: formatQty(1250 / (s.valueDivisor || 1)) })}>
          <Select
            aria-label={t('scale.divisor')}
            value={String(s.valueDivisor)}
            onChange={(e) => setScale({ valueDivisor: Number(e.target.value) })}
            options={[1, 10, 100, 1000, 10000].map((n) => ({ value: String(n), label: `÷ ${n}` }))}
            className="sm:w-36"
          />
        </ControlRow>
      </Group>

      <Group title={t('scale.test')} description={t('scale.testHint')}>
        <Row id="scale.test">
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 13))}
              inputMode="numeric"
              placeholder={example}
              aria-label={t('scale.test')}
              left={<ScanBarcode className="size-4.5" />}
              wrapperClassName="min-w-0 flex-1"
              className="tnum font-mono"
            />
            <Button onClick={() => setCode(example)}>{t('scale.useExample')}</Button>
          </div>
          {code && <TestResult code={code} settings={s} />}
        </Row>
      </Group>
    </Stack>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-3 rounded', cls)} />
      {label}
    </span>
  )
}

function TestResult({ code, settings }: { code: string; settings: ScaleBarcodeSettings }) {
  const { t } = useTranslation('settings')
  const result = parseScaleBarcode(code, { ...settings, enabled: true })
  const product = useLiveQuery(async () => {
    if (!result) return null
    const stripped = result.itemCode.replace(/^0+/, '')
    return (await db.products.filter((p) => !p.deleted && [p.sku, p.barcode].some((c) => !!c && (c === result.itemCode || c.replace(/^0+/, '') === stripped))).first()) ?? null
  }, [result?.itemCode])

  if (!result) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm">
        <XCircle className="mt-0.5 size-4.5 shrink-0 text-danger" />
        <span>{code.length < 12 ? t('scale.tooShort') : t('scale.noMatch')}</span>
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-xl bg-success-soft px-4 py-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <CheckCircle2 className="size-4.5 text-success" /> {t('scale.recognised')}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">{t('scale.itemCode')}</dt>
        <dd className="tnum font-mono font-semibold">{result.itemCode}</dd>
        <dt className="text-muted">{settings.valueType === 'weight' ? t('scale.weight') : t('scale.price')}</dt>
        <dd className="tnum font-semibold">{settings.valueType === 'weight' ? `${formatQty(result.value)} ${t('common:unit.kg')}` : formatMoney(toMinor(result.value))}</dd>
        <dt className="text-muted">{t('scale.product')}</dt>
        <dd className={cn('font-semibold', !product && 'text-warning')}>{product === undefined ? '…' : product ? product.name : t('scale.noProduct')}</dd>
      </dl>
    </div>
  )
}
