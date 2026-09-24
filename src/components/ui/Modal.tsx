import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

// Centered dialog on tablets/desktops, bottom sheet on phones.
// A module-level stack makes Escape close only the top-most dialog.

const stack: number[] = []
let counter = 0

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  /** Removes body padding for edge-to-edge content. */
  flush?: boolean
  dismissible?: boolean
  className?: string
}

const widths = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-[min(96vw,1400px)] sm:h-[92vh]',
}

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', flush, dismissible = true, className }: ModalProps) {
  const { t } = useTranslation()
  const id = useRef(0)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    id.current = ++counter
    stack.push(id.current)
    const prevFocus = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible && stack[stack.length - 1] === id.current) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const i = stack.indexOf(id.current)
      if (i >= 0) stack.splice(i, 1)
      prevFocus?.focus?.()
    }
  }, [open, dismissible])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => dismissible && onClose()} />
      <div
        className={cn(
          'animate-sheet sm:animate-pop relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-pop sm:rounded-2xl',
          widths[size],
          className,
        )}
      >
        {(title || dismissible) && (
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <h2 className="truncate text-lg font-semibold">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {dismissible && (
              <button onClick={onClose} aria-label={t('close')} className="-me-1 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', !flush && 'p-5')}>{children}</div>
        {footer && <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  side?: 'end' | 'start'
  width?: string
}

/** Side panel used for detail views and forms on large screens. */
export function Sheet({ open, onClose, title, children, footer, side = 'end', width = 'sm:w-[480px]' }: SheetProps) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && stack.length === 0 && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn('animate-pop relative flex h-full w-full flex-col border-border bg-surface shadow-pop', width, side === 'end' ? 'ms-auto border-s' : 'me-auto border-e')}>
        <div className="safe-top flex items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('close')} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="safe-bottom flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
