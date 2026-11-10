import { useEffect, useMemo, useRef, useState } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, CheckCircle2, Mail, MessageCircle, Printer, Share2 } from 'lucide-react'
import type { Sale } from '@/core/types'
import { db } from '@/db/db'
import { formatMoney } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { canPrint } from '@/lib/platform'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, Modal } from '@/components/ui'
import { receiptHtml, receiptText } from './receipt'
import { CALLING_CODES } from '@/lib/validate'

export async function printSale(sale: Sale) {
  const s = useSettings.getState().settings
  const html = receiptHtml(sale, s)
  const width = s.receipt.paperWidth === 'a4' ? undefined : s.receipt.paperWidth
  for (let i = 0; i < Math.max(1, s.receipt.copies); i++) if (!(await printHtml(html, width))) return
}


/**
 * Digits for a wa.me link. Numbers saved without "+" are local numbers: WhatsApp would read
 * "98765 43210" as country code 98 (Iran), so the store's calling code is prefixed.
 */
export function whatsAppNumber(phone: string | undefined, country = useSettings.getState().settings.country): string {
  const raw = (phone ?? '').trim()
  if (!raw) return ''
  let d = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return d
  if (d.startsWith('00')) return d.slice(2)
  const cc = country ? CALLING_CODES[country] : undefined
  if (!cc) return d
  d = d.replace(/^0+/, '')
  return d.length <= 10 ? cc + d : d
}

/** `phone`, when given, is already a full international number (digits only are kept). */
export function shareWhatsApp(sale: Sale, phone?: string) {
  const text = receiptText(sale, useSettings.getState().settings)
  const digits = phone !== undefined ? phone.replace(/\D/g, '') : whatsAppNumber(sale.customerPhone)
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
}

export async function shareNative(sale: Sale) {
  const text = receiptText(sale, useSettings.getState().settings)
  if (navigator.share) {
    try {
      await navigator.share({ title: sale.number, text })
    } catch {
      /* cancelled */
    }
  } else {
    await navigator.clipboard?.writeText(text)
    toast(i18n.t('common:copied'))
  }
}

export function emailReceipt(sale: Sale, email?: string) {
  const s = useSettings.getState().settings
  window.location.href = `mailto:${email ?? ''}?subject=${encodeURIComponent(`${s.businessName} — ${sale.number}`)}&body=${encodeURIComponent(receiptText(sale, s))}`
}

export function ReceiptPreview({ sale, className }: { sale: Sale; className?: string }) {
  const settings = useSettings((s) => s.settings)
  const html = useMemo(() => receiptHtml(sale, settings), [sale, settings])
  const a4 = settings.receipt.paperWidth === 'a4'
  return (
    <iframe
      title={sale.number}
      srcDoc={html}
      className={className ?? `mx-auto block rounded-lg border border-border bg-white ${a4 ? 'h-[70vh] w-full' : 'h-[60vh] w-[330px] max-w-full'}`}
    />
  )
}

/** `onEdit`, when given, offers "Back to edit" (void the sale and reopen it in the cart). */
export function ReceiptDialog({ sale, onClose, onEdit }: { sale: Sale | null; onClose: () => void; onEdit?: () => Promise<void> }) {
  const { t } = useTranslation('sell')
  const [editing, setEditing] = useState(false)
  // While "Back to edit" asks for confirmation, Enter belongs to that dialog, not "New sale".
  const editingRef = useRef(false)
  const edit = async () => {
    if (!onEdit || editingRef.current) return
    editingRef.current = true
    setEditing(true)
    try {
      await onEdit()
    } finally {
      editingRef.current = false
      setEditing(false)
    }
  }
  const autoPrint = useSettings((s) => s.settings.receipt.autoPrint)
  const customerEmail = useLiveQuery(async () => (sale?.customerId ? (await db.customers.get(sale.customerId))?.email || undefined : undefined), [sale?.customerId])

  useEffect(() => {
    if (sale && autoPrint && canPrint()) void printSale(sale)
  }, [sale, autoPrint])

  useEffect(() => {
    if (!sale) return
    const onKey = (e: KeyboardEvent) => {
      if (editingRef.current) return
      if (e.key === 'Enter') {
        e.preventDefault()
        onClose()
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) void printSale(sale)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sale, onClose])

  if (!sale) return null
  return (
    <Modal open onClose={() => !editingRef.current && onClose()} size="lg" flush title={sale.total < 0 ? t('refundComplete') : t('saleComplete')} subtitle={sale.number}>
      <div className="grid lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-center justify-center gap-5 p-6 text-center">
          <CheckCircle2 className="size-16 text-success" strokeWidth={1.6} />
          {sale.change > 0 ? (
            <div>
              <div className="text-sm font-semibold text-muted">{t('changeDue')}</div>
              <div className="tnum text-5xl font-semibold tracking-tight text-success">{formatMoney(sale.change)}</div>
            </div>
          ) : (
            <div className="tnum text-4xl font-semibold tracking-tight" dir="ltr">{formatMoney(sale.total)}</div>
          )}
          <div className="grid w-full max-w-xs grid-cols-2 gap-2">
            <Button size="lg" icon={<Printer className="size-5" />} onClick={() => printSale(sale)}>
              {t('print')}
            </Button>
            <Button size="lg" icon={<MessageCircle className="size-5" />} onClick={() => shareWhatsApp(sale)}>
              WhatsApp
            </Button>
            <Button size="lg" icon={<Share2 className="size-5" />} onClick={() => shareNative(sale)}>
              {t('share')}
            </Button>
            <Button size="lg" icon={<Mail className="size-5" />} onClick={() => emailReceipt(sale, customerEmail)}>
              {t('email')}
            </Button>
          </div>
          <Button variant="primary" size="xl" block className="max-w-xs" onClick={onClose} disabled={editing} autoFocus>
            {t('newSale')}
          </Button>
          {onEdit && (
            <Button variant="ghost" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} loading={editing} onClick={() => void edit()}>
              {t('editSale')}
            </Button>
          )}
        </div>
        <div className="hidden border-s border-border bg-surface-3 p-4 lg:block">
          <ReceiptPreview sale={sale} />
        </div>
      </div>
    </Modal>
  )
}
