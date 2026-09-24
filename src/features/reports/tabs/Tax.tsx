import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Sale } from '@/core/types'
import { Badge } from '@/components/ui'
import { KpiTile } from '../charts'
import { moneyWhole, pct, uqc } from '../format'
import { ReportTable, type RCol } from '../ReportTable'
import { useReportMeta, type TabProps } from '../context'
import type { HsnAgg, RateAgg } from '../compute'
import { formatMoney } from '@/lib/money'

interface SplitRow {
  key: string
  label: string
  count: number
  taxable: number
  tax: number
  total: number
}

export function TaxTab({ data }: TabProps) {
  const { t } = useTranslation('reports')
  const { settings } = useReportMeta()
  const gst = settings.gstMode
  const { cur, originals } = data
  const rates = useMemo(() => [...cur.rates.values()].sort((a, b) => a.rate - b.rate), [cur.rates])
  const hsn = useMemo(() => [...cur.hsn.values()], [cur.hsn])
  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0)
  const rt = { taxable: sum(rates, (r) => r.taxable), tax: sum(rates, (r) => r.tax), cgst: sum(rates, (r) => r.cgst), sgst: sum(rates, (r) => r.sgst), igst: sum(rates, (r) => r.igst), total: sum(rates, (r) => r.total) }
  const cn = cur.creditNotes
  const cnTotal = sum(cn, (s) => s.total)
  const missingHsn = hsn.filter((h) => !h.hsn).length

  const rateCols: RCol<RateAgg>[] = [
    { key: 'rate', label: t('tax.rate'), kind: 'pct', value: (r) => r.rate, render: (r) => <span className="font-medium">{pct(r.rate)}</span> },
    { key: 'name', label: t('tax.name'), value: (r) => r.name || (r.rate ? '' : t('tax.exempt')), hideOnMobile: true },
    { key: 'taxable', label: t('tax.taxable'), kind: 'money', value: (r) => r.taxable },
    ...(gst
      ? ([
          { key: 'cgst', label: 'CGST', kind: 'money', value: (r) => r.cgst },
          { key: 'sgst', label: 'SGST', kind: 'money', value: (r) => r.sgst },
          { key: 'igst', label: 'IGST', kind: 'money', value: (r) => r.igst },
        ] as RCol<RateAgg>[])
      : []),
    { key: 'tax', label: t('tax.totalTax'), kind: 'money', value: (r) => r.tax, primary: true },
    { key: 'total', label: t('tax.invoiceValue'), kind: 'money', value: (r) => r.total, hideOnMobile: true },
  ]

  const hsnCols: RCol<HsnAgg>[] = [
    { key: 'hsn', label: 'HSN/SAC', value: (r) => r.hsn, render: (r) => (r.hsn ? <span className="font-medium">{r.hsn}</span> : <Badge tone="warning">{t('tax.noHsn')}</Badge>) },
    { key: 'description', label: t('tax.description'), value: (r) => r.description, className: 'max-w-56 truncate' },
    { key: 'uqc', label: 'UQC', value: (r) => uqc(r.unit), hideOnMobile: true },
    { key: 'rate', label: t('tax.rate'), kind: 'pct', value: (r) => r.rate },
    { key: 'qty', label: t('common:qty'), kind: 'qty', value: (r) => r.qty },
    { key: 'value', label: t('tax.totalValue'), kind: 'money', value: (r) => r.value, hideOnMobile: true },
    { key: 'taxable', label: t('tax.taxable'), kind: 'money', value: (r) => r.taxable, primary: true },
    { key: 'igst', label: 'IGST', kind: 'money', value: (r) => r.igst, hideOnMobile: true },
    { key: 'cgst', label: 'CGST', kind: 'money', value: (r) => r.cgst, hideOnMobile: true },
    { key: 'sgst', label: 'SGST', kind: 'money', value: (r) => r.sgst, hideOnMobile: true },
    { key: 'tax', label: t('tax.totalTax'), kind: 'money', value: (r) => r.tax },
  ]

  const splitRows: SplitRow[] = [
    { key: 'b2b', label: t('tax.b2b'), ...cur.b2b },
    { key: 'b2c', label: t('tax.b2c'), ...cur.b2c },
  ]
  const splitCols: RCol<SplitRow>[] = [
    { key: 'label', label: t('tax.supplyType'), value: (r) => r.label, render: (r) => <span className="font-medium">{r.label}</span> },
    { key: 'count', label: t('tax.invoices'), kind: 'int', value: (r) => r.count },
    { key: 'taxable', label: t('tax.taxable'), kind: 'money', value: (r) => r.taxable },
    { key: 'tax', label: t('tax.totalTax'), kind: 'money', value: (r) => r.tax },
    { key: 'total', label: t('tax.invoiceValue'), kind: 'money', value: (r) => r.total, primary: true },
  ]

  const docCols = (credit: boolean): RCol<Sale>[] => [
    { key: 'number', label: credit ? t('tax.creditNote') : t('tax.invoice'), value: (s) => s.number, render: (s) => <span className="font-medium">{s.number}</span> },
    { key: 'date', label: t('common:date'), kind: 'date', value: (s) => s.createdAt },
    ...(credit ? ([{ key: 'orig', label: t('tax.original'), value: (s) => (s.refundOf ? originals.get(s.refundOf) ?? '' : '') }] as RCol<Sale>[]) : []),
    { key: 'customer', label: t('common:customer'), value: (s) => s.customerName ?? '', hideOnMobile: !credit },
    ...(gst
      ? ([
          { key: 'gstin', label: settings.taxLabel, value: (s) => s.customerTaxNumber ?? '' },
          { key: 'supply', label: t('tax.supply'), value: (s) => (s.interState ? t('tax.inter') : t('tax.intra')), hideOnMobile: true },
        ] as RCol<Sale>[])
      : []),
    { key: 'taxable', label: t('tax.taxable'), kind: 'money', value: (s) => s.netTotal },
    { key: 'tax', label: t('tax.totalTax'), kind: 'money', value: (s) => s.taxTotal },
    { key: 'total', label: t('tax.invoiceValue'), kind: 'money', value: (s) => s.total, primary: true },
  ]
  const docTotals = (list: Sale[]) => ({ taxable: sum(list, (s) => s.netTotal), tax: sum(list, (s) => s.taxTotal), total: sum(list, (s) => s.total) })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label={t('tax.taxable')} value={moneyWhole(rt.taxable)} title={formatMoney(rt.taxable)} />
        <KpiTile label={t('tax.totalTax')} value={moneyWhole(rt.tax)} title={formatMoney(rt.tax)} sub={gst ? `CGST ${moneyWhole(rt.cgst)} · SGST ${moneyWhole(rt.sgst)}` : undefined} />
        {gst ? <KpiTile label="IGST" value={moneyWhole(rt.igst)} title={formatMoney(rt.igst)} sub={t('tax.interStateSupplies')} /> : <KpiTile label={t('tax.invoiceValue')} value={moneyWhole(rt.total)} />}
        <KpiTile label={t('tax.creditNotes')} value={moneyWhole(Math.abs(cnTotal))} title={formatMoney(cnTotal)} sub={t('tax.notesCount', { count: cn.length })} />
      </div>

      <ReportTable
        title={t('tax.byRate')}
        subtitle={t('tax.netOfCredit')}
        rows={rates}
        columns={rateCols}
        rowKey={(r) => String(r.rate)}
        initialSort={{ key: 'rate', dir: 'asc' }}
        totals={rt}
        filename="tax-by-rate"
      />

      {gst && (
        <>
          <ReportTable
            title={t('tax.hsnSummary')}
            subtitle={missingHsn ? t('tax.missingHsn', { count: missingHsn }) : t('tax.hsnHint')}
            rows={hsn}
            columns={hsnCols}
            rowKey={(r) => r.key}
            search={(r) => `${r.hsn} ${r.description}`}
            initialSort={{ key: 'taxable', dir: 'desc' }}
            totals={{ value: sum(hsn, (h) => h.value), taxable: sum(hsn, (h) => h.taxable), igst: sum(hsn, (h) => h.igst), cgst: sum(hsn, (h) => h.cgst), sgst: sum(hsn, (h) => h.sgst), tax: sum(hsn, (h) => h.tax) }}
            filename="hsn-summary"
          />
          <ReportTable
            title={t('tax.b2bB2c')}
            subtitle={t('tax.b2bHint', { label: settings.taxLabel })}
            rows={splitRows}
            columns={splitCols}
            rowKey={(r) => r.key}
            totals={{ count: cur.b2b.count + cur.b2c.count, taxable: cur.b2b.taxable + cur.b2c.taxable, tax: cur.b2b.tax + cur.b2c.tax, total: cur.b2b.total + cur.b2c.total }}
            filename="b2b-b2c"
          />
          <ReportTable
            title={t('tax.b2bInvoices')}
            subtitle={t('tax.invoicesCount', { count: cur.b2bInvoices.length })}
            rows={cur.b2bInvoices}
            columns={docCols(false)}
            rowKey={(s) => s.id}
            search={(s) => `${s.number} ${s.customerName ?? ''} ${s.customerTaxNumber ?? ''}`}
            initialSort={{ key: 'date', dir: 'asc' }}
            totals={docTotals(cur.b2bInvoices)}
            filename="b2b-invoices"
          />
        </>
      )}

      <ReportTable
        title={t('tax.creditNotes')}
        subtitle={t('tax.creditHint')}
        rows={cn}
        columns={docCols(true)}
        rowKey={(s) => s.id}
        search={(s) => `${s.number} ${s.customerName ?? ''} ${s.refundOf ? originals.get(s.refundOf) ?? '' : ''}`}
        initialSort={{ key: 'date', dir: 'asc' }}
        totals={docTotals(cn)}
        filename="credit-notes"
      />
    </div>
  )
}
