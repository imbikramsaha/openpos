import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import type { User } from '@/core/types'
import { useUI } from '@/stores/ui'
import { Modal } from '@/components/ui'
import { PinPad } from './PinPad'
import { usersWith, verifyPin } from './users'

/** Manager-override prompt: a user with the required permission approves with their PIN. */
export function OverrideHost() {
  const { t } = useTranslation('auth')
  const req = useUI((s) => s.override)
  const setOverride = useUI((s) => s.setOverride)
  const [approvers, setApprovers] = useState<User[]>([])

  useEffect(() => {
    if (req) void usersWith(req.permission).then(setApprovers)
  }, [req])

  const close = (u: { id: string; name: string } | null) => {
    req?.resolve(u)
    setOverride(null)
  }

  return (
    <Modal open={!!req} onClose={() => close(null)} title={t('approvalRequired')} size="sm">
      <div className="mb-5 flex items-start gap-3 rounded-xl bg-warning-soft p-3 text-sm text-warning">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" />
        <span>{t('approvalHint', { permission: req ? t(`common:perm.${req.permission}`) : '' })}</span>
      </div>
      <PinPad
        onPin={(pin) => {
          const u = approvers.find((a) => verifyPin(a, pin))
          if (u) close({ id: u.id, name: u.name })
          return !!u
        }}
      />
    </Modal>
  )
}
