import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CameraOff } from 'lucide-react'
import { Modal, Spinner } from '@/components/ui'

interface DetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'qr_code', 'codabar', 'data_matrix']

async function createDetector(): Promise<DetectorLike> {
  const Native = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike }).BarcodeDetector
  if (Native) {
    try {
      return new Native({ formats: FORMATS })
    } catch {
      /* fall through to the WASM polyfill */
    }
  }
  // iOS Safari/WKWebView and desktop Firefox lack BarcodeDetector: use the ZXing WASM
  // polyfill, served from our own bundle so scanning works offline.
  const [{ BarcodeDetector, prepareZXingModule }, wasm] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) } })
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as DetectorLike
}

export function CameraScanner({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (code: string) => void }) {
  const { t } = useTranslation('sell')
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let stopped = false
    let lastCode = ''
    let lastAt = 0
    setError('')
    setReady(false)
    ;(async () => {
      try {
        const detector = await createDetector()
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
        if (stopped) return
        const v = video.current!
        v.srcObject = stream
        await v.play()
        setReady(true)
        const tick = async () => {
          if (stopped) return
          try {
            const codes = await detector.detect(v)
            const code = codes[0]?.rawValue
            const now = Date.now()
            // Debounce: the same code must not be added repeatedly while held in view.
            if (code && (code !== lastCode || now - lastAt > 1800)) {
              lastCode = code
              lastAt = now
              onScan(code)
            }
          } catch {
            /* frame not ready */
          }
          setTimeout(tick, 120)
        }
        void tick()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      stopped = true
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [open, onScan])

  return (
    <Modal open={open} onClose={onClose} title={t('scanWithCamera')} size="md" flush>
      <div className="relative aspect-[4/3] w-full bg-black">
        <video ref={video} className="h-full w-full object-cover" playsInline muted />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="text-white" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-white">
            <CameraOff className="size-8" />
            <p className="text-sm">{t('cameraError')}</p>
            <p className="text-xs opacity-70">{error}</p>
          </div>
        )}
        {ready && <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-0.5 -translate-y-1/2 bg-red-500 shadow-[0_0_12px_red]" />}
      </div>
      <p className="p-4 text-center text-sm text-muted">{t('cameraHint')}</p>
    </Modal>
  )
}
