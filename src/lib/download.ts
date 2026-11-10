import i18n from 'i18next'
import { canSaveFiles } from './platform'
import { toast } from '@/stores/ui'

/** Saves a file through the browser. Returns false when nothing could be saved (the mobile apps, for now). */
export function downloadText(filename: string, text: string, mime = 'text/plain'): boolean {
  const blob = new Blob([mime.includes('csv') ? '\uFEFF' + text : text], { type: `${mime};charset=utf-8` })
  return downloadBlob(filename, blob)
}

export function downloadBlob(filename: string, blob: Blob): boolean {
  if (!canSaveFiles()) {
    toast(i18n.t('common:saveSoon'), 'info')
    return false
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

export function readFileText(file: File): Promise<string> {
  return file.text()
}

export function readFileDataUrl(file: File, maxSize = 256): Promise<string> {
  // Downscale images so product thumbnails stay small in IndexedDB and sync payloads.
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/webp', 0.82))
    }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}
