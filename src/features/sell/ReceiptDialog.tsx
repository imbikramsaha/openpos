import { useEffect, useMemo } from 'react'
import i18n from 'i18next'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Mail, MessageCircle, Printer, Share2 } from 'lucide-react'
import type { Sale } from '@/core/types'
import { formatMoney } from '@/lib/money'
import { printHtml } from '@/lib/print'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/ui'
import { Button, Modal } from '@/components/ui'
import { receiptHtml, receiptText } from './receipt'

export async function printSale(sale: Sale) {
  const s = useSettings.getState().settings
  const html = receiptHtml(sale, s)
  const width = s.receipt.paperWidth === 'a4' ? undefined : s.receipt.paperWidth
  for (let i = 0; i < Math.max(1, s.receipt.copies); i++) await printHtml(html, width)
}

export function shareWhatsApp(sale: Sale, phone?: string) {
  const text = receiptText(sale, useSettings.getState().settings)
  const digits = (phone ?? sale.customerPhone ?? '').replace(/[^\d]/g, '')
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

export function ReceiptDialog({ sale, onClose }: { sale: Sale | null; onClose: () => void }) {
  const { t } = useTranslation('sell')
  const autoPrint = useSettings((s) => s.settings.receipt.autoPrint)

  useEffect(() => {
    if (sale && autoPrint) void printSale(sale)
  }, [sale, autoPrint])

  useEffect(() => {
    if (!sale) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        onClose()
      } else if (e.key.toLowerCase() === 'p' && !e.ctrlKey) void printSale(sale)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sale, onClose])

  if (!sale) return null
  return (
    <Modal open onClose={onClose} size="lg" flush title={t('saleComplete')} subtitle={sale.number}>
      <div className="grid lg:grid-cols-[1fr_auto]">
        <div className="flex flex-col items-center justify-center gap-5 p-6 text-center">
          <CheckCircle2 className="size-16 text-success" strokeWidth={1.6} />
          {sale.change > 0 ? (
            <div>
              <div className="text-sm font-semibold text-muted">{t('changeDue')}</div>
              <div className="tnum text-5xl font-extrabold text-success">{formatMoney(sale.change)}</div>
            </div>
          ) : (
            <div className="tnum text-4xl font-extrabold">{formatMoney(sale.total)}</div>
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
            <Button size="lg" icon={<Mail className="size-5" />} onClick={() => emailReceipt(sale)}>
              {t('email')}
            </Button>
          </div>
          <Button variant="primary" size="xl" block className="max-w-xs" onClick={onClose} autoFocus>
            {t('newSale')}
          </Button>
        </div>
        <div className="hidden border-s border-border bg-surface-3 p-4 lg:block">
          <ReceiptPreview sale={sale} />
        </div>
      </div>
    </Modal>
  )
}
