import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, Cloud, CloudOff, Eye, EyeOff, Network, PlugZap, RefreshCw, Save, WifiOff } from 'lucide-react'
import { useDevice } from '@/stores/device'
import { toast } from '@/stores/ui'
import { useSyncStatus } from '@/sync/status'
import { startSync, stopSync, syncNow, testConnection, type ConnectionResult } from '@/sync/engine'
import { formatDateTime, relativeTime } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { Button, Input } from '@/components/ui'
import { Group, Notice, Row, Stack, ToggleRow } from '../ui'
import { notifySaved } from '../hooks'

function validUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

async function restart() {
  stopSync()
  await startSync()
}

export function SyncSection() {
  const { t } = useTranslation('settings')
  const dev = useDevice()
  const [url, setUrl] = useState(dev.serverUrl)
  const [key, setKey] = useState(dev.storeKey)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  useEffect(() => {
    setUrl(dev.serverUrl)
    setKey(dev.storeKey)
  }, [dev.serverUrl, dev.storeKey])

  const dirty = url.trim() !== dev.serverUrl || key.trim() !== dev.storeKey
  const urlError = url.trim() && !validUrl(url.trim()) ? t('sync.urlInvalid') : undefined
  // An https:// page (the hosted web app) may not call an http:// server: the browser blocks it.
  const mixedContent = !urlError && location.protocol === 'https:' && /^http:\/\//i.test(url.trim()) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url.trim())
  const canTest = !!url.trim() && !!key.trim() && !urlError

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await testConnection(url.trim().replace(/\/+$/, ''), key.trim()))
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const serverUrl = url.trim().replace(/\/+$/, '')
      dev.update({ serverUrl, storeKey: key.trim(), syncEnabled: !!serverUrl && !!key.trim() && (dev.syncEnabled || !dev.serverUrl) })
      await restart()
      notifySaved()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack>
      <StatusCard />

      <Group title={t('sync.connection')} description={t('sync.connectionHint')}>
        <Row id="sync.serverUrl">
          <Input
            label={t('sync.serverUrl')}
            placeholder="http://192.168.1.20:8787"
            dir="ltr"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setResult(null)
            }}
            error={urlError}
            left={<Network className="size-4.5" />}
          />
          {mixedContent && (
            <Notice tone="warning" className="mt-3">
              {t('sync.mixedContent')}
            </Notice>
          )}
        </Row>
        <Row id="sync.storeKey">
          <Input
            label={t('sync.storeKey')}
            hint={t('sync.storeKeyHint')}
            type={showKey ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setResult(null)
            }}
            className="font-mono"
            dir="ltr"
            right={
              <button type="button" onClick={() => setShowKey((v) => !v)} className="flex size-8 items-center justify-center rounded-lg text-subtle hover:bg-surface-3" aria-label={showKey ? t('sync.hideKey') : t('sync.showKey')}>
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            }
          />
        </Row>
        {result && (
          <Row>
            {result.ok ? (
              <Notice tone="success" title={t('sync.testOk')}>{result.storeName ? t('sync.testOkStore', { name: result.storeName }) : undefined}</Notice>
            ) : (
              <Notice tone="danger" title={t('sync.testFailed')}>{result.error}</Notice>
            )}
          </Row>
        )}
        <Row id="sync.test">
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={<PlugZap className="size-4" />} loading={testing} disabled={!canTest} onClick={() => void test()}>
              {t('sync.test')}
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty || !!urlError} onClick={() => void save()}>
              {t('sync.save')}
            </Button>
            {dirty && <span className="text-xs text-warning">{t('sync.unsaved')}</span>}
          </div>
        </Row>
        <ToggleRow
          id="sync.enabled"
          label={t('sync.enabled')}
          description={dev.serverUrl && dev.storeKey ? t('sync.enabledHint') : t('sync.enabledNeedsServer')}
          checked={dev.syncEnabled}
          disabled={!dev.serverUrl || !dev.storeKey}
          onChange={(syncEnabled) => {
            dev.update({ syncEnabled })
            notifySaved()
            void restart()
          }}
        />
      </Group>

      <Group title={t('sync.howTitle')}>
        <Row>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <Network className="size-4.5 text-primary" /> {t('sync.lanTitle')}
              </div>
              <p className="text-sm text-muted">{t('sync.lanHint')}</p>
            </div>
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <Cloud className="size-4.5 text-primary" /> {t('sync.cloudTitle')}
              </div>
              <p className="text-sm text-muted">{t('sync.cloudHint')}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-subtle">
            {t('sync.readme')} <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-fg">server/README.md</code>
          </p>
        </Row>
      </Group>
    </Stack>
  )
}

function StatusCard() {
  const { t } = useTranslation('settings')
  const { state, online, pending, lastSync, error } = useSyncStatus()
  const enabled = useDevice((s) => s.syncEnabled && !!s.serverUrl)
  const terminal = useDevice((s) => s.terminal)
  const deviceId = useDevice((s) => s.deviceId)
  const [busy, setBusy] = useState(false)
  const effective = !online ? 'offline' : state
  const look = {
    disabled: { icon: CloudOff, tone: 'bg-surface-3 text-subtle', label: t('common:sync.local') },
    offline: { icon: WifiOff, tone: 'bg-warning-soft text-warning', label: t('common:sync.offline') },
    idle: { icon: CheckCircle2, tone: 'bg-success-soft text-success', label: t('common:sync.synced') },
    syncing: { icon: RefreshCw, tone: 'bg-primary-soft text-primary', label: t('common:sync.syncing') },
    error: { icon: AlertCircle, tone: 'bg-danger-soft text-danger', label: t('common:sync.error') },
  }[effective]
  const Icon = look.icon
  const now = async () => {
    setBusy(true)
    try {
      await syncNow()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div data-setting="sync.status" className="rounded-2xl border border-border bg-surface p-4 shadow-card transition-[background-color,box-shadow] duration-500 sm:p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', look.tone)}>
          <Icon className={cn('size-6', effective === 'syncing' && 'animate-spin')} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold">{look.label}</div>
          <div className="text-sm text-muted">
            {lastSync ? <span title={formatDateTime(lastSync)}>{t('sync.lastSync', { time: relativeTime(lastSync) })}</span> : t('sync.never')}
            {' · '}
            {t('sync.pending', { count: pending })}
          </div>
        </div>
        <div data-setting="sync.now">
          <Button icon={<RefreshCw className={cn('size-4', busy && 'animate-spin')} />} disabled={!enabled || busy || !online} onClick={() => void now()}>
            {t('sync.now')}
          </Button>
        </div>
      </div>
      {error && effective === 'error' && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs">
        <div>
          <div className="text-subtle">{t('sync.thisTerminal')}</div>
          <div className="tnum font-mono font-semibold">{terminal}</div>
        </div>
        <div className="min-w-0">
          <div className="text-subtle">{t('sync.deviceId')}</div>
          <div className="truncate font-mono text-muted" title={deviceId}>
            {deviceId}
          </div>
        </div>
      </div>
    </div>
  )
}
