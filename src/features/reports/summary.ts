import i18n from 'i18next'
import type { Settings } from '@/core/types'
import { printHtml } from '@/lib/print'
import { int, margin, money, pct, qty, share } from './format'
import { reportHtml, type PrintSection } from './print'
import { categoryRows, productRows } from './rows'
import { methodOrder, terminalLabel } from './context'
import type { ReportData, ReportState } from './useReport'

// A4 "sales summary" print of the overview: KPIs, top products, categories,
// payments, staff, terminals and tax by rate.

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'reports', ...opts }) as string

export function printSummary(data: ReportData, report: ReportState, settings: Settings, rangeLabel: string) {
  const { cur } = data
  const T = cur.totals
  const products = productRows(cur, report.productMap, report.categoryMap, t('uncategorised'))
  const cats = categoryRows(products, report.categoryMap, T.net, t('uncategorised'))
  const top = [...products].sort((a, b) => b.net - a.net).slice(0, 20)
  const methods = methodOrder(settings).map((m) => cur.methods.get(m)).filter((m) => !!m)
  const methodTotal = methods.reduce((a, m) => a + Math.max(0, m!.net), 0)
  const staff = [...cur.staff.values()].sort((a, b) => b.net - a.net)
  const rates = [...cur.rates.values()].sort((a, b) => a.rate - b.rate)
  const gst = settings.gstMode

  const sections: PrintSection[] = [
    {
      kpis: [
        [t('kpi.netSales'), money(T.net)],
        [t('kpi.transactions'), int(T.sales)],
        [t('kpi.avgTicket'), money(T.sales ? Math.round(T.salesTotal / T.sales) : 0)],
        [t('kpi.grossProfit'), `${money(T.profit)} (${pct(margin(T.profit, T.net))})`],
        [t('kpi.tax'), money(T.tax)],
        [t('kpi.discounts'), money(T.discounts)],
        [t('kpi.refunds'), `${money(Math.abs(T.refunds))} (${int(T.refundsCount)})`],
        [t('inclTax'), money(T.total)],
      ],
    },
    {
      title: t('topProducts'),
      head: [t('common:product'), t('qtySold'), t('revenue'), t('common:profit'), t('share')],
      numeric: [1, 2, 3, 4],
      rows: top.map((p) => [p.name, qty(p.qty), money(p.net), money(p.profit), pct(p.share)]),
    },
    {
      title: t('byCategory'),
      head: [t('common:category'), t('qtySold'), t('revenue'), t('common:profit'), t('share')],
      numeric: [1, 2, 3, 4],
      rows: cats.map((c) => [c.name, qty(c.qty), money(c.net), money(c.profit), pct(c.share)]),
    },
    {
      title: t('payments.byMethod'),
      head: [t('method'), t('kpi.transactions'), t('payments.net'), t('share')],
      numeric: [1, 2, 3],
      rows: methods.map((m) => [i18n.t(`common:payment.${m!.method}`), int(m!.count), money(m!.net), pct(share(Math.max(0, m!.net), methodTotal))]),
    },
    {
      title: t('tabs.staff'),
      head: [t('common:user'), t('kpi.transactions'), t('kpi.netSales'), t('staff.refundValue'), t('staff.discounts'), t('staff.voids')],
      numeric: [1, 2, 3, 4, 5],
      rows: staff.map((s) => [s.name, int(s.count), money(s.net), money(s.refunds), money(s.discounts), int(s.voids)]),
    },
  ]
  if (cur.terminals.size > 1)
    sections.push({
      title: t('byTerminal'),
      head: [t('terminal'), t('kpi.transactions'), t('kpi.netSales')],
      numeric: [1, 2],
      rows: [...cur.terminals.values()].map((x) => [terminalLabel(x.deviceId, x.code), int(x.count), money(x.net)]),
    })
  sections.push({
    title: t('tax.byRate'),
    head: [t('tax.rate'), t('tax.taxable'), ...(gst ? ['CGST', 'SGST', 'IGST'] : []), t('tax.totalTax')],
    numeric: gst ? [1, 2, 3, 4, 5] : [1, 2],
    rows: rates.map((r) => [pct(r.rate), money(r.taxable), ...(gst ? [money(r.cgst), money(r.sgst), money(r.igst)] : []), money(r.tax)]),
  })
  void printHtml(reportHtml({ title: t('summaryTitle'), subtitle: rangeLabel, settings, sections }))
}
