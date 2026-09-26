import type { Unit } from '@/core/types'
import { formatMoney, formatNumber, formatPercent, formatQty, fromMinor, moneyConfig } from '@/lib/money'

// Number formatting helpers specific to reports (compact axis labels, CSV numbers).

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = cache.get(key)
  if (!f) {
    try {
      f = make()
    } catch {
      f = new Intl.NumberFormat('en')
    }
    cache.set(key, f)
  }
  return f
}

/** Money for axis ticks and dense labels: ₹1.2L, $12K. */
export function moneyCompact(minor: number): string {
  const { currency, locale, decimals } = moneyConfig()
  const major = minor / 10 ** decimals
  if (Math.abs(major) < 1000) return nf(`c0|${currency}|${locale}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })).format(major)
  return nf(`cc|${currency}|${locale}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })).format(major)
}

/** Money without minor digits for large headline figures (exact values stay in the tables). */
export function moneyWhole(minor: number): string {
  const { currency, locale, decimals } = moneyConfig()
  const major = minor / 10 ** decimals
  if (Math.abs(major) < 10_000) return formatMoney(minor)
  return nf(`w|${currency}|${locale}`, () => new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 })).format(major)
}

export function intCompact(n: number): string {
  const { locale } = moneyConfig()
  if (Math.abs(n) < 10_000) return formatNumber(n)
  return nf(`ic|${locale}`, () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })).format(n)
}

export const money = (minor: number) => formatMoney(minor)
export const qty = (n: number) => formatQty(Math.round(n * 1000) / 1000)
export const int = (n: number) => formatNumber(n)
export const pct = (n: number) => (Number.isFinite(n) ? formatPercent(Math.round(n * 10) / 10) : '—')

/** Share of a total as a percentage number (0–100). */
export const share = (part: number, total: number) => (total ? (part / total) * 100 : 0)

/** Margin % of profit over revenue (over its size when refunds make revenue negative, so a loss stays negative). */
export const margin = (profit: number, revenue: number) => (revenue ? (profit / Math.abs(revenue)) * 100 : 0)

/** Percentage change with an explicit sign: +12.5%, −3%, 0%. */
export const signedPct = (n: number) => (!Number.isFinite(n) ? '—' : Math.abs(n) < 0.05 ? pct(0) : `${n > 0 ? '+' : '−'}${pct(Math.abs(n))}`)

/** Plain decimal for CSV (no grouping, dot decimal) so spreadsheets parse it. */
export function csvMoney(minor: number): string {
  const d = moneyConfig().decimals
  return fromMinor(minor, d).toFixed(d)
}

export const csvNum = (n: number, digits = 3) => String(Math.round(n * 10 ** digits) / 10 ** digits)

/** Unit Quantity Codes used on GST returns (GSTR-1 HSN summary). */
const UQC: Record<Unit, string> = {
  pcs: 'NOS', kg: 'KGS', g: 'GMS', l: 'LTR', ml: 'MLT', m: 'MTR', box: 'BOX', pack: 'PAC', dozen: 'DOZ', hour: 'OTH', service: 'OTH',
}
export const uqc = (u: Unit | undefined) => (u ? UQC[u] ?? 'OTH' : 'OTH')

/** Terminal code embedded in document numbers, e.g. INV-T1-000042 → T1. */
export function terminalCode(number: string | undefined): string {
  const parts = (number ?? '').split('-')
  return parts.length >= 3 ? parts.slice(1, -1).join('-') : ''
}

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'report'
}
