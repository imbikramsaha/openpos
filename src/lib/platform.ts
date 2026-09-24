// Runtime platform detection. The same bundle runs in browsers, Electron and Capacitor.

interface ElectronBridge {
  isElectron: true
  platform: string
  version: string
  getPrinters: () => Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>
  printHtml: (html: string, options: { printer?: string; silent?: boolean; widthMm?: number }) => Promise<boolean>
  openCashDrawer?: (printer?: string) => Promise<boolean>
}

declare global {
  interface Window {
    kasa?: ElectronBridge
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
  }
}

export const electron = (): ElectronBridge | undefined => (typeof window !== 'undefined' ? window.kasa : undefined)
export const isElectron = () => !!electron()?.isElectron
export const isNative = () => !!window.Capacitor?.isNativePlatform?.()
export const nativePlatform = () => window.Capacitor?.getPlatform?.() ?? 'web'

export function platformName(): string {
  if (isElectron()) return `desktop-${electron()!.platform}`
  if (isNative()) return nativePlatform()
  return 'web'
}

export const isTouch = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches
