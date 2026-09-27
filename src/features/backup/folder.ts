import { kvDelete, kvGet, kvSet } from './store'
import { BACKUP_NAME, type RemoteFile } from './providers'

// A folder on this computer (File System Access API: Chrome, Edge and the desktop app).
// Choosing the Google Drive, OneDrive or Dropbox desktop sync folder gives cloud backup
// without connecting any account.

// Permission methods aren't in TypeScript's DOM types yet.
interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>
}

const KEY = 'folder:handle'

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window

export class FolderPermission extends Error {
  constructor() {
    super('folder permission needed')
  }
}

export async function chooseFolder(): Promise<string> {
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker
  const handle = await picker({ id: 'kasa-backups', mode: 'readwrite' })
  await kvSet(KEY, handle)
  return handle.name
}

export async function folderName(): Promise<string | null> {
  return (await kvGet<DirHandle | null>(KEY, null))?.name ?? null
}

export async function forgetFolder(): Promise<void> {
  await kvDelete(KEY)
}

/** Re-grants access (browsers may ask again after a restart). Must be called from a click. */
export async function allowFolder(): Promise<boolean> {
  const h = await kvGet<DirHandle | null>(KEY, null)
  return !!h && (await h.requestPermission({ mode: 'readwrite' })) === 'granted'
}

async function handle(): Promise<DirHandle> {
  const h = await kvGet<DirHandle | null>(KEY, null)
  if (!h) throw new Error('no folder chosen')
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') throw new FolderPermission()
  return h
}

export async function writeToFolder(name: string, blob: Blob): Promise<void> {
  const file = await (await handle()).getFileHandle(name, { create: true })
  const w = await file.createWritable()
  await w.write(blob)
  await w.close()
}

export async function listFolder(): Promise<RemoteFile[]> {
  const out: RemoteFile[] = []
  for await (const entry of (await handle()).values()) {
    if (entry.kind !== 'file' || !BACKUP_NAME.test(entry.name)) continue
    const f = await (entry as FileSystemFileHandle).getFile()
    out.push({ id: entry.name, name: entry.name, size: f.size, createdAt: f.lastModified })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

export async function readFromFolder(name: string): Promise<Blob> {
  return (await (await handle()).getFileHandle(name)).getFile()
}

export async function removeFromFolder(name: string): Promise<void> {
  await (await handle()).removeEntry(name)
}
