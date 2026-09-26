import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock, Menu, MoreHorizontal } from 'lucide-react'
import { navigate, useRoute } from '@/router'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { cn } from '@/lib/cn'
import { Avatar, Modal } from '@/components/ui'
import { NAV } from './nav'
import { SyncIndicator } from './SyncIndicator'
import { ShiftBadge } from './ShiftBadge'

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const route = useRoute()
  const user = useSession((s) => s.user)
  const can = useSession((s) => s.can)
  const logout = useSession((s) => s.logout)
  const businessName = useSettings((s) => s.settings.businessName)
  const [more, setMore] = useState(false)
  const items = NAV.filter((n) => can(n.permission))
  const primary = items.filter((n) => n.primary).slice(0, 4)
  const secondary = items.filter((n) => !primary.includes(n))

  return (
    <div className="flex h-full min-h-0">
      {/* Tablet / desktop rail */}
      <aside className="hidden w-[100px] shrink-0 flex-col items-center border-e border-border bg-surface py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:flex">
        <button onClick={() => navigate('sell')} className="mb-3 rounded-2xl shadow-card" title={businessName} aria-label={t('nav.sell')}>
          <img src="./icons/icon.svg" alt="" className="size-11" />
        </button>
        <nav aria-label={t('menu')} className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5">
          {items.map((n) => {
            const active = route.name === n.route
            const Icon = n.icon
            return (
              <button
                key={n.route}
                onClick={() => navigate(n.route)}
                className={cn(
                  'flex w-full flex-col items-center gap-1 rounded-xl px-0.5 py-2 text-[11px] font-medium transition-colors',
                  active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-3 hover:text-fg',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="size-5.5" strokeWidth={active ? 2.3 : 1.8} />
                <span className="line-clamp-2 w-full text-center leading-tight break-words hyphens-auto">{t(n.labelKey)}</span>
              </button>
            )
          })}
        </nav>
        <div className="flex flex-col items-center gap-2 pt-2">
          <SyncIndicator compact />
          <button onClick={logout} title={t('lock')} className="group relative" aria-label={t('lock')}>
            <Avatar name={user?.name ?? '?'} color={user?.color} size="sm" />
            <span className="absolute -end-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full border border-border bg-surface">
              <Lock className="size-2.5" />
            </span>
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">
        {/* Phone header */}
        <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))] md:hidden">
          <button onClick={() => setMore(true)} className="flex size-9 items-center justify-center rounded-lg hover:bg-surface-3" aria-label={t('menu')}>
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1 truncate font-semibold">{businessName}</div>
          <ShiftBadge />
          <SyncIndicator compact />
          <button onClick={logout} aria-label={t('lock')}>
            <Avatar name={user?.name ?? '?'} color={user?.color} size="sm" />
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </main>

      {/* Phone bottom bar */}
      <nav aria-label={t('menu')} className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur md:hidden">
        {primary.map((n) => {
          const active = route.name === n.route
          const Icon = n.icon
          return (
            <button key={n.route} onClick={() => navigate(n.route)} aria-current={active ? 'page' : undefined} className={cn('flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', active ? 'text-primary' : 'text-muted')}>
              <Icon className="size-5.5" strokeWidth={active ? 2.3 : 1.8} />
              <span className="max-w-full truncate px-1">{t(n.labelKey)}</span>
            </button>
          )
        })}
        {secondary.length > 0 && (
          <button onClick={() => setMore(true)} className={cn('flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', secondary.some((n) => n.route === route.name) ? 'text-primary' : 'text-muted')}>
            <MoreHorizontal className="size-5.5" />
            <span className="max-w-full truncate px-1">{t('nav.more')}</span>
          </button>
        )}
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title={businessName} size="sm">
        <div className="grid grid-cols-3 gap-2">
          {items.map((n) => {
            const Icon = n.icon
            return (
              <button
                key={n.route}
                onClick={() => {
                  navigate(n.route)
                  setMore(false)
                }}
                className={cn('flex flex-col items-center gap-2 rounded-2xl border border-border p-4 text-xs font-medium', route.name === n.route ? 'bg-primary-soft text-primary' : 'bg-surface-2')}
              >
                <Icon className="size-6" />
                {t(n.labelKey)}
              </button>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
