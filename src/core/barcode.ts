import type { ScaleBarcodeSettings } from './types'

export function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** In-store EAN-13 barcode in the 200–299 "restricted circulation" range. */
export function generateEan13(prefix = '29'): string {
  let body = prefix
  while (body.length < 12) body += Math.floor(Math.random() * 10)
  return body + ean13CheckDigit(body)
}

export interface ScaleResult {
  itemCode: string
  value: number
}

/**
 * Weighing-scale labels embed the item code and weight/price in an EAN-13, e.g. with
 * prefix "2", 5 item digits, 5 value digits: 2 1 23456 01250 C → item 23456, 1.250 kg.
 */
export function parseScaleBarcode(code: string, s: ScaleBarcodeSettings): ScaleResult | null {
  if (!s.enabled || !/^\d{12,13}$/.test(code)) return null
  const prefixes = s.prefixes.split(/[\s,]+/).filter(Boolean)
  const prefix = prefixes.find((p) => code.startsWith(p))
  if (!prefix) return null
  // Layout: prefix (padded to 2 digits by convention) + item digits + value digits + check digit.
  const start = Math.max(prefix.length, 2)
  const itemCode = code.slice(start, start + s.itemDigits)
  const raw = code.slice(start + s.itemDigits, start + s.itemDigits + s.valueDigits)
  if (itemCode.length !== s.itemDigits || raw.length !== s.valueDigits) return null
  const value = Number(raw) / (s.valueDivisor || 1)
  return Number.isFinite(value) ? { itemCode, value } : null
}
