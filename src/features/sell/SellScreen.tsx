import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, Keyboard } from 'lucide-react'
import type { CartLine, CartState, Product, Sale } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney } from '@/lib/money'
import { uuid } from '@/lib/uuid'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { useCart } from '@/stores/cart'
import { useDevice } from '@/stores/device'
import { useSession } from '@/stores/session'
import { useSettings } from '@/stores/settings'
import { confirmDialog, toast } from '@/stores/ui'
import { Button, Kbd, Modal } from '@/components/ui'
import { navigate } from '@/router'
import { requirePermission } from '@/features/auth/permission'
import { OpenShiftDialog } from '@/features/shifts/OpenShiftDialog'
import { CartPanel, type CartActions } from './CartPanel'
import { ProductPanel } from './ProductPanel'
import { PaymentDialog } from './PaymentDialog'
import { ReceiptDialog } from './ReceiptDialog'
import { CameraScanner } from './CameraScanner'
import { RefundLookup } from './RefundLookup'
import { CustomItemDialog, CustomerPicker, DiscountDialog, HeldOrdersDialog, NoteDialog, NumberDialog, holdCurrentCart, isCountUnit } from './dialogs'
import { calcCart, completeSale, voidSale } from './checkout'
import { findByCode } from './lookup'
import { beep, useScanner } from './useScanner'

type Dialog =
  | { kind: 'qty'; lineId: string }
  | { kind: 'price'; lineId: string }
  | { kind: 'weigh'; product: Product; price?: number }
  | { kind: 'openPrice'; product: Product }
  | { kind: 'discount'; lineId?: string }
  | { kind: 'note' }
  | { kind: 'lineNote'; lineId: string }
  | { kind: 'customer' }
  | { kind: 'held' }
  | { kind: 'custom' }
  | { kind: 'pay' }
  | { kind: 'camera' }
  | { kind: 'shortcuts' }
  | { kind: 'openShift' }
  | { kind: 'refund' }

export default function SellScreen() {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const settings = useSettings((s) => s.settings)
  const logout = useSession((s) => s.logout)
  const cartSide = useDevice((s) => s.cartSide)
  const sound = useDevice((s) => s.sound)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  /** The cart that became `receipt`, for "Back to edit". */
  const [receiptCart, setReceiptCart] = useState<CartState | null>(null)
  const [mobileCart, setMobileCart] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const paying = useRef(false)
  const lastCharAt = useRef(0)
  const calc = useMemo(() => calcCart(cart), [cart])
  const close = useCallback(() => setDialog(null), [])

  const stockError = useCallback(
    (name: string) => {
      if (sound) beep(false)
      toast(t('outOfStock', { name }), 'error')
    },
    [sound, t],
  )

  /** With negative stock disallowed, checks the cart (optionally with one line's new qty) against stock. */
  const fitsStock = useCallback(
    async (lines: CartLine[]): Promise<boolean> => {
      if (useSettings.getState().settings.allowNegativeStock) return true
      const want = new Map<string, number>()
      for (const l of lines) if (l.productId) want.set(l.productId, (want.get(l.productId) ?? 0) + l.qty)
      for (const [id, qty] of want) {
        if (qty <= 0) continue
        const p = await db.products.get(id)
        if (p?.trackStock && qty > p.stock + 1e-9) {
          stockError(p.name)
          return false
        }
      }
      return true
    },
    [stockError],
  )

  // Quantity changes run one after another: the stock check is async, and pressing + five
  // times quickly must add five, not read the same starting quantity five times.
  const qtyQueue = useRef<Promise<unknown>>(Promise.resolve())
  const queueQty = useCallback((fn: () => Promise<void> | void) => {
    const next = qtyQueue.current.then(fn)
    qtyQueue.current = next.catch(() => undefined)
    return next
  }, [])

  const applyQty = useCallback(
    async (lineId: string, qty: number) => {
      const lines = useCart.getState().lines
      const line = lines.find((l) => l.id === lineId)
      if (!line || qty === line.qty) return
      if (qty > line.qty && !(await fitsStock(lines.map((l) => (l.id === lineId ? { ...l, qty } : l))))) return
      useCart.getState().setQty(lineId, qty)
    },
    [fitsStock],
  )

  const setLineQty = useCallback((lineId: string, qty: number) => queueQty(() => applyQty(lineId, qty)), [queueQty, applyQty])

  const stepQty = useCallback(
    (lineId: string, delta: number) =>
      void queueQty(async () => {
        const line = useCart.getState().lines.find((l) => l.id === lineId)
        if (!line) return
        const next = Math.round((line.qty + delta) * 1000) / 1000
        // Stepping down stops at zero (removes the line): 0.5 kg − 1 must not become a −0.5 kg return.
        if (line.qty > 0 && next <= 0) return useCart.getState().removeLine(lineId)
        await applyQty(lineId, next)
      }),
    [queueQty, applyQty],
  )

  const addProduct = useCallback(
    (p: Product, qty?: number, price?: number) => {
      const s = useSettings.getState().settings
      if (p.openPrice && price === undefined) return setDialog({ kind: 'openPrice', product: p })
      if (p.weighed && qty === undefined) return setDialog({ kind: 'weigh', product: p, price })
      const want = qty ?? 1
      if (p.trackStock && !s.allowNegativeStock && want > 0) {
        const inCart = useCart.getState().lines.filter((l) => l.productId === p.id).reduce((a, l) => a + l.qty, 0)
        if (p.stock - inCart < want - 1e-9) return stockError(p.name)
      }
      useCart.getState().addProduct(p, want, price)
      if (sound) beep(true)
    },
    [sound, stockError],
  )

  // Unknown code: offer to create the product with this barcode (if allowed).
  const notFound = useCallback(
    (code: string) => {
      if (sound) beep(false)
      const canAdd = useSession.getState().can('products_manage')
      toast(t('notFound', { code }), 'error', canAdd ? { label: t('addProduct'), onClick: () => navigate(`products?new=1&barcode=${encodeURIComponent(code)}`) } : undefined)
    },
    [sound, t],
  )

  const onScan = useCallback(
    async (code: string) => {
      const hit = await findByCode(code)
      if (hit) addProduct(hit.product, hit.qty, hit.price)
      else notFound(code)
    },
    [addProduct, notFound],
  )
  useScanner(onScan, !dialog && !receipt)

  // "Back to edit" on the receipt: the sale is already saved (numbered, stock taken), so it is voided,
  // which keeps the invoice on record as voided, and its cart comes back to fix and charge again.
  const editLastSale = async () => {
    const sale = receipt
    const before = receiptCart
    if (!sale || !before) return
    if (!(await requirePermission('void'))) return
    const ok = await confirmDialog({ title: t('editSaleTitle', { number: sale.number }), message: t('editSaleMessage'), confirmLabel: t('editSaleConfirm'), danger: true })
    if (!ok) return
    try {
      await voidSale(sale, t('sales:void.reasons.mistake'))
    } catch (e) {
      toast(errorMessage(e), 'error')
      return
    }
    useCart.getState().load(before)
    setReceipt(null)
    setReceiptCart(null)
    toast(t('editSaleDone', { number: sale.number }))
  }

  const onEnter = async (q: string, matches: Product[]) => {
    const hit = await findByCode(q)
    if (hit) {
      addProduct(hit.product, hit.qty, hit.price)
      return true
    }
    if (matches.length === 1) {
      addProduct(matches[0])
      return true
    }
    if (!matches.length) notFound(q)
    return false
  }

  const pay = async () => {
    // One checkout at a time: F12 pressed again while a prompt is resolving must not sell twice.
    if (paying.current) return
    const c = useCart.getState()
    if (!c.lines.length) return
    // Read the live shift: pay() also runs right after the shift dialog opens one.
    if (settings.requireShift && !useSession.getState().shift) return setDialog({ kind: 'openShift' })
    paying.current = true
    try {
      const current = calcCart(c)
      if (!Number.isSafeInteger(current.total)) return toast(t('amountTooLarge'), 'error')
      // Stock may have been sold elsewhere (or quantities raised) since the items were added.
      if (!(await fitsStock(c.lines))) return
      // Returned items (negative quantities) are a refund, even inside a positive sale.
      if (c.lines.some((l) => l.qty < 0) && !(await requirePermission('refund'))) return
      if (current.total < 0) {
        // Return without receipt: pay the customer back in cash.
        if (!(await confirmDialog({ title: t('refundCash', { amount: formatMoney(-current.total) }), confirmLabel: t('refund') }))) return
        const customer = c.customerId ? await db.customers.get(c.customerId) : undefined
        const sale = await completeSale(useCart.getState().snapshot(), [{ id: uuid(), method: 'cash', amount: current.total }], customer)
        useCart.getState().clear()
        setReceipt(sale)
        return
      }
      setMobileCart(false)
      setDialog({ kind: 'pay' })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      paying.current = false
    }
  }

  const actions: CartActions = {
    onPay: pay,
    onCustomer: () => setDialog({ kind: 'customer' }),
    onDiscount: async (lineId) => (await requirePermission('discount')) && setDialog({ kind: 'discount', lineId }),
    onQty: (lineId) => setDialog({ kind: 'qty', lineId }),
    onStep: stepQty,
    onPrice: async (lineId) => (await requirePermission('price_override')) && setDialog({ kind: 'price', lineId }),
    onLineNote: (lineId) => setDialog({ kind: 'lineNote', lineId }),
    onNote: () => setDialog({ kind: 'note' }),
    onHold: async () => {
      if (await holdCurrentCart()) toast(t('held'))
    },
    onRecall: () => setDialog({ kind: 'held' }),
    onRefund: () => setDialog({ kind: 'refund' }),
    onShortcuts: () => setDialog({ kind: 'shortcuts' }),
  }

  // Keyboard shortcuts (desktop). Ignored while a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      const s = useCart.getState()
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      const searchEmpty = !searchRef.current?.value
      const sel = s.selectedId
      // Barcode scanners "type" a whole code within milliseconds. A "-" or "+" inside such a burst
      // (e.g. SKU-0017) is part of the code, not a quantity shortcut on the selected line.
      const now = performance.now()
      const inBurst = !e.repeat && now - lastCharAt.current < 35
      if (e.key.length === 1) lastCharAt.current = now
      const handled = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      switch (e.key) {
        case 'F1': return handled(() => setDialog({ kind: 'shortcuts' }))
        case 'F2': return handled(() => searchRef.current?.focus())
        case 'F3': return handled(actions.onCustomer)
        case 'F4': return handled(() => void actions.onDiscount(sel))
        case 'F5': return handled(() => sel && actions.onQty(sel))
        case 'F6': return handled(() => void actions.onHold())
        case 'F7': return handled(actions.onRecall)
        case 'F8': return handled(actions.onNote)
        case 'F9': return handled(() => setDialog({ kind: 'custom' }))
        case 'F10': return handled(actions.onRefund)
        case 'F12': return handled(() => void pay())
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return handled(() => void pay())
      if (e.key.toLowerCase() === 'l' && (e.ctrlKey || e.metaKey)) return handled(logout)
      if (inField && !searchEmpty) return
      if (inField && e.target !== searchRef.current) return
      if (!s.lines.length) return
      const idx = s.lines.findIndex((l) => l.id === sel)
      if (e.key === 'ArrowDown') return handled(() => s.select(s.lines[Math.min(idx + 1, s.lines.length - 1)]?.id))
      if (e.key === 'ArrowUp') return handled(() => s.select(s.lines[Math.max(idx < 0 ? s.lines.length - 1 : idx - 1, 0)]?.id))
      if (!sel || inBurst) return
      if (e.key === '+' || (e.key === '=' && e.shiftKey)) return handled(() => stepQty(sel, 1))
      if (e.key === '-') return handled(() => stepQty(sel, -1))
      if (e.key === 'Delete') return handled(() => s.removeLine(sel))
      if (e.key === '*') return handled(() => actions.onQty(sel))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Keep focus in the search box on desktop so typing/scanning always lands there.
  useEffect(() => {
    if (!dialog && !receipt && matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
  }, [dialog, receipt])

  const line = (id: string) => cart.lines.find((l) => l.id === id)
  const count = cart.lines.reduce((a, l) => a + Math.abs(l.qty), 0)

  return (
    <div className={cn('flex h-full min-h-0', cartSide === 'left' && 'flex-row-reverse')}>
      <div className="min-w-0 flex-1">
        <ProductPanel
          onProduct={(p) => {
            addProduct(p)
            // Tapping a tile moves focus to it; on desktop put it back so typing/scanning keeps working.
            if (!p.openPrice && !p.weighed && matchMedia('(pointer: fine)').matches) searchRef.current?.focus()
          }}
          onEnter={onEnter} searchRef={searchRef} onCamera={() => setDialog({ kind: 'camera' })} onCustomItem={() => setDialog({ kind: 'custom' })} />
      </div>

      <CartPanel actions={actions} className={cn('hidden w-[380px] shrink-0 border-border lg:flex xl:w-[420px]', cartSide === 'left' ? 'border-e' : 'border-s')} />

      {/* Phone & portrait tablet: floating cart summary */}
      <div className="fixed inset-x-3 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 md:bottom-4 lg:hidden">
        <button onClick={() => setMobileCart(true)} className="flex w-full items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-primary-fg shadow-pop active:scale-[0.99]">
          <span className="tnum flex size-9 items-center justify-center rounded-xl bg-white/20 text-sm font-bold">{Math.round(count * 100) / 100}</span>
          <span className="flex-1 text-start font-semibold">{cart.lines.length ? t('viewCart') : t('emptyCart')}</span>
          <span className="tnum text-lg font-extrabold">{formatMoney(calc.total)}</span>
          <ChevronUp className="size-5" />
        </button>
      </div>
      <Modal open={mobileCart} onClose={() => setMobileCart(false)} title={t('currentSale')} size="lg" flush className="h-[94dvh]">
        <CartPanel actions={actions} className="h-full" />
      </Modal>

      {/* Dialogs */}
      <NumberDialog
        open={dialog?.kind === 'qty'}
        onClose={close}
        title={t('quantity')}
        subtitle={dialog?.kind === 'qty' ? line(dialog.lineId)?.name : undefined}
        initial={dialog?.kind === 'qty' ? line(dialog.lineId)?.qty ?? 1 : 1}
        allowNegative
        integer={dialog?.kind === 'qty' && isCountUnit(line(dialog.lineId)?.unit)}
        onSubmit={(v) => dialog?.kind === 'qty' && void setLineQty(dialog.lineId, v)}
      />
      <NumberDialog
        open={dialog?.kind === 'price'}
        onClose={close}
        title={t('changePrice')}
        subtitle={dialog?.kind === 'price' ? line(dialog.lineId)?.name : undefined}
        initial={dialog?.kind === 'price' ? line(dialog.lineId)?.price ?? 0 : 0}
        money
        onSubmit={(v) => dialog?.kind === 'price' && cart.setPrice(dialog.lineId, v)}
      />
      <NumberDialog
        open={dialog?.kind === 'weigh'}
        onClose={close}
        title={t('enterWeight')}
        subtitle={dialog?.kind === 'weigh' ? `${dialog.product.name} · ${formatMoney(dialog.price ?? dialog.product.price)}/${t(`common:unit.${dialog.product.unit}`)}` : undefined}
        initial={1}
        onSubmit={(v) => dialog?.kind === 'weigh' && v > 0 && addProduct(dialog.product, v, dialog.price)}
      />
      <NumberDialog
        open={dialog?.kind === 'openPrice'}
        onClose={close}
        title={t('enterPrice')}
        subtitle={dialog?.kind === 'openPrice' ? dialog.product.name : undefined}
        initial={dialog?.kind === 'openPrice' ? dialog.product.price : 0}
        money
        onSubmit={(v) => dialog?.kind === 'openPrice' && addProduct(dialog.product, undefined, v)}
      />
      <DiscountDialog open={dialog?.kind === 'discount'} onClose={close} line={dialog?.kind === 'discount' && dialog.lineId ? line(dialog.lineId) : undefined} />
      <NoteDialog open={dialog?.kind === 'note'} onClose={close} title={t('saleNote')} initial={cart.note} onSave={(v) => cart.setNote(v)} />
      <NoteDialog
        open={dialog?.kind === 'lineNote'}
        onClose={close}
        title={t('note')}
        initial={dialog?.kind === 'lineNote' ? line(dialog.lineId)?.note : ''}
        onSave={(v) => dialog?.kind === 'lineNote' && cart.setLineNote(dialog.lineId, v)}
      />
      <CustomerPicker open={dialog?.kind === 'customer'} onClose={close} />
      <HeldOrdersDialog open={dialog?.kind === 'held'} onClose={close} />
      <CustomItemDialog open={dialog?.kind === 'custom'} onClose={close} />
      <CameraScanner open={dialog?.kind === 'camera'} onClose={close} onScan={onScan} />
      <OpenShiftDialog open={dialog?.kind === 'openShift'} onClose={close} onOpened={() => setTimeout(() => void pay(), 0)} />
      <RefundLookup open={dialog?.kind === 'refund'} onClose={close} />
      <PaymentDialog
        open={dialog?.kind === 'pay'}
        onClose={close}
        onNeedCustomer={() => setDialog({ kind: 'customer' })}
        onComplete={(sale, before) => {
          setDialog(null)
          setReceipt(sale)
          setReceiptCart(before)
        }}
      />
      <ReceiptDialog
        sale={receipt}
        onClose={() => {
          setReceipt(null)
          setReceiptCart(null)
          if (settings.lockAfterSale) logout()
        }}
        onEdit={receipt && receiptCart && receipt.type === 'sale' ? editLastSale : undefined}
      />
      <ShortcutsDialog open={dialog?.kind === 'shortcuts'} onClose={close} />
    </div>
  )
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const rows: Array<[string, string]> = [
    ['F1', t('shortcuts.help')],
    ['F2', t('shortcuts.search')],
    ['F3', t('shortcuts.customer')],
    ['F4', t('shortcuts.discount')],
    ['F5 / *', t('shortcuts.quantity')],
    ['F6', t('shortcuts.hold')],
    ['F7', t('shortcuts.recall')],
    ['F8', t('shortcuts.note')],
    ['F9', t('shortcuts.custom')],
    ['F10', t('shortcuts.refund')],
    ['F12 / Ctrl+Enter', t('shortcuts.pay')],
    ['↑ ↓', t('shortcuts.select')],
    ['+ / −', t('shortcuts.qtyStep')],
    ['Del', t('shortcuts.remove')],
    ['Ctrl+L', t('shortcuts.lock')],
  ]
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Keyboard className="size-5" /> {t('shortcuts.title')}</span>} size="md">
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, label]) => (
          <li key={k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <Kbd className="inline-block">{k}</Kbd>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-subtle">{t('shortcuts.scannerHint')}</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>{t('common:close')}</Button>
      </div>
    </Modal>
  )
}
