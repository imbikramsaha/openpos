import { Delete } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface NumPadProps {
  onKey: (key: string) => void
  /** Show the decimal key. */
  decimal?: boolean
  className?: string
  size?: 'md' | 'lg'
  extra?: { label: string; key: string }
}

export function NumPad({ onKey, decimal = true, className, size = 'lg', extra }: NumPadProps) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? '.' : extra ? extra.key : '', '0', 'back']
  return (
    <div className={cn('grid auto-rows-fr grid-cols-3 gap-2', className)}>
      {keys.map((k, i) =>
        k === '' ? (
          <span key={`gap-${i}`} />
        ) : (
          <button
            key={k}
            type="button"
            onClick={() => onKey(k)}
            className={cn(
              'tnum flex items-center justify-center rounded-xl border border-border bg-surface font-semibold text-fg shadow-card transition active:scale-95 active:bg-surface-3',
              size === 'lg' ? 'min-h-14 text-xl' : 'min-h-11 text-lg',
            )}
            aria-label={k === 'back' ? 'Backspace' : k}
          >
            {k === 'back' ? <Delete className="size-5" /> : !decimal && extra && k === extra.key ? extra.label : k}
          </button>
        ),
      )}
    </div>
  )
}

/** Applies a numpad key to a text value. */
export function applyNumKey(value: string, key: string, maxDecimals = 3): string {
  if (key === 'back') return value.slice(0, -1)
  if (key === 'clear') return ''
  if (key === '.') return value.includes('.') ? value : (value || '0') + '.'
  const dot = value.indexOf('.')
  if (dot >= 0 && value.length - dot > maxDecimals) return value
  if (value === '0') return key
  return value + key
}
