import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import type { Payment, PaymentMethod, Sale } from '@/core/types'
import { parseDecimal } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Badge, Button, type ButtonVariant } from '@/components/ui'
import { METHOD_ICONS } from '@/features/sell/PaymentDialog'
import { whatsAppNumber } from '@/features/sell/ReceiptDialog'
import type { RefundState } from './query'

// Small building blocks shared by the sales history and customer screens.

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Opens WhatsApp with `text`; local numbers get the shop's calling code (see whatsAppNumber). */
export function openWhatsApp(phone: string | undefined, text: string) {
  window.open(`https://wa.me/${whatsAppNumber(phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

export function PaymentIcons({ payments, className }: { payments: Payment[]; className?: string }) {
  const { t } = useTranslation('sales')
  const methods = [...new Set(payments.map((p) => p.method))]
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {methods.map((m) => {
        const Icon = METHOD_ICONS[m] ?? METHOD_ICONS.other
        const label = t(`common:payment.${m}`)
        return (
          <span key={m} role="img" aria-label={label} title={label} className="flex size-6 items-center justify-center rounded-md bg-surface-3 text-muted">
            <Icon className="size-3.5" />
          </span>
        )
      })}
    </span>
  )
}

export function MethodLabel({ method }: { method: PaymentMethod }) {
  const { t } = useTranslation('sales')
  const Icon = METHOD_ICONS[method] ?? METHOD_ICONS.other
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-4 text-muted" />
      {t(`common:payment.${method}`)}
    </span>
  )
}

export function SaleBadges({ sale, refund }: { sale: Sale; refund?: RefundState }) {
  const { t } = useTranslation('sales')
  return (
    <>
      {sale.type === 'refund' && <Badge tone="warning">{t('badge.refund')}</Badge>}
      {sale.status === 'voided' && <Badge tone="danger">{t('badge.voided')}</Badge>}
      {sale.status === 'completed' && refund === 'partial' && <Badge tone="warning">{t('badge.partiallyRefunded')}</Badge>}
      {sale.status === 'completed' && refund === 'full' && <Badge>{t('badge.refunded')}</Badge>}
    </>
  )
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex items-center gap-2', className)}>
      <h4 className="flex-1 text-xs font-semibold tracking-wide text-muted uppercase">{children}</h4>
      {action}
    </div>
  )
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Button that opens a small dropdown of actions (export options and the like). */
export function MenuButton({ label, icon, items, variant = 'secondary', className }: { label: ReactNode; icon?: ReactNode; items: MenuItem[]; variant?: ButtonVariant; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  return (
    <div ref={ref} className={cn('relative', className)}>
      <Button variant={variant} icon={icon} iconRight={<ChevronDown className="size-4 opacity-60" />} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <div role="menu" className="animate-pop absolute end-0 top-full z-30 mt-1.5 w-max max-w-[calc(100vw-2rem)] min-w-56 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-pop">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              className={cn(
                'flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start text-sm font-medium hover:bg-surface-3 disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
                item.danger ? 'text-danger' : '[&>svg]:text-muted',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Touch-friendly − value + control. Accepts typed decimals for weighed items unless `integer`. */
export function Stepper({ value, max, onChange, disabled, label, integer }: { value: number; max: number; onChange: (v: number) => void; disabled?: boolean; label: string; integer?: boolean }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(value ? String(value) : '0'), [value])
  const clamp = (v: number) => {
    const n = Math.min(Math.max(v, 0), max)
    return integer ? Math.floor(n + 1e-9) : Math.round(n * 1000) / 1000
  }
  const commit = () => {
    const n = parseDecimal(text)
    const v = Number.isNaN(n) ? 0 : clamp(n)
    onChange(v)
    setText(String(v))
  }
  return (
    <div className={cn('flex items-center rounded-xl border border-border bg-surface', disabled && 'opacity-50')}>
      <button type="button" disabled={disabled || value <= 0} onClick={() => onChange(clamp(value - 1))} className="flex size-11 items-center justify-center rounded-s-xl text-muted hover:bg-surface-3 disabled:opacity-40" aria-label={`${label} −`}>
        <Minus className="size-4" />
      </button>
      <input
        value={text}
        disabled={disabled}
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onFocus={(e) => e.currentTarget.select()}
        className="tnum h-11 w-12 bg-transparent text-center font-semibold focus:outline-none"
      />
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(clamp(value + 1))} className="flex size-11 items-center justify-center rounded-e-xl text-muted hover:bg-surface-3 disabled:opacity-40" aria-label={`${label} +`}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

export interface TileAction {
  label: string
  icon: ReactNode
  onClick: () => void
}

/** Row of square icon-over-label buttons (print / WhatsApp / share …); labels never squeeze the icon out. */
export function ActionTiles({ actions, cols = Math.min(actions.length, 4), className }: { actions: TileAction[]; cols?: number; className?: string }) {
  return (
    <div className={cn('grid gap-2', cols >= 4 ? 'grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2', className)}>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-1 py-2 text-xs font-medium text-fg shadow-card transition-[background,transform] hover:bg-surface-3 active:scale-[0.97] [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-muted"
        >
          {a.icon}
          <span className="w-full truncate text-center">{a.label}</span>
        </button>
      ))}
    </div>
  )
}

