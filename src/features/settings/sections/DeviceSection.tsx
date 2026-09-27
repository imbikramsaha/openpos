import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGrid, Monitor, Moon, PanelLeft, PanelRight, Printer, RefreshCw, Sun } from 'lucide-react'
import { db } from '@/db/db'
import { getMeta } from '@/db/repo'
import { electron } from '@/lib/platform'
import { escapeHtml, printHtml } from '@/lib/print'
import { formatDateTime } from '@/lib/dates'
import { applyTheme, useDevice, type DeviceConfig } from '@/stores/device'
import { useSettings } from '@/stores/settings'
import { confirmDialog } from '@/stores/ui'
import { LanguageGrid, useChangeLanguage } from '@/components/LanguagePicker'
import { Button, Input, Segmented, Select } from '@/components/ui'
import { ControlRow, Group, Notice, Row, Stack, ToggleRow } from '../ui'
import { notifySaved } from '../hooks'

const TERMINAL = /^[A-Z0-9]{2,6}$/

export function DeviceSection() {
  const { t, i18n } = useTranslation('settings')
  const dev = useDevice()
  const changeLanguage = useChangeLanguage()
  const update = (changes: Partial<DeviceConfig>) => {
    dev.update(changes)
    notifySaved()
  }

  return (
    <Stack>
      <Notice>{t('device.intro')}</Notice>

      <Group title={t('device.identity')}>
        <TerminalCode />
        <Row id="device.terminalName">
          <TerminalName />
        </Row>
      </Group>

      <Group title={t('device.appearance')}>
        <ControlRow id="device.theme" label={t('device.theme')} description={t('device.themeHint')}>
          <Segmented
            value={dev.theme}
            onChange={(theme) => {
              update({ theme })
              applyTheme(theme)
            }}
            options={[
              { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="size-4" /> {t('device.themeSystem')}</span> },
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="size-4" /> {t('device.themeLight')}</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="size-4" /> {t('device.themeDark')}</span> },
            ]}
            className="w-full sm:w-auto"
          />
        </ControlRow>
        <Row id="device.language">
          <div className="mb-3">
            <div className="text-sm font-medium">{t('device.language')}</div>
            <div className="text-xs text-subtle">{t('device.languageHint')}</div>
          </div>
          <LanguageGrid
            value={i18n.language}
            // Confirm in the language just chosen, not the one being left.
            onChange={(code) => void changeLanguage(code).then(notifySaved)}
          />
        </Row>
      </Group>

      <Group title={t('device.sellScreen')}>
        <ControlRow id="device.cartSide" label={t('device.cartSide')} description={t('device.cartSideHint')}>
          <Segmented
            value={dev.cartSide}
            onChange={(cartSide) => update({ cartSide })}
            options={[
              { value: 'left', label: <span className="flex items-center gap-1.5"><PanelLeft className="size-4" /> {t('device.left')}</span> },
              { value: 'right', label: <span className="flex items-center gap-1.5"><PanelRight className="size-4" /> {t('device.right')}</span> },
            ]}
          />
        </ControlRow>
        <ControlRow id="device.gridSize" label={t('device.gridSize')} description={t('device.gridSizeHint')}>
          <Segmented
            value={dev.gridSize}
            onChange={(gridSize) => update({ gridSize })}
            options={[
              { value: 'sm', label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-3.5" /> {t('device.small')}</span> },
              { value: 'md', label: t('device.medium') },
              { value: 'lg', label: t('device.large') },
            ]}
          />
        </ControlRow>
        <ToggleRow id="device.showImages" label={t('device.showImages')} description={t('device.showImagesHint')} checked={dev.showImages} onChange={(showImages) => update({ showImages })} />
        <ToggleRow id="device.sound" label={t('device.sound')} description={t('device.soundHint')} checked={dev.sound} onChange={(sound) => update({ sound })} />
        <ToggleRow id="device.cameraScanner" label={t('device.cameraScanner')} description={t('device.cameraScannerHint')} checked={dev.cameraScanner} onChange={(cameraScanner) => update({ cameraScanner })} />
      </Group>

      <PrinterGroup onSaved={notifySaved} />
    </Stack>
  )
}

function TerminalCode() {
  const { t } = useTranslation('settings')
  const terminal = useDevice((s) => s.terminal)
  const deviceId = useDevice((s) => s.deviceId)
  const update = useDevice((s) => s.update)
  const [value, setValue] = useState(terminal)
  const [clash, setClash] = useState(false)
  useEffect(() => setValue(terminal), [terminal])
  const valid = TERMINAL.test(value)

  // Warn when another till's invoices already use this code.
  useEffect(() => {
    if (!valid || value === terminal) return setClash(false)
    let alive = true
    // Uses the number index, so this stays instant with years of sales on the device.
    void db.sales
      .where('number')
      .startsWithAnyOf(`INV-${value}-`, `CRN-${value}-`)
      .filter((s) => s.deviceId !== deviceId)
      .first()
      .then((hit) => alive && setClash(!!hit))
    return () => {
      alive = false
    }
  }, [value, valid, terminal, deviceId])

  const commit = async () => {
    if (!valid || value === terminal) {
      if (!valid) setValue(terminal)
      return
    }
    const seq = await getMeta<number>('seq:sale', 0)
    const next = `INV-${value}-${String(seq + 1).padStart(6, '0')}`
    const ok = await confirmDialog({
      title: t('device.terminalChangeTitle'),
      message: t('device.terminalChangeMessage', { code: value, example: next }),
      confirmLabel: t('device.terminalChangeConfirm'),
    })
    if (!ok) return setValue(terminal)
    update({ terminal: value })
    notifySaved()
  }

  return (
    <Row id="device.terminal">
      <Input
        label={t('device.terminal')}
        value={value}
        maxLength={6}
        autoCapitalize="characters"
        spellCheck={false}
        className="tnum font-mono tracking-widest uppercase sm:max-w-xs"
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        error={!valid ? t('device.terminalInvalid') : undefined}
        hint={t('device.terminalHint', { example: `INV-${value || terminal}-000001` })}
      />
      {clash && <p className="mt-2 text-xs font-medium text-warning">{t('device.terminalClash', { code: value })}</p>}
    </Row>
  )
}

function TerminalName() {
  const { t } = useTranslation('settings')
  const name = useDevice((s) => s.terminalName)
  const update = useDevice((s) => s.update)
  const [value, setValue] = useState(name)
  useEffect(() => setValue(name), [name])
  const commit = () => {
    const v = value.trim()
    if (!v) return setValue(name)
    if (v !== name) {
      update({ terminalName: v })
      notifySaved()
    }
  }
  return (
    <Input
      label={t('device.terminalName')}
      hint={t('device.terminalNameHint')}
      value={value}
      maxLength={40}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  )
}

function PrinterGroup({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation('settings')
  const bridge = electron()
  const printer = useDevice((s) => s.printer)
  const silent = useDevice((s) => s.silentPrint)
  const terminalName = useDevice((s) => s.terminalName)
  const terminal = useDevice((s) => s.terminal)
  const update = useDevice((s) => s.update)
  const settings = useSettings((s) => s.settings)
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault: boolean }> | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!bridge) return
    setLoading(true)
    try {
      setPrinters(await bridge.getPrinters())
    } catch {
      setPrinters([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const testPage = () => {
    const width = settings.receipt.paperWidth === 'a4' ? undefined : settings.receipt.paperWidth
    const w = width ?? 80
    const ruler = '1234567890'.repeat(8).slice(0, w === 58 ? 32 : 48)
    const html = `<!doctype html><html dir="${document.documentElement.dir}"><head><meta charset="utf-8"><title>Test</title><style>
      @page { size: ${width ? `${width}mm auto` : 'A4'}; margin: ${width ? 0 : '12mm'} }
      body { margin: 0; padding: 3mm 4mm; ${width ? `width: ${width}mm;` : ''} box-sizing: border-box; font: 12px/1.4 system-ui, 'Segoe UI', 'Noto Sans', 'Nirmala UI', sans-serif; color: #000 }
      h1 { font-size: 16px; margin: 0 0 4px; text-align: center } .c { text-align: center } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
      .mono { font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all } .big { font-size: 20px; font-weight: 800 }
    </style></head><body>
      <h1>${escapeHtml(t('device.testPageTitle'))}</h1>
      <div class="c">${escapeHtml(settings.businessName)}</div>
      <div class="c">${escapeHtml(terminalName)} · ${escapeHtml(terminal)}</div>
      <div class="c">${escapeHtml(formatDateTime(Date.now()))}</div><hr>
      <div class="mono">${ruler}</div><hr>
      <div class="big c">ABC 123 ₹ € $</div>
      <div class="c">English · हिन्दी · বাংলা · தமிழ் · العربية · اردو · 中文</div><hr>
      <div class="c">${escapeHtml(t('device.testPageFooter'))}</div>
    </body></html>`
    void printHtml(html, width)
  }

  return (
    <Group title={t('device.printer')} description={bridge ? t('device.printerDesktopHint') : t('device.printerBrowserHint')}>
      {bridge ? (
        <>
          <Row id="device.printer">
            <div className="flex items-end gap-2">
              <Select
                label={t('device.printer')}
                value={printer}
                onChange={(e) => {
                  update({ printer: e.target.value })
                  onSaved()
                }}
                placeholder={t('device.systemDefault')}
                options={(printers ?? []).map((p) => ({ value: p.name, label: p.isDefault ? `${p.displayName || p.name} (${t('device.default')})` : p.displayName || p.name }))}
                wrapperClassName="min-w-0 flex-1"
              />
              <Button size="icon" className="h-11 w-11" aria-label={t('device.refreshPrinters')} title={t('device.refreshPrinters')} loading={loading} onClick={() => void load()}>
                {!loading && <RefreshCw className="size-4" />}
              </Button>
            </div>
            {printers && !printers.length && <p className="mt-2 text-xs text-warning">{t('device.noPrinters')}</p>}
          </Row>
          <ToggleRow
            id="device.silentPrint"
            label={t('device.silentPrint')}
            description={t('device.silentPrintHint')}
            checked={silent}
            onChange={(silentPrint) => {
              update({ silentPrint })
              onSaved()
            }}
          />
        </>
      ) : (
        <Row id="device.printer">
          <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
            <li>{t('device.browserTip1')}</li>
            <li>{t('device.browserTip2')}</li>
            <li>{t('device.browserTip3')}</li>
          </ul>
        </Row>
      )}
      <Row id="device.testPage">
        <Button icon={<Printer className="size-4" />} onClick={testPage}>
          {t('device.testPage')}
        </Button>
      </Row>
    </Group>
  )
}
