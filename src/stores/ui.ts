import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { Permission } from '@/core/types'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

export interface PromptRequest {
  title: string
  message?: ReactNode
  label: string
  type?: 'text' | 'password'
  confirmLabel?: string
  resolve: (value: string | null) => void
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
  prompt: PromptRequest | null
  override: OverrideRequest | null
  sidebarCollapsed: boolean
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void
  dismiss: (id: number) => void
  setConfirm: (c: ConfirmRequest | null) => void
  setPrompt: (p: PromptRequest | null) => void
  setOverride: (o: OverrideRequest | null) => void
  toggleSidebar: () => void
}

let nextId = 1

export const useUI = create<UIStore>((set, get) => ({
  toasts: [],
  confirm: null,
  prompt: null,
  override: null,
  sidebarCollapsed: false,
  toast: (message, kind = 'success', action) => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-3), { id, kind, message, action }] })
    setTimeout(() => get().dismiss(id), action ? 6000 : kind === 'error' ? 5000 : 2600)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setConfirm: (confirm) => set({ confirm }),
  setPrompt: (prompt) => set({ prompt }),
  setOverride: (override) => set({ override }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
}))

export const toast = (message: string, kind?: ToastKind, action?: ToastAction) => useUI.getState().toast(message, kind, action)

/** Asks for a line of text (e.g. a passphrase). Resolves null when cancelled. */
export function promptDialog(opts: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useUI.getState().setPrompt({ ...opts, resolve }))
}

export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useUI.getState().setConfirm({ ...opts, resolve }))
}
