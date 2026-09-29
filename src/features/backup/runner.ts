import { create } from 'zustand'
import { db } from '@/db/db'
import { audit, setMeta } from '@/db/repo'
import { uuid } from '@/lib/uuid'
import { buildBackup } from '@/features/settings/backup'
import { encryptBlob } from './crypto'
import { FolderPermission, listFolder, removeFromFolder, writeToFolder } from './folder'
import { NeedsReconnect, cloudSupported, isConfigured, type CloudProvider } from './oauth'
import { CLOUD } from './providers'
import { kvGet, kvSet, localDb } from './store'

// Automatic backups: while the app is open, a backup is made whenever a destination is due
// (and after each shift closes), then old copies beyond the "keep" count are removed.
// Browsers can't run anything while the app is closed, so missed backups happen on next open.

export type TargetId = 'device' | 'folder' | CloudProvider
export const CLOUD_TARGETS: CloudProvider[] = ['gdrive', 'onedrive', 'dropbox']
export const ALL_TARGETS: TargetId[] = ['device', 'folder', ...CLOUD_TARGETS]

export interface AutoBackupConfig {
  targets: Record<TargetId, boolean>
  /** Hours between scheduled backups; 0 = only after closing a shift. */
  intervalHours: number
  onShiftClose: boolean
  /** Copies kept per folder/cloud destination. */
  keep: number
  /** Copies kept inside the app on this device (they take up device storage). */
  keepOnDevice: number
  encrypt: boolean
}

export interface TargetStatus {
  lastSuccess?: number
  lastAttempt?: number
  lastFile?: string
  error?: string
  needs?: 'reconnect' | 'permission'
}

export const DEFAULT_CONFIG: AutoBackupConfig = {
  targets: { device: true, folder: false, gdrive: false, onedrive: false, dropbox: false },
  intervalHours: 24,
  onShiftClose: true,
  keep: 14,
  keepOnDevice: 3,
  encrypt: false,
}

const CONFIG_KEY = 'backup:config'
const STATUS_KEY = 'backup:status'
const PASS_KEY = 'backup:passphrase'
const CHECK_EVERY_MS = 10 * 60_000

interface AutoBackupState {
  config: AutoBackupConfig
  status: Partial<Record<TargetId, TargetStatus>>
  running: boolean
  loaded: boolean
}

export const useAutoBackup = create<AutoBackupState>(() => ({ config: DEFAULT_CONFIG, status: {}, running: false, loaded: false }))

export async function loadAutoBackup(): Promise<void> {
  const saved = await kvGet<Partial<AutoBackupConfig>>(CONFIG_KEY, {})
  const config = { ...DEFAULT_CONFIG, ...saved, targets: { ...DEFAULT_CONFIG.targets, ...saved.targets } }
  useAutoBackup.setState({ config, status: await kvGet(STATUS_KEY, {}), loaded: true })
}

export async function saveConfig(changes: Partial<AutoBackupConfig>): Promise<void> {
  const config = { ...useAutoBackup.getState().config, ...changes }
  useAutoBackup.setState({ config })
  await kvSet(CONFIG_KEY, config)
}

export const setPassphrase = (p: string) => kvSet(PASS_KEY, p)
export const hasPassphrase = async () => !!(await kvGet<string>(PASS_KEY, ''))

async function setStatus(t: TargetId, s: TargetStatus): Promise<void> {
  const status = { ...useAutoBackup.getState().status, [t]: s }
  useAutoBackup.setState({ status })
  await kvSet(STATUS_KEY, status)
}

/** Forgets a destination's last result (e.g. after disconnecting it). */
export async function clearStatus(t: TargetId): Promise<void> {
  const { [t]: _, ...status } = useAutoBackup.getState().status
  useAutoBackup.setState({ status })
  await kvSet(STATUS_KEY, status)
}

/** Destinations whose next scheduled backup is due (pure; unit tested). */
export function dueTargets(config: AutoBackupConfig, status: AutoBackupState['status'], now: number, reason: 'schedule' | 'shiftClose' | 'manual'): TargetId[] {
  const enabled = ALL_TARGETS.filter((t) => config.targets[t])
  if (reason === 'manual') return enabled
  if (reason === 'shiftClose') return config.onShiftClose ? enabled : []
  if (!config.intervalHours) return []
  return enabled.filter((t) => now - (status[t]?.lastSuccess ?? 0) >= config.intervalHours * 3_600_000)
}

/** Which of `files` (newest first) to delete to keep only `keep` copies. */
export const toPrune = <T,>(newestFirst: T[], keep: number) => newestFirst.slice(Math.max(1, keep))

async function send(t: TargetId, name: string, blob: Blob, records: number, encrypted: boolean, cfg: AutoBackupConfig): Promise<void> {
  if (t === 'device') {
    await localDb.snapshots.add({ id: uuid(), createdAt: Date.now(), filename: name, size: blob.size, records, encrypted, blob })
    const old = toPrune(await localDb.snapshots.orderBy('createdAt').reverse().toArray(), cfg.keepOnDevice)
    await localDb.snapshots.bulkDelete(old.map((s) => s.id))
    return
  }
  if (t === 'folder') {
    await writeToFolder(name, blob)
    for (const f of toPrune(await listFolder(), cfg.keep)) await removeFromFolder(f.id)
    return
  }
  const api = CLOUD[t]
  await api.upload(name, blob)
  for (const f of toPrune(await api.list(), cfg.keep)) await api.remove(f.id)
}

let running = false

/**
 * Makes one backup and sends it to every destination that's due (or all enabled ones for
 * manual/shift-close runs). Returns the destinations that failed.
 */
export async function runAutoBackup(reason: 'schedule' | 'shiftClose' | 'manual', only?: TargetId[]): Promise<TargetId[]> {
  if (running) return []
  if (!useAutoBackup.getState().loaded) await loadAutoBackup()
  const { config, status } = useAutoBackup.getState()
  let targets = only ?? dueTargets(config, status, Date.now(), reason)
  // Cloud destinations wait until the device is online (and need to be set up for this build).
  targets = targets.filter((t) => !CLOUD_TARGETS.includes(t as CloudProvider) || (navigator.onLine && isConfigured(t as CloudProvider) && cloudSupported()))
  if (!targets.length) return []
  // Nothing to protect before the shop has been set up.
  if (!(await db.users.count())) return []
  running = true
  useAutoBackup.setState({ running: true })
  const failed: TargetId[] = []
  try {
    const built = await buildBackup()
    let { blob, filename } = built
    const passphrase = config.encrypt ? await kvGet<string>(PASS_KEY, '') : ''
    if (passphrase) {
      blob = await encryptBlob(blob, passphrase)
      filename = filename.replace(/\.json$/, '.openpos')
    }
    let offDevice = false
    for (const t of targets) {
      const attempt = Date.now()
      try {
        await send(t, filename, blob, built.records, !!passphrase, config)
        await setStatus(t, { lastSuccess: attempt, lastAttempt: attempt, lastFile: filename })
        if (t !== 'device') offDevice = true
      } catch (e) {
        failed.push(t)
        const prev = useAutoBackup.getState().status[t]
        await setStatus(t, {
          ...prev,
          lastAttempt: attempt,
          error: e instanceof Error ? e.message : String(e),
          needs: e instanceof NeedsReconnect ? 'reconnect' : e instanceof FolderPermission ? 'permission' : undefined,
        })
      }
    }
    // A copy that survives losing this device counts as "backed up" for the reminder.
    if (offDevice) await setMeta('lastBackup', built.exportedAt)
    void audit('backup.auto', 'backup', undefined, `${reason}: ${targets.filter((t) => !failed.includes(t)).join(', ') || '—'}`)
  } finally {
    running = false
    useAutoBackup.setState({ running: false })
  }
  return failed
}

let started = false

/** Starts the schedule: a first check shortly after launch, then every 10 minutes and when back online. */
export function startAutoBackup(): void {
  if (started || typeof window === 'undefined') return
  started = true
  const tick = () => void runAutoBackup('schedule').catch((e) => console.warn('Automatic backup failed', e))
  void loadAutoBackup().then(() => setTimeout(tick, 45_000))
  setInterval(tick, CHECK_EVERY_MS)
  window.addEventListener('online', tick)
}
