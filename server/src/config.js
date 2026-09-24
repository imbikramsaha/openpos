import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Folder holding server/package.json. */
export const SERVER_ROOT = serverRoot

/** Default location of the built web app (`npm run build` in the project root). */
export const DEFAULT_STATIC_DIR = path.resolve(serverRoot, '..', 'dist')

/** Default folder for the SQLite database. */
export const DEFAULT_DATA_DIR = path.resolve(serverRoot, 'data')

export const DEFAULT_PORT = 8787
export const DEFAULT_HOST = '0.0.0.0'

/** Largest accepted request body (after decompression). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024

/** Most changes accepted in one push. */
export const MAX_PUSH_BATCH = 2000

/** Default and maximum page size for pulls. */
export const DEFAULT_PULL_LIMIT = 1000
export const MAX_PULL_LIMIT = 5000

function int(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Reads server settings from environment variables. */
export function configFromEnv(env = process.env) {
  return {
    port: int(env.PORT, DEFAULT_PORT),
    host: env.HOST || DEFAULT_HOST,
    dataDir: path.resolve(env.DATA_DIR || DEFAULT_DATA_DIR),
    adminToken: env.ADMIN_TOKEN || '',
    staticDir: env.STATIC_DIR === '' ? null : path.resolve(env.STATIC_DIR || DEFAULT_STATIC_DIR),
    log: !['0', 'false', 'off', 'no'].includes(String(env.LOG ?? '').toLowerCase()),
    trustProxy: ['1', 'true', 'yes'].includes(String(env.TRUST_PROXY ?? '').toLowerCase()),
  }
}
