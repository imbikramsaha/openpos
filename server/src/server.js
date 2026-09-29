import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import {
  DEFAULT_DATA_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_PULL_LIMIT,
  DEFAULT_STATIC_DIR,
  MAX_BODY_BYTES,
  MAX_PULL_LIMIT,
  MAX_PUSH_BATCH,
  SERVER_ROOT,
} from './config.js'
import { HttpError, applyCors, bearer, clientIp, readJson, sendError, sendJson } from './http.js'
import { createStaticHandler } from './static.js'
import { openStorage } from './storage.js'
import { TABLES } from './tables.js'

export const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest()
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b))

const MAX_ID = 128

function validatePush(body, maxBatch) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object')
  const { deviceId, changes } = body
  if (deviceId != null && (typeof deviceId !== 'string' || deviceId.length > MAX_ID)) {
    throw new HttpError(400, '`deviceId` must be a string of at most 128 characters')
  }
  if (!Array.isArray(changes)) throw new HttpError(400, '`changes` must be an array')
  if (changes.length > maxBatch) throw new HttpError(413, `Too many changes in one push (max ${maxBatch})`)
  const out = new Array(changes.length)
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i]
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new HttpError(400, `changes[${i}] must be an object`)
    if (typeof c.table !== 'string' || !TABLES.has(c.table)) {
      throw new HttpError(400, `changes[${i}]: unknown table "${String(c.table).slice(0, 64)}"`)
    }
    if (typeof c.id !== 'string' || !c.id || c.id.length > MAX_ID) throw new HttpError(400, `changes[${i}]: \`id\` must be a non-empty string`)
    // Bounded so SQLite hands the value back as an exact JS number (larger integers
    // would make every later pull of this store fail).
    if (typeof c.updatedAt !== 'number' || !Number.isFinite(c.updatedAt) || c.updatedAt < 0 || c.updatedAt > Number.MAX_SAFE_INTEGER) {
      throw new HttpError(400, `changes[${i}]: \`updatedAt\` must be a timestamp in milliseconds`)
    }
    const data = c.data ?? {}
    if (typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, `changes[${i}]: \`data\` must be an object`)
    out[i] = { table: c.table, id: c.id, updatedAt: c.updatedAt, deleted: c.deleted === true || data.deleted === true, data }
  }
  return { deviceId: deviceId || null, changes: out }
}

function intParam(params, name, fallback, min, max) {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  if (!/^\d+$/.test(raw)) throw new HttpError(400, `\`${name}\` must be a non-negative integer`)
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) throw new HttpError(400, `\`${name}\` is out of range`)
  return Math.min(max, Math.max(min, n))
}

function defaultLogger(line) {
  console.log(line)
}

/**
 * Creates the sync + static server. Nothing listens until `listen()` is called.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir]     folder for kasa.sqlite (default server/data)
 * @param {object} [options.storage]     an already opened storage (from openStorage)
 * @param {string} [options.adminToken]  enables /api/admin/* when set
 * @param {string|null} [options.staticDir] built web app to serve (default ../dist), null to disable
 * @param {boolean|Function} [options.log] request logging: true (console), false, or a function
 * @param {boolean} [options.trustProxy] use X-Forwarded-For for client addresses in logs
 * @param {number} [options.port] @param {string} [options.host]
 * @param {number} [options.maxBodyBytes] @param {number} [options.maxBatch]
 */
export function createServer(options = {}) {
  const opts = {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    dataDir: DEFAULT_DATA_DIR,
    adminToken: '',
    staticDir: DEFAULT_STATIC_DIR,
    log: true,
    trustProxy: false,
    maxBodyBytes: MAX_BODY_BYTES,
    maxBatch: MAX_PUSH_BATCH,
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  }
  const storage = opts.storage ?? openStorage({ dataDir: opts.dataDir })
  const ownsStorage = !opts.storage
  const serveStatic = createStaticHandler(opts.staticDir)
  const log = opts.log === true ? defaultLogger : typeof opts.log === 'function' ? opts.log : null

  function requireStore(req) {
    const key = bearer(req)
    const challenge = { 'WWW-Authenticate': 'Bearer realm="kasa-store"' }
    if (!key) throw new HttpError(401, 'Missing store key (send "Authorization: Bearer <store key>")', challenge)
    const store = storage.storeByKey(key)
    if (!store) throw new HttpError(401, 'Invalid store key', challenge)
    return store
  }

  function requireAdmin(req) {
    if (!opts.adminToken) throw new HttpError(403, 'The admin API is disabled. Start the server with ADMIN_TOKEN set to enable it.')
    const token = bearer(req)
    if (!token || !safeEqual(token, opts.adminToken)) {
      throw new HttpError(401, 'Invalid admin token', { 'WWW-Authenticate': 'Bearer realm="kasa-admin"' })
    }
  }

  const deviceHeader = (req) => {
    const d = String(req.headers['x-device-id'] ?? '').trim()
    return d && d.length <= MAX_ID ? d : ''
  }

  // ---- Route handlers ------------------------------------------------------

  const handlers = {
    health: (req, res) => sendJson(req, res, 200, { ok: true, service: 'openpos-sync', version: VERSION, time: Date.now() }),

    store: (req, res) => {
      const store = requireStore(req)
      storage.touchDevice(store.id, deviceHeader(req))
      return sendJson(req, res, 200, { id: store.id, name: store.name })
    },

    push: async (req, res) => {
      const store = requireStore(req)
      const body = await readJson(req, opts.maxBodyBytes)
      const { deviceId, changes } = validatePush(body, opts.maxBatch)
      const result = storage.push(store.id, deviceId || deviceHeader(req), changes)
      return sendJson(req, res, 200, { accepted: result.accepted, stale: result.stale, serverTime: Date.now(), latestSeq: result.latestSeq })
    },

    pull: (req, res, url) => {
      const store = requireStore(req)
      const since = intParam(url.searchParams, 'since', 0, 0, Number.MAX_SAFE_INTEGER)
      const limit = intParam(url.searchParams, 'limit', DEFAULT_PULL_LIMIT, 1, MAX_PULL_LIMIT)
      storage.touchDevice(store.id, deviceHeader(req))
      const page = storage.pull(store.id, since, limit)
      const cursor = page.rows.length ? page.rows[page.rows.length - 1].seq : since
      // `data` is stored as JSON text; splice it in rather than parse + re-serialise.
      const items = page.rows.map(
        (r) =>
          `{"table":${JSON.stringify(r.table)},"id":${JSON.stringify(r.id)},"updatedAt":${JSON.stringify(r.updatedAt)},` +
          `"seq":${r.seq},"deleted":${r.deleted},"data":${r.data}}`,
      )
      const json =
        `{"changes":[${items.join(',')}],"cursor":${cursor},"hasMore":${page.hasMore},` +
        `"latestSeq":${page.latestSeq},"storeId":${JSON.stringify(store.id)},"serverTime":${Date.now()}}`
      return sendJson(req, res, 200, json)
    },

    listStores: (req, res) => {
      requireAdmin(req)
      return sendJson(req, res, 200, { stores: storage.listStores() })
    },

    createStore: async (req, res) => {
      requireAdmin(req)
      const body = await readJson(req, 64 * 1024)
      const name = typeof body?.name === 'string' ? body.name : ''
      let store
      try {
        store = storage.createStore(name)
      } catch (e) {
        throw new HttpError(400, e.message)
      }
      return sendJson(req, res, 201, { id: store.id, name: store.name, key: store.key, createdAt: store.createdAt })
    },

    rotateKey: (req, res, _url, params) => {
      requireAdmin(req)
      const store = storage.rotateKey(params.id)
      if (!store) throw new HttpError(404, 'Store not found')
      return sendJson(req, res, 200, { id: store.id, name: store.name, key: store.key })
    },
  }

  /** [method, pattern, handler]; `:id` segments become params. */
  const routes = [
    ['GET', '/api/health', handlers.health],
    ['GET', '/api/store', handlers.store],
    ['POST', '/api/sync/push', handlers.push],
    ['GET', '/api/sync/pull', handlers.pull],
    ['GET', '/api/admin/stores', handlers.listStores],
    ['POST', '/api/admin/stores', handlers.createStore],
    ['POST', '/api/admin/stores/:id/rotate-key', handlers.rotateKey],
  ].map(([method, pattern, handler]) => {
    const names = []
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '/?$')
    return { method, re, names, handler }
  })

  function match(pathname, method) {
    const allowed = []
    for (const r of routes) {
      const m = r.re.exec(pathname)
      if (!m) continue
      const effective = method === 'HEAD' ? 'GET' : method
      if (r.method === effective) {
        let params
        try {
          params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]))
        } catch {
          throw new HttpError(400, 'Malformed URL')
        }
        return { route: r, params }
      }
      allowed.push(r.method)
    }
    return { allowed }
  }

  // ---- Request pipeline ----------------------------------------------------

  async function handle(req, res) {
    const started = process.hrtime.bigint()
    let pathname = '/'
    if (log) {
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        log(`${new Date().toISOString()} ${clientIp(req, opts.trustProxy)} ${req.method} ${pathname} ${res.statusCode} ${ms.toFixed(1)}ms`)
      })
    }
    try {
      let url
      try {
        const raw = req.url ?? '/'
        url = new URL('http://localhost' + (raw.startsWith('/') ? raw : '/' + raw))
      } catch {
        throw new HttpError(400, 'Malformed URL')
      }
      pathname = url.pathname

      if (pathname === '/api' || pathname.startsWith('/api/')) {
        applyCors(req, res)
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Content-Length', '0')
          res.end()
          return
        }
        const found = match(pathname, req.method)
        if (!found.route) {
          if (found.allowed?.length) {
            throw new HttpError(405, `Method ${req.method} not allowed`, { Allow: [...new Set([...found.allowed, 'OPTIONS'])].join(', ') })
          }
          throw new HttpError(404, `No API route ${pathname}`)
        }
        await found.route.handler(req, res, url, found.params)
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, `Method ${req.method} not allowed`, { Allow: 'GET, HEAD' })
      }
      const served = await serveStatic(req, res, pathname)
      if (!served && !res.headersSent) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end('Not found')
      }
    } catch (e) {
      if (e instanceof HttpError) {
        await sendError(req, res, e.status, e.message, e.headers)
        return
      }
      // SQLITE_BUSY / SQLITE_LOCKED: another process holds the write lock for too long.
      if (e?.errcode === 5 || e?.errcode === 6) {
        await sendError(req, res, 503, 'Database is busy, please retry', { 'Retry-After': '2' })
        return
      }
      console.error(`[kasa-server] ${req.method} ${pathname} failed:`, e)
      await sendError(req, res, 500, 'Internal server error')
    }
  }

  const httpServer = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[kasa-server] unhandled', e)
      if (!res.headersSent) res.statusCode = 500
      res.end()
    })
  })
  // Slightly above common proxy/load-balancer idle timeouts to avoid 502s on reuse.
  httpServer.keepAliveTimeout = 65_000
  httpServer.headersTimeout = 66_000

  let closing = null

  return {
    httpServer,
    storage,
    version: VERSION,

    /** Starts listening. Resolves with the bound address and a base URL for local use. */
    listen(port = opts.port, host = opts.host) {
      return new Promise((resolve, reject) => {
        const onError = (e) => reject(e)
        httpServer.once('error', onError)
        httpServer.listen(port, host, () => {
          httpServer.off('error', onError)
          const addr = httpServer.address()
          const boundPort = typeof addr === 'object' && addr ? addr.port : port
          const local = host === '0.0.0.0' || host === '::' || !host ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host
          resolve({ port: boundPort, host, url: `http://${local}:${boundPort}` })
        })
      })
    },

    /** Stops accepting connections, lets in-flight requests finish (max 5 s) and closes the database. */
    close() {
      if (closing) return closing
      closing = new Promise((resolve) => {
        if (!httpServer.listening) {
          resolve(undefined)
          return
        }
        httpServer.close(() => resolve(undefined))
        httpServer.closeIdleConnections?.()
        const force = setTimeout(() => httpServer.closeAllConnections?.(), 5000)
        force.unref()
      }).then(() => {
        if (ownsStorage) storage.close()
      })
      return closing
    },

    createStore: (name) => storage.createStore(name),
    listStores: () => storage.listStores(),
  }
}
