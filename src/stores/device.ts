import { create } from 'zustand'
import { uuid } from '@/lib/uuid'

// Per-terminal configuration. Lives in localStorage and is never synced:
// each till has its own printer, terminal code and server connection.

export interface DeviceConfig {
  deviceId: string
  terminal: string
  terminalName: string
  language: string
  theme: 'system' | 'light' | 'dark'
  serverUrl: string
  storeKey: string
  syncEnabled: boolean
  printer: string
  silentPrint: boolean
  cartSide: 'left' | 'right'
  gridSize: 'sm' | 'md' | 'lg'
  showImages: boolean
  sound: boolean
  cameraScanner: boolean
}

const KEY = 'kasa.device'

function load(): DeviceConfig {
  let saved: Partial<DeviceConfig> = {}
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    /* storage unavailable (private mode) — fall back to defaults */
  }
  const deviceId = saved.deviceId || uuid()
  return {
    deviceId,
    terminal: saved.terminal || deviceId.slice(0, 4).toUpperCase(),
    terminalName: saved.terminalName || 'Till 1',
    language: saved.language || '',
    theme: saved.theme || 'system',
    serverUrl: saved.serverUrl || '',
    storeKey: saved.storeKey || '',
    syncEnabled: saved.syncEnabled ?? false,
    printer: saved.printer || '',
    silentPrint: saved.silentPrint ?? false,
    cartSide: saved.cartSide || 'right',
    gridSize: saved.gridSize || 'md',
    showImages: saved.showImages ?? true,
    sound: saved.sound ?? true,
    cameraScanner: saved.cameraScanner ?? true,
  }
}

function persist(c: DeviceConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
    localStorage.setItem('kasa.theme', c.theme)
  } catch {
    /* ignore */
  }
}

interface DeviceStore extends DeviceConfig {
  update: (changes: Partial<DeviceConfig>) => void
}

export const useDevice = create<DeviceStore>((set, get) => {
  const initial = load()
  persist(initial)
  return {
    ...initial,
    update: (changes) => {
      set(changes)
      const { update: _u, ...rest } = { ...get(), ...changes }
      void _u
      persist(rest as DeviceConfig)
    },
  }
})

export const device = () => useDevice.getState()

export function applyTheme(theme: DeviceConfig['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0b' : '#f6f6f7')
}
