import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { Download } from 'lucide-react'
import { isElectron, isNative } from '@/lib/platform'
import { cn } from '@/lib/cn'
import { Button, Modal } from '@/components/ui'

// "Install app" for the web version: Chrome, Edge and Android offer a real install prompt
// (beforeinstallprompt); Safari has none, so iPhone/iPad and Mac users get the steps instead.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const useInstall = create<{ prompt: InstallPromptEvent | null; installed: boolean }>(() => ({ prompt: null, installed: false }))

/** Called from main.tsx before React renders: browsers fire beforeinstallprompt once, early. */
export function listenForInstallPrompt() {
  if (typeof window === 'undefined' || isElectron() || isNative()) return
  window.addEventListener('beforeinstallprompt', (e) => {
    // Keep the event so the button can show the browser's prompt later.
    e.preventDefault()
    useInstall.setState({ prompt: e as InstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ prompt: null, installed: true }))
}

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true

// iPadOS reports itself as a Mac; touch support tells them apart.
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const isMacSafari = () => {
  const ua = navigator.userAgent
  return !isIos() && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua)
}

type Mode = 'prompt' | 'ios' | 'mac'

function useInstallMode(): Mode | null {
  const prompt = useInstall((s) => s.prompt)
  const installed = useInstall((s) => s.installed)
  if (isElectron() || isNative() || installed || standalone()) return null
  if (prompt) return 'prompt'
  if (isIos()) return 'ios'
  if (isMacSafari()) return 'mac'
  return null
}

/** Icon button for the navigation rail and phone header; renders nothing when the app can't be installed. */
export function InstallButton({ className }: { className?: string }) {
  const { t } = useTranslation()
  const mode = useInstallMode()
  const [steps, setSteps] = useState<Mode | null>(null)
  if (!mode) return null

  const install = () => {
    if (mode !== 'prompt') return setSteps(mode)
    const event = useInstall.getState().prompt
    // A prompt can only be shown once; the browser fires a new event if it's dismissed.
    useInstall.setState({ prompt: null })
    void event?.prompt().catch(() => undefined)
  }

  return (
    <>
      <button onClick={install} title={t('install.button')} aria-label={t('install.button')} className={cn('flex size-10 items-center justify-center rounded-lg text-primary hover:bg-surface-3', className)}>
        <Download className="size-4.5" />
      </button>
      <Modal open={!!steps} onClose={() => setSteps(null)} title={t('install.title')} size="sm" footer={<Button onClick={() => setSteps(null)}>{t('done')}</Button>}>
        {steps === 'ios' ? (
          <ol className="list-decimal space-y-2 ps-5 text-sm">
            <li>{t('install.iosShare')}</li>
            <li>{t('install.iosAdd')}</li>
            <li>{t('install.iosConfirm')}</li>
          </ol>
        ) : (
          <p className="text-sm">{t('install.macSafari')}</p>
        )}
      </Modal>
    </>
  )
}
