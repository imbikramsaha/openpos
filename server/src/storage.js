import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DERIVED_FIELDS } from './tables.js'

// SQLite persistence for stores and replicated records.
//
// Every store has its own monotonic `last_seq` counter. Each accepted change gets the
// next number, so a terminal can ask for "everything after seq N" and never miss or
// double-apply a change. Records use last-write-wins on the client-supplied `updatedAt`.

function loadSqlite() {
  let mod
  try {
    mod = process.getBuiltinModule?.('node:sqlite')
  } catch {
    mod = undefined
  }
  if (!mod?.DatabaseSync) {
    throw new Error(
      'The Kasa sync server needs the built-in node:sqlite module: use Node.js 22.13 or newer ' +
        '(Node 22.5–22.12 works when started with --experimental-sqlite).',
    )
  }
  return mod
}

const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seq   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS records (
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  tbl        TEXT NOT NULL,
  id         TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  device_id  TEXT,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT NOT NULL,
  PRIMARY KEY (store_id, tbl, id)
);
CREATE INDEX IF NOT EXISTS records_by_seq ON records (store_id, seq);
CREATE TABLE IF NOT EXISTS devices (
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (store_id, device_id)
);
`

/** Random 32-byte store key, base64url encoded (43 characters). */
export function generateStoreKey() {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex')
}

function cleanName(name) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!n) throw new Error('Store name is required')
  if (n.length > 120) throw new Error('Store name is too long (max 120 characters)')
  return n
}

/**
 * Opens (and creates or migrates) the database in `dataDir`.
 * Pass `':memory:'` as `file` for a throwaway database.
 */
export function openStorage({ dataDir, file } = {}) {
  const { DatabaseSync } = loadSqlite()
  let location = file
  if (!location) {
    if (!dataDir) throw new Error('dataDir is required')
    fs.mkdirSync(dataDir, { recursive: true })
    location = path.join(dataDir, 'kasa.sqlite')
  }
  const db = new DatabaseSync(location)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA foreign_keys = ON')
  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version > SCHEMA_VERSION) {
    db.close()
    throw new Error(`Database schema v${version} is newer than this server supports (v${SCHEMA_VERSION}). Update the server.`)
  }
  db.exec(SCHEMA)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)

  const q = {
    insertStore: db.prepare('INSERT INTO stores (id, name, key_hash, created_at) VALUES (?, ?, ?, ?)'),
    storeByHash: db.prepare('SELECT id, name, created_at, last_seq FROM stores WHERE key_hash = ?'),
    storeById: db.prepare('SELECT id, name, created_at, last_seq FROM stores WHERE id = ?'),
    setKey: db.prepare('UPDATE stores SET key_hash = ? WHERE id = ?'),
    lastSeq: db.prepare('SELECT last_seq FROM stores WHERE id = ?'),
    setSeq: db.prepare('UPDATE stores SET last_seq = ? WHERE id = ?'),
    listStores: db.prepare(`
      SELECT s.id, s.name, s.created_at, s.last_seq,
        (SELECT count(*) FROM records r WHERE r.store_id = s.id) AS records,
        (SELECT count(*) FROM devices d WHERE d.store_id = s.id) AS devices,
        (SELECT max(last_seen) FROM devices d WHERE d.store_id = s.id) AS last_seen
      FROM stores s ORDER BY s.created_at, s.name`),
    upsert: db.prepare(`
      INSERT INTO records (store_id, tbl, id, updated_at, seq, device_id, deleted, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (store_id, tbl, id) DO UPDATE SET
        updated_at = excluded.updated_at,
        seq        = excluded.seq,
        device_id  = excluded.device_id,
        deleted    = excluded.deleted,
        data       = excluded.data
      WHERE excluded.updated_at > records.updated_at`),
    pull: db.prepare(`
      SELECT tbl, id, updated_at, seq, deleted, data FROM records
      WHERE store_id = ? AND seq > ? ORDER BY seq LIMIT ?`),
    touchDevice: db.prepare(`
      INSERT INTO devices (store_id, device_id, first_seen, last_seen) VALUES (?, ?, ?, ?)
      ON CONFLICT (store_id, device_id) DO UPDATE SET last_seen = excluded.last_seen`),
  }

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (e) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw e
    }
  }

  let closed = false
  const toStore = (row) => (row ? { id: row.id, name: row.name, createdAt: row.created_at, lastSeq: row.last_seq } : null)

  return {
    /** Creates a store; the returned key is not stored and cannot be recovered. */
    createStore(name) {
      const store = { id: crypto.randomUUID(), name: cleanName(name), createdAt: Date.now() }
      const key = generateStoreKey()
      q.insertStore.run(store.id, store.name, hashKey(key), store.createdAt)
      return { ...store, key }
    },

    /** Replaces a store's key (e.g. after a till is lost). Returns the new key or null. */
    rotateKey(storeId) {
      const row = q.storeById.get(String(storeId))
      if (!row) return null
      const key = generateStoreKey()
      q.setKey.run(hashKey(key), row.id)
      return { id: row.id, name: row.name, createdAt: row.created_at, key }
    },

    listStores() {
      return q.listStores.all().map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        lastSeq: r.last_seq,
        records: r.records,
        devices: r.devices,
        lastSeen: r.last_seen ?? null,
      }))
    },

    storeByKey(key) {
      if (!key) return null
      return toStore(q.storeByHash.get(hashKey(key)))
    },

    storeById(id) {
      return toStore(q.storeById.get(String(id)))
    },

    touchDevice(storeId, deviceId, now = Date.now()) {
      if (!deviceId) return
      q.touchDevice.run(storeId, deviceId, now, now)
    },

    /**
     * Applies validated changes with last-write-wins. A change replaces the stored
     * record only when its `updatedAt` is strictly newer; ties keep the stored copy so
     * every terminal converges on the same version.
     */
    push(storeId, deviceId, changes) {
      return transaction(() => {
        let seq = q.lastSeq.get(storeId)?.last_seq
        if (seq === undefined) throw new Error('Unknown store')
        let accepted = 0
        let stale = 0
        for (const c of changes) {
          const data = { ...c.data, id: c.id, updatedAt: c.updatedAt }
          if (c.deleted) data.deleted = true
          for (const f of DERIVED_FIELDS[c.table] ?? []) delete data[f]
          const next = seq + 1
          const res = q.upsert.run(storeId, c.table, c.id, c.updatedAt, next, deviceId || null, data.deleted ? 1 : 0, JSON.stringify(data))
          if (res.changes > 0) {
            seq = next
            accepted++
          } else {
            stale++
          }
        }
        if (accepted) q.setSeq.run(seq, storeId)
        if (deviceId) q.touchDevice.run(storeId, deviceId, Date.now(), Date.now())
        return { accepted, stale, latestSeq: seq }
      })
    },

    /** Changes after `since`, oldest first. `data` stays a JSON string to avoid re-parsing. */
    pull(storeId, since, limit) {
      const rows = q.pull.all(storeId, since, limit + 1)
      const hasMore = rows.length > limit
      if (hasMore) rows.length = limit
      const latestSeq = q.lastSeq.get(storeId)?.last_seq ?? 0
      return {
        rows: rows.map((r) => ({ table: r.tbl, id: r.id, updatedAt: r.updated_at, seq: r.seq, deleted: r.deleted === 1, data: r.data })),
        hasMore,
        latestSeq,
      }
    },

    close() {
      if (closed) return
      closed = true
      db.close()
    },

    /** Underlying DatabaseSync, for maintenance scripts. */
    db,
  }
}
