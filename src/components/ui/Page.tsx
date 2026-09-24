import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex h-full min-h-0 flex-col', className)}>{children}</div>
}

export function PageHeader({ title, subtitle, actions, onBack, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; onBack?: () => void; children?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <header className="border-b border-border bg-surface px-4 pt-4 pb-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="-ms-2 flex size-9 items-center justify-center rounded-lg hover:bg-surface-3" aria-label={t('back')}>
            <ArrowLeft className="size-5 rtl:rotate-180" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  )
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto p-4 sm:p-6', className)}>{children}</div>
}

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  align?: 'start' | 'end' | 'center'
  /** Hidden below the md breakpoint. */
  hideOnMobile?: boolean
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Compact card rendering for phones; falls back to the visible columns. */
  mobile?: (row: T) => ReactNode
  empty?: ReactNode
  footer?: ReactNode
  className?: string
}

export function DataTable<T>({ rows, columns, rowKey, onRowClick, mobile, empty, footer, className }: DataTableProps<T>) {
  if (!rows.length && empty) return <>{empty}</>
  const align = (a?: string) => (a === 'end' ? 'text-end' : a === 'center' ? 'text-center' : 'text-start')
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-border bg-surface shadow-card', className)}>
      {mobile && (
        <ul className="divide-y divide-border md:hidden">
          {rows.map((r) => (
            <li key={rowKey(r)} onClick={() => onRowClick?.(r)} className={cn('px-4 py-3', onRowClick && 'cursor-pointer active:bg-surface-3')}>
              {mobile(r)}
            </li>
          ))}
        </ul>
      )}
      <div className={cn('overflow-x-auto', mobile && 'hidden md:block')}>
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={cn('px-4 py-3 whitespace-nowrap', align(c.align), c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={rowKey(r)} onClick={() => onRowClick?.(r)} className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2')}>
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3', align(c.align), c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-border bg-surface-2 font-semibold">{footer}</tfoot>}
        </table>
      </div>
    </div>
  )
}
