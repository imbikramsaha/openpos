import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, CloudUpload, Download, FolderOpen, HardDrive, History, Link2, Lock, LogOut, RotateCcw, TriangleAlert } from 'lucide-react'
import { formatDateTime, relativeTime } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { cn } from '@/lib/cn'
import { confirmDialog, toast } from '@/stores/ui'
import { Badge, Button, ComingSoon, Input, Modal, NumberInput, Select, Spinner, Toggle } from '@/components/ui'
import { requirePermission } from '@/features/auth/permission'
import { InvalidBackup, parseBackup, readBackupText, restoreBackup } from '../backup'
import { Group, Row, Stack } from '../ui'
import { WrongPassphrase } from '@/features/backup/crypto'
import { allowFolder, chooseFolder, folderName, folderSupported, forgetFolder, listFolder, readFromFolder } from '@/features/backup/folder'
import { cloudSupported, connect, disconnect, isConfigured, isConnected, type CloudProvider } from '@/features/backup/oauth'
import { CLOUD_BACKUP_READY } from '@/core/features'
import { isElectron } from '@/lib/platform'
import { CLOUD, type RemoteFile } from '@/features/backup/providers'
import { CLOUD_TARGETS, clearStatus, hasPassphrase, loadAutoBackup, runAutoBackup, saveConfig, setPassphrase, useAutoBackup, type TargetId } from '@/features/backup/runner'
import { askBackupPassphrase } from '@/features/backup/ui'
import { kvGet, kvSet, localDb } from '@/features/backup/store'

const INTERVALS = [1, 4, 12, 24, 0]
const BRAND: Record<CloudProvider, string> = { gdrive: 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox' }

const formatSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** Validates, confirms and restores a backup file from any destination. */
async function restoreFrom(blob: Blob, t: (k: string, o?: Record<string, unknown>) => string) {
  if (!(await requirePermission('users_manage'))) return
  try {
    const text = await readBackupText(blob, askBackupPassphrase)
    if (text === null) return
    const summary = parseBackup(text)
    const ok = await confirmDialog({
      title: t('backup.confirmTitle'),
      message: t('backup.confirmMessage', { date: summary.exportedAt ? formatDateTime(summary.exportedAt) : '—' }),
      confirmLabel: t('backup.confirmRestore'),
      danger: true,
    })
    if (ok) await restoreBackup(summary.file)
  } catch (e) {
    toast(e instanceof WrongPassphrase ? t('autoBackup.wrongPassphrase') : e instanceof InvalidBackup ? t(`backup.error.${e.code}`) : e instanceof Error ? e.message : String(e), 'error')
  }
}

export function AutoBackupSection() {
  const { t } = useTranslation('settings')
  const { config, running, loaded } = useAutoBackup()
  const [encryptSet, setEncryptSet] = useState(false)

  useEffect(() => {
    void loadAutoBackup()
    void hasPassphrase().then(setEncryptSet)
  }, [])

  const backupNow = async () => {
    const failed = await runAutoBackup('manual')
    const enabled = Object.values(config.targets).filter(Boolean).length
    if (!enabled) return toast(t('autoBackup.noneEnabled'), 'warning')
    toast(failed.length ? t('autoBackup.someFailed', { count: failed.length }) : t('autoBackup.done'), failed.length ? 'error' : 'success')
  }

  if (!loaded) return <Spinner />

  return (
    <Stack>
      <Group title={t('autoBackup.scheduleTitle')} description={t('autoBackup.scheduleHint')}>
        <Row id="autoBackup.schedule">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('autoBackup.every')}
              value={String(config.intervalHours)}
              onChange={(e) => void saveConfig({ intervalHours: Number(e.target.value) })}
              options={INTERVALS.map((h) => ({ value: String(h), label: h ? t('autoBackup.interval', { count: h }) : t('autoBackup.onlyShift') }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <CountInput label={t('autoBackup.keep')} hint={t('autoBackup.keepHint')} value={config.keep} min={1} max={365} onSave={(keep) => void saveConfig({ keep })} />
              <CountInput label={t('autoBackup.keepOnDevice')} value={config.keepOnDevice} min={1} max={30} onSave={(keepOnDevice) => void saveConfig({ keepOnDevice })} />
            </div>
          </div>
        </Row>
        <Row>
          <Toggle label={t('autoBackup.onShiftClose')} description={t('autoBackup.onShiftCloseHint')} checked={config.onShiftClose} onChange={(v) => void saveConfig({ onShiftClose: v })} />
        </Row>
        <Row id="autoBackup.encrypt">
          <EncryptionControl enabled={config.encrypt} passphraseSet={encryptSet} onChange={(enabled, set) => (setEncryptSet(set), void saveConfig({ encrypt: enabled }))} />
        </Row>
        <Row>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<CloudUpload className="size-4" />} loading={running} onClick={() => void backupNow()}>
              {t('autoBackup.backupNow')}
            </Button>
            <span className="text-xs text-muted">{t('autoBackup.whileOpen')}</span>
          </div>
        </Row>
      </Group>

      <Group title={t('autoBackup.destinations')} description={t('autoBackup.destinationsHint')}>
        <DeviceTarget />
        <FolderTarget />
        {CLOUD_TARGETS.map((p) => (
          <CloudTarget key={p} provider={p} />
        ))}
      </Group>
    </Stack>
  )

}

function EncryptionControl({ enabled, passphraseSet, onChange }: { enabled: boolean; passphraseSet: boolean; onChange: (enabled: boolean, set: boolean) => void }) {
  const { t } = useTranslation('settings')
  const [editing, setEditing] = useState(false)
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const tooShort = a.length > 0 && a.length < 8
  const mismatch = b.length > 0 && a !== b
  const save = async () => {
    await setPassphrase(a)
    setEditing(false)
    setA('')
    setB('')
    onChange(true, true)
    toast(t('autoBackup.passphraseSaved'))
  }
  return (
    <div className="space-y-3">
      <Toggle
        label={
          <span className="flex items-center gap-2">
            <Lock className="size-4" /> {t('autoBackup.encrypt')}
          </span>
        }
        description={t('autoBackup.encryptHint')}
        checked={enabled && passphraseSet}
        onChange={(v) => (v && !passphraseSet ? setEditing(true) : onChange(v, passphraseSet))}
      />
      {(editing || (enabled && passphraseSet)) && (
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          {editing ? (
            <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => (e.preventDefault(), !tooShort && !mismatch && a && void save())}>
              <Input label={t('autoBackup.passphrase')} type="password" value={a} onChange={(e) => setA(e.target.value)} error={tooShort ? t('autoBackup.passphraseShort') : undefined} autoComplete="new-password" autoFocus />
              <Input label={t('autoBackup.passphraseConfirm')} type="password" value={b} onChange={(e) => setB(e.target.value)} error={mismatch ? t('autoBackup.passphraseMismatch') : undefined} autoComplete="new-password" />
              <div className="flex gap-2">
                <Button onClick={() => setEditing(false)}>{t('common:cancel')}</Button>
                <Button type="submit" variant="primary" disabled={!a || tooShort || a !== b}>
                  {t('common:save')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="success">
                <Lock className="size-3" /> {t('autoBackup.encryptedOn')}
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                {t('autoBackup.changePassphrase')}
              </Button>
            </div>
          )}
          <p className="mt-2 flex gap-2 text-xs text-warning">
            <TriangleAlert className="size-4 shrink-0" /> {t('autoBackup.passphraseWarning')}
          </p>
        </div>
      )}
    </div>
  )
}

// ---- Destination cards --------------------------------------------------------------------

function TargetCard({ id, icon, title, subtitle, badge, children, actions, unavailable }: {
  id: TargetId
  icon: ReactNode
  title: string
  subtitle?: ReactNode
  badge?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  unavailable?: boolean
}) {
  const { t } = useTranslation('settings')
  const { config, status } = useAutoBackup()
  const s = status[id]
  return (
    <Row id={`autoBackup.${id}`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary [&>svg]:size-5">{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              {title}
              {badge}
            </div>
            {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
            {s && (
              <div className={cn('mt-1 flex items-center gap-1.5 text-xs', s.needs || (s.error && (s.lastAttempt ?? 0) > (s.lastSuccess ?? 0)) ? 'text-danger' : 'text-success')}>
                {s.needs || (s.error && (s.lastAttempt ?? 0) > (s.lastSuccess ?? 0)) ? (
                  <>
                    <TriangleAlert className="size-3.5" /> {s.needs ? t(`autoBackup.needs.${s.needs}`) : s.error}
                  </>
                ) : s.lastSuccess ? (
                  <>
                    <CheckCircle2 className="size-3.5" /> {t('autoBackup.lastSuccess', { time: relativeTime(s.lastSuccess) })}
                  </>
                ) : null}
              </div>
            )}
          </div>
          <Toggle aria-label={title} checked={!unavailable && config.targets[id]} disabled={unavailable} onChange={(v) => void saveConfig({ targets: { ...config.targets, [id]: v } })} />
        </div>
        {(actions || children) && (
          <div className="flex flex-col gap-2 sm:ps-13">
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
            {children}
          </div>
        )}
      </div>
    </Row>
  )
}

function DeviceTarget() {
  const { t } = useTranslation('settings')
  const snapshots = useLiveQuery(() => localDb.snapshots.orderBy('createdAt').reverse().toArray(), [])
  return (
    <TargetCard id="device" icon={<HardDrive />} title={t('autoBackup.device')} subtitle={t('autoBackup.deviceHint')}>
      {!!snapshots?.length && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {snapshots.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <History className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{formatDateTime(s.createdAt)}</span>
                <span className="tnum flex items-center gap-1 text-xs text-muted">
                  {formatSize(s.size)}
                  {s.encrypted && <Lock className="size-3" aria-label={t('autoBackup.encryptedOn')} />}
                </span>
              </span>
              {/* Icon-only on phones; the label stays available to screen readers. */}
              <Button size="sm" variant="ghost" icon={<Download className="size-4" />} onClick={() => downloadBlob(s.filename, s.blob)}>
                <span className="max-sm:sr-only">{t('common:download')}</span>
              </Button>
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => void restoreFrom(s.blob, t)}>
                <span className="max-sm:sr-only">{t('backup.restore')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </TargetCard>
  )
}

function FolderTarget() {
  const { t } = useTranslation('settings')
  const status = useAutoBackup((s) => s.status.folder)
  const [name, setName] = useState<string | null>(null)
  const [browse, setBrowse] = useState(false)
  useEffect(() => void folderName().then(setName), [])
  if (!folderSupported())
    return <TargetCard id="folder" icon={<FolderOpen />} title={t('autoBackup.folder')} subtitle={t('autoBackup.folderUnsupported')} unavailable />
  const pick = async () => {
    try {
      setName(await chooseFolder())
      void saveConfig({ targets: { ...useAutoBackup.getState().config.targets, folder: true } })
    } catch {
      /* picker cancelled */
    }
  }
  return (
    <TargetCard
      id="folder"
      icon={<FolderOpen />}
      title={t('autoBackup.folder')}
      subtitle={name ? t('autoBackup.folderChosen', { name }) : t('autoBackup.folderHint')}
      actions={
        <>
          <Button size="sm" icon={<FolderOpen className="size-4" />} onClick={() => void pick()}>
            {name ? t('autoBackup.changeFolder') : t('autoBackup.chooseFolder')}
          </Button>
          {name && status?.needs === 'permission' && (
            <Button size="sm" variant="primary" onClick={() => void allowFolder().then((ok) => ok && toast(t('autoBackup.folderAllowed')))}>
              {t('autoBackup.allowFolder')}
            </Button>
          )}
          {name && (
            <>
              <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setBrowse(true)}>
                {t('autoBackup.restoreFrom')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void forgetFolder().then(() => (setName(null), clearStatus('folder')))}>
                {t('autoBackup.forgetFolder')}
              </Button>
            </>
          )}
        </>
      }
    >
      <RemoteList open={browse} onClose={() => setBrowse(false)} title={t('autoBackup.folder')} list={listFolder} fetch={(f) => readFromFolder(f.id)} />
    </TargetCard>
  )
}

function CloudTarget({ provider }: { provider: CloudProvider }) {
  const { t } = useTranslation('settings')
  const status = useAutoBackup((s) => s.status[provider])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [browse, setBrowse] = useState(false)
  const accountKey = `oauth:${provider}:account`
  useEffect(() => {
    void isConnected(provider).then(setConnected)
    void kvGet(accountKey, '').then(setAccount)
  }, [provider, accountKey])

  if (!CLOUD_BACKUP_READY) return <TargetCard id={provider} icon={<CloudUpload />} title={BRAND[provider]} badge={<ComingSoon />} unavailable />
  if (!isConfigured(provider))
    return <TargetCard id={provider} icon={<CloudUpload />} title={BRAND[provider]} subtitle={t('autoBackup.notConfigured')} unavailable />
  if (!cloudSupported())
    return (
      <TargetCard
        id={provider}
        icon={<CloudUpload />}
        title={BRAND[provider]}
        subtitle={t(isElectron() ? 'autoBackup.desktopUseFolder' : 'autoBackup.mobileUseFile', { name: BRAND[provider] })}
        unavailable
      />
    )

  const doConnect = async () => {
    setBusy(true)
    try {
      await connect(provider)
      const who = await CLOUD[provider].account().catch(() => '')
      await kvSet(accountKey, who)
      setAccount(who)
      setConnected(true)
      await saveConfig({ targets: { ...useAutoBackup.getState().config.targets, [provider]: true } })
      toast(t('autoBackup.connected', { name: BRAND[provider] }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg !== 'cancelled') toast(msg === 'popup blocked' ? t('autoBackup.popupBlocked') : msg, 'error')
    } finally {
      setBusy(false)
    }
  }
  const doDisconnect = async () => {
    if (!(await confirmDialog({ title: t('autoBackup.disconnectTitle', { name: BRAND[provider] }), message: t('autoBackup.disconnectHint') }))) return
    await disconnect(provider)
    await clearStatus(provider)
    setConnected(false)
    await saveConfig({ targets: { ...useAutoBackup.getState().config.targets, [provider]: false } })
  }

  return (
    <TargetCard
      id={provider}
      icon={<CloudUpload />}
      title={BRAND[provider]}
      subtitle={connected ? t('autoBackup.connectedAs', { account: account || BRAND[provider] }) : t(`autoBackup.hint.${provider}`)}
      actions={
        connected ? (
          <>
            {status?.needs === 'reconnect' && (
              <Button size="sm" variant="primary" icon={<Link2 className="size-4" />} loading={busy} onClick={() => void doConnect()}>
                {t('autoBackup.reconnect')}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setBrowse(true)}>
              {t('autoBackup.restoreFrom')}
            </Button>
            <Button size="sm" variant="ghost" icon={<LogOut className="size-4" />} onClick={() => void doDisconnect()}>
              {t('autoBackup.disconnect')}
            </Button>
          </>
        ) : connected === false ? (
          <Button size="sm" variant="primary" icon={<Link2 className="size-4" />} loading={busy} onClick={() => void doConnect()}>
            {t('autoBackup.connect', { name: BRAND[provider] })}
          </Button>
        ) : null
      }
    >
      <RemoteList open={browse} onClose={() => setBrowse(false)} title={BRAND[provider]} list={() => CLOUD[provider].list()} fetch={(f) => CLOUD[provider].download(f.id)} />
    </TargetCard>
  )
}

function RemoteList({ open, onClose, title, list, fetch }: { open: boolean; onClose: () => void; title: string; list: () => Promise<RemoteFile[]>; fetch: (f: RemoteFile) => Promise<Blob> }) {
  const { t } = useTranslation('settings')
  const [files, setFiles] = useState<RemoteFile[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setFiles(null)
    setError('')
    list().then(setFiles, (e) => setError(e instanceof Error ? e.message : String(e)))
    // Reload each time the list is opened.
  }, [open])
  const pick = async (f: RemoteFile) => {
    setBusy(f.id)
    try {
      const blob = await fetch(f)
      onClose()
      await restoreFrom(blob, t)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t('autoBackup.restoreTitle', { name: title })} size="md" flush>
      {error ? (
        <p className="p-5 text-sm text-danger">{error}</p>
      ) : !files ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : !files.length ? (
        <p className="p-5 text-sm text-muted">{t('autoBackup.noBackups')}</p>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{formatDateTime(f.createdAt)}</span>
                <span className="block truncate text-xs text-muted" dir="ltr">
                  {f.name} · {formatSize(f.size)}
                </span>
              </span>
              <Button size="sm" icon={<RotateCcw className="size-4" />} loading={busy === f.id} disabled={!!busy} onClick={() => void pick(f)}>
                {t('backup.restore')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/**
 * A whole number in [min, max]: saved as soon as it's valid, an error while it isn't, and back
 * to the saved value when the field is left invalid (so the screen never disagrees with the setting).
 */
function CountInput({ label, hint, value, min, max, onSave }: { label: string; hint?: string; value: number; min: number; max: number; onSave: (v: number) => void }) {
  const { t } = useTranslation('settings')
  const [draft, setDraft] = useState<number | undefined>(value)
  const [reset, setReset] = useState(0)
  const ok = (v: number | undefined): v is number => v !== undefined && Number.isInteger(v) && v >= min && v <= max
  return (
    <NumberInput
      key={reset}
      label={label}
      hint={hint}
      value={value}
      inputMode="numeric"
      onChange={(v) => {
        setDraft(v)
        if (ok(v)) onSave(v)
      }}
      onBlur={() => {
        if (ok(draft)) return
        setDraft(value)
        setReset((n) => n + 1)
      }}
      error={ok(draft) ? undefined : t('autoBackup.countRange', { min, max })}
    />
  )
}
