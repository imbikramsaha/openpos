import i18n from 'i18next'
import JsBarcode from 'jsbarcode'
import type { Sale, Settings } from '@/core/types'
import { gstSplit } from '@/core/cart'
import { INDIAN_STATES } from '@/core/presets'
import { currencyDecimals, formatMoney, formatQty, formatPercent } from '@/lib/money'
import { formatDateTime } from '@/lib/dates'
import { escapeHtml as e } from '@/lib/print'
import { amountInWords } from '@/lib/words'

// Receipt and invoice rendering as self-contained HTML documents, used for on-screen
// preview, printing (browser, Electron silent print) and PDF export.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'sell', ...opts }) as string

/** Keeps numbers, phones and IDs readable inside right-to-left receipts. */
const ltr = (html: string) => `<bdi dir="ltr">${html}</bdi>`
const unitLabel = (u: string) => i18n.t(`common:unit.${u}`, { defaultValue: u }) as string

function methodLabel(m: string) {
  return i18n.t(`common:payment.${m}`) as string
}

function barcodeSvg(value: string): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, value, { format: 'CODE128', height: 36, width: 1.4, fontSize: 11, margin: 0, displayValue: true })
    return svg.outerHTML
  } catch {
    return ''
  }
}

function docTitle(sale: Sale, s: Settings) {
  // Refunds, and returns rung up at the till without a receipt (negative total), are credit notes.
  if (sale.type === 'refund' || sale.total < 0) return t('receipt.creditNote')
  return s.gstMode || s.taxNumber ? t('receipt.taxInvoice') : t('receipt.receipt')
}

function taxRows(sale: Sale, s: Settings): Array<[string, number]> {
  if (s.gstMode) {
    return gstSplit(sale.taxBreakdown, !!sale.interState).map((r) => [`${r.label} ${formatPercent(r.rate)}`, r.tax])
  }
  return sale.taxBreakdown.filter((b) => b.rate).map((b) => [b.name || `${t('receipt.tax')} ${formatPercent(b.rate)}`, b.tax])
}

export function receiptHtml(sale: Sale, s: Settings): string {
  return s.receipt.paperWidth === 'a4' ? invoiceA4(sale, s) : thermal(sale, s)
}

function thermal(sale: Sale, s: Settings): string {
  const width = s.receipt.paperWidth === 58 ? 58 : 80
  const r = s.receipt
  const dir = i18n.dir()
  const lines = sale.lines
    .map((l) => {
      const meta = [r.showSku && l.sku, s.gstMode && l.hsn && `HSN ${l.hsn}`].filter(Boolean).join(' · ')
      return `<tr><td colspan="2" class="name">${e(l.name)}${meta ? `<div class="meta">${e(meta)}</div>` : ''}${l.note ? `<div class="meta">${e(l.note)}</div>` : ''}</td></tr>
      <tr><td class="meta">${ltr(`${formatQty(l.qty)} ${e(l.unit === 'pcs' ? '' : unitLabel(l.unit))} × ${formatMoney(l.price)}`)}${l.discount ? ` <span>(${ltr(`−${formatMoney(Math.abs(l.discount))}`)})</span>` : ''}</td><td class="r">${formatMoney(l.total)}</td></tr>`
    })
    .join('')
  const totals: Array<[string, number, string?]> = [[t('receipt.subtotal'), sale.subtotal]]
  if (sale.discountTotal) totals.push([t('receipt.discount'), -sale.discountTotal])
  if (!sale.pricesIncludeTax) totals.push([t('receipt.taxable'), sale.netTotal])
  if (r.showTaxBreakdown) for (const [label, amount] of taxRows(sale, s)) totals.push([label, amount, 'meta'])
  // With tax-inclusive prices the tax is part of the subtotal, not added on top: label it so.
  else if (sale.taxTotal) totals.push([sale.pricesIncludeTax ? t('receipt.taxIncluded') : t('receipt.tax'), sale.taxTotal, sale.pricesIncludeTax ? 'meta' : undefined])
  if (sale.pricesIncludeTax && sale.taxTotal && r.showTaxBreakdown) totals.push([t('receipt.taxIncluded'), sale.taxTotal, 'meta'])
  if (sale.rounding) totals.push([t('receipt.rounding'), sale.rounding])

  const payments = sale.payments.map((p) => `<tr><td>${e(methodLabel(p.method))}${p.reference ? ` <span class="meta">${e(p.reference)}</span>` : ''}</td><td class="r">${formatMoney(p.amount)}</td></tr>`).join('')

  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(sale.number)}</title><style>
  @page { size: ${width}mm auto; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; padding: 3mm ${width === 58 ? 2 : 4}mm; width: ${width}mm; font: 12px/1.35 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #000; background: #fff; overflow-wrap: anywhere }
  .c { text-align: center } .r { text-align: end; white-space: nowrap; vertical-align: bottom } .b { font-weight: 700 }
  h1 { font-size: 16px; margin: 0 0 2px } .meta { color: #333; font-size: 11px }
  table { width: 100%; border-collapse: collapse } td { padding: 1px 0; vertical-align: top }
  .name { font-weight: 600; padding-top: 4px }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0 }
  .total td { font-size: 16px; font-weight: 800; padding-top: 4px }
  .logo { max-width: 60%; max-height: 60px; margin: 0 auto 4px; display: block }
  .bc { display: flex; justify-content: center; margin-top: 8px } .bc svg { max-width: 100% }
  .title { letter-spacing: .08em; font-weight: 700; margin: 4px 0 }
</style></head><body>
  ${r.showLogo && r.logo ? `<img class="logo" src="${e(r.logo)}" alt="">` : ''}
  <div class="c"><h1>${e(s.businessName)}</h1>
  ${s.legalName ? `<div class="meta">${e(s.legalName)}</div>` : ''}
  ${s.address ? `<div class="meta">${e(s.address)}</div>` : ''}
  ${s.phone ? `<div class="meta">${ltr(e(s.phone))}</div>` : ''}
  ${s.taxNumber ? `<div class="meta">${e(s.taxLabel)}: ${ltr(e(s.taxNumber))}</div>` : ''}
  ${r.header ? `<div class="meta" style="white-space:pre-line;margin-top:4px">${e(r.header)}</div>` : ''}
  <div class="title">${e(docTitle(sale, s))}</div></div>
  <table class="meta">
    <tr><td>${e(t('receipt.number'))}</td><td class="r b">${e(sale.number)}</td></tr>
    <tr><td>${e(t('receipt.date'))}</td><td class="r">${e(formatDateTime(sale.createdAt))}</td></tr>
    <tr><td>${e(t('receipt.cashier'))}</td><td class="r">${e(sale.userName)}</td></tr>
    ${sale.table ? `<tr><td>${e(t('receipt.table'))}</td><td class="r">${e(sale.table)}</td></tr>` : ''}
    ${r.showCustomer && sale.customerName ? `<tr><td>${e(t('receipt.customer'))}</td><td class="r">${e(sale.customerName)}${sale.customerPhone ? `<br>${ltr(e(sale.customerPhone))}` : ''}</td></tr>` : ''}
    ${r.showCustomer && sale.customerTaxNumber ? `<tr><td>${e(s.taxLabel)}</td><td class="r">${ltr(e(sale.customerTaxNumber))}</td></tr>` : ''}
  </table>
  <hr><table>${lines}</table><hr>
  <table>${totals.map(([l, v, cls]) => `<tr class="${cls ?? ''}"><td>${e(l)}</td><td class="r">${formatMoney(v)}</td></tr>`).join('')}
  <tr class="total"><td>${e(t('receipt.total'))}</td><td class="r">${formatMoney(sale.total)}</td></tr></table>
  <hr><table>${payments}${sale.change ? `<tr class="b"><td>${e(t('receipt.change'))}</td><td class="r">${formatMoney(sale.change)}</td></tr>` : ''}</table>
  ${sale.loyaltyEarned ? `<div class="meta c" style="margin-top:6px">${e(t('receipt.pointsEarned', { count: sale.loyaltyEarned }))}</div>` : ''}
  ${sale.note ? `<div class="meta" style="margin-top:6px">${e(sale.note)}</div>` : ''}
  ${r.footer ? `<hr><div class="c" style="white-space:pre-line">${e(r.footer)}</div>` : ''}
  ${r.showBarcode ? `<div class="bc">${barcodeSvg(sale.number)}</div>` : ''}
</body></html>`
}

function invoiceA4(sale: Sale, s: Settings): string {
  const d = currencyDecimals(s.currency)
  const state = INDIAN_STATES.find(([c]) => c === s.state)
  const gst = s.gstMode
  const dir = i18n.dir()
  const rows = sale.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td>${e(l.name)}${l.sku && s.receipt.showSku ? `<div class="m">${e(l.sku)}</div>` : ''}</td>${gst ? `<td>${e(l.hsn ?? '')}</td>` : ''}
      <td class="r">${ltr(`${formatQty(l.qty)} ${e(unitLabel(l.unit))}`)}</td><td class="r">${formatMoney(l.price)}</td><td class="r">${l.discount ? formatMoney(l.discount) : ''}</td>
      <td class="r">${formatMoney(l.net)}</td><td class="r">${formatPercent(l.taxRate)}</td><td class="r">${formatMoney(l.tax)}</td><td class="r b">${formatMoney(l.total)}</td></tr>`,
    )
    .join('')
  const split = gst ? gstSplit(sale.taxBreakdown, !!sale.interState) : []
  const summary = gst
    ? sale.taxBreakdown
        .filter((b) => b.rate)
        .map((b) => {
          const parts = split.filter((x) => (sale.interState ? x.rate === b.rate : x.rate === b.rate / 2))
          const cells = sale.interState
            ? `<td class="r">${formatMoney(b.tax)}</td>`
            : `<td class="r">${formatMoney(parts[0]?.tax ?? 0)}</td><td class="r">${formatMoney(parts[1]?.tax ?? 0)}</td>`
          return `<tr><td>${formatPercent(b.rate)}</td><td class="r">${formatMoney(b.taxable)}</td>${cells}<td class="r">${formatMoney(b.tax)}</td></tr>`
        })
        .join('')
    : ''
  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(sale.number)}</title><style>
  @page { size: A4; margin: 12mm }
  body { font: 12px/1.45 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #111; margin: 0; overflow-wrap: anywhere }
  h1 { font-size: 22px; margin: 0 } h2 { font-size: 15px; letter-spacing: .1em; margin: 0; color: #111 }
  .m { color: #555; font-size: 11px } .r { text-align: end } .b { font-weight: 700 }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 12px }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 14px }
  .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px }
  table { width: 100%; border-collapse: collapse } th { background: #f3f4f6; text-align: start; font-size: 11px; text-transform: uppercase; letter-spacing: .03em }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  .tot { width: 320px; margin-inline-start: auto; margin-top: 10px } .tot td { border: 0; padding: 3px 8px } .grand td { font-size: 16px; font-weight: 800; border-top: 2px solid #111 }
  .foot { margin-top: 28px; display: flex; justify-content: space-between; align-items: flex-end }
  .logo { max-height: 64px; max-width: 180px }
</style></head><body>
  <div class="head"><div>${s.receipt.showLogo && s.receipt.logo ? `<img class="logo" src="${e(s.receipt.logo)}" alt=""><br>` : ''}
    <h1>${e(s.legalName || s.businessName)}</h1>
    <div class="m">${e(s.address)}${state ? `, ${e(state[1])} (${e(state[0])})` : ''}</div>
    <div class="m">${[s.phone, s.email, s.website].filter(Boolean).map((v) => ltr(e(v))).join(' · ')}</div>
    ${s.taxNumber ? `<div class="b">${e(s.taxLabel)}: ${ltr(e(s.taxNumber))}</div>` : ''}
    ${s.receipt.header ? `<div class="m" style="white-space:pre-line;margin-top:4px">${e(s.receipt.header)}</div>` : ''}</div>
    <div class="r"><h2>${e(docTitle(sale, s)).toUpperCase()}</h2>
    <div><span class="m">${e(t('receipt.number'))}:</span> <b>${e(sale.number)}</b></div>
    <div><span class="m">${e(t('receipt.date'))}:</span> ${e(formatDateTime(sale.createdAt))}</div>
    ${gst ? `<div><span class="m">${e(t('receipt.placeOfSupply'))}:</span> ${sale.interState ? e(t('receipt.interState')) : e(state?.[1] ?? '')}</div>` : ''}</div></div>
  <div class="grid"><div class="box"><div class="m">${e(t('receipt.billTo'))}</div>
    <div class="b">${e(sale.customerName || t('receipt.walkIn'))}</div>
    ${sale.customerPhone ? `<div>${ltr(e(sale.customerPhone))}</div>` : ''}
    ${sale.customerTaxNumber ? `<div>${e(s.taxLabel)}: ${ltr(e(sale.customerTaxNumber))}</div>` : ''}</div>
    <div class="box"><div class="m">${e(t('receipt.cashier'))}</div><div>${e(sale.userName)}</div>
    <div class="m" style="margin-top:4px">${e(t('receipt.paymentMode'))}</div><div>${sale.payments.map((p) => e(methodLabel(p.method))).join(', ')}</div></div></div>
  <table><thead><tr><th>#</th><th>${e(t('receipt.item'))}</th>${gst ? '<th>HSN/SAC</th>' : ''}<th class="r">${e(t('receipt.qty'))}</th><th class="r">${e(t('receipt.rate'))}</th><th class="r">${e(t('receipt.discount'))}</th><th class="r">${e(t('receipt.taxable'))}</th><th class="r">${e(t('receipt.taxRate'))}</th><th class="r">${e(t('receipt.tax'))}</th><th class="r">${e(t('receipt.amount'))}</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot">
    <tr><td>${e(t('receipt.taxable'))}</td><td class="r">${formatMoney(sale.netTotal)}</td></tr>
    ${split.map((r) => `<tr><td>${r.label} ${formatPercent(r.rate)}</td><td class="r">${formatMoney(r.tax)}</td></tr>`).join('')}
    ${!gst ? sale.taxBreakdown.filter((b) => b.rate).map((b) => `<tr><td>${e(b.name)}</td><td class="r">${formatMoney(b.tax)}</td></tr>`).join('') : ''}
    ${sale.rounding ? `<tr><td>${e(t('receipt.rounding'))}</td><td class="r">${formatMoney(sale.rounding)}</td></tr>` : ''}
    <tr class="grand"><td>${e(t('receipt.total'))}</td><td class="r">${formatMoney(sale.total)}</td></tr>
  </table>
  <p class="m"><b>${e(t('receipt.inWords'))}:</b> ${e(amountInWords(sale.total, s.currency, d))}</p>
  ${gst && summary ? `<table style="margin-top:10px;width:auto;min-width:60%"><thead><tr><th>${e(t('receipt.taxRate'))}</th><th class="r">${e(t('receipt.taxable'))}</th>${sale.interState ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}<th class="r">${e(t('receipt.tax'))}</th></tr></thead><tbody>${summary}</tbody></table>` : ''}
  ${sale.note ? `<p><b>${e(t('receipt.note'))}:</b> ${e(sale.note)}</p>` : ''}
  <div class="foot"><div class="m" style="white-space:pre-line">${e(s.receipt.footer)}</div>
  <div class="r"><div style="height:40px"></div><div class="m">${e(t('receipt.authorisedSignatory'))}</div></div></div>
</body></html>`
}

/** Plain-text receipt for WhatsApp, SMS and the Web Share sheet. */
export function receiptText(sale: Sale, s: Settings): string {
  const out: string[] = [`*${s.businessName}*`, `${docTitle(sale, s)} ${sale.number}`, formatDateTime(sale.createdAt), '']
  for (const l of sale.lines) out.push(`${l.name}\n  ${formatQty(l.qty)} × ${formatMoney(l.price)} = ${formatMoney(l.total)}`)
  out.push('')
  if (sale.discountTotal) out.push(`${t('receipt.discount')}: ${formatMoney(-sale.discountTotal)}`)
  if (sale.taxTotal) out.push(`${sale.pricesIncludeTax ? t('receipt.taxIncluded') : t('receipt.tax')}: ${formatMoney(sale.taxTotal)}`)
  if (sale.rounding) out.push(`${t('receipt.rounding')}: ${formatMoney(sale.rounding)}`)
  out.push(`*${t('receipt.total')}: ${formatMoney(sale.total)}*`)
  for (const p of sale.payments) out.push(`${methodLabel(p.method)}: ${formatMoney(p.amount)}`)
  if (sale.change) out.push(`${t('receipt.change')}: ${formatMoney(sale.change)}`)
  if (s.receipt.footer) out.push('', s.receipt.footer)
  return out.join('\n')
}
