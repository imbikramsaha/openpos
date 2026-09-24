// Type declarations for server.js so TypeScript tests can start the server in-process.
import type { Server } from 'node:http'

export interface ServerOptions {
  /** Folder for kasa.sqlite (default: server/data). */
  dataDir?: string
  /** An already opened storage from openStorage(); the server will not close it. */
  storage?: Storage
  /** Enables /api/admin/* when non-empty. */
  adminToken?: string
  /** Built web app to serve (default: ../dist). `null` disables static serving. */
  staticDir?: string | null
  /** Request logging: true = console, false = off, or a custom line logger. */
  log?: boolean | ((line: string) => void)
  trustProxy?: boolean
  port?: number
  host?: string
  maxBodyBytes?: number
  maxBatch?: number
}

export interface StoreInfo {
  id: string
  name: string
  createdAt: number
}

export interface CreatedStore extends StoreInfo {
  /** Plain store key; only its SHA-256 hash is stored. */
  key: string
}

export interface StoreSummary extends StoreInfo {
  lastSeq: number
  records: number
  devices: number
  lastSeen: number | null
}

export interface Storage {
  createStore(name: string): CreatedStore
  rotateKey(storeId: string): CreatedStore | null
  listStores(): StoreSummary[]
  close(): void
}

export interface KasaServer {
  httpServer: Server
  storage: Storage
  version: string
  listen(port?: number, host?: string): Promise<{ port: number; host: string; url: string }>
  close(): Promise<void>
  createStore(name: string): CreatedStore
  listStores(): StoreSummary[]
}

export const VERSION: string
export function createServer(options?: ServerOptions): KasaServer
