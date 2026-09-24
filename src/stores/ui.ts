import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { Permission } from '@/core/types'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface ConfirmRequest {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface OverrideRequest {
  permission: Permission
  resolve: (approvedBy: { id: string; name: string } | null) => void
}

interface UIStore {
  toasts: Toast[]
  confirm: ConfirmRequest | null
  override: OverrideRequest | null
  sidebarCollapsed: boolean
  toast: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
  setConfirm: (c: ConfirmRequest | null) => void
  setOverride: (o: OverrideRequest | null) => void
  toggleSidebar: () => void
}

let nextId = 1

export const useUI = create<UIStore>((set, get) => ({
  toasts: [],
  confirm: null,
  override: null,
  sidebarCollapsed: false,
  toast: (message, kind = 'success') => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 5000 : 2600)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setConfirm: (confirm) => set({ confirm }),
  setOverride: (override) => set({ override }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
}))

export const toast = (message: string, kind?: ToastKind) => useUI.getState().toast(message, kind)

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useUI.getState().setConfirm({ ...opts, resolve }))
}
