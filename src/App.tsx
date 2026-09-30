import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { liveQuery } from 'dexie'
import { AppWindow, DatabaseZap, RefreshCw, ShieldOff } from 'lucide-react'
import { db } from '@/db/db'
import { setActor } from '@/db/repo'
import { defaultSettings, SETTINGS_ID, withDefaults } from '@/db/defaults'
import { setMoneyConfig } from '@/lib/money'
import { useRoute, navigate, type RouteName } from '@/router'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { useDevice, applyTheme } from '@/stores/device'
import { AppShell } from '@/components/layout/AppShell'
import { NAV } from '@/components/layout/nav'
import { ConfirmHost, EmptyState, FullScreenLoader, PromptHost, Toasts, Button } from '@/components/ui'
import { UpdatePrompt } from '@/components/UpdatePrompt'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LockScreen } from '@/features/auth/LockScreen'
import { OverrideHost } from '@/features/auth/OverrideHost'
import { SetupWizard } from '@/features/setup/SetupWizard'
import { loadCurrentShift } from '@/features/shifts/service'
import SellScreen from '@/features/sell/SellScreen'
import { startSync } from '@/sync/engine'
import { startAutoBackup } from '@/features/backup/runner'

const OPEN_TIMEOUT_MS = 10_000

const CustomerDisplay = lazy(() => import('@/features/display/CustomerDisplay'))

const screens: Record<Exclude<RouteName, 'sell' | 'display'>, LazyExoticComponent<ComponentType>> = {
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
      const value = s ? withDefaults(s) : defaultSettings()
      setMoneyConfig(value.currency, value.numberLocale)
      setSettings(value)
    })
    const b = liveQuery(() => db.taxes.toArray()).subscribe((list) => setTaxes(list.filter((x) => !x.deleted)))
    // Ask the browser not to evict the local database under storage pressure.
    void navigator.storage?.persist?.()
    void startSync()
    startAutoBackup()
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
  const userId = useSession((s) => s.user?.id)
  useEffect(() => {
    if (!userId) return
    void loadCurrentShift()
    // Scrolling a long report counts as activity too; throttled so wheel/scroll bursts stay cheap.
    let last = 0
    const touch = () => {
      const now = Date.now()
      if (now - last < 2000) return
      last = now
      useSession.getState().touch()
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    for (const e of events) window.addEventListener(e, touch, { capture: true, passive: true })
    const id = minutes > 0 ? setInterval(() => {
      if (Date.now() - useSession.getState().lastActivity > minutes * 60_000) useSession.getState().logout()
    }, 15_000) : undefined
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true })
      if (id) clearInterval(id)
    }
  }, [minutes, userId])
}

/**
 * Keeps the signed-in user in step with their record: a role or permission change made on
 * another screen, tab or terminal applies at once, and a deactivated or deleted user is signed out.
 */
function useSessionUserSync() {
  const userId = useSession((s) => s.user?.id)
  useEffect(() => {
    if (!userId) return
    const sub = liveQuery(() => db.users.get(userId)).subscribe({
      next: (u) => {
        const s = useSession.getState()
        if (s.user?.id !== userId) return
        if (!u || u.deleted || !u.active) return s.logout()
        if (u !== s.user && u.updatedAt !== s.user.updatedAt) {
          setActor({ id: u.id, name: u.name })
          useSession.setState({ user: u })
        }
      },
      error: () => {
        /* database closed (erased in another tab) — nothing to sync */
      },
    })
    return () => sub.unsubscribe()
  }, [userId])
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
  if (item.route === 'sell') return <ErrorBoundary resetKey="sell"><SellScreen /></ErrorBoundary>
  const Lazy = screens[item.route as keyof typeof screens]
  return (
    <ErrorBoundary resetKey={route.name + route.sub}>
      <Suspense fallback={<FullScreenLoader />}>
        <Lazy />
      </Suspense>
    </ErrorBoundary>
  )
}

/** Shown when the browser refuses local storage (private windows, blocked site data, full disk). */
function StorageError({ error }: { error: Error }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={<DatabaseZap />}
      title={t('storageError')}
      description={
        <>
          {t('storageErrorHint')}
          <span className="mt-2 block font-mono text-xs break-words text-subtle">{error.message || error.name}</span>
        </>
      }
      action={<Button variant="primary" onClick={() => location.reload()}>{t('reload')}</Button>}
      className="h-full"
    />
  )
}

/** Shown when the database was deleted or upgraded from elsewhere while this tab was open. */
function Blocking({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action: ReactNode }) {
  return <EmptyState icon={icon} title={title} description={hint} action={action} className="h-full" />
}

/**
 * One till tab per device: the cart and document numbers live in this browser's storage, so two
 * tabs selling at once would overwrite each other's cart. The newest tab wins; the customer
 * display (#/display) is exempt.
 */
function useSingleTab(enabled: boolean): boolean {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return
    const id = Math.random().toString(36).slice(2)
    const channel = new BroadcastChannel('kasa-till')
    const claim = () => channel.postMessage({ type: 'claim', id })
    channel.onmessage = (e: MessageEvent<{ type?: string; id?: string }>) => {
      if (e.data?.id === id) return
      if (e.data?.type === 'claim') setBlocked(true)
      // The active tab closed: take the till back without a reload.
      if (e.data?.type === 'release') {
        setBlocked(false)
        claim()
      }
    }
    const onShow = (e: PageTransitionEvent) => e.persisted && claim()
    // Leaving for good (not the back/forward cache) frees the till for the other tabs.
    const onHide = (e: PageTransitionEvent) => !e.persisted && channel.postMessage({ type: 'release', id })
    claim()
    window.addEventListener('pageshow', onShow)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', onHide)
      channel.close()
    }
  }, [enabled])
  return blocked
}

/** Opens the local database before anything reads it, so a browser without usable storage gets an explanation instead of a blank page. */
export default function App() {
  const { t } = useTranslation()
  const route = useRoute()
  const [storage, setStorage] = useState<'checking' | 'ok' | 'closed' | Error>('checking')
  const otherTab = useSingleTab(storage === 'ok' && route.name !== 'display')

  useEffect(() => {
    let alive = true
    let settled = false
    const settle = (v: 'ok' | Error) => {
      if (!alive || settled) return
      settled = true
      clearTimeout(timer)
      setStorage(v)
    }
    const fail = (e: unknown) => settle(e instanceof Error ? e : new Error(String(e)))
    // Some WebKit versions never answer an open request; don't spin forever.
    const timer = setTimeout(() => fail(new Error('Timed out opening the local database')), OPEN_TIMEOUT_MS)
    try {
      db.open().then(() => settle('ok'), fail)
    } catch (e) {
      fail(e)
    }
    // If the database is deleted or upgraded elsewhere (site data cleared, erased or restored in
    // another tab, a newer version opened), Dexie would quietly reopen an empty database and the
    // next sale would land there. Stop and ask for a reload instead.
    let closing = false
    const onClose = () => {
      if (closing || !alive) return
      closing = true
      db.close({ disableAutoOpen: true })
      setStorage('closed')
    }
    db.on('close', onClose)
    return () => {
      alive = false
      clearTimeout(timer)
      db.on('close').unsubscribe(onClose)
    }
  }, [])

  if (storage === 'checking') return <FullScreenLoader />
  const reload = <Button variant="primary" onClick={() => location.reload()}>{t('reload')}</Button>
  let blocking: ReactNode = null
  if (storage === 'closed') blocking = <Blocking icon={<RefreshCw />} title={t('dbClosed')} hint={t('dbClosedHint')} action={reload} />
  else if (storage !== 'ok') blocking = <StorageError error={storage} />
  else if (otherTab) blocking = <Blocking icon={<AppWindow />} title={t('otherTab')} hint={t('otherTabHint')} action={<Button variant="primary" onClick={() => location.reload()}>{t('useHere')}</Button>} />
  if (blocking) {
    return (
      <>
        {blocking}
        <UpdatePrompt />
      </>
    )
  }
  return <Main />
}

function Main() {
  useBootstrap()
  useAutoLock()
  useSessionUserSync()
  const loaded = useSettings((s) => s.loaded)
  const user = useSession((s) => s.user)
  const userCount = useLiveQuery(() => db.users.filter((u) => !u.deleted).count(), [])
  const route = useRoute()

  let body
  if (route.name === 'display') body = loaded ? <Suspense fallback={<FullScreenLoader />}><CustomerDisplay /></Suspense> : <FullScreenLoader />
  else if (!loaded || userCount === undefined) body = <FullScreenLoader />
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
      <PromptHost />
      <OverrideHost />
      <UpdatePrompt />
    </>
  )
}
