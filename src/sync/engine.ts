import { liveQuery } from 'dexie'
import { db } from '@/db/db'
import { useDevice } from '@/stores/device'
import { useSyncStatus } from './status'
import { describeError, fetchStore, normalizeUrl, type Remote } from './api'
import { joinStoreInto, syncOnce } from './replicate'

// Sync scheduler for this terminal. A cycle (push outbox, then pull) runs:
//   - right away when sync starts, then every 20 s,
//   - ~1.5 s after local writes (watching the outbox),
//   - when the device comes back online or the app becomes visible again,
//   - on demand via syncNow().
// Failures back off exponentially (capped at 5 min). Cycles never overlap, and joinStore
// shares the same queue. After changing sync settings call startSync() (it restarts
// cleanly) or stopSync().

export interface ConnectionResult {
  ok: boolean
  storeName?: string
  error?: string
}

const SYNC_INTERVAL_MS = 20_000
const WRITE_DEBOUNCE_MS = 1_500
const BACKOFF_BASE_MS = 10_000
const BACKOFF_MAX_MS = 5 * 60_000
const VISIBLE_MIN_GAP_MS = 3_000

interface Session {
  remote: Remote
  abort: AbortController
  stopped: boolean
  failures: number
  lastRun: number
  timer?: ReturnType<typeof setTimeout>
  debounce?: ReturnType<typeof setTimeout>
  running?: Promise<void>
  queued?: Promise<void>
  cleanup: Array<() => void>
}

let session: Session | null = null

/** Serialises all replication work (cycles of any session, and joins). */
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn)
  queue = run.catch(() => undefined)
  return run
}

const status = () => useSyncStatus.getState()

function deviceConfig() {
  const d = useDevice.getState()
  return {
    enabled: !!d.syncEnabled,
    url: normalizeUrl(d.serverUrl),
    key: (d.storeKey ?? '').trim(),
    deviceId: d.deviceId,
  }
}

const isConfigured = (c: ReturnType<typeof deviceConfig>) => c.enabled && !!c.url && !!c.key
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function backoffDelay(failures: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))
  const jitter = base * 0.2 * (Math.random() * 2 - 1)
  return Math.round(Math.min(BACKOFF_MAX_MS, Math.max(1_000, base + jitter)))
}

function refreshPending(): void {
  db.outbox
    .count()
    .then((pending) => status().set({ pending }))
    .catch(() => undefined)
}

function schedule(s: Session, ms: number): void {
  if (s.stopped) return
  clearTimeout(s.timer)
  s.timer = setTimeout(() => void requestCycle(s), ms)
}

/** Runs a cycle now, or once more right after the one in flight (requests coalesce). */
function requestCycle(s: Session): Promise<void> {
  if (s.stopped) return Promise.resolve()
  if (!s.running) {
    s.running = runCycle(s).finally(() => {
      s.running = undefined
    })
    return s.running
  }
  if (!s.queued) {
    s.queued = s.running.then(() => {
      s.queued = undefined
      return requestCycle(s)
    })
  }
  return s.queued
}

async function runCycle(s: Session): Promise<void> {
  clearTimeout(s.timer)
  clearTimeout(s.debounce)
  if (s.stopped) return

  // Settings changed without a restart: follow them.
  const c = deviceConfig()
  if (!isConfigured(c)) {
    stopSync()
    return
  }
  if (c.url !== s.remote.url || c.key !== s.remote.key) {
    void startSync()
    return
  }

  if (isOffline()) {
    status().set({ state: 'offline' })
    schedule(s, SYNC_INTERVAL_MS)
    return
  }

  status().set({ state: 'syncing' })
  try {
    await exclusive(async () => {
      if (!s.stopped) await syncOnce(db, s.remote)
    })
    if (s.stopped) return
    s.failures = 0
    s.lastRun = Date.now()
    status().set({ state: 'idle', lastSync: Date.now(), error: undefined })
    schedule(s, SYNC_INTERVAL_MS)
  } catch (e) {
    if (s.stopped) return
    s.failures++
    s.lastRun = Date.now()
    status().set({ state: isOffline() ? 'offline' : 'error', error: describeError(e) })
    schedule(s, backoffDelay(s.failures))
  }
}

function teardown(): void {
  const s = session
  if (!s) return
  session = null
  s.stopped = true
  clearTimeout(s.timer)
  clearTimeout(s.debounce)
  for (const fn of s.cleanup) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
  s.abort.abort()
}

/**
 * Starts (or restarts) background sync using this terminal's settings. Resolves after the
 * first cycle has finished; never rejects (errors are reported through useSyncStatus).
 */
export async function startSync(): Promise<void> {
  teardown()
  refreshPending()
  const c = deviceConfig()
  if (!isConfigured(c)) {
    status().set({ state: 'disabled', error: undefined })
    return
  }

  const abort = new AbortController()
  const s: Session = {
    remote: { url: c.url, key: c.key, deviceId: c.deviceId, signal: abort.signal },
    abort,
    stopped: false,
    failures: 0,
    lastRun: 0,
    cleanup: [],
  }
  session = s

  // Pending count for the indicator, and a debounced push after local writes.
  let last = -1
  const sub = liveQuery(() => db.outbox.count()).subscribe({
    next: (n) => {
      if (s.stopped) return
      status().set({ pending: n })
      if (last >= 0 && n > last && s.failures === 0) {
        clearTimeout(s.debounce)
        s.debounce = setTimeout(() => void requestCycle(s), WRITE_DEBOUNCE_MS)
      }
      last = n
    },
    error: () => undefined,
  })
  s.cleanup.push(() => sub.unsubscribe())

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const onOnline = () => {
      s.failures = 0
      void requestCycle(s)
    }
    window.addEventListener('online', onOnline)
    s.cleanup.push(() => window.removeEventListener('online', onOnline))
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - s.lastRun > VISIBLE_MIN_GAP_MS) void requestCycle(s)
    }
    document.addEventListener('visibilitychange', onVisibility)
    s.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibility))
  }

  await requestCycle(s)
}

/** Stops background sync and cancels any request in flight. */
export function stopSync(): void {
  teardown()
  status().set({ state: 'disabled', error: undefined })
  refreshPending()
}

/** Syncs immediately (e.g. the sync indicator was tapped). Resolves when that cycle is done. */
export async function syncNow(): Promise<void> {
  const c = deviceConfig()
  const s = session
  if (!isConfigured(c)) {
    if (s) stopSync()
    return
  }
  if (!s || s.stopped || s.remote.url !== c.url || s.remote.key !== c.key) return startSync()
  s.failures = 0
  return requestCycle(s)
}

/** Checks a server address + store key. Never throws. */
export async function testConnection(url: string, key: string): Promise<ConnectionResult> {
  const base = normalizeUrl(url)
  const storeKey = (key ?? '').trim()
  if (!base) return { ok: false, error: 'Enter the server address, e.g. http://192.168.1.10:8787' }
  if (!storeKey) return { ok: false, error: 'Enter the store key' }
  try {
    const store = await fetchStore({ url: base, key: storeKey, deviceId: useDevice.getState().deviceId })
    return { ok: true, storeName: store.name }
  } catch (e) {
    return { ok: false, error: describeError(e) }
  }
}

/**
 * Downloads an existing store into this (new) terminal: full pull, then stock and customer
 * balances are rebuilt from the ledgers. Starts background sync afterwards when this
 * terminal's settings have sync enabled. Throws with a user-facing message on failure.
 */
export async function joinStore(url: string, key: string): Promise<void> {
  const remote: Remote = { url: normalizeUrl(url), key: (key ?? '').trim(), deviceId: useDevice.getState().deviceId }
  teardown()
  status().set({ state: 'syncing', error: undefined })
  let failed = false
  try {
    await exclusive(() => joinStoreInto(db, remote))
    status().set({ state: 'idle', lastSync: Date.now(), error: undefined })
  } catch (e) {
    failed = true
    status().set({ state: 'error', error: describeError(e) })
    throw e
  } finally {
    // Keep going in the background (a failed join resumes from the saved cursor).
    if (isConfigured(deviceConfig())) void startSync()
    else if (!failed) status().set({ state: 'disabled' })
  }
}
