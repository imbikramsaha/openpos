import { beforeAll, describe, expect, it } from 'vitest'
import i18n, { initI18n } from '@/i18n'
import { setMoneyConfig } from '@/lib/money'

describe('i18n number interpolation', () => {
  beforeAll(async () => {
    // initI18n sets <html lang/dir>; the Node test environment has no DOM.
    ;(globalThis as { document?: unknown }).document ??= { documentElement: {} }
    await initI18n('en')
  })

  it('groups counts with the store number format', () => {
    setMoneyConfig('INR', 'en-IN')
    expect(i18n.t('sell:itemsCount', { count: 20037 })).toContain('20,037')
    expect(i18n.t('sell:itemsCount', { count: 100000 })).toContain('1,00,000')
    setMoneyConfig('EUR', 'de-DE')
    expect(i18n.t('sell:itemsCount', { count: 20037 })).toContain('20.037')
    setMoneyConfig('INR', 'en-IN')
  })

  it('keeps plural selection and leaves strings alone', () => {
    expect(i18n.t('sell:itemsCount', { count: 1 })).toMatch(/^1 /)
    expect(i18n.t('common:appName')).toBe('Kasa POS')
  })
})
