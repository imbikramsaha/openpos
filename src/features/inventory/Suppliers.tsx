import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Building2, Mail, Phone, Plus, Trash2, UserSearch } from 'lucide-react'
import type { Purchase, Supplier } from '@/core/types'
import { db } from '@/db/db'
import { audit, remove } from '@/db/repo'
import { formatDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { navigate } from '@/router'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Avatar, Button, DataTable, EmptyState, FullScreenLoader, Input, Modal, SearchInput, Textarea, type Column } from '@/components/ui'
import { Metric } from '@/features/products/shared'
import { byName } from '@/features/products/util'
import { saveSupplier } from './service'
import { PaidBadge } from './Purchases'

interface SupplierStats {
  count: number
  total: number
  due: number
  last?: number
}

type Row = Supplier & { stats: SupplierStats }

export function SupplierList({ creating, onCreatingChange }: { creating: boolean; onCreatingChange: (v: boolean) => void }) {
  const { t } = useTranslation('inventory')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Supplier | null>(null)
  const query = useDeferredValue(q)
  const suppliers = useLiveQuery(async () => (await db.suppliers.toArray()).filter((s) => !s.deleted).sort(byName), [])
  const purchases = useLiveQuery(async () => (await db.purchases.toArray()).filter((p) => !p.deleted), [])

  const rows = useMemo<Row[]>(() => {
    const stats = new Map<string, SupplierStats>()
    for (const p of purchases ?? []) {
      if (!p.supplierId) continue
      const s = stats.get(p.supplierId) ?? { count: 0, total: 0, due: 0 }
      s.count++
      s.total += p.total
      s.due += Math.max(0, p.total - p.paid)
      s.last = Math.max(s.last ?? 0, p.createdAt)
      stats.set(p.supplierId, s)
    }
    const needle = query.trim().toLowerCase()
    return (suppliers ?? [])
      .filter((s) => !needle || [s.name, s.phone, s.email, s.taxNumber].some((v) => v?.toLowerCase().includes(needle)))
      .map((s) => ({ ...s, stats: stats.get(s.id) ?? { count: 0, total: 0, due: 0 } }))
  }, [suppliers, purchases, query])

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: t('common:supplier'),
      render: (s) => (
        <div className="flex min-w-44 items-center gap-3">
          <Avatar name={s.name} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium">{s.name}</div>
            <div className="truncate text-xs text-muted">{[s.phone, s.email].filter(Boolean).join(' · ') || '—'}</div>
          </div>
        </div>
      ),
    },
    { key: 'count', header: t('suppliers.purchases'), align: 'end', render: (s) => <span className="tnum text-muted">{s.stats.count}</span> },
    { key: 'total', header: t('suppliers.totalPurchased'), align: 'end', render: (s) => <span className="tnum font-semibold">{formatMoney(s.stats.total)}</span> },
    { key: 'due', header: t('suppliers.due'), align: 'end', render: (s) => (s.stats.due > 0 ? <span className="tnum font-semibold text-danger">{formatMoney(s.stats.due)}</span> : <span className="text-subtle">—</span>) },
    { key: 'last', header: t('suppliers.last'), align: 'end', render: (s) => <span className="whitespace-nowrap text-muted">{s.stats.last ? formatDate(s.stats.last) : '—'}</span>, className: 'hidden lg:table-cell' },
  ]

  if (!suppliers || !purchases) return <FullScreenLoader />
  return (
    <>
      {!suppliers.length ? (
        <EmptyState
          icon={<Building2 />}
          title={t('suppliers.empty')}
          description={t('suppliers.emptyHint')}
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => onCreatingChange(true)}>
              {t('suppliers.new')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <SearchInput value={q} onChange={setQ} placeholder={t('suppliers.search')} className="lg:max-w-md" />
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(s) => s.id}
            onRowClick={setEditing}
            empty={<EmptyState icon={<UserSearch />} title={t('common:noResults')} />}
            mobile={(s) => (
              <div className="flex items-center gap-3">
                <Avatar name={s.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted">{t('suppliers.mobileLine', { count: s.stats.count, total: formatMoney(s.stats.total) })}</div>
                </div>
                {s.stats.due > 0 && <span className="tnum text-sm font-semibold text-danger">{formatMoney(s.stats.due)}</span>}
              </div>
            )}
          />
        </div>
      )}
      <SupplierDialog open={creating || !!editing} supplier={editing ?? undefined} onClose={() => (setEditing(null), onCreatingChange(false))} />
    </>
  )
}

const EMPTY = { name: '', phone: '', email: '', taxNumber: '', address: '', notes: '' }

/** Create/edit a supplier. In edit mode also shows purchase totals and recent purchases. */
export function SupplierDialog({ open, supplier, onClose, onSaved }: { open: boolean; supplier?: Supplier; onClose: () => void; onSaved?: (s: Supplier) => void }) {
  const { t } = useTranslation('inventory')
  const taxLabel = useSettings((s) => s.settings.taxLabel)
  const [form, setForm] = useState(EMPTY)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setTried(false)
    setForm(supplier ? { name: supplier.name, phone: supplier.phone ?? '', email: supplier.email ?? '', taxNumber: supplier.taxNumber ?? '', address: supplier.address ?? '', notes: supplier.notes ?? '' } : EMPTY)
  }, [open, supplier])

  const history = useLiveQuery(
    async (): Promise<Purchase[]> => (supplier ? (await db.purchases.where('supplierId').equals(supplier.id).toArray()).filter((p) => !p.deleted).sort((a, b) => b.createdAt - a.createdAt) : []),
    [supplier?.id],
  )
  const total = (history ?? []).reduce((a, p) => a + p.total, 0)
  const due = (history ?? []).reduce((a, p) => a + Math.max(0, p.total - p.paid), 0)

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const save = async () => {
    setTried(true)
    if (!form.name.trim() || busy) return
    setBusy(true)
    try {
      const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined])) as Partial<Supplier>
      const s = await saveSupplier({ ...clean, id: supplier?.id, name: form.name.trim() })
      toast(supplier ? t('suppliers.saved') : t('suppliers.created', { name: s.name }))
      onSaved?.(s)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const del = async () => {
    if (!supplier) return
    if (!(await confirmDialog({ title: t('suppliers.deleteTitle', { name: supplier.name }), message: t('suppliers.deleteMessage'), danger: true, confirmLabel: t('common:delete') }))) return
    await remove('suppliers', supplier.id)
    void audit('supplier.delete', 'supplier', supplier.id, supplier.name)
    toast(t('suppliers.deleted', { name: supplier.name }))
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supplier ? t('suppliers.edit') : t('suppliers.new')}
      size="md"
      footer={
        <>
          {supplier && (
            <Button variant="ghost" icon={<Trash2 className="size-4 text-danger" />} onClick={del} className="me-auto text-danger">
              {t('common:delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('common:save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void save())}>
        {supplier && (
          <div className="grid grid-cols-3 gap-2">
            <Metric label={t('suppliers.purchases')} value={history?.length ?? 0} />
            <Metric label={t('suppliers.totalPurchased')} value={formatMoney(total)} />
            <Metric label={t('suppliers.due')} value={formatMoney(due)} tone={due > 0 ? 'danger' : undefined} />
          </div>
        )}
        <Input label={`${t('common:name')} *`} value={form.name} onChange={(e) => set('name', e.target.value)} error={tried && !form.name.trim() ? t('suppliers.nameRequired') : undefined} autoFocus={!supplier} maxLength={120} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('common:phone')} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} left={<Phone className="size-4" />} />
          <Input label={t('common:email')} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} left={<Mail className="size-4" />} />
        </div>
        <Input label={taxLabel} value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value.toUpperCase())} />
        <Textarea label={t('common:address')} value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} />
        <Textarea label={t('common:notes')} value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        {supplier && !!history?.length && (
          <div>
            <div className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{t('suppliers.recent')}</div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {history.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => navigate(`inventory/purchases/${p.id}`)} className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-2">
                    <span className="font-mono text-xs">{p.number}</span>
                    <span className="flex-1 text-xs text-muted">{formatDate(p.createdAt)}</span>
                    <span className="tnum font-semibold">{formatMoney(p.total)}</span>
                    <PaidBadge p={p} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
