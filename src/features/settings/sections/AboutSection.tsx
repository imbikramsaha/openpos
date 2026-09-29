import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { HardDrive, Keyboard, ShieldCheck, ShieldQuestion } from 'lucide-react'
import pkg from '../../../../package.json'
import { db } from '@/db/db'
import { platformName } from '@/lib/platform'
import { formatNumber, formatPercent } from '@/lib/money'
import { toast } from '@/stores/ui'
import { useDevice } from '@/stores/device'
import { Badge, Button, Kbd, KeyValue, Modal } from '@/components/ui'
import { ControlRow, Group, Row, Stack } from '../ui'
import { formatBytes } from '../hooks'

const CREDITS = ['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'Dexie', 'Zustand', 'i18next', 'Lucide', 'JsBarcode', 'ZXing', 'node-qrcode', 'Electron', 'Capacitor']

export function AboutSection() {
  const { t } = useTranslation('settings')
  const deviceId = useDevice((s) => s.deviceId)
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [shortcuts, setShortcuts] = useState(false)
  const records = useLiveQuery(async () => ({
    products: await db.products.count(),
    customers: await db.customers.count(),
    sales: await db.sales.count(),
  }), [])

  const refresh = async () => {
    try {
      setEstimate((await navigator.storage?.estimate?.()) ?? null)
      setPersisted((await navigator.storage?.persisted?.()) ?? null)
    } catch {
      setEstimate(null)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  const requestPersist = async () => {
    const ok = (await navigator.storage?.persist?.()) ?? false
    setPersisted(ok)
    toast(ok ? t('about.persistGranted') : t('about.persistDenied'), ok ? 'success' : 'warning')
  }

  const usage = estimate?.usage ?? 0
  const quota = estimate?.quota ?? 0
  const pct = quota ? Math.min(100, (usage / quota) * 100) : 0

  return (
    <Stack>
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card">
        <img src="./icons/icon.svg" alt="" className="size-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{t('common:appName')}</div>
          <div className="text-sm text-muted">{t('about.tagline')}</div>
        </div>
        <Badge tone="primary">v{pkg.version}</Badge>
      </div>

      <Group title={t('about.system')}>
        <Row id="about.version">
          <KeyValue label={t('about.version')} value={<span className="font-mono">{pkg.version}</span>} />
          <KeyValue label={t('about.platform')} value={<span className="font-mono">{platformName()}</span>} />
          {pkg.license && pkg.license !== 'UNLICENSED' && <KeyValue label={t('about.license')} value={pkg.license} />}
          <KeyValue label={t('about.deviceId')} value={<span className="block max-w-[14rem] truncate font-mono text-xs sm:max-w-none" title={deviceId}>{deviceId}</span>} />
          {records && (
            <KeyValue
              label={t('about.records')}
              value={t('about.recordsValue', { products: formatNumber(records.products), customers: formatNumber(records.customers), sales: formatNumber(records.sales) })}
            />
          )}
        </Row>
        <Row id="about.storage">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <HardDrive className="size-4 text-subtle" /> {t('about.storage')}
          </div>
          {estimate ? (
            <>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(pct, 1)}%` }} />
              </div>
              <div className="tnum mt-1.5 text-xs text-muted">{t('about.storageValue', { used: formatBytes(usage), quota: formatBytes(quota), percent: formatPercent(Math.round(pct * 10) / 10) })}</div>
            </>
          ) : (
            <div className="text-xs text-subtle">{t('about.storageUnknown')}</div>
          )}
        </Row>
        <ControlRow
          id="about.persist"
          label={
            <span className="flex items-center gap-2">
              {persisted ? <ShieldCheck className="size-4 text-success" /> : <ShieldQuestion className="size-4 text-warning" />}
              {t('about.persist')}
            </span>
          }
          description={persisted ? t('about.persistOn') : t('about.persistOff')}
        >
          {persisted ? (
            <Badge tone="success">{t('about.persistOnBadge')}</Badge>
          ) : (
            <Button size="sm" onClick={() => void requestPersist()} disabled={persisted === null && !navigator.storage?.persist}>
              {t('about.persistRequest')}
            </Button>
          )}
        </ControlRow>
        <ControlRow id="about.shortcuts" label={t('about.shortcuts')} description={t('about.shortcutsHint')}>
          <Button size="sm" icon={<Keyboard className="size-4" />} onClick={() => setShortcuts(true)}>
            {t('about.showShortcuts')}
          </Button>
        </ControlRow>
      </Group>

      <Group title={t('about.credits')}>
        <Row>
          <p className="text-sm text-muted">{t('about.creditsText')}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CREDITS.map((c) => (
              <Badge key={c}>{c}</Badge>
            ))}
          </div>
        </Row>
      </Group>

      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </Stack>
  )
}

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const rows: Array<[string, string]> = [
    ['F1', t('sell:shortcuts.help')],
    ['F2', t('sell:shortcuts.search')],
    ['F3', t('sell:shortcuts.customer')],
    ['F4', t('sell:shortcuts.discount')],
    ['F5 / *', t('sell:shortcuts.quantity')],
    ['F6', t('sell:shortcuts.hold')],
    ['F7', t('sell:shortcuts.recall')],
    ['F8', t('sell:shortcuts.note')],
    ['F9', t('sell:shortcuts.custom')],
    ['F10', t('sell:shortcuts.refund')],
    ['F12 / Ctrl+Enter', t('sell:shortcuts.pay')],
    ['↑ ↓', t('sell:shortcuts.select')],
    ['+ / −', t('sell:shortcuts.qtyStep')],
    ['Del', t('sell:shortcuts.remove')],
    ['Ctrl+L', t('sell:shortcuts.lock')],
  ]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Keyboard className="size-5" /> {t('sell:shortcuts.title')}
        </span>
      }
      footer={<Button onClick={onClose}>{t('common:close')}</Button>}
    >
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([k, label]) => (
          <li key={k} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <Kbd className="inline-block">{k}</Kbd>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-xs text-subtle">{t('sell:shortcuts.scannerHint')}</p>
    </Modal>
  )
}
