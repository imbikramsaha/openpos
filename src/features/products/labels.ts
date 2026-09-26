import i18n from 'i18next'
import JsBarcode from 'jsbarcode'
import type { Product, Settings } from '@/core/types'
import { isValidEan13 } from '@/core/barcode'
import { formatMoney } from '@/lib/money'
import { escapeHtml as e } from '@/lib/print'

// Barcode label sheets as self-contained HTML documents (print + on-screen preview).
// Roll presets print one label per page with an exact @page size; A4 presets lay the
// labels out on a grid, one sheet per page.

export type LabelPresetId = 'l50x25' | 'l38x25' | 'roll58' | 'a4_3x8' | 'a4_4x10'

export interface LabelPreset {
  id: LabelPresetId
  /** Label size in millimetres. */
  w: number
  h: number
  /** Grid for A4 sheets. */
  cols?: number
  rows?: number
  /** Base font size in points. */
  font: number
  /** Lines of product name that fit. */
  nameLines: number
}

export const LABEL_PRESETS: LabelPreset[] = [
  { id: 'l50x25', w: 50, h: 25, font: 7, nameLines: 1 },
  { id: 'l38x25', w: 38, h: 25, font: 6.2, nameLines: 1 },
  { id: 'roll58', w: 58, h: 32, font: 8, nameLines: 2 },
  { id: 'a4_3x8', w: 70, h: 37, cols: 3, rows: 8, font: 8.5, nameLines: 2 },
  { id: 'a4_4x10', w: 52.5, h: 29.7, cols: 4, rows: 10, font: 7.2, nameLines: 1 },
]

export const presetById = (id: LabelPresetId) => LABEL_PRESETS.find((p) => p.id === id) ?? LABEL_PRESETS[0]

export interface LabelOptions {
  preset: LabelPresetId
  showName: boolean
  showPrice: boolean
  showMrp: boolean
  showBusiness: boolean
  /** A4 sheets: positions already used on the first sheet. */
  skip: number
}

export const DEFAULT_LABEL_OPTIONS: LabelOptions = { preset: 'l50x25', showName: true, showPrice: true, showMrp: false, showBusiness: false, skip: 0 }

export interface LabelItem {
  product: Product
  copies: number
}

export const barcodeFormat = (code: string) => (isValidEan13(code) ? 'EAN13' : 'CODE128')

/** Most labels one print job may contain (hundreds of A4 pages); keeps the document printable. */
export const MAX_LABELS = 10_000

/**
 * Bars only, as a reusable `<symbol>` (each label then references it with `<use>`, so thousands
 * of copies don't repeat the bars). The digits are rendered as HTML text so they stay crisp.
 */
function barcodeSymbol(code: string, id: string): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    // Quiet zones (blank space either side of the bars) are part of the symbol; without them
    // scanners often fail on die-cut labels. EAN-13: 11 modules left, 7 right; Code 128: 10 each.
    const ean = barcodeFormat(code) === 'EAN13'
    JsBarcode(svg, code, { format: barcodeFormat(code), displayValue: false, margin: 0, marginLeft: ean ? 22 : 20, marginRight: ean ? 14 : 20, height: 60, width: 2, flat: true, background: 'transparent' })
    return `<symbol id="${id}" viewBox="${svg.getAttribute('viewBox')}" preserveAspectRatio="none">${svg.innerHTML}</symbol>`
  } catch {
    // Characters CODE128 cannot encode, etc. The label still prints name and price.
    return ''
  }
}

function labelBody(p: Product, symbolId: string | undefined, o: LabelOptions, s: Settings): string {
  const mrpLabel = i18n.t('labels.mrpShort', { ns: 'products' }) as string
  const price = o.showPrice && !p.openPrice ? `<b>${e(formatMoney(p.price))}</b>` : ''
  const mrp = o.showMrp && p.mrp ? `<span class="mrp">${e(mrpLabel)} ${e(formatMoney(p.mrp))}</span>` : ''
  return `<div class="label">
    ${o.showBusiness && s.businessName ? `<div class="biz">${e(s.businessName)}</div>` : ''}
    ${o.showName ? `<div class="name">${e(p.name)}</div>` : ''}
    ${symbolId ? `<div class="bc"><svg preserveAspectRatio="none" shape-rendering="crispEdges"><use href="#${symbolId}" width="100%" height="100%"/></svg></div><div class="code">${e(p.barcode)}</div>` : p.sku ? `<div class="code">${e(p.sku)}</div>` : ''}
    ${price || mrp ? `<div class="price">${price}${mrp}</div>` : ''}
  </div>`
}

/**
 * Builds the printable document. `preview` limits output to a sample and adds
 * on-screen framing (paper background, label outlines, scaled A4 sheet).
 */
export function labelsHtml(items: LabelItem[], o: LabelOptions, s: Settings, preview?: { maxLabels: number }): string {
  const preset = presetById(o.preset)
  const sheet = !!preset.cols
  const symbols: string[] = []
  const labels: string[] = []
  const limit = Math.min(preview?.maxLabels ?? Infinity, MAX_LABELS)
  outer: for (const { product, copies } of items) {
    if (copies <= 0) continue
    let symbolId: string | undefined
    if (product.barcode) {
      const symbol = barcodeSymbol(product.barcode, `bc${symbols.length}`)
      if (symbol) {
        symbolId = `bc${symbols.length}`
        symbols.push(symbol)
      }
    }
    const html = labelBody(product, symbolId, o, s)
    for (let i = 0; i < copies; i++) {
      if (labels.length >= limit) break outer
      labels.push(html)
    }
  }

  let body: string
  if (sheet) {
    const perSheet = preset.cols! * preset.rows!
    const skip = Math.max(0, Math.min(o.skip, perSheet - 1))
    const cells = [...Array<string>(skip).fill('<div class="label empty"></div>'), ...labels]
    const sheets: string[] = []
    for (let i = 0; i < cells.length; i += perSheet) sheets.push(`<div class="sheet">${cells.slice(i, i + perSheet).join('')}</div>`)
    body = (preview ? sheets.slice(0, 1) : sheets).join('')
  } else body = labels.join('')

  const pageCss = sheet
    ? `@page { size: A4; margin: 0 }
       .sheet { width: 210mm; height: 296.9mm; padding: ${sheetPad(preset)}; display: grid; grid-template-columns: repeat(${preset.cols}, ${preset.w}mm); grid-auto-rows: ${preset.h}mm; align-content: start; justify-content: start; overflow: hidden; break-after: page }
       .sheet:last-child { break-after: auto }`
    : `@page { size: ${preset.w}mm ${preset.h}mm; margin: 0 }
       .label { break-after: page } .label:last-child { break-after: auto }`
  const previewCss = preview
    ? sheet
      ? `html { background: #e5e7eb } body { padding: 12px } .sheet { background: #fff; zoom: .38; box-shadow: 0 2px 8px rgb(0 0 0 / .2); margin: 0 auto } .label { outline: 1px dashed #cbd5e1 }`
      : `html { background: #e5e7eb } body { padding: 12px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; zoom: 1.6 } .label { background: #fff; border-radius: 1mm; box-shadow: 0 1px 3px rgb(0 0 0 / .25) }`
    : ''

  return `<!doctype html><html dir="${i18n.dir()}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(i18n.t('labels.title', { ns: 'products' }))}</title><style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font: ${preset.font}pt/1.15 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact }
  .label { width: ${preset.w}mm; height: ${preset.h}mm; padding: 1.3mm 1.8mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .3mm; overflow: hidden; text-align: center; break-inside: avoid }
  .biz { max-width: 100%; font-size: .78em; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .name { max-width: 100%; font-weight: 700; line-height: 1.12; display: -webkit-box; -webkit-line-clamp: ${preset.nameLines}; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere }
  .bc { flex: 1 1 auto; width: 100%; min-height: 5mm; max-height: ${Math.round(preset.h * 0.45)}mm; display: flex; padding: 0 1mm }
  .bc svg { width: 100%; height: 100%; display: block }
  .code { font: .86em/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: .1em }
  .price { display: flex; align-items: baseline; justify-content: center; gap: 1.5mm; font-size: 1.3em; line-height: 1.05 }
  .price b { font-weight: 800 } .mrp { font-size: .62em; font-weight: 500 }
  ${pageCss}
  ${previewCss}
</style></head><body><svg width="0" height="0" style="position:absolute" aria-hidden="true">${symbols.join('')}</svg>${body}</body></html>`
}

/** Offsets that centre a full grid on the sheet, so every cell sits where the physical label is (even on part-filled pages). */
function sheetPad(p: LabelPreset): string {
  const top = Math.max(0, (296.9 - p.rows! * p.h) / 2)
  const side = Math.max(0, (210 - p.cols! * p.w) / 2)
  return `${top.toFixed(2)}mm ${side.toFixed(2)}mm`
}

export function labelCount(items: LabelItem[]): number {
  return items.reduce((a, i) => a + Math.max(0, i.copies), 0)
}
