import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import type { Product } from '@/core/types'
import { db } from '@/db/db'
import { round3 } from '@/db/repo'
import { formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, Input, Label, Modal, NumberInput, Segmented } from '@/components/ui'
import { MAX_QTY } from '@/features/products/util'
import { adjustStock, NegativeStockError, REASONS, type AdjustMode, type AdjustReason } from './service'
import { QtyDelta } from './shared'

/** Add, remove or set the counted quantity of one product, with a reason for the ledger. */
export function AdjustDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation('inventory')
  const allowNegative = useSettings((s) => s.settings.allowNegativeStock)
  const [mode, setMode] = useState<AdjustMode>('add')
  const [qty, setQty] = useState<number | undefined>()
  const [reason, setReason] = useState<AdjustReason>('received')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useLiveQuery(() => (product ? db.products.get(product.id) : undefined), [product?.id])
  const open = !!product

  useEffect(() => {
    if (!open) return
    setMode('add')
    setQty(undefined)
    setReason('received')
    setNote('')
  }, [open, product?.id])

  const current = live?.stock ?? product?.stock ?? 0
  const q = qty ?? 0
  const next = round3(mode === 'add' ? current + q : mode === 'remove' ? current - q : q)
  const delta = round3(next - current)
  const blocked = next < 0 && !allowNegative
  const valid = qty !== undefined && qty >= 0 && qty <= MAX_QTY && delta !== 0 && !blocked
  const unit = product && product.unit !== 'pcs' ? ` ${t(`common:unit.${product.unit}`)}` : ''

  const changeMode = (m: AdjustMode) => {
    setMode(m)
    setReason(REASONS[m][0])
  }

  const save = async () => {
    if (!product || !valid || busy) return
    setBusy(true)
    try {
      const text = [t(`reason.${reason}`), note.trim()].filter(Boolean).join(' — ')
      await adjustStock(product.id, mode, q, reason, text, allowNegative)
      toast(t('adjust.saved', { name: product.name, qty: `${formatQty(next)}${unit}` }))
      onClose()
    } catch (e) {
      toast(e instanceof NegativeStockError ? t('adjust.negativeBlocked') : e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('adjust.title')}
      subtitle={product?.name}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" onClick={save} disabled={!valid} loading={busy}>
            {t('adjust.save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Segmented
          value={mode}
          onChange={changeMode}
          className="w-full"
          options={[
            { value: 'add', label: t('adjust.mode.add') },
            { value: 'remove', label: t('adjust.mode.remove') },
            { value: 'set', label: t('adjust.mode.set') },
          ]}
        />
        <NumberInput
          label={t(`adjust.qtyLabel.${mode}`)}
          value={qty}
          onChange={(v) => setQty(v === undefined ? undefined : Math.abs(v))}
          autoFocus
          placeholder="0"
          className="h-14 text-2xl font-bold"
          right={unit ? <span className="pe-2 text-sm text-muted">{unit.trim()}</span> : undefined}
        />
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3">
          <div>
            <div className="text-xs text-muted">{t('adjust.current')}</div>
            <div className="tnum text-lg font-semibold">{formatQty(current)}</div>
          </div>
          <ArrowRight className="size-5 text-subtle rtl:rotate-180" />
          <div className="text-end">
            <div className="text-xs text-muted">{t('adjust.new')}</div>
            <div className={cn('tnum text-lg font-bold', next < 0 && 'text-danger')}>
              {formatQty(next)} {qty !== undefined && delta !== 0 && <QtyDelta qty={delta} className="ms-1 text-sm" />}
            </div>
          </div>
        </div>
        {next < 0 && (
          <p className={cn('flex items-center gap-1.5 text-xs font-medium', blocked ? 'text-danger' : 'text-warning')}>
            <AlertTriangle className="size-3.5" /> {allowNegative ? t('adjust.negative') : t('adjust.negativeBlocked')}
          </p>
        )}
        <div>
          <Label>{t('common:reason')}</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {REASONS[mode].map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => setReason(r)}
                className={cn(
                  'h-9 rounded-xl border px-3 text-sm font-medium transition-colors',
                  reason === r ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-muted hover:text-fg',
                )}
              >
                {t(`reason.${r}`)}
              </button>
            ))}
          </div>
        </div>
        <Input label={t('common:note')} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('common:optional')} maxLength={200} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
