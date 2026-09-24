import type { Permission } from '@/core/types'
import { session } from '@/stores/session'
import { useUI } from '@/stores/ui'
import { audit } from '@/db/repo'

/**
 * Resolves with the approving user when the current user has `perm`, or when a user
 * who has it enters their PIN in the manager-override prompt. Resolves null if cancelled.
 */
export async function requirePermission(perm: Permission): Promise<{ id: string; name: string } | null> {
  const s = session()
  if (s.user && s.can(perm)) return { id: s.user.id, name: s.user.name }
  const approver = await new Promise<{ id: string; name: string } | null>((resolve) => useUI.getState().setOverride({ permission: perm, resolve }))
  if (approver) void audit('override', 'permission', perm, `approved by ${approver.name}`)
  return approver
}
