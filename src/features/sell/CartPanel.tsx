import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  Ban, ChevronDown, Keyboard, MonitorSmartphone, Inbox, Minus, MoreVertical, NotebookPen, PauseCircle, Percent, PlayCircle, Plus, ReceiptText,
  ShoppingBag, Tag, Trash2, Undo2, UserRound, Utensils, Vault,
} from 'lucide-react'
import type { CartLine, OrderType } from '@/core/types'
import { gstSplit } from '@/core/cart'
import { db } from '@/db/db'
import { formatMoney, formatPercent, formatQty } from '@/lib/money'
import { cn } from '@/lib/cn'
import { isElectron, electron } from '@/lib/platform'
import { useCart } from '@/stores/cart'
import { useSettings } from '@/stores/settings'
import { useSession } from '@/stores/session'
import { useDevice } from '@/stores/device'
import { confirmDialog, toast } from '@/stores/ui'
import { Avatar, Badge, Button, Kbd } from '@/components/ui'
import { audit } from '@/db/repo'
import { calcCart } from './checkout'
import { openCustomerDisplay } from '@/features/display/channel'

export interface CartActions {
  onPay: () => void
  onCustomer: () => void
  onDiscount: (lineId?: string) => void
  onQty: (lineId: string) => void
  /** ± buttons: step the quantity (stock-checked, never crosses zero). */
  onStep: (lineId: string, delta: number) => void
  onPrice: (lineId: string) => void
  onLineNote: (lineId: string) => void
  onNote: () => void
  onHold: () => void
  onRecall: () => void
  onRefund: () => void
  onShortcuts: () => void
}

export function CartPanel({ actions, className }: { actions: CartActions; className?: string }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const settings = useSettings((s) => s.settings)
  const shift = useSession((s) => s.shift)
  const calc = useMemo(() => calcCart(cart), [cart])
  const customer = useLiveQuery(() => (cart.customerId ? db.customers.get(cart.customerId).then((c) => (c && !c.deleted ? c : undefined)) : undefined), [cart.customerId])
  const heldCount = useLiveQuery(async () => (await db.heldOrders.toArray()).filter((h) => !h.deleted).length, []) ?? 0
  const listRef = useRef<HTMLUListElement>(null)
  const [menu, setMenu] = useState(false)
  const [showTax, setShowTax] = useState(false)

  // Keep the selected line in view while scanning many items.
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cart.selectedId, cart.lines.length])

  const clear = async () => {
    if (!cart.lines.length) return
    if (await confirmDialog({ title: t('clearSale'), message: t('clearSaleHint'), danger: true, confirmLabel: t('clear') })) {
      void audit('cart.clear', 'cart', undefined, `${cart.lines.length} lines ${calc.total}`)
      cart.clear()
    }
  }

  const taxRows = settings.gstMode
    ? gstSplit(calc.taxBreakdown, !!cart.interState).map((r) => ({ label: `${r.label} ${formatPercent(r.rate)}`, tax: r.tax }))
    : calc.taxBreakdown.filter((b) => b.rate).map((b) => ({ label: b.name, tax: b.tax }))

  return (
    <section className={cn('flex h-full min-h-0 flex-col bg-surface', className)} aria-label={t('currentSale')}>
      {/* Header: customer + menu */}
      <div className="flex items-center gap-2 border-b border-border p-3">
        <button onClick={actions.onCustomer} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-start hover:bg-surface-3">
          {customer ? <Avatar name={customer.name} size="sm" /> : <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-muted"><UserRound className="size-4.5" /></span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{customer?.name ?? t('walkIn')}</span>
            <span className="block truncate text-xs text-muted">
              {customer ? [customer.phone, customer.balance > 0 && `${t('due')}: ${formatMoney(customer.balance)}`, settings.loyaltyEnabled && customer.loyaltyPoints > 0 && t('points', { count: customer.loyaltyPoints })].filter(Boolean).join(' · ') : t('addCustomer')}
            </span>
          </span>
          <Kbd>F3</Kbd>
        </button>
        <div className="relative">
          <Button size="icon" variant="ghost" onClick={() => setMenu((v) => !v)} aria-label={t('more')} aria-expanded={menu}>
            <MoreVertical className="size-5" />
          </Button>
          {menu && <CartMenu onClose={() => setMenu(false)} actions={actions} onClear={clear} />}
        </div>
      </div>

      {settings.orderTypes && <OrderTypeBar />}
      {settings.requireShift && !shift && (
        <div className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-xs font-medium text-warning">
          <Vault className="size-4" /> {t('noShiftOpen')}
        </div>
      )}

      {/* Lines */}
      <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {!cart.lines.length && (
          <li className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center text-muted">
            <ShoppingBag className="size-10 text-subtle" strokeWidth={1.5} />
            <span className="font-medium">{t('emptyCart')}</span>
            <span className="text-xs text-subtle">{t('emptyCartHint')}</span>
          </li>
        )}
        {cart.lines.map((l, i) => (
          <CartRow key={l.id} line={l} total={calc.lines[i]?.total ?? 0} discount={calc.lines[i]?.discount ?? 0} selected={l.id === cart.selectedId} actions={actions} />
        ))}
      </ul>

      {/* Totals */}
      <div className="border-t border-border bg-surface-2 px-4 pt-3 pb-2 text-sm">
        <Row label={t('subtotal')} value={formatMoney(calc.subtotal)} />
        {calc.discountTotal !== 0 && (
          <Row
            label={
              <button onClick={() => actions.onDiscount()} className="flex items-center gap-1 text-success">
                <Tag className="size-3.5" /> {t('discount')}
                {cart.discountType === 'percent' && cart.discountValue ? ` (${cart.discountValue}%)` : ''}
              </button>
            }
            value={<span className="text-success">−{formatMoney(calc.discountTotal)}</span>}
          />
        )}
        {calc.taxTotal !== 0 && (
          <>
            <Row
              label={
                <button onClick={() => setShowTax((v) => !v)} className="flex items-center gap-1">
                  {settings.pricesIncludeTax ? t('taxIncluded') : t('tax')}
                  <ChevronDown className={cn('size-3.5 transition-transform', showTax && 'rotate-180')} />
                </button>
              }
              value={formatMoney(calc.taxTotal)}
            />
            {showTax && taxRows.map((r) => <Row key={r.label} label={<span className="ps-4 text-xs">{r.label}</span>} value={<span className="text-xs">{formatMoney(r.tax)}</span>} />)}
          </>
        )}
        {calc.rounding !== 0 && <Row label={t('rounding')} value={formatMoney(calc.rounding)} />}
      </div>

      {/* Actions */}
      <div className="space-y-2 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-4 gap-2">
          <ActionButton icon={<Percent />} label={t('discount')} kbd="F4" onClick={() => actions.onDiscount(cart.selectedId)} disabled={!cart.lines.length} />
          <ActionButton icon={<PauseCircle />} label={t('hold')} kbd="F6" onClick={actions.onHold} disabled={!cart.lines.length} />
          <ActionButton icon={<PlayCircle />} label={t('recall')} kbd="F7" onClick={actions.onRecall} badge={heldCount || undefined} />
          <ActionButton icon={<Trash2 />} label={t('clear')} onClick={clear} disabled={!cart.lines.length} danger />
        </div>
        <Button variant="primary" size="xl" block onClick={actions.onPay} disabled={!cart.lines.length} className="justify-between">
          <span className="flex items-center gap-2">
            {t('pay')} <Kbd className="border-primary-fg/25 bg-primary-fg/10 text-primary-fg/75">F12</Kbd>
          </span>
          <span className="tnum text-2xl font-semibold tracking-tight">{formatMoney(calc.total)}</span>
        </Button>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-muted">
      <span>{label}</span>
      <span className="tnum font-medium text-fg">{value}</span>
    </div>
  )
}

function ActionButton({ icon, label, kbd, onClick, disabled, badge, danger }: { icon: ReactNode; label: string; kbd?: string; onClick: () => void; disabled?: boolean; badge?: number; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={kbd ? `${label} (${kbd})` : label}
      className={cn(
        'relative flex h-14 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-surface text-[11px] font-medium transition hover:border-border-strong hover:bg-surface-2 active:scale-95 disabled:opacity-40 [&>svg]:size-[1.15rem]',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {icon}
      <span className="max-w-full truncate px-1">{label}</span>
      {badge ? <span className="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white dark:text-bg">{badge}</span> : null}
    </button>
  )
}

function CartRow({ line, total, discount, selected, actions }: { line: CartLine; total: number; discount: number; selected: boolean; actions: CartActions }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  return (
    <li data-selected={selected} className={cn('border-b border-border transition-colors', selected ? 'bg-surface-3/70' : 'hover:bg-surface-2')}>
      <button onClick={() => cart.select(selected ? undefined : line.id)} className="flex w-full items-start gap-3 px-4 py-2.5 text-start">
        <span className={cn('tnum mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold', line.qty < 0 ? 'bg-danger-soft text-danger' : 'border border-border bg-surface text-fg')}>{formatQty(line.qty)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{line.name}</span>
          <span className="block truncate text-xs text-muted">
            <bdi>{formatQty(line.qty)}{line.unit !== 'pcs' ? ` ${t(`common:unit.${line.unit}`)}` : ''}</bdi> × <bdi>{formatMoney(line.price)}</bdi>
            {line.note && ` · ${line.note}`}
          </span>
        </span>
        <span className="flex flex-col items-end">
          <span className="tnum text-sm font-semibold">{formatMoney(total)}</span>
          {discount !== 0 && <span className="tnum text-[11px] font-medium text-success">−{formatMoney(discount)}</span>}
        </span>
      </button>
      {selected && (
        <div className="animate-fade flex items-center gap-1.5 px-4 pb-3">
          <div className="flex items-center rounded-xl border border-border bg-surface">
            <button onClick={() => actions.onStep(line.id, -1)} className="flex size-10 items-center justify-center rounded-s-xl hover:bg-surface-3" aria-label={t('decrease')}>
              <Minus className="size-4" />
            </button>
            <button onClick={() => actions.onQty(line.id)} className="tnum h-10 min-w-12 border-x border-border px-2 text-sm font-semibold hover:bg-surface-3" title={`${t('quantity')} (F5)`}>
              {formatQty(line.qty)}
            </button>
            <button onClick={() => actions.onStep(line.id, 1)} className="flex size-10 items-center justify-center rounded-e-xl hover:bg-surface-3" aria-label={t('increase')}>
              <Plus className="size-4" />
            </button>
          </div>
          <Button size="icon" onClick={() => actions.onDiscount(line.id)} aria-label={t('discount')} title={t('discount')}>
            <Percent className="size-4" />
          </Button>
          <Button size="icon" onClick={() => actions.onPrice(line.id)} aria-label={t('changePrice')} title={t('changePrice')}>
            <Tag className="size-4" />
          </Button>
          <Button size="icon" onClick={() => actions.onLineNote(line.id)} aria-label={t('note')} title={t('note')}>
            <NotebookPen className="size-4" />
          </Button>
          <div className="flex-1" />
          <Button size="icon" variant="ghost" onClick={() => cart.removeLine(line.id)} aria-label={t('removeItem')} title={`${t('removeItem')} (Del)`}>
            <Trash2 className="size-4 text-danger" />
          </Button>
        </div>
      )}
    </li>
  )
}

function OrderTypeBar() {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const types: Array<{ id: OrderType; icon: ReactNode }> = [
    { id: 'walkin', icon: <ShoppingBag className="size-4" /> },
    { id: 'dinein', icon: <Utensils className="size-4" /> },
    { id: 'takeaway', icon: <Inbox className="size-4" /> },
    { id: 'delivery', icon: <ReceiptText className="size-4" /> },
  ]
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex flex-1 gap-1 overflow-x-auto">
        {types.map((ty) => (
          <button
            key={ty.id}
            onClick={() => cart.setOrderType(ty.id, ty.id === 'dinein' ? cart.table : undefined)}
            className={cn('flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium whitespace-nowrap', (cart.orderType ?? 'walkin') === ty.id ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-3')}
          >
            {ty.icon} {t(`orderType.${ty.id}`)}
          </button>
        ))}
      </div>
      {cart.orderType === 'dinein' && (
        <input value={cart.table ?? ''} onChange={(e) => cart.setOrderType('dinein', e.target.value)} placeholder={t('table')} aria-label={t('table')} maxLength={20} className="h-8 w-20 rounded-lg border border-border bg-surface px-2 text-sm" />
      )}
    </div>
  )
}

function CartMenu({ onClose, actions, onClear }: { onClose: () => void; actions: CartActions; onClear: () => void }) {
  const { t } = useTranslation('sell')
  const cart = useCart()
  const gstMode = useSettings((s) => s.settings.gstMode)
  const printer = useDevice((s) => s.printer)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [onClose])
  const item = (icon: ReactNode, label: string, fn: () => void, kbd?: string, danger?: boolean) => (
    <button
      onClick={() => {
        onClose()
        fn()
      }}
      className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-surface-3 [&>svg]:size-4.5', danger && 'text-danger')}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  )
  return (
    <div ref={ref} className="animate-pop absolute end-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-2xl border border-border bg-surface py-1 shadow-pop">
      {item(<NotebookPen />, t('saleNote'), actions.onNote, 'F8')}
      {item(<Undo2 />, t('refund'), actions.onRefund)}
      {gstMode && item(<ReceiptText />, cart.interState ? t('intraState') : t('interState'), () => cart.setInterState(!cart.interState))}
      {isElectron() &&
        item(<Vault />, t('openDrawer'), async () => {
          const ok = await electron()?.openCashDrawer?.(printer || undefined)
          if (!ok) toast(t('drawerFailed'), 'error')
          else void audit('drawer.open')
        })}
      {item(<MonitorSmartphone />, t('customerDisplay'), openCustomerDisplay)}
      {item(<Keyboard />, t('shortcuts.title'), actions.onShortcuts, 'F1')}
      {item(<Ban />, t('clear'), onClear, undefined, true)}
      {cart.interState && gstMode && <div className="px-4 pb-2"><Badge tone="primary">IGST</Badge></div>}
    </div>
  )
}
