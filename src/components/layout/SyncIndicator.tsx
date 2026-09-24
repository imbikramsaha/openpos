import { Cloud, CloudOff, RefreshCw, WifiOff, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSyncStatus } from '@/sync/status'
import { syncNow } from '@/sync/engine'
import { cn } from '@/lib/cn'
import { relativeTime } from '@/lib/dates'

export function SyncIndicator({ compact }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { state, online, pending, lastSync, error } = useSyncStatus()
  const effective = !online ? 'offline' : state
  const map = {
    disabled: { icon: CloudOff, cls: 'text-subtle', label: t('sync.local') },
    offline: { icon: WifiOff, cls: 'text-warning', label: t('sync.offline') },
    idle: { icon: Cloud, cls: 'text-success', label: t('sync.synced') },
    syncing: { icon: RefreshCw, cls: 'text-primary animate-spin', label: t('sync.syncing') },
    error: { icon: AlertCircle, cls: 'text-danger', label: t('sync.error') },
  }[effective]
  const Icon = map.icon
  const title = [map.label, pending ? t('sync.pending', { count: pending }) : '', lastSync ? t('sync.last', { time: relativeTime(lastSync) }) : '', error ?? '']
    .filter(Boolean)
    .join(' · ')
  return (
    <button
      onClick={() => state !== 'disabled' && void syncNow()}
      title={title}
      aria-label={title}
      className={cn('flex items-center gap-1.5 rounded-lg text-xs font-medium text-muted hover:bg-surface-3', compact ? 'size-10 justify-center' : 'px-2 py-1.5')}
    >
      <Icon className={cn('size-4.5', map.cls)} />
      {!compact && <span>{map.label}</span>}
      {pending > 0 && effective !== 'disabled' && <span className="rounded-full bg-warning-soft px-1.5 text-[10px] text-warning">{pending}</span>}
    </button>
  )
}
