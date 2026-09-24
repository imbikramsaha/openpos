#!/usr/bin/env node
// Kasa POS sync server — entry point and command-line interface.
//
//   node server/src/index.js                      start the server (default command)
//   node server/src/index.js create-store "Shop"  create a store and print its key
//   node server/src/index.js list-stores          list stores
//   node server/src/index.js rotate-key <id>      issue a new key for a store
//
// Configuration comes from environment variables: PORT, HOST, DATA_DIR, ADMIN_TOKEN,
// STATIC_DIR, LOG, TRUST_PROXY. See server/README.md.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv } from './config.js'
import { VERSION, createServer } from './server.js'
import { openStorage } from './storage.js'

export { createServer, VERSION } from './server.js'
export { openStorage } from './storage.js'

function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (!a.internal && (a.family === 'IPv4' || a.family === 4)) out.push(a.address)
    }
  }
  return out
}

function usage() {
  return `Kasa POS sync server v${VERSION}

Usage:
  node server/src/index.js [serve]              Start the server
  node server/src/index.js create-store <name>  Create a store and print its key
  node server/src/index.js list-stores          List stores
  node server/src/index.js rotate-key <id>      Replace a store's key (old key stops working)
  node server/src/index.js help                 Show this help

Environment:
  PORT=8787  HOST=0.0.0.0  DATA_DIR=server/data  ADMIN_TOKEN=<secret>
  STATIC_DIR=dist (empty to disable)  LOG=1  TRUST_PROXY=0
`
}

async function serve(config) {
  const app = createServer(config)
  let address
  try {
    address = await app.listen(config.port, config.host)
  } catch (e) {
    if (e?.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use. Set PORT to use another one.`)
    else console.error(e)
    process.exit(1)
  }

  const stores = app.listStores()
  const webApp = config.staticDir && fs.existsSync(path.join(config.staticDir, 'index.html'))
  const lines = [
    `Kasa POS sync server v${VERSION}`,
    `  Listening on ${config.host}:${address.port}`,
    `  Local:       http://localhost:${address.port}`,
  ]
  if (config.host === '0.0.0.0' || config.host === '::') {
    for (const ip of lanAddresses()) lines.push(`  Network:     http://${ip}:${address.port}`)
  }
  lines.push(`  Data:        ${path.join(config.dataDir, 'kasa.sqlite')}`)
  lines.push(`  Web app:     ${webApp ? `serving ${config.staticDir}` : 'not built (run "npm run build" to serve the POS from this server)'}`)
  lines.push(`  Admin API:   ${config.adminToken ? 'enabled' : 'disabled (set ADMIN_TOKEN to enable)'}`)
  lines.push(`  Stores:      ${stores.length}`)
  if (!stores.length) lines.push(`\n  No stores yet. Create one with:\n    node server/src/index.js create-store "My Shop"`)
  console.log(lines.join('\n') + '\n')

  let stopping = false
  const shutdown = (signal) => {
    if (stopping) return
    stopping = true
    console.log(`\n${signal} received, shutting down…`)
    const force = setTimeout(() => {
      console.error('Forced exit after 10 s')
      process.exit(1)
    }, 10_000)
    force.unref()
    app.close().then(
      () => process.exit(0),
      (e) => {
        console.error(e)
        process.exit(1)
      },
    )
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

function withStorage(config, fn) {
  const storage = openStorage({ dataDir: config.dataDir })
  try {
    return fn(storage)
  } finally {
    storage.close()
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const config = configFromEnv(env)
  const [command = 'serve', ...args] = argv

  switch (command) {
    case 'serve':
    case 'start':
      await serve(config)
      return

    case 'create-store': {
      const name = args.join(' ').trim()
      if (!name) {
        console.error('Usage: node server/src/index.js create-store "Shop name"')
        process.exitCode = 1
        return
      }
      const store = withStorage(config, (s) => s.createStore(name))
      console.log(`Created store "${store.name}"
  Store ID:  ${store.id}
  Store key: ${store.key}

Keep the key safe: it is shown only once. Enter the server address and this key on each
till under Settings → Sync, or choose "Join an existing store" when setting up a new till.`)
      return
    }

    case 'list-stores': {
      const stores = withStorage(config, (s) => s.listStores())
      if (!stores.length) {
        console.log('No stores. Create one with: node server/src/index.js create-store "Shop name"')
        return
      }
      for (const s of stores) {
        const seen = s.lastSeen ? new Date(s.lastSeen).toISOString() : 'never'
        console.log(`${s.id}  ${s.name}\n  created ${new Date(s.createdAt).toISOString()} · ${s.records} records · ${s.devices} devices · last seen ${seen}`)
      }
      return
    }

    case 'rotate-key': {
      const id = args[0]
      if (!id) {
        console.error('Usage: node server/src/index.js rotate-key <store-id>')
        process.exitCode = 1
        return
      }
      const store = withStorage(config, (s) => s.rotateKey(id))
      if (!store) {
        console.error(`No store with id ${id}`)
        process.exitCode = 1
        return
      }
      console.log(`New key for "${store.name}": ${store.key}\nThe old key no longer works; update every till under Settings → Sync.`)
      return
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(usage())
      return

    case 'version':
    case '--version':
    case '-v':
      console.log(VERSION)
      return

    default:
      console.error(`Unknown command "${command}"\n`)
      console.error(usage())
      process.exitCode = 1
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
