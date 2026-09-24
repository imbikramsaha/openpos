import { useEffect, useRef } from 'react'

/**
 * USB/Bluetooth barcode scanners act as keyboards that type very fast and press Enter.
 * This listens globally (when no text field has focus) and reports complete scans.
 */
export function useScanner(onScan: (code: string) => void, enabled = true) {
  const buf = useRef('')
  const last = useRef(0)
  const cb = useRef(onScan)
  cb.current = onScan

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      const now = performance.now()
      if (now - last.current > 80) buf.current = ''
      last.current = now
      if (e.key === 'Enter') {
        if (buf.current.length >= 3) {
          e.preventDefault()
          cb.current(buf.current)
        }
        buf.current = ''
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buf.current += e.key
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

export function beep(ok = true) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = ok ? 1250 : 320
    gain.gain.value = 0.05
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.07 : 0.25))
    osc.onended = () => void ctx.close()
  } catch {
    /* audio unavailable */
  }
}
