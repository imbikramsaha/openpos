import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import type { Permission, User } from '@/core/types'
import { can } from '@/core/permissions'
import { useUI } from '@/stores/ui'
import { Modal } from '@/components/ui'
import { PinPad } from './PinPad'
import { usersWith, verifyPin } from './users'

/** Manager-override prompt: a user with the required permission approves with their PIN. */
export function OverrideHost() {
  const { t } = useTranslation('auth')
  const req = useUI((s) => s.override)
  const setOverride = useUI((s) => s.setOverride)
  // Approvers are tagged with the permission they were loaded for: a PIN typed before the
  // list for *this* request has loaded must not be checked against the previous request's.
  const [approvers, setApprovers] = useState<{ perm: Permission; users: User[] } | null>(null)

  useEffect(() => {
    setApprovers(null)
    if (!req) return
    let live = true
    void usersWith(req.permission).then((users) => live && setApprovers({ perm: req.permission, users }))
    return () => {
      live = false
    }
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
        disabled={!req || approvers?.perm !== req.permission}
        onPin={(pin) => {
          if (!req || approvers?.perm !== req.permission) return false
          const u = approvers.users.find((a) => a.active && !a.deleted && can(a, req.permission) && verifyPin(a, pin))
          if (u) close({ id: u.id, name: u.name })
          return !!u
        }}
      />
    </Modal>
  )
}
