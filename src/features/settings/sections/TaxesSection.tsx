import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, Percent, Plus, Star, Trash2 } from 'lucide-react'
import type { Product, Settings, Tax } from '@/core/types'
import { db } from '@/db/db'
import { SETTINGS_ID } from '@/db/defaults'
import { audit, patch, put, remove, tx } from '@/db/repo'
import { formatPercent } from '@/lib/money'
import { toast } from '@/stores/ui'
import { Badge, Button, Checkbox, EmptyState, Input, Modal, NumberInput, Select } from '@/components/ui'
import { Group, Notice, Row, Stack, ToggleRow } from '../ui'
import { useSettingsDraft } from '../hooks'

export function TaxesSection() {
  const { t } = useTranslation('settings')
  const { draft, set } = useSettingsDraft()
  const taxes = useLiveQuery(async () => (await db.taxes.toArray()).filter((x) => !x.deleted).sort((a, b) => a.rate - b.rate || a.name.localeCompare(b.name)), [])
  const usage = useLiveQuery(async () => {
    const m = new Map<string, number>()
    await db.products.each((p) => {
      if (!p.deleted && p.taxId) m.set(p.taxId, (m.get(p.taxId) ?? 0) + 1)
    })
    return m
  }, [])
  const [editing, setEditing] = useState<Tax | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Tax | null>(null)

  const makeDefault = async (tax: Tax) => {
    await setDefaultTax(tax.id)
    toast(t('taxes.defaultSet', { name: tax.name }))
  }

  return (
    <Stack>
      <Notice>{t('taxes.futureOnly')}</Notice>

      <Group
        title={t('taxes.rates')}
        description={t('taxes.ratesHint')}
        actions={
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            {t('taxes.add')}
          </Button>
        }
      >
        <div data-setting="taxes.rates">
          {taxes && !taxes.length && <EmptyState icon={<Percent />} title={t('taxes.empty')} description={t('taxes.emptyHint')} className="py-8" />}
          <ul className="divide-y divide-border">
            {taxes?.map((tax) => {
              const isDefault = tax.id === draft.defaultTaxId
              const count = usage?.get(tax.id) ?? 0
              return (
                <li key={tax.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="tnum flex h-10 min-w-16 shrink-0 items-center justify-center rounded-xl bg-surface-3 px-2 text-sm font-semibold">{formatPercent(tax.rate)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{tax.name}</span>
                      {isDefault && (
                        <Badge tone="primary">
                          <Star className="size-3 fill-current" /> {t('taxes.default')}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-subtle">{t('taxes.productCount', { count })}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!isDefault && (
                      <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => void makeDefault(tax)}>
                        {t('taxes.makeDefault')}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" aria-label={t('common:edit')} title={t('common:edit')} onClick={() => setEditing(tax)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-danger" aria-label={t('common:delete')} title={t('common:delete')} onClick={() => setDeleting(tax)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </Group>

      <Group title={t('taxes.calculation')}>
        <ToggleRow
          id="taxes.pricesIncludeTax"
          label={t('taxes.pricesIncludeTax')}
          description={draft.pricesIncludeTax ? t('taxes.inclusiveHint') : t('taxes.exclusiveHint')}
          checked={draft.pricesIncludeTax}
          onChange={(v) => set({ pricesIncludeTax: v })}
        />
        <ToggleRow id="taxes.gstMode" label={t('taxes.gstMode')} description={t('taxes.gstModeHint')} checked={draft.gstMode} onChange={(v) => set({ gstMode: v })} />
        {draft.gstMode && (
          <Row>
            <GstExample rate={(taxes?.find((x) => x.id === draft.defaultTaxId) ?? taxes?.find((x) => x.rate > 0))?.rate ?? 18} />
          </Row>
        )}
      </Group>

      <TaxDialog tax={editing} usage={editing && editing !== 'new' ? usage?.get(editing.id) ?? 0 : 0} isDefault={editing !== 'new' && !!editing && editing.id === draft.defaultTaxId} onClose={() => setEditing(null)} />
      <DeleteTaxDialog tax={deleting} taxes={taxes ?? []} usage={deleting ? usage?.get(deleting.id) ?? 0 : 0} defaultTaxId={draft.defaultTaxId} onClose={() => setDeleting(null)} />
    </Stack>
  )
}

function GstExample({ rate }: { rate: number }) {
  const { t } = useTranslation('settings')
  const half = rate / 2
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{t('taxes.intraState')}</div>
        <div className="tnum mt-1 font-medium">
          CGST {formatPercent(half)} + SGST {formatPercent(half)}
        </div>
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{t('taxes.interState')}</div>
        <div className="tnum mt-1 font-medium">IGST {formatPercent(rate)}</div>
      </div>
    </div>
  )
}

/** Marks one tax as the store default (and clears the flag on the others). */
async function setDefaultTax(id: string | undefined) {
  await tx(['taxes', 'settings'], async () => {
    const all = await db.taxes.toArray()
    for (const x of all) if (!x.deleted && !!x.isDefault !== (x.id === id)) await patch<Tax>('taxes', x.id, { isDefault: x.id === id })
    const s = await db.settings.get(SETTINGS_ID)
    if (s) await put<Settings>('settings', { ...s, defaultTaxId: id })
  })
  void audit('tax.default', 'tax', id)
}

function TaxDialog({ tax, usage, isDefault, onClose }: { tax: Tax | 'new' | null; usage: number; isDefault: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState('')
  const [rate, setRate] = useState<number | undefined>(undefined)
  const [makeDefault, setMakeDefault] = useState(false)
  const [busy, setBusy] = useState(false)
  const existing = tax && tax !== 'new' ? tax : null
  const open = !!tax

  useEffect(() => {
    if (!open) return
    setName(existing?.name ?? '')
    setRate(existing?.rate)
    setMakeDefault(isDefault)
  }, [open, existing, isDefault])

  const rateError = rate === undefined ? undefined : rate < 0 || rate > 100 ? t('taxes.rateRange') : undefined
  const valid = name.trim() && rate !== undefined && !rateError
  const rateChanged = existing && rate !== undefined && rate !== existing.rate && usage > 0

  const save = async () => {
    if (!valid) return
    setBusy(true)
    try {
      if (existing) {
        await patch<Tax>('taxes', existing.id, { name: name.trim(), rate })
        void audit('tax.update', 'tax', existing.id, `${existing.name} ${existing.rate}% → ${name.trim()} ${rate}%`)
        if (makeDefault && !isDefault) await setDefaultTax(existing.id)
      } else {
        const created = await put<Tax>('taxes', { name: name.trim(), rate: rate! })
        void audit('tax.create', 'tax', created.id, `${created.name} ${created.rate}%`)
        if (makeDefault) await setDefaultTax(created.id)
      }
      toast(t('common:saved'))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? t('taxes.edit') : t('taxes.add')}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!valid} loading={busy}>
            {t('common:save')}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), void save())}>
        <Input label={t('taxes.name')} placeholder={t('taxes.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
        <NumberInput label={t('taxes.rate')} value={rate} onChange={setRate} error={rateError} right={<span className="pe-2 text-sm text-subtle">%</span>} placeholder="18" />
        {!isDefault && <Checkbox checked={makeDefault} onChange={setMakeDefault} label={t('taxes.setAsDefault')} />}
        {rateChanged && <Notice tone="warning">{t('taxes.rateChangeWarning', { count: usage })}</Notice>}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function DeleteTaxDialog({ tax, taxes, usage, defaultTaxId, onClose }: { tax: Tax | null; taxes: Tax[]; usage: number; defaultTaxId?: string; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const others = taxes.filter((x) => x.id !== tax?.id)

  useEffect(() => {
    if (tax) setTarget((defaultTaxId !== tax.id ? defaultTaxId : others[0]?.id) ?? '')
  }, [tax])

  const confirm = async () => {
    if (!tax) return
    setBusy(true)
    try {
      await tx(['taxes', 'products', 'settings'], async () => {
        if (usage) {
          const products = await db.products.filter((p) => !p.deleted && p.taxId === tax.id).toArray()
          for (const p of products) await patch<Product>('products', p.id, { taxId: target || undefined })
        }
        await remove('taxes', tax.id)
      })
      if (defaultTaxId === tax.id) await setDefaultTax(target || others[0]?.id)
      void audit('tax.delete', 'tax', tax.id, `${tax.name} ${tax.rate}%${usage ? ` · ${usage} → ${target || '∅'}` : ''}`)
      toast(t('taxes.deleted', { name: tax.name }))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!tax}
      onClose={onClose}
      title={t('taxes.deleteTitle', { name: tax?.name ?? '' })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button variant="danger" onClick={() => void confirm()} loading={busy} icon={<Trash2 className="size-4" />}>
            {t('common:delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-muted">{t('taxes.deleteHint')}</p>
        {usage > 0 && (
          <>
            <Notice tone="warning">{t('taxes.inUse', { count: usage })}</Notice>
            <Select
              label={t('taxes.moveProducts', { count: usage })}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={t('taxes.noTax')}
              options={others.map((x) => ({ value: x.id, label: `${x.name} (${formatPercent(x.rate)})` }))}
            />
          </>
        )}
      </div>
    </Modal>
  )
}
