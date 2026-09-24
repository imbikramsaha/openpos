import { useSyncStatus } from './status'

// Placeholder API — the full push/pull engine is implemented in this module.

export interface ConnectionResult {
  ok: boolean
  storeName?: string
  error?: string
}

export async function startSync(): Promise<void> {
  useSyncStatus.getState().set({ state: 'disabled' })
}

export function stopSync(): void {}

export async function syncNow(): Promise<void> {}

export async function testConnection(_url: string, _key: string): Promise<ConnectionResult> {
  return { ok: false, error: 'not implemented' }
}

export async function joinStore(_url: string, _key: string): Promise<void> {}
