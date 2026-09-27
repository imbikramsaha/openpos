import type { Table } from 'dexie'
import type { Settings } from '@/core/types'
import { db } from '@/db/db'
import { SETTINGS_ID, withDefaults } from '@/db/defaults'
import { audit, rebuildStock, setMeta } from '@/db/repo'
import { recomputeAllCustomers } from '@/db/customers'
import { downloadBlob } from '@/lib/download'
import { decryptBlob, isEncrypted } from '@/features/backup/crypto'
import { localDb } from '@/features/backup/store'

// Full-device backup: every local table except the sync outbox, as one JSON file.

export const BACKUP_APP = 'kasa-pos'
export const BACKUP_VERSION = 1

export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  exportedAt: number
  tables: Record<string, unknown[]>
}

const EXCLUDED = new Set(['outbox'])

const backupTables = (): Table[] => db.tables.filter((t) => !EXCLUDED.has(t.name))

function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of backupTables()) out[t.name] = await t.count()
  return out
}

export interface BuiltBackup {
  blob: Blob
  filename: string
  records: number
  exportedAt: number
}

/** Builds the backup file in memory (used by manual export and automatic backups). */
export async function buildBackup(): Promise<BuiltBackup> {
  const exportedAt = Date.now()
  const tables: Record<string, unknown[]> = {}
  await db.transaction('r', backupTables(), async () => {
    for (const t of backupTables()) tables[t.name] = await t.toArray()
  })
  const filename = `kasa-backup-${stamp(exportedAt)}.json`
  // Built as many small pieces rather than one JSON.stringify: years of sales can exceed the
  // browser's maximum string length, and the pieces avoid a second full copy in memory.
  const parts: string[] = [`{"app":${JSON.stringify(BACKUP_APP)},"version":${BACKUP_VERSION},"exportedAt":${exportedAt},"tables":{`]
  let n = 0
  for (const [name, rows] of Object.entries(tables)) {
    parts.push(`${n++ ? ',' : ''}${JSON.stringify(name)}:[`)
    for (let r = 0; r < rows.length; r += 500) {
      parts.push((r ? ',' : '') + rows.slice(r, r + 500).map((row) => JSON.stringify(row)).join(','))
      // Let the till keep responding (scans, clock, toasts) while a large backup is written.
      if (r % 5000 === 4500) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    parts.push(']')
  }
  parts.push('}}')
  const records = Object.values(tables).reduce((s, rows) => s + rows.length, 0)
  return { blob: new Blob(parts, { type: 'application/json;charset=utf-8' }), filename, records, exportedAt }
}

export async function exportBackup(): Promise<{ filename: string; records: number }> {
  const { blob, filename, records, exportedAt } = await buildBackup()
  downloadBlob(filename, blob)
  await setMeta('lastBackup', exportedAt)
  void audit('backup.export', 'backup', undefined, `${filename} (${records})`)
  return { filename, records }
}

export interface BackupSummary {
  file: BackupFile
  exportedAt: number
  businessName?: string
  counts: Record<string, number>
  unknownTables: string[]
}

export type BackupError = 'notJson' | 'notKasa' | 'newerVersion' | 'badTables' | 'noUsers'

const str = (v: unknown) => typeof v === 'string'
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/** Minimal shape checks for the records the app can't work without, so a damaged file can't brick the till. */
const ROW_CHECKS: Record<string, (r: Record<string, unknown>) => boolean> = {
  settings: (r) => str(r.businessName) && str(r.currency) && str(r.numberLocale),
  users: (r) => str(r.name) && ['admin', 'manager', 'cashier'].includes(r.role as string) && str(r.pinHash) && str(r.pinSalt),
  taxes: (r) => str(r.name) && num(r.rate),
  categories: (r) => str(r.name),
  products: (r) => str(r.name) && num(r.price),
  customers: (r) => str(r.name),
  sales: (r) => str(r.number) && Array.isArray(r.lines) && Array.isArray(r.payments) && num(r.total) && num(r.createdAt),
  stockMovements: (r) => str(r.productId) && num(r.qty),
}

export class InvalidBackup extends Error {
  constructor(public code: BackupError, public detail?: string) {
    super(code)
  }
}

/** Parses and validates a backup without touching the database. */
export function parseBackup(text: string): BackupSummary {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new InvalidBackup('notJson')
  }
  const f = raw as Partial<BackupFile>
  if (!f || typeof f !== 'object' || f.app !== BACKUP_APP || typeof f.tables !== 'object' || !f.tables) throw new InvalidBackup('notKasa')
  if (typeof f.version !== 'number' || f.version > BACKUP_VERSION) throw new InvalidBackup('newerVersion')
  const known = new Map(backupTables().map((t) => [t.name, t]))
  const counts: Record<string, number> = {}
  const unknownTables: string[] = []
  for (const [name, rows] of Object.entries(f.tables)) {
    const table = known.get(name)
    if (!table) {
      unknownTables.push(name)
      continue
    }
    if (!Array.isArray(rows)) throw new InvalidBackup('badTables', name)
    const key = table.schema.primKey.keyPath
    const keyName = typeof key === 'string' ? key : null
    const check = ROW_CHECKS[name]
    for (const r of rows) {
      if (!r || typeof r !== 'object' || Array.isArray(r) || (keyName && (r as Record<string, unknown>)[keyName] == null)) throw new InvalidBackup('badTables', name)
      if (check && !(r as { deleted?: boolean }).deleted && !check(r as Record<string, unknown>)) throw new InvalidBackup('badTables', name)
    }
    counts[name] = rows.length
  }
  // Somebody must be able to sign in afterwards: inactive users can't.
  const users = (f.tables.users ?? []) as Array<{ deleted?: boolean; active?: boolean }>
  if (!Array.isArray(users) || !users.some((u) => !u.deleted && u.active)) throw new InvalidBackup('noUsers')
  const settings = ((f.tables.settings ?? []) as Array<{ id?: string; businessName?: string }>).find((s) => s.id === SETTINGS_ID)
  return { file: f as BackupFile, exportedAt: Number(f.exportedAt) || 0, businessName: settings?.businessName, counts, unknownTables }
}

/** Replaces ALL local data with the backup, rebuilds derived values and reloads the app. */
export async function restoreBackup(file: BackupFile): Promise<void> {
  const tables = db.tables
  await db.transaction('rw', tables, async () => {
    for (const t of tables) {
      await t.clear()
      let rows = EXCLUDED.has(t.name) ? undefined : file.tables[t.name]
      // Backups from older versions may lack newer settings fields.
      if (t.name === 'settings' && rows) rows = rows.map((r) => ((r as { id?: string }).id === SETTINGS_ID ? withDefaults(r as Partial<Settings>) : r))
      if (rows?.length) await t.bulkPut(rows)
    }
    // The data now matches the file, so this device is backed up as of the file's date.
    const last = (await db.meta.get('lastBackup'))?.value as number | undefined
    if (file.exportedAt && !(last && last > file.exportedAt)) await db.meta.put({ key: 'lastBackup', value: file.exportedAt })
  })
  await rebuildStock()
  await recomputeAllCustomers()
  await audit('backup.restore', 'backup', undefined, new Date(file.exportedAt || Date.now()).toISOString())
  location.reload()
}

/**
 * Reads a backup file's JSON text, decrypting it first when it's an encrypted (.kasa)
 * backup. `askPassphrase` is called for encrypted files; returning null cancels.
 */
export async function readBackupText(file: Blob, askPassphrase: () => Promise<string | null>): Promise<string | null> {
  if (!(await isEncrypted(file))) return file.text()
  const passphrase = await askPassphrase()
  if (passphrase === null) return null
  return (await decryptBlob(file, passphrase)).text()
}

export async function eraseDevice(): Promise<void> {
  await db.delete()
  // Automatic-backup snapshots, cloud sign-ins and the backup folder live in their own database.
  await localDb.delete()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('kasa.')) localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
  location.reload()
}
