import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Check, CloudDownload, FileUp, Rocket, Store } from 'lucide-react'
import type { Settings, Tax } from '@/core/types'
import { COUNTRY_PRESETS, INDIAN_STATES, findPreset } from '@/core/presets'
import { db } from '@/db/db'
import { defaultSettings } from '@/db/defaults'
import { seedDemoData } from '@/db/seed'
import { audit, putMany } from '@/db/repo'
import { uuid } from '@/lib/uuid'
import { currencyDecimals } from '@/lib/money'
import { useSession } from '@/stores/session'
import { useDevice } from '@/stores/device'
import { confirmDialog, toast } from '@/stores/ui'
import { pickFile, readFileText } from '@/lib/download'
import { formatDateTime } from '@/lib/dates'
import { InvalidBackup, parseBackup, restoreBackup } from '@/features/settings/backup'
import { joinStore, testConnection } from '@/sync/engine'
import { Button, Input, PhoneInput, Select, TaxIdInput, Toggle } from '@/components/ui'
import { hasErrors, LIMITS, phoneError, taxIdError } from '@/lib/validate'
import { LanguageGrid, useChangeLanguage } from '@/components/LanguagePicker'
import { createUser } from '@/features/auth/users'
import { cn } from '@/lib/cn'

type Step = 'language' | 'business' | 'admin' | 'finish' | 'join'

export function SetupWizard() {
  const { t, i18n } = useTranslation('setup')
  const changeLanguage = useChangeLanguage()
  const login = useSession((s) => s.login)
  const updateDevice = useDevice((s) => s.update)
  const [step, setStep] = useState<Step>('language')
  const [busy, setBusy] = useState(false)
  // A ref, not state: a fast double-click fires twice before `busy` re-renders the button.
  const running = useRef(false)
  const [biz, setBiz] = useState({ name: '', country: guessCountry(), phone: '', address: '', taxNumber: '', state: '' })
  const [admin, setAdmin] = useState({ name: '', pin: '', pin2: '' })
  const [demo, setDemo] = useState(true)
  const [join, setJoin] = useState({ url: '', key: '' })
  const preset = findPreset(biz.country)

  const steps: Step[] = ['language', 'business', 'admin', 'finish']
  const idx = steps.indexOf(step)
  const pinError = admin.pin && !/^\d{4,6}$/.test(admin.pin) ? t('pinFormat') : admin.pin2 && admin.pin !== admin.pin2 ? t('pinMismatch') : ''

  // A brand-new device can be restored straight from a backup file, without first
  // creating a throwaway store and admin.
  const restoreFromFile = async () => {
    const file = await pickFile('.json,application/json')
    if (!file) return
    try {
      const summary = parseBackup(await readFileText(file))
      const ok = await confirmDialog({
        title: t('restoreConfirmTitle'),
        message: t('restoreConfirmMessage', { name: summary.businessName ?? '—', date: summary.exportedAt ? formatDateTime(summary.exportedAt) : '—' }),
        confirmLabel: t('restore'),
      })
      if (!ok) return
      setBusy(true)
      await restoreBackup(summary.file)
    } catch (e) {
      setBusy(false)
      toast(e instanceof InvalidBackup ? t(`settings:backup.error.${e.code}`) : e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const finish = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      const now = Date.now()
      const taxes: Tax[] = preset.taxes.map((tx) => ({ id: uuid(), createdAt: now, updatedAt: now, ...tx }))
      const d = currencyDecimals(preset.currency)
      const s: Settings = {
        ...defaultSettings(),
        businessName: biz.name.trim() || 'My Store',
        phone: biz.phone,
        address: biz.address,
        taxNumber: biz.taxNumber,
        taxLabel: preset.taxLabel,
        country: preset.code,
        state: preset.code === 'IN' ? biz.state || undefined : undefined,
        currency: preset.currency,
        numberLocale: preset.locale,
        pricesIncludeTax: preset.pricesIncludeTax,
        gstMode: !!preset.gstMode,
        cashRounding: preset.cashRounding,
        enabledPayments: preset.payments,
        quickCash: preset.notes,
        defaultTaxId: taxes.find((x) => x.isDefault)?.id,
        loyaltyPointValue: 10 ** d,
        // Printed on every receipt, so start it in the shop's chosen language.
        receipt: { ...defaultSettings().receipt, footer: t('defaultFooter') },
      }
      if (useDevice.getState().terminalName === 'Till 1') updateDevice({ terminalName: t('defaultTerminalName') })
      // Ask the browser not to evict the till's data under storage pressure.
      void navigator.storage?.persist?.()
      await putMany('taxes', taxes)
      await putMany('settings', [s])
      if (demo) await seedDemoData(preset.currency, taxes)
      // The first user is created last: as soon as a user exists the app leaves the wizard, so a
      // failure above must not leave a half-configured store behind the lock screen.
      const user = await createUser(admin.name.trim() || 'Admin', 'admin', admin.pin)
      login(user)
      await audit('setup', 'settings', s.id)
      toast(t('ready'))
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const doJoin = async () => {
    if (running.current || !join.url || !join.key) return
    running.current = true
    setBusy(true)
    try {
      const res = await testConnection(join.url, join.key)
      if (!res.ok) throw new Error(res.error || t('joinFailed'))
      updateDevice({ serverUrl: join.url, storeKey: join.key, syncEnabled: true })
      await joinStore(join.url, join.key)
      const users = await db.users.count()
      if (!users) throw new Error(t('joinNoData'))
      toast(t('joined', { name: res.storeName ?? '' }))
      // App.tsx sees users now exist and switches to the lock screen.
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const nextDisabled =
    (step === 'business' && hasErrors({ phone: phoneError(biz.phone), tax: taxIdError(biz.taxNumber, biz.country) })) ||
    (step === 'admin' && (!admin.name.trim() || !/^\d{4,6}$/.test(admin.pin) || admin.pin !== admin.pin2))

  // Enter in a text field moves to the next step (or joins), like submitting a form.
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return
    e.preventDefault()
    if (step === 'join') void doJoin()
    else if ((step === 'business' || step === 'admin') && !nextDisabled) setStep(steps[idx + 1])
  }

  return (
    <div className="safe-top safe-bottom flex h-full flex-col overflow-y-auto bg-bg">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center gap-3">
          <img src="./icons/icon.svg" alt="" className="size-11" />
          <div>
            <h1 className="text-xl font-bold">{t('title')}</h1>
            <p className="text-sm text-muted">{t('subtitle')}</p>
          </div>
        </div>

        {step !== 'join' && (
          <ol className="mb-6 flex gap-2">
            {steps.map((s, i) => (
              <li key={s} className={cn('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-primary' : 'bg-border')} />
            ))}
          </ol>
        )}

        <div className="flex-1 rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7" onKeyDown={onEnter}>
          {step === 'language' && (
            <>
              <h2 className="mb-1 text-lg font-semibold">{t('chooseLanguage')}</h2>
              <p className="mb-5 text-sm text-muted">{t('chooseLanguageHint')}</p>
              <LanguageGrid value={i18n.language} onChange={changeLanguage} />
            </>
          )}

          {step === 'business' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{t('business')}</h2>
                <p className="text-sm text-muted">{t('businessHint')}</p>
              </div>
              <Input label={t('businessName')} value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} placeholder={t('businessNamePlaceholder')} autoFocus maxLength={LIMITS.businessName} />
              <Select
                label={t('country')}
                value={biz.country}
                onChange={(e) => setBiz({ ...biz, country: e.target.value })}
                options={COUNTRY_PRESETS.map((p) => ({ value: p.code, label: p.code === 'OTHER' ? t('otherCountry') : `${p.name} · ${p.currency}` }))}
                hint={t('countryHint', { currency: preset.currency, taxes: preset.taxes.map((x) => x.name).join(', ') })}
              />
              {biz.country === 'IN' && (
                <Select label={t('state')} value={biz.state} onChange={(e) => setBiz({ ...biz, state: e.target.value })} placeholder={t('selectState')} options={INDIAN_STATES.map(([code, name]) => ({ value: code, label: `${code} · ${name}` }))} />
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <PhoneInput label={t('phone')} value={biz.phone} onChange={(v) => setBiz({ ...biz, phone: v })} />
                <TaxIdInput label={preset.taxLabel} value={biz.taxNumber} country={biz.country} onChange={(v) => setBiz({ ...biz, taxNumber: v })} hint={t('optional')} />
              </div>
              <Input label={t('address')} value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} hint={t('optional')} maxLength={LIMITS.address} />
            </div>
          )}

          {step === 'admin' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{t('admin')}</h2>
                <p className="text-sm text-muted">{t('adminHint')}</p>
              </div>
              <Input label={t('yourName')} value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} autoFocus maxLength={LIMITS.name} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label={t('pin')} type="password" inputMode="numeric" maxLength={6} value={admin.pin} onChange={(e) => setAdmin({ ...admin, pin: e.target.value.replace(/\D/g, '') })} hint={t('pinHint')} />
                <Input label={t('confirmPin')} type="password" inputMode="numeric" maxLength={6} value={admin.pin2} onChange={(e) => setAdmin({ ...admin, pin2: e.target.value.replace(/\D/g, '') })} error={pinError} />
              </div>
            </div>
          )}

          {step === 'finish' && (
            <div className="space-y-5">
              <div className="flex flex-col items-center py-4 text-center">
                <div className="mb-3 flex size-16 items-center justify-center rounded-3xl bg-success-soft text-success">
                  <Rocket className="size-8" />
                </div>
                <h2 className="text-lg font-semibold">{t('almostDone')}</h2>
                <p className="text-sm text-muted">{t('almostDoneHint')}</p>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <Toggle checked={demo} onChange={setDemo} label={t('demoData')} description={t('demoDataHint')} />
              </div>
              <ul className="space-y-2 text-sm text-muted">
                <li className="flex gap-2"><Check className="size-4 text-success" /> {preset.name} · {preset.currency}</li>
                <li className="flex gap-2"><Check className="size-4 text-success" /> {preset.taxes.map((x) => x.name).join(', ')}</li>
                <li className="flex gap-2"><Check className="size-4 text-success" /> {preset.pricesIncludeTax ? t('pricesInclusive') : t('pricesExclusive')}</li>
              </ul>
            </div>
          )}

          {step === 'join' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{t('joinTitle')}</h2>
                <p className="text-sm text-muted">{t('joinHint')}</p>
              </div>
              <Input label={t('serverUrl')} placeholder="https://pos.example.com" value={join.url} onChange={(e) => setJoin({ ...join, url: e.target.value.trim() })} autoFocus />
              <Input label={t('storeKey')} value={join.key} onChange={(e) => setJoin({ ...join, key: e.target.value.trim() })} />
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          {step === 'language' ? (
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" icon={<CloudDownload className="size-4" />} onClick={() => setStep('join')}>
                {t('joinExisting')}
              </Button>
              <Button variant="ghost" icon={<FileUp className="size-4" />} onClick={() => void restoreFromFile()} disabled={busy}>
                {t('restoreBackup')}
              </Button>
            </div>
          ) : (
            <Button variant="ghost" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => setStep(step === 'join' ? 'language' : steps[idx - 1])}>
              {t('common:back')}
            </Button>
          )}
          <div className="flex-1" />
          {step === 'join' ? (
            <Button variant="primary" size="lg" loading={busy} disabled={!join.url || !join.key} onClick={doJoin} icon={<CloudDownload className="size-5" />}>
              {t('join')}
            </Button>
          ) : step === 'finish' ? (
            <Button variant="primary" size="lg" loading={busy} onClick={finish} icon={<Store className="size-5" />}>
              {t('start')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              iconRight={<ArrowRight className="size-5 rtl:rotate-180" />}
              disabled={nextDisabled}
              onClick={() => setStep(steps[idx + 1])}
            >
              {t('common:next')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function guessCountry(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IN'
    const region = new Intl.Locale(navigator.language).maximize().region
    if (region && COUNTRY_PRESETS.some((p) => p.code === region)) return region
  } catch {
    /* ignore */
  }
  return 'IN'
}
