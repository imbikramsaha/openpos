import { describe, expect, it } from 'vitest'
import { currencyDecimals, formatMoney, fromMinor, parseDecimal, setMoneyConfig, toMinor } from '@/lib/money'
import { ean13CheckDigit, generateEan13, isValidEan13, parseScaleBarcode } from '@/core/barcode'
import { parseCsv, toCsv } from '@/lib/csv'
import { hashPin, sha256Hex } from '@/lib/sha256'
import { amountInWords, numberToWords } from '@/lib/words'
import { can } from '@/core/permissions'
import { findPreset } from '@/core/presets'

describe('money', () => {
  it('knows currency precision', () => {
    expect(currencyDecimals('INR')).toBe(2)
    expect(currencyDecimals('JPY')).toBe(0)
    expect(currencyDecimals('KWD')).toBe(3)
  })

  it('converts between major and minor units without float drift', () => {
    expect(toMinor(19.99, 2)).toBe(1999)
    expect(toMinor(0.1 + 0.2, 2)).toBe(30)
    expect(toMinor('1,234.56', 2)).toBe(123456)
    expect(fromMinor(123456, 2)).toBe(1234.56)
  })

  it('parses decimal input in common regional styles', () => {
    expect(parseDecimal('12,5')).toBe(12.5)
    expect(parseDecimal('1.234,50')).toBe(1234.5)
    expect(parseDecimal('1,234.50')).toBe(1234.5)
    expect(parseDecimal('1,500')).toBe(1500)
    expect(parseDecimal('1.234.567')).toBe(1234567)
    expect(parseDecimal(' 42 ')).toBe(42)
    expect(Number.isNaN(parseDecimal(''))).toBe(true)
  })

  it('formats with Indian digit grouping', () => {
    setMoneyConfig('INR', 'en-IN')
    expect(formatMoney(12345678900)).toBe('₹12,34,56,789.00')
    setMoneyConfig('USD', 'en-US')
    expect(formatMoney(123456)).toBe('$1,234.56')
  })
})

describe('barcodes', () => {
  it('computes EAN-13 check digits', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
    const g = generateEan13()
    expect(isValidEan13(g)).toBe(true)
    expect(g.startsWith('29')).toBe(true)
  })

  it('parses weighing-scale labels', () => {
    const s = { enabled: true, prefixes: '2', itemDigits: 5, valueDigits: 5, valueType: 'weight' as const, valueDivisor: 1000 }
    expect(parseScaleBarcode('2112345012504', s)).toEqual({ itemCode: '12345', value: 1.25 })
    expect(parseScaleBarcode('4006381333931', s)).toBeNull()
    expect(parseScaleBarcode('2112345012504', { ...s, enabled: false })).toBeNull()
  })
})

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [{ name: 'Tea, "Masala"', note: 'line1\nline2', price: 10 }]
    expect(parseCsv(toCsv(rows))).toEqual([{ name: 'Tea, "Masala"', note: 'line1\nline2', price: '10' }])
  })

  it('detects semicolon-delimited Excel exports and strips BOM', () => {
    expect(parseCsv('﻿name;price\nChai;10\n')).toEqual([{ name: 'Chai', price: '10' }])
  })
})

describe('security helpers', () => {
  it('sha256 matches the standard test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('pin hashes depend on the salt', () => {
    expect(hashPin('1234', 'a')).toBe(hashPin('1234', 'a'))
    expect(hashPin('1234', 'a')).not.toBe(hashPin('1234', 'b'))
  })

  it('role permissions', () => {
    expect(can({ role: 'cashier' }, 'sell')).toBe(true)
    expect(can({ role: 'cashier' }, 'refund')).toBe(false)
    expect(can({ role: 'cashier', extraPermissions: ['refund'] }, 'refund')).toBe(true)
    expect(can({ role: 'manager' }, 'users_manage')).toBe(false)
    expect(can({ role: 'admin' }, 'users_manage')).toBe(true)
    expect(can(null, 'sell')).toBe(false)
  })
})

describe('invoice helpers', () => {
  it('writes amounts in words using lakh/crore for INR', () => {
    expect(numberToWords(0)).toBe('Zero')
    expect(numberToWords(12345678, true)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight')
    expect(numberToWords(1234567)).toBe('One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven')
    expect(amountInWords(123450, 'INR', 2)).toBe('Rupees One Thousand Two Hundred Thirty Four and Fifty Paise Only')
  })

  it('country presets fall back to "Other"', () => {
    expect(findPreset('IN').currency).toBe('INR')
    expect(findPreset('ZZ').code).toBe('OTHER')
  })
})

describe('csv safety', () => {
  it('neutralises formula cells on export and restores them on import', () => {
    const csv = toCsv([{ name: '=HYPERLINK("http://x")', qty: -5, note: '@sum', ok: 'Tea' }])
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(',-5,')
    expect(csv).toContain("'@sum")
    expect(parseCsv(csv)).toEqual([{ name: '=HYPERLINK("http://x")', qty: '-5', note: '@sum', ok: 'Tea' }])
  })

  it('keeps the first of duplicated header columns', () => {
    expect(parseCsv('name,price,name\nTea,10,Coffee')).toEqual([{ name: 'Tea', price: '10' }])
  })
})

describe('money edge cases', () => {
  it('rounds float noise the way the number was written', () => {
    expect(toMinor(12.345, 2)).toBe(1235)
    expect(toMinor(1.005, 2)).toBe(101)
    expect(toMinor(-12.345, 2)).toBe(-1235)
    expect(toMinor(0.1 + 0.2, 2)).toBe(30)
  })
  it('rejects exponents and junk; accepts typographic minus', () => {
    expect(Number.isNaN(parseDecimal('1e3'))).toBe(true)
    expect(Number.isNaN(parseDecimal('Infinity'))).toBe(true)
    expect(Number.isNaN(parseDecimal('12abc'))).toBe(true)
    expect(parseDecimal('−5')).toBe(-5)
    expect(parseDecimal('.5')).toBe(0.5)
  })
})
