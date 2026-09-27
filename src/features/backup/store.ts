import Dexie, { type EntityTable } from 'dexie'

// Device-local storage for automatic backups. Deliberately a separate database from the
// till's data: snapshots must not end up inside the backups they protect, cloud tokens and
// folder handles must never sync to other terminals, and "Erase device" removes it too.

export interface Snapshot {
  id: string
  createdAt: number
  filename: string
  size: number
  records: number
  encrypted: boolean
  blob: Blob
}

export interface KV {
  key: string
  value: unknown
}

class LocalBackupDB extends Dexie {
  snapshots!: EntityTable<Snapshot, 'id'>
  kv!: EntityTable<KV, 'key'>
  constructor() {
    super('kasa-pos-local')
    this.version(1).stores({ snapshots: 'id, createdAt', kv: 'key' })
  }
}

export const localDb = new LocalBackupDB()

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const row = await localDb.kv.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await localDb.kv.put({ key, value })
}

export async function kvDelete(key: string): Promise<void> {
  await localDb.kv.delete(key)
}
