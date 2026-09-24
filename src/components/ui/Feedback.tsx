import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUI } from '@/stores/ui'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Modal } from './Modal'

const toastIcon = {
  success: <CheckCircle2 className="size-5 text-success" />,
  error: <XCircle className="size-5 text-danger" />,
  warning: <AlertTriangle className="size-5 text-warning" />,
  info: <Info className="size-5 text-primary" />,
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="animate-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-start text-sm font-medium shadow-pop"
        >
          {toastIcon[t.kind]}
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  )
}

export function ConfirmHost() {
  const { t } = useTranslation()
  const req = useUI((s) => s.confirm)
  const setConfirm = useUI((s) => s.setConfirm)
  const close = (ok: boolean) => {
    req?.resolve(ok)
    setConfirm(null)
  }
  return (
    <Modal
      open={!!req}
      onClose={() => close(false)}
      title={req?.title}
      size="sm"
      footer={
        <>
          <Button onClick={() => close(false)}>{t('cancel')}</Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {req?.confirmLabel ?? t('confirm')}
          </Button>
        </>
      }
    >
      {req?.message && <div className="text-sm text-muted">{req.message}</div>}
    </Modal>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-6 animate-spin text-primary', className)} />
}

export function FullScreenLoader({ label }: { label?: string }) {
  const [show, setShow] = useState(false)
  // Avoid flashing a spinner for fast loads.
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(id)
  }, [])
  return (
    <div className="flex h-full items-center justify-center bg-bg">
      {show && (
        <div className="flex flex-col items-center gap-3 text-muted">
          <Spinner className="size-8" />
          {label && <span className="text-sm">{label}</span>}
        </div>
      )}
    </div>
  )
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-surface-3 text-subtle [&>svg]:size-7">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
