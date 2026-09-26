import i18n from 'i18next'

const lng = () => i18n.language || 'en'

// Creating Intl formatters is slow (tables format hundreds of dates per render), so reuse them.
const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>()
function dtf(style: 'datetime' | 'date' | 'time'): Intl.DateTimeFormat {
  const key = `${style}|${lng()}`
  let f = cache.get(key) as Intl.DateTimeFormat | undefined
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = style === 'datetime' ? { dateStyle: 'medium', timeStyle: 'short' } : style === 'date' ? { dateStyle: 'medium' } : { timeStyle: 'short' }
    f = new Intl.DateTimeFormat(lng(), opts)
    cache.set(key, f)
  }
  return f
}

export function formatDateTime(ts: number): string {
  return dtf('datetime').format(ts)
}

export function formatDate(ts: number): string {
  return dtf('date').format(ts)
}

export function formatTime(ts: number): string {
  return dtf('time').format(ts)
}

export function startOfDay(ts = Date.now()): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ts = Date.now()): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function startOfMonth(ts = Date.now()): number {
  const d = new Date(ts)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** yyyy-mm-dd in local time, for <input type="date">. */
export function toDateInput(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromDateInput(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getTime()
}

export function relativeTime(ts: number): string {
  const diff = (ts - Date.now()) / 1000
  const key = `rel|${lng()}`
  let rtf = cache.get(key) as Intl.RelativeTimeFormat | undefined
  if (!rtf) cache.set(key, (rtf = new Intl.RelativeTimeFormat(lng(), { numeric: 'auto' })))
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}
