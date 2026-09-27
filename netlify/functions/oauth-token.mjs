// Token broker for Kasa POS cloud backups (Netlify Function, free tier is plenty).
//
// Google and Microsoft only issue long-lived refresh tokens to OAuth clients that can keep a
// secret, which a browser app can't. This function holds the secrets and performs the two
// token requests on the app's behalf: exchanging a sign-in code, and refreshing an access
// token. It stores nothing. Dropbox doesn't need it (PKCE works directly from the browser).
//
// Environment variables (Netlify → Site configuration → Environment variables):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MS_CLIENT_ID, MS_CLIENT_SECRET
//   ALLOWED_ORIGINS (optional, comma-separated; defaults to the site's own URL)

const PROVIDERS = {
  google: {
    url: 'https://oauth2.googleapis.com/token',
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    id: () => process.env.MS_CLIENT_ID,
    secret: () => process.env.MS_CLIENT_SECRET,
    scope: 'offline_access User.Read Files.ReadWrite.AppFolder',
  },
}

function allowedOrigin(origin) {
  const list = (process.env.ALLOWED_ORIGINS || process.env.URL || '').split(',').map((s) => s.trim()).filter(Boolean)
  return origin && (list.length === 0 || list.includes(origin)) ? origin : list[0] || ''
}

export default async (req) => {
  const origin = req.headers.get('origin') || ''
  const cors = { 'Access-Control-Allow-Origin': allowedOrigin(origin), 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors })

  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: cors })
  }
  const p = PROVIDERS[body.provider]
  if (!p || !p.id() || !p.secret()) return Response.json({ error: 'not_configured' }, { status: 400, headers: cors })

  const form = new URLSearchParams({ client_id: p.id(), client_secret: p.secret(), grant_type: body.grant_type })
  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri || !body.code_verifier) return Response.json({ error: 'invalid_request' }, { status: 400, headers: cors })
    form.set('code', body.code)
    form.set('redirect_uri', body.redirect_uri)
    form.set('code_verifier', body.code_verifier)
  } else if (body.grant_type === 'refresh_token' && body.refresh_token) {
    form.set('refresh_token', body.refresh_token)
  } else {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400, headers: cors })
  }
  if (p.scope) form.set('scope', p.scope)

  const res = await fetch(p.url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form })
  return new Response(await res.text(), { status: res.status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
