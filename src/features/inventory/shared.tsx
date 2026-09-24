import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import type { StockMovementType } from '@/core/types'
import { formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Badge, type Tone } from '@/components/ui'
import { soldSince } from './service'

const TYPE_TONE: Record<StockMovementType, Tone> = {
  sale: 'neutral',
  refund: 'warning',
  void: 'warning',
  purchase: 'success',
  adjustment: 'primary',
  count: 'primary',
  initial: 'neutral',
  waste: 'danger',
}

export function TypeBadge({ type }: { type: StockMovementType }) {
  const { t } = useTranslation('inventory')
  return <Badge tone={TYPE_TONE[type]}>{t(`type.${type}`)}</Badge>
}

/** Signed quantity: green for stock in, red for stock out. */
export function QtyDelta({ qty, className }: { qty: number; className?: string }) {
  return (
    <span className={cn('tnum font-semibold whitespace-nowrap', qty > 0 ? 'text-success' : qty < 0 ? 'text-danger' : 'text-muted', className)}>
      {qty > 0 ? '+' : qty < 0 ? '−' : ''}
      {formatQty(Math.abs(qty))}
    </span>
  )
}

/** Net units sold per product over the last 30 days (live). */
export function useSold30() {
  return useLiveQuery(() => soldSince(30), [])
}
