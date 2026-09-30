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

// International calling codes for the country presets (wa.me needs the full number).
export const CALLING_CODES: Record<string, string> = {
  IN: '91', US: '1', CA: '1', GB: '44', AE: '971', SA: '966', PK: '92', BD: '880', NP: '977', LK: '94', ID: '62', MY: '60',
  SG: '65', PH: '63', TH: '66', VN: '84', JP: '81', KR: '82', CN: '86', DE: '49', FR: '33', ES: '34', IT: '39', NL: '31',
  PL: '48', PT: '351', BR: '55', MX: '52', AU: '61', NZ: '64', ZA: '27', NG: '234', KE: '254', EG: '20', TR: '90', RU: '7', IR: '98',
}

/** Last 10 digits: the same local number with or without a country code. */
export const phoneKey = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10)

/**
 * Whether typed digits find a phone number, with or without the country code or a leading 0:
 * "+91 98765", "98765" and "098765" all find "+91 98765 43210" and "9876543210".
 */
export function phoneMatches(phone: string | undefined, digits: string, country?: string): boolean {
  if (!phone || digits.length < 3) return false
  const full = phoneDigits(phone)
  if (full.includes(digits)) return true
  const cc = country ? CALLING_CODES[country] : undefined
  const local = (d: string) => {
    let out = d.replace(/^0+/, '')
    if (cc && out.startsWith(cc) && out.length > cc.length + 2) out = out.slice(cc.length)
    return out
  }
  const q = local(digits)
  return q.length >= 3 && local(full).includes(q)
}

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
