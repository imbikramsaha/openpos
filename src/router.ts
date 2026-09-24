import { useMemo, useSyncExternalStore } from 'react'

// Minimal hash router. Hash URLs work identically in browsers, Electron (app://)
// and Capacitor, with no server rewrites needed.

export type RouteName = 'sell' | 'sales' | 'products' | 'inventory' | 'customers' | 'reports' | 'shifts' | 'users' | 'settings'

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '')
  return useMemo(() => {
    const raw = hash.replace(/^#\/?/, '')
    const [path, query] = raw.split('?')
    const [name, ...rest] = (path || 'sell').split('/')
    return { name: name as RouteName, sub: rest.join('/'), params: new URLSearchParams(query) }
  }, [hash])
}

export function navigate(path: string) {
  const target = '#/' + path.replace(/^\/+/, '')
  if (location.hash !== target) location.hash = target
}
