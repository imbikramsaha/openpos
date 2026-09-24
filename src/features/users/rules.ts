import type { Permission, Role, User } from '@/core/types'
import { ROLE_PERMISSIONS } from '@/core/permissions'
import { verifyPin } from '@/features/auth/users'

// Guard rails for user management: nobody can lock the store out of itself.

export type RuleError = 'selfDelete' | 'selfDeactivate' | 'lastAdmin'

const isActiveAdmin = (u: Pick<User, 'role' | 'active' | 'deleted'>) => u.role === 'admin' && u.active && !u.deleted

/** Checks an edit (or deletion when `next` is null) against the store's safety rules. */
export function checkUserChange(users: User[], meId: string | undefined, before: User | null, next: { role: Role; active: boolean } | null): RuleError | null {
  if (before && before.id === meId) {
    if (!next) return 'selfDelete'
    if (!next.active) return 'selfDeactivate'
  }
  if (before && isActiveAdmin(before) && (!next || !next.active || next.role !== 'admin')) {
    const others = users.filter((u) => u.id !== before.id && isActiveAdmin(u))
    if (!others.length) return 'lastAdmin'
  }
  return null
}

/** Extra permissions that are not already part of the role. */
export function extrasFor(role: Role, extras: Iterable<Permission>): Permission[] {
  const base = ROLE_PERMISSIONS[role]
  return [...new Set(extras)].filter((p) => !base.includes(p))
}

/**
 * The lock screen accepts a PIN as soon as it matches a user, so a new PIN that starts
 * with another user's shorter PIN would sign that user in instead.
 */
export function pinShadowedBy(pin: string, users: User[], exceptId?: string): User | undefined {
  for (let len = 4; len < pin.length; len++) {
    const prefix = pin.slice(0, len)
    const hit = users.find((u) => u.id !== exceptId && u.active && !u.deleted && verifyPin(u, prefix))
    if (hit) return hit
  }
  return undefined
}

/** Human-readable list of changed fields for the audit log (never includes the PIN itself). */
export function describeChanges(before: User, after: Partial<User>, pinChanged: boolean): string {
  const out: string[] = []
  if (after.name !== undefined && after.name !== before.name) out.push(`name: ${before.name} → ${after.name}`)
  if (after.role && after.role !== before.role) out.push(`role: ${before.role} → ${after.role}`)
  if (after.active !== undefined && after.active !== before.active) out.push(after.active ? 'activated' : 'deactivated')
  if ('color' in after && after.color !== before.color) out.push('colour')
  const prev = [...(before.extraPermissions ?? [])].sort().join(',')
  const next = [...(after.extraPermissions ?? [])].sort().join(',')
  if (prev !== next) out.push(`extra: [${next}]`)
  if (pinChanged) out.push('PIN changed')
  return out.join('; ')
}
