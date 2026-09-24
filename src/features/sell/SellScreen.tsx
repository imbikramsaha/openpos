import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, Keyboard } from 'lucide-react'
import type { Product, Sale } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney } from '@/lib/money'
import { uuid } from '@/lib/uuid'
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
import { CustomItemDialog, CustomerPicker, DiscountDialog, HeldOrdersDialog, NoteDialog, NumberDialog, holdCurrentCart } from './dialogs'
import { calcCart, completeSale } from './checkout'
import { findByCode } from './lookup'
import { beep, useScanner } from './useScanner'

type Dialog =
  | { kind: 'qty'; lineId: string }
  | { kind: 'price'; lineId: string }
  | { kind: 'weigh'; product: Product }
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
  const shift = useSession((s) => s.shift)
  const logout = useSession((s) => s.logout)
  const cartSide = useDevice((s) => s.cartSide)
  const sound = useDevice((s) => s.sound)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [receipt, setReceipt] = useState<Sale | null>(null)
  const [mobileCart, setMobileCart] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const calc = useMemo(() => calcCart(cart), [cart])
  const close = useCallback(() => setDialog(null), [])

  const addProduct = useCallback(
    (p: Product, qty?: number, price?: number) => {
      const s = useSettings.getState().settings
      if (p.openPrice && price === undefined) return setDialog({ kind: 'openPrice', product: p })
      if (p.weighed && qty === undefined) return setDialog({ kind: 'weigh', product: p })
      const want = qty ?? 1
      if (p.trackStock && !s.allowNegativeStock && want > 0) {
        const inCart = useCart.getState().lines.filter((l) => l.productId === p.id).reduce((a, l) => a + l.qty, 0)
        if (p.stock - inCart < want) {
          if (sound) beep(false)
          return toast(t('outOfStock', { name: p.name }), 'error')
        }
      }
      useCart.getState().addProduct(p, want, price)
      if (sound) beep(true)
    },
    [sound, t],
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
    if (!cart.lines.length) return
    if (settings.requireShift && !shift) return setDialog({ kind: 'openShift' })
    if (calc.total < 0) {
      // Return without receipt: pay the customer back in cash.
      if (!(await requirePermission('refund'))) return
      if (!(await confirmDialog({ title: t('refundCash', { amount: formatMoney(-calc.total) }), confirmLabel: t('refund') }))) return
      const customer = cart.customerId ? await db.customers.get(cart.customerId) : undefined
      const sale = await completeSale(cart.snapshot(), [{ id: uuid(), method: 'cash', amount: calc.total }], customer)
      cart.clear()
      setReceipt(sale)
      return
    }
    setMobileCart(false)
    setDialog({ kind: 'pay' })
  }

  const actions: CartActions = {
    onPay: pay,
    onCustomer: () => setDialog({ kind: 'customer' }),
    onDiscount: async (lineId) => (await requirePermission('discount')) && setDialog({ kind: 'discount', lineId }),
    onQty: (lineId) => setDialog({ kind: 'qty', lineId }),
    onPrice: async (lineId) => (await requirePermission('price_override')) && setDialog({ kind: 'price', lineId }),
    onLineNote: (lineId) => setDialog({ kind: 'lineNote', lineId }),
    onNote: () => setDialog({ kind: 'note' }),
    onHold: async () => {
      if (await holdCurrentCart()) toast(t('held'))
    },
    onRecall: () => setDialog({ kind: 'held' }),
    onRefund: async () => (await requirePermission('refund')) && setDialog({ kind: 'refund' }),
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
      const handled = (fn: () => void) => {
        e.preventDefault()
        fn()
      }
      switch (e.key) {
        case 'F1': return handled(() => setDialog({ kind: 'shortcuts' }))
        case 'F2': return handled(() => searchRef.current?.focus())
        case 'F3': return handled(actions.onCustomer)
        case 'F4': return handled(() => void actions.onDiscount(sel))
        case 'F5': return sel && handled(() => actions.onQty(sel))
        case 'F6': return handled(() => void actions.onHold())
        case 'F7': return handled(actions.onRecall)
        case 'F8': return handled(actions.onNote)
        case 'F9': return handled(() => setDialog({ kind: 'custom' }))
        case 'F10': return handled(() => void actions.onRefund())
        case 'F12': return handled(() => void pay())
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return handled(() => void pay())
      if (e.key === 'l' && (e.ctrlKey || e.metaKey)) return handled(logout)
      if (inField && !searchEmpty) return
      if (inField && e.target !== searchRef.current) return
      if (!s.lines.length) return
      const idx = s.lines.findIndex((l) => l.id === sel)
      if (e.key === 'ArrowDown') return handled(() => s.select(s.lines[Math.min(idx + 1, s.lines.length - 1)]?.id))
      if (e.key === 'ArrowUp') return handled(() => s.select(s.lines[Math.max(idx < 0 ? s.lines.length - 1 : idx - 1, 0)]?.id))
      if (!sel) return
      if (e.key === '+' || (e.key === '=' && e.shiftKey)) return handled(() => s.incQty(sel, 1))
      if (e.key === '-') return handled(() => s.incQty(sel, -1))
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
        <ProductPanel onProduct={(p) => addProduct(p)} onEnter={onEnter} searchRef={searchRef} onCamera={() => setDialog({ kind: 'camera' })} onCustomItem={() => setDialog({ kind: 'custom' })} />
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
        onSubmit={(v) => dialog?.kind === 'qty' && cart.setQty(dialog.lineId, v)}
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
        subtitle={dialog?.kind === 'weigh' ? `${dialog.product.name} · ${formatMoney(dialog.product.price)}/${dialog.product.unit}` : undefined}
        initial={1}
        onSubmit={(v) => dialog?.kind === 'weigh' && v > 0 && addProduct(dialog.product, v)}
      />
      <NumberDialog
        open={dialog?.kind === 'openPrice'}
        onClose={close}
        title={t('enterPrice')}
        subtitle={dialog?.kind === 'openPrice' ? dialog.product.name : undefined}
        initial={dialog?.kind === 'openPrice' ? dialog.product.price : 0}
        money
        onSubmit={(v) => dialog?.kind === 'openPrice' && addProduct(dialog.product, dialog.product.weighed ? undefined : 1, v)}
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
      <OpenShiftDialog open={dialog?.kind === 'openShift'} onClose={close} />
      <RefundLookup open={dialog?.kind === 'refund'} onClose={close} />
      <PaymentDialog
        open={dialog?.kind === 'pay'}
        onClose={close}
        onNeedCustomer={() => setDialog({ kind: 'customer' })}
        onComplete={(sale) => {
          setDialog(null)
          setReceipt(sale)
        }}
      />
      <ReceiptDialog
        sale={receipt}
        onClose={() => {
          setReceipt(null)
          if (settings.lockAfterSale) logout()
        }}
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
