// OpenPOS — preload (sandboxed, context-isolated).
// Exposes `window.kasa`, matching the `ElectronBridge` interface in src/lib/platform.ts.
// Only plain data crosses the bridge; ipcRenderer itself is never exposed.
'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function arg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : ''
}

const bridge = {
  isElectron: true,
  platform: process.platform, // 'win32' | 'darwin' | 'linux'
  version: arg('kasa-version'), // app version (package.json), passed by main.cjs

  /** @returns {Promise<Array<{ name: string; displayName: string; isDefault: boolean }>>} */
  getPrinters: () => ipcRenderer.invoke('kasa:get-printers'),

  /**
   * @param {string} html complete HTML document
   * @param {{ printer?: string; silent?: boolean; widthMm?: number }} [options]
   * @returns {Promise<boolean>}
   */
  printHtml: (html, options = {}) =>
    ipcRenderer.invoke('kasa:print-html', String(html), {
      printer: typeof options?.printer === 'string' ? options.printer : undefined,
      silent: options?.silent === true,
      widthMm: typeof options?.widthMm === 'number' ? options.widthMm : undefined,
    }),

  /** Kicks the cash drawer attached to the receipt printer. @returns {Promise<boolean>} */
  openCashDrawer: (printer) => ipcRenderer.invoke('kasa:open-cash-drawer', typeof printer === 'string' ? printer : undefined),
}

contextBridge.exposeInMainWorld('kasa', bridge)
