import { isElectron, isNative } from '@/lib/platform'
import { kvDelete, kvGet, kvSet } from './store'

// OAuth 2.0 authorization-code flow with PKCE, in a popup that returns to
// public/oauth-callback.html. Dropbox exchanges codes directly from the browser; Google and
// Microsoft only issue long-lived refresh tokens to apps that hold a client secret, so their
// exchanges go through a small token broker (netlify/functions/oauth-token.mjs).

export type CloudProvider = 'dropbox' | 'gdrive' | 'onedrive'

export interface Tokens {
  access_token: string
  refresh_token?: string
  expires_at: number
}

interface ProviderConfig {
  clientId: string | undefined
  authorizeUrl: string
  scope: string
  extraAuthParams?: Record<string, string>
  /** Token endpoint called from the browser (no secret), or 'broker'. */
  token: string | 'broker'
  brokerName?: 'google' | 'microsoft'
}

const env = import.meta.env

export const PROVIDERS: Record<CloudProvider, ProviderConfig> = {
  dropbox: {
    clientId: env.VITE_DROPBOX_APP_KEY,
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    scope: 'files.content.write files.content.read files.metadata.read account_info.read',
    extraAuthParams: { token_access_type: 'offline' },
    token: 'https://api.dropboxapi.com/oauth2/token',
  },
  gdrive: {
    clientId: env.VITE_GOOGLE_CLIENT_ID,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'https://www.googleapis.com/auth/drive.file',
    extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    token: 'broker',
    brokerName: 'google',
  },
  onedrive: {
    clientId: env.VITE_MS_CLIENT_ID,
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scope: 'offline_access User.Read Files.ReadWrite.AppFolder',
    extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
    token: 'broker',
    brokerName: 'microsoft',
  },
}

export const isConfigured = (p: CloudProvider) => !!PROVIDERS[p].clientId

/**
 * Cloud sign-in needs the pop-up to hand the result back to this page. The desktop and mobile
 * shells open outside links in the system browser, so there it can't (yet).
 */
export const cloudSupported = () => !isElectron() && !isNative()

const brokerUrl = () => env.VITE_OAUTH_BROKER || new URL('.netlify/functions/oauth-token', location.href).href
const redirectUri = () => new URL('oauth-callback.html', location.href).href
const tokenKey = (p: CloudProvider) => `oauth:${p}`

export class NeedsReconnect extends Error {
  constructor(public provider: CloudProvider) {
    super(`${provider} needs to be connected again`)
  }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge: b64url(digest) }
}

/** Waits for the callback page to hand back the query string (postMessage, or localStorage fallback). */
function waitForCallback(popup: Window, state: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const done = (search: string) => {
      const params = new URLSearchParams(search)
      if (params.get('state') !== state) return
      cleanup()
      resolve(params)
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === 'kasa-oauth') done(e.data.search)
    }
    // Installed apps on Android open sign-in in a browser tab without `opener`.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'kasa.oauth' || !e.newValue) return
      try {
        done(JSON.parse(e.newValue).search)
        localStorage.removeItem('kasa.oauth')
      } catch {
        /* ignore */
      }
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        // Give the storage fallback a moment before treating it as cancelled.
        setTimeout(() => {
          if (active) {
            cleanup()
            reject(new Error('cancelled'))
          }
        }, 800)
      }
    }, 500)
    let active = true
    const cleanup = () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)
  })
}

async function requestTokens(p: CloudProvider, body: Record<string, string>): Promise<Tokens> {
  const cfg = PROVIDERS[p]
  const res =
    cfg.token === 'broker'
      ? await fetch(brokerUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: cfg.brokerName, ...body }) })
      : await fetch(cfg.token, { method: 'POST', body: new URLSearchParams({ client_id: cfg.clientId!, ...body }) })
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') throw new NeedsReconnect(p)
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`)
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token ?? body.refresh_token, expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 }
}

/** Opens the provider's sign-in popup. Must be called from a click (popup blockers). */
export async function connect(p: CloudProvider): Promise<void> {
  const cfg = PROVIDERS[p]
  if (!cfg.clientId) throw new Error('not configured')
  const { verifier, challenge } = await pkce()
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)))
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: cfg.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...cfg.extraAuthParams,
  })
  const popup = window.open(`${cfg.authorizeUrl}?${params}`, 'kasa-oauth', 'popup,width=520,height=720')
  if (!popup) throw new Error('popup blocked')
  const result = await waitForCallback(popup, state)
  if (result.get('error')) throw new Error(result.get('error_description') || result.get('error')!)
  const code = result.get('code')
  if (!code) throw new Error('no code')
  const tokens = await requestTokens(p, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri() })
  await kvSet(tokenKey(p), tokens)
}

export async function disconnect(p: CloudProvider): Promise<void> {
  await kvDelete(tokenKey(p))
}

export async function isConnected(p: CloudProvider): Promise<boolean> {
  return !!(await kvGet<Tokens | null>(tokenKey(p), null))
}

/** A valid access token, refreshing it when it's about to expire. */
export async function accessToken(p: CloudProvider): Promise<string> {
  const tokens = await kvGet<Tokens | null>(tokenKey(p), null)
  if (!tokens) throw new NeedsReconnect(p)
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token
  if (!tokens.refresh_token) throw new NeedsReconnect(p)
  const fresh = await requestTokens(p, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
  await kvSet(tokenKey(p), fresh)
  return fresh.access_token
}
