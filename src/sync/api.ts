// HTTP client for the Kasa sync server (see server/README.md for the protocol).

/** Where and how to reach a store on a sync server. */
export interface Remote {
  /** Base URL, e.g. http://192.168.1.10:8787 (normalised with normalizeUrl). */
  url: string
  /** Store key sent as `Authorization: Bearer <key>`. */
  key: string
  deviceId?: string
  /** Cancels in-flight requests (used by stopSync). */
  signal?: AbortSignal
  /** Custom fetch, for tests. */
  fetch?: typeof fetch
}

export type SyncErrorKind = 'network' | 'timeout' | 'auth' | 'server' | 'protocol' | 'aborted' | 'config'

export class SyncError extends Error {
  readonly kind: SyncErrorKind
  readonly status?: number
  constructor(kind: SyncErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    this.status = status
  }
}

export interface StoreInfo {
  id: string
  name: string
}

/** A record as it travels over the wire. */
export interface WireChange {
  table: string
  id: string
  updatedAt: number
  deleted?: boolean
  data: Record<string, unknown>
  seq?: number
}

export interface PushResponse {
  accepted: number
  stale: number
  serverTime: number
  latestSeq?: number
}

export interface PullResponse {
  changes: WireChange[]
  cursor: number
  hasMore: boolean
  latestSeq?: number
  storeId?: string
  serverTime?: number
}

export const STORE_TIMEOUT_MS = 8_000
export const SYNC_TIMEOUT_MS = 60_000

/**
 * Cleans up a user-typed server address: trims, adds http:// when no scheme is given,
 * drops trailing slashes and a trailing /api. Returns '' for empty input.
 */
export function normalizeUrl(input: string | undefined | null): string {
  let u = String(input ?? '').trim()
  if (!u) return ''
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(u)) u = 'http://' + u.replace(/^\/+/, '')
  u = u.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\/api$/i, '').replace(/\/+$/, '')
  return u
}

function isValidHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname
  } catch {
    return false
  }
}

function unreachableMessage(url: string): string {
  let msg = `Can't reach the sync server at ${url}. Check the address, that the server is running and that this device is on the same network.`
  const pageProtocol = typeof location !== 'undefined' ? location.protocol : ''
  if (pageProtocol === 'https:' && url.startsWith('http:')) {
    msg += ' This app is loaded over HTTPS, so the browser may block a plain http:// server — use an https:// address.'
  }
  return msg
}

/** Makes one API request and returns the parsed JSON body, or throws a SyncError. */
export async function request<T>(
  remote: Remote,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs = SYNC_TIMEOUT_MS,
): Promise<T> {
  const base = normalizeUrl(remote.url)
  if (!base || !isValidHttpUrl(base)) throw new SyncError('config', 'Enter a valid server address, e.g. http://192.168.1.10:8787')
  if (!remote.key) throw new SyncError('config', 'Enter the store key')

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const outer = remote.signal
  const onAbort = () => controller.abort()
  if (outer) {
    if (outer.aborted) controller.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${remote.key}`,
    Accept: 'application/json',
  }
  if (remote.deviceId) headers['X-Device-Id'] = remote.deviceId
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const doFetch = remote.fetch ?? globalThis.fetch
  let res: Response
  let text: string
  try {
    res = await doFetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    text = await res.text()
  } catch {
    if (outer?.aborted) throw new SyncError('aborted', 'Sync was stopped')
    if (timedOut) throw new SyncError('timeout', `The sync server at ${base} did not respond in time.`)
    throw new SyncError('network', unreachableMessage(base))
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }

  let json: unknown
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  const serverMessage = json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : ''

  if (!res.ok) {
    if (res.status === 401) throw new SyncError('auth', 'Invalid store key. Check the key shown when the store was created.', 401)
    if (res.status === 404 || res.status === 405) throw new SyncError('protocol', `${base} is not a Kasa sync server (or it is an old version).`, res.status)
    if (res.status === 413) throw new SyncError('server', serverMessage || 'The server rejected the request as too large.', 413)
    if (res.status >= 500) throw new SyncError('server', `Sync server error (${res.status})${serverMessage ? `: ${serverMessage}` : ''}`, res.status)
    throw new SyncError('server', serverMessage || `Sync request failed (${res.status})`, res.status)
  }
  if (json === undefined || json === null || typeof json !== 'object') {
    throw new SyncError('protocol', `${base} is not a Kasa sync server.`, res.status)
  }
  return json as T
}

/** GET /api/store — validates the key and returns the store's identity. */
export async function fetchStore(remote: Remote, timeoutMs = STORE_TIMEOUT_MS): Promise<StoreInfo> {
  const info = await request<Partial<StoreInfo>>(remote, 'GET', '/api/store', undefined, timeoutMs)
  if (typeof info.id !== 'string' || typeof info.name !== 'string') {
    throw new SyncError('protocol', `${normalizeUrl(remote.url)} is not a Kasa sync server.`)
  }
  return { id: info.id, name: info.name }
}

export function pushChanges(remote: Remote, changes: WireChange[]): Promise<PushResponse> {
  return request<PushResponse>(remote, 'POST', '/api/sync/push', { deviceId: remote.deviceId, changes })
}

export async function pullPage(remote: Remote, since: number, limit: number): Promise<PullResponse> {
  const res = await request<PullResponse>(remote, 'GET', `/api/sync/pull?since=${since}&limit=${limit}`)
  if (!Array.isArray(res.changes) || typeof res.cursor !== 'number' || typeof res.hasMore !== 'boolean') {
    throw new SyncError('protocol', 'Unexpected response from the sync server.')
  }
  return res
}

/** A short, user-facing description of any error thrown by the sync code. */
export function describeError(e: unknown): string {
  if (e instanceof SyncError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
