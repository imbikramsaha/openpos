import zlib from 'node:zlib'
import { promisify } from 'node:util'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)
const inflate = promisify(zlib.inflate)
const brotliDecompress = promisify(zlib.brotliDecompress)

/** An error that maps to an HTTP status and a JSON body `{ error }`. */
export class HttpError extends Error {
  constructor(status, message, headers) {
    super(message)
    this.status = status
    this.headers = headers
  }
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Encoding, Accept, X-Device-Id',
  'Access-Control-Max-Age': '86400',
}

/** Sets CORS headers. Store keys travel in the Authorization header (no cookies), so `*` is safe. */
export function applyCors(req, res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v)
  // Chrome's Private Network Access: lets an https:// app reach a LAN server (e.g. 192.168.x.x).
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

export function acceptsGzip(req) {
  const ae = String(req.headers['accept-encoding'] ?? '')
  return /\bgzip\b/i.test(ae) && !/\bgzip\s*;\s*q=0(\.0+)?\b/i.test(ae)
}

/**
 * Sends a JSON response. `body` may be a pre-serialised JSON string.
 * Bodies over 1 KB are gzip-compressed when the client accepts it.
 */
export async function sendJson(req, res, status, body, headers = {}) {
  let payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Vary', 'Accept-Encoding')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  if (payload.length > 1024 && acceptsGzip(req)) {
    payload = await gzip(payload, { level: 6 })
    res.setHeader('Content-Encoding', 'gzip')
  }
  res.setHeader('Content-Length', payload.length)
  res.end(req.method === 'HEAD' ? undefined : payload)
}

export function sendError(req, res, status, message, headers = {}) {
  if (res.headersSent) {
    res.destroy()
    return Promise.resolve()
  }
  return sendJson(req, res, status, { error: message }, headers)
}

/**
 * Reads and parses a JSON request body, enforcing `limit` bytes both on the wire and
 * after decompression (Content-Encoding gzip, deflate or br are accepted).
 */
export function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      req.resume()
      reject(new HttpError(413, `Request body too large (limit ${Math.round(limit / 1048576)} MB)`, { Connection: 'close' }))
      return
    }
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      if (failed) return
      size += chunk.length
      if (size > limit) {
        failed = true
        chunks.length = 0
        reject(new HttpError(413, `Request body too large (limit ${Math.round(limit / 1048576)} MB)`, { Connection: 'close' }))
        return
      }
      chunks.push(chunk)
    })
    req.on('error', (e) => {
      if (!failed) reject(new HttpError(400, `Could not read request body: ${e.message}`))
      failed = true
    })
    req.on('end', async () => {
      if (failed) return
      try {
        let buf = Buffer.concat(chunks)
        const encoding = String(req.headers['content-encoding'] ?? 'identity').trim().toLowerCase()
        const opts = { maxOutputLength: limit }
        try {
          if (encoding === 'gzip' || encoding === 'x-gzip') buf = await gunzip(buf, opts)
          else if (encoding === 'deflate') buf = await inflate(buf, opts)
          else if (encoding === 'br') buf = await brotliDecompress(buf, opts)
          else if (encoding !== 'identity' && encoding !== '') throw new HttpError(415, `Unsupported Content-Encoding: ${encoding}`)
        } catch (e) {
          if (e instanceof HttpError) throw e
          if (e?.code === 'ERR_BUFFER_TOO_LARGE' || /Cannot create a Buffer larger|maxOutputLength/i.test(String(e?.message))) {
            throw new HttpError(413, 'Request body too large after decompression')
          }
          throw new HttpError(400, 'Request body could not be decompressed')
        }
        if (!buf.length) throw new HttpError(400, 'Request body is empty')
        try {
          resolve(JSON.parse(buf.toString('utf8')))
        } catch {
          throw new HttpError(400, 'Request body is not valid JSON')
        }
      } catch (e) {
        reject(e)
      }
    })
  })
}

/** Returns the bearer token from the Authorization header, or ''. */
export function bearer(req) {
  const h = String(req.headers.authorization ?? '')
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : ''
}

/** Client address for logs (honours X-Forwarded-For only when trustProxy is set). */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    if (fwd) return fwd
  }
  return req.socket?.remoteAddress ?? '-'
}
