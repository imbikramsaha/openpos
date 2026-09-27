import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptBlob, encryptBlob, isEncrypted, WrongPassphrase } from '@/features/backup/crypto'
import { DEFAULT_CONFIG, clearStatus, dueTargets, runAutoBackup, saveConfig, toPrune, loadAutoBackup, useAutoBackup } from '@/features/backup/runner'
import { localDb, kvSet } from '@/features/backup/store'
import { accessToken } from '@/features/backup/oauth'
import { BACKUP_NAME, CLOUD } from '@/features/backup/providers'
import { db } from '@/db/db'
import { put } from '@/db/repo'
import type { User } from '@/core/types'

describe('backup encryption', () => {
  it('round-trips and rejects a wrong passphrase', async () => {
    const plain = new Blob([JSON.stringify({ app: 'kasa-pos', tables: { a: [1, 2, 3] } })])
    const enc = await encryptBlob(plain, 'correct horse')
    expect(await isEncrypted(enc)).toBe(true)
    expect(await isEncrypted(plain)).toBe(false)
    expect(await (await decryptBlob(enc, 'correct horse')).text()).toBe(await plain.text())
    await expect(decryptBlob(enc, 'wrong')).rejects.toBeInstanceOf(WrongPassphrase)
  })
})

describe('schedule', () => {
  const cfg = { ...DEFAULT_CONFIG, targets: { ...DEFAULT_CONFIG.targets, device: true, dropbox: true } }
  const now = 10 * 24 * 3_600_000
  it('runs each destination when its interval has passed', () => {
    expect(dueTargets(cfg, {}, now, 'schedule')).toEqual(['device', 'dropbox'])
    expect(dueTargets(cfg, { device: { lastSuccess: now - 3_600_000 } }, now, 'schedule')).toEqual(['dropbox'])
    expect(dueTargets({ ...cfg, intervalHours: 0 }, {}, now, 'schedule')).toEqual([])
  })
  it('shift close and manual runs cover every enabled destination', () => {
    expect(dueTargets(cfg, { device: { lastSuccess: now } }, now, 'shiftClose')).toEqual(['device', 'dropbox'])
    expect(dueTargets({ ...cfg, onShiftClose: false }, {}, now, 'shiftClose')).toEqual([])
    expect(dueTargets(cfg, { device: { lastSuccess: now } }, now, 'manual')).toEqual(['device', 'dropbox'])
  })
  it('always keeps at least the newest copy', () => {
    expect(toPrune([5, 4, 3, 2, 1], 3)).toEqual([2, 1])
    expect(toPrune([5, 4], 0)).toEqual([4])
  })
})

describe('automatic backup run', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await localDb.snapshots.clear()
    await localDb.kv.clear()
    await loadAutoBackup()
    await put<User>('users', { name: 'Admin', role: 'admin', pinHash: 'x', pinSalt: 'y', active: true })
  })

  it('keeps snapshots on this device and prunes beyond the limit', async () => {
    await saveConfig({ targets: { ...DEFAULT_CONFIG.targets, device: true }, keepOnDevice: 2 })
    for (let i = 0; i < 3; i++) expect(await runAutoBackup('manual')).toEqual([])
    const snaps = await localDb.snapshots.toArray()
    expect(snaps).toHaveLength(2)
    const file = JSON.parse(await snaps[0].blob.text())
    expect(file.app).toBe('kasa-pos')
    expect(file.tables.users).toHaveLength(1)
    expect(useAutoBackup.getState().status.device?.lastSuccess).toBeGreaterThan(0)
  })

  it('encrypts when a passphrase is set', async () => {
    await kvSet('backup:passphrase', 'shop secret 123')
    await saveConfig({ targets: { ...DEFAULT_CONFIG.targets, device: true }, encrypt: true })
    await runAutoBackup('manual')
    const [snap] = await localDb.snapshots.toArray()
    expect(snap.encrypted).toBe(true)
    expect(snap.filename.endsWith('.kasa')).toBe(true)
    expect(JSON.parse(await (await decryptBlob(snap.blob, 'shop secret 123')).text()).app).toBe('kasa-pos')
  })

  it('does nothing before the shop is set up', async () => {
    await db.users.clear()
    await saveConfig({ targets: { ...DEFAULT_CONFIG.targets, device: true } })
    await runAutoBackup('manual')
    expect(await localDb.snapshots.count()).toBe(0)
  })
})

describe('cloud clients (mocked APIs)', () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  afterEach(() => {
    vi.unstubAllGlobals()
    calls.length = 0
  })

  it('refreshes an expired Dropbox token and uploads into the app folder, then prunes', async () => {
    await kvSet('oauth:dropbox', { access_token: 'old', refresh_token: 'r1', expires_at: 0 })
    const listing = { entries: [3, 2, 1].map((n) => ({ '.tag': 'file', id: `id${n}`, name: `kasa-backup-2026090${n}-1200.json`, size: 10, server_modified: `2026-09-0${n}T12:00:00Z`, path_lower: `/kasa-backup-2026090${n}-1200.json` })) }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('oauth2/token')) return Response.json({ access_token: 'fresh', expires_in: 14400 })
      if (url.includes('list_folder')) return Response.json(listing)
      return Response.json({})
    }))
    // Dropbox client id comes from the build env; the token call itself is what's tested.
    expect(await accessToken('dropbox')).toBe('fresh')
    await CLOUD.dropbox.upload('kasa-backup-20260904-1200.json', new Blob(['{}']))
    const upload = calls.find((c) => c.url.includes('files/upload'))!
    expect((upload.init!.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
    expect(JSON.parse((upload.init!.headers as Record<string, string>)['Dropbox-API-Arg']).path).toBe('/kasa-backup-20260904-1200.json')
    const files = await CLOUD.dropbox.list()
    expect(files.map((f) => f.name)[0]).toBe('kasa-backup-20260903-1200.json')
    for (const f of toPrune(files, 2)) await CLOUD.dropbox.remove(f.id)
    const deletes = calls.filter((c) => c.url.includes('delete_v2')).map((c) => JSON.parse(String(c.init!.body)).path)
    expect(deletes).toEqual(['/kasa-backup-20260901-1200.json'])
  })
})

describe('backup file names', () => {
  it('recognises our backups, including copies a provider renamed', () => {
    for (const n of ['kasa-backup-20260927-1450.json', 'kasa-backup-20260927-145012.kasa', 'kasa-backup-20260927-145012 (1).kasa', 'kasa-backup-20260927-145012 1.json'])
      expect(BACKUP_NAME.test(n), n).toBe(true)
    for (const n of ['notes.txt', 'kasa-backup-2026.json', 'kasa-backup-20260927-1450.json.bak']) expect(BACKUP_NAME.test(n), n).toBe(false)
  })
})

describe('destination status', () => {
  it('is cleared when a destination is disconnected', async () => {
    useAutoBackup.setState({ status: { dropbox: { lastAttempt: 1, error: 'x', needs: 'reconnect' }, device: { lastSuccess: 1 } } })
    await clearStatus('dropbox')
    expect(useAutoBackup.getState().status).toEqual({ device: { lastSuccess: 1 } })
  })
})
