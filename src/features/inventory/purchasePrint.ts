import i18n from 'i18next'
import type { Purchase, Settings, Supplier } from '@/core/types'
import { formatDateTime } from '@/lib/dates'
import { formatMoney, formatQty } from '@/lib/money'
import { escapeHtml as e } from '@/lib/print'
import { lineTotal } from './service'

// A4 goods-received note for a purchase, as a self-contained HTML document.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'inventory', ...opts }) as string

export function purchaseHtml(p: Purchase, s: Settings, supplier?: Supplier, userName?: string): string {
  const due = p.total - p.paid
  const rows = p.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${e(l.name)}</td><td class="r">${formatQty(l.qty)}</td><td class="r">${formatMoney(l.cost)}</td><td class="r b">${formatMoney(lineTotal(l))}</td></tr>`,
    )
    .join('')
  const sup = supplier ?? (p.supplierName ? ({ name: p.supplierName } as Supplier) : undefined)
  return `<!doctype html><html dir="${i18n.dir()}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(p.number)}</title><style>
  @page { size: A4; margin: 14mm }
  body { font: 12px/1.45 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #111; margin: 0 }
  h1 { font-size: 20px; margin: 0 } h2 { font-size: 14px; letter-spacing: .1em; margin: 0 0 4px; color: #111 }
  .m { color: #555; font-size: 11px } .r { text-align: end } .b { font-weight: 700 }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 14px }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px }
  .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px }
  table { width: 100%; border-collapse: collapse } th { background: #f3f4f6; text-align: start; font-size: 11px; text-transform: uppercase; letter-spacing: .03em }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  .tot { width: 300px; margin-inline-start: auto; margin-top: 10px } .tot td { border: 0; padding: 3px 8px } .grand td { font-size: 15px; font-weight: 800; border-top: 2px solid #111 }
  .foot { margin-top: 40px; display: flex; justify-content: space-between; gap: 24px } .sig { width: 200px; border-top: 1px solid #111; padding-top: 4px; text-align: center }
</style></head><body>
  <div class="head"><div><h1>${e(s.legalName || s.businessName)}</h1>
    ${s.address ? `<div class="m">${e(s.address)}</div>` : ''}
    <div class="m">${[s.phone, s.email].filter(Boolean).map(e).join(' · ')}</div>
    ${s.taxNumber ? `<div class="b">${e(s.taxLabel)}: ${e(s.taxNumber)}</div>` : ''}</div>
    <div class="r"><h2>${e(t('print.title')).toUpperCase()}</h2>
    <div><span class="m">${e(t('print.number'))}:</span> <b>${e(p.number)}</b></div>
    <div><span class="m">${e(t('print.date'))}:</span> ${e(formatDateTime(p.createdAt))}</div>
    ${p.invoiceNo ? `<div><span class="m">${e(t('print.invoiceNo'))}:</span> ${e(p.invoiceNo)}</div>` : ''}</div></div>
  <div class="grid"><div class="box"><div class="m">${e(t('print.supplier'))}</div>
    <div class="b">${e(sup?.name ?? '—')}</div>
    ${sup?.phone ? `<div>${e(sup.phone)}</div>` : ''}${sup?.email ? `<div>${e(sup.email)}</div>` : ''}
    ${sup?.taxNumber ? `<div>${e(s.taxLabel)}: ${e(sup.taxNumber)}</div>` : ''}
    ${sup?.address ? `<div class="m" style="white-space:pre-line">${e(sup.address)}</div>` : ''}</div>
    <div class="box"><div class="m">${e(t('print.receivedBy'))}</div><div>${e(userName ?? '')}</div>
    <div class="m" style="margin-top:4px">${e(t('print.items'))}</div><div>${p.lines.length}</div></div></div>
  <table><thead><tr><th>#</th><th>${e(t('print.item'))}</th><th class="r">${e(t('print.qty'))}</th><th class="r">${e(t('print.unitCost'))}</th><th class="r">${e(t('print.amount'))}</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot">
    <tr class="grand"><td>${e(t('print.total'))}</td><td class="r">${formatMoney(p.total)}</td></tr>
    <tr><td>${e(t('print.paid'))}</td><td class="r">${formatMoney(p.paid)}</td></tr>
    ${due > 0 ? `<tr class="b"><td>${e(t('print.due'))}</td><td class="r">${formatMoney(due)}</td></tr>` : ''}
  </table>
  ${p.note ? `<p><b>${e(t('print.note'))}:</b> ${e(p.note)}</p>` : ''}
  <div class="foot"><div class="sig m">${e(t('print.supplierSignature'))}</div><div class="sig m">${e(t('print.receiverSignature'))}</div></div>
</body></html>`
}
