import { createContext, useContext } from 'react'
import type { PaymentMethod, Settings } from '@/core/types'
import { defaultSettings } from '@/db/defaults'
import { device } from '@/stores/device'
import { SLOTS } from './charts'

/** Range labels and file naming shared by every table's CSV / print action. */
export interface ReportMeta {
  rangeLabel: string
  prevLabel: string
  /** Appended to exported file names, e.g. 2026-09-01_2026-09-24. */
  fileTag: string
  settings: Settings
}

export const ReportMetaContext = createContext<ReportMeta>({ rangeLabel: '', prevLabel: '', fileTag: '', settings: defaultSettings() })
export const useReportMeta = () => useContext(ReportMetaContext)

const ALL_METHODS: PaymentMethod[] = ['cash', 'card', 'upi', 'credit', 'voucher', 'loyalty', 'bank', 'other']

/**
 * Payment methods in a stable order (the shop's enabled methods first). Colour slots follow
 * this order so a method keeps its colour regardless of the period or its rank.
 */
export function methodOrder(settings: Settings): PaymentMethod[] {
  const enabled = settings.enabledPayments.filter((m) => ALL_METHODS.includes(m))
  return [...enabled, ...ALL_METHODS.filter((m) => !enabled.includes(m))]
}

export function methodColor(method: PaymentMethod, order: PaymentMethod[]): string {
  const i = order.indexOf(method)
  return SLOTS[(i < 0 ? order.length : i) % SLOTS.length]
}

/** Human label for a terminal: this till's name, otherwise the code from document numbers. */
export function terminalLabel(deviceId: string, code: string): string {
  const d = device()
  if (deviceId === d.deviceId) return code && code !== d.terminalName ? `${d.terminalName} (${code})` : d.terminalName
  return code || deviceId.slice(0, 6).toUpperCase()
}

export interface TabProps {
  data: import('./useReport').ReportData
  report: import('./useReport').ReportState
}
