import type { Settings } from '@/core/types'

export const SETTINGS_ID = 'app'

export function defaultSettings(): Settings {
  const now = Date.now()
  return {
    id: SETTINGS_ID,
    createdAt: now,
    updatedAt: now,
    businessName: 'My Store',
    address: '',
    phone: '',
    email: '',
    taxNumber: '',
    taxLabel: 'Tax ID',
    country: 'IN',
    currency: 'INR',
    numberLocale: 'en-IN',
    pricesIncludeTax: true,
    gstMode: false,
    cashRounding: 0,
    allowNegativeStock: true,
    requireShift: false,
    loyaltyEnabled: false,
    loyaltyEarnRate: 0.01,
    loyaltyPointValue: 100,
    enabledPayments: ['cash', 'card', 'credit', 'other'],
    receipt: {
      header: '',
      footer: 'Thank you! Visit again.',
      showLogo: true,
      paperWidth: 80,
      showTaxBreakdown: true,
      showBarcode: true,
      showSku: false,
      showCustomer: true,
      autoPrint: false,
      copies: 1,
    },
    scale: { enabled: false, prefixes: '2', itemDigits: 5, valueDigits: 5, valueType: 'weight', valueDivisor: 1000 },
    orderTypes: false,
    quickCash: [10, 20, 50, 100, 200, 500],
    lockAfterSale: false,
    autoLockMinutes: 0,
  }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const intlAccepts = (make: () => unknown) => {
  try {
    make()
    return true
  } catch {
    return false
  }
}

// Fields whose default doesn't describe every valid value, and optional fields (no default).
const VALID: Record<string, (v: unknown) => boolean> = {
  paperWidth: (v) => v === 58 || v === 80 || v === 'a4',
  valueType: (v) => v === 'weight' || v === 'price',
  currency: (v) => typeof v === 'string' && intlAccepts(() => new Intl.NumberFormat('en', { style: 'currency', currency: v })),
  numberLocale: (v) => typeof v === 'string' && intlAccepts(() => new Intl.NumberFormat(v)),
  ...Object.fromEntries(['legalName', 'website', 'state', 'upiId', 'upiName', 'defaultTaxId', 'logo'].map((k) => [k, (v: unknown) => typeof v === 'string'])),
}

const sameType = (v: unknown, d: unknown) => typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))

/**
 * Copies the stored fields that have the right type over the defaults. A damaged backup or a
 * bad record from another terminal then falls back to the default for that field, instead of
 * crashing every screen that reads it. Fields this version doesn't know are kept as they are.
 */
function merge<T extends object>(defaults: T, stored: unknown): T {
  const out = { ...defaults } as Obj
  if (!isObj(stored)) return out as T
  for (const [key, value] of Object.entries(stored)) {
    const d = (defaults as Obj)[key]
    if (value == null || isObj(d)) continue
    if (VALID[key]) {
      if (VALID[key](value)) out[key] = value
    } else if (Array.isArray(d)) {
      if (Array.isArray(value)) out[key] = value.filter((x) => sameType(x, d[0]))
    } else if (d === undefined || sameType(value, d)) out[key] = value
  }
  return out as T
}

/**
 * Fills in settings added after a record was written (restored backups, records synced from
 * terminals on an older version), so screens can rely on every field being present and of
 * the right type.
 */
export function withDefaults(s: Partial<Settings>): Settings {
  const d = defaultSettings()
  return { ...merge(d, s), id: SETTINGS_ID, receipt: merge(d.receipt, s.receipt), scale: merge(d.scale, s.scale) }
}
