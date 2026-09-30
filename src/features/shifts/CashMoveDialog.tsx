import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatMoney } from '@/lib/money'
import { toast } from '@/stores/ui'
import { Button, Input, Modal, MoneyInput, Segmented } from '@/components/ui'
import { addCashMovement, amountError } from './service'

const REASONS = {
  in: ['reasons.float', 'reasons.change', 'reasons.other'],
  out: ['reasons.supplier', 'reasons.expense', 'reasons.bank', 'reasons.owner', 'reasons.other'],
} as const

/** Cash in / cash out of the drawer. The caller checks the cash_drawer permission first. */
export function CashMoveDialog({ open, type: initial, onClose, expected }: { open: boolean; type: 'in' | 'out'; onClose: () => void; expected?: number }) {
  const { t } = useTranslation('shifts')
  const [type, setType] = useState<'in' | 'out'>(initial)
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setType(initial)
    setAmount(undefined)
    setReason('')
  }, [open, initial])

  const tooMuch = type === 'out' && expected !== undefined && (amount ?? 0) > expected
  const error = amountError(amount)
  const valid = !!amount && amount > 0 && !error && !tooMuch
  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      await addCashMovement(type, amount, reason.trim())
      toast(type === 'in' ? t('cashInDone', { amount: formatMoney(amount) }) : t('cashOutDone', { amount: formatMoney(amount) }))
      onClose()
    } catch (e) {
      toast(String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type === 'in' ? t('cashIn') : t('cashOut')}
      subtitle={t('cashMoveHint')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant={type === 'in' ? 'success' : 'danger'} loading={busy} disabled={!valid} onClick={submit} icon={type === 'in' ? <ArrowDownToLine className="size-4" /> : <ArrowUpFromLine className="size-4" />}>
            {type === 'in' ? t('addCash') : t('removeCash')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void submit())}>
        <Segmented
          value={type}
          onChange={setType}
          className="w-full"
          options={[
            { value: 'in', label: t('cashIn') },
            { value: 'out', label: t('cashOut') },
          ]}
        />
        <MoneyInput label={t('common:amount')} value={amount} onChange={setAmount} autoFocus className="h-14 text-2xl font-semibold" error={error ? t(error) : tooMuch ? t('moreThanDrawer', { amount: formatMoney(expected ?? 0) }) : undefined} />
        <div>
          <Input label={t('common:reason')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} maxLength={120} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASONS[type].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setReason(t(k))}
                className={cn('h-9 rounded-full border px-3 text-xs font-medium transition-colors', reason === t(k) ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface-2 text-muted hover:text-fg')}
              >
                {t(k)}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}
