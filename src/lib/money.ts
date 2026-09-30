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
  // Scale-relative nudge so float noise (12.345 * 100 = 1234.4999…) rounds as written.
  const x = n * 10 ** decimals
  const r = Math.round(Math.abs(x) * (1 + 4 * Number.EPSILON))
  return x < 0 ? -r : r
}

export function fromMinor(minor: Minor, decimals = config.decimals): number {
  return minor / 10 ** decimals
}

/** Accepts "1,234.50", "1.234,50", "12,5" and similar user input. */
export function parseDecimal(input: string): number {
  let s = input.trim().replace(/[\s\u00a0']/g, '').replace(/\u2212/g, '-')
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
    const zeroInt = /^[-+]?0?,/.test(s)
    s = commas === 1 && (tail !== 3 || zeroInt) ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (dots > 1) {
    // Several dots are only valid as thousands separators ("1.234.567"); "1.2.3" is a typo.
    if (!/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) return NaN
    s = s.replace(/\./g, '')
  }
  // Plain decimals only: no exponents (1e20), Infinity or stray characters.
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN
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
  let s = f.format(minor / 10 ** d)
  if (opts.sign && minor > 0) s = `+${s}`
  // In right-to-left languages an unisolated "-₹120.00" renders as "₹120.00-".
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? `\u2066${s}\u2069` : s
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

// Creating an Intl.NumberFormat is slow and lists format hundreds of numbers per render: reuse them.
const numberFormats = new Map<string, Intl.NumberFormat>()
function numberFormat(locale: string, min: number, max: number): Intl.NumberFormat {
  const key = `${locale}|${min}|${max}`
  let f = numberFormats.get(key)
  if (!f) numberFormats.set(key, (f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max })))
  return f
}

export function formatQty(qty: number, locale = config.locale): string {
  return numberFormat(locale, 0, 3).format(qty)
}

export function formatNumber(n: number, digits = 0, locale = config.locale): string {
  return numberFormat(locale, digits, digits).format(n)
}

export function formatPercent(n: number, locale = config.locale): string {
  return numberFormat(locale, 0, 2).format(n) + '%'
}
