import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban } from 'lucide-react'
import type { Sale } from '@/core/types'
import { formatMoney } from '@/lib/money'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'
import { voidSale } from '@/features/sell/checkout'

const REASONS = ['mistake', 'duplicate', 'testSale', 'customerLeft'] as const

export function VoidDialog({ sale, open, onClose }: { sale: Sale; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sales')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  // Guards the whole confirm + void sequence, so a double click can't void twice.
  const busyRef = useRef(false)
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const submit = async () => {
    const r = reason.trim()
    if (!r || busyRef.current) return
    busyRef.current = true
    try {
      const ok = await confirmDialog({
        title: t('void.confirmTitle', { number: sale.number }),
        message: t('void.confirmMessage', { amount: formatMoney(sale.total) }),
        confirmLabel: t('void.action'),
        danger: true,
      })
      if (!ok) return
      setBusy(true)
      await voidSale(sale, r)
      toast(t('void.done', { number: sale.number }))
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('void.title', { number: sale.number })}
      subtitle={formatMoney(sale.total)}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common:cancel')}
          </Button>
          <Button variant="danger" icon={<Ban className="size-4" />} loading={busy} disabled={!reason.trim()} onClick={submit}>
            {t('void.action')}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">{t('void.hint')}</p>
      <form onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Input label={t('void.reason')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus maxLength={200} required />
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(t(`void.reasons.${r}`))} className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-3 hover:text-fg">
            {t(`void.reasons.${r}`)}
          </button>
        ))}
      </div>
    </Modal>
  )
}
