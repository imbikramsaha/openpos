import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import i18n from 'i18next'
import type { Settings } from '@/core/types'
import { db } from '@/db/db'
import { SETTINGS_ID } from '@/db/defaults'
import { audit, put } from '@/db/repo'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'

// Settings save immediately (toggles) or shortly after typing stops (text fields),
// with one subtle "Saved" toast per burst of changes.

let lastToast = 0

export function notifySaved() {
  const now = Date.now()
  if (now - lastToast < 2500) return
  lastToast = now
  toast(i18n.t('common:saved'), 'success')
}

// Saves are queued so two quick changes never read the same stale record.
let queue: Promise<unknown> = Promise.resolve()

export function saveSettings(changes: Partial<Settings>, opts: { silent?: boolean } = {}): Promise<void> {
  const run = async () => {
    const current = (await db.settings.get(SETTINGS_ID)) ?? useSettings.getState().settings
    await put<Settings>('settings', { ...current, ...changes, id: SETTINGS_ID })
    void audit('settings.update', 'settings', SETTINGS_ID, Object.keys(changes).join(', '))
    if (!opts.silent) notifySaved()
  }
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next.catch((e) => {
    toast(e instanceof Error ? e.message : String(e), 'error')
  })
}

/** Text fields wait this long after the last keystroke before saving. */
export const TYPING_DELAY = 900

/**
 * Local editable copy of the store settings. `set` updates the draft instantly and
 * saves after `delay` ms; pending edits are flushed on blur and when the section unmounts.
 */
export function useSettingsDraft() {
  const saved = useSettings((s) => s.settings)
  const [draft, setDraft] = useState(saved)
  const draftRef = useRef(saved)
  const pending = useRef<Partial<Settings>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Adopt changes that arrive from elsewhere (other sections, other terminals via sync)
  // without discarding what the user is typing.
  useEffect(() => {
    draftRef.current = { ...saved, ...pending.current }
    setDraft(draftRef.current)
  }, [saved])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const changes = pending.current
    pending.current = {}
    if (Object.keys(changes).length) await saveSettings(changes)
  }, [])

  const set = useCallback(
    (changes: Partial<Settings>, delay = 0) => {
      draftRef.current = { ...draftRef.current, ...changes }
      setDraft(draftRef.current)
      pending.current = { ...pending.current, ...changes }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush],
  )

  const setReceipt = useCallback(
    (changes: Partial<Settings['receipt']>, delay = 0) => set({ receipt: { ...draftRef.current.receipt, ...changes } }, delay),
    [set],
  )

  const setScale = useCallback(
    (changes: Partial<Settings['scale']>, delay = 0) => set({ scale: { ...draftRef.current.scale, ...changes } }, delay),
    [set],
  )

  // Save what was typed when the section closes, and when the page is hidden or reloaded
  // mid-debounce (IndexedDB writes started in pagehide/beforeunload still complete).
  useEffect(() => {
    const onHide = () => void flush()
    const onVisibility = () => document.visibilityState === 'hidden' && onHide()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      void flush()
    }
  }, [flush])

  return { draft, saved, set, setReceipt, setScale, flush }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

/** Byte counts for storage usage, e.g. "12.4 MB". */
export function formatBytes(bytes: number, locale = i18n.language): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 }).format(v)
  } catch {
    return `${v.toFixed(1)} ${['B', 'KB', 'MB', 'GB'][i]}`
  }
}
