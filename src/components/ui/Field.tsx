import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { fromMinor, parseDecimal, toMinor } from '@/lib/money'

const control =
  'w-full rounded-xl border border-border bg-surface px-3 text-fg placeholder:text-subtle transition-colors focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)] disabled:opacity-60'

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-sm font-medium text-muted', className)}>
      {children}
    </label>
  )
}

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {children(id)}
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  )
}

export interface InputProps extends ComponentProps<'input'> {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  left?: ReactNode
  right?: ReactNode
  wrapperClassName?: string
}

export function Input({ label, hint, error, left, right, className, wrapperClassName, ...rest }: InputProps) {
  const input = (id?: string) => (
    <div className="relative flex items-center">
      {left && <span className="pointer-events-none absolute start-3 flex text-subtle">{left}</span>}
      <input id={id} className={cn(control, 'h-11', left && 'ps-10', right && 'pe-10', error && 'border-danger', className)} {...rest} />
      {right && <span className="absolute end-2 flex">{right}</span>}
    </div>
  )
  if (!label && !hint && !error) return <div className={wrapperClassName}>{input(rest.id)}</div>
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName}>
      {(id) => input(rest.id ?? id)}
    </Field>
  )
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  label?: ReactNode
  hint?: ReactNode
  wrapperClassName?: string
}

export function Textarea({ label, hint, className, wrapperClassName, ...rest }: TextareaProps) {
  return (
    <Field label={label} hint={hint} className={wrapperClassName}>
      {(id) => <textarea id={id} rows={3} className={cn(control, 'py-2.5', className)} {...rest} />}
    </Field>
  )
}

export interface SelectProps extends ComponentProps<'select'> {
  label?: ReactNode
  hint?: ReactNode
  options: Array<{ value: string; label: string }>
  placeholder?: string
  wrapperClassName?: string
}

export function Select({ label, hint, options, placeholder, className, wrapperClassName, ...rest }: SelectProps) {
  const select = (id?: string) => (
    <select id={id} className={cn(control, 'h-11 appearance-none bg-[length:16px] bg-[position:right_0.75rem_center] bg-no-repeat pe-9 rtl:bg-[position:left_0.75rem_center]', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a91a6' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
  if (!label && !hint) return <div className={wrapperClassName}>{select(rest.id)}</div>
  return (
    <Field label={label} hint={hint} className={wrapperClassName}>
      {(id) => select(id)}
    </Field>
  )
}

export interface MoneyInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: number | undefined
  onChange: (minor: number | undefined) => void
}

/** Text input that edits an amount in major units and reports minor units. */
export function MoneyInput({ value, onChange, ...rest }: MoneyInputProps) {
  const [text, setText] = useState(value === undefined ? '' : String(fromMinor(value)))
  useEffect(() => {
    const parsed = parseDecimal(text)
    const current = Number.isNaN(parsed) ? undefined : toMinor(parsed)
    if (current !== value) setText(value === undefined ? '' : String(fromMinor(value)))
    // Only react to external value changes.
  }, [value])
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseDecimal(e.target.value)
        onChange(Number.isNaN(n) ? undefined : toMinor(n))
      }}
      {...rest}
      className={cn('tnum', rest.className)}
    />
  )
}

export interface NumberInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: number | undefined
  onChange: (n: number | undefined) => void
}

export function NumberInput({ value, onChange, ...rest }: NumberInputProps) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    const n = parseDecimal(text)
    if ((Number.isNaN(n) ? undefined : n) !== value) setText(value === undefined ? '' : String(value))
  }, [value])
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = parseDecimal(e.target.value)
        onChange(Number.isNaN(n) ? undefined : n)
      }}
      {...rest}
      className={cn('tnum', rest.className)}
    />
  )
}

export interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Toggle({ checked, onChange, label, description, disabled, className }: ToggleProps) {
  const id = useId()
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
          {label && <div className="text-sm font-medium">{label}</div>}
          {description && <div className="text-xs text-subtle">{description}</div>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-border-strong',
        )}
      >
        <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'start-[1.375rem]' : 'start-0.5')} />
      </button>
    </div>
  )
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: ReactNode }>
  className?: string
  size?: 'sm' | 'md'
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: SegmentedProps<T>) {
  return (
    <div className={cn('inline-flex rounded-xl bg-surface-3 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 font-medium whitespace-nowrap transition-colors',
            size === 'sm' ? 'h-7 text-xs' : 'h-9 text-sm',
            value === o.value ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  )
}
