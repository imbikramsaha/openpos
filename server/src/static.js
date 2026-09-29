import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream'
import { acceptsGzip } from './http.js'

// Serves the built web app (../dist) so one shop PC can host both the sync API and the
// app itself: tablets open http://<pc-ip>:8787 and install it as a PWA.

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|xml|wasm)|image\/svg\+xml|font\/(ttf|otf))/

/** Files that must always be revalidated so app updates are picked up. */
const NO_CACHE = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest', 'version.json'])

/** Vite puts content-hashed files in assets/; Workbox emits workbox-<hash>.js at the root. */
const HASHED = /^workbox-[0-9a-f]{6,}\.js$/

function cacheControl(rel) {
  const base = path.posix.basename(rel)
  if (NO_CACHE.has(base) || base.endsWith('.html')) return 'no-cache'
  if (rel.startsWith('assets/') || HASHED.test(base)) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

const statFile = (p) =>
  fs.promises.stat(p).then(
    (s) => s,
    () => null,
  )

const NOT_BUILT = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenPOS sync server</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1f2937}code{background:#f3f4f6;padding:.1rem .3rem;border-radius:.25rem}</style></head>
<body><h1>OpenPOS sync server is running</h1><p>The sync API is available at <code>/api</code>.</p>
<p>The web app has not been built, so it is not served from here. Run <code>npm run build</code> in the project root and restart the server to open the POS from this address.</p></body></html>`

/**
 * Returns `(req, res, pathname) => Promise<boolean>` that serves files from `root`.
 * Resolves false when nothing was served (so the caller can send a 404).
 */
export function createStaticHandler(root) {
  const rootDir = root ? path.resolve(root) : null

  async function sendFile(req, res, file, stat, rel) {
    const ext = path.extname(file).toLowerCase()
    const type = MIME[ext] ?? 'application/octet-stream'
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', cacheControl(rel))
    res.setHeader('ETag', etag)
    res.setHeader('Last-Modified', stat.mtime.toUTCString())
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.posix.basename(rel) === 'sw.js') res.setHeader('Service-Worker-Allowed', '/')
    const compress = COMPRESSIBLE.test(type) && stat.size > 1024 && acceptsGzip(req)
    if (compress) res.setHeader('Vary', 'Accept-Encoding')

    const inm = req.headers['if-none-match']
    if (inm && inm.split(',').some((t) => t.trim() === etag)) {
      res.statusCode = 304
      res.end()
      return
    }
    res.statusCode = 200
    if (req.method === 'HEAD') {
      if (!compress) res.setHeader('Content-Length', stat.size)
      res.end()
      return
    }
    await new Promise((resolve) => {
      const done = () => resolve(undefined)
      if (compress) {
        res.setHeader('Content-Encoding', 'gzip')
        pipeline(fs.createReadStream(file), zlib.createGzip({ level: 6 }), res, done)
      } else {
        res.setHeader('Content-Length', stat.size)
        pipeline(fs.createReadStream(file), res, done)
      }
    })
  }

  return async function serveStatic(req, res, pathname) {
    const rootStat = rootDir ? await statFile(path.join(rootDir, 'index.html')) : null
    if (!rootStat) {
      if (pathname === '/' || pathname === '/index.html') {
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(req.method === 'HEAD' ? undefined : NOT_BUILT)
        return true
      }
      return false
    }

    let decoded
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return false
    }
    if (decoded.includes('\0')) return false
    const rel = path.posix.normalize(decoded).replace(/^(\.\.(\/|$))+/, '').replace(/^\/+/, '')
    let file = path.resolve(rootDir, rel)
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return false
    // Never serve dotfiles (e.g. .env, .git) even if they end up in the build folder.
    if (rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known')) return false

    let stat = await statFile(file)
    let relPath = rel
    if (stat?.isDirectory()) {
      file = path.join(file, 'index.html')
      relPath = path.posix.join(rel, 'index.html')
      stat = await statFile(file)
    }
    if (stat?.isFile()) {
      await sendFile(req, res, file, stat, relPath)
      return true
    }
    // SPA fallback: extension-less paths (client-side routes) get the app shell.
    if (!path.posix.extname(rel)) {
      await sendFile(req, res, path.join(rootDir, 'index.html'), rootStat, 'index.html')
      return true
    }
    return false
  }
}
