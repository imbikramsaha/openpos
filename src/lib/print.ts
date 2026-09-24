import { electron } from './platform'
import { device } from '@/stores/device'

/**
 * Prints a complete HTML document. Desktop (Electron) can print silently to the
 * configured printer; browsers and mobile use the system print dialog, which also
 * offers "Save as PDF".
 */
export async function printHtml(html: string, widthMm?: number): Promise<boolean> {
  const bridge = electron()
  const d = device()
  if (bridge) return bridge.printHtml(html, { printer: d.printer || undefined, silent: d.silentPrint, widthMm })
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)
    const doc = frame.contentDocument!
    doc.open()
    doc.write(html)
    doc.close()
    const done = () => {
      setTimeout(() => frame.remove(), 1000)
      resolve(true)
    }
    const go = () => {
      try {
        frame.contentWindow!.focus()
        frame.contentWindow!.print()
      } finally {
        done()
      }
    }
    // Wait for images (logo, barcode) before printing.
    const imgs = Array.from(doc.images)
    if (!imgs.length) setTimeout(go, 50)
    else Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r))))).then(() => setTimeout(go, 50))
  })
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
