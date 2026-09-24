import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { ShieldOff } from 'lucide-react'
import { db } from '@/db/db'
import { defaultSettings, SETTINGS_ID } from '@/db/defaults'
import { setMoneyConfig } from '@/lib/money'
import { useRoute, navigate, type RouteName } from '@/router'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { useDevice, applyTheme } from '@/stores/device'
import { AppShell } from '@/components/layout/AppShell'
import { NAV } from '@/components/layout/nav'
import { ConfirmHost, EmptyState, FullScreenLoader, Toasts, Button } from '@/components/ui'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { LockScreen } from '@/features/auth/LockScreen'
import { OverrideHost } from '@/features/auth/OverrideHost'
import { SetupWizard } from '@/features/setup/SetupWizard'
import { loadCurrentShift } from '@/features/shifts/service'
import SellScreen from '@/features/sell/SellScreen'
import { startSync } from '@/sync/engine'

const screens: Record<Exclude<RouteName, 'sell'>, LazyExoticComponent<ComponentType>> = {
  sales: lazy(() => import('@/features/sales/SalesScreen')),
  products: lazy(() => import('@/features/products/ProductsScreen')),
  inventory: lazy(() => import('@/features/inventory/InventoryScreen')),
  customers: lazy(() => import('@/features/customers/CustomersScreen')),
  reports: lazy(() => import('@/features/reports/ReportsScreen')),
  shifts: lazy(() => import('@/features/shifts/ShiftsScreen')),
  users: lazy(() => import('@/features/users/UsersScreen')),
  settings: lazy(() => import('@/features/settings/SettingsScreen')),
}

function useBootstrap() {
  const setSettings = useSettings((s) => s.setSettings)
  const setTaxes = useSettings((s) => s.setTaxes)
  const theme = useDevice((s) => s.theme)

  useEffect(() => {
    const a = liveQuery(() => db.settings.get(SETTINGS_ID)).subscribe((s) => {
      const value = s ?? defaultSettings()
      setMoneyConfig(value.currency, value.numberLocale)
      setSettings(value)
    })
    const b = liveQuery(() => db.taxes.toArray()).subscribe((list) => setTaxes(list.filter((x) => !x.deleted)))
    // Ask the browser not to evict the local database under storage pressure.
    void navigator.storage?.persist?.()
    void startSync()
    return () => {
      a.unsubscribe()
      b.unsubscribe()
    }
  }, [setSettings, setTaxes])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])
}

function useAutoLock() {
  const minutes = useSettings((s) => s.settings.autoLockMinutes)
  const user = useSession((s) => s.user)
  useEffect(() => {
    if (!user) return
    void loadCurrentShift()
    const touch = () => useSession.getState().touch()
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    const id = minutes > 0 ? setInterval(() => {
      if (Date.now() - useSession.getState().lastActivity > minutes * 60_000) useSession.getState().logout()
    }, 15_000) : undefined
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      if (id) clearInterval(id)
    }
  }, [minutes, user])
}

function Screen() {
  const { t } = useTranslation()
  const route = useRoute()
  const can = useSession((s) => s.can)
  const item = NAV.find((n) => n.route === route.name) ?? NAV[0]
  if (!can(item.permission)) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title={t('noAccess')}
        description={t('noAccessHint')}
        action={<Button onClick={() => navigate('sell')}>{t('nav.sell')}</Button>}
        className="h-full"
      />
    )
  }
  if (item.route === 'sell') return <SellScreen />
  const Lazy = screens[item.route]
  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Lazy />
    </Suspense>
  )
}

export default function App() {
  useBootstrap()
  useAutoLock()
  const loaded = useSettings((s) => s.loaded)
  const user = useSession((s) => s.user)
  const userCount = useLiveQuery(() => db.users.filter((u) => !u.deleted).count(), [])

  let body
  if (!loaded || userCount === undefined) body = <FullScreenLoader />
  else if (userCount === 0) body = <SetupWizard />
  else if (!user) body = <LockScreen />
  else
    body = (
      <AppShell>
        <Screen />
      </AppShell>
    )

  return (
    <>
      {body}
      <Toasts />
      <ConfirmHost />
      <OverrideHost />
      <UpdatePrompt />
    </>
  )
}
