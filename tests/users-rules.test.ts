import { describe, expect, it } from 'vitest'
import type { User } from '@/core/types'
import { pinFields } from '@/features/auth/users'
import { checkUserChange, pinConflict } from '@/features/users/rules'

const user = (id: string, pin: string, extra: Partial<User> = {}): User => ({
  id, createdAt: 0, updatedAt: 0, name: id, role: 'cashier', active: true, ...pinFields(pin), ...extra,
})

describe('pinConflict', () => {
  const users = [user('long', '777777'), user('admin', '1234', { role: 'admin' }), user('off', '4444', { active: false })]

  it('rejects an exact duplicate, including of an inactive user', () => {
    expect(pinConflict('1234', users)?.kind).toBe('inUse')
    expect(pinConflict('4444', users)?.user.id).toBe('off')
  })

  it('rejects PINs that share the first four digits in either direction', () => {
    expect(pinConflict('7777', users)).toMatchObject({ kind: 'prefix', user: { id: 'long' } })
    expect(pinConflict('12345', users)).toMatchObject({ kind: 'prefix', user: { id: 'admin' } })
  })

  it('checks legacy users without a prefix hash', () => {
    const { pinPrefixHash: _, ...legacy } = user('legacy', '55555')
    void _
    expect(pinConflict('555551', [legacy])?.kind).toBe('shadowedBy')
    expect(pinConflict('5555', [legacy])?.kind).toBe('prefix')
  })

  it('ignores the user being edited and deleted users', () => {
    expect(pinConflict('1234', users, 'admin')).toBeUndefined()
    expect(pinConflict('9999', [user('gone', '9999', { deleted: true })])).toBeUndefined()
    expect(pinConflict('2468', users)).toBeUndefined()
  })
})

describe('checkUserChange', () => {
  const admin = user('a', '1111', { role: 'admin' })
  it('protects the last active admin and the signed-in user', () => {
    expect(checkUserChange([admin], 'a', admin, null)).toBe('selfDelete')
    expect(checkUserChange([admin], 'x', admin, { role: 'manager', active: true })).toBe('lastAdmin')
    expect(checkUserChange([admin], 'a', admin, { role: 'admin', active: false })).toBe('selfDeactivate')
  })
})
