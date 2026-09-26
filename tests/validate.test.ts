import { describe, expect, it } from 'vitest'
import { emailError, isValidGstin, phoneError, sanitizePhone, sanitizeTaxId, taxIdError } from '@/lib/validate'

describe('phone', () => {
  it('caps at 15 digits and strips junk while typing', () => {
    expect(sanitizePhone('798732857984735477984707767')).toBe('798732857984735')
    expect(sanitizePhone('+91 98765-43210')).toBe('+91 98765-43210')
    expect(sanitizePhone('abc98765x43210')).toBe('9876543210')
    expect(sanitizePhone('98+76')).toBe('9876')
    expect(sanitizePhone('  --98')).toBe('98')
  })
  it('accepts real numbers and rejects too short/long', () => {
    expect(phoneError('9876543210')).toBeUndefined()
    expect(phoneError('+91 98765 43210')).toBeUndefined()
    expect(phoneError('080-2345 6789')).toBeUndefined()
    expect(phoneError('')).toBeUndefined()
    expect(phoneError('12345')).toBe('validation.phone')
    expect(phoneError('1234567890123456')).toBe('validation.phone')
  })
})

describe('email', () => {
  it('validates common shapes', () => {
    expect(emailError('asha@shop.in')).toBeUndefined()
    expect(emailError('a.b+c@mail.co.uk')).toBeUndefined()
    expect(emailError('')).toBeUndefined()
    expect(emailError('asha@shop')).toBe('validation.email')
    expect(emailError('asha shop@x.in')).toBe('validation.email')
    expect(emailError('@x.in')).toBe('validation.email')
  })
})

describe('tax IDs', () => {
  it('verifies the GSTIN check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true)
    expect(isValidGstin('29AAGCB7383J1Z4')).toBe(true)
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false)
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false)
    expect(isValidGstin('00AAPFU0939F1ZV')).toBe(false)
  })
  it('only India enforces GSTIN; others check length', () => {
    expect(taxIdError('27AAPFU0939F1ZV', 'IN')).toBeUndefined()
    expect(taxIdError('12345', 'IN')).toBe('validation.gstin')
    expect(taxIdError('GB123456789', 'GB')).toBeUndefined()
    expect(taxIdError('AB', 'US')).toBe('validation.taxId')
    expect(taxIdError('', 'IN')).toBeUndefined()
  })
  it('sanitizes to uppercase alphanumerics, max 20', () => {
    expect(sanitizeTaxId('27aapfu 0939f1zv!')).toBe('27AAPFU0939F1ZV')
    expect(sanitizeTaxId('x'.repeat(40))).toHaveLength(20)
  })
})
