import i18n from 'i18next'
import type { CashMovement, Settings } from '@/core/types'
import { formatDateTime, formatTime } from '@/lib/dates'
import { formatMoney, formatPercent } from '@/lib/money'
import { escapeHtml as e, printHtml } from '@/lib/print'
import { methodOrder } from '@/features/reports/context'
import { shiftTerminal, type ShiftRecord, type ShiftSummary } from './service'

// X (interim, shift still open) and Z (end of shift) reports, on thermal paper
// (58/80 mm, like receipts) or A4 per settings.receipt.paperWidth.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'shifts', ...opts }) as string
const method = (m: string) => i18n.t(`common:payment.${m}`) as string

type Row = [label: string, value: string, cls?: string]

function sections(shift: ShiftRecord, sum: ShiftSummary, moves: CashMovement[], s: Settings) {
  const closed = shift.status === 'closed'
  const info: Row[] = [
    [t('report.terminal'), shiftTerminal(shift)],
    [t('report.shift'), shift.number, 'b'],
    [t('report.opened'), formatDateTime(shift.openedAt)],
    [t('report.openedBy'), shift.userName],
  ]
  if (closed && shift.closedAt) {
    info.push([t('report.closed'), formatDateTime(shift.closedAt)])
    if (shift.closedByName) info.push([t('report.closedBy'), shift.closedByName])
  } else info.push([t('report.printedAt'), formatDateTime(Date.now())])

  const sales: Row[] = [
    [t('report.sales', { count: sum.salesCount }), formatMoney(sum.grossSales)],
    [t('report.refunds', { count: sum.refundsCount }), formatMoney(sum.refunds)],
    [t('report.netSales'), formatMoney(sum.netSales), 'b'],
    [t('report.discounts'), formatMoney(sum.discounts), 'm'],
  ]
  if (sum.rounding) sales.push([t('report.rounding'), formatMoney(sum.rounding), 'm'])
  sales.push([t('report.voids', { count: sum.voids }), formatMoney(sum.voidsAmount ?? 0), 'm'])

  const tax: Row[] = []
  if (s.gstMode && sum.gst?.length) for (const g of sum.gst) tax.push([`${g.label} ${formatPercent(g.rate)}`, formatMoney(g.tax), 'm'])
  else for (const b of sum.taxBreakdown ?? []) if (b.rate) tax.push([b.name || `${t('report.tax')} ${formatPercent(b.rate)}`, formatMoney(b.tax), 'm'])
  tax.push([t('report.totalTax'), formatMoney(sum.tax)])
  if (sum.netExTax !== undefined) tax.push([t('report.netExTax'), formatMoney(sum.netExTax)])

  // The shop's payment method order (cash first), like the screen, not the order methods were first used.
  const order: string[] = methodOrder(s)
  const pays: Row[] = Object.entries(sum.byMethod)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([m, v]) => [`${method(m)}${sum.countByMethod?.[m] ? ` (${sum.countByMethod[m]})` : ''}`, formatMoney(v)] as Row)

  const cash: Row[] = [
    [t('report.float'), formatMoney(sum.openingFloat)],
    [t('report.cashSales'), formatMoney(sum.cashSales)],
    [t('report.cashIn'), formatMoney(sum.cashIn)],
    [t('report.cashOut'), formatMoney(sum.cashOut)],
    [t('report.customerPayments'), formatMoney(sum.customerPaymentsCash)],
    [t('report.expected'), formatMoney(closed ? shift.expectedCash ?? sum.expectedCash : sum.expectedCash), 'b'],
  ]
  if (closed && shift.countedCash !== undefined) {
    cash.push([t('report.counted'), formatMoney(shift.countedCash), 'b'])
    const diff = shift.difference ?? 0
    cash.push([diff > 0 ? t('report.over') : diff < 0 ? t('report.short') : t('report.difference'), formatMoney(diff, { sign: true }), 'b'])
  }
  const mv: Row[] = moves.map((m) => [[`${formatTime(m.createdAt)} ${m.type === 'in' ? t('report.in') : t('report.out')}`, m.reason?.trim()].filter(Boolean).join(' · '), formatMoney(m.type === 'in' ? m.amount : -m.amount), 'm'])
  return { info, sales, tax, pays, cash, mv }
}

export function shiftReportHtml(shift: ShiftRecord, sum: ShiftSummary, moves: CashMovement[], s: Settings): string {
  const kind = shift.status === 'closed' ? t('report.z') : t('report.x')
  const parts = sections(shift, sum, moves, s)
  const dir = i18n.dir()
  const table = (rows: Row[]) => `<table>${rows.map(([l, v, c]) => `<tr class="${c ?? ''}"><td>${e(l)}</td><td class="r"><bdi>${e(v)}</bdi></td></tr>`).join('')}</table>`
  const block = (title: string, rows: Row[]) => (rows.length ? `<h2>${e(title)}</h2>${table(rows)}` : '')
  const blocks = [
    table(parts.info),
    block(t('report.salesTitle'), parts.sales),
    block(t('report.taxTitle'), parts.tax),
    block(t('report.paymentsTitle'), parts.pays),
    block(t('report.cashTitle'), parts.cash),
    block(t('report.movementsTitle'), parts.mv),
    shift.notes ? `<h2>${e(t('report.notes'))}</h2><div class="m" style="white-space:pre-line">${e(shift.notes)}</div>` : '',
  ].filter(Boolean)
  const body = blocks.join('')

  if (s.receipt.paperWidth === 'a4') {
    return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(kind)} ${e(shift.number)}</title><style>
  @page { size: A4; margin: 14mm }
  body { font: 12px/1.5 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #111; margin: 0 }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 8px }
  h1 { font-size: 20px; margin: 0 } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 4px; color: #444 }
  .grid { columns: 2; column-gap: 28px } .grid > section { break-inside: avoid } .grid h2:first-child { margin-top: 0 }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums } td { padding: 3px 0; border-bottom: 1px solid #eee }
  .r { text-align: end; white-space: nowrap } .b td { font-weight: 700 } .m td { color: #444 }
</style></head><body>
  <header><div><div>${e(s.legalName || s.businessName)}</div><h1>${e(kind)}</h1></div><div class="r">${e(shift.number)}</div></header>
  <div class="grid">${blocks.map((b) => `<section>${b}</section>`).join('')}</div>
</body></html>`
  }
  const width = s.receipt.paperWidth === 58 ? 58 : 80
  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(kind)} ${e(shift.number)}</title><style>
  @page { size: ${width}mm auto; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; padding: 3mm ${width === 58 ? 2 : 4}mm; width: ${width}mm; font: 12px/1.35 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #000; background: #fff }
  .c { text-align: center } .r { text-align: end; white-space: nowrap; vertical-align: bottom }
  h1 { font-size: 16px; margin: 0 0 2px } h2 { font-size: 12px; margin: 8px 0 2px; padding-top: 6px; border-top: 1px dashed #000; letter-spacing: .04em; text-transform: uppercase }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums } td { padding: 1px 0; vertical-align: top }
  .b td { font-weight: 700 } .m td, .m { color: #333; font-size: 11px }
  .title { letter-spacing: .08em; font-weight: 800; font-size: 14px; margin: 6px 0; padding: 4px 0; border-top: 1px solid #000; border-bottom: 1px solid #000 }
</style></head><body>
  <div class="c"><h1>${e(s.businessName)}</h1>
  ${s.address ? `<div class="m">${e(s.address)}</div>` : ''}
  ${s.taxNumber ? `<div class="m">${e(s.taxLabel)}: ${e(s.taxNumber)}</div>` : ''}
  <div class="title">${e(kind)}</div></div>
  ${body}
  <div class="c m" style="margin-top:10px;border-top:1px dashed #000;padding-top:6px">${e(t('report.end'))}</div>
</body></html>`
}

export async function printShiftReport(shift: ShiftRecord, sum: ShiftSummary, moves: CashMovement[], s: Settings): Promise<void> {
  await printHtml(shiftReportHtml(shift, sum, moves, s), s.receipt.paperWidth === 'a4' ? undefined : s.receipt.paperWidth)
}
