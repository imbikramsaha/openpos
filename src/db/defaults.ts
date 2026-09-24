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
