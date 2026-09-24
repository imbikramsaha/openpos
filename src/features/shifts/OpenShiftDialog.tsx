import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Vault } from 'lucide-react'
import { Button, Modal, MoneyInput } from '@/components/ui'
import { toast } from '@/stores/ui'
import { openShift } from './service'

export function OpenShiftDialog({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened?: () => void }) {
  const { t } = useTranslation('shifts')
  const [float, setFloat] = useState<number | undefined>(0)
  const [busy, setBusy] = useState(false)
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
      </form>
    </Modal>
  )
}
