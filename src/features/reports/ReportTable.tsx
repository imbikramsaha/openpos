import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Printer } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toCsv } from '@/lib/csv'
import { downloadText } from '@/lib/download'
import { printHtml } from '@/lib/print'
import { formatDateTime } from '@/lib/dates'
import { Button, Card, CardHeader, EmptyState, SearchInput } from '@/components/ui'
import { csvMoney, csvNum, int, money, pct, qty, slug } from './format'
import { reportHtml } from './print'
import { useReportMeta } from './context'

// Sortable, searchable report table with CSV export and an A4 print view.

export type ColKind = 'text' | 'money' | 'qty' | 'int' | 'pct' | 'date'

export interface RCol<T> {
  key: string
  label: string
  kind?: ColKind
  /** Sort / export value. */
  value: (r: T) => number | string
  /** Custom cell rendering in the UI. */
  render?: (r: T) => ReactNode
  /** Plain text for print (defaults to formatting `value` by kind). */
  text?: (r: T) => string
  /** CSV value (defaults to `value` formatted by kind). */
  csv?: (r: T) => string | number
  /** Only exported (CSV), not shown. */
  exportOnly?: boolean
  /** Hidden below the md breakpoint in the table layout. */
  hideOnMobile?: boolean
  /** Shown as the headline value in the phone card layout. */
  primary?: boolean
  className?: string
}

export function formatByKind(kind: ColKind | undefined, v: number | string): string {
  if (typeof v === 'string') return v
  switch (kind) {
    case 'money':
      return money(v)
    case 'qty':
      return qty(v)
    case 'int':
      return int(v)
    case 'pct':
      return pct(v)
    case 'date':
      return v ? formatDateTime(v) : ''
    default:
      return String(v)
  }
}

function csvByKind(kind: ColKind | undefined, v: number | string): string | number {
  if (typeof v === 'string') return v
  switch (kind) {
    case 'money':
      return csvMoney(v)
    case 'qty':
      return csvNum(v)
    case 'pct':
      return csvNum(v, 2)
    case 'date': {
      if (!v) return ''
      const d = new Date(v)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    default:
      return v
  }
}

export interface ReportTableProps<T> {
  title: string
  subtitle?: ReactNode
  rows: T[]
  columns: RCol<T>[]
  rowKey: (r: T) => string
  /** Enables the search box. */
  search?: (r: T) => string
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  /** Footer totals keyed by column key. */
  totals?: Partial<Record<string, number | string>>
  filename: string
  toolbar?: ReactNode
  mobile?: (r: T) => ReactNode
  empty?: ReactNode
  pageSize?: number
  onRowClick?: (r: T) => void
  className?: string
  /** Extra print sections, e.g. a summary. */
  printNote?: string
}

export function ReportTable<T>({
  title, subtitle, rows, columns, rowKey, search, initialSort, totals, filename, toolbar, mobile, empty, pageSize = 50, onRowClick, className, printNote,
}: ReportTableProps<T>) {
  const { t } = useTranslation('reports')
  const meta = useReportMeta()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [limit, setLimit] = useState(pageSize)
  const visible = columns.filter((c) => !c.exportOnly)

  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase()
    let list = needle && search ? rows.filter((r) => search(r).toLocaleLowerCase().includes(needle)) : rows
    const col = sort && columns.find((c) => c.key === sort.key)
    if (col && sort) {
      const dir = sort.dir === 'asc' ? 1 : -1
      list = [...list].sort((a, b) => {
        const x = col.value(a)
        const y = col.value(b)
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
        return String(x).localeCompare(String(y)) * dir
      })
    }
    return list
  }, [rows, q, sort, columns, search])

  const toggleSort = (key: string, kind?: ColKind) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: kind && kind !== 'text' ? 'desc' : 'asc' }))

  const fileBase = `${slug(filename)}${meta.fileTag ? `_${meta.fileTag}` : ''}`
  const exportCsv = () => {
    // Rows are keyed by column key (unique), not label: two columns may share a label.
    const keys = columns.map((_, i) => String(i))
    // Text that a spreadsheet would run as a formula (=, +, -, @) is prefixed with an apostrophe.
    const safe = (v: string | number) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^[-+]?\d/.test(v) ? `'${v}` : v)
    const data = shown.map((r) => Object.fromEntries(columns.map((c, i) => [keys[i], safe(c.csv ? c.csv(r) : csvByKind(c.kind, c.value(r)))])))
    const body = toCsv(data, keys)
    const nl = body.indexOf('\r\n')
    const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    downloadText(`${fileBase}.csv`, columns.map((c) => esc(c.label)).join(',') + (nl < 0 ? '' : body.slice(nl)), 'text/csv')
  }
  const cellText = (c: RCol<T>, r: T) => (c.text ? c.text(r) : formatByKind(c.kind, c.value(r)))
  const totalText = (c: RCol<T>) => {
    const v = totals?.[c.key]
    return v === undefined ? '' : formatByKind(c.kind, v)
  }
  const print = () => {
    const numeric = visible.map((c, i) => (c.kind && c.kind !== 'text' && c.kind !== 'date' ? i : -1)).filter((i) => i >= 0)
    void printHtml(
      reportHtml({
        title,
        subtitle: meta.rangeLabel,
        settings: meta.settings,
        sections: [{ head: visible.map((c) => c.label), numeric, rows: shown.map((r) => visible.map((c) => cellText(c, r))), foot: totals ? visible.map((c, i) => (i === 0 && totals[c.key] === undefined ? t('total') : totalText(c))) : undefined, note: printNote }],
      }),
    )
  }

  // Clickable rows open with Enter/Space too, not only with a pointer.
  const rowProps = (r: T) =>
    onRowClick
      ? {
          onClick: () => onRowClick(r),
          tabIndex: 0,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            onRowClick(r)
          },
        }
      : {}
  const align = (c: RCol<T>) => (c.kind && c.kind !== 'text' && c.kind !== 'date' ? 'text-end' : 'text-start')
  const primary = visible.find((c) => c.primary) ?? visible.find((c) => c.kind === 'money')
  const secondary = visible.filter((c, i) => i > 0 && c !== primary).slice(0, 3)
  const page = shown.slice(0, limit)

  return (
    <Card className={cn('min-w-0 overflow-hidden', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={exportCsv} aria-label={t('common:exportCsv')} title={t('common:exportCsv')} disabled={!rows.length}>
              <Download className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={print} aria-label={t('common:print')} title={t('common:print')} disabled={!rows.length}>
              <Printer className="size-4" />
            </Button>
          </div>
        }
      />
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
          {search && <SearchInput value={q} onChange={(v) => (setQ(v), setLimit(pageSize))} className="min-w-48 flex-1 sm:max-w-xs" />}
          {toolbar}
        </div>
      )}
      {!shown.length ? (
        (empty ?? <EmptyState title={q ? t('common:noResults') : t('noData')} className="py-10" />)
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {page.map((r) => (
              <li key={rowKey(r)} {...rowProps(r)} className={cn('px-4 py-3', onRowClick && 'cursor-pointer active:bg-surface-3 focus-visible:bg-surface-2 focus-visible:outline-none')}>
                {mobile ? (
                  mobile(r)
                ) : (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0 flex-1 truncate font-medium">{visible[0].render ? visible[0].render(r) : cellText(visible[0], r)}</div>
                      {primary && <div className="tnum shrink-0 font-semibold"><bdi>{primary.render ? primary.render(r) : cellText(primary, r)}</bdi></div>}
                    </div>
                    {secondary.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        {secondary
                          .filter((c) => cellText(c, r) !== '')
                          .map((c) => (
                            <span key={c.key} className="tnum">
                              {c.label}: <bdi>{c.render ? c.render(r) : cellText(c, r)}</bdi>
                            </span>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  {visible.map((c) => {
                    const active = sort?.key === c.key
                    const Icon = !active ? ArrowUpDown : sort?.dir === 'asc' ? ArrowUp : ArrowDown
                    return (
                      <th key={c.key} aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-4 py-2 whitespace-nowrap', align(c), c.hideOnMobile && 'hidden lg:table-cell', c.className)}>
                        <button onClick={() => toggleSort(c.key, c.kind)} className={cn('inline-flex h-8 items-center gap-1 uppercase hover:text-fg', active && 'text-fg')}>
                          {c.label}
                          <Icon className={cn('size-3.5', !active && 'opacity-40')} />
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {page.map((r) => (
                  <tr key={rowKey(r)} {...rowProps(r)} className={cn(onRowClick && 'cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none')}>
                    {visible.map((c) => (
                      <td key={c.key} className={cn('px-4 py-2.5', align(c), align(c) === 'text-end' && 'tnum whitespace-nowrap', c.kind === 'date' && 'whitespace-nowrap', c.hideOnMobile && 'hidden lg:table-cell', c.className)}>
                        {align(c) === 'text-end' ? <bdi>{c.render ? c.render(r) : cellText(c, r)}</bdi> : c.render ? c.render(r) : cellText(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t border-border bg-surface-2 font-semibold">
                  <tr>
                    {visible.map((c, i) => (
                      <td key={c.key} className={cn('px-4 py-2.5', align(c), align(c) === 'text-end' && 'tnum whitespace-nowrap', c.hideOnMobile && 'hidden lg:table-cell')}>
                        {i === 0 && totals[c.key] === undefined ? t('total') : <bdi>{totalText(c)}</bdi>}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {totals && (
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-border bg-surface-2 px-4 py-2.5 text-sm font-semibold md:hidden">
              <span>{t('total')}</span>
              {primary && totals[primary.key] !== undefined && <bdi className="tnum">{totalText(primary)}</bdi>}
            </div>
          )}
          {shown.length > limit && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="ghost" onClick={() => setLimit((l) => l + pageSize * 4)}>
                {t('showMore', { count: shown.length - limit })}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}
