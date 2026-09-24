export interface Language {
  code: string
  name: string
  native: string
  region: 'india' | 'world'
  rtl?: boolean
}

// English is the source language; every other file is translated from locales/en.
export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', native: 'English', region: 'world' },
  // Indian languages
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', region: 'india' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', region: 'india' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', region: 'india' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', region: 'india' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', region: 'india' },
  { code: 'ur', name: 'Urdu', native: 'اردو', region: 'india', rtl: true },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', region: 'india' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', region: 'india' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', region: 'india' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', region: 'india' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', region: 'india' },
  { code: 'as', name: 'Assamese', native: 'অসমীয়া', region: 'india' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली', region: 'india' },
  // Major world languages
  { code: 'es', name: 'Spanish', native: 'Español', region: 'world' },
  { code: 'fr', name: 'French', native: 'Français', region: 'world' },
  { code: 'de', name: 'German', native: 'Deutsch', region: 'world' },
  { code: 'pt', name: 'Portuguese', native: 'Português', region: 'world' },
  { code: 'it', name: 'Italian', native: 'Italiano', region: 'world' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', region: 'world' },
  { code: 'pl', name: 'Polish', native: 'Polski', region: 'world' },
  { code: 'ru', name: 'Russian', native: 'Русский', region: 'world' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', region: 'world' },
  { code: 'ar', name: 'Arabic', native: 'العربية', region: 'world', rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', region: 'world', rtl: true },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文', region: 'world' },
  { code: 'ja', name: 'Japanese', native: '日本語', region: 'world' },
  { code: 'ko', name: 'Korean', native: '한국어', region: 'world' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', region: 'world' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', region: 'world' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', region: 'world' },
  { code: 'th', name: 'Thai', native: 'ไทย', region: 'world' },
  { code: 'fil', name: 'Filipino', native: 'Filipino', region: 'world' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', region: 'world' },
]

export const NAMESPACES = [
  'common', 'auth', 'setup', 'sell', 'products', 'inventory', 'customers', 'sales', 'reports', 'shifts', 'users', 'settings',
] as const

export type Namespace = (typeof NAMESPACES)[number]

export function detectLanguage(): string {
  const prefs = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []
  for (const p of prefs) {
    const code = p.toLowerCase().split('-')[0]
    if (code === 'tl') return 'fil'
    if (LANGUAGES.some((l) => l.code === code)) return code
  }
  return 'en'
}
