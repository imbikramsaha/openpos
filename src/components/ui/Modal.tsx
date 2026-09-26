import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

// Centered dialog on tablets/desktops, bottom sheet on phones.
// A module-level stack makes Escape (and the Tab focus trap) apply only to the top-most dialog.

const stack: number[] = []
let counter = 0

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Shared dialog behaviour: Escape closes the top-most dialog, focus moves into the dialog when it
 * opens, Tab/Shift+Tab stay inside it, and focus returns to the opener when it closes.
 */
function useDialog(open: boolean, onClose: () => void, dismissible: boolean, panel: RefObject<HTMLDivElement | null>) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useEffect(() => {
    if (!open) return
    const id = ++counter
    stack.push(id)
    const prevFocus = document.activeElement as HTMLElement | null
    // Children that autofocus a field have already done so; otherwise focus the dialog itself.
    if (panel.current && !panel.current.contains(document.activeElement)) panel.current.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') {
        if (!dismissibleRef.current) return
        e.stopPropagation()
        onCloseRef.current()
      } else if (e.key === 'Tab' && panel.current) {
        const root = panel.current
        const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
        const active = document.activeElement
        if (!items.length) {
          e.preventDefault()
          root.focus()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey ? active === first || active === root || !root.contains(active) : active === last || !root.contains(active)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true })
    }
  }, [open, panel])
}

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
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(open, onClose, dismissible, panel)

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => dismissible && onClose()} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'animate-sheet sm:animate-pop relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-pop outline-none sm:rounded-2xl',
          widths[size],
          className,
        )}
      >
        {(title || dismissible) && (
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1">
              {title && <h2 id={titleId} className="line-clamp-2 text-lg font-semibold break-words">{title}</h2>}
              {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
            </div>
            {dismissible && (
              <button onClick={onClose} aria-label={t('close')} className="-me-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-fg">
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', !flush && 'p-5')}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
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
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useDialog(open, onClose, true, panel)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40 flex">
      <div className="animate-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn('animate-pop relative flex h-full w-full flex-col border-border bg-surface shadow-pop outline-none', width, side === 'end' ? 'ms-auto border-s' : 'me-auto border-e')}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 pt-[calc(1rem+env(safe-area-inset-top))]">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('close')} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-2 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
