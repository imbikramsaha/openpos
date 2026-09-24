import { useTranslation } from 'react-i18next'
import { navigate } from '@/router'
import { useSession } from '@/stores/session'
import { cn } from '@/lib/cn'

export function ShiftBadge({ className }: { className?: string }) {
  const { t } = useTranslation()
  const shift = useSession((s) => s.shift)
  return (
    <button
      onClick={() => navigate('shifts')}
      className={cn('flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium', className)}
      title={shift ? t('shift.open') : t('shift.closed')}
    >
      <span className={cn('size-2 rounded-full', shift ? 'bg-success' : 'bg-subtle')} />
      <span className="hidden sm:inline">{shift ? t('shift.open') : t('shift.closed')}</span>
    </button>
  )
}
