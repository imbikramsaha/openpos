import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Minus, Plus, Printer } from 'lucide-react'
import type { Settings } from '@/core/types'
import { printHtml } from '@/lib/print'
import { toast } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useDevice } from '@/stores/device'
import { useSession } from '@/stores/session'
import { navigate } from '@/router'
import { receiptHtml } from '@/features/sell/receipt'
import { Button, Segmented, Textarea } from '@/components/ui'
import { ControlRow, Group, Row, ToggleRow } from '../ui'
import { TYPING_DELAY, useSettingsDraft } from '../hooks'
import { buildSampleSale } from '../sampleSale'

const PX_PER_MM = 96 / 25.4

export function ReceiptSection() {
  const { t } = useTranslation('settings')
  const { draft, setReceipt, flush } = useSettingsDraft()
  const r = draft.receipt
  const taxes = useSettings((s) => s.taxes)
  const terminal = useDevice((s) => s.terminal)
  const deviceId = useDevice((s) => s.deviceId)
  const userName = useSession((s) => s.user?.name ?? '')
  const sale = useMemo(() => buildSampleSale(draft, taxes, { terminal, userName, deviceId }), [draft, taxes, terminal, userName, deviceId])
  const html = useMemo(() => receiptHtml(sale, draft), [sale, draft])
  const previewRef = useRef<HTMLDivElement>(null)

  const testPrint = async () => {
    await flush()
    const width = r.paperWidth === 'a4' ? undefined : r.paperWidth
    const ok = await printHtml(html, width)
    if (!ok) toast(t('receipt.printFailed'), 'error')
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-5">
        <Button className="w-full xl:hidden" icon={<Eye className="size-4" />} onClick={() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          {t('receipt.jumpToPreview')}
        </Button>

        <Group title={t('receipt.content')}>
          <Row id="receipt.header">
            <Textarea
              label={t('receipt.header')}
              hint={t('receipt.headerHint')}
              rows={2}
              value={r.header}
              onChange={(e) => setReceipt({ header: e.target.value }, TYPING_DELAY)}
              onBlur={() => void flush()}
              maxLength={300}
            />
          </Row>
          <Row id="receipt.footer">
            <Textarea
              label={t('receipt.footer')}
              hint={t('receipt.footerHint')}
              rows={3}
              value={r.footer}
              onChange={(e) => setReceipt({ footer: e.target.value }, TYPING_DELAY)}
              onBlur={() => void flush()}
              maxLength={500}
            />
          </Row>
          <ToggleRow
            id="receipt.showLogo"
            label={t('receipt.showLogo')}
            description={r.logo ? t('receipt.showLogoHint') : t('receipt.noLogo')}
            checked={r.showLogo}
            onChange={(v) => setReceipt({ showLogo: v })}
          />
          {!r.logo && (
            <Row className="pt-0">
              <Button size="sm" variant="soft" onClick={() => navigate('settings/business')}>
                {t('receipt.addLogo')}
              </Button>
            </Row>
          )}
          <ToggleRow id="receipt.showTaxBreakdown" label={t('receipt.showTaxBreakdown')} description={t('receipt.showTaxBreakdownHint')} checked={r.showTaxBreakdown} onChange={(v) => setReceipt({ showTaxBreakdown: v })} />
          <ToggleRow id="receipt.showCustomer" label={t('receipt.showCustomer')} description={t('receipt.showCustomerHint')} checked={r.showCustomer} onChange={(v) => setReceipt({ showCustomer: v })} />
          <ToggleRow id="receipt.showSku" label={t('receipt.showSku')} checked={r.showSku} onChange={(v) => setReceipt({ showSku: v })} />
          <ToggleRow id="receipt.showBarcode" label={t('receipt.showBarcode')} description={t('receipt.showBarcodeHint')} checked={r.showBarcode} onChange={(v) => setReceipt({ showBarcode: v })} />
        </Group>

        <Group title={t('receipt.printing')}>
          <ControlRow id="receipt.paperWidth" label={t('receipt.paperWidth')} description={t('receipt.paperWidthHint')}>
            <Segmented
              value={String(r.paperWidth)}
              onChange={(v) => setReceipt({ paperWidth: v === 'a4' ? 'a4' : (Number(v) as 58 | 80) })}
              options={[
                { value: '58', label: '58 mm' },
                { value: '80', label: '80 mm' },
                { value: 'a4', label: 'A4' },
              ]}
              className="w-full sm:w-auto"
            />
          </ControlRow>
          <ToggleRow id="receipt.autoPrint" label={t('receipt.autoPrint')} description={t('receipt.autoPrintHint')} checked={r.autoPrint} onChange={(v) => setReceipt({ autoPrint: v })} />
          <ControlRow id="receipt.copies" label={t('receipt.copies')} description={t('receipt.copiesHint')}>
            <Stepper value={r.copies} min={1} max={5} onChange={(copies) => setReceipt({ copies })} label={t('receipt.copies')} />
          </ControlRow>
          <Row id="receipt.testPrint">
            <Button icon={<Printer className="size-4" />} onClick={() => void testPrint()}>
              {t('receipt.testPrint')}
            </Button>
          </Row>
        </Group>
      </div>

      <div ref={previewRef} className="min-w-0 scroll-mt-4">
        <div className="xl:sticky xl:top-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('receipt.preview')}</h3>
            <span className="text-xs text-subtle">{r.paperWidth === 'a4' ? 'A4' : `${r.paperWidth} mm`}</span>
          </div>
          <ReceiptFrame html={html} paper={r.paperWidth} />
          <p className="mt-2 text-center text-xs text-subtle">{t('receipt.previewHint')}</p>
        </div>
      </div>
    </div>
  )
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const { t } = useTranslation('settings')
  return (
    <div className="inline-flex items-center rounded-xl border border-border bg-surface" role="group" aria-label={label}>
      <Button size="icon" variant="ghost" aria-label={t('receipt.fewer')} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus className="size-4" />
      </Button>
      <span className="tnum w-10 text-center font-semibold" aria-live="polite">
        {value}
      </span>
      <Button size="icon" variant="ghost" aria-label={t('receipt.more')} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus className="size-4" />
      </Button>
    </div>
  )
}

/** Renders a receipt document at true paper width, scaled down to fit and auto-sized to its content. */
export function ReceiptFrame({ html, paper }: { html: string; paper: Settings['receipt']['paperWidth'] }) {
  const { t } = useTranslation('settings')
  const wrapRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [avail, setAvail] = useState(360)
  const [height, setHeight] = useState(600)
  const a4 = paper === 'a4'
  const docWidth = Math.ceil((a4 ? 210 : paper) * PX_PER_MM)
  const scale = Math.min(1, (avail - (a4 ? 0 : 32)) / docWidth)

  // A4 invoices rely on @page margins, so pad them on screen; thermal paper gets a white page.
  const srcDoc = useMemo(
    () => html.replace('</head>', `<style>@media screen{html{background:#fff;overflow:hidden}${a4 ? 'body{padding:12mm}' : ''}}</style></head>`),
    [html, a4],
  )

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const measure = () => {
    const doc = frameRef.current?.contentDocument
    if (doc?.documentElement) setHeight(Math.max(200, doc.documentElement.scrollHeight))
  }
  useEffect(() => {
    const id = setTimeout(measure, 120)
    return () => clearTimeout(id)
  }, [srcDoc])

  return (
    <div ref={wrapRef} className="flex justify-center rounded-2xl border border-border bg-surface-3 px-4 py-6">
      <div className="relative overflow-hidden rounded-sm bg-white shadow-pop" style={{ width: docWidth * scale, height: height * scale }}>
        <iframe
          ref={frameRef}
          title={t('receipt.preview')}
          srcDoc={srcDoc}
          onLoad={measure}
          scrolling="no"
          tabIndex={-1}
          className="absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{ width: docWidth, height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  )
}
