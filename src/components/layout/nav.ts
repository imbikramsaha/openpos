import { BarChart3, Boxes, Package, Receipt, Settings, ShoppingCart, UserCog, Users, Wallet, type LucideIcon } from 'lucide-react'
import type { Permission } from '@/core/types'
import type { RouteName } from '@/router'

export interface NavItem {
  route: RouteName
  labelKey: string
  icon: LucideIcon
  permission: Permission
  /** Shown in the phone bottom bar; others go under "More". */
  primary?: boolean
}

export const NAV: NavItem[] = [
  { route: 'sell', labelKey: 'nav.sell', icon: ShoppingCart, permission: 'sell', primary: true },
  { route: 'sales', labelKey: 'nav.sales', icon: Receipt, permission: 'sales_view', primary: true },
  { route: 'products', labelKey: 'nav.products', icon: Package, permission: 'products_manage', primary: true },
  { route: 'inventory', labelKey: 'nav.inventory', icon: Boxes, permission: 'inventory_manage' },
  { route: 'customers', labelKey: 'nav.customers', icon: Users, permission: 'customers_manage' },
  { route: 'reports', labelKey: 'nav.reports', icon: BarChart3, permission: 'reports_view', primary: true },
  { route: 'shifts', labelKey: 'nav.shifts', icon: Wallet, permission: 'shift_manage' },
  { route: 'users', labelKey: 'nav.users', icon: UserCog, permission: 'users_manage' },
  { route: 'settings', labelKey: 'nav.settings', icon: Settings, permission: 'settings_manage' },
]
