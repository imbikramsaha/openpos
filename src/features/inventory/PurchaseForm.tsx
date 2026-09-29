import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { PackagePlus, Plus, ScanLine, Trash2, Truck } from 'lucide-react'
import type { Product, PurchaseLine } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { navigate } from '@/router'
import { useDevice } from '@/stores/device'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Card, CardHeader, Checkbox, EmptyState, Input, Label, MoneyInput, NumberInput, Page, PageBody, PageHeader, SearchInput, Select, Textarea, Toggle } from '@/components/ui'
import { CameraScanner } from '@/features/sell/CameraScanner'
import { beep, useScanner } from '@/features/sell/useScanner'
import { ProductThumb } from '@/features/products/shared'
import { byName, matchesTerms, searchText, splitTerms } from '@/features/products/util'
import { lineTotal, purchaseTotal, savePurchase, soldSince, suggestedQty } from './service'
import { SupplierDialog } from './Suppliers'

// New purchase (goods received). The draft is kept in localStorage so leaving the
// screen, a reload or a crash never loses a half-entered delivery.

const DRAFT_KEY = 'kasa.purchaseDraft'
const MAX_MATCHES = 8

interface Draft {
  supplierId: string
  invoiceNo: string
  note: string
  lines: PurchaseLine[]
  updateCost: boolean
  paidInFull: boolean
  paid?: number
}

const EMPTY: Draft = { supplierId: '', invoiceNo: '', note: '', lines: [], updateCost: true, paidInFull: true }

function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    if (d && Array.isArray(d.lines)) return { ...EMPTY, ...d }
  } catch {
    /* ignore */
  }
  return EMPTY
}

export function PurchaseForm({ products, params }: { products: Product[]; params: URLSearchParams }) {
  const { t } = useTranslation('inventory')
  const sound = useDevice((s) => s.sound)
  const [draft, setDraft] = useState<Draft>(loadDraft)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const [newSupplier, setNewSupplier] = useState(false)
  const [camera, setCamera] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const set = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }))

  const suppliers = useLiveQuery(async () => (await db.suppliers.toArray()).filter((s) => !s.deleted).sort(byName), [])
  const sellable = useMemo(() => products.filter((p) => !p.deleted), [products])
  const byId = useMemo(() => new Map(sellable.map((p) => [p.id, p])), [sellable])
  const hay = useMemo(() => new Map(sellable.map((p) => [p.id, searchText(p)])), [sellable])

  useEffect(() => {
    try {
      if (draft.lines.length || draft.supplierId || draft.invoiceNo || draft.note) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      else localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* storage unavailable */
    }
  }, [draft])

  // Prefill from the low-stock list or from an earlier purchase ("order again").
  const low = params.has('low')
  const from = params.get('from')
  useEffect(() => {
    if (!low && !from) return
    let cancelled = false
    void (async () => {
      let lines: PurchaseLine[] = []
      let supplierId: string | undefined
      if (from) {
        const p = await db.purchases.get(from)
        if (p) {
          lines = p.lines.filter((l) => byId.has(l.productId)).map((l) => ({ ...l, name: byId.get(l.productId)!.name, cost: byId.get(l.productId)!.cost || l.cost }))
          supplierId = p.supplierId
        }
      } else {
        const sold = await soldSince(30)
        lines = sellable
          .filter((p) => p.active && p.trackStock && (p.stock <= 0 || (p.reorderLevel !== undefined && p.stock <= p.reorderLevel)))
          .sort(byName)
          .map((p) => ({ productId: p.id, name: p.name, qty: suggestedQty(p, sold.get(p.id)), cost: p.cost }))
      }
      if (cancelled) return
      setDraft((d) => {
        const have = new Set(d.lines.map((l) => l.productId))
        return { ...d, supplierId: d.supplierId || supplierId || '', lines: [...d.lines, ...lines.filter((l) => !have.has(l.productId))] }
      })
      navigate('inventory/purchases/new')
    })()
    return () => {
      cancelled = true
    }
  }, [low, from, byId, sellable])

  const matches = useMemo(() => {
    const terms = splitTerms(q)
    if (!terms.length) return []
    const out: Product[] = []
    for (const p of sellable) {
      if (matchesTerms(hay.get(p.id) ?? '', terms)) out.push(p)
      if (out.length >= 50) break
    }
    return out.sort(byName).slice(0, MAX_MATCHES)
  }, [q, sellable, hay])
  useEffect(() => setHi(0), [q])

  const exact = (code: string) => {
    const c = code.trim()
    const lc = c.toLowerCase()
    return sellable.find((p) => p.barcode === c) ?? sellable.find((p) => p.sku?.toLowerCase() === lc)
  }

  const add = (p: Product, qty = 1) => {
    setDraft((d) => {
      const i = d.lines.findIndex((l) => l.productId === p.id)
      if (i >= 0) return { ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, qty: Math.round((l.qty + qty) * 1000) / 1000 } : l)) }
      return { ...d, lines: [...d.lines, { productId: p.id, name: p.name, qty, cost: p.cost }] }
    })
    setFlash(p.id)
    setTimeout(() => setFlash((f) => (f === p.id ? null : f)), 900)
    if (sound) beep(true)
  }

  const onScan = (code: string) => {
    const p = exact(code)
    if (p) add(p)
    else {
      if (sound) beep(false)
      toast(t('purchases.notFound', { code }), 'error')
    }
  }
  useScanner(onScan, !camera && !newSupplier)

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && q.trim()) {
      e.preventDefault()
      const p = exact(q) ?? matches[hi]
      if (p) {
        add(p)
        setQ('')
      } else onScan(q)
    } else if (e.key === 'Escape' && q) {
      e.stopPropagation()
      setQ('')
    }
  }

  const setLine = (productId: string, changes: Partial<PurchaseLine>) => set({ lines: draft.lines.map((l) => (l.productId === productId ? { ...l, ...changes } : l)) })
  const removeLine = (productId: string) => set({ lines: draft.lines.filter((l) => l.productId !== productId) })

  const total = purchaseTotal(draft.lines.filter((l) => l.qty > 0))
  const paid = draft.paidInFull ? total : Math.min(draft.paid ?? 0, total)
  const units = draft.lines.reduce((a, l) => a + Math.max(0, l.qty), 0)
  const badLines = draft.lines.filter((l) => !(l.qty > 0))
  const badCost = draft.lines.some((l) => !(l.cost >= 0))
  // Lines kept in the draft for products deleted since (here or on another terminal).
  const deletedLines = draft.lines.some((l) => !byId.has(l.productId))
  const paidError = !draft.paidInFull && draft.paid !== undefined && (draft.paid < 0 || draft.paid > total)
  const canSave = draft.lines.length > 0 && !badLines.length && !badCost && !deletedLines && !paidError
  const saveError = !draft.lines.length ? t('purchases.noLines') : badLines.length ? t('purchases.badQty') : badCost ? t('purchases.badCost') : deletedLines ? t('purchases.deletedLines') : paidError ? t('purchases.badPaid') : undefined

  const save = async () => {
    setTried(true)
    if (!canSave || busy) return
    setBusy(true)
    try {
      // Draft lines can be days old: record the products' current names.
      const lines = draft.lines.map((l) => ({ ...l, name: byId.get(l.productId)?.name ?? l.name }))
      const doc = await savePurchase({ supplierId: draft.supplierId || undefined, invoiceNo: draft.invoiceNo, note: draft.note, lines, paid, updateCost: draft.updateCost })
      setDraft(EMPTY)
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      toast(t('purchases.saved', { number: doc.number, count: doc.lines.length }))
      navigate(`inventory/purchases/${doc.id}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    if (draft.lines.length && !(await confirmDialog({ title: t('purchases.discardTitle'), message: t('purchases.discardMessage'), danger: true, confirmLabel: t('purchases.discard') }))) return
    setDraft(EMPTY)
    navigate('inventory/purchases')
  }

  const details = (
    <Card className="p-4 sm:p-5 lg:col-start-2 lg:row-start-1">
      <div className="space-y-4">
        <div>
          <Label>{t('common:supplier')}</Label>
          <div className="flex gap-2">
            <Select
              value={draft.supplierId}
              onChange={(e) => set({ supplierId: e.target.value })}
              placeholder={t('purchases.noSupplier')}
              options={(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))}
              wrapperClassName="min-w-0 flex-1"
              aria-label={t('common:supplier')}
            />
            <Button size="icon-lg" className="size-11" onClick={() => setNewSupplier(true)} aria-label={t('suppliers.new')} title={t('suppliers.new')}>
              <Plus className="size-5" />
            </Button>
          </div>
        </div>
        <Input label={t('purchases.invoiceNo')} value={draft.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} placeholder={t('common:optional')} maxLength={60} />
        <Textarea label={t('common:note')} value={draft.note} onChange={(e) => set({ note: e.target.value })} rows={2} maxLength={300} />
      </div>
    </Card>
  )

  const summary = (
    <Card className="h-fit p-4 sm:p-5 lg:sticky lg:top-0 lg:col-start-2 lg:row-start-2">
      <div className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-muted">{t('common:total')}</div>
            <div className="tnum text-2xl font-semibold tracking-tight">{formatMoney(total)}</div>
          </div>
          <div className="text-end text-xs text-muted">
            {t('purchases.lines', { count: draft.lines.length })}
            <br />
            {t('purchases.units', { qty: formatQty(units) })}
          </div>
        </div>
        <Checkbox checked={draft.updateCost} onChange={(v) => set({ updateCost: v })} label={t('purchases.updateCost')} />
        <Toggle checked={draft.paidInFull} onChange={(v) => set({ paidInFull: v, paid: v ? undefined : draft.paid })} label={t('purchases.paidInFull')} />
        {!draft.paidInFull && (
          <MoneyInput
            label={t('purchases.paidAmount')}
            value={draft.paid}
            onChange={(v) => set({ paid: v })}
            placeholder="0"
            error={paidError ? t('purchases.badPaid') : undefined}
            hint={total - paid > 0 ? t('purchases.dueHint', { amount: formatMoney(total - paid) }) : undefined}
          />
        )}
        {tried && saveError && <p className="text-sm font-medium text-danger">{saveError}</p>}
        <Button variant="primary" size="lg" block onClick={save} loading={busy} icon={<Truck className="size-5" />}>
          {t('purchases.receive')}
        </Button>
      </div>
    </Card>
  )

  return (
    <Page>
      <PageHeader
        title={t('purchases.newTitle')}
        subtitle={t('purchases.newSubtitle')}
        onBack={() => navigate('inventory/purchases')}
        actions={
          (draft.lines.length > 0 || draft.supplierId || draft.invoiceNo) && (
            <Button variant="ghost" onClick={discard} className="text-danger">
              {t('purchases.discard')}
            </Button>
          )
        }
      />
      <PageBody>
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:gap-5">
          {details}

          <Card className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <CardHeader title={t('purchases.items')} subtitle={t('purchases.itemsHint')} />
            <div className="relative border-b border-border p-3 sm:p-4">
              <div className="flex gap-2">
                <SearchInput
                  ref={searchRef}
                  value={q}
                  onChange={setQ}
                  onKeyDown={onSearchKey}
                  placeholder={t('purchases.searchProduct')}
                  className="flex-1"
                  autoComplete="off"
                  enterKeyHint="search"
                  role="combobox"
                  aria-expanded={matches.length > 0}
                  aria-controls="purchase-matches"
                />
                <Button size="icon-lg" onClick={() => setCamera(true)} aria-label={t('sell:scanWithCamera')} title={t('sell:scanWithCamera')}>
                  <ScanLine className="size-5" />
                </Button>
              </div>
              {matches.length > 0 && (
                <ul id="purchase-matches" role="listbox" className="animate-pop absolute inset-x-3 top-full z-20 -mt-1 overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-pop sm:inset-x-4">
                  {matches.map((p, i) => (
                    <li key={p.id} role="option" aria-selected={i === hi}>
                      <button
                        onMouseEnter={() => setHi(i)}
                        onClick={() => {
                          add(p)
                          setQ('')
                          searchRef.current?.focus()
                        }}
                        className={cn('flex w-full items-center gap-3 px-3 py-2 text-start', i === hi && 'bg-surface-3')}
                      >
                        <ProductThumb product={p} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="block truncate text-xs text-muted">{[p.sku, p.barcode].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="text-end text-xs text-muted">
                          <span className="tnum block font-medium text-fg">{formatMoney(p.cost)}</span>
                          {p.trackStock && t('purchases.inStock', { qty: formatQty(p.stock) })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!draft.lines.length ? (
              <EmptyState icon={<PackagePlus />} title={t('purchases.noLinesTitle')} description={t('purchases.noLinesHint')} className="py-12" />
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_110px_140px_110px_40px] gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
                  <span>{t('common:product')}</span>
                  <span>{t('common:qty')}</span>
                  <span>{t('purchases.unitCost')}</span>
                  <span className="text-end">{t('common:amount')}</span>
                  <span />
                </div>
                <ul className="divide-y divide-border">
                  {draft.lines.map((l) => {
                    const p = byId.get(l.productId)
                    const costChanged = draft.updateCost && p && p.cost !== l.cost
                    return (
                      <li
                        key={l.productId}
                        className={cn(
                          'grid grid-cols-[1fr_1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors md:grid-cols-[minmax(0,1fr)_110px_140px_110px_40px] md:items-center',
                          flash === l.productId && 'bg-primary-soft',
                        )}
                      >
                        <div className="col-span-2 min-w-0 md:col-span-1">
                          <div className="truncate font-medium">{l.name}</div>
                          <div className="truncate text-xs text-muted">
                            {!p ? <span className="font-medium text-danger">{t('overview.deletedProduct')}</span> : p.trackStock ? t('purchases.inStock', { qty: formatQty(p.stock) }) : t('products:stock.untracked')}
                            {costChanged && <span className="text-warning"> · {t('purchases.costWas', { cost: formatMoney(p.cost) })}</span>}
                          </div>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => removeLine(l.productId)} aria-label={t('common:remove')} title={t('common:remove')} className="col-start-3 row-start-1 md:col-start-5">
                          <Trash2 className="size-4 text-danger" />
                        </Button>
                        <NumberInput
                          aria-label={t('common:qty')}
                          value={l.qty}
                          onChange={(v) => setLine(l.productId, { qty: v ?? 0 })}
                          onFocus={(e) => e.target.select()}
                          className={cn('h-10 text-end', tried && !(l.qty > 0) && 'border-danger')}
                          wrapperClassName="md:col-start-2 md:row-start-1"
                        />
                        <MoneyInput
                          aria-label={t('purchases.unitCost')}
                          value={l.cost}
                          onChange={(v) => setLine(l.productId, { cost: v ?? 0 })}
                          onFocus={(e) => e.target.select()}
                          className={cn('h-10 text-end', !(l.cost >= 0) && 'border-danger')}
                          wrapperClassName="md:col-start-3 md:row-start-1"
                        />
                        <div className="tnum min-w-20 text-end text-sm font-semibold md:col-start-4 md:row-start-1">
                          {formatMoney(lineTotal(l))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </Card>

          {summary}
        </div>
      </PageBody>

      <SupplierDialog open={newSupplier} onClose={() => setNewSupplier(false)} onSaved={(s) => set({ supplierId: s.id })} />
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={onScan} />
    </Page>
  )
}
