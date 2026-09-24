import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Trash2 } from 'lucide-react'
import { navigate } from '@/router'
import { toast } from '@/stores/ui'
import { Button, Input, Modal } from '@/components/ui'
import { Group, Row, Stack } from '../ui'
import { eraseDevice } from '../backup'

const WORD = 'ERASE'

export function DangerSection() {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const erase = async () => {
    if (typed.trim().toUpperCase() !== WORD) return
    setBusy(true)
    try {
      await eraseDevice()
    } catch (e) {
      setBusy(false)
      toast(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <Stack>
      <Group tone="danger" title={t('danger.erase')} description={t('danger.eraseHint')}>
        <Row id="danger.erase">
          <ul className="mb-4 list-disc space-y-1 ps-5 text-sm text-muted">
            <li>{t('danger.eraseWhat1')}</li>
            <li>{t('danger.eraseWhat2')}</li>
            <li>{t('danger.eraseWhat3')}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Archive className="size-4" />} onClick={() => navigate('settings/backup')}>
              {t('danger.backupFirst')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                setTyped('')
                setOpen(true)
              }}
            >
              {t('danger.eraseButton')}
            </Button>
          </div>
        </Row>
      </Group>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        dismissible={!busy}
        title={t('danger.confirmTitle')}
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              {t('common:cancel')}
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} loading={busy} disabled={typed.trim().toUpperCase() !== WORD} onClick={() => void erase()}>
              {t('danger.eraseButton')}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void erase())}>
          <p className="text-sm text-muted">{t('danger.confirmMessage')}</p>
          <Input
            label={t('danger.typeToConfirm', { word: WORD })}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={WORD}
            className="font-mono tracking-widest"
          />
        </form>
      </Modal>
    </Stack>
  )
}
