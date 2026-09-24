import type { Permission, Role, User } from './types'

export const ALL_PERMISSIONS: Permission[] = [
  'sell',
  'discount',
  'price_override',
  'refund',
  'void',
  'cash_drawer',
  'shift_manage',
  'sales_view',
  'products_manage',
  'inventory_manage',
  'customers_manage',
  'customers_credit',
  'reports_view',
  'settings_manage',
  'users_manage',
]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => p !== 'users_manage' && p !== 'settings_manage'),
  cashier: ['sell', 'cash_drawer', 'shift_manage', 'sales_view', 'customers_manage'],
}

export function can(user: Pick<User, 'role' | 'extraPermissions'> | null | undefined, perm: Permission): boolean {
  if (!user) return false
  return ROLE_PERMISSIONS[user.role].includes(perm) || !!user.extraPermissions?.includes(perm)
}
