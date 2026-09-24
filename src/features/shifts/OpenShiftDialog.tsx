import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Vault } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { Button, Modal, MoneyInput } from '@/components/ui'
import { toast } from '@/stores/ui'
import { lastClosedShift, openShift } from './service'

export function OpenShiftDialog({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened?: () => void }) {
  const { t } = useTranslation('shifts')
  const [float, setFloat] = useState<number | undefined>(0)
  const [busy, setBusy] = useState(false)
  const [suggest, setSuggest] = useState<Array<{ key: string; label: string; value: number }>>([])

  // Offer last shift's float and what was left in the drawer as one-tap amounts.
  useEffect(() => {
    if (!open) return
    let alive = true
    void lastClosedShift().then((last) => {
      if (!alive || !last) return setSuggest([])
      const out: Array<{ key: string; label: string; value: number }> = []
      if (last.openingFloat > 0) out.push({ key: 'float', label: t('sameFloat', { amount: formatMoney(last.openingFloat) }), value: last.openingFloat })
      if (last.countedCash !== undefined && last.countedCash > 0 && last.countedCash !== last.openingFloat)
        out.push({ key: 'counted', label: t('lastCounted', { amount: formatMoney(last.countedCash) }), value: last.countedCash })
      setSuggest(out)
    })
    return () => {
      alive = false
    }
  }, [open, t])

  const submit = async () => {
    setBusy(true)
    try {
      await openShift(float ?? 0)
      toast(t('opened'))
      onOpened?.()
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
      title={t('openShift')}
      size="sm"
      footer={
        <Button variant="primary" loading={busy} onClick={submit} icon={<Vault className="size-4" />}>
          {t('openShift')}
        </Button>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), void submit())}>
        <MoneyInput label={t('openingFloat')} hint={t('openingFloatHint')} value={float} onChange={setFloat} autoFocus />
        {suggest.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggest.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setFloat(s.value)}
                className="h-9 rounded-full border border-border bg-surface-2 px-3 text-xs font-medium text-muted transition-colors hover:text-fg"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </form>
    </Modal>
  )
}
