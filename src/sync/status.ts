import { create } from 'zustand'

export type SyncState = 'disabled' | 'offline' | 'idle' | 'syncing' | 'error'

interface SyncStatus {
  state: SyncState
  online: boolean
  pending: number
  lastSync?: number
  error?: string
  set: (s: Partial<Omit<SyncStatus, 'set'>>) => void
}

export const useSyncStatus = create<SyncStatus>((set) => ({
  state: 'disabled',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  set: (s) => set(s),
}))

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => useSyncStatus.getState().set({ online: true }))
  window.addEventListener('offline', () => useSyncStatus.getState().set({ online: false }))
}
