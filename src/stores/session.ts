import { create } from 'zustand'
import type { Permission, Shift, User } from '@/core/types'
import { can } from '@/core/permissions'
import { setActor } from '@/db/repo'

interface SessionStore {
  user: User | null
  shift: Shift | null
  lastActivity: number
  login: (u: User) => void
  logout: () => void
  setShift: (s: Shift | null) => void
  touch: () => void
  can: (p: Permission) => boolean
}

export const useSession = create<SessionStore>((set, get) => ({
  user: null,
  shift: null,
  lastActivity: Date.now(),
  login: (user) => {
    setActor({ id: user.id, name: user.name })
    set({ user, lastActivity: Date.now() })
  },
  logout: () => {
    setActor(null)
    set({ user: null })
  },
  setShift: (shift) => set({ shift }),
  touch: () => set({ lastActivity: Date.now() }),
  can: (p) => can(get().user, p),
}))

export const session = () => useSession.getState()
