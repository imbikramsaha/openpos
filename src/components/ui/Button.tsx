import type { ComponentProps, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'soft' | 'danger' | 'success' | 'warning'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'icon' | 'icon-sm' | 'icon-lg'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border border-border hover:border-border-strong hover:bg-surface-2',
  outline: 'border border-border-strong text-fg hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-3',
  soft: 'bg-surface-3 text-fg hover:bg-border',
  // Dark mode uses bright fills, which need dark text to stay readable.
  danger: 'bg-danger text-white dark:text-bg hover:brightness-110',
  success: 'bg-success text-white dark:text-bg hover:brightness-110',
  warning: 'bg-warning text-white dark:text-bg hover:brightness-110',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
  xl: 'h-16 px-6 text-lg gap-3 rounded-2xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
  'icon-lg': 'h-12 w-12 rounded-xl',
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  /** Full width. Buttons never shrink, so next to other buttons in a row use className="flex-1" instead. */
  block?: boolean
}

export function Button({ variant = 'secondary', size = 'md', loading, icon, iconRight, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium tracking-[-0.01em] whitespace-nowrap [&>svg]:shrink-0 transition-[background,border-color,filter,transform,color] duration-100 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  )
}
