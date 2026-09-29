import { accessToken, NeedsReconnect, type CloudProvider } from './oauth'

// Minimal clients for the three cloud APIs: upload, list, download, delete, and who is
// signed in. Everything lands in an app-specific folder, never the user's whole drive.

export interface RemoteFile {
  id: string
  name: string
  size: number
  createdAt: number
}

export interface CloudApi {
  account(): Promise<string>
  upload(name: string, blob: Blob): Promise<void>
  list(): Promise<RemoteFile[]>
  download(id: string): Promise<Blob>
  remove(id: string): Promise<void>
}

// openpos-backup-YYYYMMDD-HHMM[SS] (kasa-backup-… before the rename), plus the suffix a provider adds when it renames a clash:
// "… (1)" on Dropbox, "… 1" on OneDrive.
export const BACKUP_NAME = /^(openpos|kasa)-backup-\d{8}-\d{4}(\d{2})?(-\d+| \(\d+\)| \d+)?\.(json|openpos|kasa)$/

async function call(p: CloudProvider, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(p)
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new NeedsReconnect(p)
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return res
}

const sortNewest = (files: RemoteFile[]) => files.filter((f) => BACKUP_NAME.test(f.name)).sort((a, b) => b.createdAt - a.createdAt)

// ---- Dropbox (App folder: /Apps/<app name>/) -------------------------------------------------

const dropbox: CloudApi = {
  async account() {
    const r = await call('dropbox', 'https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST' })
    const a = (await r.json()) as { email?: string; name?: { display_name?: string } }
    return a.email || a.name?.display_name || 'Dropbox'
  },
  async upload(name, blob) {
    await call('dropbox', 'https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/${name}`, mode: 'add', autorename: true }) },
      body: blob,
    })
  },
  async list() {
    const r = await call('dropbox', 'https://api.dropboxapi.com/2/files/list_folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '' }) })
    const data = (await r.json()) as { entries: Array<{ '.tag': string; id: string; name: string; size: number; server_modified: string; path_lower: string }> }
    return sortNewest(data.entries.filter((e) => e['.tag'] === 'file').map((e) => ({ id: e.path_lower, name: e.name, size: e.size, createdAt: Date.parse(e.server_modified) })))
  },
  async download(id) {
    const r = await call('dropbox', 'https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: id }) } })
    return r.blob()
  },
  async remove(id) {
    await call('dropbox', 'https://api.dropboxapi.com/2/files/delete_v2', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: id }) })
  },
}

// ---- Google Drive (an "OpenPOS Backups" folder; drive.file scope sees only its own files) ------

const FOLDER_NAME = 'OpenPOS Backups'
let folderId: string | null = null

async function gdriveFolder(): Promise<string> {
  if (folderId) return folderId
  const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const found = (await (await call('gdrive', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json()) as { files: Array<{ id: string }> }
  if (found.files[0]) return (folderId = found.files[0].id)
  const created = await call('gdrive', 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  return (folderId = ((await created.json()) as { id: string }).id)
}

const gdrive: CloudApi = {
  async account() {
    const r = await call('gdrive', 'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)')
    const a = (await r.json()) as { user?: { emailAddress?: string; displayName?: string } }
    return a.user?.emailAddress || a.user?.displayName || 'Google Drive'
  },
  async upload(name, blob) {
    const parent = await gdriveFolder()
    // Resumable upload: works for any size (multipart is only meant for small files).
    const start = await call('gdrive', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream' },
      body: JSON.stringify({ name, parents: [parent] }),
    })
    const session = start.headers.get('Location')
    if (session) {
      const put = await fetch(session, { method: 'PUT', body: blob })
      if (!put.ok) throw new Error(`gdrive: HTTP ${put.status}`)
      return
    }
    // Some proxies hide the Location header from the browser: fall back to a multipart upload.
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify({ name, parents: [parent] })], { type: 'application/json' }))
    form.append('file', blob)
    await call('gdrive', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: form })
  },
  async list() {
    const parent = await gdriveFolder()
    const q = encodeURIComponent(`'${parent}' in parents and trashed=false`)
    const r = await call('gdrive', `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,size,createdTime)`)
    const data = (await r.json()) as { files: Array<{ id: string; name: string; size?: string; createdTime: string }> }
    return sortNewest(data.files.map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), createdAt: Date.parse(f.createdTime) })))
  },
  async download(id) {
    return (await call('gdrive', `https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).blob()
  },
  async remove(id) {
    await call('gdrive', `https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' })
  },
}

// ---- OneDrive (app folder: /Apps/<app name>/) -----------------------------------------------

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive'
// Upload-session chunks must be multiples of 320 KiB.
const CHUNK = 320 * 1024 * 16

const onedrive: CloudApi = {
  async account() {
    const r = await call('onedrive', 'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,displayName,mail')
    const a = (await r.json()) as { mail?: string; userPrincipalName?: string; displayName?: string }
    return a.mail || a.userPrincipalName || a.displayName || 'OneDrive'
  },
  async upload(name, blob) {
    const s = await call('onedrive', `${GRAPH}/special/approot:/${encodeURIComponent(name)}:/createUploadSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
    })
    const { uploadUrl } = (await s.json()) as { uploadUrl: string }
    for (let start = 0; start < blob.size || start === 0; start += CHUNK) {
      const end = Math.min(start + CHUNK, blob.size)
      // The upload URL is pre-authorised: no Authorization header allowed.
      const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` }, body: blob.slice(start, end) })
      if (!r.ok) throw new Error(`onedrive: HTTP ${r.status}`)
      if (end >= blob.size) break
    }
  },
  async list() {
    const r = await call('onedrive', `${GRAPH}/special/approot/children?$select=id,name,size,createdDateTime&$top=200`)
    const data = (await r.json()) as { value: Array<{ id: string; name: string; size: number; createdDateTime: string }> }
    return sortNewest(data.value.map((f) => ({ id: f.id, name: f.name, size: f.size, createdAt: Date.parse(f.createdDateTime) })))
  },
  async download(id) {
    return (await call('onedrive', `${GRAPH}/items/${id}/content`)).blob()
  },
  async remove(id) {
    await call('onedrive', `${GRAPH}/items/${id}`, { method: 'DELETE' })
  },
}

export const CLOUD: Record<CloudProvider, CloudApi> = { dropbox, gdrive, onedrive }
