import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, XCircle } from 'lucide-react'
import { audit } from '@/db/repo'
import { formatMoney, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Badge, Button, DataTable, Modal, Segmented, type Column } from '@/components/ui'
import { applyImport, type ImportPlan, type ImportRow, type Issue, type RowStatus } from './csv'

const MAX_ROWS = 300

/** Preview + confirm step of the product CSV import. */
export function ImportDialog({ plan, fileName, onClose }: { plan: ImportPlan | null; fileName: string; onClose: () => void }) {
  const { t } = useTranslation('products')
  const defaultTaxId = useSettings((s) => s.settings.defaultTaxId)
  const [filter, setFilter] = useState<'all' | RowStatus>('all')
  const [busy, setBusy] = useState(false)
  useEffect(() => setFilter(plan?.counts.error ? 'error' : 'all'), [plan])

  const rows = useMemo(() => (plan ? (filter === 'all' ? plan.rows : plan.rows.filter((r) => r.status === filter)) : []), [plan, filter])
  const valid = plan ? plan.counts.new + plan.counts.update : 0
  const issue = (i: Issue) => t(`import.issue.${i.key}`, i.opts)

  const run = async () => {
    if (!plan || !valid) return
    setBusy(true)
    try {
      const res = await applyImport(plan, { defaultTaxId, stockNote: t('import.stockNote') })
      void audit('product.import', 'product', undefined, `${fileName}: ${res.created} new, ${res.updated} updated`)
      toast(t('import.done', { created: res.created, updated: res.updated }))
      onClose()
    } catch (e) {
      toast(t('import.failed', { error: e instanceof Error ? e.message : String(e) }), 'error')
    } finally {
      setBusy(false)
    }
  }

  const status = (r: ImportRow) =>
    r.status === 'error' ? <Badge tone="danger">{t('import.status.error')}</Badge> : r.status === 'update' ? <Badge tone="primary">{t('import.status.update')}</Badge> : <Badge tone="success">{t('import.status.new')}</Badge>
  const name = (r: ImportRow) => r.name ?? r.match?.name ?? '—'
  const messages = (r: ImportRow) => (
    <div className="space-y-0.5">
      {r.errors.map((i, k) => (
        <div key={`e${k}`} className="text-xs font-medium text-danger">{issue(i)}</div>
      ))}
      {r.warnings.map((i, k) => (
        <div key={`w${k}`} className="text-xs text-warning">{issue(i)}</div>
      ))}
    </div>
  )

  const columns: Column<ImportRow>[] = [
    { key: 'line', header: '#', render: (r) => <span className="tnum text-muted">{r.line}</span>, className: 'w-12' },
    { key: 'status', header: t('common:status'), render: status },
    {
      key: 'name',
      header: t('common:name'),
      render: (r) => (
        <div className="min-w-40">
          <div className="font-medium">{name(r)}</div>
          {r.match && r.name && r.name !== r.match.name && <div className="text-xs text-muted">{t('import.was', { name: r.match.name })}</div>}
        </div>
      ),
    },
    { key: 'code', header: `${t('sku')} / ${t('barcode')}`, render: (r) => <div className="font-mono text-xs">{[r.sku, r.barcode].filter(Boolean).join(' · ') || '—'}</div> },
    { key: 'category', header: t('common:category'), render: (r) => r.category ?? '' },
    { key: 'price', header: t('common:price'), align: 'end', render: (r) => (r.price !== undefined ? formatMoney(r.price) : '') },
    { key: 'stock', header: t('stock.label'), align: 'end', render: (r) => (r.stock !== undefined ? formatQty(r.stock) : '') },
    { key: 'issues', header: t('import.issues'), render: messages },
  ]

  return (
    <Modal
      open={!!plan}
      onClose={() => !busy && onClose()}
      title={t('import.title')}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <FileSpreadsheet className="size-4" /> {fileName}
        </span>
      }
      size="full"
      flush
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>{t('common:cancel')}</Button>
          <Button variant="primary" onClick={run} disabled={!valid} loading={busy}>
            {t('import.confirm', { count: valid })}
          </Button>
        </>
      }
    >
      {plan && (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Summary icon={<CheckCircle2 />} tone="success" label={t('import.summary.new')} value={plan.counts.new} />
            <Summary icon={<RefreshCw />} tone="primary" label={t('import.summary.update')} value={plan.counts.update} />
            <Summary icon={<XCircle />} tone="danger" label={t('import.summary.error')} value={plan.counts.error} />
          </div>
          {(plan.newCategories.length > 0 || plan.ignoredColumns.length > 0 || plan.counts.error > 0) && (
            <ul className="space-y-1 rounded-xl bg-surface-2 p-3 text-sm text-muted">
              {plan.newCategories.length > 0 && <li>{t('import.newCategories', { count: plan.newCategories.length, names: plan.newCategories.slice(0, 8).join(', ') })}</li>}
              {plan.ignoredColumns.length > 0 && <li>{t('import.ignored', { columns: plan.ignoredColumns.join(', ') })}</li>}
              {plan.counts.error > 0 && (
                <li className="flex items-center gap-1.5 text-danger">
                  <AlertTriangle className="size-4" /> {t('import.errorsSkipped', { count: plan.counts.error })}
                </li>
              )}
            </ul>
          )}
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `${t('common:all')} (${plan.rows.length})` },
              { value: 'new', label: `${t('import.status.new')} (${plan.counts.new})` },
              { value: 'update', label: `${t('import.status.update')} (${plan.counts.update})` },
              { value: 'error', label: `${t('import.status.error')} (${plan.counts.error})` },
            ]}
            className="max-w-full overflow-x-auto"
          />
          <DataTable
            rows={rows.slice(0, MAX_ROWS)}
            columns={columns}
            rowKey={(r) => String(r.line)}
            empty={<p className="py-10 text-center text-sm text-muted">{t('common:noResults')}</p>}
            mobile={(r) => (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="tnum text-xs text-subtle">#{r.line}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{name(r)}</span>
                  {status(r)}
                </div>
                <div className="flex justify-between gap-2 text-xs text-muted">
                  <span className="truncate font-mono">{[r.sku, r.barcode].filter(Boolean).join(' · ')}</span>
                  <span className="tnum">{[r.price !== undefined && formatMoney(r.price), r.stock !== undefined && formatQty(r.stock)].filter(Boolean).join(' · ')}</span>
                </div>
                {messages(r)}
              </div>
            )}
          />
          {rows.length > MAX_ROWS && <p className="text-center text-xs text-muted">{t('import.truncated', { shown: MAX_ROWS, total: rows.length })}</p>}
        </div>
      )}
    </Modal>
  )
}

function Summary({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'success' | 'primary' | 'danger' }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <span
        className={cn(
          'hidden size-9 shrink-0 items-center justify-center rounded-xl sm:flex [&>svg]:size-5',
          tone === 'success' && 'bg-success-soft text-success',
          tone === 'primary' && 'bg-primary-soft text-primary',
          tone === 'danger' && 'bg-danger-soft text-danger',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-muted">{label}</div>
        <div className="tnum text-xl font-bold">{value}</div>
      </div>
    </div>
  )
}
