import i18n, { type BackendModule, type FormatterModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { moneyConfig } from '@/lib/money'
import { LANGUAGES, NAMESPACES, detectLanguage } from './languages'

// English ships in the main bundle; every other language is a lazily loaded chunk
// (and is precached by the service worker, so switching works offline).
const english = import.meta.glob<{ default: ResourceKey }>('./locales/en/*.json', { eager: true })
const lazy = import.meta.glob<{ default: ResourceKey }>(['./locales/*/*.json', '!./locales/en/*.json'])

const enResources: Record<string, ResourceKey> = {}
for (const [path, mod] of Object.entries(english)) {
  enResources[path.split('/').pop()!.replace('.json', '')] = mod.default
}

const backend: BackendModule = {
  type: 'backend',
  init() {},
  read(lng, ns, cb) {
    const load = lazy[`./locales/${lng}/${ns}.json`]
    if (!load) return cb(null, {})
    load().then((m) => cb(null, m.default), (e) => cb(e, null))
  },
}

// Numbers interpolated into translations ("{{count}} products") are grouped like every other
// number in the app, using the store's number format: 20,037 / 1,00,000 (en-IN) / 20.037 (de).
const numberFormats = new Map<string, Intl.NumberFormat>()
const formatter: FormatterModule = {
  type: 'formatter',
  init() {},
  add() {},
  addCached() {},
  format(value, format, lng) {
    if (typeof value !== 'number' || !Number.isFinite(value) || (format && format !== 'number')) return value
    const locale = moneyConfig().locale || lng || 'en'
    let f = numberFormats.get(locale)
    if (!f) {
      try {
        f = new Intl.NumberFormat(locale)
      } catch {
        f = new Intl.NumberFormat('en')
      }
      numberFormats.set(locale, f)
    }
    return f.format(value)
  },
}

export function applyDirection(lng: string) {
  const lang = LANGUAGES.find((l) => l.code === lng)
  document.documentElement.lang = lng
  document.documentElement.dir = lang?.rtl ? 'rtl' : 'ltr'
}

export function initI18n(preferred?: string) {
  const lng = preferred || detectLanguage()
  applyDirection(lng)
  i18n.on('languageChanged', applyDirection)
  return i18n
    .use(backend)
    .use(formatter)
    .use(initReactI18next)
    .init({
      lng,
      fallbackLng: 'en',
      supportedLngs: LANGUAGES.map((l) => l.code),
      ns: [...NAMESPACES],
      defaultNS: 'common',
      fallbackNS: 'common',
      resources: { en: enResources },
      partialBundledLanguages: true,
      interpolation: { escapeValue: false, alwaysFormat: true },
      returnNull: false,
      react: { useSuspense: true },
    })
}

export default i18n
