import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Barcode, Boxes, Copy, ImagePlus, Plus, Printer, Trash2, X } from 'lucide-react'
import type { Product, Unit } from '@/core/types'
import { isValidEan13 } from '@/core/barcode'
import { db } from '@/db/db'
import { audit, round3 } from '@/db/repo'
import { formatMoney, formatPercent } from '@/lib/money'
import { pickFile, readFileDataUrl } from '@/lib/download'
import { cn } from '@/lib/cn'
import { LIMITS } from '@/lib/validate'
import { navigate } from '@/router'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Input, Label, MoneyInput, NumberInput, Select, Textarea, Toggle } from '@/components/ui'
import { CategoryDialog } from './CategoryDialog'
import { ActionMenu, ColorSwatches, FormSection, ProductThumb, ResponsivePanel, StockQty } from './shared'
import { deleteProducts, saveProduct, uniqueEan13, type ProductFields } from './service'
import { blank, byName, MAX_AMOUNT, MAX_QTY, MEASURED_UNITS, marginPct, netOfTax, sanitizeBarcode, SERVICE_UNITS, UNITS } from './util'

export interface EditorTarget {
  /** Existing product being edited. */
  product?: Product
  /** Starting values for a new product (duplicate, deep link…). */
  template?: Partial<Product>
  /** Distinguishes consecutive "new product" sessions so the form resets. */
  nonce?: number
}

interface Draft {
  name: string
  categoryId: string
  price?: number
  cost?: number
  mrp?: number
  taxId: string
  unit: Unit
  sku: string
  barcode: string
  hsn: string
  trackStock: boolean
  reorderLevel?: number
  color?: string
  image?: string
  favorite: boolean
  openPrice: boolean
  weighed: boolean
  active: boolean
  description: string
}

function toDraft(p: Partial<Product> | undefined, defaultTaxId?: string): Draft {
  return {
    name: p?.name ?? '',
    categoryId: p?.categoryId ?? '',
    price: p?.price,
    cost: p?.cost,
    mrp: p?.mrp,
    taxId: p && 'taxId' in p ? (p.taxId ?? '') : (defaultTaxId ?? ''),
    unit: p?.unit ?? 'pcs',
    sku: p?.sku ?? '',
    barcode: p?.barcode ?? '',
    hsn: p?.hsn ?? '',
    trackStock: p?.trackStock ?? true,
    reorderLevel: p?.reorderLevel,
    color: p?.color,
    image: p?.image,
    favorite: !!p?.favorite,
    openPrice: !!p?.openPrice,
    weighed: !!p?.weighed,
    active: p?.active ?? true,
    description: p?.description ?? '',
  }
}

function fromDraft(d: Draft): ProductFields {
  return {
    name: d.name.trim(),
    categoryId: d.categoryId || undefined,
    price: d.price ?? 0,
    cost: d.cost ?? 0,
    mrp: d.mrp || undefined,
    taxId: d.taxId || undefined,
    unit: d.unit,
    sku: blank(d.sku),
    barcode: blank(sanitizeBarcode(d.barcode)),
    hsn: blank(d.hsn),
    trackStock: d.trackStock,
    reorderLevel: d.trackStock && d.reorderLevel !== undefined ? round3(d.reorderLevel) : undefined,
    color: d.color,
    image: d.image,
    favorite: d.favorite || undefined,
    openPrice: d.openPrice || undefined,
    weighed: d.weighed || undefined,
    active: d.active,
    description: blank(d.description),
  }
}

export function ProductEditor({ target, onClose, onDuplicate, onPrintLabel }: {
  target: EditorTarget | null
  onClose: () => void
  onDuplicate: (p: Product) => void
  onPrintLabel: (id: string) => void
}) {
  if (!target) return null
  return <EditorPanel key={target.product?.id ?? `new-${target.nonce ?? 0}`} target={target} onClose={onClose} onDuplicate={onDuplicate} onPrintLabel={onPrintLabel} />
}

function EditorPanel({ target, onClose, onDuplicate, onPrintLabel }: {
  target: EditorTarget
  onClose: () => void
  onDuplicate: (p: Product) => void
  onPrintLabel: (id: string) => void
}) {
  const { t } = useTranslation('products')
  const settings = useSettings((s) => s.settings)
  const taxes = useSettings((s) => s.taxes)
  const taxMap = useSettings((s) => s.taxMap)
  const existing = target.product
  const [draft, setDraft] = useState<Draft>(() => toDraft(existing ?? target.template, settings.defaultTaxId))
  // Baseline for "unsaved changes" (reset after Save & add another).
  const [pristine, setPristine] = useState<Draft>(draft)
  const [initialStock, setInitialStock] = useState<number | undefined>(undefined)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newCategory, setNewCategory] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }))

  const categories = useLiveQuery(async () => (await db.categories.orderBy('sortOrder').toArray()).filter((c) => !c.deleted), [])
  // Live stock so the panel reflects sales made on other terminals while it is open.
  const live = useLiveQuery(() => (existing ? db.products.get(existing.id) : undefined), [existing?.id])

  const barcode = draft.barcode.trim()
  const sku = draft.sku.trim()
  const dupBarcode = useLiveQuery(
    async () => (barcode ? (await db.products.where('barcode').equals(barcode).toArray()).find((p) => !p.deleted && p.id !== existing?.id) ?? null : null),
    [barcode, existing?.id],
  )
  const dupSku = useLiveQuery(
    async () => (sku ? (await db.products.where('sku').equalsIgnoreCase(sku).toArray()).find((p) => !p.deleted && p.id !== existing?.id) ?? null : null),
    [sku, existing?.id],
  )

  // Amounts: never negative, and capped so typos like "1e20" can't reach the database.
  const amountError = (v: number | undefined) => (v === undefined ? undefined : v < 0 ? t('editor.negative') : v > MAX_AMOUNT ? t('editor.tooLarge') : undefined)
  const qtyError = (v: number | undefined) => (v === undefined ? undefined : v < 0 ? t('editor.negative') : v > MAX_QTY ? t('editor.tooLarge') : undefined)
  const errors = {
    name: !draft.name.trim() ? t('editor.nameRequired') : undefined,
    price: draft.price === undefined && !draft.openPrice ? t('editor.priceRequired') : amountError(draft.price),
    cost: amountError(draft.cost),
    mrp: amountError(draft.mrp),
    initialStock: !existing && draft.trackStock ? qtyError(initialStock) : undefined,
    reorderLevel: draft.trackStock ? qtyError(draft.reorderLevel) : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)
  const dirty = initialStock !== undefined || JSON.stringify(draft) !== JSON.stringify(pristine)
  const busyRef = useRef(false)

  const rate = taxMap.get(draft.taxId)?.rate ?? 0
  const margin = marginPct(draft.price ?? 0, draft.cost, rate, settings.pricesIncludeTax)
  const profit = draft.price !== undefined && draft.cost !== undefined ? Math.round(netOfTax(draft.price, rate, settings.pricesIncludeTax) - draft.cost) : undefined

  const categoryOptions = useMemo(() => (categories ?? []).map((c) => ({ value: c.id, label: c.name })), [categories])
  const taxOptions = useMemo(() => taxes.slice().sort(byName).map((x) => ({ value: x.id, label: x.name })), [taxes])

  const onUnit = (unit: Unit) => {
    const changes: Partial<Draft> = { unit }
    // Sensible defaults while creating: weighed goods open the qty dialog, services hold no stock.
    if (!existing) {
      changes.weighed = MEASURED_UNITS.includes(unit)
      if (SERVICE_UNITS.includes(unit)) changes.trackStock = false
    }
    set(changes)
  }

  const uploadImage = async () => {
    const file = await pickFile('image/*')
    if (!file) return
    try {
      set({ image: await readFileDataUrl(file, 256) })
    } catch {
      toast(t('editor.imageError'), 'error')
    }
  }

  const save = async (andNew = false) => {
    setTried(true)
    if (!valid || busyRef.current) {
      if (errors.name) nameRef.current?.focus()
      else if (!valid) {
        // Bring the first invalid field into view (errors render after this state update).
        setTimeout(() => {
          const el = formRef.current?.querySelector<HTMLInputElement>('input.border-danger')
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          el?.focus({ preventScroll: true })
        }, 0)
      }
      return
    }
    busyRef.current = true
    try {
      const clashes = [dupBarcode && t('editor.clashBarcode', { name: dupBarcode.name }), dupSku && t('editor.clashSku', { name: dupSku.name })].filter(Boolean)
      if (clashes.length && !(await confirmDialog({ title: t('editor.clashTitle'), message: clashes.join(' '), confirmLabel: t('editor.saveAnyway') }))) return
      await doSave(andNew)
    } finally {
      busyRef.current = false
    }
  }

  const doSave = async (andNew: boolean) => {
    setBusy(true)
    try {
      const opening = !existing && draft.trackStock && initialStock ? round3(initialStock) : undefined
      const p = await saveProduct(fromDraft(draft), existing?.id, opening)
      void audit(existing ? 'product.update' : 'product.create', 'product', p.id, p.name)
      toast(existing ? t('editor.saved', { name: p.name }) : t('editor.created', { name: p.name }))
      if (andNew) {
        // Keep the classification so a run of similar items is quick to enter.
        const next = toDraft({ categoryId: draft.categoryId || undefined, taxId: draft.taxId || undefined, unit: draft.unit, trackStock: draft.trackStock, weighed: draft.weighed })
        setDraft(next)
        setPristine(next)
        setInitialStock(undefined)
        setTried(false)
        nameRef.current?.focus()
      } else onClose()
    } finally {
      setBusy(false)
    }
  }

  /** Runs `then` (close, navigate…) after confirming that unsaved changes may be dropped. */
  const leave = async (then: () => void) => {
    if (busyRef.current) return
    if (dirty && !(await confirmDialog({ title: t('editor.discardTitle'), message: t('editor.discardMessage'), danger: true, confirmLabel: t('editor.discard') }))) return
    then()
  }
  const requestClose = () => void leave(onClose)

  const del = async () => {
    if (!existing) return
    const ok = await confirmDialog({ title: t('editor.deleteTitle', { name: existing.name }), message: t('editor.deleteMessage'), danger: true, confirmLabel: t('common:delete') })
    if (!ok) return
    await deleteProducts([existing.id])
    toast(t('editor.deleted', { name: existing.name }))
    onClose()
  }

  // Ctrl/⌘+S saves from anywhere in the form (not while a dialog is open on top of it).
  const saveRef = useRef(save)
  saveRef.current = save
  const nestedRef = useRef(false)
  nestedRef.current = newCategory
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (!nestedRef.current && !e.repeat) void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const catColor = categories?.find((c) => c.id === draft.categoryId)?.color
  const current = live ?? existing

  const footer = (
    <>
      {existing && (
        <div className="me-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={del} aria-label={t('common:delete')} title={t('common:delete')}>
            <Trash2 className="size-5 text-danger" />
          </Button>
          <ActionMenu
            label={t('common:more')}
            items={[
              { icon: <Copy />, label: t('editor.duplicate'), onClick: () => onDuplicate({ ...existing, ...fromDraft(draft), stock: 0 } as Product) },
              { icon: <Printer />, label: t('editor.printLabel'), onClick: () => onPrintLabel(existing.id) },
              { icon: <Boxes />, label: t('editor.stockHistory'), onClick: () => void leave(() => navigate(`inventory/stock?product=${existing.id}`)), hidden: !existing.trackStock },
            ]}
          />
        </div>
      )}
      <Button onClick={requestClose} className="max-sm:hidden">
        {t('common:cancel')}
      </Button>
      {!existing && (
        <Button onClick={() => save(true)} disabled={busy}>
          {t('editor.saveAndNew')}
        </Button>
      )}
      <Button variant="primary" onClick={() => save()} loading={busy}>
        {t('common:save')}
      </Button>
    </>
  )

  return (
    <ResponsivePanel open onClose={requestClose} title={existing ? t('editor.editTitle') : t('editor.newTitle')} footer={footer}>
      <form
        ref={formRef}
        className="space-y-7"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {/* Identity */}
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <button type="button" onClick={uploadImage} className="block rounded-2xl" aria-label={t('editor.uploadImage')} title={t('editor.uploadImage')}>
              {draft.image || draft.name ? (
                <ProductThumb product={{ name: draft.name, image: draft.image }} color={draft.color || catColor} size="lg" />
              ) : (
                <span className="flex size-16 items-center justify-center rounded-2xl border-2 border-dashed border-border-strong text-subtle">
                  <ImagePlus className="size-6" />
                </span>
              )}
            </button>
            {draft.image && (
              <button
                type="button"
                onClick={() => set({ image: undefined })}
                aria-label={t('editor.removeImage')}
                title={t('editor.removeImage')}
                className="absolute -end-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-card hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Input
              ref={nameRef}
              label={`${t('editor.name')} *`}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              error={tried ? errors.name : undefined}
              autoFocus={!existing}
              maxLength={120}
            />
            <div>
              <Label>{t('common:category')}</Label>
              <div className="flex gap-2">
                <Select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })} placeholder={t('uncategorised')} options={categoryOptions} wrapperClassName="min-w-0 flex-1" aria-label={t('common:category')} />
                <Button size="icon-lg" className="size-11" onClick={() => setNewCategory(true)} aria-label={t('categories.new')} title={t('categories.new')}>
                  <Plus className="size-5" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <FormSection title={t('editor.pricing')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MoneyInput label={`${t('common:price')}${draft.openPrice ? '' : ' *'}`} value={draft.price} onChange={(v) => set({ price: v })} error={tried || (draft.price !== undefined && errors.price) ? errors.price : undefined} placeholder="0" />
            <MoneyInput label={t('common:cost')} value={draft.cost} onChange={(v) => set({ cost: v })} placeholder="0" error={errors.cost} />
            <MoneyInput label={t('editor.mrp')} value={draft.mrp} onChange={(v) => set({ mrp: v })} hint={t('common:optional')} error={errors.mrp} wrapperClassName="col-span-2 sm:col-span-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('common:tax')} value={draft.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder={t('editor.noTax')} options={taxOptions} />
            <Select label={t('editor.unit')} value={draft.unit} onChange={(e) => onUnit(e.target.value as Unit)} options={UNITS.map((u) => ({ value: u, label: t(`common:unit.${u}`) }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3">
            <div>
              <div className="text-xs font-medium text-muted">{t('common:margin')}</div>
              <div className={cn('tnum text-lg font-semibold', margin === undefined ? 'text-subtle' : margin < 0 ? 'text-danger' : margin < 10 ? 'text-warning' : 'text-success')}>
                {margin === undefined ? '—' : formatPercent(Math.round(margin * 10) / 10)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted">{t('editor.profitPerUnit')}</div>
              <div className={cn('tnum text-lg font-semibold', profit !== undefined && profit < 0 && 'text-danger')}>{profit === undefined ? '—' : formatMoney(profit)}</div>
            </div>
            <p className="col-span-2 text-xs text-subtle">
              {draft.cost === undefined ? t('editor.marginHintNoCost') : settings.pricesIncludeTax && rate ? t('editor.marginHintInclusive') : t('editor.marginHint')}
            </p>
            {draft.mrp !== undefined && draft.price !== undefined && draft.mrp > 0 && draft.price > draft.mrp && (
              <p className="col-span-2 flex items-center gap-1.5 text-xs font-medium text-warning">
                <AlertTriangle className="size-3.5" /> {t('editor.aboveMrp')}
              </p>
            )}
          </div>
        </FormSection>

        {/* Codes */}
        <FormSection title={t('editor.codes')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Input label={t('sku')} value={draft.sku} onChange={(e) => set({ sku: e.target.value })} autoComplete="off" maxLength={LIMITS.sku} />
              {dupSku && <Clash text={t('editor.clashSku', { name: dupSku.name })} />}
            </div>
            <div>
              <Label>{t('barcode')}</Label>
              <div className="flex gap-2">
                <Input value={draft.barcode} onChange={(e) => set({ barcode: sanitizeBarcode(e.target.value) })} inputMode="numeric" autoComplete="off" maxLength={LIMITS.barcode} dir="ltr" wrapperClassName="min-w-0 flex-1" aria-label={t('barcode')} className="font-mono" />
                <Button size="icon-lg" className="size-11" onClick={async () => set({ barcode: await uniqueEan13() })} aria-label={t('editor.generateBarcode')} title={t('editor.generateBarcode')}>
                  <Barcode className="size-5" />
                </Button>
              </div>
              {dupBarcode ? (
                <Clash text={t('editor.clashBarcode', { name: dupBarcode.name })} />
              ) : /^\d{13}$/.test(barcode) && !isValidEan13(barcode) ? (
                <Clash text={t('editor.badCheckDigit')} />
              ) : null}
            </div>
            {settings.gstMode && <Input label={t('hsn')} value={draft.hsn} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, '') })} inputMode="numeric" maxLength={10} dir="ltr" />}
          </div>
        </FormSection>

        {/* Stock */}
        <FormSection title={t('editor.inventory')}>
          <Toggle
            checked={draft.trackStock}
            onChange={(v) => set({ trackStock: v })}
            label={t('editor.trackStock')}
            description={t('editor.trackStockHint')}
          />
          {draft.trackStock && (
            <div className="grid grid-cols-2 gap-3">
              {existing ? (
                <div>
                  <Label>{t('editor.currentStock')}</Label>
                  <div className="flex h-11 items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 ps-3 pe-1">
                    {current && <StockQty product={{ ...current, trackStock: true, reorderLevel: draft.reorderLevel }} className="-ms-1.5" />}
                    <Button size="sm" variant="ghost" onClick={() => void leave(() => navigate(`inventory/stock?product=${existing.id}`))} className="text-primary">
                      {t('editor.adjust')}
                    </Button>
                  </div>
                </div>
              ) : (
                <NumberInput label={t('editor.initialStock')} value={initialStock} onChange={setInitialStock} placeholder="0" error={errors.initialStock} />
              )}
              <NumberInput label={t('editor.reorderLevel')} value={draft.reorderLevel} onChange={(v) => set({ reorderLevel: v })} placeholder="0" hint={t('editor.reorderHint')} error={errors.reorderLevel} />
            </div>
          )}
        </FormSection>

        {/* Behaviour at the till */}
        <FormSection title={t('editor.options')}>
          <div className="divide-y divide-border rounded-xl border border-border">
            <Toggle className="px-4 py-3" checked={draft.active} onChange={(v) => set({ active: v })} label={t('editor.active')} description={t('editor.activeHint')} />
            <Toggle className="px-4 py-3" checked={draft.favorite} onChange={(v) => set({ favorite: v })} label={t('editor.favorite')} description={t('editor.favoriteHint')} />
            <Toggle className="px-4 py-3" checked={draft.openPrice} onChange={(v) => set({ openPrice: v })} label={t('editor.openPrice')} description={t('editor.openPriceHint')} />
            <Toggle className="px-4 py-3" checked={draft.weighed} onChange={(v) => set({ weighed: v })} label={t('editor.weighed')} description={t('editor.weighedHint')} />
          </div>
        </FormSection>

        {/* Appearance */}
        <FormSection title={t('editor.appearance')}>
          <ColorPicker value={draft.color} onChange={(color) => set({ color })} fallback={catColor} />
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<ImagePlus className="size-4" />} onClick={uploadImage}>
              {draft.image ? t('editor.changeImage') : t('editor.uploadImage')}
            </Button>
            {draft.image && (
              <Button variant="ghost" onClick={() => set({ image: undefined })} className="text-danger">
                {t('editor.removeImage')}
              </Button>
            )}
          </div>
        </FormSection>

        <Textarea label={t('editor.description')} value={draft.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
        <button type="submit" className="hidden" />
      </form>

      <CategoryDialog open={newCategory} onClose={() => setNewCategory(false)} onSaved={(c) => set({ categoryId: c.id })} />
    </ResponsivePanel>
  )
}

function Clash({ text }: { text: string }) {
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warning">
      <AlertTriangle className="mt-px size-3.5 shrink-0" /> {text}
    </p>
  )
}

function ColorPicker({ value, onChange, fallback }: { value?: string; onChange: (c: string | undefined) => void; fallback?: string }) {
  const { t } = useTranslation('products')
  return (
    <div>
      <Label>{t('editor.color')}</Label>
      <ColorSwatches value={value} onChange={onChange} allowNone />
      {!value && fallback && <p className="mt-2 text-xs text-subtle">{t('editor.colorFromCategory')}</p>}
    </div>
  )
}
