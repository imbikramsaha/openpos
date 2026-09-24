import { create } from 'zustand'
import type { Settings, Tax } from '@/core/types'
import { defaultSettings } from '@/db/defaults'

// Live mirror of the settings record and tax table, kept current by
// a Dexie liveQuery subscription started in App.tsx.

interface SettingsStore {
  settings: Settings
  taxes: Tax[]
  taxMap: Map<string, Tax>
  loaded: boolean
  setSettings: (s: Settings) => void
  setTaxes: (t: Tax[]) => void
}

export const useSettings = create<SettingsStore>((set) => ({
  settings: defaultSettings(),
  taxes: [],
  taxMap: new Map(),
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  setTaxes: (taxes) => set({ taxes, taxMap: new Map(taxes.map((t) => [t.id, t])) }),
}))

export const settings = () => useSettings.getState().settings
