// Input validation shared by every form (setup, customers, suppliers, settings…).
// Sanitizers run on each keystroke so impossible values can't be typed; validators
// return an i18n key (in `common:validation.*`) or undefined when the value is fine.

/** E.164 allows at most 15 digits including the country code. */
export const PHONE_MAX_DIGITS = 15
export const PHONE_MIN_DIGITS = 7

export const LIMITS = {
  name: 80,
  businessName: 100,
  email: 254,
  address: 300,
  notes: 500,
  sku: 40,
  barcode: 32,
  taxId: 20,
} as const

/** Keeps digits, spaces, dashes, dots and parentheses, a single leading "+", and caps the digit count. */
export function sanitizePhone(input: string): string {
  let out = ''
  let digits = 0
  for (const ch of input) {
    if (/\d/.test(ch)) {
      if (digits >= PHONE_MAX_DIGITS) continue
      digits++
      out += ch
    } else if (ch === '+') {
      if (out.trim() === '') out = '+'
    } else if (/[\s\-().]/.test(ch)) {
      // No leading separators and no runs of them.
      if (out && !/[\s\-().]$/.test(out)) out += ch
    }
  }
  return out
}

export const phoneDigits = (v: string) => v.replace(/\D/g, '')

export function phoneError(v: string | undefined): string | undefined {
  if (!v?.trim()) return undefined
  const n = phoneDigits(v).length
  return n < PHONE_MIN_DIGITS || n > PHONE_MAX_DIGITS ? 'validation.phone' : undefined
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export function emailError(v: string | undefined): string | undefined {
  if (!v?.trim()) return undefined
  return v.length > LIMITS.email || !EMAIL_RE.test(v.trim()) ? 'validation.email' : undefined
}

/** Uppercases and keeps characters used in tax IDs worldwide (letters, digits, "-", "/", "."). */
export function sanitizeTaxId(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9\-/.]/g, '')
    .slice(0, LIMITS.taxId)
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const GSTIN_RE = /^(0[1-9]|[1-3][0-9]|9[79])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Validates an Indian GSTIN: state code, embedded PAN, and the mod-36 check character. */
export function isValidGstin(v: string): boolean {
  const g = v.toUpperCase()
  if (!GSTIN_RE.test(g)) return false
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14]
}

/** India requires a real GSTIN; elsewhere formats vary, so only the length is checked. */
export function taxIdError(v: string | undefined, country: string | undefined): string | undefined {
  if (!v?.trim()) return undefined
  if (country === 'IN') return isValidGstin(v) ? undefined : 'validation.gstin'
  return v.length < 3 || v.length > LIMITS.taxId ? 'validation.taxId' : undefined
}

/** First error key in a record of field → error, for disabling Save buttons. */
export const hasErrors = (errors: Record<string, string | undefined>) => Object.values(errors).some(Boolean)
