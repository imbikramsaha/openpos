import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import { initReactI18next } from 'react-i18next'
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
      interpolation: { escapeValue: false },
      returnNull: false,
      react: { useSuspense: true },
    })
}

export default i18n
