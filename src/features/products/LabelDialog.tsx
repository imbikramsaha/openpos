import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Barcode, Minus, Plus, Printer } from 'lucide-react'
import type { Product } from '@/core/types'
import { db } from '@/db/db'
import { audit } from '@/db/repo'
import { formatNumber, formatQty } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, Checkbox, Modal, NumberInput, Select } from '@/components/ui'
import { assignMissingBarcodes } from './service'
import { DEFAULT_LABEL_OPTIONS, LABEL_PRESETS, labelCount, labelsHtml, MAX_LABELS, presetById, type LabelOptions } from './labels'

const PREFS_KEY = 'kasa.labelOptions'
const MAX_LISTED = 200

function loadPrefs(): LabelOptions {
  try {
    return { ...DEFAULT_LABEL_OPTIONS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'), skip: 0 }
  } catch {
    return DEFAULT_LABEL_OPTIONS
  }
}

/** Barcode label printing for one or many products. Label preferences are remembered per terminal. */
export function LabelDialog({ productIds, onClose }: { productIds: string[] | null; onClose: () => void }) {
  const { t } = useTranslation('products')
  const settings = useSettings((s) => s.settings)
  const [opts, setOpts] = useState<LabelOptions>(loadPrefs)
  const [copies, setCopies] = useState<Record<string, number>>({})
  const [allCopies, setAllCopies] = useState<number | undefined>(1)
  const [busy, setBusy] = useState(false)
  const open = !!productIds

  const products = useLiveQuery(
    async () => (productIds ? (await db.products.bulkGet(productIds)).filter((p): p is Product => !!p && !p.deleted) : []),
    [productIds],
  )

  useEffect(() => {
    if (open) {
      setCopies({})
      setAllCopies(1)
      setOpts(loadPrefs())
    }
  }, [open])

  const set = (changes: Partial<LabelOptions>) =>
    setOpts((o) => {
      const next = { ...o, ...changes }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ ...next, skip: 0 }))
      } catch {
        /* storage unavailable */
      }
      return next
    })

  const items = useMemo(() => (products ?? []).map((p) => ({ product: p, copies: copies[p.id] ?? 1 })), [products, copies])
  const total = labelCount(items)
  const tooMany = total > MAX_LABELS
  const missing = (products ?? []).filter((p) => !p.barcode)
  const preset = presetById(opts.preset)
  const preview = useMemo(() => (open && items.length ? labelsHtml(items, opts, settings, { maxLabels: preset.cols ? preset.cols * preset.rows! : 12 }) : ''), [open, items, opts, settings, preset])

  const generate = async () => {
    setBusy(true)
    try {
      const n = await assignMissingBarcodes(missing.map((p) => p.id))
      toast(t('labels.generated', { count: n }))
    } finally {
      setBusy(false)
    }
  }

  const print = async () => {
    if (!total || tooMany) return
    await printHtml(labelsHtml(items, opts, settings), preset.cols ? undefined : preset.w)
    void audit('labels.print', 'product', undefined, `${total} labels`)
  }

  const setCopy = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(999, Math.round(n))) }))
  const applyAll = (n: number) => setCopies(Object.fromEntries((products ?? []).map((p) => [p.id, Math.max(0, Math.min(999, Math.round(n)))])))
  const fromStock = () => setCopies(Object.fromEntries((products ?? []).map((p) => [p.id, p.trackStock ? Math.max(0, Math.min(999, Math.ceil(p.stock))) : 1])))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('labels.title')}
      subtitle={t('labels.subtitle', { count: products?.length ?? 0 })}
      size="xl"
      flush
      footer={
        <>
          <span className={tooMany ? 'me-auto text-sm font-medium text-danger' : 'me-auto text-sm text-muted'}>
            {tooMany ? t('labels.tooMany', { max: formatNumber(MAX_LABELS) }) : t('labels.total', { count: total })}
          </span>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" icon={<Printer className="size-4" />} onClick={print} disabled={!total || tooMany}>
            {t('common:print')}
          </Button>
        </>
      }
    >
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={t('labels.preset')}
              value={opts.preset}
              onChange={(e) => set({ preset: e.target.value as LabelOptions['preset'] })}
              options={LABEL_PRESETS.map((p) => ({ value: p.id, label: t(`labels.presets.${p.id}`) }))}
            />
            {preset.cols && (
              <NumberInput
                label={t('labels.skip')}
                hint={t('labels.skipHint')}
                value={opts.skip}
                onChange={(v) => set({ skip: Math.max(0, Math.floor(v ?? 0)) })}
                inputMode="numeric"
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Checkbox checked={opts.showName} onChange={(v) => set({ showName: v })} label={t('labels.showName')} />
            <Checkbox checked={opts.showPrice} onChange={(v) => set({ showPrice: v })} label={t('labels.showPrice')} />
            <Checkbox checked={opts.showMrp} onChange={(v) => set({ showMrp: v })} label={t('labels.showMrp')} />
            <Checkbox checked={opts.showBusiness} onChange={(v) => set({ showBusiness: v })} label={t('labels.showBusiness')} />
          </div>

          {missing.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-warning-soft p-3 text-sm">
              <AlertTriangle className="size-5 shrink-0 text-warning" />
              <span className="min-w-0 flex-1 text-fg">{t('labels.missing', { count: missing.length })}</span>
              <Button size="sm" variant="warning" icon={<Barcode className="size-4" />} onClick={generate} loading={busy}>
                {t('labels.generate')}
              </Button>
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-end gap-2">
              <NumberInput label={t('labels.copiesAll')} value={allCopies} onChange={setAllCopies} inputMode="numeric" wrapperClassName="w-32" />
              <Button onClick={() => applyAll(allCopies ?? 1)} className="h-11">
                {t('common:apply')}
              </Button>
              <Button variant="ghost" onClick={fromStock} className="h-11">
                {t('labels.useStock')}
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {items.slice(0, MAX_LISTED).map(({ product: p, copies: n }) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate font-mono text-xs text-muted">
                      {p.barcode || <span className="font-sans text-warning">{t('labels.noBarcode')}</span>}
                      {p.trackStock && <span className="ms-2 font-sans text-subtle">· {t('labels.inStock', { qty: formatQty(p.stock) })}</span>}
                    </div>
                  </div>
                  <Stepper value={n} onChange={(v) => setCopy(p.id, v)} label={t('labels.copies')} />
                </li>
              ))}
              {items.length > MAX_LISTED && <li className="px-3 py-2 text-xs text-muted">{t('labels.more', { count: items.length - MAX_LISTED })}</li>}
            </ul>
          </div>
        </div>

        <div className="border-t border-border bg-surface-3 p-4 lg:border-s lg:border-t-0">
          <div className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{t('labels.preview')}</div>
          {preview ? (
            <iframe title={t('labels.preview')} srcDoc={preview} className="h-[340px] w-full rounded-xl border border-border bg-white lg:h-[min(62vh,560px)]" />
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted">{t('labels.nothing')}</div>
          )}
          <p className="mt-2 text-xs text-subtle">{t('labels.previewHint', { size: `${preset.w} × ${preset.h} mm` })}</p>
        </div>
      </div>
    </Modal>
  )
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex shrink-0 items-center rounded-xl border border-border" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} className="flex size-9 items-center justify-center text-muted hover:text-fg disabled:opacity-40" disabled={value <= 0} aria-label="−">
        <Minus className="size-4" />
      </button>
      <input
        value={value}
        inputMode="numeric"
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
        onFocus={(e) => e.target.select()}
        className="tnum h-9 w-11 bg-transparent text-center text-sm font-semibold focus:outline-none"
      />
      <button type="button" onClick={() => onChange(value + 1)} className="flex size-9 items-center justify-center text-muted hover:text-fg" aria-label="+">
        <Plus className="size-4" />
      </button>
    </div>
  )
}
