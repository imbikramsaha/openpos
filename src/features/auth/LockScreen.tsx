import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft } from 'lucide-react'
import type { User } from '@/core/types'
import { db } from '@/db/db'
import { audit } from '@/db/repo'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { Avatar } from '@/components/ui'
import { LanguagePicker } from '@/components/LanguagePicker'
import { formatDate, formatTime } from '@/lib/dates'
import { PinPad } from './PinPad'
import { verifyPin } from './users'

export function LockScreen() {
  const { t } = useTranslation('auth')
  const login = useSession((s) => s.login)
  const businessName = useSettings((s) => s.settings.businessName)
  const users = useLiveQuery(async () => (await db.users.toArray()).filter((u) => u.active && !u.deleted).sort((a, b) => a.name.localeCompare(b.name)), [])
  const [selected, setSelected] = useState<User | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!users) return
    if (users.length === 1) setSelected(users[0])
    // The picked user was deactivated or deleted (e.g. from another terminal): back to the list.
    else setSelected((cur) => (cur && users.some((u) => u.id === cur.id) ? cur : null))
  }, [users])

  const tryPin = (pin: string) => {
    // With no user picked, the PIN alone identifies the user (PINs are unique). Always check
    // against the live record so a PIN changed elsewhere takes effect immediately.
    const current = selected && users?.find((u) => u.id === selected.id)
    const candidates = current ? [current] : selected ? [] : users ?? []
    const match = candidates.find((u) => verifyPin(u, pin))
    if (match) {
      login(match)
      void audit('login', 'user', match.id)
      return true
    }
    return false
  }

  return (
    <div className="safe-top safe-bottom flex h-full flex-col bg-bg">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <img src="./icons/icon.svg" alt="" className="size-9" />
          <span className="font-semibold">{businessName}</span>
        </div>
        <LanguagePicker compact />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 pb-8 lg:flex-row lg:gap-20">
        <div className="text-center lg:text-start">
          <div className="tnum text-5xl font-bold tracking-tight lg:text-7xl">{formatTime(now)}</div>
          <div className="mt-1 text-muted">{formatDate(now)}</div>
        </div>
        <div className="w-full max-w-sm rounded-3xl border border-border bg-surface p-6 shadow-pop">
          {selected ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                {(users?.length ?? 0) > 1 && (
                  <button onClick={() => setSelected(null)} className="flex size-9 items-center justify-center rounded-lg hover:bg-surface-3" aria-label={t('switchUser')}>
                    <ArrowLeft className="size-5 rtl:rotate-180" />
                  </button>
                )}
                <Avatar name={selected.name} color={selected.color} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{selected.name}</div>
                  <div className="text-sm text-muted">{t('enterPin')}</div>
                </div>
              </div>
              <PinPad onPin={tryPin} />
            </>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-semibold">{t('whoIsWorking')}</h2>
              <p className="mb-4 text-sm text-muted">{t('pickUserOrPin')}</p>
              <div className="mb-5 grid max-h-64 grid-cols-3 gap-3 overflow-y-auto">
                {users?.map((u) => (
                  <button key={u.id} onClick={() => setSelected(u)} className="flex flex-col items-center gap-2 rounded-2xl p-2 hover:bg-surface-3">
                    <Avatar name={u.name} color={u.color} size="lg" />
                    <span className="w-full truncate text-center text-xs font-medium">{u.name}</span>
                  </button>
                ))}
              </div>
              <PinPad onPin={tryPin} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
