import i18n from 'i18next'
import type { Customer, CustomerPayment, Sale, Settings } from '@/core/types'
import { INDIAN_STATES } from '@/core/presets'
import { db } from '@/db/db'
import { putMany } from '@/db/repo'
import { formatDate, formatDateTime } from '@/lib/dates'
import { currencyDecimals, formatMoney, fromMinor, moneyConfig, parseDecimal, toMinor } from '@/lib/money'
import { parseCsv, toCsv } from '@/lib/csv'
import { escapeHtml as e } from '@/lib/print'
import { uuid } from '@/lib/uuid'
import { amountInWords } from '@/lib/words'

// Customer account logic: purchase stats, the credit (khata) ledger, printable
// payment receipts / statements and CSV import-export. Balances themselves are
// derived by recomputeCustomer(); this module only reads the same ledgers.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'customers', ...opts }) as string

// ---- Purchase statistics --------------------------------------------------------

export interface CustomerStats {
  spent: number
  visits: number
  last?: number
}

const addSale = (st: CustomerStats, s: Sale) => {
  if (s.deleted || s.status === 'voided') return
  st.spent += s.total
  if (s.type === 'sale') {
    st.visits++
    if (!st.last || s.createdAt > st.last) st.last = s.createdAt
  }
}

/**
 * Stats for every customer in a single streamed pass over the `customerId` index —
 * walk-in sales (the vast majority) are never read, and no record is retained.
 */
export async function customerStatsMap(): Promise<Map<string, CustomerStats>> {
  const map = new Map<string, CustomerStats>()
  await db.sales
    .where('customerId')
    .above('')
    .each((s) => {
      if (!s.customerId) return
      let st = map.get(s.customerId)
      if (!st) map.set(s.customerId, (st = { spent: 0, visits: 0 }))
      addSale(st, s)
    })
  return map
}

export function statsOf(sales: Sale[]): CustomerStats & { average: number } {
  const st: CustomerStats = { spent: 0, visits: 0 }
  for (const s of sales) addSale(st, s)
  return { ...st, average: st.visits ? Math.round(st.spent / st.visits) : 0 }
}

// ---- Account ledger (khata) -----------------------------------------------------

export type LedgerKind = 'sale' | 'refund' | 'payment' | 'charge'

export interface LedgerEntry {
  id: string
  at: number
  kind: LedgerKind
  number?: string
  saleId?: string
  payment?: CustomerPayment
  note?: string
  /** Increases what the customer owes. */
  debit: number
  /** Decreases what the customer owes. */
  credit: number
  /** Running balance after this entry. */
  balance: number
}

/** Chronological ledger with running balance; the last balance equals customer.balance. */
export function buildLedger(sales: Sale[], payments: CustomerPayment[]): LedgerEntry[] {
  const out: LedgerEntry[] = []
  for (const s of sales) {
    if (s.deleted || s.status === 'voided') continue
    const amt = s.payments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0)
    if (!amt) continue
    out.push({ id: s.id, at: s.createdAt, kind: s.type === 'refund' ? 'refund' : 'sale', number: s.number, saleId: s.id, note: s.type === 'refund' ? s.note : undefined, debit: Math.max(amt, 0), credit: Math.max(-amt, 0), balance: 0 })
  }
  for (const p of payments) {
    if (p.deleted) continue
    out.push({ id: p.id, at: p.createdAt, kind: p.amount >= 0 ? 'payment' : 'charge', payment: p, note: p.note, debit: Math.max(-p.amount, 0), credit: Math.max(p.amount, 0), balance: 0 })
  }
  out.sort((a, b) => a.at - b.at)
  let bal = 0
  for (const x of out) {
    bal += x.debit - x.credit
    x.balance = bal
  }
  return out
}

export async function loadLedger(customerId: string): Promise<LedgerEntry[]> {
  const [sales, payments] = await Promise.all([db.sales.where('customerId').equals(customerId).toArray(), db.customerPayments.where('customerId').equals(customerId).toArray()])
  return buildLedger(sales, payments)
}

/** Short human-friendly reference for a customer payment, e.g. PMT-3F2A9C1B. */
export const paymentRef = (p: CustomerPayment) => `PMT-${p.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`

// ---- Printable documents --------------------------------------------------------

const method = (m: string) => i18n.t(`common:payment.${m}`) as string

function businessBlock(s: Settings, cls = 'meta') {
  return `${s.receipt.showLogo && s.receipt.logo ? `<img class="logo" src="${s.receipt.logo}" alt="">` : ''}
  <h1>${e(s.legalName || s.businessName)}</h1>
  ${s.address ? `<div class="${cls}">${e(s.address)}</div>` : ''}
  ${[s.phone, s.email].filter(Boolean).length ? `<div class="${cls}">${[s.phone, s.email].filter(Boolean).map(e).join(' · ')}</div>` : ''}
  ${s.taxNumber ? `<div class="${cls}">${e(s.taxLabel)}: ${e(s.taxNumber)}</div>` : ''}`
}

export function paymentReceiptHtml(p: CustomerPayment, c: Customer, balanceAfter: number, s: Settings, receivedBy?: string): string {
  const a4 = s.receipt.paperWidth === 'a4'
  const width = s.receipt.paperWidth === 58 ? 58 : 80
  const dir = i18n.dir()
  const row = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${e(label)}</td><td class="r">${value}</td></tr>`
  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(paymentRef(p))}</title><style>
  @page { ${a4 ? 'size: A4; margin: 15mm' : `size: ${width}mm auto; margin: 0`} }
  * { box-sizing: border-box }
  body { margin: 0 auto; padding: ${a4 ? '0' : `3mm ${width === 58 ? 2 : 4}mm`}; width: ${a4 ? '110mm' : `${width}mm`}; font: 12px/1.4 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #000; background: #fff }
  .c { text-align: center } .r { text-align: end; white-space: nowrap } .b { font-weight: 700 }
  h1 { font-size: 16px; margin: 0 0 2px } .meta { color: #333; font-size: 11px }
  table { width: 100%; border-collapse: collapse } td { padding: 2px 0; vertical-align: top }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0 }
  .title { letter-spacing: .1em; font-weight: 700; margin: 6px 0 }
  .amount { font-size: 26px; font-weight: 800; margin: 6px 0 2px }
  .big td { font-size: 14px; font-weight: 800 }
  .logo { max-width: 60%; max-height: 60px; margin: 0 auto 4px; display: block }
</style></head><body>
  <div class="c">${businessBlock(s)}<div class="title">${e(t('print.paymentReceipt')).toUpperCase()}</div></div>
  <table class="meta">
    ${row(t('print.receiptNo'), `<b>${e(paymentRef(p))}</b>`)}
    ${row(t('print.date'), e(formatDateTime(p.createdAt)))}
    ${row(t('print.customer'), `${e(c.name)}${c.phone ? `<br>${e(c.phone)}` : ''}`)}
    ${receivedBy ? row(t('print.receivedBy'), e(receivedBy)) : ''}
  </table>
  <hr>
  <div class="c"><div class="meta">${e(t('print.amountReceived'))}</div><div class="amount">${formatMoney(p.amount)}</div>
  <div class="meta">${e(method(p.method))}</div></div>
  <div class="meta c" style="margin-top:4px">${e(amountInWords(p.amount, s.currency, currencyDecimals(s.currency)))}</div>
  ${p.note ? `<div class="meta c" style="margin-top:4px">${e(p.note)}</div>` : ''}
  <hr>
  <table>
    ${row(t('print.previousBalance'), formatMoney(balanceAfter + p.amount))}
    ${row(t('print.paid'), formatMoney(-p.amount))}
    ${row(balanceAfter < 0 ? t('print.advance') : t('print.balanceDue'), formatMoney(Math.abs(balanceAfter)), 'big')}
  </table>
  ${s.receipt.footer ? `<hr><div class="c" style="white-space:pre-line">${e(s.receipt.footer)}</div>` : ''}
</body></html>`
}

export function paymentReceiptText(p: CustomerPayment, c: Customer, balanceAfter: number, s: Settings): string {
  return [
    `*${s.businessName}*`,
    `${t('print.paymentReceipt')} ${paymentRef(p)}`,
    formatDateTime(p.createdAt),
    '',
    t('print.thanksText', { name: c.name, amount: formatMoney(p.amount), method: method(p.method) }),
    p.note ?? '',
    `${balanceAfter < 0 ? t('print.advance') : t('print.balanceDue')}: *${formatMoney(Math.abs(balanceAfter))}*`,
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n')
}

export function reminderText(c: Customer, s: Settings): string {
  const parts = [t('reminder.text', { name: c.name, business: s.businessName, amount: formatMoney(c.balance) })]
  if (s.upiId) parts.push(t('reminder.upi', { upi: s.upiId }))
  if (s.phone) parts.push(t('reminder.contact', { phone: s.phone }))
  parts.push(t('reminder.thanks'))
  return parts.join('\n\n')
}

async function upiQr(s: Settings, amount: number): Promise<string> {
  if (!s.upiId || amount <= 0) return ''
  try {
    const { toDataURL } = await import('qrcode')
    const url = `upi://pay?pa=${encodeURIComponent(s.upiId)}&pn=${encodeURIComponent(s.upiName || s.businessName)}&am=${fromMinor(amount).toFixed(moneyConfig().decimals)}&cu=${s.currency}`
    return await toDataURL(url, { margin: 1, width: 240 })
  } catch {
    return ''
  }
}

const ENTRY_LABEL: Record<LedgerKind, string> = { sale: 'kind.sale', refund: 'kind.refund', payment: 'kind.payment', charge: 'kind.charge' }

export function entryTitle(x: LedgerEntry): string {
  if (x.kind === 'payment') return `${t(ENTRY_LABEL.payment)} · ${method(x.payment!.method)}`
  return `${t(ENTRY_LABEL[x.kind])}${x.number ? ` ${x.number}` : ''}`
}

/** A4 statement of account with running balance (and a UPI QR for the amount due). */
export async function statementHtml(c: Customer, entries: LedgerEntry[], s: Settings): Promise<string> {
  const dir = i18n.dir()
  const debit = entries.reduce((a, x) => a + x.debit, 0)
  const credit = entries.reduce((a, x) => a + x.credit, 0)
  const qr = await upiQr(s, c.balance)
  const state = s.country === 'IN' ? INDIAN_STATES.find(([code]) => code === c.state)?.[1] ?? c.state : c.state
  const address = [c.address, c.city, state].filter(Boolean).join(', ')
  const rows = entries
    .map(
      (x) => `<tr><td>${e(formatDate(x.at))}</td><td>${e(entryTitle(x))}${x.note ? `<div class="m">${e(x.note)}</div>` : ''}</td>
      <td class="r">${x.debit ? formatMoney(x.debit) : ''}</td><td class="r">${x.credit ? formatMoney(x.credit) : ''}</td><td class="r b">${formatMoney(x.balance)}</td></tr>`,
    )
    .join('')
  return `<!doctype html><html dir="${dir}" lang="${i18n.language}"><head><meta charset="utf-8"><title>${e(t('print.statement'))} — ${e(c.name)}</title><style>
  @page { size: A4; margin: 12mm }
  body { font: 12px/1.45 system-ui, 'Segoe UI', Roboto, 'Noto Sans', 'Nirmala UI', Arial, sans-serif; color: #111; margin: 0 }
  h1 { font-size: 20px; margin: 0 } h2 { font-size: 15px; letter-spacing: .1em; margin: 0; color: #4f46e5 }
  .m, .meta { color: #555; font-size: 11px } .r { text-align: end } .b { font-weight: 700 }
  .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 14px }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px }
  .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px }
  table { width: 100%; border-collapse: collapse } th { background: #f3f4f6; text-align: start; font-size: 11px; text-transform: uppercase; letter-spacing: .03em }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top }
  .sum td { border: 0; padding: 3px 0 } .due td { font-size: 16px; font-weight: 800; border-top: 2px solid #111; padding-top: 6px }
  .pay { display: flex; gap: 16px; align-items: center; margin-top: 20px; border: 1px dashed #999; border-radius: 8px; padding: 12px }
  .logo { max-height: 56px; max-width: 170px }
</style></head><body>
  <div class="head"><div>${businessBlock(s, 'm')}</div>
    <div class="r"><h2>${e(t('print.statement')).toUpperCase()}</h2><div class="m">${e(t('print.generated', { date: formatDateTime(Date.now()) }))}</div></div></div>
  <div class="grid">
    <div class="box"><div class="m">${e(t('print.customer'))}</div><div class="b">${e(c.name)}</div>
      ${c.phone ? `<div>${e(c.phone)}</div>` : ''}${c.email ? `<div>${e(c.email)}</div>` : ''}
      ${c.taxNumber ? `<div>${e(s.taxLabel)}: ${e(c.taxNumber)}</div>` : ''}${address ? `<div class="m">${e(address)}</div>` : ''}</div>
    <div class="box"><table class="sum">
      <tr><td>${e(t('print.totalCharges'))}</td><td class="r">${formatMoney(debit)}</td></tr>
      <tr><td>${e(t('print.totalPayments'))}</td><td class="r">${formatMoney(credit)}</td></tr>
      ${c.creditLimit ? `<tr><td>${e(t('creditLimit'))}</td><td class="r">${formatMoney(c.creditLimit)}</td></tr>` : ''}
      <tr class="due"><td>${e(c.balance < 0 ? t('print.advance') : t('print.balanceDue'))}</td><td class="r">${formatMoney(Math.abs(c.balance))}</td></tr>
    </table></div>
  </div>
  <table><thead><tr><th>${e(t('print.date'))}</th><th>${e(t('print.description'))}</th><th class="r">${e(t('print.debit'))}</th><th class="r">${e(t('print.credit'))}</th><th class="r">${e(t('print.balance'))}</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="5" class="m" style="text-align:center;padding:24px">${e(t('statement.empty'))}</td></tr>`}</tbody></table>
  ${
    c.balance > 0
      ? `<div class="pay">${qr ? `<img src="${qr}" alt="" style="width:110px;height:110px">` : ''}<div><div class="b">${e(t('print.pleasePay', { amount: formatMoney(c.balance) }))}</div>
      <div class="m">${e(amountInWords(c.balance, s.currency, currencyDecimals(s.currency)))}</div>${s.upiId ? `<div style="margin-top:4px">UPI: <b>${e(s.upiId)}</b></div>` : ''}</div></div>`
      : ''
  }
</body></html>`
}

// ---- CSV import / export --------------------------------------------------------

export const CSV_COLUMNS = ['name', 'phone', 'email', 'tax_number', 'address', 'city', 'state', 'discount_percent', 'credit_limit'] as const
type CsvColumn = (typeof CSV_COLUMNS)[number]

const ALIASES: Record<string, CsvColumn> = {
  name: 'name', customer: 'name', customer_name: 'name', full_name: 'name',
  phone: 'phone', mobile: 'phone', phone_number: 'phone', mobile_number: 'phone', contact: 'phone', telephone: 'phone',
  email: 'email', e_mail: 'email', email_address: 'email',
  tax_number: 'tax_number', tax_id: 'tax_number', taxnumber: 'tax_number', gstin: 'tax_number', gst: 'tax_number', gst_number: 'tax_number', vat: 'tax_number', vat_number: 'tax_number', trn: 'tax_number',
  address: 'address', street: 'address',
  city: 'city', town: 'city',
  state: 'state', province: 'state', region: 'state',
  discount_percent: 'discount_percent', discount: 'discount_percent', discount_pct: 'discount_percent',
  credit_limit: 'credit_limit', limit: 'credit_limit',
}

const stateName = (code: string | undefined, s: Settings) => (s.country === 'IN' ? INDIAN_STATES.find(([c]) => c === code)?.[1] ?? code : code)

export function stateLabel(code: string | undefined, s: Settings): string {
  return stateName(code, s) ?? ''
}

/** Accepts a GST state code ("27") or name ("Maharashtra") and returns the code for Indian shops. */
function normalizeState(v: string, s: Settings): string | undefined {
  const x = v.trim()
  if (!x) return undefined
  if (s.country !== 'IN') return x
  const hit = INDIAN_STATES.find(([code, name]) => code === x.padStart(2, '0') || name.toLowerCase() === x.toLowerCase())
  return hit ? hit[0] : x
}

export function customersCsv(list: Customer[], s: Settings): string {
  const d = moneyConfig().decimals
  return toCsv(
    list.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      tax_number: c.taxNumber,
      address: c.address,
      city: c.city,
      state: stateName(c.state, s),
      discount_percent: c.discountPercent || '',
      credit_limit: c.creditLimit ? fromMinor(c.creditLimit).toFixed(d) : '',
    })),
    [...CSV_COLUMNS],
  )
}

export interface ImportPlan {
  creates: Customer[]
  updates: Customer[]
  skipped: number
}

export const phoneKey = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10)

export async function planImport(text: string, s: Settings): Promise<ImportPlan> {
  const raw = parseCsv(text)
  const existing = (await db.customers.toArray()).filter((c) => !c.deleted)
  const byPhone = new Map<string, Customer>()
  const byEmail = new Map<string, Customer>()
  const byName = new Map<string, Customer>()
  for (const c of existing) {
    if (phoneKey(c.phone).length >= 6) byPhone.set(phoneKey(c.phone), c)
    if (c.email) byEmail.set(c.email.toLowerCase(), c)
    if (!c.phone && !c.email) byName.set(c.name.toLowerCase(), c)
  }
  const plan: ImportPlan = { creates: [], updates: [], skipped: 0 }
  const touched = new Map<string, Customer>()
  const now = Date.now()
  for (const r of raw) {
    const row: Partial<Record<CsvColumn, string>> = {}
    for (const [k, v] of Object.entries(r)) {
      const col = ALIASES[k.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')]
      if (col && v && !row[col]) row[col] = v.trim()
    }
    const name = row.name?.trim()
    if (!name) {
      plan.skipped++
      continue
    }
    const discount = row.discount_percent ? parseDecimal(row.discount_percent.replace('%', '')) : NaN
    const limit = row.credit_limit ? parseDecimal(row.credit_limit) : NaN
    const fields: Partial<Customer> = {
      name,
      phone: row.phone || undefined,
      email: row.email?.toLowerCase() || undefined,
      taxNumber: row.tax_number?.toUpperCase() || undefined,
      address: row.address || undefined,
      city: row.city || undefined,
      state: row.state ? normalizeState(row.state, s) : undefined,
      discountPercent: Number.isFinite(discount) ? Math.min(Math.max(discount, 0), 100) : undefined,
      creditLimit: Number.isFinite(limit) && limit > 0 ? toMinor(limit) : undefined,
    }
    const match =
      (phoneKey(fields.phone).length >= 6 && byPhone.get(phoneKey(fields.phone))) ||
      (fields.email && byEmail.get(fields.email)) ||
      (!fields.phone && !fields.email && byName.get(name.toLowerCase())) ||
      undefined
    if (match) {
      // Only fill in what the file provides; never touch derived balance/points.
      const base = touched.get(match.id) ?? match
      const merged = { ...base }
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== '') (merged as Record<string, unknown>)[k] = v
      if (!touched.has(match.id)) plan.updates.push(merged)
      else plan.updates[plan.updates.findIndex((u) => u.id === match.id)] = merged
      touched.set(match.id, merged)
      continue
    }
    const c: Customer = { id: uuid(), createdAt: now, updatedAt: now, loyaltyPoints: 0, balance: 0, ...stripUndefined(fields), name }
    plan.creates.push(c)
    if (phoneKey(c.phone).length >= 6) byPhone.set(phoneKey(c.phone), c)
    if (c.email) byEmail.set(c.email, c)
    if (!c.phone && !c.email) byName.set(name.toLowerCase(), c)
  }
  return plan
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

export async function applyImport(plan: ImportPlan): Promise<void> {
  // Re-read balances right before writing so a sale made meanwhile isn't overwritten.
  const fresh = await db.customers.bulkGet(plan.updates.map((u) => u.id))
  const updates = plan.updates.map((u, i) => ({ ...u, balance: fresh[i]?.balance ?? u.balance, loyaltyPoints: fresh[i]?.loyaltyPoints ?? u.loyaltyPoints }))
  await putMany('customers', [...plan.creates, ...updates])
}
