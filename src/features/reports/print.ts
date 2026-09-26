import i18n from 'i18next'
import type { Settings } from '@/core/types'
import { formatDateTime } from '@/lib/dates'
import { escapeHtml as e } from '@/lib/print'

// Printable A4 report documents (also "Save as PDF" from the print dialog).

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'reports', ...opts }) as string

export interface PrintSection {
  title?: string
  /** Label/value pairs rendered as a summary grid above the table. */
  kpis?: Array<[string, string]>
  head?: string[]
  /** Indexes of right-aligned (numeric) columns. */
  numeric?: number[]
  rows?: string[][]
  foot?: string[]
  note?: string
}

export function reportHtml({ title, subtitle, settings, sections }: { title: string; subtitle?: string; settings: Settings; sections: PrintSection[] }): string {
  const dir = i18n.dir()
  const body = sections
    .map((s) => {
      const num = new Set(s.numeric ?? [])
      const cls = (i: number) => (num.has(i) ? ' class="r"' : '')
      // Numbers keep their own direction in RTL documents (−₹130.00, not ₹130.00−).
      const cell = (i: number, c: string) => (num.has(i) ? `<bdi>${e(c)}</bdi>` : e(c))
      const kpis = s.kpis?.length
        ? `<div class="kpis">${s.kpis.map(([l, v]) => `<div class="kpi"><div class="m">${e(l)}</div><div class="v"><bdi>${e(v)}</bdi></div></div>`).join('')}</div>`
        : ''
      const table = s.head
        ? `<table><thead><tr>${s.head.map((h, i) => `<th${cls(i)}>${e(h)}</th>`).join('')}</tr></thead>
          <tbody>${(s.rows ?? []).map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${cell(i, c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.head.length}" class="m">${e(t('noData'))}</td></tr>`}</tbody>
          ${s.foot ? `<tfoot><tr>${s.foot.map((c, i) => `<td${cls(i)}>${cell(i, c)}</td>`).join('')}</tr></tfoot>` : ''}</table>`
        : ''
      return `<section>${s.title ? `<h2>${e(s.title)}</h2>` : ''}${kpis}${table}${s.note ? `<p class="m">${e(s.note)}</p>` : ''}</section>`
    })
    .join('')
  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(title)}</title><style>
  @page { size: A4; margin: 12mm }
  * { box-sizing: border-box }
  body { font: 11px/1.45 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #111; margin: 0 }
  header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px }
  h1 { font-size: 18px; margin: 0 } h2 { font-size: 13px; margin: 16px 0 6px } .m { color: #555 } .r { text-align: end; white-space: nowrap }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums }
  th { background: #f3f4f6; text-align: start; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #333 }
  th, td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0 }
  tr { break-inside: avoid }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px }
  .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px } .kpi .v { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums }
  footer { margin-top: 18px; color: #777; font-size: 10px }
</style></head><body>
  <header><div><div class="m">${e(settings.legalName || settings.businessName)}${settings.taxNumber ? ` · ${e(settings.taxLabel)}: ${e(settings.taxNumber)}` : ''}</div><h1>${e(title)}</h1></div>
  <div class="r">${subtitle ? `<div><b>${e(subtitle)}</b></div>` : ''}</div></header>
  ${body}
  <footer>${e(t('printedAt', { date: formatDateTime(Date.now()) }))}</footer>
</body></html>`
}
