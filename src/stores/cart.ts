import { create } from 'zustand'
import type { CartLine, CartState, Customer, DiscountType, OrderType, Product } from '@/core/types'
import { uuid } from '@/lib/uuid'

// The ticket being rung up on this terminal. Persisted to localStorage so a crash,
// reload or accidental close never loses an in-progress sale.

const KEY = 'kasa.cart'

interface CartStore extends CartState {
  selectedId?: string
  addProduct: (p: Product, qty?: number, price?: number) => void
  addCustomLine: (name: string, price: number, taxId?: string) => void
  setQty: (lineId: string, qty: number) => void
  incQty: (lineId: string, delta: number) => void
  setPrice: (lineId: string, price: number) => void
  setLineDiscount: (lineId: string, type?: DiscountType, value?: number) => void
  setLineNote: (lineId: string, note: string) => void
  removeLine: (lineId: string) => void
  select: (lineId?: string) => void
  setCustomer: (c?: Customer) => void
  setCartDiscount: (type?: DiscountType, value?: number) => void
  setNote: (note?: string) => void
  setOrderType: (t?: OrderType, table?: string) => void
  setInterState: (v: boolean) => void
  setRedeemPoints: (n?: number) => void
  load: (c: CartState) => void
  clear: () => void
  snapshot: () => CartState
}

function loadSaved(): CartState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s && Array.isArray(s.lines)) return s
  } catch {
    /* ignore */
  }
  return { lines: [] }
}

const empty: CartState = {
  lines: [],
  customerId: undefined,
  discountType: undefined,
  discountValue: undefined,
  note: undefined,
  orderType: undefined,
  table: undefined,
  interState: undefined,
  redeemPoints: undefined,
  refundOf: undefined,
}

export const useCart = create<CartStore>((set, get) => {
  const mapLine = (id: string, fn: (l: CartLine) => CartLine) =>
    set({ lines: get().lines.map((l) => (l.id === id ? fn(l) : l)) })

  return {
    ...empty,
    ...loadSaved(),
    selectedId: undefined,

    addProduct: (p, qty = 1, price) => {
      const unitPrice = price ?? p.price
      const existing = get().lines.find(
        (l) => l.productId === p.id && l.price === unitPrice && !l.discountValue && !l.note && !p.weighed,
      )
      if (existing) {
        mapLine(existing.id, (l) => ({ ...l, qty: round3(l.qty + qty) }))
        set({ selectedId: existing.id })
        return
      }
      const line: CartLine = {
        id: uuid(),
        productId: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        hsn: p.hsn,
        unit: p.unit,
        qty,
        price: unitPrice,
        cost: p.cost,
        taxId: p.taxId,
      }
      set({ lines: [...get().lines, line], selectedId: line.id })
    },

    addCustomLine: (name, price, taxId) => {
      const line: CartLine = { id: uuid(), name, unit: 'pcs', qty: 1, price, cost: 0, taxId }
      set({ lines: [...get().lines, line], selectedId: line.id })
    },

    setQty: (id, qty) => {
      if (!qty) return get().removeLine(id)
      mapLine(id, (l) => ({ ...l, qty: round3(qty) }))
    },
    incQty: (id, delta) => {
      const line = get().lines.find((l) => l.id === id)
      if (!line) return
      const next = round3(line.qty + delta)
      if (next === 0) get().removeLine(id)
      else mapLine(id, (l) => ({ ...l, qty: next }))
    },
    setPrice: (id, price) => mapLine(id, (l) => ({ ...l, price })),
    setLineDiscount: (id, discountType, discountValue) =>
      mapLine(id, (l) => ({ ...l, discountType: discountValue ? discountType : undefined, discountValue: discountValue || undefined })),
    setLineNote: (id, note) => mapLine(id, (l) => ({ ...l, note: note || undefined })),
    removeLine: (id) => {
      const lines = get().lines
      const idx = lines.findIndex((l) => l.id === id)
      const next = lines.filter((l) => l.id !== id)
      set({ lines: next, selectedId: next[Math.min(idx, next.length - 1)]?.id })
    },
    select: (selectedId) => set({ selectedId }),
    setCustomer: (c) => {
      const s = get()
      const changes: Partial<CartState> = { customerId: c?.id, redeemPoints: undefined }
      // Apply the customer's standing discount unless the cashier already set one.
      if (c?.discountPercent && !s.discountValue) {
        changes.discountType = 'percent'
        changes.discountValue = c.discountPercent
      }
      set(changes)
    },
    setCartDiscount: (discountType, discountValue) =>
      set({ discountType: discountValue ? discountType : undefined, discountValue: discountValue || undefined }),
    setNote: (note) => set({ note: note || undefined }),
    setOrderType: (orderType, table) => set({ orderType, table }),
    setInterState: (interState) => set({ interState }),
    setRedeemPoints: (redeemPoints) => set({ redeemPoints }),
    load: (c) => set({ ...empty, ...c, selectedId: c.lines[c.lines.length - 1]?.id }),
    clear: () => set({ ...empty, selectedId: undefined }),
    snapshot: () => {
      const { lines, customerId, discountType, discountValue, note, orderType, table, interState, redeemPoints, refundOf } = get()
      return { lines, customerId, discountType, discountValue, note, orderType, table, interState, redeemPoints, refundOf }
    },
  }
})

const round3 = (n: number) => Math.round(n * 1000) / 1000

useCart.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s.snapshot()))
  } catch {
    /* ignore */
  }
})
