import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { isElectron, isNative } from '@/lib/platform'
import { Button } from '@/components/ui'

/** Registers the service worker (web only) and offers a reload when a new version is ready. */
export function UpdatePrompt() {
  const { t } = useTranslation()
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null)

  useEffect(() => {
    if (import.meta.env.DEV || isElectron() || isNative() || !location.protocol.startsWith('http') || !('serviceWorker' in navigator)) return
    void import('virtual:pwa-register').then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => updateSW),
      })
    })
  }, [])

  if (!update) return null
  return (
    <div className="animate-pop fixed end-4 top-4 z-[70] flex max-w-sm items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-pop">
      <RefreshCw className="size-5 shrink-0 text-primary" />
      <span className="flex-1 text-sm">{t('updateAvailable')}</span>
      <Button size="sm" variant="primary" onClick={() => void update(true)}>
        {t('reload')}
      </Button>
    </div>
  )
}
