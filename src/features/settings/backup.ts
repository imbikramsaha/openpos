import type { Table } from 'dexie'
import { db } from '@/db/db'
import { SETTINGS_ID } from '@/db/defaults'
import { audit, rebuildStock, setMeta } from '@/db/repo'
import { recomputeAllCustomers } from '@/db/customers'
import { downloadText } from '@/lib/download'

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
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of backupTables()) out[t.name] = await t.count()
  return out
}

export async function exportBackup(): Promise<{ filename: string; records: number }> {
  const exportedAt = Date.now()
  const tables: Record<string, unknown[]> = {}
  await db.transaction('r', backupTables(), async () => {
    for (const t of backupTables()) tables[t.name] = await t.toArray()
  })
  const file: BackupFile = { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt, tables }
  const filename = `kasa-backup-${stamp(exportedAt)}.json`
  downloadText(filename, JSON.stringify(file), 'application/json')
  await setMeta('lastBackup', exportedAt)
  const records = Object.values(tables).reduce((s, rows) => s + rows.length, 0)
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
    for (const r of rows) {
      if (!r || typeof r !== 'object' || (keyName && (r as Record<string, unknown>)[keyName] == null)) throw new InvalidBackup('badTables', name)
    }
    counts[name] = rows.length
  }
  const users = (f.tables.users ?? []) as Array<{ deleted?: boolean }>
  if (!users.some((u) => !u.deleted)) throw new InvalidBackup('noUsers')
  const settings = ((f.tables.settings ?? []) as Array<{ id?: string; businessName?: string }>).find((s) => s.id === SETTINGS_ID)
  return { file: f as BackupFile, exportedAt: Number(f.exportedAt) || 0, businessName: settings?.businessName, counts, unknownTables }
}

/** Replaces ALL local data with the backup, rebuilds derived values and reloads the app. */
export async function restoreBackup(file: BackupFile): Promise<void> {
  const tables = db.tables
  await db.transaction('rw', tables, async () => {
    for (const t of tables) {
      await t.clear()
      const rows = EXCLUDED.has(t.name) ? undefined : file.tables[t.name]
      if (rows?.length) await t.bulkPut(rows)
    }
  })
  await rebuildStock()
  await recomputeAllCustomers()
  await audit('backup.restore', 'backup', undefined, new Date(file.exportedAt || Date.now()).toISOString())
  location.reload()
}

export async function eraseDevice(): Promise<void> {
  await db.delete()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('kasa.')) localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
  location.reload()
}
