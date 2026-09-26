import { useId, type ReactNode } from 'react'
import { AlertTriangle, Info, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Card, Toggle } from '@/components/ui'

// Building blocks shared by every settings section.

export function Group({ title, description, actions, children, footer, className, tone }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  tone?: 'danger'
}) {
  return (
    <Card className={cn('overflow-hidden', tone === 'danger' && 'border-danger/40', className)}>
      {(title || actions) && (
        <div className={cn('flex flex-wrap items-start gap-3 border-b border-border px-4 py-3.5 sm:px-5', tone === 'danger' && 'bg-danger-soft')}>
          <div className="min-w-0 flex-1">
            {title && <h3 className={cn('font-semibold', tone === 'danger' && 'text-danger')}>{title}</h3>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="divide-y divide-border">{children}</div>
      {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3 sm:px-5">{footer}</div>}
    </Card>
  )
}

/** One setting. `id` is the search anchor (and the i18n label key). */
export function Row({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <div data-setting={id} className={cn('px-4 py-3.5 transition-[background-color,box-shadow] duration-500 sm:px-5', className)}>
      {children}
    </div>
  )
}

export function ToggleRow({ id, label, description, checked, onChange, disabled }: {
  id?: string
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <Row id={id} className="min-h-[60px]">
      <Toggle checked={checked} onChange={onChange} label={label} description={description} disabled={disabled} />
    </Row>
  )
}

/** Label + description on the start side, control on the end side (stacks on phones). */
export function ControlRow({ id, label, description, children, stack }: { id?: string; label: ReactNode; description?: ReactNode; children: ReactNode; stack?: boolean }) {
  // The control sits in a group named by the row's label, so screen readers announce what it sets.
  const labelId = useId()
  const descId = useId()
  return (
    <Row id={id}>
      <div className={cn('flex gap-3', stack ? 'flex-col' : 'flex-col sm:flex-row sm:items-center')}>
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-sm font-medium">
            {label}
          </div>
          {description && (
            <div id={descId} className="text-xs text-subtle">
              {description}
            </div>
          )}
        </div>
        <div role="group" aria-labelledby={labelId} aria-describedby={description ? descId : undefined} className={cn('min-w-0', !stack && 'sm:shrink-0')}>
          {children}
        </div>
      </div>
    </Row>
  )
}

const noticeTone = {
  info: { cls: 'border-primary/25 bg-primary-soft text-fg', icon: <Info className="size-5 text-primary" /> },
  warning: { cls: 'border-warning/30 bg-warning-soft text-fg', icon: <AlertTriangle className="size-5 text-warning" /> },
  danger: { cls: 'border-danger/30 bg-danger-soft text-fg', icon: <ShieldAlert className="size-5 text-danger" /> },
  success: { cls: 'border-success/30 bg-success-soft text-fg', icon: <CheckCircle2 className="size-5 text-success" /> },
}

export function Notice({ tone = 'info', title, children, action, className }: { tone?: keyof typeof noticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const s = noticeTone[tone]
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center', s.cls, className)}>
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5 shrink-0">{s.icon}</span>
        <div className="min-w-0 text-sm">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className={cn(title && 'mt-0.5', 'text-muted')}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2 sm:ms-auto">{action}</div>}
    </div>
  )
}

/** Wrapping radio group of chips — used where a Segmented control would overflow on phones. */
export function ChoiceChips<T extends string | number>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: ReactNode }>
  label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'tnum h-10 min-w-12 rounded-xl border px-3.5 text-sm font-medium transition-colors',
              on ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg hover:bg-surface-3',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-5', className)}>{children}</div>
}
