import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MoreVertical } from 'lucide-react'
import type { Product } from '@/core/types'
import { formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button, Modal, Sheet } from '@/components/ui'
import { SWATCHES, stockStatus, useIsPhone } from './util'

// Small building blocks shared by the Products and Stock screens.

/** Side sheet on tablets/desktops, full-height bottom modal on phones. */
export function ResponsivePanel({ open, onClose, title, footer, children, width = 'sm:w-[560px]' }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  footer?: ReactNode
  children: ReactNode
  width?: string
}) {
  const phone = useIsPhone()
  if (phone) {
    return (
      <Modal open={open} onClose={onClose} title={title} footer={footer} size="lg" className="h-[94dvh]">
        {children}
      </Modal>
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title={title} footer={footer} width={width}>
      {children}
    </Sheet>
  )
}

/** Product image, or a tinted tile with the product's initial in its (category) colour. */
export function ProductThumb({ product, color, size = 'md' }: { product: Pick<Product, 'name' | 'image'>; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const box = { sm: 'size-8 rounded-lg text-xs', md: 'size-10 rounded-xl text-sm', lg: 'size-16 rounded-2xl text-xl' }[size]
  if (product.image) return <img src={product.image} alt="" loading="lazy" draggable={false} className={cn(box, 'shrink-0 bg-surface-3 object-cover')} />
  const initial = [...(product.name.trim() || '?')][0].toUpperCase()
  return (
    <span
      aria-hidden
      className={cn(box, 'flex shrink-0 items-center justify-center font-bold', !color && 'bg-surface-3 text-subtle')}
      style={color ? { background: `${color}26`, color } : undefined}
    >
      {initial}
    </span>
  )
}

/** Stock level coloured by status (red = out, amber = low). */
export function StockQty({ product, className }: { product: Pick<Product, 'trackStock' | 'stock' | 'reorderLevel' | 'unit'>; className?: string }) {
  const { t } = useTranslation('products')
  const status = stockStatus(product)
  if (status === 'untracked') return <span className={cn('text-xs text-subtle', className)}>{t('stock.untracked')}</span>
  return (
    <span
      className={cn(
        'tnum inline-flex items-center rounded-md px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap',
        status === 'out' ? 'bg-danger-soft text-danger' : status === 'low' ? 'bg-warning-soft text-warning' : 'text-fg',
        className,
      )}
    >
      {formatQty(product.stock)}
      {product.unit !== 'pcs' && <span className="ms-1 text-xs font-medium opacity-80">{t(`common:unit.${product.unit}`)}</span>}
    </span>
  )
}

export function ColorSwatches({ value, onChange, allowNone, className }: { value?: string; onChange: (c: string | undefined) => void; allowNone?: boolean; className?: string }) {
  const { t } = useTranslation('products')
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="radiogroup">
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          aria-label={t('editor.noColor')}
          title={t('editor.noColor')}
          onClick={() => onChange(undefined)}
          className={cn('relative size-9 rounded-full border-2 border-dashed border-border-strong bg-surface', !value && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
        >
          <span className="absolute inset-x-1.5 top-1/2 h-0.5 -rotate-45 bg-border-strong" />
        </button>
      )}
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cn('flex size-9 items-center justify-center rounded-full transition-transform active:scale-90', value === c && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')}
          style={{ background: c }}
        >
          {value === c && <Check className="size-4 text-white" strokeWidth={3} />}
        </button>
      ))}
    </div>
  )
}

/** Checkbox with an indeterminate state and a comfortable touch target. */
export function TickBox({ checked, indeterminate, onChange, label, className }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <label className={cn('-m-2 flex cursor-pointer items-center justify-center p-2', className)} onClick={(e) => e.stopPropagation()}>
      <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4.5 cursor-pointer accent-[var(--primary)]" />
    </label>
  )
}

export interface MenuItem {
  icon: ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

/** Overflow ("⋮") menu. */
export function ActionMenu({ items, label, className, trigger }: { items: MenuItem[]; label: string; className?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger ? (
        <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      ) : (
        <Button size="icon" variant="secondary" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <MoreVertical className="size-5" />
        </Button>
      )}
      {open && (
        <div className="animate-pop absolute end-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-pop" role="menu">
          {items
            .filter((i) => !i.hidden)
            .map((i) => (
              <button
                key={i.label}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  i.onClick()
                }}
                className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-surface-3 [&>svg]:size-4.5 [&>svg]:shrink-0', i.danger && 'text-danger')}
              >
                {i.icon}
                <span className="flex-1">{i.label}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

/** Label + value block used in detail panels. */
export function Metric({ label, value, tone, className }: { label: ReactNode; value: ReactNode; tone?: 'danger' | 'warning' | 'success'; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-surface-2 px-3 py-2.5', className)}>
      <div className="truncate text-xs font-medium text-muted">{label}</div>
      <div className={cn('tnum truncate text-base font-semibold', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')}>{value}</div>
    </div>
  )
}

/** A titled group of form fields. */
export function FormSection({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-4', className)}>
      {title && <h3 className="text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h3>}
      {children}
    </section>
  )
}
