import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownRight, ArrowUpRight, ChartColumn, Minus, Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, Card, CardHeader } from '@/components/ui'
import { pct } from './format'
import './viz.css'

// Lightweight, dependency-free SVG/HTML charts. Colours come from the validated
// tokens in viz.css (slot order is fixed; colour follows the entity, never its rank).
// Every chart has a hover/tap/keyboard layer and a table view; time axes mirror in RTL.

export const SLOTS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)']
export const ACCENT = SLOTS[0]
export const PREV = 'var(--viz-prev)'

// ---- Hooks & helpers -----------------------------------------------------------

export function useWidth<T extends HTMLElement>(): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

function useRtl(): boolean {
  const { i18n } = useTranslation()
  return i18n.dir(i18n.language) === 'rtl'
}

/** Touch users tap to inspect; the readout stays until they tap elsewhere. */
function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, clear: () => void) {
  useEffect(() => {
    if (!active) return
    const onDown = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) clear()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [active, clear, ref])
}

let measureCtx: CanvasRenderingContext2D | null | undefined
export function textWidth(s: string, font = '11px system-ui, sans-serif'): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return s.length * 6.5
  measureCtx.font = font
  return measureCtx.measureText(s).width
}

export function niceScale(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  const lo0 = Math.min(0, min)
  const hi0 = Math.max(0, max)
  const span = hi0 - lo0 || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(lo0 / step) * step
  const hi = Math.max(Math.ceil(hi0 / step) * step, lo + step)
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return { lo, hi, ticks }
}

/** Every k-th label so axis text never collides. */
function labelStep(n: number, plotW: number, sample: string): number {
  const room = Math.max(40, textWidth(sample) + 14)
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / room))))
}

// ---- Tooltip & legend ------------------------------------------------------------

export interface TipRow {
  color?: string
  value: string
  label?: string
  kind?: 'line' | 'rect'
  muted?: boolean
}

function ChartTooltip({ x, width, top, title, rows, footer }: { x: number; width: number; top: number; title: string; rows: TipRow[]; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(x)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    let l = x + 14
    if (l + w > width - 2) l = x - 14 - w
    if (l < 2) l = Math.max(2, Math.min(width - w - 2, x - w / 2))
    setLeft(l)
  })
  return (
    <div ref={ref} className="pointer-events-none absolute z-10 max-w-[240px] rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-pop" style={{ left, top }}>
      <div className="mb-1 font-medium text-muted">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          {r.color && (r.kind === 'rect' ? <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.color }} /> : <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />)}
          <bdi className={cn('tnum font-semibold whitespace-nowrap', r.muted ? 'text-muted' : 'text-sm text-fg')}>{r.value}</bdi>
          {r.label && <span className="truncate text-muted">{r.label}</span>}
        </div>
      ))}
      {footer && <div className="mt-1 border-t border-border pt-1">{footer}</div>}
    </div>
  )
}

export function Legend({ items, className }: { items: Array<{ label: string; color: string; kind?: 'line' | 'rect' }>; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted', className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.kind === 'line' ? <span className="h-0.5 w-4 rounded-full" style={{ background: i.color }} /> : <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />}
          {i.label}
        </li>
      ))}
    </ul>
  )
}

// ---- Delta & KPI tiles -------------------------------------------------------------

export type Good = 'up' | 'down' | 'none'

export function changePct(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

export function DeltaBadge({ cur, prev, good = 'up', className }: { cur: number; prev: number; good?: Good; className?: string }) {
  const { t } = useTranslation('reports')
  const change = changePct(cur, prev)
  if (change === null) return <span className={cn('text-xs font-medium text-subtle', className)}>{cur ? t('new') : '—'}</span>
  const dir = Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down'
  const tone = good === 'none' || dir === 'flat' ? 'text-muted' : dir === good ? 'text-success' : 'text-danger'
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus
  return (
    <span className={cn('tnum inline-flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap', tone, className)} title={t('comparedToPrevious')}>
      <Icon className="size-3.5 rtl:-scale-x-100" aria-hidden />
      <span className="sr-only">{dir === 'up' ? t('increase') : dir === 'down' ? t('decrease') : t('noChange')}</span>
      <bdi>{dir === 'flat' ? pct(0) : `${change > 0 ? '+' : '−'}${pct(Math.abs(change))}`}</bdi>
    </span>
  )
}

export function KpiTile({ label, value, title, cur, prev, prevDisplay, good = 'up', sub, hero, spark, className }: {
  label: ReactNode
  value: ReactNode
  title?: string
  cur?: number
  prev?: number
  prevDisplay?: string
  good?: Good
  sub?: ReactNode
  hero?: boolean
  spark?: ReactNode
  className?: string
}) {
  const { t } = useTranslation('reports')
  return (
    <Card className={cn('kviz flex min-w-0 flex-col p-4', hero && 'sm:p-5', className)}>
      <div className="truncate text-sm font-medium text-muted">{label}</div>
      <div className={cn('mt-1 truncate font-semibold tracking-tight', hero ? 'text-[2rem] leading-tight sm:text-5xl' : 'text-2xl')} title={title}>
        <bdi>{value}</bdi>
      </div>
      {cur !== undefined && prev !== undefined && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <DeltaBadge cur={cur} prev={prev} good={good} />
          {prevDisplay !== undefined && <span className="truncate text-subtle">{t('vsValue', { value: prevDisplay })}</span>}
        </div>
      )}
      {sub && <div className={cn('text-xs text-muted [overflow-wrap:anywhere]', cur !== undefined ? 'mt-0.5' : 'mt-1.5')}>{sub}</div>}
      {spark && <div className="mt-auto pt-3">{spark}</div>}
    </Card>
  )
}

// ---- Chart card with table view ------------------------------------------------------

export interface MiniTable {
  head: string[]
  rows: Array<Array<ReactNode>>
  /** Columns aligned to the end (numbers). */
  numeric?: number[]
}

export function ChartCard({ title, subtitle, actions, table, children, className, bodyClassName }: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  table?: MiniTable
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const { t } = useTranslation('reports')
  const [asTable, setAsTable] = useState(false)
  return (
    <Card className={cn('kviz flex min-w-0 flex-col', className)}>
      <CardHeader
        title={title}
        subtitle={subtitle}
        className="flex-wrap [&>div:first-child]:min-w-40"
        actions={
          (actions || table) && (
            <div className="flex items-center gap-1.5">
              {actions}
              {table && (
                <Button size="icon-sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} aria-label={asTable ? t('chartView') : t('tableView')} title={asTable ? t('chartView') : t('tableView')}>
                  {asTable ? <ChartColumn className="size-4" /> : <Table2 className="size-4" />}
                </Button>
              )}
            </div>
          )
        }
      />
      <div className={cn('min-w-0 flex-1 p-4 sm:p-5', bodyClassName)}>{asTable && table ? <SimpleTable {...table} /> : children}</div>
    </Card>
  )
}

export function SimpleTable({ head, rows, numeric = [] }: MiniTable) {
  const isNum = (i: number) => numeric.includes(i)
  return (
    <div className="max-h-80 overflow-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-xs font-semibold text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn('px-3 py-2 whitespace-nowrap', isNum(i) ? 'text-end' : 'text-start')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) => (
                <td key={i} className={cn('px-3 py-1.5', isNum(i) ? 'tnum text-end whitespace-nowrap' : 'text-start')}>
                  {isNum(i) ? <bdi>{c}</bdi> : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Line chart (trend with comparison) ------------------------------------------------

export interface LinePoint {
  label: string
  title: string
  cur: number | null
  prev?: number | null
  prevTitle?: string
}

export function LineChart({ points, format, axis, height = 240, curLabel, prevLabel, ariaLabel }: {
  points: LinePoint[]
  format: (v: number) => string
  axis: (v: number) => string
  height?: number
  curLabel: string
  prevLabel?: string
  ariaLabel: string
}) {
  const { t } = useTranslation('reports')
  const { ref, width } = useWidth<HTMLDivElement>()
  const rtl = useRtl()
  const [active, setActive] = useState<number | null>(null)
  const [kbd, setKbd] = useState(false)
  const clear = useMemo(() => () => setActive(null), [])
  useDismiss(ref, active !== null, clear)

  const n = points.length
  const hasPrev = points.some((p) => p.prev !== null && p.prev !== undefined)
  const scale = useMemo(() => {
    let lo = 0
    let hi = 0
    for (const p of points) {
      for (const v of [p.cur, p.prev]) {
        if (v === null || v === undefined) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    return niceScale(lo, hi)
  }, [points])
  const tickText = scale.ticks.map(axis)
  const axisW = Math.ceil(Math.max(0, ...tickText.map((s) => textWidth(s)))) + 12
  const m = { top: 12, bottom: 26, s: axisW, e: 20 }
  const plotW = Math.max(1, width - m.s - m.e)
  const plotH = height - m.top - m.bottom
  const xRaw = (i: number) => m.s + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const x = (i: number) => (rtl ? width - xRaw(i) : xRaw(i))
  const y = (v: number) => m.top + ((scale.hi - v) / (scale.hi - scale.lo || 1)) * plotH
  const y0 = y(0)

  const paths = (vals: Array<number | null | undefined>) => {
    let line = ''
    let area = ''
    let seg: Array<[number, number]> = []
    const flush = () => {
      if (seg.length > 1) {
        line += seg.map(([px, py], k) => `${k ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
        area += `M${seg[0][0].toFixed(1)},${y0}` + seg.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('') + `L${seg[seg.length - 1][0].toFixed(1)},${y0}Z`
      }
      seg = []
    }
    vals.forEach((v, i) => {
      if (v === null || v === undefined) flush()
      else seg.push([x(i), y(v)])
    })
    flush()
    return { line, area }
  }

  const cur = width ? paths(points.map((p) => p.cur)) : { line: '', area: '' }
  const prev = width && hasPrev ? paths(points.map((p) => p.prev)) : { line: '', area: '' }
  let lastCur = -1
  points.forEach((p, i) => p.cur !== null && (lastCur = i))
  const step = labelStep(n, plotW, points[0]?.label ?? '')

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    let px = e.clientX - box.left
    if (rtl) px = width - px
    const i = n <= 1 ? 0 : Math.round(((px - m.s) / plotW) * (n - 1))
    setKbd(false)
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const onKey = (e: KeyboardEvent) => {
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const at = active ?? (lastCur >= 0 ? lastCur : 0)
    let next: number | null = at
    if (e.key === fwd) next = Math.min(n - 1, at + (active === null ? 0 : 1))
    else if (e.key === back) next = Math.max(0, at - (active === null ? 0 : 1))
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setKbd(true)
    setActive(next)
  }

  const a = active !== null ? points[active] : null
  const tipRows: TipRow[] = []
  if (a) {
    tipRows.push({ color: ACCENT, value: a.cur === null ? '—' : format(a.cur), label: curLabel })
    if (hasPrev) tipRows.push({ color: PREV, value: a.prev === null || a.prev === undefined ? '—' : format(a.prev), label: a.prevTitle ?? prevLabel, muted: true })
  }
  const change = a && hasPrev && a.cur !== null && a.prev ? changePct(a.cur, a.prev) : null

  return (
    <div className="kviz">
      {hasPrev && prevLabel && (
        <Legend
          className="mb-3"
          items={[
            { label: curLabel, color: ACCENT, kind: 'line' },
            { label: prevLabel, color: PREV, kind: 'line' },
          ]}
        />
      )}
      <div
        ref={ref}
        className="relative touch-pan-y outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] rounded-lg"
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        onBlur={() => kbd && setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" style={{ direction: 'ltr' }} onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)} aria-hidden>
            {scale.ticks.map((v, i) => (
              <g key={v}>
                <line x1={rtl ? m.e : m.s} x2={rtl ? width - m.s : width - m.e} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={rtl ? width - m.s + 8 : m.s - 8} y={y(v)} dy="0.32em" textAnchor={rtl ? 'start' : 'end'} fontSize={11} fill="var(--viz-label)">
                  {tickText[i]}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              i % step === 0 ? (
                <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--viz-label)">
                  {p.label}
                </text>
              ) : null,
            )}
            {prev.line && <path d={prev.line} fill="none" stroke={PREV} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-mark />}
            {cur.area && <path d={cur.area} fill={ACCENT} fillOpacity={0.1} stroke="none" />}
            {cur.line && <path d={cur.line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" data-mark />}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={m.top} y2={m.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} shapeRendering="crispEdges" />}
            {active !== null && hasPrev && a?.prev !== null && a?.prev !== undefined && (
              <circle cx={x(active)} cy={y(a.prev)} r={4} fill={PREV} stroke="var(--viz-surface)" strokeWidth={2} />
            )}
            {(active !== null ? a?.cur !== null && a?.cur !== undefined : lastCur >= 0) && (
              <circle cx={x(active ?? lastCur)} cy={y((active !== null ? a!.cur : points[lastCur].cur) ?? 0)} r={4.5} fill={ACCENT} stroke="var(--viz-surface)" strokeWidth={2} />
            )}
            <rect x={0} y={0} width={width} height={height} fill="transparent" />
          </svg>
        )}
        {a && active !== null && (
          <ChartTooltip
            x={x(active)}
            width={width}
            top={m.top}
            title={a.title}
            rows={tipRows}
            footer={change !== null ? <span className={cn('tnum font-semibold', change >= 0 ? 'text-success' : 'text-danger')}>{`${change >= 0 ? '+' : '−'}${pct(Math.abs(change))}`} <span className="font-normal text-muted">{t('vsPrevious')}</span></span> : undefined}
          />
        )}
        {kbd && a && (
          <span className="sr-only" aria-live="polite">
            {`${a.title}: ${tipRows.map((r) => `${r.label ?? ''} ${r.value}`).join(', ')}`}
          </span>
        )}
        {!width && <div style={{ height }} />}
      </div>
    </div>
  )
}

// ---- Column chart (single or stacked) ----------------------------------------------

export interface ColumnDatum {
  label: string
  title: string
  values: number[]
  /** Extra line in the tooltip, e.g. transaction count. */
  note?: string
}

export interface SeriesDef {
  key: string
  label: string
  color: string
}

function barPath(x: number, top: number, w: number, h: number, r: number, end: 'top' | 'bottom' | 'none'): string {
  if (end === 'none' || r <= 0) return `M${x},${top}h${w}v${h}h${-w}Z`
  if (end === 'top') return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`
  return `M${x},${top}H${x + w}V${top + h - r}Q${x + w},${top + h} ${x + w - r},${top + h}H${x + r}Q${x},${top + h} ${x},${top + h - r}Z`
}

export function ColumnChart({ data, series, format, axis, height = 220, ariaLabel, totalLabel, peakLabel = true }: {
  data: ColumnDatum[]
  series: SeriesDef[]
  format: (v: number) => string
  axis: (v: number) => string
  height?: number
  ariaLabel: string
  totalLabel?: string
  peakLabel?: boolean
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const rtl = useRtl()
  const [active, setActive] = useState<number | null>(null)
  const [kbd, setKbd] = useState(false)
  const clear = useMemo(() => () => setActive(null), [])
  useDismiss(ref, active !== null, clear)

  const n = data.length
  const sums = useMemo(
    () =>
      data.map((d) => {
        let up = 0
        let down = 0
        for (const v of d.values) v > 0 ? (up += v) : (down += v)
        return { up, down }
      }),
    [data],
  )
  const scale = useMemo(() => niceScale(Math.min(0, ...sums.map((s) => s.down)), Math.max(0, ...sums.map((s) => s.up))), [sums])
  const tickText = scale.ticks.map(axis)
  const axisW = Math.ceil(Math.max(0, ...tickText.map((s) => textWidth(s)))) + 12
  const m = { top: 18, bottom: 26, s: axisW, e: 8 }
  const plotW = Math.max(1, width - m.s - m.e)
  const plotH = height - m.top - m.bottom
  const band = plotW / Math.max(1, n)
  const barW = Math.max(2, Math.min(24, band * 0.64, band - 2))
  const cx = (i: number) => {
    const px = m.s + band * (i + 0.5)
    return rtl ? width - px : px
  }
  const y = (v: number) => m.top + ((scale.hi - v) / (scale.hi - scale.lo || 1)) * plotH
  const step = labelStep(n, plotW, data[0]?.label ?? '')
  const peak = peakLabel && series.length === 1 && n > 1 ? sums.reduce((best, s, i) => (s.up > sums[best].up ? i : best), 0) : -1

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    let px = e.clientX - box.left
    if (rtl) px = width - px
    const i = Math.floor((px - m.s) / band)
    setKbd(false)
    setActive(i >= 0 && i < n ? i : null)
  }
  const onKey = (e: KeyboardEvent) => {
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
    const back = rtl ? 'ArrowRight' : 'ArrowLeft'
    let next: number | null = active
    if (e.key === fwd) next = active === null ? 0 : Math.min(n - 1, active + 1)
    else if (e.key === back) next = active === null ? n - 1 : Math.max(0, active - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') next = null
    else return
    e.preventDefault()
    setKbd(true)
    setActive(next)
  }

  const bars: ReactNode[] = []
  if (width) {
    data.forEach((d, i) => {
      const lastUp = d.values.reduce((acc, v, k) => (v > 0 ? k : acc), -1)
      const lastDown = d.values.reduce((acc, v, k) => (v < 0 ? k : acc), -1)
      let up = 0
      let down = 0
      let firstUp = true
      let firstDown = true
      const x0 = cx(i) - barW / 2
      d.values.forEach((v, k) => {
        if (!v) return
        let a: number
        let b: number
        let first: boolean
        if (v > 0) {
          a = up
          b = up + v
          up = b
          first = firstUp
          firstUp = false
        } else {
          a = down
          b = down + v
          down = b
          first = firstDown
          firstDown = false
        }
        const outer = v > 0 ? k === lastUp : k === lastDown
        const hi = Math.max(a, b)
        const lo = Math.min(a, b)
        // 2px surface gap between stacked segments.
        let top = y(hi) + (v > 0 ? (outer ? 0 : 1) : first ? 0 : 1)
        let bottom = y(lo) - (v > 0 ? (first ? 0 : 1) : outer ? 0 : 1)
        if (bottom - top < 0.5) {
          top = Math.min(top, bottom)
          bottom = top + 0.5
        }
        const h = bottom - top
        const r = outer ? Math.min(4, barW / 2, h) : 0
        bars.push(
          <path key={`${i}-${k}`} d={barPath(x0, top, barW, h, r, outer ? (v > 0 ? 'top' : 'bottom') : 'none')} fill={series[k]?.color ?? ACCENT} data-mark opacity={active !== null && active !== i ? 0.55 : 1} />,
        )
      })
    })
  }

  const a = active !== null ? data[active] : null
  const tipRows: TipRow[] = a
    ? series.length === 1
      ? [{ color: series[0].color, kind: 'rect', value: format(a.values[0] ?? 0), label: series[0].label }]
      : series.map((s, k) => ({ s, v: a.values[k] ?? 0 })).filter((r) => r.v !== 0).map(({ s, v }) => ({ color: s.color, kind: 'rect' as const, value: format(v), label: s.label }))
    : []
  if (a && series.length > 1) tipRows.push({ value: format(a.values.reduce((x, v) => x + v, 0)), label: totalLabel, muted: true })

  return (
    <div className="kviz">
      {series.length > 1 && <Legend className="mb-3" items={series.map((s) => ({ label: s.label, color: s.color, kind: 'rect' }))} />}
      <div
        ref={ref}
        className="relative touch-pan-y rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        tabIndex={0}
        role="group"
        aria-label={ariaLabel}
        onKeyDown={onKey}
        onBlur={() => kbd && setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" style={{ direction: 'ltr' }} onPointerMove={pick} onPointerDown={pick} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)} aria-hidden>
            {active !== null && <rect x={cx(active) - band / 2} y={m.top} width={band} height={plotH} fill="var(--viz-grid)" opacity={0.55} rx={4} />}
            {scale.ticks.map((v, i) => (
              <g key={v}>
                <line x1={rtl ? m.e : m.s} x2={rtl ? width - m.s : width - m.e} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} shapeRendering="crispEdges" />
                <text x={rtl ? width - m.s + 8 : m.s - 8} y={y(v)} dy="0.32em" textAnchor={rtl ? 'start' : 'end'} fontSize={11} fill="var(--viz-label)">
                  {tickText[i]}
                </text>
              </g>
            ))}
            {bars}
            {peak >= 0 && sums[peak].up > 0 && active === null && (
              <text x={cx(peak)} y={y(sums[peak].up) - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--muted)">
                {axis(sums[peak].up)}
              </text>
            )}
            {data.map((d, i) =>
              i % step === 0 ? (
                <text key={i} x={cx(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--viz-label)">
                  {d.label}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {a && active !== null && <ChartTooltip x={cx(active)} width={width} top={m.top} title={a.title} rows={tipRows} footer={a.note ? <span className="text-muted">{a.note}</span> : undefined} />}
        {kbd && a && (
          <span className="sr-only" aria-live="polite">
            {`${a.title}: ${tipRows.map((r) => `${r.label ?? ''} ${r.value}`).join(', ')}`}
          </span>
        )}
        {!width && <div style={{ height }} />}
      </div>
    </div>
  )
}

// ---- Horizontal bar list (ranked nominal categories, single hue) -----------------------

export interface BarRow {
  key: string
  label: ReactNode
  value: number
  display: string
  sub?: string
  title?: string
}

export function BarList({ rows, color = ACCENT, className }: { rows: BarRow[]; color?: string; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <ul className={cn('kviz space-y-3.5', className)}>
      {rows.map((r) => (
        <li key={r.key} className="group">
          <div className="flex items-baseline gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate" title={r.title}>
              {r.label}
            </span>
            {r.sub && <span className="tnum shrink-0 text-xs text-muted">{r.sub}</span>}
            <bdi className="tnum shrink-0 font-semibold">{r.display}</bdi>
          </div>
          <div className="mt-1.5 h-2 w-full">
            <div
              data-mark
              className="h-full rounded-e-[4px] transition-[width,filter] duration-300 group-hover:brightness-110"
              style={{ width: `${Math.max(0.6, (Math.abs(r.value) / max) * 100)}%`, background: color, opacity: r.value < 0 ? 0.45 : 1 }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---- Part-to-whole bar with legend rows ---------------------------------------------------

export interface ShareItem {
  key: string
  label: string
  value: number
  color: string
  display: string
  sub?: string
}

export function ShareBar({ items, ariaLabel }: { items: ShareItem[]; ariaLabel: string }) {
  const [active, setActive] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const clear = useMemo(() => () => setActive(null), [])
  useDismiss(ref, active !== null, clear)
  const positive = items.filter((i) => i.value > 0)
  const total = positive.reduce((a, i) => a + i.value, 0)
  const enter = (key: string) => () => setActive(key)
  const leave = (e: PointerEvent) => e.pointerType === 'mouse' && setActive(null)
  return (
    <div ref={ref} className="kviz">
      <div className="flex h-4 w-full gap-[2px]" role="img" aria-label={ariaLabel}>
        {positive.map((i) => (
          <div
            key={i.key}
            data-mark
            className={cn('h-full transition-opacity first:rounded-s-[4px] last:rounded-e-[4px]', active && active !== i.key && 'opacity-40')}
            style={{ flex: `${i.value} 1 0%`, minWidth: 3, background: i.color }}
            onPointerEnter={enter(i.key)}
            onPointerDown={enter(i.key)}
            onPointerLeave={leave}
          />
        ))}
        {!positive.length && <div className="h-full flex-1 rounded-[4px] bg-surface-3" />}
      </div>
      <ul className="mt-3 divide-y divide-border">
        {items.map((i) => (
          <li
            key={i.key}
            className={cn('-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors', active === i.key && 'bg-surface-2')}
            onPointerEnter={enter(i.key)}
            onPointerDown={enter(i.key)}
            onPointerLeave={leave}
          >
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} />
            <span className="min-w-0 flex-1 truncate">{i.label}</span>
            {i.sub && <span className="tnum hidden shrink-0 text-xs text-muted sm:inline">{i.sub}</span>}
            <span className="tnum w-14 shrink-0 text-end text-xs text-muted">{i.value > 0 && total ? pct((i.value / total) * 100) : '—'}</span>
            <bdi className="tnum shrink-0 text-end font-semibold">{i.display}</bdi>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- Heatmap (weekday × hour, sequential single hue) -----------------------------------------

export interface HeatRow {
  label: string
  title: string
  values: number[]
  counts: number[]
}

export function Heatmap({ rows, cols, colTitles, format, countLabel, lessLabel, moreLabel, ariaLabel }: {
  rows: HeatRow[]
  cols: string[]
  colTitles: string[]
  format: (v: number) => string
  countLabel: (n: number) => string
  lessLabel: string
  moreLabel: string
  ariaLabel: string
}) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const rtl = useRtl()
  const [active, setActive] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  const clear = useMemo(() => () => setActive(null), [])
  useDismiss(ref, active !== null, clear)
  const max = Math.max(0, ...rows.flatMap((r) => r.values))
  const fill = (v: number) => (v <= 0 || !max ? 'var(--viz-zero)' : `color-mix(in oklab, var(--viz-1) ${Math.round(14 + 86 * Math.sqrt(v / max))}%, var(--viz-surface))`)
  const every = width && width / Math.max(1, cols.length) < 26 ? 3 : 2
  const show = (r: number, c: number) => (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect()
    const cell = e.currentTarget.getBoundingClientRect()
    if (!box) return
    setActive({ r, c, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top })
  }
  const a = active ? rows[active.r] : null
  return (
    <div className="kviz">
      <div ref={ref} className="relative" role="img" aria-label={ariaLabel}>
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `auto repeat(${cols.length}, minmax(0, 1fr))` }}>
          {rows.map((row, r) => [
            <div key={`l${r}`} className="flex items-center pe-2 text-xs text-muted">
              {row.label}
            </div>,
            ...row.values.map((v, c) => (
              <div
                key={`${r}-${c}`}
                data-mark
                className={cn('h-6 rounded-[3px] transition-[outline]', active?.r === r && active?.c === c && 'outline-2 outline-offset-1 outline-[var(--fg)]')}
                style={{ background: fill(v) }}
                onPointerEnter={show(r, c)}
                onPointerDown={show(r, c)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
              />
            )),
          ])}
          <div />
          {cols.map((c, i) => (
            <div key={i} className="pt-1 text-center text-[10px] text-subtle">
              {i % every === 0 ? c : ''}
            </div>
          ))}
        </div>
        {a && active && (
          <ChartTooltip
            x={active.x}
            width={width}
            top={Math.max(0, active.y - 64)}
            title={`${a.title}, ${colTitles[active.c]}`}
            rows={[{ value: format(a.values[active.c]), color: fill(a.values[active.c]), kind: 'rect' }, { value: countLabel(a.counts[active.c]), muted: true }]}
          />
        )}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
        <span>{lessLabel}</span>
        <span className="h-2.5 w-28 rounded-[3px]" style={{ background: `linear-gradient(to ${rtl ? 'left' : 'right'}, var(--viz-zero), color-mix(in oklab, var(--viz-1) 30%, var(--viz-surface)), var(--viz-1))` }} />
        <span>{moreLabel}</span>
        {max > 0 && <span className="tnum text-subtle">({format(max)})</span>}
      </div>
    </div>
  )
}

// ---- Sparkline -------------------------------------------------------------------------------

export function Sparkline({ values, height = 40 }: { values: Array<number | null>; height?: number }) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const rtl = useRtl()
  const nums = values.filter((v): v is number => v !== null)
  const lo = Math.min(0, ...nums)
  const hi = Math.max(0, ...nums) || 1
  const n = values.length
  const x = (i: number) => {
    const px = 2 + (n <= 1 ? 0 : (i / (n - 1)) * (width - 6))
    return rtl ? width - px : px
  }
  const y = (v: number) => 3 + ((hi - v) / (hi - lo || 1)) * (height - 6)
  const pts = values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const))).filter((p): p is readonly [number, number] => p !== null)
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const last = pts[pts.length - 1]
  const show = width > 0 && pts.length > 1 && nums.some((v) => v !== 0)
  return (
    <div ref={ref} className="kviz" aria-hidden>
      {show && (
        <svg width={width} height={height} className="block overflow-visible">
          <path d={`${line}L${last[0]},${y(0)}L${pts[0][0]},${y(0)}Z`} fill={ACCENT} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last[0]} cy={last[1]} r={3.5} fill={ACCENT} stroke="var(--viz-surface)" strokeWidth={2} />
        </svg>
      )}
      {!show && <div style={{ height }} />}
    </div>
  )
}
