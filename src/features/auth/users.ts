import type { Permission, Role, User } from '@/core/types'
import { can } from '@/core/permissions'
import { db } from '@/db/db'
import { put } from '@/db/repo'
import { hashPin } from '@/lib/sha256'
import { randomHex } from '@/lib/uuid'

export function verifyPin(user: User, pin: string): boolean {
  return hashPin(pin, user.pinSalt) === user.pinHash
}

export function pinFields(pin: string) {
  const pinSalt = randomHex(16)
  return { pinSalt, pinHash: hashPin(pin, pinSalt) }
}

export async function createUser(name: string, role: Role, pin: string, extra: Partial<User> = {}): Promise<User> {
  return put<User>('users', { name, role, active: true, ...pinFields(pin), ...extra })
}

export async function activeUsers(): Promise<User[]> {
  const all = await db.users.toArray()
  return all.filter((u) => u.active && !u.deleted).sort((a, b) => a.name.localeCompare(b.name))
}

export async function usersWith(p: Permission): Promise<User[]> {
  return (await activeUsers()).filter((u) => can(u, p))
}

/** True when another active user already uses this PIN (PINs identify users at the till). */
export async function pinInUse(pin: string, exceptId?: string): Promise<boolean> {
  return (await activeUsers()).some((u) => u.id !== exceptId && verifyPin(u, pin))
}
