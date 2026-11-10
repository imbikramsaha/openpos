import i18n from 'i18next'
import type { CartLine, Sale, Settings, Tax } from '@/core/types'
import { calculateCart, loyaltyEarned, quickCashSuggestions } from '@/core/cart'
import { ORDER_TYPES_READY } from '@/core/features'
import { currencyDecimals } from '@/lib/money'

// A realistic sale used for the live receipt preview and "Print test receipt".
// Prices are defined in roughly USD terms and scaled so they look plausible per currency.

const SCALE: Record<string, number> = {
  INR: 40, PKR: 150, BDT: 60, NPR: 60, LKR: 150, IDR: 8000, JPY: 80, KRW: 700, VND: 12000, CNY: 4, THB: 20, PHP: 25,
  MYR: 2.5, AED: 2, SAR: 2, EGP: 25, TRY: 15, RUB: 50, BRL: 3, MXN: 10, ZAR: 10, NGN: 500, KES: 70, IRR: 20000, PLN: 2.5,
  TWD: 15, HKD: 4, SEK: 5, NOK: 5, DKK: 4,
}

function nice(v: number): number {
  if (v >= 1000) return Math.round(v / 50) * 50
  if (v >= 100) return Math.round(v / 5) * 5
  if (v >= 10) return Math.round(v)
  return Math.round(v * 10) / 10
}

const tr = (key: string) => i18n.t(`settings:receipt.sample.${key}`) as string

export function buildSampleSale(s: Settings, taxes: Tax[], ctx: { terminal: string; userName: string; deviceId: string }): Sale {
  const d = currencyDecimals(s.currency)
  const scale = SCALE[s.currency] ?? 1
  const price = (usd: number) => Math.round(nice(usd * scale) * 10 ** d)
  const live = taxes.filter((t) => !t.deleted)
  const byRate = [...live].sort((a, b) => a.rate - b.rate)
  const standard = live.find((t) => t.id === s.defaultTaxId) ?? live.find((t) => t.isDefault) ?? byRate[byRate.length - 1]
  const reduced = byRate.find((t) => t.rate > 0 && t.id !== standard?.id) ?? standard
  const zero = byRate.find((t) => t.rate === 0)

  const lines: CartLine[] = [
    { id: 's1', name: tr('item1'), sku: 'BEV-0012', hsn: '0902', unit: 'pcs', qty: 2, price: price(1.5), cost: 0, taxId: reduced?.id },
    { id: 's2', name: tr('item2'), sku: 'BAK-0104', hsn: '1905', unit: 'pcs', qty: 1, price: price(3.8), cost: 0, taxId: standard?.id, discountType: 'percent', discountValue: 10 },
    { id: 's3', name: tr('item3'), sku: 'FRU-0031', hsn: '0803', unit: 'kg', qty: 1.25, price: price(1.2), cost: 0, taxId: zero?.id },
    { id: 's4', name: tr('item4'), sku: 'HOM-0220', hsn: '3402', unit: 'pcs', qty: 1, price: price(2.5), cost: 0, taxId: standard?.id },
  ]
  const calc = calculateCart(lines, {
    pricesIncludeTax: s.pricesIncludeTax,
    cashRounding: s.cashRounding,
    taxes: new Map(live.map((t) => [t.id, t])),
  })
  const notes = (s.quickCash.length ? s.quickCash : [10, 20, 50, 100]).map((n) => Math.round(n * 10 ** d))
  const tendered = quickCashSuggestions(calc.total, notes)[1] ?? calc.total
  const now = Date.now()
  return {
    id: 'sample',
    createdAt: now,
    updatedAt: now,
    number: `INV-${ctx.terminal}-000128`,
    type: 'sale',
    status: 'completed',
    userId: 'sample',
    userName: ctx.userName,
    customerId: 'sample',
    customerName: tr('customer'),
    customerPhone: '+91 98765 43210',
    customerTaxNumber: s.gstMode ? '27AAPFU0939F1ZV' : undefined,
    deviceId: ctx.deviceId,
    lines: calc.lines,
    pricesIncludeTax: s.pricesIncludeTax,
    subtotal: calc.subtotal,
    discountTotal: calc.discountTotal,
    netTotal: calc.netTotal,
    taxTotal: calc.taxTotal,
    rounding: calc.rounding,
    total: calc.total,
    payments: [{ id: 'p1', method: 'cash', amount: tendered }],
    paid: tendered,
    change: tendered - calc.total,
    taxBreakdown: calc.taxBreakdown,
    interState: false,
    table: ORDER_TYPES_READY && s.orderTypes ? '12' : undefined,
    orderType: ORDER_TYPES_READY && s.orderTypes ? 'dinein' : undefined,
    loyaltyEarned: s.loyaltyEnabled ? loyaltyEarned(calc.total, d, s.loyaltyEarnRate) || undefined : undefined,
    currency: s.currency,
  }
}
