import type { ComponentProps, ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/money'

export type Tone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-muted',
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)}>{children}</span>
}

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-2xl border border-border bg-surface', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 border-b border-border px-5 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold tracking-tight">{title}</h3>
        {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Stat({ label, value, hint, icon, tone = 'primary', className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center gap-3">
        {icon && <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5', tones[tone])}>{icon}</div>}
        <div className="min-w-0">
          <div className="line-clamp-2 text-xs font-medium break-words text-muted">{label}</div>
          <div className="tnum truncate text-xl font-semibold tracking-tight">{value}</div>
        </div>
      </div>
      {hint && <div className="mt-2 text-xs text-subtle">{hint}</div>}
    </Card>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-medium text-subtle lg:inline-block', className)}>{children}</kbd>
}

// Deep, muted tones: white initials stay above 4.5:1 on every one.
const avatarColors = ['#3f3f46', '#0e7490', '#15803d', '#b45309', '#b91c1c', '#6d28d9', '#be185d', '#1d4ed8']

export function Avatar({ name, color, size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join('').toUpperCase() || '?'
  const bg = color || avatarColors[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarColors.length]
  const sz = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' }[size]
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white', sz)} style={{ background: bg }}>
      {initials}
    </span>
  )
}

export interface SearchInputProps extends Omit<ComponentProps<'input'>, 'onChange'> {
  value: string
  onChange: (v: string) => void
  right?: ReactNode
}

export function SearchInput({ value, onChange, className, right, placeholder, ...rest }: SearchInputProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute start-3 size-4.5 text-subtle" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('search')}
        className={cn(
          'h-11 w-full rounded-xl border border-border bg-surface ps-10 text-fg placeholder:text-subtle focus:border-primary focus:ring-4 focus:ring-[var(--ring)] focus:outline-none [&::-webkit-search-cancel-button]:hidden',
          // Room for the clear button / extra controls only when they are shown, so long placeholders fit.
          right ? 'pe-20' : value ? 'pe-11' : 'pe-3',
        )}
        {...rest}
      />
      <div className="absolute end-1.5 flex items-center gap-1">
        {value && (
          <button type="button" onClick={() => onChange('')} aria-label={t('clear')} className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-surface-3">
            <X className="size-4" />
          </button>
        )}
        {right}
      </div>
    </div>
  )
}

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  icon?: ReactNode
  count?: number
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: TabItem<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-border', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === value}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors [&>svg]:size-4',
            tab.id === value ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count !== undefined && <span className="tnum rounded-full bg-surface-3 px-1.5 text-xs text-muted">{formatNumber(tab.count)}</span>}
        </button>
      ))}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px bg-border', className)} />
}

export function KeyValue({ label, value, strong, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1 text-sm', strong && 'text-base font-semibold', className)}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span className="tnum text-end">{value}</span>
    </div>
  )
}
