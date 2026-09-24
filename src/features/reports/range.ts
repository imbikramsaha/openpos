import i18n from 'i18next'
import { addDays, endOfDay, startOfDay, startOfMonth } from '@/lib/dates'

// Date ranges for reports: presets, the comparison period and time buckets for charts.
// All timestamps are local-time epoch milliseconds; `to` is inclusive.

export type PresetId = 'today' | 'yesterday' | 'thisWeek' | 'last7Days' | 'thisMonth' | 'lastMonth' | 'last30Days' | 'custom'

export const PRESETS: Exclude<PresetId, 'custom'>[] = ['today', 'yesterday', 'thisWeek', 'last7Days', 'thisMonth', 'lastMonth', 'last30Days']

export interface Range {
  preset: PresetId
  from: number
  to: number
}

export interface Period {
  from: number
  to: number
  /** Totals of the comparison period only count documents up to this moment ("same time last period"). */
  cutoff: number
}

export type Granularity = 'hour' | 'day' | 'month'

const DAY = 86_400_000

/** First day of the week for a locale (0 = Sunday … 6 = Saturday). */
export function weekStart(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    /* older engines */
  }
  return 1
}

export function presetRange(preset: PresetId, locale: string, now = Date.now()): Range {
  const today = startOfDay(now)
  switch (preset) {
    case 'yesterday': {
      const y = addDays(today, -1)
      return { preset, from: y, to: endOfDay(y) }
    }
    case 'thisWeek': {
      const back = (new Date(today).getDay() - weekStart(locale) + 7) % 7
      return { preset, from: addDays(today, -back), to: endOfDay(now) }
    }
    case 'last7Days':
      return { preset, from: addDays(today, -6), to: endOfDay(now) }
    case 'last30Days':
      return { preset, from: addDays(today, -29), to: endOfDay(now) }
    case 'thisMonth':
      return { preset, from: startOfMonth(now), to: endOfDay(now) }
    case 'lastMonth': {
      const start = startOfMonth(now)
      return { preset, from: startOfMonth(addDays(start, -1)), to: start - 1 }
    }
    default:
      return { preset: 'today', from: today, to: endOfDay(now) }
  }
}

export function customRange(from: number, to: number): Range {
  const a = startOfDay(Math.min(from, to))
  const b = endOfDay(Math.max(from, to))
  return { preset: 'custom', from: a, to: b }
}

/** Number of calendar days a range touches. */
export function dayCount(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY) + 1
}

/** The period a range is compared against, and how much of it counts for "same time" totals. */
export function previousPeriod(r: Range, now = Date.now()): Period {
  let from: number
  let to: number
  if (r.preset === 'thisMonth' || r.preset === 'lastMonth') {
    from = startOfMonth(addDays(r.from, -1))
    const monthEnd = r.from - 1
    to = r.preset === 'lastMonth' ? monthEnd : Math.min(endOfDay(addDays(from, dayCount(r.from, r.to) - 1)), monthEnd)
  } else {
    const days = dayCount(r.from, r.to)
    from = addDays(r.from, -days)
    to = r.from - 1
  }
  const elapsed = Math.min(now, r.to) - r.from
  return { from, to, cutoff: Math.min(to, from + Math.max(elapsed, 0)) }
}

export function granularityFor(from: number, to: number): Granularity {
  const days = dayCount(from, to)
  return days <= 1 ? 'hour' : days <= 92 ? 'day' : 'month'
}

/** Start timestamps of each chart bucket in [from, to]. */
export function bucketStarts(from: number, to: number, g: Granularity): number[] {
  const out: number[] = []
  if (g === 'hour') {
    const d = new Date(startOfDay(from))
    for (let h = 0; h < 24; h++) out.push(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime())
    return out
  }
  if (g === 'day') {
    for (let t = startOfDay(from); t <= to; t = addDays(t, 1)) out.push(t)
    return out
  }
  const d = new Date(startOfMonth(from))
  for (let t = d.getTime(); t <= to; ) {
    out.push(t)
    d.setMonth(d.getMonth() + 1)
    t = d.getTime()
  }
  return out
}

/** Index of the bucket containing `ts` (binary search over sorted starts), or -1. */
export function bucketIndex(starts: number[], ts: number): number {
  let lo = 0
  let hi = starts.length - 1
  if (hi < 0 || ts < starts[0]) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= ts) lo = mid
    else hi = mid - 1
  }
  return lo
}

const lng = () => i18n.language || 'en'
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function dtf(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = lng() + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(lng(), opts)
    fmtCache.set(key, f)
  }
  return f
}

/** Short axis label for a bucket. */
export function bucketLabel(ts: number, g: Granularity): string {
  if (g === 'hour') return dtf({ hour: 'numeric' }).format(ts)
  if (g === 'day') return dtf({ day: 'numeric', month: 'short' }).format(ts)
  return dtf({ month: 'short', year: '2-digit' }).format(ts)
}

/** Full label for tooltips and tables. */
export function bucketTitle(ts: number, g: Granularity): string {
  if (g === 'hour') {
    const f = dtf({ hour: 'numeric', minute: '2-digit' })
    return `${dtf({ day: 'numeric', month: 'short' }).format(ts)}, ${f.format(ts)} – ${f.format(ts + 3_600_000)}`
  }
  if (g === 'day') return dtf({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(ts)
  return dtf({ month: 'long', year: 'numeric' }).format(ts)
}

export function hourLabel(h: number): string {
  return dtf({ hour: 'numeric' }).format(new Date(2000, 0, 1, h))
}

export function hourRangeLabel(h: number): string {
  const f = dtf({ hour: 'numeric', minute: '2-digit' })
  return `${f.format(new Date(2000, 0, 1, h))} – ${f.format(new Date(2000, 0, 1, h + 1))}`
}

/** Weekday names ordered from the locale's first day of the week. Returns [dayIndex, label]. */
export function weekdays(locale: string, style: 'short' | 'long' = 'short'): Array<[number, string]> {
  const first = weekStart(locale)
  const f = dtf({ weekday: style })
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const day = (first + i) % 7
    return [day, f.format(new Date(2023, 0, 1 + day))] as [number, string]
  })
}

export function rangeLabel(from: number, to: number): string {
  const f = dtf({ day: 'numeric', month: 'short', year: 'numeric' })
  if (startOfDay(from) === startOfDay(to)) return f.format(from)
  try {
    return f.formatRange(from, to)
  } catch {
    return `${f.format(from)} – ${f.format(to)}`
  }
}
