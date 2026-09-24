import type { Minor } from '@/core/types'

// All amounts are integers in the currency's minor unit. The active currency and
// number locale come from settings and are applied once via setMoneyConfig().

interface MoneyConfig {
  currency: string
  locale: string
  decimals: number
}

const decimalsCache = new Map<string, number>()

export function currencyDecimals(currency: string): number {
  let d = decimalsCache.get(currency)
  if (d === undefined) {
    try {
      d = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      d = 2
    }
    decimalsCache.set(currency, d)
  }
  return d
}

let config: MoneyConfig = { currency: 'INR', locale: 'en-IN', decimals: 2 }
let formatter: Intl.NumberFormat | null = null
let plainFormatter: Intl.NumberFormat | null = null

export function setMoneyConfig(currency: string, locale: string) {
  config = { currency, locale, decimals: currencyDecimals(currency) }
  formatter = null
  plainFormatter = null
}

export const moneyConfig = () => config

export function toMinor(major: number | string, decimals = config.decimals): Minor {
  const n = typeof major === 'number' ? major : parseDecimal(major)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 10 ** decimals)
}

export function fromMinor(minor: Minor, decimals = config.decimals): number {
  return minor / 10 ** decimals
}

/** Accepts "1,234.50", "1.234,50", "12,5" and similar user input. */
export function parseDecimal(input: string): number {
  let s = input.trim().replace(/[\s ']/g, '')
  if (!s) return NaN
  const commas = (s.match(/,/g) || []).length
  const dots = (s.match(/\./g) || []).length
  if (commas && dots) {
    // Whichever separator comes last is the decimal separator.
    const decimalIsComma = s.lastIndexOf(',') > s.lastIndexOf('.')
    s = decimalIsComma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (commas) {
    // A single comma not followed by exactly three digits is a decimal comma ("12,5").
    const tail = s.length - s.lastIndexOf(',') - 1
    s = commas === 1 && tail !== 3 ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (dots > 1) {
    s = s.replace(/\./g, '')
  }
  return Number(s)
}

export function formatMoney(minor: Minor, opts: { sign?: boolean; currency?: string } = {}): string {
  const currency = opts.currency ?? config.currency
  let f: Intl.NumberFormat
  if (currency === config.currency) {
    formatter ??= makeFormatter(config.locale, currency)
    f = formatter
  } else {
    f = makeFormatter(config.locale, currency)
  }
  const d = currency === config.currency ? config.decimals : currencyDecimals(currency)
  const s = f.format(minor / 10 ** d)
  return opts.sign && minor > 0 ? `+${s}` : s
}

function makeFormatter(locale: string, currency: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency })
  } catch {
    return new Intl.NumberFormat('en', { style: 'currency', currency })
  }
}

/** Amount without the currency symbol, e.g. for inputs and CSV. */
export function formatPlain(minor: Minor): string {
  plainFormatter ??= new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
  })
  return plainFormatter.format(minor / 10 ** config.decimals)
}

/** Major-unit string for editable inputs ("12.5" rather than "12.50" grouping). */
export function minorToInput(minor: Minor | undefined): string {
  if (minor === undefined || minor === null) return ''
  return String(fromMinor(minor))
}

export function currencySymbol(currency = config.currency, locale = config.locale): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
    return parts.find((p) => p.type === 'currency')?.value ?? currency
  } catch {
    return currency
  }
}

export function formatQty(qty: number, locale = config.locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(qty)
}

export function formatNumber(n: number, digits = 0, locale = config.locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n)
}

export function formatPercent(n: number, locale = config.locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n) + '%'
}
