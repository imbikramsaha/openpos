import type { PaymentMethod } from './types'

// Country presets applied by the setup wizard. Everything stays editable afterwards —
// tax law changes, so shops should verify the rates for their jurisdiction.

export interface CountryPreset {
  code: string
  name: string
  currency: string
  locale: string
  language: string
  taxLabel: string
  taxes: Array<{ name: string; rate: number; isDefault?: boolean }>
  pricesIncludeTax: boolean
  gstMode?: boolean
  /** Minor units, e.g. 100 = round totals to nearest rupee. */
  cashRounding: number
  payments: PaymentMethod[]
  /** Banknotes in major units for quick-cash buttons. */
  notes: number[]
}

const base: PaymentMethod[] = ['cash', 'card', 'credit', 'other']
const EU_NOTES = [5, 10, 20, 50, 100, 200]

export const COUNTRY_PRESETS: CountryPreset[] = [
  {
    code: 'IN', name: 'India', currency: 'INR', locale: 'en-IN', language: 'en', taxLabel: 'GSTIN',
    // GST 2.0 slabs (effective 22 Sep 2025) plus 3% for precious metals.
    taxes: [
      { name: 'GST 0%', rate: 0 },
      { name: 'GST 3%', rate: 3 },
      { name: 'GST 5%', rate: 5 },
      { name: 'GST 18%', rate: 18, isDefault: true },
      { name: 'GST 40%', rate: 40 },
    ],
    pricesIncludeTax: true, gstMode: true, cashRounding: 100,
    payments: ['cash', 'upi', 'card', 'credit', 'bank', 'other'], notes: [10, 20, 50, 100, 200, 500],
  },
  { code: 'US', name: 'United States', currency: 'USD', locale: 'en-US', language: 'en', taxLabel: 'Tax ID', taxes: [{ name: 'Sales tax', rate: 0, isDefault: true }], pricesIncludeTax: false, cashRounding: 0, payments: base, notes: [1, 5, 10, 20, 50, 100] },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', locale: 'en-GB', language: 'en', taxLabel: 'VAT No.', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 5%', rate: 5 }, { name: 'VAT 20%', rate: 20, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [5, 10, 20, 50] },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', locale: 'en-AE', language: 'ar', taxLabel: 'TRN', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 5%', rate: 5, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [5, 10, 20, 50, 100, 200, 500] },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', locale: 'ar-SA', language: 'ar', taxLabel: 'VAT No.', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 15%', rate: 15, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [5, 10, 50, 100, 200, 500] },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', locale: 'en-PK', language: 'ur', taxLabel: 'NTN', taxes: [{ name: 'GST 0%', rate: 0 }, { name: 'GST 18%', rate: 18, isDefault: true }], pricesIncludeTax: true, cashRounding: 100, payments: base, notes: [10, 20, 50, 100, 500, 1000, 5000] },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', locale: 'bn-BD', language: 'bn', taxLabel: 'BIN', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 5%', rate: 5 }, { name: 'VAT 15%', rate: 15, isDefault: true }], pricesIncludeTax: true, cashRounding: 100, payments: base, notes: [10, 20, 50, 100, 500, 1000] },
  { code: 'NP', name: 'Nepal', currency: 'NPR', locale: 'ne-NP', language: 'ne', taxLabel: 'PAN/VAT', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 13%', rate: 13, isDefault: true }], pricesIncludeTax: true, cashRounding: 100, payments: base, notes: [10, 20, 50, 100, 500, 1000] },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', locale: 'en-LK', language: 'ta', taxLabel: 'VAT No.', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 18%', rate: 18, isDefault: true }], pricesIncludeTax: true, cashRounding: 100, payments: base, notes: [20, 50, 100, 500, 1000, 5000] },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', locale: 'id-ID', language: 'id', taxLabel: 'NPWP', taxes: [{ name: 'PPN 0%', rate: 0 }, { name: 'PPN 11%', rate: 11, isDefault: true }, { name: 'PPN 12%', rate: 12 }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [1000, 2000, 5000, 10000, 20000, 50000, 100000] },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', locale: 'ms-MY', language: 'ms', taxLabel: 'SST No.', taxes: [{ name: 'SST 0%', rate: 0 }, { name: 'Service tax 8%', rate: 8 }, { name: 'Sales tax 10%', rate: 10, isDefault: true }], pricesIncludeTax: false, cashRounding: 5, payments: base, notes: [1, 5, 10, 20, 50, 100] },
  { code: 'SG', name: 'Singapore', currency: 'SGD', locale: 'en-SG', language: 'en', taxLabel: 'GST Reg. No.', taxes: [{ name: 'GST 0%', rate: 0 }, { name: 'GST 9%', rate: 9, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [2, 5, 10, 50, 100] },
  { code: 'PH', name: 'Philippines', currency: 'PHP', locale: 'en-PH', language: 'fil', taxLabel: 'TIN', taxes: [{ name: 'VAT exempt', rate: 0 }, { name: 'VAT 12%', rate: 12, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [20, 50, 100, 200, 500, 1000] },
  { code: 'TH', name: 'Thailand', currency: 'THB', locale: 'th-TH', language: 'th', taxLabel: 'Tax ID', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 7%', rate: 7, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [20, 50, 100, 500, 1000] },
  { code: 'VN', name: 'Vietnam', currency: 'VND', locale: 'vi-VN', language: 'vi', taxLabel: 'MST', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 5%', rate: 5 }, { name: 'VAT 8%', rate: 8 }, { name: 'VAT 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [10000, 20000, 50000, 100000, 200000, 500000] },
  { code: 'JP', name: 'Japan', currency: 'JPY', locale: 'ja-JP', language: 'ja', taxLabel: 'Registration No.', taxes: [{ name: '消費税 8%', rate: 8 }, { name: '消費税 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [1000, 2000, 5000, 10000] },
  { code: 'KR', name: 'South Korea', currency: 'KRW', locale: 'ko-KR', language: 'ko', taxLabel: '사업자등록번호', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [1000, 5000, 10000, 50000] },
  { code: 'CN', name: 'China', currency: 'CNY', locale: 'zh-CN', language: 'zh', taxLabel: '税号', taxes: [{ name: '增值税 6%', rate: 6 }, { name: '增值税 9%', rate: 9 }, { name: '增值税 13%', rate: 13, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [10, 20, 50, 100] },
  { code: 'DE', name: 'Germany', currency: 'EUR', locale: 'de-DE', language: 'de', taxLabel: 'USt-IdNr.', taxes: [{ name: 'MwSt 7%', rate: 7 }, { name: 'MwSt 19%', rate: 19, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: EU_NOTES },
  { code: 'FR', name: 'France', currency: 'EUR', locale: 'fr-FR', language: 'fr', taxLabel: 'N° TVA', taxes: [{ name: 'TVA 2,1%', rate: 2.1 }, { name: 'TVA 5,5%', rate: 5.5 }, { name: 'TVA 10%', rate: 10 }, { name: 'TVA 20%', rate: 20, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: EU_NOTES },
  { code: 'ES', name: 'Spain', currency: 'EUR', locale: 'es-ES', language: 'es', taxLabel: 'NIF', taxes: [{ name: 'IVA 4%', rate: 4 }, { name: 'IVA 10%', rate: 10 }, { name: 'IVA 21%', rate: 21, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: EU_NOTES },
  { code: 'IT', name: 'Italy', currency: 'EUR', locale: 'it-IT', language: 'it', taxLabel: 'P.IVA', taxes: [{ name: 'IVA 4%', rate: 4 }, { name: 'IVA 10%', rate: 10 }, { name: 'IVA 22%', rate: 22, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: EU_NOTES },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', locale: 'nl-NL', language: 'nl', taxLabel: 'BTW-nr', taxes: [{ name: 'BTW 9%', rate: 9 }, { name: 'BTW 21%', rate: 21, isDefault: true }], pricesIncludeTax: true, cashRounding: 5, payments: base, notes: EU_NOTES },
  { code: 'PL', name: 'Poland', currency: 'PLN', locale: 'pl-PL', language: 'pl', taxLabel: 'NIP', taxes: [{ name: 'VAT 5%', rate: 5 }, { name: 'VAT 8%', rate: 8 }, { name: 'VAT 23%', rate: 23, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [10, 20, 50, 100, 200] },
  { code: 'PT', name: 'Portugal', currency: 'EUR', locale: 'pt-PT', language: 'pt', taxLabel: 'NIF', taxes: [{ name: 'IVA 6%', rate: 6 }, { name: 'IVA 13%', rate: 13 }, { name: 'IVA 23%', rate: 23, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: EU_NOTES },
  { code: 'BR', name: 'Brazil', currency: 'BRL', locale: 'pt-BR', language: 'pt', taxLabel: 'CNPJ', taxes: [{ name: 'Isento', rate: 0, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [2, 5, 10, 20, 50, 100, 200] },
  { code: 'MX', name: 'Mexico', currency: 'MXN', locale: 'es-MX', language: 'es', taxLabel: 'RFC', taxes: [{ name: 'IVA 0%', rate: 0 }, { name: 'IVA 16%', rate: 16, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [20, 50, 100, 200, 500, 1000] },
  { code: 'CA', name: 'Canada', currency: 'CAD', locale: 'en-CA', language: 'en', taxLabel: 'GST/HST No.', taxes: [{ name: 'GST 5%', rate: 5, isDefault: true }, { name: 'HST 13%', rate: 13 }, { name: 'HST 15%', rate: 15 }], pricesIncludeTax: false, cashRounding: 5, payments: base, notes: [5, 10, 20, 50, 100] },
  { code: 'AU', name: 'Australia', currency: 'AUD', locale: 'en-AU', language: 'en', taxLabel: 'ABN', taxes: [{ name: 'GST free', rate: 0 }, { name: 'GST 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 5, payments: base, notes: [5, 10, 20, 50, 100] },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', locale: 'en-NZ', language: 'en', taxLabel: 'GST No.', taxes: [{ name: 'GST 0%', rate: 0 }, { name: 'GST 15%', rate: 15, isDefault: true }], pricesIncludeTax: true, cashRounding: 10, payments: base, notes: [5, 10, 20, 50, 100] },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', locale: 'en-ZA', language: 'en', taxLabel: 'VAT No.', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 15%', rate: 15, isDefault: true }], pricesIncludeTax: true, cashRounding: 10, payments: base, notes: [10, 20, 50, 100, 200] },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', locale: 'en-NG', language: 'en', taxLabel: 'TIN', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 7.5%', rate: 7.5, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [100, 200, 500, 1000] },
  { code: 'KE', name: 'Kenya', currency: 'KES', locale: 'sw-KE', language: 'sw', taxLabel: 'KRA PIN', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 16%', rate: 16, isDefault: true }], pricesIncludeTax: true, cashRounding: 100, payments: base, notes: [50, 100, 200, 500, 1000] },
  { code: 'EG', name: 'Egypt', currency: 'EGP', locale: 'ar-EG', language: 'ar', taxLabel: 'Tax Reg. No.', taxes: [{ name: 'VAT 0%', rate: 0 }, { name: 'VAT 14%', rate: 14, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [5, 10, 20, 50, 100, 200] },
  { code: 'TR', name: 'Türkiye', currency: 'TRY', locale: 'tr-TR', language: 'tr', taxLabel: 'VKN', taxes: [{ name: 'KDV 1%', rate: 1 }, { name: 'KDV 10%', rate: 10 }, { name: 'KDV 20%', rate: 20, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [5, 10, 20, 50, 100, 200] },
  { code: 'RU', name: 'Russia', currency: 'RUB', locale: 'ru-RU', language: 'ru', taxLabel: 'ИНН', taxes: [{ name: 'НДС 0%', rate: 0 }, { name: 'НДС 10%', rate: 10 }, { name: 'НДС 22%', rate: 22, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [50, 100, 200, 500, 1000, 5000] },
  { code: 'IR', name: 'Iran', currency: 'IRR', locale: 'fa-IR', language: 'fa', taxLabel: 'Tax ID', taxes: [{ name: 'VAT 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [100000, 500000, 1000000] },
  { code: 'OTHER', name: 'Other', currency: 'USD', locale: 'en-US', language: 'en', taxLabel: 'Tax ID', taxes: [{ name: 'No tax', rate: 0 }, { name: 'Tax 10%', rate: 10, isDefault: true }], pricesIncludeTax: true, cashRounding: 0, payments: base, notes: [1, 5, 10, 20, 50, 100] },
]

export const findPreset = (code: string) => COUNTRY_PRESETS.find((p) => p.code === code) ?? COUNTRY_PRESETS[COUNTRY_PRESETS.length - 1]

/** Indian states for GST place-of-supply (two-digit GST state codes). */
export const INDIAN_STATES: Array<[string, string]> = [
  ['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'],
  ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'],
  ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'],
  ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'],
  ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
]

export const CURRENCIES = Array.from(new Set(COUNTRY_PRESETS.map((p) => p.currency))).concat(['CHF', 'SEK', 'NOK', 'DKK', 'HKD', 'TWD', 'ILS', 'QAR', 'KWD', 'OMR', 'BHD', 'ARS', 'CLP', 'COP', 'PEN', 'GHS', 'TZS', 'UGX', 'ETB', 'MMK', 'KHR', 'LAK', 'MVR', 'BTN', 'AFN'])
