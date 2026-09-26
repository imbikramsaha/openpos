import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { create } from 'zustand'
import { RefreshCw } from 'lucide-react'
import { isElectron, isNative } from '@/lib/platform'
import { useRoute } from '@/router'
import { toast } from '@/stores/ui'
import { Button } from '@/components/ui'

/** A till stays open for days and hash navigation never reloads the page, so look for updates regularly. */
const UPDATE_CHECK_MS = 60 * 60 * 1000
/** "Later" hides the prompt for this long. */
const SNOOZE_MS = 30 * 60 * 1000

const usePwa = create<{ update: null | (() => Promise<void>); snoozedUntil: number }>(() => ({ update: null, snoozedUntil: 0 }))

let registered = false

/**
 * Registers the service worker (web only). Called from main.tsx before React renders, so a
 * release that crashes while rendering can still be replaced by the next one.
 */
export function registerServiceWorker() {
  if (registered || import.meta.env.DEV || isElectron() || isNative() || !location.protocol.startsWith('http') || !('serviceWorker' in navigator)) return
  registered = true
  void import('virtual:pwa-register').then(({ registerSW }) => {
    const updateSW = registerSW({
      onNeedRefresh: () => usePwa.setState({ update: () => updateSW(true), snoozedUntil: 0 }),
      onOfflineReady: () => toast(i18n.t('common:offlineReady'), 'success'),
      onRegisteredSW: (_url, reg) => {
        if (!reg) return
        const check = () => {
          if (navigator.onLine && document.visibilityState === 'visible' && !reg.installing) void reg.update().catch(() => undefined)
        }
        setInterval(check, UPDATE_CHECK_MS)
        document.addEventListener('visibilitychange', check)
        window.addEventListener('online', check)
      },
      onRegisterError: (e) => console.error('Service worker registration failed', e),
    })
  })
}

/** Offers a reload when a new version is ready. Never shown on the customer-facing display. */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const route = useRoute()
  const update = usePwa((s) => s.update)
  const snoozedUntil = usePwa((s) => s.snoozedUntil)
  const [, wake] = useState(0)

  useEffect(() => {
    if (!snoozedUntil) return
    const id = setTimeout(() => wake((n) => n + 1), Math.max(0, snoozedUntil - Date.now()))
    return () => clearTimeout(id)
  }, [snoozedUntil])

  if (!update || route.name === 'display' || Date.now() < snoozedUntil) return null
  return (
    <div role="status" className="animate-pop fixed end-4 top-4 z-[70] flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-pop">
      <RefreshCw className="size-5 shrink-0 text-primary" />
      <span className="flex-1 text-sm">{t('updateAvailable')}</span>
      <Button size="sm" variant="ghost" onClick={() => usePwa.setState({ snoozedUntil: Date.now() + SNOOZE_MS })}>
        {t('later')}
      </Button>
      <Button size="sm" variant="primary" onClick={() => void update()}>
        {t('reload')}
      </Button>
    </div>
  )
}
