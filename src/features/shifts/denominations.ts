import { currencyDecimals } from '@/lib/money'

// Notes and coins for counting the drawer. Notes come from the shop's quick-cash
// buttons (settings.quickCash, major units); coins are the circulating coins of the
// currency. Everything is editable in the dialog, and a free "other" amount covers the rest.

const COINS: Record<string, number[]> = {
  INR: [1, 2, 5, 10, 20],
  USD: [0.01, 0.05, 0.1, 0.25, 0.5, 1],
  CAD: [0.05, 0.1, 0.25, 1, 2],
  AUD: [0.05, 0.1, 0.2, 0.5, 1, 2],
  NZD: [0.1, 0.2, 0.5, 1, 2],
  EUR: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2],
  GBP: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2],
  PLN: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  CHF: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
  AED: [0.25, 0.5, 1],
  SAR: [0.25, 0.5, 1, 2],
  PKR: [1, 2, 5, 10],
  BDT: [1, 2, 5],
  NPR: [1, 2, 5, 10],
  LKR: [1, 2, 5, 10],
  IDR: [100, 200, 500, 1000],
  MYR: [0.05, 0.1, 0.2, 0.5],
  SGD: [0.05, 0.1, 0.2, 0.5, 1],
  PHP: [1, 5, 10, 20],
  THB: [1, 2, 5, 10],
  JPY: [1, 5, 10, 50, 100, 500],
  KRW: [10, 50, 100, 500],
  CNY: [0.1, 0.5, 1],
  BRL: [0.05, 0.1, 0.25, 0.5, 1],
  MXN: [0.5, 1, 2, 5, 10, 20],
  ZAR: [0.1, 0.2, 0.5, 1, 2, 5],
  KES: [1, 5, 10, 20],
  EGP: [0.5, 1],
  TRY: [0.1, 0.25, 0.5, 1],
  RUB: [1, 2, 5, 10],
  NGN: [],
  VND: [],
  IRR: [],
}

/** Denominations in major units, largest first. */
export function denominations(currency: string, quickCash: number[], cashRounding = 0): number[] {
  const d = currencyDecimals(currency)
  const step = cashRounding > 1 ? cashRounding / 10 ** d : 0
  const coins = (COINS[currency] ?? (d === 0 ? [] : [0.05, 0.1, 0.25, 0.5, 1])).filter((c) => !step || c >= step)
  const notes = quickCash.filter((n) => Number.isFinite(n) && n > 0)
  const all = new Set([...notes, ...coins].map((v) => Math.round(v * 10 ** d) / 10 ** d))
  return [...all].sort((a, b) => b - a)
}
