// OpenPOS — Electron main process (Windows, macOS, Linux).
//
// Serves the Vite build (`dist/`) from the privileged app://kasa/ origin (the name the app had
// before it became OpenPOS; the origin owns the local database, so it must never change), exposes a tiny
// printing / cash-drawer bridge to the renderer (see preload.cjs + src/lib/platform.ts) and
// keeps the renderer locked down (sandbox, context isolation, no Node, guarded navigation).
//
// Environment:
//   ELECTRON_DEV_URL=http://localhost:5173  load the Vite dev server instead of dist/ (HMR)
//   OPENPOS_KIOSK=1 (or --kiosk)            full-screen kiosk mode for dedicated tills
//   OPENPOS_USER_DATA_DIR=<dir>             use a separate profile (e.g. two tills on one PC)
//   OPENPOS_DEVTOOLS=1                      allow F12 / Ctrl+Shift+I in packaged builds
//   OPENPOS_DISABLE_UPDATES=1               never check GitHub Releases for updates
// The older KASA_* names still work.
'use strict'

const { app, BrowserWindow, Menu, ipcMain, powerSaveBlocker, protocol, screen, session, shell } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const APP_ID = 'com.openpos.app'
const SCHEME = 'app'
const HOST = 'kasa'
const APP_ORIGIN = `${SCHEME}://${HOST}`
const DIST_DIR = path.resolve(__dirname, '..', 'dist')
const DEV_URL = process.env.ELECTRON_DEV_URL || ''
/** OPENPOS_<name>, or the KASA_<name> it replaced. */
const env = (name) => process.env[`OPENPOS_${name}`] ?? process.env[`KASA_${name}`]
const KIOSK = env('KIOSK') === '1' || process.argv.includes('--kiosk')
const BACKGROUND = '#0b1020' // dark theme --bg (src/index.css): no white flash on start
const MIN_WIDTH = 360
const MIN_HEIGHT = 600
const CUSTOMER_DISPLAY = 'kasa-customer-display' // window name used by src/features/display
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const DEVTOOLS = !app.isPackaged || env('DEVTOOLS') === '1'
const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:', 'tel:', 'sms:', 'whatsapp:'])

/** @type {BrowserWindow | null} */
let mainWindow = null

// ---------------------------------------------------------------------------------------------
// Logging: console + a small rotating file in the profile (useful for printer/drawer support).
// ---------------------------------------------------------------------------------------------
let logFile = ''
function log(level, ...args) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}`
  ;(level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line)
  if (!logFile) return
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, `${logFile}.old`)
    fs.appendFileSync(logFile, `${line}\n`)
  } catch {
    /* logging must never break the app */
  }
}

// ---------------------------------------------------------------------------------------------
// Startup: must run before `ready`.
// ---------------------------------------------------------------------------------------------
if (env('USER_DATA_DIR')) app.setPath('userData', path.resolve(env('USER_DATA_DIR')))
else {
  // Installs from before the rename keep their sales database in the old "Kasa POS" profile folder.
  // (Electron creates the new folder at startup, so look for the database, not the folder.)
  const legacy = path.join(app.getPath('appData'), 'Kasa POS')
  const hasData = (dir) => fs.existsSync(path.join(dir, 'IndexedDB'))
  if (!hasData(app.getPath('userData')) && hasData(legacy)) app.setPath('userData', legacy)
}
if (IS_WIN) app.setAppUserModelId(APP_ID) // taskbar grouping + update notifications

// A stable, secure, standard origin: IndexedDB/localStorage persist across launches and
// updates, and crypto.subtle / camera / clipboard work (they require a secure context).
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
])

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the profile (and its IndexedDB): hand over and exit.
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())
  app.whenReady().then(onReady, (err) => log('error', 'startup failed', err))
}

function onReady() {
  logFile = path.join(app.getPath('userData'), 'openpos-main.log')
  log('info', `OpenPOS ${app.getVersion()} (Electron ${process.versions.electron}) on ${process.platform}-${process.arch}${KIOSK ? ' [kiosk]' : ''}`)

  registerAppProtocol()
  configurePermissions(session.defaultSession)
  registerIpc()
  setApplicationMenu()
  mainWindow = createMainWindow()
  if (KIOSK) powerSaveBlocker.start('prevent-display-sleep')
  setupAutoUpdates()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    else focusMainWindow()
  })
}

app.on('window-all-closed', () => {
  if (!IS_MAC) app.quit()
})

// Every webContents (main window, customer display, hidden print windows) gets the same guards.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url, frameName }) => {
    if (isAppUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: childWindowOptions(frameName) }
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    openExternal(url) // e.g. `location.href = 'mailto:…'`
  })
})

// ---------------------------------------------------------------------------------------------
// app://kasa/ → dist/
// ---------------------------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
}

function textResponse(status, text) {
  return new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

async function statFile(file) {
  try {
    const s = await fsp.stat(file)
    return s.isFile() ? s : null
  } catch {
    return null
  }
}

/** Resolves a request path inside dist/ (null = outside dist/, i.e. a traversal attempt). */
function resolveInDist(pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (rel.includes('\0')) return null
  const file = path.resolve(DIST_DIR, `.${path.sep}${rel.replace(/^[/\\]+/, '')}`)
  return file === DIST_DIR || file.startsWith(DIST_DIR + path.sep) ? file : null
}

function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== HOST) return textResponse(404, 'Not found')
      if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Method not allowed')

      let file = resolveInDist(url.pathname)
      if (!file) return textResponse(403, 'Forbidden')
      if (file === DIST_DIR || url.pathname.endsWith('/')) file = path.join(file, 'index.html')

      if (!(await statFile(file))) {
        // SPA fallback for client-side routes; real assets (anything with an extension) 404.
        if (path.extname(url.pathname)) return textResponse(404, 'Not found')
        file = path.join(DIST_DIR, 'index.html')
        if (!(await statFile(file))) return textResponse(500, 'dist/index.html is missing — run `npx vite build` first.')
      }

      const body = request.method === 'HEAD' ? null : await fsp.readFile(file)
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (err) {
      log('error', 'app:// handler failed', request.url, err)
      return textResponse(500, 'Internal error')
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Trust + navigation helpers
// ---------------------------------------------------------------------------------------------
const DEV_ORIGIN = (() => {
  try {
    return DEV_URL ? new URL(DEV_URL).origin : ''
  } catch {
    return ''
  }
})()

function isAppUrl(raw) {
  try {
    const u = new URL(raw)
    if (u.protocol === `${SCHEME}:` && u.host === HOST) return true
    return !!DEV_ORIGIN && u.origin === DEV_ORIGIN
  } catch {
    return false
  }
}

function openExternal(raw) {
  try {
    const u = new URL(raw)
    if (!EXTERNAL_PROTOCOLS.has(u.protocol)) return log('warn', 'blocked external URL', raw)
    shell.openExternal(u.toString()).catch((err) => log('warn', 'openExternal failed', err))
  } catch {
    log('warn', 'blocked invalid URL', raw)
  }
}

/** Only our own pages may use the bridge (defence in depth; the preload only runs there anyway). */
function trusted(event) {
  const url = event.senderFrame?.url || event.sender.getURL()
  if (isAppUrl(url)) return true
  log('warn', 'rejected IPC from untrusted frame', url)
  return false
}

function configurePermissions(ses) {
  // media = camera for barcode scanning; persistent-storage keeps IndexedDB from being evicted;
  // fullscreen/screen-wake-lock are for the customer display. Everything else is denied.
  const allowed = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write', 'persistent-storage', 'fullscreen', 'screen-wake-lock', 'fileSystem'])
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const fromApp = isAppUrl(details.requestingUrl || '')
    let ok = fromApp && allowed.has(permission)
    // Camera (barcode scanning) only — never the microphone.
    if (ok && permission === 'media') ok = !(details.mediaTypes || []).includes('audio')
    if (!ok) log('warn', `denied permission "${permission}" for ${details.requestingUrl}`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed.has(permission) && isAppUrl(requestingOrigin))
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------
function secureWebPreferences(extra = {}) {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    backgroundThrottling: false, // keep sync timers running while the till is minimised
    additionalArguments: [`--kasa-version=${app.getVersion()}`],
    ...extra,
  }
}

function devIcon() {
  // Packaged builds get their icon from electron-builder; this is for `electron .` on Linux/Windows.
  const icon = path.join(__dirname, '..', 'build', 'icon.png')
  return !app.isPackaged && fs.existsSync(icon) ? icon : undefined
}

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowState() {
  const { workArea } = screen.getPrimaryDisplay()
  const fallback = {
    width: Math.max(MIN_WIDTH, Math.min(1366, Math.round(workArea.width * 0.9))),
    height: Math.max(MIN_HEIGHT, Math.min(860, Math.round(workArea.height * 0.9))),
    maximized: false,
  }
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    const state = {
      width: Math.max(MIN_WIDTH, Math.round(Number(s.width)) || fallback.width),
      height: Math.max(MIN_HEIGHT, Math.round(Number(s.height)) || fallback.height),
      maximized: !!s.maximized,
    }
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      const r = { x: Math.round(s.x), y: Math.round(s.y), width: state.width, height: state.height }
      // Only restore the position if the window is still (mostly) on a connected monitor.
      const visible = screen.getAllDisplays().some(({ workArea: a }) => {
        const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x)
        const h = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y)
        return w >= 100 && h >= 100
      })
      if (visible) Object.assign(state, { x: r.x, y: r.y })
    }
    return state
  } catch {
    return fallback
  }
}

function trackWindowState(win) {
  let timer = null
  const write = () => {
    if (win.isDestroyed() || win.isFullScreen()) return
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() }
    try {
      const file = stateFile()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state))
      fs.renameSync(`${file}.tmp`, file)
    } catch (err) {
      log('warn', 'could not save window state', err)
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(write, 500)
  }
  for (const e of ['resize', 'move', 'maximize', 'unmaximize']) win.on(e, schedule)
  win.on('close', () => {
    clearTimeout(timer)
    write()
  })
}

function createMainWindow() {
  const state = KIOSK ? { width: 1280, height: 800, maximized: false } : loadWindowState()
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'OpenPOS',
    backgroundColor: BACKGROUND,
    icon: devIcon(),
    autoHideMenuBar: true,
    kiosk: KIOSK,
    fullscreen: KIOSK || undefined,
    webPreferences: secureWebPreferences(),
  })
  if (!IS_MAC) win.removeMenu()
  if (!KIOSK) trackWindowState(win)
  attachWindowBehaviour(win)

  win.once('ready-to-show', () => {
    if (state.maximized) win.maximize()
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // Closing the till also closes the customer display, otherwise the app would linger.
  win.on('close', () => {
    for (const other of BrowserWindow.getAllWindows()) if (other !== win && !other.isDestroyed()) other.destroy()
  })

  const target = DEV_URL || `${APP_ORIGIN}/index.html`
  win.loadURL(target).catch((err) => log('error', `failed to load ${target}`, err))
  return win
}

function focusMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Options for window.open() of our own pages — the customer display goes to the 2nd monitor. */
function childWindowOptions(frameName) {
  const base = {
    show: true,
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    icon: devIcon(),
    minWidth: 320,
    minHeight: 240,
    webPreferences: secureWebPreferences(),
  }
  if (frameName !== CUSTOMER_DISPLAY) return { ...base, width: 1024, height: 768 }
  const tillDisplay = mainWindow && !mainWindow.isDestroyed() ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay()
  const other = screen.getAllDisplays().find((d) => d.id !== tillDisplay.id)
  if (!other) return { ...base, title: 'OpenPOS — Customer display', width: 1024, height: 768 }
  const { x, y, width, height } = other.workArea
  return { ...base, title: 'OpenPOS — Customer display', x, y, width, height, fullscreen: KIOSK }
}

const attached = new WeakSet()

function attachWindowBehaviour(win) {
  const wc = win.webContents
  if (attached.has(wc)) return
  attached.add(wc)

  // Child windows of our pages (customer display) behave like the main window.
  wc.on('did-create-window', (child) => {
    if (!IS_MAC) child.removeMenu()
    attachWindowBehaviour(child)
  })

  // Touch tills: no accidental pinch-zoom (index.html also says user-scalable=no).
  wc.on('did-finish-load', () => wc.setVisualZoomLevelLimits(1, 1).catch(() => {}))

  // No menu bar on Windows/Linux, so the few useful shortcuts are handled here.
  // (macOS gets zoom/full screen/devtools from the application menu.)
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const action = shortcutFor(input)
    if (!action) return
    event.preventDefault()
    if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen())
    else if (action === 'zoom-in') wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
    else if (action === 'zoom-out') wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
    else if (action === 'zoom-reset') wc.setZoomLevel(0)
    else if (action === 'devtools') wc.toggleDevTools()
    else if (action === 'reload') wc.reload()
  })

  // Self-heal: a crashed renderer on an unattended till reloads instead of showing a blank window.
  wc.on('render-process-gone', (_e, details) => {
    log('error', 'renderer gone', details)
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => !win.isDestroyed() && wc.reload(), 1000)
  })
  wc.on('unresponsive', () => log('warn', 'renderer unresponsive'))
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame) log('error', `load failed ${code} ${desc} ${url}`)
  })
}

function shortcutFor(input) {
  if (IS_MAC) return null
  const key = input.key
  const ctrl = input.control && !input.alt && !input.meta
  if (key === 'F11' && !KIOSK) return 'fullscreen'
  if (ctrl && (key === '=' || key === '+')) return 'zoom-in'
  if (ctrl && (key === '-' || key === '_')) return 'zoom-out'
  if (ctrl && key === '0') return 'zoom-reset'
  if (DEVTOOLS && (key === 'F12' || (ctrl && input.shift && key.toLowerCase() === 'i'))) return 'devtools'
  if (!app.isPackaged && (key === 'F5' || (ctrl && !input.shift && key.toLowerCase() === 'r'))) return 'reload'
  return null
}

function setApplicationMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null)
    return
  }
  // macOS needs Edit roles for copy/paste shortcuts and Window roles for Cmd+M / Cmd+W.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          ...(DEVTOOLS ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
}

// ---------------------------------------------------------------------------------------------
// Bridge (window.kasa)
// ---------------------------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('kasa:get-printers', async (event) => {
    if (!trusted(event)) return []
    try {
      const [printers, fallbackDefault] = await Promise.all([event.sender.getPrintersAsync(), defaultPrinterName()])
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: p.isDefault === true || p.options?.['is-default'] === 'true' || (!!fallbackDefault && p.name === fallbackDefault),
      }))
    } catch (err) {
      log('error', 'getPrinters failed', err)
      return []
    }
  })

  ipcMain.handle('kasa:print-html', async (event, html, options) => {
    if (!trusted(event) || typeof html !== 'string' || html.length > 32 * 1024 * 1024) return false
    const o = options && typeof options === 'object' ? options : {}
    const widthMm = Number(o.widthMm)
    return enqueue(() =>
      printHtml(html, {
        printer: typeof o.printer === 'string' && o.printer ? o.printer : undefined,
        silent: o.silent === true,
        widthMm: Number.isFinite(widthMm) && widthMm >= 20 && widthMm <= 420 ? widthMm : undefined,
      }),
    )
  })

  ipcMain.handle('kasa:open-cash-drawer', async (event, printer) => {
    if (!trusted(event)) return false
    return enqueue(() => openCashDrawer(typeof printer === 'string' && printer ? printer : undefined))
  })
}

// Print jobs and drawer kicks go to the same device: run them one at a time, in order.
let queue = Promise.resolve()
function enqueue(job) {
  const run = queue.then(job, job)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run.catch((err) => {
    log('error', 'device job failed', err)
    return false
  })
}

const MICRONS_PER_CSS_PX = 25400 / 96

/**
 * Prints a complete HTML document in a hidden window.
 * Roll paper (widthMm): page = paper width × content height, no margins (no blank tail feed).
 * No width: A4 with the document's own @page margins.
 */
async function printHtml(html, { printer, silent, widthMm }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kasa-print-'))
  const file = path.join(dir, 'document.html')
  /** @type {BrowserWindow | null} */
  let win = null
  try {
    await fsp.writeFile(file, html, 'utf8')
    win = new BrowserWindow({
      show: false,
      width: widthMm ? Math.ceil((widthMm * 96) / 25.4) + 16 : 820,
      height: 600,
      backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    await win.loadFile(file)
    // Wait for web fonts and any late images (logo, barcodes) before measuring/printing.
    const heightPx = await withTimeout(
      win.webContents.executeJavaScript(
        `Promise.all([document.fonts ? document.fonts.ready : 0, ...Array.from(document.images).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r }))])
           .then(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)))`,
        true,
      ),
      10000,
      0,
    )

    const pageSize = widthMm
      ? {
          width: Math.round(widthMm * 1000),
          // Content height + 5 mm tail, at least 30 mm; if measuring failed use a long roll.
          height: heightPx > 0 ? Math.max(30000, Math.round(heightPx * MICRONS_PER_CSS_PX) + 5000) : 3000000,
        }
      : 'A4'

    const printOptions = {
      silent: !!silent,
      printBackground: true,
      margins: { marginType: widthMm ? 'none' : 'default' },
      pageSize,
      copies: 1,
    }
    if (printer) printOptions.deviceName = printer

    const ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 120000)
      win.webContents.print(printOptions, (success, reason) => {
        clearTimeout(timer)
        if (!success && reason && reason !== 'cancelled') log('warn', `print failed on ${printer || 'default printer'}: ${reason}`)
        resolve(!!success)
      })
    })
    // Give the spooler a moment before the page is torn down.
    await new Promise((r) => setTimeout(r, 500))
    return ok
  } catch (err) {
    log('error', 'printHtml failed', err)
    return false
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    Promise.resolve(promise).then(
      (v) => (clearTimeout(timer), resolve(v)),
      () => (clearTimeout(timer), resolve(fallback)),
    )
  })
}

function run(cmd, args, { timeout = 15000, env } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, env: env ? { ...process.env, ...env } : process.env }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), err })
    })
  })
}

let defaultPrinterCache = { at: 0, name: '' }
/** The OS default printer (best effort, cached 30 s). */
async function defaultPrinterName() {
  if (Date.now() - defaultPrinterCache.at < 30000) return defaultPrinterCache.name
  let name = ''
  try {
    if (IS_WIN) {
      const r = await run('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows', '/v', 'Device'], { timeout: 5000 })
      const m = r.stdout.match(/Device\s+REG_SZ\s+([^,\r\n]+)/)
      if (m) name = m[1].trim()
    } else {
      const r = await run('lpstat', ['-d'], { timeout: 5000, env: { LC_ALL: 'C', LANG: 'C' } })
      const m = r.stdout.match(/system default destination:\s*(\S+)/)
      if (m) name = m[1]
    }
  } catch {
    /* no default printer */
  }
  defaultPrinterCache = { at: Date.now(), name }
  return name
}

// ESC p m t1 t2 — pulse drawer-kick pin 2 for 25×2 ms on / 250×2 ms off. Cash drawers plug into
// the receipt printer's RJ11/RJ12 "DK" port, so the pulse is sent raw to that printer.
const DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

async function openCashDrawer(printer) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kasa-drawer-')).catch(() => '')
  if (!dir) return false
  const file = path.join(dir, 'drawer.bin')
  try {
    const target = printer || (await defaultPrinterName())
    if (!target) {
      log('warn', 'openCashDrawer: no printer configured and no default printer')
      return false
    }
    await fsp.writeFile(file, DRAWER_PULSE)
    const ok = IS_WIN ? await rawPrintWindows(target, file) : (await run('lp', ['-d', target, '-o', 'raw', '-t', 'OpenPOS drawer', file])).ok
    if (!ok) log('warn', `openCashDrawer: could not send pulse to "${target}"`)
    return ok
  } catch (err) {
    log('error', 'openCashDrawer failed', err)
    return false
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Windows: write RAW bytes through the spooler (winspool.drv) from PowerShell — works for USB,
// network and shared printers without extra drivers. Printer name/file are passed via env.
const WIN_RAW_PRINT_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KasaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW info);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
  public static bool Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    try {
      DOCINFOW info = new DOCINFOW();
      info.pDocName = "OpenPOS drawer";
      info.pDataType = "RAW";
      if (StartDocPrinter(h, 1, info) == 0) return false;
      try {
        if (!StartPagePrinter(h)) return false;
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        return ok && written == data.Length;
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
'@
$bytes = [System.IO.File]::ReadAllBytes($env:KASA_RAW_FILE)
if ([KasaRawPrinter]::Send($env:KASA_PRINTER, $bytes)) { exit 0 } else { exit 1 }
`

async function rawPrintWindows(printer, file) {
  const encoded = Buffer.from(WIN_RAW_PRINT_PS, 'utf16le').toString('base64')
  const ps = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    timeout: 30000,
    env: { KASA_PRINTER: printer, KASA_RAW_FILE: file },
  })
  if (ps.ok) return true
  log('warn', 'raw print via spooler failed', ps.stderr.trim() || ps.code)
  // Fallback: a printer shared on this PC can be written to as \\localhost\<share>.
  if (!/^[\w .()-]+$/.test(printer)) return false
  const copy = await run('cmd.exe', ['/d', '/c', 'copy', '/b', file, `\\\\localhost\\${printer}`], { timeout: 15000 })
  return copy.ok
}

// ---------------------------------------------------------------------------------------------
// Auto-update from GitHub Releases (packaged builds only; never fatal).
// ---------------------------------------------------------------------------------------------
function setupAutoUpdates() {
  if (!app.isPackaged || env('DISABLE_UPDATES') === '1') return
  if (process.env.PORTABLE_EXECUTABLE_DIR) return // Windows portable .exe cannot self-update
  let autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch (err) {
    log('warn', 'electron-updater unavailable', err)
    return
  }
  autoUpdater.logger = {
    info: (...a) => log('info', '[updater]', ...a),
    warn: (...a) => log('warn', '[updater]', ...a),
    error: (...a) => log('error', '[updater]', ...a),
    debug: () => {},
  }
  autoUpdater.on('error', (err) => log('warn', '[updater] error', err))
  autoUpdater.on('update-downloaded', (info) => log('info', `[updater] ${info.version} downloaded — installs on quit`))
  const check = () =>
    autoUpdater.checkForUpdatesAndNotify().catch((err) => log('warn', '[updater] check failed', err))
  setTimeout(check, 15000)
  setInterval(check, 6 * 60 * 60 * 1000).unref?.()
}

// Exported for tests only (never used by the app itself).
module.exports = { resolveInDist, isAppUrl, DRAWER_PULSE }
