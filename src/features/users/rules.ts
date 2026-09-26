import type { Permission, Role, User } from '@/core/types'
import { ROLE_PERMISSIONS } from '@/core/permissions'
import { verifyPin } from '@/features/auth/users'
import { hashPin } from '@/lib/sha256'

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

export type PinConflict = { kind: 'inUse' | 'shadowedBy' | 'prefix'; user: User }

/**
 * The lock screen accepts a PIN as soon as it matches a user, so a PIN that starts with
 * another user's PIN (or that another PIN starts with) would sign the wrong person in.
 * Inactive users count too: they can be reactivated without re-entering their PIN.
 */
export function pinConflict(pin: string, users: User[], exceptId?: string): PinConflict | undefined {
  const others = users.filter((u) => u.id !== exceptId && !u.deleted)
  for (const u of others) if (verifyPin(u, pin)) return { kind: 'inUse', user: u }
  for (const u of others) {
    if (u.pinPrefixHash) {
      // Same first four digits: one PIN could be the start of the other.
      if (hashPin(pin.slice(0, 4), u.pinSalt) === u.pinPrefixHash) return { kind: 'prefix', user: u }
      continue
    }
    // Records created before prefix hashes existed: an existing shorter PIN this one starts with…
    for (let len = 4; len < pin.length; len++) if (verifyPin(u, pin.slice(0, len))) return { kind: 'shadowedBy', user: u }
    // …or an existing PIN one digit longer that starts with this one (hashing is slow, so no deeper).
    if (pin.length < 6) for (let d = 0; d <= 9; d++) if (verifyPin(u, pin + d)) return { kind: 'prefix', user: u }
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
