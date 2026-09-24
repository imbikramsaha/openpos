import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Languages } from 'lucide-react'
import { LANGUAGES } from '@/i18n/languages'
import { useDevice } from '@/stores/device'
import { cn } from '@/lib/cn'
import { Button, Modal } from '@/components/ui'

export function useChangeLanguage() {
  const { i18n } = useTranslation()
  const update = useDevice((s) => s.update)
  return (code: string) => {
    update({ language: code })
    void i18n.changeLanguage(code)
  }
}

export function LanguageGrid({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useTranslation()
  const groups: Array<['india' | 'world', string]> = [
    ['india', t('lang.india')],
    ['world', t('lang.world')],
  ]
  return (
    <div className="space-y-5">
      {groups.map(([region, label]) => (
        <section key={region}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-subtle uppercase">{label}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LANGUAGES.filter((l) => l.region === region || (region === 'india' && l.code === 'en')).map((l) => (
              <button
                key={l.code}
                onClick={() => onChange(l.code)}
                dir={l.rtl ? 'rtl' : 'ltr'}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition-colors',
                  value === l.code ? 'border-primary bg-primary-soft' : 'border-border hover:bg-surface-3',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{l.native}</span>
                  <span className="block truncate text-xs text-subtle">{l.name}</span>
                </span>
                {value === l.code && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export function LanguagePicker({ compact }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const change = useChangeLanguage()
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]
  return (
    <>
      <Button variant="ghost" size={compact ? 'sm' : 'md'} icon={<Languages className="size-4" />} onClick={() => setOpen(true)}>
        {current.native}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('language')} size="lg">
        <LanguageGrid
          value={current.code}
          onChange={(c) => {
            change(c)
            setOpen(false)
          }}
        />
      </Modal>
    </>
  )
}
